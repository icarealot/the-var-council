# World Cup 2026 LLM Prediction Tracker

## Problem Statement

A simple public web app that shows AI predictions for World Cup 2026 matches. A user selects any match from a dropdown, and 8 LLM models each provide their prediction (win/draw/loss) plus reasoning. Predictions are cached so subsequent views load instantly. After matches finish, the app highlights which models predicted correctly and tracks overall model accuracy on a leaderboard.

## Solution

A single Express web app with two pages: a **Predictions** page (match selector + prediction table) and a **Leaderboard** page (model accuracy rankings). Match data is fetched from the `worldcup26.ir` API on every page load. When a user selects a match with no existing predictions, the server calls all 8 LLM models in parallel via the OpenCode Zen API, saves the results to Turso, and displays them. No user accounts, no login, no cron jobs.

## Implementation Decisions

- **Stack & Hosting**: Express.js server-side rendered HTML (no frontend framework) with Turso (hosted libSQL/SQLite) for persistence, deployed on Render free tier. Rationale: same rationale as original — minimal abstraction, no build step, Turso survives Render's ephemeral filesystem, zero cost.
- **Timezone**: All match times are displayed in Vietnam time (ICT, UTC+7). The `worldcup26.ir` API returns local venue times. Venues span three timezone regions: Eastern (UTC-4), Central (UTC-5), and Western (UTC-7) during summer 2026. The app fetches `/get/stadiums` on each page load to build a `stadium_id → region` map and applies the correct per-venue UTC offset when converting `local_date` to ICT.
- **Authentication**: None. The site is fully public — no login required, anyone with the URL can view predictions and trigger new ones.
- **Match Data Source**: `https://worldcup26.ir` API (open source, no key required). The app fetches three endpoints on every page load: `/get/games`, `/get/teams`, `/get/stadiums`. Data is upserted into Turso by `api_id` so scores, finished status, and confirmed knockout teams are always current.
- **LLM Models**: 8 models accessed via a single OpenCode Zen API key (`OPENCODE_ZEN_API_KEY` environment variable). Models and their OpenCode Zen endpoints:
  - MiniMax M2.7 → OpenAI-compatible endpoint (`/zen/v1/chat/completions`)
  - GLM 5.1 → OpenAI-compatible endpoint
  - Kimi K2.6 → OpenAI-compatible endpoint
  - Qwen3.6 Plus → OpenAI-compatible endpoint
  - DeepSeek V4 Flash → OpenAI-compatible endpoint
  - Claude Opus 4.8 → Anthropic endpoint (`/zen/v1/messages`)
  - Gemini 3.1 Pro → Google endpoint (per-model)
  - GPT 5.5 → OpenAI responses endpoint (`/zen/v1/responses`)
- **Prediction Flow**: When a user selects a match, the server checks if all 8 predictions exist in the `predictions` table. If yes, load and display. If no (fully or partially missing), call all missing models in parallel, save results, then display. A loading state is shown on the page while predictions are being generated (~10–30 seconds).
- **Prediction Content**: Each LLM predicts a 1X2 outcome (`home` / `draw` / `away`) and provides a short reasoning text. For knockout matches, only `home` and `away` are valid options (no draw). The prompt instructs the model to output structured JSON with `pick` and `reasoning` fields.
- **LLM Failure Handling**: Each model is called independently. If a call fails, retry up to 3 times with exponential backoff. If still failing after 3 retries, save a failed record (`failed = TRUE`, `pick = NULL`, `reasoning = NULL`) and display "Prediction unavailable" in that model's cell. A failed prediction counts as wrong on the leaderboard.
- **Knockout Match Handling**: Matches where `home_team_id = '0'` or `away_team_id = '0'` (teams not yet confirmed) appear in the match dropdown but are disabled — they cannot be selected and no prediction is triggered. Once teams are confirmed via a later page load sync, the match becomes selectable.
- **Vote Secrecy / Reveal**: No secrecy. Predictions are always visible once generated. After a match finishes (`finished = TRUE`), the table highlights each model's cell green (correct) or red (wrong) based on the actual result from the API.
- **Database Schema**:
  - `stadiums`: `id`, `api_id`, `name`, `city`, `region` (`Eastern`/`Central`/`Western`), `last_synced_at`.
  - `matches`: `id`, `api_id`, `home_team_id`, `away_team_id`, `home_team` (text), `away_team` (text), `home_team_label` (fallback display name), `away_team_label`, `stage_group` (API's `group` field: `A`–`L`, `R32`, `R16`, `QF`, `SF`, `3RD`, `FINAL`), `type` (API's `type` field: `group`/`r32`/`r16`/`qf`/`sf`/`third`/`final`), `stadium_id`, `local_date_ict` (converted kickoff time in ICT), `home_score`, `away_score`, `finished`, `last_synced_at`.
  - `predictions`: `id`, `match_id`, `model_name` (e.g. `claude-opus-4-8`), `pick` (`home`/`draw`/`away`, nullable), `reasoning` (text, nullable), `failed` (boolean, default FALSE), `predicted_at`. **Unique constraint**: `UNIQUE(match_id, model_name)`.
- **API Routes**:
  - `GET /` — main predictions page (fetches fresh match data, renders dropdown)
  - `GET /leaderboard` — leaderboard page
  - `POST /api/predict/:matchId` — trigger predictions for a match (called client-side on match select if predictions are missing); returns all 8 predictions as JSON
  - `GET /api/predictions/:matchId` — return existing predictions for a match as JSON
- **Leaderboard Logic**: For each finished match that has at least one prediction, compare each model's `pick` against the actual result derived from `home_score` vs `away_score`. Count total correct predictions per model. Rank models by total correct predictions descending. Matches with no prediction for a model (including failed ones) count as wrong. Matches with no predictions at all are ignored entirely.
- **Actual Result Derivation**: From `home_score` and `away_score`: if `home_score > away_score` → `home`; if `away_score > home_score` → `away`; if equal → `draw`. For knockout matches, the API's final score includes extra time and penalties, so the winner is unambiguous.
- **UI Language**: English.

## Page Descriptions

### Predictions Page (`/`)

- Fetches all matches from worldcup26.ir on load and upserts into DB.
- Shows a flat dropdown list of all 104 matches sorted by `local_date_ict` ascending. Each item shows: `[Date ICT] Home Team vs Away Team`. Knockout matches with unconfirmed teams are shown as disabled options.
- When a match is selected:
  - If all 8 predictions exist in DB → display the prediction table immediately.
  - If predictions are missing → show a loading spinner, call `POST /api/predict/:matchId`, then render the table.
- Prediction table columns: Model Name | Prediction | Reasoning.
- After match finishes: each row's Prediction cell is highlighted green (correct) or red (wrong). A summary line shows "X/8 models predicted correctly" (excluding failed/unavailable predictions from the count denominator if all 8 failed, otherwise include them).

### Leaderboard Page (`/leaderboard`)

- Table of all 8 models ranked by total correct predictions across all finished matches that have predictions.
- Columns: Rank | Model Name | Correct Predictions | Matches Predicted | Accuracy %.

## Testing Decisions

- **Prediction Generation**: Select a match with no predictions, verify loading state shows, verify all 8 predictions appear after load, verify they are saved in DB (selecting again loads from cache, no new API calls).
- **Failure Handling**: Simulate a model API failure, verify retry logic fires up to 3 times, verify "Prediction unavailable" shows in that model's cell.
- **Knockout Disabled State**: Verify unconfirmed knockout matches are visible but not selectable in the dropdown.
- **Result Highlight**: Manually set a match to `finished = TRUE` with known scores in Turso, verify green/red highlights appear correctly.
- **Leaderboard Accuracy**: Seed predictions with known correct/wrong values across multiple finished matches, verify ranking and accuracy % are correct.
- **Match Sync**: Verify that selecting the page updates match data (new scores, confirmed knockout teams) from the API.

## Out of Scope

- User accounts, login, or any authentication.
- Human voting on match outcomes.
- Exact score predictions.
- Automated cron jobs or scheduled prediction generation.
- Real-time score updates (live match tracking).
- Admin page.
- Mobile app (iOS/Android).
- Multi-language support (English only).
- Automated tests.
- Rate limiting or DDoS protection.
- Push notifications or reminders.

## Further Notes

- The Render free tier server sleeps after 15 minutes of inactivity. The first load after sleep will be slow (~30 seconds). This is acceptable.
- The OpenCode Zen API key must be set as `OPENCODE_ZEN_API_KEY` in Render's environment variables — never committed to the repo.
- Different OpenCode Zen model providers use different endpoint types (OpenAI-compatible, Anthropic messages, Google). The server must route each model call to the correct endpoint using the appropriate SDK or HTTP client.
- The `worldcup26.ir` API timezone offset map for ICT conversion: Eastern → UTC-4 (EDT), Central → UTC-5 (CDT), Western → UTC-7 (PDT). To convert to ICT (UTC+7): Eastern `+11h`, Central `+12h`, Western `+14h`.
- Before the tournament starts, `finished = FALSE` for all matches and the leaderboard will be empty. The app works correctly in this pre-tournament state.
- The sync upserts matches by `api_id`, updating scores, `finished` status, team names, and labels so confirmed knockout matchups unlock automatically.
