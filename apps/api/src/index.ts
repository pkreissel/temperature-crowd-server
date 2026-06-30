import fastify from 'fastify';
import validate from 'deep-email-validator';
import * as brevo from '@getbrevo/brevo';
import crypto from 'crypto';
import contractSchema from '@temperaturcrowd/contract/schema.json';
import { db, initDb } from './db';
import { oprfAuth } from './oprf';

const server = fastify({ logger: true });

const brevoApiKey = process.env.BREVO_API_KEY;
let emailApi: brevo.TransactionalEmailsApi | null = null;

if (brevoApiKey) {
  emailApi = new brevo.TransactionalEmailsApi();
  emailApi.setApiKey(brevo.TransactionalEmailsApiApiKeys.apiKey, brevoApiKey);
}

// Custom auth middleware for OPRF
server.decorateRequest('donor', null);

server.addHook('preHandler', async (request, reply) => {
  if (request.routerPath === '/v1/ingest') {
    const payload = request.body as any;
    
    if (!payload?.api_key || typeof payload.api_key !== 'string') {
      reply.code(401).send({ error: 'Missing or invalid api_key' });
      return;
    }
    
    // api_key format expected: "X_hex:OPRF_hex"
    const parts = payload.api_key.split(':');
    if (parts.length !== 2) {
      reply.code(401).send({ error: 'Invalid api_key format' });
      return;
    }
    
    const [xHex, tokenHex] = parts;
    
    const isValid = await oprfAuth.verifyToken(xHex, tokenHex);
    if (!isValid) {
      reply.code(401).send({ error: 'Invalid OPRF token' });
      return;
    }
    
    request.donor = { id: xHex };
  }
});

// 1. Client requests a magic link
server.post('/v1/auth/request-link', async (request, reply) => {
  const { email, blinded_element } = request.body as any;
  if (!email || !blinded_element) {
    reply.code(400).send({ error: 'Missing email or blinded_element' });
    return;
  }
  
  // Validate email reputation (disposable, MX records, syntax)
  const validationRes = await validate({
    email,
    validateRegex: true,
    validateMx: true,
    validateTypo: true,
    validateDisposable: true,
    validateSMTP: false // Disable SMTP check as many residential ISPs block outbound port 25
  });
  if (!validationRes.valid) {
    server.log.warn(`Email validation failed for ${email}: ${validationRes.reason}`);
    reply.code(400).send({ error: `Invalid email or poor reputation: ${validationRes.reason}` });
    return;
  }
  
  const sessionId = crypto.randomUUID();
  
  await db.insertInto('auth_sessions').values({
    session_id: sessionId,
    email,
    blinded_element,
    status: 'pending'
  }).execute();
  
  const verifyUrl = `http://localhost:3000/v1/auth/verify?session_id=${sessionId}`;
  server.log.info(`MAGIC LINK FOR ${email}: ${verifyUrl}`);
  
  if (emailApi) {
    try {
      const sendSmtpEmail = new brevo.SendSmtpEmail();
      sendSmtpEmail.subject = 'Verify your TemperaturCrowd Integration';
      sendSmtpEmail.htmlContent = `<p>Please click the link below to verify your TemperaturCrowd Home Assistant integration.</p><p><a href="${verifyUrl}">Verify Integration</a></p>`;
      sendSmtpEmail.sender = { name: 'TemperaturCrowd', email: 'noreply@temperaturcrowd.local' };
      sendSmtpEmail.to = [{ email }];
      
      await emailApi.sendTransacEmail(sendSmtpEmail);
    } catch (err) {
      server.log.error(`Failed to send email via Brevo: ${err}`);
    }
  }
  
  reply.send({ session_id: sessionId, status: 'pending' });
});

// 2. User clicks the link in their email
server.get('/v1/auth/verify', async (request, reply) => {
  const { session_id } = request.query as any;
  if (!session_id) {
    reply.code(400).send('Missing session_id');
    return;
  }
  
  const session = await db.selectFrom('auth_sessions')
    .where('session_id', '=', session_id)
    .selectAll()
    .executeTakeFirst();
    
  if (!session) {
    reply.code(404).send('Session not found');
    return;
  }
  
  if (session.status === 'verified') {
    reply.type('text/html').send('<h1>Already Verified!</h1><p>You can close this tab and return to Home Assistant.</p>');
    return;
  }
  
  try {
    const evaluated = await oprfAuth.evaluateBlinded(session.blinded_element);
    
    await db.updateTable('auth_sessions')
      .set({
        status: 'verified',
        evaluated_element: evaluated
      })
      .where('session_id', '=', session_id)
      .execute();
      
    reply.type('text/html').send('<h1>Successfully Verified!</h1><p>You can close this tab and return to Home Assistant. The integration will finish setting up automatically.</p>');
  } catch (err) {
    server.log.error(err);
    reply.code(500).send('Verification failed');
  }
});

// 3. Client polls for completion
server.get('/v1/auth/poll/:session_id', async (request, reply) => {
  const { session_id } = request.params as any;
  const session = await db.selectFrom('auth_sessions')
    .where('session_id', '=', session_id)
    .select(['status', 'evaluated_element'])
    .executeTakeFirst();
    
  if (!session) {
    reply.code(404).send({ error: 'Not found' });
    return;
  }
  
  if (session.status === 'verified') {
    reply.send({ status: 'verified', evaluated_element: session.evaluated_element });
  } else {
    reply.send({ status: 'pending' });
  }
});

server.post('/v1/ingest', {
  schema: {
    body: contractSchema
  }
}, async (request, reply) => {
  const payload = request.body as any;
  const donorId = request.donor?.id;
  
  // Phase 3: Insert into SQLite database (idempotent upsert)
  if (payload.readings && payload.readings.length > 0) {
    const values = payload.readings.map((r: any) => ({
      device_id: payload.device_id,
      donor_id: donorId || 'unknown',
      ts: r.ts,
      temp_c: r.temp_c,
      temp_c_min: r.temp_c_min ?? null,
      temp_c_max: r.temp_c_max ?? null,
      rh_pct: r.rh_pct ?? null,
      room_ref: r.room_ref ?? null,
      postal_code: payload.postal_code ?? null
    }));

    // Perform idempotent upsert (ON CONFLICT DO UPDATE)
    await db.insertInto('readings')
      .values(values)
      .onConflict((oc) => oc
        .columns(['device_id', 'ts'])
        .doUpdateSet({
          temp_c: (eb) => eb.ref('excluded.temp_c'),
          temp_c_min: (eb) => eb.ref('excluded.temp_c_min'),
          temp_c_max: (eb) => eb.ref('excluded.temp_c_max'),
          rh_pct: (eb) => eb.ref('excluded.rh_pct'),
          room_ref: (eb) => eb.ref('excluded.room_ref')
        })
      )
      .execute();
  }
  
  reply.send({ status: 'ok', received_readings: payload.readings.length, donor_id: donorId });
});

const start = async () => {
  try {
    await initDb();
    server.log.info('Database initialized');
    await server.listen({ port: 3000, host: '0.0.0.0' });
    server.log.info(`Server listening on 3000`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
