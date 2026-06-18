## Parent PRD

[World Cup 2026 LLM Prediction Tracker](../PRD.md)

## What to build

Bootstrap the Express app with Turso database connectivity and all schema migrations. This is the foundation every other issue builds on: a running Express server, a connected Turso database, and three tables — `stadiums`, `matches`, `predictions` — created on startup if they don't exist. Include Render deployment config (environment variable documentation, `render.yaml` or setup notes).

## Acceptance criteria

- Express server starts and responds with HTTP 200 on `GET /`
- Turso connection is established using `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` environment variables
- Database migrations run on startup and create `stadiums`, `matches`, and `predictions` tables with correct schema and constraints
- `OPENCODE_ZEN_API_KEY` environment variable is documented but not yet used
- App can be deployed to Render free tier and wake successfully after sleep

## Manual Testing

- Start the app locally with valid Turso credentials — server starts without errors
- Check Turso dashboard to confirm all three tables exist with correct columns
- Stop and restart the server — migrations run again without error (idempotent)
- Verify `GET /` returns 200 (can be a placeholder page)
- Deploy to Render and confirm the app wakes and responds after a cold start

## Blocked by

None — can start immediately.