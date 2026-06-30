import { Oprf, OPRFServer, OPRFClient, EvaluationRequest } from '@cloudflare/voprf-ts';
import crypto from 'crypto';

// In a real application, this should be a persistent, securely stored key.
const SERVER_SECRET_KEY = crypto.randomBytes(32); 

export class OprfAuth {
  private server: OPRFServer;

  constructor() {
    // Setup OPRFServer (using OPRF mode, not VOPRF, as we don't need public verifiability)
    this.server = new OPRFServer(Oprf.Suite.P256_SHA256, SERVER_SECRET_KEY);
  }

  // 1. Issuance (Server side): Client sends blinded element, server evaluates it
  public async evaluateBlinded(blindedElementHex: string): Promise<string> {
    const blindedElement = Uint8Array.from(Buffer.from(blindedElementHex, 'hex'));
    const evalReq = EvaluationRequest.deserialize(Oprf.Suite.P256_SHA256, blindedElement);
    const evaluated = await this.server.blindEvaluate(evalReq);
    return Buffer.from(evaluated.serialize()).toString('hex');
  }

  // 2. Verification (Server side): Client sends (x, token). Server verifies it.
  public async verifyToken(xHex: string, tokenHex: string): Promise<boolean> {
    try {
      const x = Uint8Array.from(Buffer.from(xHex, 'hex'));
      const token = Uint8Array.from(Buffer.from(tokenHex, 'hex'));
      
      // To verify, the server can act as a client internally to generate the expected token
      const client = new OPRFClient(Oprf.Suite.P256_SHA256);
      
      const [finalizeData, evalReq] = await client.blind([x]);
      const evaluated = await this.server.blindEvaluate(evalReq);
      const unblinded = await client.finalize(finalizeData, evaluated);
      
      const expectedToken = unblinded[0];
      
      // Constant-time comparison
      return crypto.timingSafeEqual(Buffer.from(expectedToken), Buffer.from(token));
    } catch (e) {
      return false;
    }
  }
}

export const oprfAuth = new OprfAuth();
