// server/ommesh/certs/generate-certs.ts
import * as fs from 'fs';
import { execSync } from 'child_process';
import * as crypto from 'crypto';
import os from 'os';
import { createLogger } from "../../_core/logger.js";
import { PATHS } from "../../_core/paths.js";

const log = createLogger("OMMESH:Certs");

const CERT_DIR = PATHS.certs;
const DAYS = 365 * 2; // 2 years
const hostname = os.hostname();

function run(cmd: string) {
  log.debug("exec", { cmd });
  execSync(cmd, { stdio: 'inherit', cwd: CERT_DIR });
}

function generateESM() {
  if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });

  log.info("Generating OMMESH CA and node certificates");

  try {
    // 1. Root CA
    run(`openssl genrsa -out ca-key.pem 4096`);
    run(`openssl req -x509 -new -nodes -key ca-key.pem -days ${DAYS} -out ca-cert.pem -subj "/C=CA/ST=NovaScotia/L=Halifax/O=Omnecor/CN=OMMESH-Root-CA"`);

    // 2. Node Certificate (signed by CA)
    const nodeId = `omnecor-${crypto.randomUUID().slice(0, 8)}`;

    run(`openssl genrsa -out node-key.pem 4096`);
    run(`openssl req -new -key node-key.pem -out node.csr -subj "/C=CA/ST=NovaScotia/L=Halifax/O=Omnecor/CN=${hostname}/OU=${nodeId}"`);

    run(`openssl x509 -req -in node.csr -CA ca-cert.pem -CAkey ca-key.pem -CAcreateserial -out node-cert.pem -days ${DAYS}`);

    log.info("Certificates generated successfully");
    log.info("Certificate info", { nodeId });
  } catch (err) {
    console.error('❌ Failed to generate certificates. Ensure openssl is installed.', err);
  }
}

generateESM();
