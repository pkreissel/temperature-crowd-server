import { Client, SmsResource } from '@seven.io/client';

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
