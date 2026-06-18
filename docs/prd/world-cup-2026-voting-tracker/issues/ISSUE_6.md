## Parent PRD

[World Cup 2026 LLM Prediction Tracker](../PRD.md)

## What to build

Add a `GET /leaderboard` page that ranks all 8 LLM models by total correct predictions across all finished matches that have at least one prediction. For each model, calculate: total matches predicted, total correct, and accuracy percentage. A match is ignored entirely if it has no prediction records at all. A failed prediction counts as wrong. Rank models by total correct predictions descending.

## Acceptance criteria

- `GET /leaderboard` renders a table with columns: Rank, Model Name, Correct Predictions, Matches Predicted, Accuracy %
- Models are ranked by total correct predictions descending
- Only finished matches (`finished = TRUE`) with at least one prediction are included in calculations
- Failed predictions count as wrong (not excluded from denominator)
- Matches with zero predictions for any model are excluded entirely from that model's count
- A navigation link between the Predictions page and Leaderboard page is present on both pages

## Manual Testing

- Seed predictions in Turso for 3 finished matches with known correct/wrong values per model
- Load `/leaderboard` — verify rankings, correct counts, and accuracy % match expected values
- Verify a model with all failed predictions (all `failed = TRUE`) shows 0 correct and is ranked last
- Verify an unfinished match does not contribute to any model's score
- Verify a match with no predictions at all does not appear in any model's count
- Click the navigation link from the leaderboard to the predictions page and back

## Blocked by

- Blocked by [ISSUE_4](./ISSUE_4.md)
