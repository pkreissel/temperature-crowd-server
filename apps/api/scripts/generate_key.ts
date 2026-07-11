import crypto from 'crypto';

function generateKey() {
  const keys = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });

  const pem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const base64Key = Buffer.from(pem).toString('base64');

  console.log('\n--- NEW RSA PRIVATE KEY GENERATED ---');
  console.log('Copy the following string and add it to your Bunny CDN environment variables');
  console.log(`as RSA_PRIVATE_KEY_B64 (it is a single line string):\n`);
  console.log(base64Key);
  console.log('\n--------------------------------------\n');
}

generateKey();
