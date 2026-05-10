#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import admin from 'firebase-admin';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVICE_ACCOUNT_FILE = path.join(__dirname, 'service-account.json');

// Auto-detect service-account.json next to this script if no credentials are set
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(SERVICE_ACCOUNT_FILE)) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = SERVICE_ACCOUNT_FILE;
}

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

const to      = (await ask('Phone number: ')).trim();
const body    = (await ask('Message: ')).trim();
const simSlot = (await ask('SIM slot 0-based (optional, Enter to skip): ')).trim();

const ref = await db.collection('sms_jobs').add({
    to,
    body,
    status: 'queued',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    claimedAt: null,
    claimedBy: null,
    sentAt: null,
    failedAt: null,
    error: null,
    simSlot: simSlot !== '' ? Number(simSlot) : null,
    idempotencyKey: null,
    attemptCount: 0,
});

console.log('Created job', ref.id);
rl.close();
