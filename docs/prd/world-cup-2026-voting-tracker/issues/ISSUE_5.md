## Parent PRD

[World Cup 2026 LLM Prediction Tracker](../PRD.md)

## What to build

After a match finishes (`finished = TRUE`), highlight each model's prediction cell green (correct) or red (wrong) based on the actual result derived from `home_score` vs `away_score`. Derivation rule: `home_score > away_score` → `home`; `away_score > home_score` → `away`; equal → `draw`. Also display a summary line above the table: "X/8 models predicted correctly" (failed/unavailable predictions count as wrong and are included in the denominator). Unfinished matches show the table with no highlighting.

## Acceptance criteria

- Finished matches show green cells for correct predictions and red cells for wrong predictions
- Summary line "X/8 models predicted correctly" is shown for finished matches
- Failed predictions (`failed = TRUE`) count as wrong and display red
- Unfinished matches show no colour highlighting on prediction cells
- Highlighting is derived live from `home_score`/`away_score` in the DB — no separate "correct" column needed

## Manual Testing

- In Turso, manually set a match to `finished = TRUE` with known scores (e.g., 2–1 home win)
- Load the predictions for that match — correct `home` picks are green, `away`/`draw` picks are red
- Verify the summary count is accurate
- Set `finished = FALSE` for the same match — verify no highlighting appears
- Verify a failed prediction row shows red highlight when the match is finished

## Blocked by

- Blocked by [ISSUE_4](./ISSUE_4.md)
