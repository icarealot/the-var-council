## Parent PRD

[World Cup 2026 LLM Prediction Tracker](../PRD.md)

## What to build

Implement the `POST /api/predict/:matchId` endpoint that calls all 8 LLM models in parallel via OpenCode Zen and saves the results to the `predictions` table. Each model receives a prompt asking for a 1X2 prediction (`home`/`draw`/`away`) and a short reasoning text, returned as structured JSON. For knockout matches, the prompt specifies no draw option. Each model is called independently — if a call fails, retry up to 3 times with exponential backoff. After 3 failed retries, save a failed record (`failed = TRUE`, `pick = NULL`, `reasoning = NULL`). The endpoint returns all 8 predictions as JSON once all parallel calls complete (or fail). Route each model to its correct OpenCode Zen endpoint: Anthropic messages endpoint for Claude, Google endpoint for Gemini, OpenAI responses endpoint for GPT 5.5, and OpenAI-compatible `/chat/completions` for the remaining five.

## Acceptance criteria

- `POST /api/predict/:matchId` calls all 8 models in parallel and returns all predictions as JSON
- Each prediction record is saved to the `predictions` table with `UNIQUE(match_id, model_name)` enforced
- Models use the correct OpenCode Zen endpoint per provider (Anthropic, Google, OpenAI, OpenAI-compatible)
- Failed models are retried up to 3 times; after 3 failures a failed record is saved and the endpoint continues (does not block other models)
- Knockout matches receive a prompt that excludes the draw option
- Calling the endpoint again for a match that already has all 8 predictions returns the cached results without making new API calls

## Manual Testing

- Call `POST /api/predict/:matchId` for a group stage match — verify all 8 predictions appear in the DB with valid `pick` and `reasoning` values
- Call the same endpoint again — verify no new API calls are made (check DB timestamps didn't change)
- Call for a knockout match — verify no prediction has `pick = 'draw'`
- Simulate an API failure for one model (e.g., use an invalid model ID temporarily) — verify the other 7 succeed and the failed model saves a failed record
- Verify `OPENCODE_ZEN_API_KEY` is read from environment and not hardcoded

## Blocked by

- Blocked by [ISSUE_1](./ISSUE_1.md)
