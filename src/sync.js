const db = require('./db');

const BASE_URL = 'https://worldcup26.ir';

// ICT (UTC+7) offset from local venue time, during summer 2026 DST.
// Note: Mexican venues (Central) are actually UTC-6 year-round, but the PRD
// defines Central as +12h to ICT, so we follow the spec.
const REGION_OFFSET_HOURS = {
  Eastern: 11,
  Central: 12,
  Western: 14,
};

// Parse "MM/DD/YYYY HH:MM" venue local time and return "YYYY-MM-DD HH:MM" in ICT.
function convertToICT(localDate, region) {
  const [datePart, timePart] = localDate.split(' ');
  const [month, day, year] = datePart.split('/');
  const [hour, minute] = timePart.split(':');
  const offset = REGION_OFFSET_HOURS[region] ?? REGION_OFFSET_HOURS.Eastern;

  // Use UTC math so the server's local timezone doesn't interfere.
  const ms =
    Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute)) +
    offset * 60 * 60 * 1000;

  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dy = String(d.getUTCDate()).padStart(2, '0');
  const hr = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${y}-${mo}-${dy} ${hr}:${mi}`;
}

function parseScore(value, field, gameId) {
  if (value == null || value === '' || value === 'null') return null;

  const score = parseInt(value, 10);
  if (Number.isFinite(score)) return score;

  console.warn(`Ignoring invalid ${field} for game ${gameId}: ${JSON.stringify(value)}`);
  return null;
}

async function fetchJSON(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WorldCup2026Tracker/1.0)' },
  });
  if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}`);
  return res.json();
}

async function sync() {
  // Fetch all three endpoints in parallel; teams fetch is best-effort.
  const [stadiumsData, gamesData, teamsResult] = await Promise.all([
    fetchJSON('/get/stadiums'),
    fetchJSON('/get/games'),
    fetchJSON('/get/teams').catch(() => null),
  ]);

  const stadiums = stadiumsData.stadiums;
  const games = gamesData.games;

  // Build in-memory maps from API data.
  const stadiumRegion = {};
  for (const s of stadiums) {
    stadiumRegion[s.id] = s.region;
  }

  const teamName = {};
  if (teamsResult?.teams) {
    for (const t of teamsResult.teams) {
      teamName[t.id] = t.name_en;
    }
  }

  const now = new Date().toISOString();

  // Upsert stadiums.
  await db.batch(
    stadiums.map((s) => ({
      sql: `INSERT INTO stadiums (api_id, name, city, region, last_synced_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(api_id) DO UPDATE SET
              name           = excluded.name,
              city           = excluded.city,
              region         = excluded.region,
              last_synced_at = excluded.last_synced_at`,
      args: [s.id, s.name_en, s.city_en, s.region, now],
    }))
  );

  // Upsert matches. Use a subquery to resolve the internal stadium FK.
  await db.batch(
    games.map((g) => {
      const region = stadiumRegion[g.stadium_id] ?? 'Eastern';
      const localDateIct = g.local_date ? convertToICT(g.local_date, region) : null;

      // For confirmed teams prefer the embedded name; fall back to teams map.
      const homeTeam =
        g.home_team_id !== '0'
          ? (g.home_team_name_en || teamName[g.home_team_id] || null)
          : null;
      const awayTeam =
        g.away_team_id !== '0'
          ? (g.away_team_name_en || teamName[g.away_team_id] || null)
          : null;

      const homeTeamLabel = g.home_team_label || null;
      const awayTeamLabel = g.away_team_label || null;

      const homeScore = parseScore(g.home_score, 'home_score', g.id);
      const awayScore = parseScore(g.away_score, 'away_score', g.id);
      const finished = g.finished === 'TRUE' ? 1 : 0;

      return {
        sql: `INSERT INTO matches (
                api_id, home_team_id, away_team_id,
                home_team, away_team, home_team_label, away_team_label,
                stage_group, type, stadium_id,
                local_date_ict, home_score, away_score, finished, last_synced_at
              )
              VALUES (
                ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, (SELECT id FROM stadiums WHERE api_id = ?),
                ?, ?, ?, ?, ?
              )
              ON CONFLICT(api_id) DO UPDATE SET
                home_team_id    = excluded.home_team_id,
                away_team_id    = excluded.away_team_id,
                home_team       = excluded.home_team,
                away_team       = excluded.away_team,
                home_team_label = excluded.home_team_label,
                away_team_label = excluded.away_team_label,
                stage_group     = excluded.stage_group,
                type            = excluded.type,
                stadium_id      = excluded.stadium_id,
                local_date_ict  = excluded.local_date_ict,
                home_score      = excluded.home_score,
                away_score      = excluded.away_score,
                finished        = excluded.finished,
                last_synced_at  = excluded.last_synced_at`,
        args: [
          g.id, g.home_team_id, g.away_team_id,
          homeTeam, awayTeam, homeTeamLabel, awayTeamLabel,
          g.group, g.type, g.stadium_id,
          localDateIct, homeScore, awayScore, finished, now,
        ],
      };
    })
  );
}

module.exports = sync;
