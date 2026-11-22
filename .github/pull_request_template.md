## Scope

<!-- The `couche0` gate requires bullets that list EXACTLY the files touched by the PR
(relative paths; backticks are optional but recommended for readability).
One bullet too many or too few = scope rejected. -->

- `path/to/file1.ts`
- `path/to/file2.ts`

## Why

<!-- One sentence: the problem or the value added. -->

## How to verify

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`

<!-- Reminder: 5 min CI budget, three required checks (ci, ci-budget, couche0),
merge through the Mergify queue only. Never push directly to main. -->
