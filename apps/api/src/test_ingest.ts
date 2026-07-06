import crypto from 'crypto';
import { db, initDb } from './db/index';
import { blindRsaAuth } from './blind_rsa';
import { server } from './index';

async function run() {
  await initDb();
  await blindRsaAuth.init();
  
  // 1. Get the private key to sign a valid token
  const existing = await db.selectFrom('server_secrets').select('key_value').where('key_name', '=', 'rsa_private_key').executeTakeFirst();
  const privateKey = crypto.createPrivateKey(existing!.key_value);

  // 2. Generate random X
  const x = crypto.randomBytes(32);
  const xHex = x.toString('hex');

  // 3. Sign X properly using PSS
  const signature = crypto.sign(
    'sha256',
    x,
    {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32
    }
  );
  const signatureHex = signature.toString('hex');
  const api_key = `${xHex}:${signatureHex}`;

  // 4. Inject POST request to /v1/ingest
  const response = await server.inject({
    method: 'POST',
    url: '/v1/ingest',
    payload: {
      device_id: "test_device_local_1",
      api_key: api_key,
      postal_code: "10115",
      readings: [
        {
          ts: new Date().toISOString(),
          temp_c: 26.5
        }
      ]
    }
  });

  console.log('Status Code:', response.statusCode);
  console.log('Response Body:', response.body);
  
  process.exit(0);
}

run().catch(console.error);
