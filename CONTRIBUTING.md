# Contributing

## Running the project

```bash
npm ci
npm run dev        # http://localhost:5173
npm test           # 170 tests, no network, no quota consumed
npm run typecheck
npm run build      # dist/
node scripts/check-tokens.mjs   # file- and function-size guard
```

Node ≥ 20. No paid dependency.

## Contribution rules

1. **Never push directly to `main`**: the ruleset enforces it (PR required, linear history, three
   required checks).
2. **One branch = one PR**, opened within a minute of the push. A merged or closed branch is
   deleted, both on GitHub and locally.
3. **The PR body contains a `## Scope` block** with one bullet per touched file or folder (the PR
   template provides it). The `couche0` guard rejects an undeclared scope.
4. **CI under 5 minutes**: never increase a `timeout-minutes`. A job that runs too long is moved
   out of PRs.
5. **Size**: files < 500 lines, functions < 50 lines. Split anything larger.
6. **Merging is automatic**: the Mergify queue takes a PR as soon as `ci`, `ci-budget` and
   `couche0` are green. Manual brake: the `hold` label. Rebase conflicts are resolved by an agent
   connected to InferHub (`.github/fireworks/conflict_agent.py`).

## Where to change what

| Area | Content |
|---|---|
| `src/domain/` | Taxonomy, profile rules, types. **The business core**: every rule changes here, never in the UI |
| `src/pipeline/` | The 6 steps and the model client. No network call outside `llm.ts` |
| `src/ui/` | Screens and components. No business rules |
| `src/storage/`, `src/export/` | Local persistence and exports |
| `prompts/` | Versioned prompts: extraction, classification, generation, guardrail |
| `api/`, `worker/` | Edge proxy. No secret in code |
| `corpus/`, `tests/` | Fixtures and tests. Adding an error case means adding a fixture |

## Adding an error type

The taxonomy is **closed**: adding a code is a product decision, not a prompt tweak.

1. Add the entry in `src/domain/taxonomy.ts` (code, label, signature);
2. The classification prompt regenerates itself from `TAXONOMIE` (`blocTaxonomie()`);
3. Add a fixture in `corpus/fixtures.ts` with its ground truth;
4. Check that `npm test` stays green (RNF-03 ≥ 80%, RNF-04 = 0 false positives).

## What we refuse

- Automatic correction or grading of the paper: we diagnose, we do not grade.
- Giving the answer to the original exercise.
- Persisting an image, a name, or anything server-side.
- Red in the interface: the diagnosis is amber, progress is green.
