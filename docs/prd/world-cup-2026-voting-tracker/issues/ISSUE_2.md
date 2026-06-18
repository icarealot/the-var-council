## Parent PRD

[World Cup 2026 LLM Prediction Tracker](../PRD.md)

## What to build

On every `GET /` page load, fetch fresh match data from the `worldcup26.ir` API (`/get/games`, `/get/teams`, `/get/stadiums`) and upsert it into Turso. Convert all match kickoff times from local venue time to ICT (UTC+7) using the per-venue timezone region from the stadiums endpoint. Render the main page with a flat dropdown listing all 104 matches sorted by `local_date_ict` ascending. Knockout matches where either team is unconfirmed (`home_team_id = '0'` or `away_team_id = '0'`) appear in the dropdown but are disabled. Each dropdown item shows: `[Date ICT] Home Team vs Away Team` (or label for unconfirmed teams).

## Acceptance criteria

- Every page load fetches and upserts stadiums, teams, and matches from worldcup26.ir
- Kickoff times are correctly converted to ICT: Eastern +11h, Central +12h, Western +14h
- All 104 matches appear in the dropdown sorted by `local_date_ict` ascending
- Confirmed matches are selectable; unconfirmed knockout matches are disabled with their label displayed (e.g., "Winner Group J vs Runner-up Group H")
- If the worldcup26.ir API is unreachable, show a visible error message on the page rather than a silent crash

## Manual Testing

- Load `GET /` and inspect the dropdown — all matches appear in chronological ICT order
- Find a group stage match and verify its ICT time is correct for its venue timezone (e.g., a Los Angeles match at 7 PM PDT should show as 9 AM ICT next day)
- Verify unconfirmed knockout matches appear in the dropdown but cannot be selected
- Disconnect from the internet, reload the page — an error message is shown (not a 500 crash)
- Confirm that reloading updates match data (e.g., if a score changes in the API, it is reflected on next load)

## Blocked by

- Blocked by [ISSUE_1](./ISSUE_1.md)
