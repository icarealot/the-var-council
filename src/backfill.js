require('dotenv').config();

const db = require('./db');
const { getPredictions, MODELS, FORECAST_VERSION } = require('./predict');

const MODEL_COUNT = MODELS.length;

async function backfill({ silent = false } = {}) {
  const log = silent ? () => {} : console.log.bind(console, '[backfill]');

  const result = await db.execute({
    sql: `SELECT m.id
          FROM matches m
          WHERE m.finished = 1
            AND m.home_team_id != '0'
            AND m.away_team_id != '0'
            AND (
              NOT EXISTS (
                SELECT 1 FROM predictions p
                WHERE p.match_id = m.id
              )
              OR (
                EXISTS (
                  SELECT 1 FROM predictions p
                  WHERE p.match_id = m.id AND p.forecast_version = ?
                )
                AND NOT EXISTS (
                  SELECT 1 FROM predictions p
                  WHERE p.match_id = m.id AND COALESCE(p.forecast_version, 1) != ?
                )
                AND (
                  SELECT COUNT(*) FROM predictions p
                  WHERE p.match_id = m.id AND p.failed = 0
                ) < ?
              )
            )
          ORDER BY m.local_date_ict ASC`,
    args: [FORECAST_VERSION, FORECAST_VERSION, MODEL_COUNT],
  });

  const ids = result.rows.map((r) => r.id);
  if (!ids.length) {
    log('No finished matches need predictions.');
    return;
  }

  log(`${ids.length} finished match(es) need predictions — generating...`);

  for (const matchId of ids) {
    try {
      log(`Predicting match ${matchId}...`);
      await getPredictions(matchId);
      log(`Match ${matchId} done.`);
    } catch (err) {
      console.error(`[backfill] Match ${matchId} failed:`, err.message);
    }
  }

  log('Backfill complete.');
}

// Allow running directly: node src/backfill.js
if (require.main === module) {
  backfill()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = backfill;
