import { Client, SmsResource, LookupResource } from '@seven.io/client';

// Verify a Cloudflare Turnstile token against the siteverify endpoint.
export async function verifyTurnstile(response: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY || '1x0000000000000000000000000000000AA';
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(response)}`
  });
  const data = await res.json();
  return data.success;
}

// Normalize a German mobile number to +49… form; return null if it fails validation.
export function normalizeAndValidatePhone(phone_number: string): string | null {
  const normalizedPhone = phone_number.replace(/\s+/g, '').replace(/^00/, '+');
  if (!/^\+49[1-9]\d{6,14}$/.test(normalizedPhone)) {
    return null;
  }
  return normalizedPhone;
}

// Validate a number via seven.io HLR Lookup *before* spending money on an SMS. This filters
// invalid/inactive/non-German numbers cheaply (a lookup costs a fraction of an SMS) and hardens
// the one-person-per-phone guarantee. The result is used only as a transient gate — it is never
// stored and never linked to the donor pseudonym, so phone/data unlinkability (ADR 0004) holds.
//
// Fails OPEN: if the lookup itself errors or is inconclusive, we allow the number through so a
// provider outage never blocks legitimate donors. Only a *confident* negative rejects.
export async function isDeliverableGermanMobile(normalizedPhone: string, serverLogger: any): Promise<boolean> {
  const sevenApiKey = process.env.SEVEN_API_KEY;
  if (!sevenApiKey) {
    serverLogger.warn('No SEVEN_API_KEY. Skipping HLR lookup (dev mode).');
    return true;
  }
  try {
    const client = new Client({ apiKey: sevenApiKey });
    const lookup = new LookupResource(client);
    const [hlr] = await lookup.hlr({ numbers: [normalizedPhone] });

    // Lookup didn't complete → don't block (fail open).
    if (!hlr || hlr.status !== true) {
      serverLogger.warn('HLR lookup inconclusive; allowing number (fail-open).');
      return true;
    }

    // Confident negatives → reject before we pay for an SMS.
    if (hlr.valid_number === 'not_valid') return false;
    if (['absent', 'bad_number', 'blacklisted', 'undeliverable'].includes(hlr.reachable as string)) return false;
    if (hlr.country_code && hlr.country_code !== 'DE') return false;

    return true;
  } catch (err) {
    serverLogger.error(err, 'HLR lookup failed; allowing number (fail-open).');
    return true;
  }
}

// Send the OTP via seven.io. With no API key configured, log it and treat as sent (dev mode).
export async function sendOtpSms(normalizedPhone: string, otpCode: string, serverLogger: any): Promise<boolean> {
  const sevenApiKey = process.env.SEVEN_API_KEY;
  if (!sevenApiKey) {
    serverLogger.warn(`No SEVEN_API_KEY. OTP is ${otpCode}`);
    return true;
  }
  try {
    const client = new Client({ apiKey: sevenApiKey });
    const sms = new SmsResource(client);
    await sms.dispatch({ to: [normalizedPhone], from: 'TempCrowd', text: `OTP: ${otpCode}` });
    return true;
  } catch (err) {
    serverLogger.error(err, 'Failed to send SMS');
    return false;
  }
}
