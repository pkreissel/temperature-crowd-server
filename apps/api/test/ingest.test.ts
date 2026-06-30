import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import fastify from 'fastify';
import contractSchema from '@temperaturcrowd/contract/schema.json';
import { db, initDb } from '../src/db';
import { sql } from 'kysely';
import { oprfAuth } from '../src/oprf';

// We build a test server instance exactly like index.ts
const buildServer = async () => {
  const app = fastify();
  
  await initDb();
  
  // Clean DB for tests
  await db.deleteFrom('auth_sessions').execute();
  await db.deleteFrom('readings').execute();

  app.decorateRequest('donor', null);

  app.addHook('preHandler', async (request, reply) => {
    if (request.routerPath === '/v1/ingest') {
      const payload = request.body as any;
      if (!payload?.api_key || typeof payload.api_key !== 'string') {
        reply.code(401).send({ error: 'Missing or invalid api_key' });
        return reply;
      }
      const parts = payload.api_key.split(':');
      if (parts.length !== 2) {
        reply.code(401).send({ error: 'Invalid api_key format' });
        return reply;
      }
      const [xHex, tokenHex] = parts;
      const isValid = await oprfAuth.verifyToken(xHex, tokenHex);
      if (!isValid) {
        reply.code(401).send({ error: 'Invalid OPRF token' });
        return reply;
      }
      request.donor = { id: xHex };
    }
  });

  app.post('/v1/auth/request-link', async (request, reply) => {
    const { email, blinded_element } = request.body as any;
    const sessionId = "test-session-id";
    await db.insertInto('auth_sessions').values({
      session_id: sessionId,
      email,
      blinded_element,
      status: 'pending'
    }).execute();
    reply.send({ session_id: sessionId, status: 'pending' });
  });

  app.get('/v1/auth/verify', async (request, reply) => {
    const { session_id } = request.query as any;
    const session = await db.selectFrom('auth_sessions').where('session_id', '=', session_id).selectAll().executeTakeFirst();
    const evaluated = await oprfAuth.evaluateBlinded(session!.blinded_element);
    
    await db.updateTable('auth_sessions').set({ status: 'verified', evaluated_element: Buffer.from(evaluated).toString('hex') })
      .where('session_id', '=', session_id).execute();
      
    reply.type('text/html').send('<h1>Successfully Verified!</h1>');
  });

  app.get('/v1/auth/poll/:session_id', async (request, reply) => {
    const { session_id } = request.params as any;
    const session = await db.selectFrom('auth_sessions').where('session_id', '=', session_id).select(['status', 'evaluated_element']).executeTakeFirst();
    if (session!.status === 'verified') reply.send({ status: 'verified', evaluated_element: session!.evaluated_element });
    else reply.send({ status: 'pending' });
  });

  app.post('/v1/ingest', async (request, reply) => {
    const payload = request.body as any;
    reply.send({ status: 'ok', received_readings: payload.readings?.length || 0, donor_id: request.donor?.id });
  });

  return app;
};

describe('Ingest API', () => {
  let app: any;
  let baseUrl: string;
  let originalEvaluateBlinded: any;

  beforeAll(async () => {
    originalEvaluateBlinded = oprfAuth.evaluateBlinded;
    oprfAuth.evaluateBlinded = async () => new Uint8Array([1, 2, 3]);

    app = await buildServer();
    await app.listen({ port: 0 });
    const address = app.server.address();
    baseUrl = `http://localhost:${address.port}`;
  });

  afterAll(async () => {
    oprfAuth.evaluateBlinded = originalEvaluateBlinded;
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

  // Note: An end-to-end test including the client-side blinding would go here, 
  // but it requires a VoprfClient setup in the test.

  it('handles magic link flow successfully', async () => {
    // 1. Request link
    const requestRes = await fetch(`${baseUrl}/v1/auth/request-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@gmail.com',
        blinded_element: '01020304' // hex
      })
    });
    
    expect(requestRes.status).toBe(200);
    const requestData: any = await requestRes.json();
    expect(requestData.session_id).toBeDefined();
    const sessionId = requestData.session_id;
    
    // 2. Verify link
    const verifyRes = await fetch(`${baseUrl}/v1/auth/verify?session_id=${sessionId}`);
    
    expect(verifyRes.status).toBe(200);
    const verifyHtml = await verifyRes.text();
    expect(verifyHtml).toContain('Successfully Verified');
    
    // 3. Poll for result
    const pollRes = await fetch(`${baseUrl}/v1/auth/poll/${sessionId}`);
    
    expect(pollRes.status).toBe(200);
    const pollData: any = await pollRes.json();
    expect(pollData.status).toBe('verified');
    expect(pollData.evaluated_element).toBeDefined();
  });
});
