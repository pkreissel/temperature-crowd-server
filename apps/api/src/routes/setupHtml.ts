export function getSetupHtml(turnstileSiteKey: string, session_id: string): string {
  return `
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
      <input type="text" id="otp" placeholder="123456" pattern="\\d{6}" maxlength="6" required>
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
}
