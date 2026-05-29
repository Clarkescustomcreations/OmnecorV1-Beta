// server/ommesh/certs/generate-certs.ts
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as crypto from 'crypto';

// ESM compatibility for __dirname
const CERT_DIR = path.join(process.cwd(), 'server/ommesh/certs');
const DAYS = 365 * 2; // 2 years

function run(cmd: string) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: CERT_DIR });
}

function generate() {
  if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });

  console.log('🔐 Generating OMMESH Local CA and Node Certificates...');

  // 1. Root CA
  run(`openssl genrsa -out ca-key.pem 4096`);
  run(`openssl req -x509 -new -nodes -key ca-key.pem -days ${DAYS} -out ca-cert.pem -subj "/C=CA/ST=NovaScotia/L=Halifax/O=Omnecor/CN=OMMESH-Root-CA"`);

  // 2. Node Certificate (signed by CA)
  const hostname = require('os').hostname();
  const nodeId = `omnecor-${crypto.randomUUID().slice(0, 8)}`;

  run(`openssl genrsa -out node-key.pem 4096`);
  run(`openssl req -new -key node-key.pem -out node.csr -subj "/C=CA/ST=NovaScotia/L=Halifax/O=Omnecor/CN=${hostname}/OU=Node/${nodeId}"`);

  run(`openssl x509 -req -in node.csr -CA ca-cert.pem -CAkey ca-key.pem -CAcreateserial -out node-cert.pem -days ${DAYS}`);

  console.log('✅ Certificates generated successfully!');
  console.log(`Node ID: ${nodeId}`);
}

// In ESM we can't easily use require('os'), using import instead
import os from 'os';
const hostname = os.hostname();

// Redefining generate to use proper imports
function generateESM() {
  if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });

  console.log('🔐 Generating OMMESH Local CA and Node Certificates...');

  try {
    // 1. Root CA
    run(`openssl genrsa -out ca-key.pem 4096`);
    run(`openssl req -x509 -new -nodes -key ca-key.pem -days ${DAYS} -out ca-cert.pem -subj "/C=CA/ST=NovaScotia/L=Halifax/O=Omnecor/CN=OMMESH-Root-CA"`);

    // 2. Node Certificate (signed by CA)
    const nodeId = `omnecor-${crypto.randomUUID().slice(0, 8)}`;

    run(`openssl genrsa -out node-key.pem 4096`);
    run(`openssl req -new -key node-key.pem -out node.csr -subj "/C=CA/ST=NovaScotia/L=Halifax/O=Omnecor/CN=${hostname}/OU=${nodeId}"`);

    run(`openssl x509 -req -in node.csr -CA ca-cert.pem -CAkey ca-key.pem -CAcreateserial -out node-cert.pem -days ${DAYS}`);

    console.log('✅ Certificates generated successfully!');
    console.log(`Node ID: ${nodeId}`);
  } catch (err) {
    console.error('❌ Failed to generate certificates. Ensure openssl is installed.', err);
  }
}

generateESM();
