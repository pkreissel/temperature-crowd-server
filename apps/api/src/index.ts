import fastify from 'fastify';
import { Client } from '@seven.io/client';
import { db, initDb } from './db/index';
import { blindRsaAuth } from './blind_rsa';
import contractSchema from '@temperaturcrowd/contract/schema.json';
import * as crypto from 'crypto';
import { runRecomputeJob } from './jobs/recompute';

export const server = fastify({ logger: true });

// Custom auth middleware for OPRF
server.decorateRequest('donor', null);

server.addHook('preHandler', async (request, reply) => {
  if (request.routerPath === '/v1/ingest' || request.routerPath === '/v1/donor') {
    let payloadApiKey = (request.body as any)?.api_key;
    
    const authHeader = request.headers.authorization;
    if (!payloadApiKey && authHeader && authHeader.startsWith('Bearer ')) {
      payloadApiKey = authHeader.substring(7);
    }

    if (!payloadApiKey || typeof payloadApiKey !== 'string') {
      reply.code(401).send({ error: 'Missing or invalid api_key' });
      return;
    }
    
    // api_key format expected: "X_hex:OPRF_hex"
    const parts = payloadApiKey.split(':');
    if (parts.length !== 2) {
      reply.code(401).send({ error: 'Invalid api_key format' });
      return;
    }
    
    const [xHex, tokenHex] = parts;
    
    const isValid = await blindRsaAuth.verifyToken(xHex, tokenHex);
    if (!isValid) {
      reply.code(401).send({ error: 'Invalid auth token' });
      return;
    }
    
    request.donor = { id: xHex };
  }
});

server.get('/v1/auth/public-key', async (request, reply) => {
  reply.send(blindRsaAuth.getPublicKey());
});

// 1. HA calls init to register the blinded element and get a session ID
server.post('/v1/auth/init', async (request, reply) => {
  const { blinded_element } = request.body as any;
  if (!blinded_element) {
    reply.code(400).send({ error: 'Missing blinded_element' });
    return;
  }
  
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes from now
  
  await db.insertInto('auth_sessions').values({
    session_id: sessionId,
    phone_number: '',
    otp_code: '',
    blinded_element,
    status: 'pending',
    attempts: 0,
    expires_at: expiresAt
  }).execute();
  
  reply.send({ session_id: sessionId, status: 'pending' });
});

// 2. Serve the beautiful HTML Web UI
server.get('/v1/auth/setup', async (request, reply) => {
  const { session_id } = request.query as any;
  if (!session_id || typeof session_id !== 'string') {
    reply.code(400).send('Missing session_id');
    return;
  }

  // Validate session_id is a UUID to prevent XSS
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(session_id)) {
    reply.code(400).send('Invalid session_id format');
    return;
  }
  
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY || '1x00000000000000000000AA'; // testing key
  
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TemperaturCrowd Verification</title>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
    .card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); max-width: 400px; width: 100%; text-align: center; }
    h1 { color: #111827; font-size: 1.5rem; margin-bottom: 0.5rem; }
    p { color: #6b7280; font-size: 0.875rem; margin-bottom: 1.5rem; }
    input { width: 100%; padding: 0.75rem; margin-bottom: 1rem; border: 1px solid #d1d5db; border-radius: 6px; box-sizing: border-box; font-size: 1rem; }
    button { width: 100%; background-color: #2563eb; color: white; border: none; padding: 0.75rem; border-radius: 6px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: background-color 0.2s; }
    button:hover { background-color: #1d4ed8; }
    .hidden { display: none; }
    .error { color: #ef4444; font-size: 0.875rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="card" id="step1">
    <h1>Verify your Phone</h1>
    <p>Enter your German mobile number to receive a verification code. This ensures only real people participate.</p>
    <div id="error1" class="error hidden"></div>
    <form id="phoneForm">
      <input type="tel" id="phone" placeholder="+49 151 12345678" required>
      <div class="cf-turnstile" data-sitekey="${turnstileSiteKey}" data-theme="light" style="margin-bottom: 1rem;"></div>
      <button type="submit" id="sendBtn">Send SMS Code</button>
    </form>
  </div>

  <div class="card hidden" id="step2">
    <h1>Enter Code</h1>
    <p>We sent a 6-digit code to your phone. Enter it below.</p>
    <div id="error2" class="error hidden"></div>
    <form id="otpForm">
      <input type="text" id="otp" placeholder="123456" pattern="\d{6}" maxlength="6" required>
      <button type="submit" id="verifyBtn">Verify</button>
    </form>
  </div>

  <div class="card hidden" id="step3">
    <h1>Verification Successful! 🎉</h1>
    <p>You can now safely close this window and return to Home Assistant to complete the setup.</p>
  </div>

  <script>
    const sessionId = "${session_id}";
    const phoneForm = document.getElementById('phoneForm');
    const otpForm = document.getElementById('otpForm');
    const step1 = document.getElementById('step1');
    const step2 = document.getElementById('step2');
    const step3 = document.getElementById('step3');
    const error1 = document.getElementById('error1');
    const error2 = document.getElementById('error2');
    const sendBtn = document.getElementById('sendBtn');
    
    phoneForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const phone = document.getElementById('phone').value;
      const turnstileResponse = document.querySelector('[name="cf-turnstile-response"]').value;
      
      if (!turnstileResponse) {
        error1.textContent = 'Please complete the CAPTCHA.';
        error1.classList.remove('hidden');
        return;
      }
      
      sendBtn.disabled = true;
      sendBtn.textContent = 'Sending...';
      error1.classList.add('hidden');
      
      try {
        const res = await fetch('/v1/auth/request-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId, phone_number: phone, 'cf-turnstile-response': turnstileResponse })
        });
        const data = await res.json();
        
        if (res.ok) {
          step1.classList.add('hidden');
          step2.classList.remove('hidden');
        } else {
          error1.textContent = data.error || 'Failed to send SMS.';
          error1.classList.remove('hidden');
          turnstile.reset();
        }
      } catch (err) {
        error1.textContent = 'Network error.';
        error1.classList.remove('hidden');
      } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send SMS Code';
      }
    });

    otpForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const otp = document.getElementById('otp').value;
      const verifyBtn = document.getElementById('verifyBtn');
      
      verifyBtn.disabled = true;
      verifyBtn.textContent = 'Verifying...';
      error2.classList.add('hidden');
      
      try {
        const res = await fetch('/v1/auth/verify-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId, otp_code: otp })
        });
        const data = await res.json();
        
        if (res.ok) {
          step2.classList.add('hidden');
          step3.classList.remove('hidden');
        } else {
          error2.textContent = data.error || 'Invalid code.';
          error2.classList.remove('hidden');
        }
      } catch (err) {
        error2.textContent = 'Network error.';
        error2.classList.remove('hidden');
      } finally {
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'Verify';
      }
    });
  </script>
</body>
</html>
  `;
  reply.type('text/html').send(html);
});

// 3. Webpage requests SMS OTP
server.post('/v1/auth/request-otp', async (request, reply) => {
  const { session_id, phone_number, 'cf-turnstile-response': turnstileResponse } = request.body as any;
  if (!session_id || !phone_number || !turnstileResponse) {
    reply.code(400).send({ error: 'Missing session_id, phone_number, or cf-turnstile-response' });
    return;
  }
  
  // Verify Turnstile
  const turnstileSecret = process.env.TURNSTILE_SECRET_KEY || '1x0000000000000000000000000000000AA'; // testing key
  const turnstileRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `secret=${encodeURIComponent(turnstileSecret)}&response=${encodeURIComponent(turnstileResponse)}`
  });
  const turnstileData = await turnstileRes.json();
  if (!turnstileData.success) {
    server.log.warn(`Turnstile validation failed: ${JSON.stringify(turnstileData.error_codes)}`);
    reply.code(403).send({ error: 'CAPTCHA validation failed' });
    return;
  }
  
  const session = await db.selectFrom('auth_sessions').where('session_id', '=', session_id).selectAll().executeTakeFirst();
  if (!session || session.status !== 'pending') {
    reply.code(404).send({ error: 'Session not found or already verified' });
    return;
  }
  
  // Validate German phone number
  const normalizedPhone = phone_number.replace(/\s+/g, '').replace(/^00/, '+');
  if (!/^\+49[1-9]\d{6,14}$/.test(normalizedPhone)) {
    reply.code(400).send({ error: 'Only German phone numbers (+49) are supported' });
    return;
  }
  
  // Check for duplicate account using HMAC
  const hmacSecret = process.env.PHONE_HMAC_SECRET;
  if (!hmacSecret) {
    server.log.error('PHONE_HMAC_SECRET is not configured');
    reply.code(500).send({ error: 'Internal server configuration error' });
    return;
  }
  
  const phoneHmac = crypto.createHmac('sha256', hmacSecret).update(normalizedPhone).digest('hex');
  const existing = await db.selectFrom('registered_phones').where('phone_hmac', '=', phoneHmac).selectAll().executeTakeFirst();
  if (existing) {
    reply.code(400).send({ error: 'This phone number has already been registered' });
    return;
  }
  
  // Generate cryptographically secure 6-digit OTP
  const otpCode = crypto.randomInt(100000, 1000000).toString();
  
  await db.updateTable('auth_sessions').set({
    phone_number: normalizedPhone,
    otp_code: otpCode,
    attempts: 0
  }).where('session_id', '=', session_id).execute();
  
  const sevenApiKey = process.env.SEVEN_API_KEY;
  if (sevenApiKey) {
    try {
      const client = new Client({ apiKey: sevenApiKey });
      await client.sms({
        to: normalizedPhone,
        from: 'TempCrowd',
        text: `Dein Verifizierungscode für TemperaturCrowd lautet: ${otpCode}`
      });
      server.log.info('Sent SMS OTP to provided phone number');
    } catch (err) {
      server.log.error(`Failed to send SMS via Seven.io: ${err}`);
      reply.code(500).send({ error: 'Failed to send SMS' });
      return;
    }
  } else {
    server.log.warn(`SEVEN_API_KEY not configured. Mocking SMS send for provided phone number with OTP ${otpCode}`);
  }
  
  reply.send({ session_id: session_id, status: 'pending' });
});

// 2. Client verifies the OTP
server.post('/v1/auth/verify-otp', async (request, reply) => {
  const { session_id, otp_code } = request.body as any;
  if (!session_id || !otp_code) {
    reply.code(400).send({ error: 'Missing session_id or otp_code' });
    return;
  }
  
  const session = await db.selectFrom('auth_sessions')
    .where('session_id', '=', session_id)
    .selectAll()
    .executeTakeFirst();
    
  if (!session) {
    reply.code(404).send({ error: 'Session not found' });
    return;
  }
  
  if (session.status === 'verified') {
    reply.code(400).send({ error: 'Session already verified' });
    return;
  }
  
  if (new Date() > new Date(session.expires_at)) {
    reply.code(401).send({ error: 'Session expired' });
    return;
  }

  if (session.attempts >= 3) {
    reply.code(429).send({ error: 'Too many failed attempts. Please request a new code.' });
    return;
  }
  
  if (session.otp_code !== otp_code) {
    await db.updateTable('auth_sessions')
      .set({ attempts: session.attempts + 1 })
      .where('session_id', '=', session_id)
      .execute();
    reply.code(401).send({ error: 'Invalid OTP code' });
    return;
  }
  
  try {
    const evaluated = await blindRsaAuth.signBlinded(session.blinded_element);
    
    // Compute HMAC again to insert into registered_phones
    const hmacSecret = process.env.PHONE_HMAC_SECRET!;
    const phoneHmac = crypto.createHmac('sha256', hmacSecret).update(session.phone_number).digest('hex');
    
    try {
      await db.insertInto('registered_phones').values({ phone_hmac: phoneHmac }).execute();
    } catch (dbErr: any) {
      if (dbErr.code === 'SQLITE_CONSTRAINT' || dbErr.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || String(dbErr).includes('UNIQUE')) {
        reply.code(400).send({ error: 'This phone number has already been registered' });
        return;
      }
      throw dbErr;
    }
    
    await db.updateTable('auth_sessions')
      .set({
        status: 'verified',
        evaluated_element: evaluated,
        phone_number: '', // Scrub plaintext phone number immediately
        otp_code: ''
      })
      .where('session_id', '=', session_id)
      .execute();
      
    reply.send({ status: 'ok', evaluated_element: evaluated });
  } catch (err) {
    server.log.error(err);
    reply.code(500).send({ error: 'Verification failed' });
  }
});

// 5. HA Polls for completion
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
  
  // Phase 3.5: Upsert donor metadata if provided
  if (payload.building_age || payload.floor_level || payload.orientation || payload.insulation_status) {
    const { sql } = require('kysely');
    await db.insertInto('donor_metadata')
      .values({
        donor_id: donorId || 'unknown',
        building_age: payload.building_age ?? null,
        floor_level: payload.floor_level ?? null,
        orientation: payload.orientation ?? null,
        insulation_status: payload.insulation_status ?? null
      })
      .onConflict((oc) => oc
        .column('donor_id')
        .doUpdateSet({
          building_age: (eb) => eb.ref('excluded.building_age'),
          floor_level: (eb) => eb.ref('excluded.floor_level'),
          orientation: (eb) => eb.ref('excluded.orientation'),
          insulation_status: (eb) => eb.ref('excluded.insulation_status'),
          updated_at: sql`CURRENT_TIMESTAMP`
        })
      )
      .execute();
  }
  
  reply.send({ status: 'ok', received_readings: payload.readings?.length || 0, donor_id: donorId });
});

server.delete('/v1/donor', async (request, reply) => {
  const donorId = request.donor?.id;
  if (!donorId) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }
  
  try {
    const deletedReadings = await db.deleteFrom('readings').where('donor_id', '=', donorId).executeTakeFirst();
    const deletedMetrics = await db.deleteFrom('tier1_room_metrics').where('donor_id', '=', donorId).executeTakeFirst();
    const deletedMetadata = await db.deleteFrom('donor_metadata').where('donor_id', '=', donorId).executeTakeFirst();
    
    reply.send({ 
      status: 'ok', 
      message: 'Donor data deleted successfully',
      deleted_readings: Number(deletedReadings.numDeletedRows),
      deleted_metrics: Number(deletedMetrics.numDeletedRows),
      deleted_metadata: Number(deletedMetadata.numDeletedRows)
    });
  } catch (err) {
    server.log.error(err);
    reply.code(500).send({ error: 'Failed to delete donor data' });
  }
});

export const start = async () => {
  try {
    await initDb();
    server.log.info('Database initialized');
    await server.listen({ port: 3000, host: '0.0.0.0' });
    server.log.info('Server listening on 3000');
    
    // Start hourly recompute job
    setInterval(() => {
      runRecomputeJob().catch(err => server.log.error(`Recompute job failed: ${err}`));
    }, 60 * 60 * 1000);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

// Only run automatically if this file is the main entry point
if (require.main === module || process.argv[1]?.includes('src/index.ts')) {
  start();
}
