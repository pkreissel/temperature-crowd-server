import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const KEY_FILE = path.join(__dirname, '../../server_key.pem');

let publicKey: crypto.KeyObject;
let privateKey: crypto.KeyObject;

if (fs.existsSync(KEY_FILE)) {
  const pem = fs.readFileSync(KEY_FILE, 'utf8');
  privateKey = crypto.createPrivateKey(pem);
  publicKey = crypto.createPublicKey(privateKey);
} else {
  const keys = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  publicKey = keys.publicKey;
  privateKey = keys.privateKey;
  
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  fs.writeFileSync(KEY_FILE, pem);
}

export class BlindRsaAuth {
  constructor() {}

  // Export public key params (n, e) as hex strings
  public getPublicKey(): { n: string; e: string } {
    const jwk = publicKey.export({ format: 'jwk' });
    return {
      n: Buffer.from(jwk.n as string, 'base64url').toString('hex'),
      e: Buffer.from(jwk.e as string, 'base64url').toString('hex')
    };
  }

  // 1. Issuance (Server side): Client sends blinded element, server signs it
  public async signBlinded(blindedElementHex: string): Promise<string> {
    const blindedElement = Buffer.from(blindedElementHex, 'hex');
    
    // In Blind RSA, the server signs the blinded message by raising it to the private exponent (d) mod n.
    // RSA_NO_PADDING applies the raw RSA operation (m^d mod n).
    const signature = crypto.privateDecrypt({
      key: privateKey,
      padding: crypto.constants.RSA_NO_PADDING
    }, blindedElement);
    
    return signature.toString('hex');
  }

  // 2. Verification (Server side): Client sends (x, signature). Server verifies it.
  public async verifyToken(xHex: string, signatureHex: string): Promise<boolean> {
    try {
      const x = Buffer.from(xHex, 'hex');
      const signature = Buffer.from(signatureHex, 'hex');
      
      // The expected unblinded message is SHA256(x)
      const expectedMessage = crypto.createHash('sha256').update(x).digest();
      
      // Reverse the signature using the public key (s^e mod n)
      // Since expectedMessage is 32 bytes and the RSA modulus is 256 bytes, 
      // the actual message recovered via RSA_NO_PADDING will be padded with leading zeros.
      const recoveredMessage = crypto.publicEncrypt({
        key: publicKey,
        padding: crypto.constants.RSA_NO_PADDING
      }, signature);
      
      // Compare the last 32 bytes of the recovered message with the expected hash
      const recoveredHash = recoveredMessage.subarray(recoveredMessage.length - 32);
      
      return crypto.timingSafeEqual(expectedMessage, recoveredHash);
    } catch (e) {
      return false;
    }
  }
}

export const blindRsaAuth = new BlindRsaAuth();
