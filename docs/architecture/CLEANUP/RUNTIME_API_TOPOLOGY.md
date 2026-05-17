# API runtime topology (`app/api`)

**Snapshot:** 2026-05-12.

## Finding

A repository-wide search for `export const runtime = 'edge'` under `app/api` returned **no matches**. Many hot routes explicitly set:

```ts
export const runtime = 'nodejs';
```

Examples: `call-event`, `call-event/v2`, `sync`, `oci/*`, `workers/*`, most `cron/*`.

## Implication

- Ingest, OCI, workers, and cron paths assume **Node.js** APIs (`pg`, long CPU, streaming CSV).
- Do **not** flip these to `edge` without auditing `fs`, native crypto, and Supabase service clients.

## Processes and env (high level)

| Process | Env source |
|---------|------------|
| `next dev` / `next start` | `.env.local`, Vercel injected vars |
| `node scripts/...` | `.env.local` (manual) |
| `adsmantik-engine` (Wrangler) | `adsmantik-engine/wrangler.jsonc` + Cloudflare secrets |

Cross-reference secrets with [`ENV_VARS_MATRIX.md`](./ENV_VARS_MATRIX.md).
