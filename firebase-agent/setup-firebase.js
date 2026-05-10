#!/usr/bin/env node
/**
 * Interactive setup script for the Firebase SMS Agent.
 * Run from anywhere — it always operates relative to the firebase-agent/ directory.
 *
 * What it does automatically:
 *   - Checks Firebase CLI is installed and you're logged in
 *   - Lists your projects so you can pick one (or enter an ID)
 *   - Creates firebase.json if missing (fixes "not a Firebase project directory")
 *   - Runs `firebase use` to select the project
 *   - Enables the Cloud Firestore API (via gcloud if available)
 *   - Creates the Firestore database if it doesn't exist yet
 *   - Generates firestore.rules from firestore.rules.template (prompts for UIDs)
 *   - Deploys Firestore rules and indexes
 *   - Registers the Android app if not already registered
 *   - Downloads google-services.json to app/
 *   - Creates a service account for enqueue-test-message.js and saves credentials
 *
 * One step still requires the Firebase Console:
 *   - Enabling Anonymous Authentication
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.chdir(__dirname);

const ANDROID_PACKAGE = 'me.capcom.smsgateway';
const GOOGLE_SERVICES_DEST = path.join(__dirname, '..', 'app', 'google-services.json');
const FIRESTORE_LOCATION_DEFAULT = 'nam5';
const SERVICE_ACCOUNT_NAME = 'sms-gateway-enqueuer';
const SERVICE_ACCOUNT_KEY_FILE = 'service-account.json';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));
const askYN = async (q, def = false) => {
    const hint = def ? 'Y/n' : 'y/N';
    const ans = (await ask(`${q} (${hint}): `)).trim();
    return ans === '' ? def : ans.toLowerCase() === 'y';
};

function step(msg) { console.log(`\n▸ ${msg}`); }
function ok(msg)   { console.log(`  ✓ ${msg}`); }
function warn(msg) { console.log(`  ! ${msg}`); }

function run(cmd, args, opts = {}) {
    console.log(`  $ ${cmd} ${args.join(' ')}`);
    return spawnSync(cmd, args, { stdio: 'inherit', ...opts });
}

function capture(cmd, args) {
    const r = spawnSync(cmd, args, { encoding: 'utf8' });
    return { ok: r.status === 0, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

function parseJsonResult(raw) {
    try {
        const parsed = JSON.parse(raw);
        // Firebase CLI --json wraps output: { status, result } or { status, error }
        if (parsed && typeof parsed === 'object' && 'result' in parsed) return parsed.result;
        return parsed;
    } catch {
        return null;
    }
}

const hasGcloud = capture('gcloud', ['--version']).ok;

// ─── 1. Firebase CLI ──────────────────────────────────────────────────────────
step('Checking Firebase CLI...');
const ver = capture('firebase', ['--version']);
if (!ver.ok) {
    console.error('Firebase CLI not found. Install it with:\n  npm install -g firebase-tools');
    process.exit(1);
}
ok(`Firebase CLI ${ver.stdout}`);

// ─── 2. Login ─────────────────────────────────────────────────────────────────
step('Checking login...');
const loginList = capture('firebase', ['login:list']);
if (!loginList.ok || !loginList.stdout.includes('@')) {
    warn('Not logged in — launching browser login...');
    const loginResult = run('firebase', ['login']);
    if (loginResult.status !== 0) { console.error('Login failed.'); process.exit(1); }
} else {
    ok(loginList.stdout.split('\n')[0].trim());
}

// ─── 3. Project selection ─────────────────────────────────────────────────────
step('Selecting Firebase project...');
const projectsRaw = capture('firebase', ['projects:list', '--json']);
const projects = parseJsonResult(projectsRaw.stdout) || [];
let projectId;

if (Array.isArray(projects) && projects.length > 0) {
    console.log('\n  Available projects:');
    projects.forEach((p, i) =>
        console.log(`    ${String(i + 1).padStart(2)}. ${p.projectId}  (${p.displayName || '—'})`));
    const choice = (await ask('\n  Enter number or project ID: ')).trim();
    const idx = parseInt(choice, 10) - 1;
    projectId = (idx >= 0 && idx < projects.length) ? projects[idx].projectId : choice;
} else {
    projectId = (await ask('  Firebase project ID: ')).trim();
}
if (!projectId) { console.error('No project selected.'); process.exit(1); }
ok(`Selected: ${projectId}`);

// ─── 4. firebase.json ─────────────────────────────────────────────────────────
step('Checking firebase.json...');
if (!fs.existsSync('firebase.json')) {
    fs.writeFileSync('firebase.json', JSON.stringify({
        firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' }
    }, null, 2) + '\n');
    ok('Created firebase.json');
} else {
    ok('firebase.json already exists');
}

// ─── 5. firebase use ──────────────────────────────────────────────────────────
step(`Setting active project to ${projectId}...`);
const useResult = run('firebase', ['use', projectId]);
if (useResult.status !== 0) {
    console.error(`Failed to set project. Check the project ID: ${projectId}`);
    process.exit(1);
}

// ─── 6. Enable Cloud Firestore API ───────────────────────────────────────────
step('Enabling Cloud Firestore API...');
if (hasGcloud) {
    const enableResult = run('gcloud', [
        'services', 'enable', 'firestore.googleapis.com',
        '--project', projectId,
    ]);
    if (enableResult.status !== 0) {
        warn('gcloud could not enable the Firestore API. Enable it manually:');
        warn(`  https://console.developers.google.com/apis/api/firestore.googleapis.com/overview?project=${projectId}`);
        await ask('  Press Enter once the API is enabled...');
    } else {
        ok('Cloud Firestore API enabled');
    }
} else {
    warn('gcloud not found — please enable the Firestore API in your browser:');
    warn(`  https://console.developers.google.com/apis/api/firestore.googleapis.com/overview?project=${projectId}`);
    await ask('  Press Enter once the API is enabled...');
}

// ─── 7. Firestore database ───────────────────────────────────────────────────
step('Checking Firestore database...');
const dbList = capture('firebase', ['firestore:databases:list', '--json']);
const dbs = parseJsonResult(dbList.stdout);
const hasDefault = Array.isArray(dbs)
    ? dbs.some(d => d.name?.endsWith('(default)'))
    : dbList.stdout.includes('(default)');

if (hasDefault) {
    ok('Default Firestore database already exists');
} else {
    warn('No default Firestore database found.');
    const locs = FIRESTORE_LOCATION_DEFAULT;
    const location = (await ask(`  Firestore location [${locs}]: `)).trim() || locs;
    console.log(`  Creating Firestore database in ${location}...`);
    const createDb = run('firebase', ['firestore:databases:create', '--location', location]);
    if (createDb.status !== 0) {
        warn('Could not create database automatically. Create it manually in the Firebase Console:');
        warn('  Firestore Database → Create database → Production mode');
    } else {
        ok('Firestore database created');
    }
}

// ─── 8. Firestore rules from template ────────────────────────────────────────
step('Generating firestore.rules from template...');
const templatePath = 'firestore.rules.template';
const rulesPath = 'firestore.rules';

if (!fs.existsSync(templatePath)) {
    warn(`${templatePath} not found — skipping rules generation.`);
} else {
    let template = fs.readFileSync(templatePath, 'utf8');

    // Read existing rules to pre-fill known UIDs
    const existing = fs.existsSync(rulesPath) ? fs.readFileSync(rulesPath, 'utf8') : '';
    const existingAgentMatch  = existing.match(/function isAgent\(\)[^[]+\["([^"]+)"\]/);
    const existingProducerMatch = existing.match(/function isProducer\(\)[^[]+\["([^"]+)"\]/);

    const currentAgentUid    = existingAgentMatch?.[1]  !== 'REPLACE_AGENT_UID'    ? existingAgentMatch?.[1]    : '';
    const currentProducerUid = existingProducerMatch?.[1] !== 'REPLACE_PRODUCER_UID' ? existingProducerMatch?.[1] : '';

    console.log('  The agent UID is the Firebase UID shown in the app under Settings → Firebase Agent.');
    const agentUid = (await ask(
        `  Agent UID${currentAgentUid ? ` [${currentAgentUid}]` : ''}: `
    )).trim() || currentAgentUid;

    console.log('  The producer UID is for clients that create SMS jobs via the Firebase SDK (not the Admin SDK).');
    console.log('  Leave blank to skip (the Admin SDK used by enqueue-test-message.js bypasses this rule).');
    const producerUid = (await ask(
        `  Producer UID${currentProducerUid ? ` [${currentProducerUid}]` : ' (optional)'}: `
    )).trim() || currentProducerUid || 'REPLACE_PRODUCER_UID';

    if (!agentUid) {
        warn('No agent UID provided — rules will be deployed with placeholder. Re-run after getting the UID from the app.');
    }

    const rules = template
        .replace('REPLACE_AGENT_UID', agentUid || 'REPLACE_AGENT_UID')
        .replace('REPLACE_PRODUCER_UID', producerUid);

    fs.writeFileSync(rulesPath, rules);
    ok(`Written to ${rulesPath}`);
}

// ─── 9. Deploy rules & indexes ───────────────────────────────────────────────
step('Deploying Firestore rules and indexes...');
const deployResult = run('firebase', ['deploy', '--only', 'firestore:rules,firestore:indexes']);
if (deployResult.status !== 0) {
    warn('Deployment failed — rules and indexes will need to be deployed manually:');
    warn('  firebase deploy --only firestore:rules,firestore:indexes');
} else {
    ok('Rules and indexes deployed');
}

// ─── 10. Android app ─────────────────────────────────────────────────────────
step('Checking Android app registration...');
const appsRaw = capture('firebase', ['apps:list', 'ANDROID', '--json']);
const apps = parseJsonResult(appsRaw.stdout) || [];
let appId = Array.isArray(apps)
    ? apps.find(a => a.packageName === ANDROID_PACKAGE)?.appId
    : null;

if (appId) {
    ok(`Found Android app: ${appId}`);
} else {
    warn(`No Android app with package '${ANDROID_PACKAGE}' found.`);
    const create = await askYN('  Register it now?', true);
    if (create) {
        const createResult = run('firebase', [
            'apps:create', 'ANDROID',
            '--package-name', ANDROID_PACKAGE,
        ]);
        if (createResult.status === 0) {
            const appsRaw2 = capture('firebase', ['apps:list', 'ANDROID', '--json']);
            const apps2 = parseJsonResult(appsRaw2.stdout) || [];
            appId = Array.isArray(apps2)
                ? apps2.find(a => a.packageName === ANDROID_PACKAGE)?.appId
                : null;
            if (appId) ok(`Registered: ${appId}`);
            else warn('App registered but could not retrieve app ID — download google-services.json manually.');
        } else {
            warn('App registration failed — register it in the Firebase Console and re-run this script.');
        }
    }
}

// ─── 11. google-services.json ────────────────────────────────────────────────
if (appId) {
    step('Downloading google-services.json...');
    const configRaw = capture('firebase', ['apps:sdkconfig', 'ANDROID', appId]);
    const jsonStart = configRaw.stdout.indexOf('{');
    if (configRaw.ok && jsonStart >= 0) {
        const json = configRaw.stdout.slice(jsonStart);
        try {
            JSON.parse(json);
            fs.writeFileSync(GOOGLE_SERVICES_DEST, json + '\n');
            ok(`Saved to ${GOOGLE_SERVICES_DEST}`);
        } catch {
            warn('Downloaded config was not valid JSON — download google-services.json manually from the Firebase Console.');
        }
    } else {
        warn('Could not download config — download google-services.json manually from the Firebase Console.');
    }
} else if (fs.existsSync(GOOGLE_SERVICES_DEST)) {
    ok(`google-services.json already present at ${GOOGLE_SERVICES_DEST}`);
} else {
    warn(`google-services.json missing — download it from the Firebase Console and place it at:\n  ${GOOGLE_SERVICES_DEST}`);
}

// ─── 12. Service account for enqueue script ───────────────────────────────────
step('Setting up service account for enqueue-test-message.js...');
if (fs.existsSync(SERVICE_ACCOUNT_KEY_FILE)) {
    ok(`${SERVICE_ACCOUNT_KEY_FILE} already exists — skipping.`);
} else if (hasGcloud) {
    const saEmail = `${SERVICE_ACCOUNT_NAME}@${projectId}.iam.gserviceaccount.com`;

    // Create service account (ignore error if it already exists)
    const saList = capture('gcloud', ['iam', 'service-accounts', 'list',
        '--project', projectId, '--format=value(email)', '--filter', `email:${saEmail}`]);
    const saExists = saList.stdout.includes(saEmail);

    if (!saExists) {
        const createSa = run('gcloud', ['iam', 'service-accounts', 'create', SERVICE_ACCOUNT_NAME,
            '--display-name', 'SMS Gateway Enqueuer',
            '--project', projectId,
        ]);
        if (createSa.status !== 0) {
            warn('Could not create service account — see above for details.');
        }
    } else {
        ok(`Service account ${saEmail} already exists`);
    }

    // Grant Cloud Datastore User role (covers Firestore read/write)
    run('gcloud', ['projects', 'add-iam-policy-binding', projectId,
        '--member', `serviceAccount:${saEmail}`,
        '--role', 'roles/datastore.user',
        '--condition=None',
    ]);

    // Create and download key
    const keyResult = run('gcloud', ['iam', 'service-accounts', 'keys', 'create',
        SERVICE_ACCOUNT_KEY_FILE,
        '--iam-account', saEmail,
        '--project', projectId,
    ]);
    if (keyResult.status === 0) {
        ok(`Saved credentials to ${SERVICE_ACCOUNT_KEY_FILE} (gitignored)`);
    } else {
        warn(`Could not create key — create it manually in the Firebase Console and save as ${SERVICE_ACCOUNT_KEY_FILE}`);
    }
} else {
    warn('gcloud not found — create a service account manually:');
    warn(`  https://console.firebase.google.com/project/${projectId}/settings/serviceaccounts/adminsdk`);
    warn(`  Download the key JSON and save it as firebase-agent/${SERVICE_ACCOUNT_KEY_FILE}`);
    await ask('  Press Enter to continue...');
}

// ─── Done ─────────────────────────────────────────────────────────────────────
const needsUid = !fs.existsSync(rulesPath) ||
    fs.readFileSync(rulesPath, 'utf8').includes('REPLACE_AGENT_UID');

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Remaining steps:

  1. Firebase Console: Authentication → Sign-in method → Enable Anonymous
  2. Build and install the app, start services, open Settings → Firebase Agent.${needsUid ? `
  3. Copy the Firebase UID and re-run this script to deploy rules with your UID.` : `
  3. Rules are deployed with your agent UID. ✓`}

To send a test message:
  GOOGLE_APPLICATION_CREDENTIALS=${SERVICE_ACCOUNT_KEY_FILE} node enqueue-test-message.js
  (or just: node enqueue-test-message.js — it auto-detects ${SERVICE_ACCOUNT_KEY_FILE})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

rl.close();
