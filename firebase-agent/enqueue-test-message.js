#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import admin from 'firebase-admin';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVICE_ACCOUNT_FILE = path.join(__dirname, 'service-account.json');

// Parse args: --to/-t, --message/-m, --sim-slot/-s, --help/-h
const args = process.argv.slice(2);
const parsed = {};
for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') {
        console.log('Usage: enqueue-test-message.js [options]');
        console.log('');
        console.log('Options:');
        console.log('  -t, --to <number>       Recipient phone number (required)');
        console.log('  -m, --message <text>    Message body (required)');
        console.log('  -s, --sim-slot <index>  SIM slot, 0-based (optional)');
        console.log('  -T, --ttl <hours>       TTL in hours before Firestore auto-deletes the job (default: 24)');
        console.log('  -h, --help              Show this help');
        process.exit(0);
    } else if ((a === '--to' || a === '-t') && args[i + 1]) {
        parsed.to = args[++i];
    } else if ((a === '--message' || a === '-m') && args[i + 1]) {
        parsed.message = args[++i];
    } else if ((a === '--sim-slot' || a === '-s') && args[i + 1]) {
        parsed.simSlot = args[++i];
    } else if ((a === '--ttl' || a === '-T') && args[i + 1]) {
        parsed.ttl = args[++i];
    }
}

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(SERVICE_ACCOUNT_FILE)) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = SERVICE_ACCOUNT_FILE;
}

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

let rl;
const ask = (q) => {
    if (!rl) rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(r => rl.question(q, r));
};

const to      = parsed.to      ?? (await ask('Phone number: ')).trim();
const body    = parsed.message ?? (await ask('Message: ')).trim();
const simSlot = parsed.simSlot ?? null;
const ttlHours = parsed.ttl ? Number(parsed.ttl) : 24;
const expiresAt = admin.firestore.Timestamp.fromDate(new Date(Date.now() + ttlHours * 3600 * 1000));

if (rl) rl.close();

const ref = await db.collection('sms_jobs').add({
    to,
    body,
    status: 'queued',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
    claimedAt: null,
    claimedBy: null,
    sentAt: null,
    failedAt: null,
    error: null,
    simSlot: simSlot !== null ? Number(simSlot) : null,
    idempotencyKey: null,
    attemptCount: 0,
});

console.log('Created job', ref.id);
