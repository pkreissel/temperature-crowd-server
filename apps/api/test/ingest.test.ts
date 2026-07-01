import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { server } from '../src/index';
import { db, initDb } from '../src/db';
import { blindRsaAuth } from '../src/blind_rsa';

describe('Ingest API', () => {
  let app: any;
  let baseUrl: string;
  let originalSignBlinded: any;

  beforeAll(async () => {
    process.env.PHONE_HMAC_SECRET = 'test-secret';
    process.env.SEVEN_API_KEY = '';
    originalSignBlinded = blindRsaAuth.signBlinded;
    blindRsaAuth.signBlinded = async () => '01020304'; // Mocked hex string signature

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
    expect(pollData.evaluated_element).toBeDefined();
  });
});
