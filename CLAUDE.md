# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SMS Gateway for Android is a Kotlin Android app that turns an Android device into an SMS gateway. It exposes a local HTTP API (via embedded Ktor/Netty server) and optionally connects to a cloud relay server. Messages can be sent/received via REST API, with webhook delivery for events.

## Build Commands

```bash
# Build debug APK
./gradlew assembleDebug

# Build release APK (requires signing env vars: SIGNING_STORE_PASSWORD, SIGNING_KEY_ALIAS, SIGNING_KEY_PASSWORD)
./gradlew assembleRelease

# Build insecure variant (cleartext HTTP allowed, for dev/testing)
./gradlew assembleInsecure

# Run unit tests
./gradlew test

# Run a single test class
./gradlew test --tests "me.capcom.smsgateway.modules.receiver.parsers.MMSParserTest"

# Run instrumented tests (requires connected device/emulator)
./gradlew connectedAndroidTest
```

## Build Variants

- `debug` — standard debug build with strict network security
- `debugInsecure` / `insecure` — cleartext HTTP allowed; **never use in production**
- `release` — production build with minification disabled (proguard configured but `minifyEnabled false`)

## Architecture

The app uses **Koin** for dependency injection. All modules are registered in `App.kt` and wired together. The entry point for starting services is `OrchestratorService.start()`.

### Module Structure

Each functional area lives under `modules/<name>/` with a consistent layout:
- `Module.kt` — Koin DI module definition
- `*Service.kt` — core business logic
- `*Settings.kt` — SharedPreferences-backed settings
- `workers/` — WorkManager workers for background tasks
- `db/` — Room DAO and entity classes
- `vm/` — ViewModels for UI
- `events/` — typed events for the EventBus

### Key Modules

| Module | Purpose |
|--------|---------|
| `messages` | Send SMS/data SMS, track delivery state, scheduling |
| `gateway` | Cloud relay connection (FCM push + SSE + periodic pull) |
| `localserver` | Embedded Ktor HTTP server on port 8080 |
| `webhooks` | Outbound webhook delivery with retry queue |
| `receiver` | Incoming SMS/MMS reception and parsing |
| `incoming` | Storage and viewer for received messages |
| `encryption` | End-to-end encryption of message content |
| `events` | Internal `EventBus` using `MutableSharedFlow` |
| `orchestrator` | Coordinates start/stop of all services |
| `logs` | In-app log storage with truncation |
| `health` | Battery and message failure health checks |
| `ping` | Keepalive foreground service for cloud connectivity |
| `connection` | Cellular/WiFi network type detection |
| `settings` | Export/import of app settings |
| `firebaseagent` | **Experimental** — Firestore-based SMS job queue worker (this fork only) |

### Data Layer

Single Room database (`AppDatabase`, `data/AppDatabase.kt`, version 21). Uses both auto-migrations and manual migrations (see `data/Migrations.kt`). When adding a new DB column/table, increment the version and add an `AutoMigration` entry, or a manual `Migration` object if the auto-migration can't handle it.

### Local HTTP Server

`WebService` (an Android `Service`) runs the Ktor/Netty server. Routes are split into files under `modules/localserver/routes/`. Authentication supports both HTTP Basic and JWT. JWT scopes are defined in `AuthScopes.kt`.

### Cloud Gateway

`GatewayService` connects to the cloud backend. It uses:
- Firebase Cloud Messaging (FCM) for push-triggered message delivery
- Server-Sent Events (`SSEForegroundService`) for real-time commands
- Periodic WorkManager workers (`PullMessagesWorker`, `SendStateWorker`, etc.) as fallback

### EventBus Pattern

Internal events flow through `EventBus` (a `MutableSharedFlow<AppEvent>`). Modules subscribe by calling `events.collect<SpecificEventType> { ... }` in a coroutine scope. Each module's `EventsReceiver` (not the Android `BroadcastReceiver`) manages these subscriptions.

### Settings Pattern

Each module defines a `*Settings` class backed by `SettingsHelper` (which wraps `SharedPreferences`). Settings are read directly—no LiveData wrapper at the settings layer.

## Key Files

- `App.kt` — Koin initialization and app startup
- `modules/orchestrator/OrchestratorService.kt` — coordinates all service lifecycle
- `data/AppDatabase.kt` — Room database with all entities
- `modules/localserver/WebService.kt` — embedded HTTP server implementation
- `modules/messages/MessagesService.kt` — SMS sending logic including SIM selection
- `modules/gateway/GatewayService.kt` — cloud relay client

## Firebase Agent Module (Experimental, fork-only)

`modules/firebaseagent/` adds an alternative queue source: the Android app listens to a Firestore `sms_jobs` collection and sends SMS via `MessagesService.enqueueMessage()`. Companion tooling lives in `firebase-agent/` (Node.js ES module scripts for setup and test message enqueueing).

**Key design points:**
- Uses Firebase anonymous auth; the anonymous UID must be added to `firestore.rules` allowlist (`REPLACE_AGENT_UID`)
- `FirebaseAgentSettings` stores `enabled` flag and a stable `deviceId` (NanoId) in `PreferencesStorage`
- `start()` attaches a Firestore snapshot listener; `stop()` removes it and is called from `OrchestratorService.stop()`
- Job claim is a Firestore transaction that checks `status == "queued"` and `expiresAt` before claiming
- `sms_jobs` documents carry an `expiresAt` TTL field; Firestore auto-deletes them after expiry (configure TTL policy via `setup-firebase.js`)
- Delivery status is propagated back to Firestore via `MessageStateChangedEvent` on the `EventBus` (not inline after `enqueueMessage`)
- `firebase-agent/` scripts require `firebase-admin` and use ES module syntax (`"type": "module"` in package.json)

## Database Migrations

When modifying the schema, add a new version to `AppDatabase` and either:
1. Add `AutoMigration(from = N, to = N+1)` if Room can generate it automatically
2. Create a manual `Migration` object in `data/Migrations.kt` and register it in `getDatabase()`
