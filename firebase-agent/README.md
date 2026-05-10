# Firebase SMS Agent (experimental)
This folder adds an **alternative** worker mode for this fork: Android listens to Firestore `sms_jobs` and sends SMS via the device SIM.

It is separate from the official private SMSGate backend stack.

## Services
- Firebase Authentication (anonymous or email/password)
- Cloud Firestore
- No Cloud Functions required for basic setup

## Setup
1. `cd firebase-agent && npm install`
2. `node setup-firebase.js`
3. Add `google-services.json` to `app/google-services.json`
4. Deploy rules/indexes from this folder.

## Queue schema
Collection `sms_jobs` documents:
- `to`, `body`, `status`, timestamps (`createdAt`, `claimedAt`, `sentAt`, `failedAt`)
- `claimedBy`, `error`, `simSlot`, `idempotencyKey`, `attemptCount`

Optional `devices/{deviceId}` includes `enabled`, `lastSeenAt`, `model`, `appVersion`.

## Security
- Rules are UID allowlist based by default. Replace placeholders.
- Do not commit credentials or service account keys.

## Troubleshooting
- Missing Firebase config: ensure `app/google-services.json` exists.
- Permission issues: ensure app has SEND_SMS.
- Firestore denied: update rules with real UIDs.

## Manual test checklist
1. Create Firebase project and Firestore DB.
2. Add Android app and `google-services.json`.
3. Deploy rules/indexes.
4. Enable Firebase Agent in app settings.
5. Enqueue test job.
6. Verify SMS sent and Firestore status becomes `sent`.
7. Disable SMS permission or use invalid number and verify `failed`.
