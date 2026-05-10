# AGENTS.md

This file provides context for AI agents working in this repository. See CLAUDE.md for full architecture details.

## Quick Reference

- **Language**: Kotlin, Android (minSdk 21, targetSdk 33)
- **DI**: Koin 3.4
- **HTTP server**: Ktor 2.2.4 + Netty (embedded in app, port 8080)
- **HTTP client**: Ktor client + OkHttp
- **DB**: Room 2.4.3 (single database `gateway`, version 21)
- **Background work**: WorkManager
- **Push**: Firebase Cloud Messaging + Firestore (experimental agent mode)
- **Build**: Gradle (Groovy DSL), `app/build.gradle`
- **firebase-agent/**: Node.js ES module tooling (requires `firebase-admin`, run with `node setup-firebase.js`)

## Project Notes

- The app has no backend server code in this repo — it only contains the Android client
- Cloud backend URL is configurable; the default points to sms-gate.app
- This is a fork; upstream is github.com/capcom6/android-sms-gateway
