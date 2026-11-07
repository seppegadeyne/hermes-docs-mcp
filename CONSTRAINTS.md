# Constraints

Last reviewed: 2026-11-07

## Floor (always enforced)
- No new suppression comments (`@ts-ignore`, `@ts-expect-error` without reason, `eslint-disable`).
- No stubs or silent failures (`throw new Error("Not implemented")`, empty `catch {}`).
- No skipped or deleted tests without a reason in the commit message.
- No secrets in source.
- Indexed upstream documentation stays verbatim (see AGENTS.md).
- This file is not weakened to make a change pass.

## Enforced with numbers
| Dimension | Rule | Checked by | Runs at |
|---|---|---|---|
| Tests | all pass (16 today) | `npm test` | every change |
| Types and build | zero errors | `npm run build` | every change |

## Measured, not yet enforced (ratchets)
| Metric | Today | Direction | Command |
|---|---|---|---|
| Suppression comments | 0 | must stay 0 | `git grep -nE "@ts-ignore\|@ts-expect-error\|eslint-disable\|biome-ignore" -- ':!node_modules' ':!dist' ':!package-lock.json' \| wc -l` |
| Skipped tests | 0 | must stay 0 | `git grep -nE "\.skip\(\|\bxit\(\|it\.todo" \| wc -l` |
| Test count | 16 | must not fall | `npm test` |
| Built output size | 64 kB | must not grow (0.5% tolerance) | `du -sk dist` after `npm run build` |

No linter is configured.

## Exceptions
| ID | Rule | Path | Reason | Expires |
|---|---|---|---|---|
