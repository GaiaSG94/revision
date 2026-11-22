# Upstream latency (automatic readings)

Measured by `scripts/sonder-latence.mjs`, run every hour by `.github/workflows/latence.yml`.
**One** call per invocation, in series: no burst, which would skew the measurement and saturate the
upstream.

These readings serve three purposes: choosing the recording hour from data, proving availability
during judging (RNF-08), and honestly documenting the constraint (the upstream is a marketplace:
latency varies by a factor of 3 depending on the time of day).

> The file is versioned on the `donnees/latence` branch: `main` is protected by a ruleset (PR
> required), an automatic push there would be rejected.

## 24-hour summary

- Measurements: **2**
- Availability rate: **50%**
- Median latency of successful calls: **6.9 s**
- Most reliable model: **ag/gemini-3.8-flash-high (100% success over 24 h)**

## History

| Timestamp (UTC) | Model | HTTP | Latency | Available |
| --- | --- | --- | --- | --- |
| 2026-11-12T14:24:48.001Z | `ag/gemini-3.8-flash-high` | 200 | 6.9 s | yes |
| 2026-11-12T14:24:48.001Z | `ag/gemini-4-carbon` | 503 | 0.5 s | no |

## Earlier manual readings (before the automatic bench)

| Date | Model | Result |
| --- | --- | --- |
| 11 Nov, 21:00 | `ag/gemini-4-carbon` | 200 in 16 s |
| 11 Nov, 21:00 | `ag/claude-sonnet-4-6` | 200 in 16 s, then 503 five minutes later |
| 11 Nov, 21:00 | `ag/gemini-3.8-flash-high` | 200 in 45–52 s |
| 11 Nov, 21:00 | `ag/gemini-4-argon`, `ag/claude-sonnet-5-5`, `ag/claude-opus-4-6-thinking` | 503 |
| 11 Nov, 21:00 | `oai/gpt-5.4-mini`, `ali/deepseek-v4.1-flash` | 402 out of bid |
| 11 Nov, 21:00 | `cbcn/glm-5.3-flash` | 403 disabled in account preferences |
| 12 Nov, 13:00 | `ag/gemini-3.8-flash-high` | 200 in 56.7 s (5 tokens) |
| 12 Nov, 13:00 | `ag/gemini-4-carbon` | 503 |
