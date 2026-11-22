# InferHub — account diagnosis and levers

Source: live research from 12 November 2026 on <https://inferhub.dev> (homepage, `/docs/api`,
`/pricing`) and the management API `https://inferhub.dev/api` (authenticated).

Private account details (balances, key names, key fragments) are intentionally omitted from this
document. See [`../SECURITY.md`](../SECURITY.md).

## What InferHub is

An inference **marketplace**: publishers offer their models (Claude, Codex, GLM, DeepSeek, Qwen…)
at an "ask" price in USDC per million tokens; the consumer calls **one** [OI]-/Anthropic-compatible
API (`https://api.inferhub.dev/v1`) and is routed to the cheapest provider with capacity. One key
covers two protocols (`/v1/chat/completions`, `/v1/messages`), plus a **management API**
(`GET /api/me`, `/api/keys`, `/api/budgets`, `/api/catalog`, `/api/market`).

## Account state (measured 12 November 2026)

| Item | Finding |
|---|---|
| Consumer balance | not reproduced here (private account information) |
| Keys | several named keys were used; none had `allowedUpstreams`/`allowedModels` restrictions. Names and fragments are omitted |
| Models that pass | family **`ag/`** (Antigravity, first party) + family **`zai/`** (Z.AI GLM Coding Plan) |
| Models that fail | `ali/`, `oai/`, `cb/`, `cc/`, `cbc`… → `402 no_provider_under_bid` or `403 model disabled in your preferences` |

## Why the other families return 402/403

The public catalogue lists 287 models, but the effective set for a key is:

    account "Models & pricing" settings  ∩  budgets  ∩  key allowlist

The account applies a **discount threshold** (`minDiscountPct ≈ 98.90` in `/api/budgets`) and a
**maximum price** per token: models whose ask exceeds that ceiling are returned as
`402 no_provider_under_bid`. `ag/*` (discounted by ~99%) and `zai/*` pass; the others do not.

> The `x-max-input-price` / `x-max-output-price` headers **do not replace** the account ceiling:
> tested at 0.5 / 3 USDC → still 402. The account ceiling is the binding constraint.

## The two levers to unlock roughly 200 more models

1. **Dashboard** → *Models & pricing* (or *Budgets*): raise the maximum accepted price, or enable
   the wanted families (Ali Qwen, OpenAI, CodeBuddy…).
2. **API**: `PUT /api/budgets/{id}` with `maxInputPerMtok` / `maxOutputPerMtok` / `enabled`.
   (See "Common endpoints › Routing › `PUT /api/budgets/{id}`" in `/docs/api`.)

## Vision models of interest, sorted by input price (market ask)

| Model | Family | minAsk in (USDC/Mtok) | Allowed today |
|---|---|---|---|
| `zai/glm-4.6v` | Z.AI GLM | **0.0003** | ✅ (already added to our chain) |
| `ag/gemini-3.8-flash-high` | Antigravity | 0.00075 | ✅ |
| `ali/qwen3.8-27b` | Qwencloud | 0.0035 | ❌ 402 |
| `cb/minimax-m3.1-flash` | CodeBuddy | 0.00555 | ❌ 503 (capacity) |
| `ali/deepseek-v4.1-flash` | Qwencloud | 0.0147 | ❌ 402 |

`zai/glm-4.6v` (vision, ~0.0003/Mtok) is **already usable** with the current key: it was added to
the product's fallback chain (`src/domain/config.ts`) and to the proxy. Measured on 12 November
2026: family allowed but **capacity often saturated** (429 "168 providers at concurrency limit") —
which the chain and the circuit breaker absorb.

## What the product already does (none of these ideas require leaving InferHub)

- **Fallback chain (server + client)**: a 402/503/429 moves to the next model.
- **Circuit breaker**: a failing model is put in a 60 s cooldown on the proxy side.
- **Native combo**: InferHub offers virtual `combo/<slug>` models that do exactly this failover,
  budget-aware. Worth exploring (`POST /api/combos`) — it would replace our home-made chain with a
  single model name, if a vision combo exists.
- **`free/<slug>/<model>`**: best-effort free models — `GET /api/catalog` to list them.

## Recommendation for the day

In the evening, `ag/*` is enough (16 s measured). During the day, saturation is global: **the two
dashboard levers above are the only way to multiply capacity** without leaving InferHub.
