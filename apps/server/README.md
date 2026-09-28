# Hive server

Fastify API that receives general facts from phones, **re-embeds them itself**, and publishes a fact only when
**K different phones confirm it**. Knowledge is served to phones as a per-group delta feed.

## Run

```bash
# 1. Qdrant (skip with STORE=memory)
docker run -d --name qdrant -p 6333:6333 -v "${PWD}/qdrant_data:/qdrant/storage" qdrant/qdrant

# 2. from apps/server
cp .env.example .env        # optional, everything has defaults
pnpm dev                    # or: pnpm start
```

No Docker? `STORE=memory pnpm start` keeps everything in-process (wiped on restart).

Set `K_CONFIRM=2` for a quick two-phone demo. `MIN_AGE_MIN=60` turns on the device-age anti-sybil rule.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/v1/devices/register` | random device id + token (only a hash of the token is stored) |
| POST | `/v1/contributions` | `{ facts: [...] }` -> `{ accepted: [idx], rejected: [{ idx, reason }] }` |
| GET | `/v1/knowledge?group&since&limit` | `{ points, tombstones, next }`. `next` is the highest version among points **and** tombstones |
| DELETE | `/v1/devices/me` | delete this device's contributions; anything that drops below K is tombstoned |
| POST | `/v1/heartbeat` | opt-in counts only |
| GET | `/v1/admin/{stats,pending,knowledge,devices,activity,safety}` | dashboard reads (`x-admin-key`) |
| GET | `/v1/admin/events` | live activity, Server-Sent Events (`?key=` because EventSource cannot set headers) |

Reject reasons: `invalid`, `pii`, `rate_limited`, `duplicate`.

## How a fact gets published

- **Merchant category**: one vote per device (a device's latest vote wins). Published when at least K eligible
  devices voted **and** the top value has at least `MAJORITY` (60%) of them.
- **Doubt / place tip**: contributions are clustered by meaning (cosine >= `DOUBT_SIM` / `TIP_SIM`). Published
  when K different devices are in one cluster. The published text is the medoid (the member most similar to the rest).
- **Poisoning**: one vote per device, majority rule, daily cap, PII rejection, minimum device age, and the server
  never accepts a vector from a phone.
- **Deletion**: contributions are removed, then every affected fact is re-checked; if it no longer qualifies it is
  unpublished and phones receive a tombstone.

## Checks

```bash
node ../../tools/seed/verify-crowd.mjs   # 52 crowd-logic checks, no install needed
pnpm test                                # HTTP tests (Fastify inject)
pnpm embed-check                         # compare embeddings with the phone (Spike B logs vector[0..4])
```
