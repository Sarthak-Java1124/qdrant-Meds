# Aftercare

**What the doctor said, remembered, on your phone.**

Aftercare is an offline-first, privacy-first medical memory for patients and their families. It records a doctor visit, breaks it into sentences, understands each sentence with an AI model that runs on the phone, and stores everything in a **Qdrant Edge** vector database embedded inside the app. From that memory it keeps a running medicine list, catches dangerous drug combinations prescribed by *different* doctors, and answers plain-language questions such as *"What is the blue tablet?"*. It needs no network and no cloud account.

The only data that ever leaves the device is the medicine list and alerts, which are shared with a family member. That data first passes an on-device Leak Check and is logged in a hash-chained, auditable receipt ledger.

> **Status:** hackathon prototype. Speech-to-text, the family member's device and the drug-interaction table are simulated. The on-device model, the Qdrant Edge memory and hybrid search, the medicine reconciliation and the alerts are real. See [Limitations](#limitations).

---

## Table of contents

1. [The problem](#the-problem)
2. [Features](#features)
3. [Architecture](#architecture)
4. [How Qdrant Edge is used](#how-qdrant-edge-is-used)
5. [Repository layout](#repository-layout)
6. [Tech stack](#tech-stack)
7. [Getting started](#getting-started)
8. [Configuration](#configuration)
9. [Server API](#server-api)
10. [Verification and tests](#verification-and-tests)
11. [Privacy and security model](#privacy-and-security-model)
12. [Limitations](#limitations)
13. [Project history](#project-history)
14. [References](#references)

---

## The problem

- Patients forget **40–80%** of what a doctor tells them almost immediately, and nearly half of what they do remember is wrong (Kessels, 2003).
- Older patients often see several specialists: a cardiologist, an orthopaedist, a diabetologist. **None of them sees what the others prescribed.**
- Medication errors cost an estimated **US$42 billion a year** worldwide (WHO, *Medication Without Harm*, 2017).
- A doctor visit is among the most private data a person has, and clinics often have poor connectivity. Neither fits a cloud-first assistant.

Aftercare runs the AI and the memory entirely on the phone, so it works in airplane mode and the recordings never leave the device.

## Features

| Feature | What it does |
| --- | --- |
| **Record a visit** | Pick the doctor, enter the reason, record. The transcript is split into speaker-tagged sentences (`Doctor:` / `Patient:`). |
| **On-device understanding** | Each sentence is embedded with MiniLM (ONNX Runtime) and classified by similarity to exemplar sentences as *medicine, diet, test, follow-up, warning, lifestyle* or *finding*. |
| **Prescription extraction** | Drug (including Indian brand aliases, e.g. *Dolo → Paracetamol*), dose, frequency, timing, course length and action (*start / change / stop / continue*). |
| **Medicine reconciliation** | A dose change creates a new entry and marks the old one `replaced` with who changed it and when. A stop retires the entry, and fixed-length courses expire on their own. Nothing is silently deleted. |
| **Cross-doctor interaction alerts** | Active medicines are checked against an interaction table. Alerts are flagged when the two drugs came from **different doctors**, the case neither doctor could have caught. |
| **Ask** | A natural-language question runs a hybrid (meaning + exact-word) search over every visit sentence. The answer cites the doctor's own words, the date and the search latency, and adds a warning when the drug is part of an active conflict. |
| **Memory inspector** | Browse and search the raw Qdrant Edge shard: point counts, per-source breakdown and match scores. |
| **Family sync** | Only the medicine list and alerts are queued for a family member. Every item goes through the Leak Check, the outbox and the receipt ledger. |
| **Delete everything** | Deletes the shard folders, the SQLite database and the device identity, and asks the server to delete this device's contributions. If the phone is offline, the server request is queued. |

## Architecture

```text
┌──────────────────────────── Phone (Expo / React Native) ───────────────────────────┐
│                                                                                    │
│  Record visit ─► splitTranscript ─► classify (MiniLM) ─► extractMed                │
│                                          │                    │                    │
│                                          ▼                    ▼                    │
│                                  ingest() → items      applyMed() → meds table     │
│                                          │               (supersede / stop /       │
│                                          ▼                expire courses)          │
│                          embedQueue: dense 384-d + sparse     │                    │
│                                          │                    ▼                    │
│                                          ▼              listAlerts() ◄─ INTERACTIONS│
│                     ┌──────── Qdrant Edge (in-process) ────────┐                   │
│                     │  private shard  — visit sentences        │ ◄── Ask: hybrid   │
│                     │  crowd shard    — downloaded facts       │     search + RRF  │
│                     └──────────────────────────────────────────┘                   │
│                                                                                    │
│  queueMedSync ─► Leak Check (PII) ─► outbox ─► sync engine ─► receipt ledger       │
└───────────────────────────────────────────────┬────────────────────────────────────┘
                                                │  HTTPS, only when online
                                                ▼
┌────────────── apps/server (Fastify) ──────────────┐     ┌─── apps/dashboard ───┐
│ re-embeds facts itself (never trusts a phone      │ ──► │ Next.js admin view:  │
│ vector) · PII re-check · rate limits · delta feed │ SSE │ counts & published   │
│ with tombstones · Qdrant server or in-memory      │     │ knowledge only       │
└───────────────────────────────────────────────────┘     └──────────────────────┘
```

### Save pipeline (`saveVisit`)

1. **Split:** the transcript becomes speaker-tagged sentences.
2. **Understand:** doctor sentences are parsed for a prescription. Every other sentence is classified with MiniLM against category exemplars, which are embedded once and cached.
3. **Persist:** the visit row, including the structured facts, is written to SQLite.
4. **Index:** each sentence is ingested (`items` table, idempotent on `ext_id`), then embedded into a dense and a sparse vector and upserted into the private Qdrant Edge shard in batches.
5. **Reconcile:** each prescription is applied to the medicine list. The pipeline also expires finished courses.
6. **Check:** interactions are recomputed, and only the *new* alerts are returned to the UI.
7. **Share:** changed medicine rows are submitted to the privacy pipeline for family sync.

The UI shows these stages as progress (`understanding → indexing → checking → done`).

## How Qdrant Edge is used

Aftercare uses [`react-native-qdrant-edge`](https://github.com/rust-dd/react-native-qdrant-edge), which embeds Qdrant's storage and search engine in the app process through JSI/Nitro. There is no server process and no network hop.

| Need | Implementation | Code |
| --- | --- | --- |
| Private, on-device store | One shard per purpose (`private`, `crowd`), each a folder under the app's document directory | `apps/mobile/src/core/shards.ts` |
| Meaning search | Named dense vector `d`: 384-d MiniLM, cosine distance | `shards.ts` |
| Exact drug-name search | Named sparse vector `s` with the IDF modifier, from a shared tokenizer and sparse encoder | `packages/shared/src/sparse.ts` |
| Combined ranking | Both searches run under the same filter (20 candidates each), then Reciprocal Rank Fusion (k = 60) | `apps/mobile/src/core/search.ts` |
| Scope to visits and dates | Payload indexes on `source` (keyword) and `ts` (integer), passed as filters | `shards.ts`, `aftercare/engine.ts` |
| Crash safety | Write-ahead log with `mobileWalDefaults()` and a `flush()` after each upsert | `shards.ts` |
| Fast as data grows | `optimize()` (segment merge + HNSW build) runs after 500 new points, only when the app goes to the background | `shards.ts` |
| Real deletion | Close the shards and delete their folders | `deleteAllShards()` |

This is why *"the blue tablet"* (meaning) and *"Atorvastatin"* (exact token) both find the right sentence. API notes and device findings, such as the directory that must exist before `createShard` and the apparent vs. real storage size, are in [`docs/edge-api.md`](docs/edge-api.md).

## Repository layout

```text
hive/
├── apps/
│   ├── mobile/                 Expo SDK 57 app (Expo Router, typed routes, React Compiler)
│   │   ├── assets/models/      MiniLM ONNX model + vocab (model is git-ignored)
│   │   └── src/
│   │       ├── app/            Screens: onboarding, (tabs)/{Visits, Ask, Medicines, Memory},
│   │       │                   settings, privacy, diagnostics
│   │       ├── aftercare/      Visit pipeline (engine.ts), demo data & drug tables (data.ts), AddVisit sheet
│   │       ├── core/           SQLite, embedder, embed queue, Qdrant Edge shards, hybrid search, ingest
│   │       ├── privacy/        Splitter, Leak Check, PII/entity scan, outbox, receipt ledger
│   │       ├── sync/           API client, push/pull engine, network, foreground/background triggers
│   │       ├── app-state/      Zustand store, "Delete everything"
│   │       ├── lastmeter/      Earlier delivery-memory feature (see Project history)
│   │       ├── spikes/         Device spikes for Edge, embedding and clustering
│   │       └── ui/             Theme, component kit, animations, toasts
│   ├── server/                 Fastify API + Qdrant (or in-memory) store + SQLite metadata
│   └── dashboard/              Next.js 16 admin dashboard (read-only, counts + published knowledge)
├── packages/
│   └── shared/                 @hive/shared: types, zod schemas, WordPiece tokenizer, sparse encoder,
│                               PII patterns, receipt hashing (used by phone, server and tools)
├── tools/                      Demo CLIs (riders.ts, reset.ts), mock server, verify-*.mjs checks
├── models/                     Server-side copy of the ONNX model + vocab (git-ignored)
├── patches/                    pnpm patch for onnxruntime-react-native (Gradle 9 compatibility)
└── docs/edge-api.md            Qdrant Edge binding notes
```

## Tech stack

| Layer | Technology |
| --- | --- |
| Mobile | Expo SDK 57, React Native 0.86, React 19.2, Expo Router, Reanimated 4, Zustand |
| On-device vector DB | `react-native-qdrant-edge` 0.4 (Nitro modules) |
| On-device ML | `onnxruntime-react-native` 1.24, all-MiniLM-L6-v2 (quantized ONNX), in-repo WordPiece tokenizer |
| Local storage | `expo-sqlite` (WAL mode), `expo-secure-store` for the device token, `expo-file-system` |
| Background work | `expo-background-task` / `expo-task-manager` (periodic sync, minimum interval 15 min) |
| Server | Node 22, Fastify 5, zod 4, `@qdrant/js-client-rest`, `better-sqlite3`, `onnxruntime-node` |
| Dashboard | Next.js 16 (App Router), Tailwind CSS v4, TanStack Query, Leaflet |
| Tooling | pnpm workspaces (hoisted linker for Metro), TypeScript 6, tsx, ESLint (expo config) |

## Getting started

### Prerequisites

- **Node.js 22.18+.** The `tools/*.ts` scripts run directly on Node with type stripping.
- **pnpm 11** (declared in `devEngines`; downloaded automatically if missing).
- **Android Studio / Android SDK** and a physical Android device or emulator. The app uses native modules, so it runs as a **development build** and not in Expo Go. iOS builds require macOS and Xcode.
- **Docker** (optional), to run a real Qdrant server for the backend. Otherwise use `STORE=memory`.

### 1. Install

```bash
git clone <repo-url> hive
cd hive
pnpm install
```

pnpm applies `patches/onnxruntime-react-native.patch` automatically.

### 2. Add the embedding model

The model binaries are git-ignored. Place the **all-MiniLM-L6-v2** quantized ONNX export (`model_quantized.onnx`, 384-d output) and its `vocab.txt` in both locations:

```text
apps/mobile/assets/models/model_quantized.onnx
apps/mobile/assets/models/vocab.txt        # tracked
models/model_quantized.onnx                # used by the server (MODEL_DIR)
models/vocab.txt
```

The phone and the server must use the **same** model, because the server re-embeds every fact itself. Run `pnpm embed-check` in `apps/server` to compare the two outputs.

### 3. Run the mobile app

```bash
cd apps/mobile
npx expo run:android          # first time: builds and installs the dev client
npx expo start --dev-client   # afterwards: start Metro only
```

For a USB-connected device, forward Metro and the API ports, then open the dev client:

```bash
adb reverse tcp:8081 tcp:8081
adb reverse tcp:8787 tcp:8787
adb shell am start -a android.intent.action.VIEW \
  -d "exp+mobile://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
```

The core Aftercare flow (record → remember → ask → alerts) works fully offline. The backend is needed only for family sync.

### 4. Run the backend (optional)

```bash
# Real Qdrant
docker run -d --name qdrant -p 6333:6333 -v "${PWD}/qdrant_data:/qdrant/storage" qdrant/qdrant

cd apps/server
cp .env.example .env    # optional; every value has a default
pnpm dev                # http://0.0.0.0:8787

# …or with no Docker at all (data is wiped on restart)
STORE=memory pnpm start
```

To test only the phone's sync engine against the API contract, use the lightweight mock: `node tools/mock-server.mjs`.

### 5. Run the dashboard (optional)

```bash
cd apps/dashboard
cp .env.example .env.local   # NEXT_PUBLIC_API defaults to http://localhost:8787
pnpm dev                     # http://localhost:3000
```

Enter the server address and the admin key (`dev-admin-key` locally). The key is kept only in the browser tab's session.

### Demo flow

The seeded demo has three visits that tell one story:

1. **Dr. Anil Mehta (Cardiologist):** starts Amlodipine 5 mg, Aspirin 75 mg and Atorvastatin 10 mg.
2. **Dr. Sneha Rao (Orthopaedic):** prescribes Ibuprofen 400 mg for five days, which triggers a **high-risk Aspirin + Ibuprofen** alert across two doctors.
3. **Dr. Anil Mehta (follow-up):** raises Amlodipine 5 → 10 mg and stops Atorvastatin. The list is reconciled, not appended.

Record them in that order. Use **Visits → Reset demo data** to start over on the phone, and `node tools/reset.ts --yes` to wipe the server.

## Configuration

### Server (`apps/server/.env`)

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | Listen address |
| `STORE` | `qdrant` | `qdrant` for a real Qdrant server, `memory` for in-process storage |
| `QDRANT_URL` | `http://localhost:6333` | Qdrant endpoint |
| `DAILY_CAP` | `50` | Contributions accepted per device per UTC day |
| `REGISTER_PER_HOUR` | `30` | Device registrations per IP per hour |
| `ADMIN_KEY` | `dev-admin-key` | Dashboard/admin access. **Change it for anything but a local demo.** |
| `DB_PATH` | `./server.db` | SQLite metadata database |
| `MODEL_DIR` | `../../models` | Folder containing `model_quantized.onnx` and `vocab.txt` |

### Mobile

The API base URL is resolved in this order:

1. The `api_base` setting, saved in the app.
2. The `EXPO_PUBLIC_API_URL` environment variable.
3. The Metro host, on port `8787`.
4. `10.0.2.2:8787` (the Android emulator's alias for the host machine).

### Dashboard

| Variable | Default | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_API` | `http://localhost:8787` | Backend address. Use the server's LAN IP to watch phones on your network. |

## Server API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness, device count, current knowledge version |
| `POST` | `/v1/devices/register` | Issue a random device id and token. Only a hash of the token is stored. |
| `DELETE` | `/v1/devices/me` | Delete this device's contributions. Affected facts are re-checked and tombstoned if needed. |
| `POST` | `/v1/contributions` | `{ facts: [...] }` → `{ accepted: [idx], rejected: [{ idx, reason }] }` |
| `POST` | `/v1/outcomes` | Outcome evidence that adjusts a fact's confidence |
| `GET` | `/v1/knowledge?group&since&limit` | Per-group delta feed: `{ points, tombstones, next }` |
| `POST` | `/v1/heartbeat` | Opt-in aggregate counts only |
| `GET` | `/v1/admin/*` | Dashboard reads (`stats`, `overview`, `knowledge`, `devices`, `activity`, `safety`, …); requires `x-admin-key` |
| `GET` | `/v1/admin/events` | Live activity over Server-Sent Events |
| `POST` | `/v1/admin/reset` | Wipe demo state |

Reject reasons are `invalid`, `pii`, `rate_limited` and `duplicate`. The server **never accepts a vector from a phone**: it re-embeds every fact with its own copy of the model and runs the same PII detectors as the device, as defence in depth. All request and response shapes are zod schemas in `packages/shared/src/schemas.ts`, shared by the phone, the server and the tools.

## Verification and tests

The offline checks load the real TypeScript in plain Node, with native modules stubbed, so they need no device and no extra install:

```bash
node tools/seed/verify-aftercare.mjs   # transcript split, drug/dose/frequency/timing/duration, change/stop detection
node tools/seed/verify-privacy.mjs     # Leak Check and PII/contact-name detection
node tools/seed/verify-receipts.mjs    # hash-chained receipt ledger
node tools/seed/verify-crowd.mjs       # server publishing, confidence and conflict logic
node tools/seed/verify-server.mjs      # server behaviour end to end
node tools/seed/verify-mock.mjs        # sync engine against the mock server
node tools/seed/verify-dashboard.mjs   # dashboard aggregation
```

Server and type checks:

```bash
cd apps/server && pnpm test && pnpm typecheck   # Fastify inject HTTP tests
cd apps/server && pnpm embed-check              # phone/server embedding parity
cd apps/mobile && npx expo lint && npx tsc --noEmit
cd apps/dashboard && pnpm typecheck
```

A full scripted walkthrough, including talking points and recovery steps, is in `DEMO_SCRIPT.md`, which is kept out of version control.

## Privacy and security model

- **Local by default.** Recordings, transcripts, visit sentences and their vectors live only in the app's SQLite database and the `private` Qdrant Edge shard. They are never synced.
- **One door out.** `submitFact()` is the only path to the outbox. Every outgoing item is de-duplicated (30-day hash window) and passed through the **Leak Check**, which blocks emails, URLs, UPI VPAs, phone numbers, account and reference numbers, amounts, and names found in the user's contacts.
- **Auditable.** Each successful upload writes a **hash-chained receipt** listing exactly what the server acknowledged, what it rejected, and which items the Leak Check blocked (without their text). The chain can be verified and exported from the Privacy screen.
- **No accounts.** A device is identified by a random id and a token stored in `expo-secure-store`. The server stores only a hash of the token.
- **Defence in depth on the server.** The server runs the same PII check again, re-embeds facts itself, and enforces rate limits and daily caps. The dashboard shows only counts and published data, because the cloud never has private memory to show.
- **Real deletion.** *Delete everything* deletes the shards, the database and the identity locally right away. The server-side deletion runs immediately, or is queued until the next connection if the phone is offline.

## Limitations

This is a prototype built for a hackathon. Known gaps:

- **Speech-to-text is simulated:** transcripts come from the scripted demo visits in `aftercare/data.ts`. *Scan prescription* is also simulated.
- **The drug and interaction tables are small and hand-written** (15 drugs, 8 interactions). They are illustrative, not clinical data, and must not be used for medical decisions.
- **Prescription extraction is rule-based** (regular expressions over the drug alias table). Only sentence classification uses the embedding model.
- **The family member's device is simulated in the UI.** The medicine list goes through the real outbox and sync path, but it reuses the `place_fact` wire format inherited from LastMeter.
- **Voice questions** are not implemented yet.
- **iOS** is configured but has not been verified on device. Android is the primary target.

## Project history

This monorepo grew in three stages, and some names in the code reflect that:

1. **Hive:** a privacy-preserving collective memory. Phones kept a private vector store and contributed only general, Leak-Checked facts to a crowd layer published after K-device confirmation. The workspace name `hive`, the package `@hive/shared` and the SQLite file `hive.db` come from this stage.
2. **LastMeter:** a delivery-rider memory of the "last 10 metres" of each stop (gate codes, entrances, hazards). Its facts were verified by delivery outcomes and conflicts were resolved on evidence. `src/lastmeter/`, the server's place-fact/outcome/conflict logic, `tools/riders.ts`, and the current `app.json` name and package id (`LastMeter`, `com.lastmeter.rider`) come from this stage.
3. **Aftercare (current):** reuses the on-device embedding, Qdrant Edge memory, hybrid search, privacy pipeline and sync engine for doctor-visit memory. `src/aftercare/` and the four tabs are the current product.

## References

- Kessels RPC. *Patients' memory for medical information.* J R Soc Med. 2003;96(5):219–222.
- World Health Organization. *Medication Without Harm: WHO Global Patient Safety Challenge.* 2017.
- Qdrant Edge for React Native: <https://github.com/rust-dd/react-native-qdrant-edge>
- Reimers & Gurevych. *Sentence-BERT* / `sentence-transformers/all-MiniLM-L6-v2`.

---

**Aftercare × Qdrant Edge:** doctors change, medicines change, memory fades. Aftercare remembers, and keeps it on your phone.
