import { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index';
import { blindRsaAuth } from '../blind_rsa';
import * as crypto from 'crypto';
import { normalizeAndValidatePhone, sendOtpSms, verifyTurnstile, isDeliverableGermanMobile } from './helpers/authHelpers';

const authRoutes: FastifyPluginAsync = async (server) => {
  // These responses reflect live session state (poll/verify), so they must never be cached.
  // The CDN in front of the origin (Bunny) otherwise caches GETs with a long TTL and ignores
  // the query string, which would serve one user's session to everyone.
  server.addHook('onSend', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });

  server.get('/v1/auth/public-key', async (request, reply) => {
    reply.send(blindRsaAuth.getPublicKey());
  });

  server.post('/v1/auth/init', async (request, reply) => {
    const { blinded_element } = request.body as any;
    if (!blinded_element) {
      reply.code(400).send({ error: 'Missing blinded_element' });
      return;
    }
    
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    
    await db.insertInto('auth_sessions').values({
      session_id: sessionId,
      phone_hmac: '',
      otp_code: '',
      blinded_element,
      status: 'pending',
      attempts: 0,
      expires_at: expiresAt
    }).execute();
    
    server.log.info({ session_id: sessionId }, 'Created new auth session');
    
    reply.send({ session_id: sessionId, status: 'pending' });
  });

  // Static setup page. The page reads `session_id` from its own URL and fetches the Turnstile
  // site key from /v1/config, so nothing is templated server-side.
  server.get('/v1/auth/setup', async (request, reply) => {
    return reply.sendFile('setup.html');
  });

  // Public Turnstile site key for the setup page (safe to expose — it is not the secret key).
  server.get('/v1/config', async (request, reply) => {
    reply.send({ turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '1x00000000000000000000AA' });
  });

async function getValidSessionOrReply(session_id: string, reply: any, logger: any) {
  const session = await db.selectFrom('auth_sessions').where('session_id', '=', session_id).selectAll().executeTakeFirst();
  if (!session) {
    logger.warn({ session_id }, 'Session not found during request-otp');
    reply.code(404).send({ error: 'Session not found or verified' });
    return null;
  }
  if (session.status !== 'pending') {
    logger.warn({ session_id, status: session.status }, 'Session is not pending during request-otp');
    reply.code(404).send({ error: 'Session not found or verified' });
    return null;
  }
  return session;
}

  server.post('/v1/auth/request-otp', async (request, reply) => {
    const { session_id, phone_number, 'cf-turnstile-response': turnstileResponse } = request.body as any;
    if (!session_id || !phone_number || !turnstileResponse) {
      reply.code(400).send({ error: 'Missing parameters' });
      return;
    }
    
    if (!(await verifyTurnstile(turnstileResponse))) {
      server.log.warn(`Turnstile validation failed`);
      reply.code(403).send({ error: 'CAPTCHA validation failed' });
      return;
    }
    
    if (!(await getValidSessionOrReply(session_id, reply, server.log))) return;
    
    const normalizedPhone = normalizeAndValidatePhone(phone_number);
    if (!normalizedPhone) {
      reply.code(400).send({ error: 'Only German phone numbers (+49) are supported' });
      return;
    }
    
    const hmacSecret = process.env.PHONE_HMAC_SECRET;
    if (!hmacSecret) {
      reply.code(500).send({ error: 'Configuration error' });
      return;
    }
    
    const phoneHmac = crypto.createHmac('sha256', hmacSecret).update(normalizedPhone).digest('hex');
    const existing = await db.selectFrom('registered_phones').where('phone_hmac', '=', phoneHmac).selectAll().executeTakeFirst();
    if (existing) {
      reply.code(400).send({ error: 'Phone number already registered' });
      return;
    }

    // HLR lookup: reject invalid/unreachable/non-German numbers before paying for an SMS.
    if (!(await isDeliverableGermanMobile(normalizedPhone, server.log))) {
      reply.code(400).send({ error: 'This phone number could not be verified as a reachable German mobile number.' });
      return;
    }

    const otpCode = crypto.randomInt(100000, 1000000).toString();
    await db.updateTable('auth_sessions').set({
      phone_hmac: phoneHmac,
      otp_code: otpCode,
      attempts: 0
    }).where('session_id', '=', session_id).execute();
    
    const smsSent = await sendOtpSms(normalizedPhone, otpCode, server.log);
    if (!smsSent) {
      reply.code(500).send({ error: 'Failed to send SMS' });
      return;
    }
    
    reply.send({ session_id, status: 'pending' });
  });

  server.post('/v1/auth/verify-otp', async (request, reply) => {
    const { session_id, otp_code } = request.body as any;
    if (!session_id || !otp_code) {
      reply.code(400).send({ error: 'Missing session_id or otp_code' });
      return;
    }
    
    const session = await db.selectFrom('auth_sessions').where('session_id', '=', session_id).selectAll().executeTakeFirst();
    if (!session) {
      server.log.warn({ session_id }, 'Verify OTP: Session not found');
      return reply.code(404).send({ error: 'Session not found' });
    }
    if (session.status === 'verified') {
      server.log.warn({ session_id }, 'Verify OTP: Session already verified');
      return reply.code(400).send({ error: 'Session already verified' });
    }
    if (new Date() > new Date(session.expires_at)) {
      server.log.warn({ session_id, expires_at: session.expires_at }, 'Verify OTP: Session expired');
      return reply.code(401).send({ error: 'Session expired' });
    }
    if (session.attempts >= 3) {
      server.log.warn({ session_id, attempts: session.attempts }, 'Verify OTP: Too many attempts');
      return reply.code(429).send({ error: 'Too many attempts.' });
    }
    
    if (session.otp_code !== otp_code) {
      await db.updateTable('auth_sessions').set({ attempts: session.attempts + 1 }).where('session_id', '=', session_id).execute();
      server.log.warn({ session_id, attempts: session.attempts + 1 }, 'Verify OTP: Invalid code');
      reply.code(401).send({ error: 'Invalid OTP code' });
      return;
    }
    
    try {
      const blindSignature = await blindRsaAuth.signBlinded(session.blinded_element);
      const phoneHmac = session.phone_hmac;

      try {
        await db.insertInto('registered_phones').values({ phone_hmac: phoneHmac }).execute();
      } catch {
        return reply.code(400).send({ error: 'Phone already registered' });
      }

      await db.updateTable('auth_sessions')
        .set({ status: 'verified', blind_signature: blindSignature, phone_hmac: '', otp_code: '' })
        .where('session_id', '=', session_id).execute();

      reply.send({ status: 'ok', blind_signature: blindSignature });
    } catch (err) {
      server.log.error(err, 'Verification failed');
      reply.code(500).send({ error: 'Verification failed' });
    }
  });

  server.get('/v1/auth/poll/:session_id', async (request, reply) => {
    const { session_id } = request.params as any;
    const session = await db.selectFrom('auth_sessions').where('session_id', '=', session_id).select(['status', 'blind_signature']).executeTakeFirst();
    if (!session) return reply.code(404).send({ error: 'Not found' });
    if (session.status === 'verified') return reply.send({ status: 'verified', blind_signature: session.blind_signature });
    reply.send({ status: 'pending' });
  });
};

export default authRoutes;
