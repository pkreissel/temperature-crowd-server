import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { server } from '../src/index';
import { db, initDb } from '../src/db';
import { blindRsaAuth } from '../src/blind_rsa';

// vi.mock is hoisted above imports, so the shared spy must be created via vi.hoisted.
const { mockDispatch } = vi.hoisted(() => ({ mockDispatch: vi.fn(async () => ({ success: '100' })) }));
vi.mock('@seven.io/client', () => ({
  Client: class {},
  SmsResource: class {
    dispatch = mockDispatch;
  },
  // HLR lookup used by request-otp; return a deliverable German mobile so the flow proceeds.
  LookupResource: class {
    hlr = async () => [{ status: true, valid_number: 'valid', reachable: 'reachable', country_code: 'DE' }];
  }
}));

describe('Ingest API', () => {
  let app: any;
  let baseUrl: string;
  let originalSignBlinded: any;
  let originalVerifyToken: any;

  beforeAll(async () => {
    process.env.PHONE_HMAC_SECRET = 'test-secret';
    process.env.SEVEN_API_KEY = '';
    originalSignBlinded = blindRsaAuth.signBlinded;
    blindRsaAuth.signBlinded = async () => '01020304'; // Mocked hex string signature
    originalVerifyToken = blindRsaAuth.verifyToken;
    blindRsaAuth.verifyToken = async () => true;

    await initDb();
    
    // Clean DB for tests
    await db.deleteFrom('auth_sessions').execute();
    await db.deleteFrom('readings').execute();
    await db.deleteFrom('registered_phones').execute();

    app = server;
    await app.listen({ port: 0 });
    const address = app.server.address();
    baseUrl = `http://localhost:${address.port}`;
  });

  afterAll(async () => {
    blindRsaAuth.signBlinded = originalSignBlinded;
    blindRsaAuth.verifyToken = originalVerifyToken;
    await app.close();
  });

  it('rejects ingest without auth', async () => {
    const response = await fetch(`${baseUrl}/v1/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: 'test-device',
        api_key: 'invalid-format',
        readings: [{ ts: new Date().toISOString(), temp_c: 25 }]
      })
    });
    
    expect(response.status).toBe(401);
  });

  it('handles web-based sms otp flow successfully', async () => {
    // 1. Init Session
    const initRes = await fetch(`${baseUrl}/v1/auth/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blinded_element: '01020304' // hex
      })
    });
    expect(initRes.status).toBe(200);
    const initData: any = await initRes.json();
    const sessionId = initData.session_id;

    // 2. Request OTP (with mock Turnstile)
    const requestRes = await fetch(`${baseUrl}/v1/auth/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        phone_number: '+4915112345678',
        'cf-turnstile-response': 'valid-token'
      })
    });
    
    expect(requestRes.status).toBe(200);
    
    // Fetch the randomly generated OTP from DB
    const session = await db.selectFrom('auth_sessions').where('session_id', '=', sessionId).selectAll().executeTakeFirst();
    const otpCode = session!.otp_code;
    
    // 3. Verify OTP
    const verifyRes = await fetch(`${baseUrl}/v1/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        otp_code: otpCode
      })
    });
    
    expect(verifyRes.status).toBe(200);
    const verifyData: any = await verifyRes.json();
    expect(verifyData.status).toBe('ok');
    
    // 4. Poll for result
    const pollRes = await fetch(`${baseUrl}/v1/auth/poll/${sessionId}`);
    
    expect(pollRes.status).toBe(200);
    const pollData: any = await pollRes.json();
    expect(pollData.status).toBe('verified');
    expect(pollData.blind_signature).toBeDefined();
  });

  it('sends SMS via seven.io client when API key is configured', async () => {
    // 1. Init Session
    const initRes = await fetch(`${baseUrl}/v1/auth/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blinded_element: '01020304'
      })
    });
    expect(initRes.status).toBe(200);
    const initData: any = await initRes.json();
    const sessionId = initData.session_id;

    mockDispatch.mockClear();

    // Enable API key specifically for this test
    process.env.SEVEN_API_KEY = 'test-api-key';

    // 2. Request OTP
    const phone = '+4915112345679';
    const requestRes = await fetch(`${baseUrl}/v1/auth/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        phone_number: phone,
        'cf-turnstile-response': 'valid-token'
      })
    });
    
    expect(requestRes.status).toBe(200);
    
    // Verify that dispatch was called with an array for `to`
    expect(mockDispatch).toHaveBeenCalled();
    const callArgs = mockDispatch.mock.calls[0][0];
    expect(callArgs.to).toEqual([phone]);
    expect(callArgs.from).toBe('TempCrowd');
    expect(callArgs.text).toMatch(/^OTP: \d{6}$/);

    // Reset API key so other tests are unaffected if they run after this
    process.env.SEVEN_API_KEY = '';
  });

  it('prevents double phone registration on concurrent polls', async () => {
    const initRes = await fetch(`${baseUrl}/v1/auth/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blinded_element: '01020304' })
    });
    const { session_id } = await initRes.json() as any;

    await fetch(`${baseUrl}/v1/auth/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id, phone_number: '+4915112345680', 'cf-turnstile-response': 'valid-token' })
    });
    
    const session = await db.selectFrom('auth_sessions').where('session_id', '=', session_id).selectAll().executeTakeFirst();
    
    await fetch(`${baseUrl}/v1/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id, otp_code: session!.otp_code })
    });
    
    const poll1Res = await fetch(`${baseUrl}/v1/auth/poll/${session_id}`);
    const poll2Res = await fetch(`${baseUrl}/v1/auth/poll/${session_id}`);
    
    expect(poll1Res.status).toBe(200);
    expect(poll2Res.status).toBe(200);
    
    const initRes2 = await fetch(`${baseUrl}/v1/auth/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blinded_element: '01020305' })
    });
    const session_id2 = (await initRes2.json() as any).session_id;

    await fetch(`${baseUrl}/v1/auth/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: session_id2, phone_number: '+4915112345680', 'cf-turnstile-response': 'valid-token' })
    });
    
    const session2 = await db.selectFrom('auth_sessions').where('session_id', '=', session_id2).selectAll().executeTakeFirst();
    
    await fetch(`${baseUrl}/v1/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: session_id2, otp_code: session2!.otp_code })
    });
    
    const conflictPollRes = await fetch(`${baseUrl}/v1/auth/poll/${session_id2}`);
    expect(conflictPollRes.status).toBe(400);
  });

  it('supports delete_before for removing old readings', async () => {
    const deviceId = 'test-device-delete';
    
    // Insert initial readings
    await fetch(`${baseUrl}/v1/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: deviceId,
        api_key: 'mock:token',
        readings: [
          { ts: '2025-01-01T10:00:00Z', temp_c: 20 },
          { ts: '2025-01-02T10:00:00Z', temp_c: 22 },
          { ts: '2025-01-03T10:00:00Z', temp_c: 21 }
        ]
      })
    });
    
    const countBefore = await db.selectFrom('readings').where('device_id', '=', deviceId).select((eb) => eb.fn.count<number>('id').as('count')).executeTakeFirst();
    expect(Number(countBefore?.count)).toBe(3);

    // Send another ingest with delete_before
    await fetch(`${baseUrl}/v1/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: deviceId,
        api_key: 'mock:token',
        delete_before: '2025-01-02T10:00:00Z',
        readings: []
      })
    });
    
    const countAfter = await db.selectFrom('readings').where('device_id', '=', deviceId).select((eb) => eb.fn.count<number>('id').as('count')).executeTakeFirst();
    expect(Number(countAfter?.count)).toBe(2);
    
    const remaining = await db.selectFrom('readings').where('device_id', '=', deviceId).select('ts').orderBy('ts', 'asc').execute();
    expect(remaining.map(r => r.ts)).toEqual(['2025-01-02T10:00:00Z', '2025-01-03T10:00:00Z']);
  });
});
