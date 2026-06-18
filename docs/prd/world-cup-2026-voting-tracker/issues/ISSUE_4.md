## Parent PRD

[World Cup 2026 LLM Prediction Tracker](../PRD.md)

## What to build

Wire the match dropdown to the prediction display. When a user selects a match from the dropdown: if predictions already exist in the DB, load and render the prediction table immediately via `GET /api/predictions/:matchId`; if predictions are missing, show a loading spinner and call `POST /api/predict/:matchId` client-side, then render the table when the response arrives. The prediction table has three columns: **Model Name**, **Prediction** (home/draw/away displayed as readable text), and **Reasoning** (inline text). Failed predictions show "Prediction unavailable" in the Prediction and Reasoning cells.

## Acceptance criteria

- Selecting a match with no predictions shows a loading spinner and triggers `POST /api/predict/:matchId`
- Selecting a match with existing predictions loads them instantly from `GET /api/predictions/:matchId` with no LLM calls
- Prediction table renders all 8 rows with model name, pick (as readable text), and reasoning inline
- Failed predictions display "Prediction unavailable" in their row
- Selecting a different match clears the previous table and repeats the flow
- Page works on mobile (table is scrollable horizontally if needed)

## Manual Testing

- Select a match with no predictions — loading spinner appears, table renders after ~10–30 seconds
- Select the same match again — table loads instantly (no spinner, no API calls)
- Select a match where one model previously failed — "Prediction unavailable" shows in that row
- Select a different match — previous table is cleared, new predictions load
- Open on a mobile device and verify the table is readable/scrollable

## Blocked by

- Blocked by [ISSUE_2](./ISSUE_2.md)
- Blocked by [ISSUE_3](./ISSUE_3.md)
