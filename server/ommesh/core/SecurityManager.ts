// server/ommesh/core/SecurityManager.ts
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as tls from 'tls';
import { execSync } from 'child_process';
import { MeshMessage, NodeIdentity } from '../../../shared/types/ommesh.types.js';
import { EventEmitter } from 'events';
import os from 'os';
import { createLogger } from "../../_core/logger.js";
const log = createLogger("OMMESH:Security");

// ESM compatibility: using process.cwd() for reliable root-relative paths
const CERTS_DIR = path.join(process.cwd(), 'server/ommesh/certs');
const ROTATION_THRESHOLD_DAYS = 30; // Rotate 30 days before expiry

export class SecurityManager extends EventEmitter {
  private identity!: NodeIdentity;
  private privateKey!: string;
  private cert!: string;
  private caCert!: string;
  private trustedFingerprints: Set<string> = new Set();
  private rotationInProgress = false;

  constructor() {
    super();
    this.initializeIdentityFallback();
    try {
      this.loadOrCreateIdentity();
      this.scheduleAutoRotation();
    } catch (err) {
      console.warn('⚠️  OMMESH Security initialization deferred: Certificates not found.');
    }
  }

  private initializeIdentityFallback() {
    const id = `omnecor-${crypto.randomUUID().slice(0, 8)}`;
    this.identity = {
      id,
      fingerprint: '',
      publicKey: '',
      hostname: os.hostname(),
      version: '1.0.0',
      capabilities: {
        models: [],
        gpu: { vram: 0, utilization: 0, temperature: 0 },
        cpu: 0, ram: 0,
        roles: ['peer']
      },
      lastSeen: new Date()
    };
    log.info("OMMESH identity fallback initialized", { nodeId: this.identity.id });
  }

  private loadOrCreateIdentity() {
    // ESM compatibility: using process.cwd() for reliable root-relative paths
    const certsDir = path.join(process.cwd(), 'server/ommesh/certs');
    const keyPath = path.join(certsDir, 'node-key.pem');
    const certPath = path.join(certsDir, 'node-cert.pem');
    const caPath = path.join(certsDir, 'ca-cert.pem');

    if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
      throw new Error('Missing mTLS certificates');
    }

    this.privateKey = fs.readFileSync(keyPath, 'utf8');
    this.cert = fs.readFileSync(certPath, 'utf8');
    this.caCert = fs.readFileSync(caPath, 'utf8');

    const certObj = new crypto.X509Certificate(this.cert);
    const fingerprint = certObj.fingerprint256.replace(/:/g, '');

    const nodeId = certObj.subject.match(/OU=([^/]+)/)?.[1] || 'unknown';

    this.identity = {
      id: nodeId,
      fingerprint,
      publicKey: certObj.publicKey.export({ type: 'spki', format: 'pem' }) as string,
      hostname: os.hostname(),
      version: '1.0.0',
      capabilities: {
        models: [],
        gpu: { vram: 0, utilization: 0, temperature: 0 },
        cpu: 0,
        ram: 0,
        roles: ['peer']
      },
      lastSeen: new Date()
    };

    log.info("OMMESH Security loaded identity", { nodeId: this.identity.id, fingerprint: fingerprint.slice(0, 16) });
    this.checkExpiration();
  }

  private checkExpiration() {
    if (!this.cert) return;
    const certObj = new crypto.X509Certificate(this.cert);
    const expiryDate = new Date(certObj.validTo);
    const daysUntilExpiry = Math.floor((expiryDate.getTime() - Date.now()) / (1000 * 3600 * 24));

    log.info("Certificate expiry", { daysUntilExpiry, expiryDate: expiryDate.toISOString() });

    if (daysUntilExpiry < ROTATION_THRESHOLD_DAYS) {
      console.warn(`⚠️  Certificate rotation recommended (${daysUntilExpiry} days left)`);
      this.emit('cert-expiring-soon', { daysLeft: daysUntilExpiry, fingerprint: this.identity.fingerprint });
    }
  }

  private scheduleAutoRotation() {
    setInterval(() => this.checkExpiration(), 24 * 60 * 60 * 1000);
  }

  // ==================== CERTIFICATE ROTATION ====================

  async rotateCertificate(force = false): Promise<boolean> {
    if (this.rotationInProgress) {
      console.warn('⚠️  Certificate rotation already in progress');
      return false;
    }

    this.rotationInProgress = true;
    log.info("Starting certificate rotation");

    const oldFingerprint = this.identity.fingerprint;

    try {
      const certsDir = path.join(process.cwd(), 'server/ommesh/certs');
      const backupDir = path.join(certsDir, `backup-${Date.now()}`);
      fs.mkdirSync(backupDir, { recursive: true });

      // Backup current certs
      fs.copyFileSync(path.join(certsDir, 'node-key.pem'), path.join(backupDir, 'node-key.pem'));
      fs.copyFileSync(path.join(certsDir, 'node-cert.pem'), path.join(backupDir, 'node-cert.pem'));

      log.info("Certificates backed up", { backupDir });

      // Generate new key + CSR
      const hostname = os.hostname();
      const nodeId = this.identity.id;

      const opensslCmds = [
        `openssl genrsa -out ${path.join(certsDir, 'node-key.pem.new')} 4096`,
        `openssl req -new -key ${path.join(certsDir, 'node-key.pem.new')} -out ${path.join(certsDir, 'node.csr')} ` +
        `-subj "/C=CA/ST=NovaScotia/L=Halifax/O=Omnecor/CN=${hostname}/OU=${nodeId}"`,
        `openssl x509 -req -in ${path.join(certsDir, 'node.csr')} -CA ${path.join(certsDir, 'ca-cert.pem')} ` +
        `-CAkey ${path.join(certsDir, 'ca-key.pem')} -CAcreateserial -out ${path.join(certsDir, 'node-cert.pem.new')} -days 730`
      ];

      for (const cmd of opensslCmds) {
        execSync(cmd, { stdio: 'inherit', cwd: certsDir });
      }

      // Atomic swap
      fs.renameSync(path.join(certsDir, 'node-key.pem.new'), path.join(certsDir, 'node-key.pem'));
      fs.renameSync(path.join(certsDir, 'node-cert.pem.new'), path.join(certsDir, 'node-cert.pem'));

      // Reload certificates
      this.privateKey = fs.readFileSync(path.join(certsDir, 'node-key.pem'), 'utf8');
      this.cert = fs.readFileSync(path.join(certsDir, 'node-cert.pem'), 'utf8');

      const newCertObj = new crypto.X509Certificate(this.cert);
      const newFingerprint = newCertObj.fingerprint256.replace(/:/g, '');

      // Update identity
      this.identity.fingerprint = newFingerprint;
      this.identity.publicKey = newCertObj.publicKey.export({ type: 'spki', format: 'pem' }) as string;

      log.info("Certificate rotated successfully");
      log.info("Certificate fingerprints", { old: oldFingerprint.slice(0, 16), new: newFingerprint.slice(0, 16) });

      // Emit clean event with proper old/new fingerprints
      this.emit('certificate-rotated', {
        nodeId: this.identity.id,
        oldFingerprint,
        newFingerprint,
        timestamp: Date.now()
      });

      return true;

    } catch (error) {
      console.error('❌ Certificate rotation failed:', error);
      this.emit('rotation-failed', { error, oldFingerprint });
      return false;
    } finally {
      this.rotationInProgress = false;
    }
  }

  // ==================== mTLS TLS Options ====================

  getServerTlsOptions(): tls.TlsOptions {
    return {
      key: this.privateKey,
      cert: this.cert,
      ca: this.caCert,
      requestCert: true,           // Require client certificate
      rejectUnauthorized: true,    // Strict mTLS
      minVersion: 'TLSv1.3',
      ciphers: 'ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384',
    };
  }

  getClientTlsOptions(targetFingerprint?: string): tls.ConnectionOptions {
    const options: tls.ConnectionOptions = {
      key: this.privateKey,
      cert: this.cert,
      ca: this.caCert,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.3',
    };

    if (targetFingerprint) {
      options.checkServerIdentity = (_hostname, cert) => {
        const fp = (cert as any).fingerprint256.replace(/:/g, '');
        if (fp !== targetFingerprint) {
          throw new Error(`mTLS fingerprint mismatch. Expected: ${targetFingerprint}, Got: ${fp}`);
        }
        return undefined;
      };
    }
    return options;
  }

  // ==================== Message Signing / Verification ====================

  signMessage(payload: any): MeshMessage {
    const timestamp = Date.now();
    const messageToSign = JSON.stringify({ payload, timestamp });

    const signature = crypto.sign(
      'RSA-SHA256',
      Buffer.from(messageToSign),
      this.privateKey
    ).toString('base64');

    return {
      type: 'unknown',
      payload,
      signature,
      timestamp,
      nodeId: this.identity.id,
    } as MeshMessage;
  }

  verifyMessage(msg: MeshMessage, peerPublicKey?: string): boolean {
    if (!msg.signature || !msg.timestamp) return false;
    if (Date.now() - msg.timestamp > 300_000) return false; // 5 min replay window

    const messageToVerify = JSON.stringify({ payload: msg.payload, timestamp: msg.timestamp });

    try {
      return crypto.verify(
        'RSA-SHA256',
        Buffer.from(messageToVerify),
        peerPublicKey || '',
        Buffer.from(msg.signature, 'base64')
      );
    } catch {
      return false;
    }
  }

  // ==================== Trust Management ====================

  approvePeer(fingerprint: string): void {
    this.trustedFingerprints.add(fingerprint);
    this.emit('peer-trusted', fingerprint);
  }

  isTrusted(fingerprint: string): boolean {
    return this.trustedFingerprints.has(fingerprint);
  }

  revokePeer(fingerprint: string): void {
    this.trustedFingerprints.delete(fingerprint);
  }

  getIdentity(): NodeIdentity {
    if (!this.identity || !this.identity.id) {
       log.warn("getIdentity called before identity fully initialized, returning current state");
    }
    return { ...this.identity };
  }

  getCaCert(): string {
    return this.caCert;
  }
}

// Singleton
export const securityManager = new SecurityManager();

