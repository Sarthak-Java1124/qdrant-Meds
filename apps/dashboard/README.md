# Hive dashboard

Next.js (App Router) + Tailwind v4 + TanStack Query. It shows **counts and published knowledge only**: the cloud cannot
see private memory by design, so there is nothing private to show.

## Run

```bash
# 1. the server must be running (apps/server), e.g. STORE=memory or with Qdrant
# 2. from apps/dashboard
cp .env.example .env.local     # optional: NEXT_PUBLIC_API defaults to http://localhost:8787
pnpm dev                       # http://localhost:3000
```

Open it, enter the server address and the admin key (`ADMIN_KEY`, `dev-admin-key` for a local demo). The key is kept in
the browser tab's session only. To watch phones on your network, point the address at the server's LAN IP.

## Pages

| Page | Shows |
| --- | --- |
| Overview | devices, seen in the last 5 min, contributions today, published by kind, live contributions/minute, deletion effects |
| Pending | clusters below K with an "x / K" bar, the leading value and the vote split; live |
| Knowledge | published facts by kind and group, with confirmations, version and a withdrawn flag |
| Activity | live stream: contribution, rejected (with reason), published, device synced, device deleted |
| Devices | anonymous ids, last seen, opt-in counts only |
| Safety | rejections by reason, poison blocked by the majority rule, facts with no majority |

Live updates come from one Server-Sent Events connection (`/v1/admin/events`) that reconnects by itself; anything
meaningful that arrives triggers a short-debounced refetch, and every number also polls every 15 s as a fallback.
