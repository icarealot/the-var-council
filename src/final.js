const db = require('./db');
const {
  getPredictions,
  retryFailedPredictions,
  MODELS,
  callModel,
  parseResponse,
  isTransientProviderError,
} = require('./predict');

const FINAL_FIELDS = [
  'opening_goal_team',
  'closing_goal_team',
  'own_goal',
  'penalty_goal',
  'both_teams_score_90',
  'total_player_cards',
  'most_player_cards',
  'team_official_card_90',
  'total_corners',
  'last_corner_team',
];

function kickoffEpoch(ictValue) {
  const found = String(ictValue || '').match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (!found) return null;
  const [, year, month, day, hour, minute] = found.map(Number);
  return Date.UTC(year, month - 1, day, hour - 7, minute);
}

function kickoffHasPassed(match, now = Date.now()) {
  const epoch = kickoffEpoch(match?.local_date_ict);
  return epoch == null ? false : now >= epoch;
}

function isConfirmed(match) {
  return !!(
    match &&
    match.home_team &&
    match.away_team &&
    match.home_team_id !== '0' &&
    match.away_team_id !== '0'
  );
}

function runMatches(run, match) {
  return !!(
    run && match &&
    Number(run.match_id) === Number(match.id) &&
    run.home_team === match.home_team &&
    run.away_team === match.away_team
  );
}

async function getFinalMatch() {
  const result = await db.execute(`
    SELECT m.*, s.name AS stadium_name, s.city AS stadium_city
    FROM matches m
    LEFT JOIN stadiums s ON s.id = m.stadium_id
    WHERE m.type = 'final'
    ORDER BY m.local_date_ict DESC
    LIMIT 1
  `);
  return result.rows[0] || null;
}

async function buildContext(match) {
  const results = await db.execute({
    sql: `SELECT home_team, away_team, home_score, away_score, stage_group, type, local_date_ict
          FROM matches
          WHERE finished = 1
            AND home_team IS NOT NULL
            AND away_team IS NOT NULL
            AND (home_team IN (?, ?) OR away_team IN (?, ?))
          ORDER BY local_date_ict ASC`,
    args: [match.home_team, match.away_team, match.home_team, match.away_team],
  });

  return {
    matchId: Number(match.id),
    homeTeam: match.home_team,
    awayTeam: match.away_team,
    kickoffIct: match.local_date_ict,
    venue: match.stadium_name || null,
    city: match.stadium_city || null,
    completedResults: results.rows.map((row) => {
      const stage = row.stage_group || row.type || 'match';
      return `${row.home_team} ${row.home_score}-${row.away_score} ${row.away_team} (${stage})`;
    }),
  };
}

function buildPrompt(context, basePrediction) {
  const venue = context.venue
    ? `${context.venue}${context.city ? `, ${context.city}` : ''}`
    : 'Unknown venue';
  const completed = context.completedResults.length
    ? context.completedResults.map((result) => `- ${result}`).join('\n')
    : '- No completed results supplied.';

  return `You are forecasting event markets for the 2026 FIFA World Cup final.

Use the supplied match snapshot as ground truth and make the most accurate choices possible. Use your general football knowledge about team strength, tactical style, discipline, set-piece patterns, and player tendencies. Do not invent unavailable lineups, referee assignments, card counts, or corner counts.

MATCH
Home: ${context.homeTeam}
Away: ${context.awayTeam}
Kickoff: ${context.kickoffIct} ICT (UTC+7)
Venue: ${venue}

COMPLETED WORLD CUP RESULTS FOR THE FINALISTS
${completed}

YOUR LOCKED MATCH FORECAST
90 minutes plus first- and second-half stoppage time: ${context.homeTeam} ${basePrediction.home_score_90}-${basePrediction.away_score_90} ${context.awayTeam}
Result pick: ${basePrediction.pick}
Final winner: ${basePrediction.advancing_team === 'home' ? context.homeTeam : context.awayTeam}
This score is locked. Your ten choices must be logically compatible with it.

DEFINITIONS
- Output team choices as "home" or "away", never as team names.
- Questions 1-2 cover the full match sequence: regulation plus stoppage time, extra time plus stoppage time, and the penalty shootout if the match remains level. If regulation has a winner, the sequence ends after regulation.
- For questions 1-2, normal and extra-time goals are scoring events. Each successful penalty-shootout kick is also a scoring event for these two questions only; a missed or saved kick is not.
- opening_goal_team is the team responsible for the first scoring event in that full sequence. closing_goal_team is the team responsible for the last successful scoring event, even when the shootout ends with the other team missing its final kick.
- For a normal or extra-time own goal, select the team awarded the goal on the scoreboard, not the player's team.
- Questions 3-4, 6-7, and 9-10 cover regulation plus first- and second-half stoppage time. They exclude extra time and the penalty shootout.
- Questions 5 and 8 cover the 90 regulation minutes only and exclude all stoppage time, extra time, and the penalty shootout.
- own_goal is "yes" only for a goal officially recorded as an own goal.
- penalty_goal is "yes" only when the penalty kick itself is scored. A missed or saved penalty and a rebound goal do not count.
- total_player_cards and most_player_cards include players and substitutes, but exclude team officials. Count every card shown: two yellows followed by the resulting red contribute three cards; a direct red contributes one.
- team_official_card_90 includes coaches, assistants, and registered technical staff, but excludes substitute players.
- If no corner is taken, last_corner_team must be "none".

Return ONLY a JSON object with exactly these ten keys and enum values:
{
  "opening_goal_team": "home|away",
  "closing_goal_team": "home|away",
  "own_goal": "yes|no",
  "penalty_goal": "yes|no",
  "both_teams_score_90": "yes|no",
  "total_player_cards": "over_4_5|under_4_5",
  "most_player_cards": "home|away|tie",
  "team_official_card_90": "yes|no",
  "total_corners": "over_6_5|under_6_5",
  "last_corner_team": "home|away|none"
}`;
}

function assertEnum(result, key, allowed) {
  if (!allowed.includes(result[key])) {
    throw new Error(`Invalid ${key} "${result[key]}"; expected ${allowed.join(', ')}`);
  }
}

function validateResponse(result, basePrediction) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('Final prediction must be a JSON object');
  }

  const keys = Object.keys(result).sort();
  const expected = [...FINAL_FIELDS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error(`Final prediction must contain exactly: ${FINAL_FIELDS.join(', ')}`);
  }

  assertEnum(result, 'opening_goal_team', ['home', 'away']);
  assertEnum(result, 'closing_goal_team', ['home', 'away']);
  assertEnum(result, 'own_goal', ['yes', 'no']);
  assertEnum(result, 'penalty_goal', ['yes', 'no']);
  assertEnum(result, 'both_teams_score_90', ['yes', 'no']);
  assertEnum(result, 'total_player_cards', ['over_4_5', 'under_4_5']);
  assertEnum(result, 'most_player_cards', ['home', 'away', 'tie']);
  assertEnum(result, 'team_official_card_90', ['yes', 'no']);
  assertEnum(result, 'total_corners', ['over_6_5', 'under_6_5']);
  assertEnum(result, 'last_corner_team', ['home', 'away', 'none']);

  const homeScore = Number(basePrediction.home_score_90);
  const awayScore = Number(basePrediction.away_score_90);
  if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore)) {
    throw new Error('A valid locked 90-minute score is required');
  }

  const totalGoals = homeScore + awayScore;
  if (totalGoals === 0) {
    if (result.own_goal !== 'no' || result.penalty_goal !== 'no' || result.both_teams_score_90 !== 'no') {
      throw new Error('A 0-0 regulation forecast cannot contain a regulation own goal, regulation penalty goal, or both teams scoring');
    }
  }

  // When regulation already contains a goal, the first full-match scoring
  // event must be compatible with that locked score.
  if (totalGoals > 0 && homeScore === 0 && result.opening_goal_team === 'home') {
    throw new Error('The home team cannot score first when its locked regulation score is zero');
  }
  if (totalGoals > 0 && awayScore === 0 && result.opening_goal_team === 'away') {
    throw new Error('The away team cannot score first when its locked regulation score is zero');
  }

  // A regulation winner ends the match after 90 minutes. Only a regulation
  // draw can add extra-time or shootout scoring events.
  if (homeScore !== awayScore) {
    if (homeScore === 0 && result.closing_goal_team === 'home') {
      throw new Error('The home team cannot score last when its locked regulation score is zero');
    }
    if (awayScore === 0 && result.closing_goal_team === 'away') {
      throw new Error('The away team cannot score last when its locked regulation score is zero');
    }
    if (totalGoals === 1 && result.opening_goal_team !== result.closing_goal_team) {
      throw new Error('The opening and closing scoring teams must match in a one-goal regulation forecast');
    }
  }

  if ((homeScore === 0 || awayScore === 0) && result.both_teams_score_90 !== 'no') {
    throw new Error('Both teams cannot score in 90 minutes when a locked final score is zero for one side');
  }
  if (result.total_corners === 'over_6_5' && result.last_corner_team === 'none') {
    throw new Error('Over 6.5 corners requires a team to take the last corner');
  }
  if (result.last_corner_team === 'none' && result.total_corners !== 'under_6_5') {
    throw new Error('No corners requires under 6.5 total corners');
  }

  return Object.fromEntries(FINAL_FIELDS.map((key) => [key, result[key]]));
}

async function predictModel(model, context, basePrediction) {
  const prompt = buildPrompt(context, basePrediction);

  async function attempt(candidate, label) {
    let lastError;
    for (let index = 0; index <= 3; index++) {
      if (index > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (2 ** (index - 1))));
      }
      try {
        const response = await callModel(candidate, prompt);
        return {
          prediction: validateResponse(parseResponse(response.text), basePrediction),
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
        };
      } catch (error) {
        lastError = error;
        console.error(`[final:${label}] attempt ${index + 1} failed:`, error.message);
      }
    }
    throw lastError;
  }

  try {
    return await attempt(model, model.name);
  } catch (error) {
    if (!model.fallback || !isTransientProviderError(error)) throw error;
    const fallback = {
      name: model.fallback.apiId,
      apiId: model.fallback.apiId,
      endpoint: model.fallback.endpoint || model.endpoint,
    };
    return attempt(fallback, `${model.name}:fallback`);
  }
}

async function readRun() {
  const result = await db.execute('SELECT * FROM final_runs WHERE id = 1');
  return result.rows[0] || null;
}

async function readRows() {
  const result = await db.execute('SELECT * FROM final_predictions WHERE run_id = 1 ORDER BY order_index ASC');
  return result.rows;
}

function publicMatch(match, run = null) {
  if (!match) return null;
  return {
    id: Number(match.id),
    home_team: run?.home_team || match.home_team,
    away_team: run?.away_team || match.away_team,
    home_team_id: match.home_team_id,
    away_team_id: match.away_team_id,
    local_date_ict: run?.kickoff_ict || match.local_date_ict,
    stadium_name: match.stadium_name || null,
    stadium_city: match.stadium_city || null,
    finished: Number(match.finished) === 1,
  };
}

async function readFinalPredictions(now = Date.now()) {
  const match = await getFinalMatch();
  if (!match) {
    return { status: 'waiting_for_match', can_generate: false, match: null, predictions: [], total: MODELS.length };
  }
  if (!isConfirmed(match)) {
    return { status: 'waiting_for_teams', can_generate: false, match: publicMatch(match), predictions: [], total: MODELS.length };
  }
  if (kickoffEpoch(match.local_date_ict) == null) {
    return { status: 'waiting_for_schedule', can_generate: false, match: publicMatch(match), predictions: [], total: MODELS.length };
  }

  const run = await readRun();
  const passed = kickoffHasPassed(match, now);
  const matchesCurrentFinal = runMatches(run, match);
  const rows = run && (matchesCurrentFinal || passed) ? await readRows() : [];
  const canGenerate = !passed && rows.length < MODELS.length;
  let status = 'ready';
  if (rows.length >= MODELS.length) status = 'complete';
  else if (passed && rows.length === 0) status = 'locked_empty';
  else if (passed) status = 'locked_partial';

  return {
    status,
    can_generate: canGenerate,
    match: publicMatch(match, run && (!matchesCurrentFinal && passed) ? run : null),
    predictions: rows,
    total: MODELS.length,
  };
}

async function ensureRun(match) {
  const existing = await readRun();
  if (runMatches(existing, match)) {
    return { row: existing, context: JSON.parse(existing.context_json) };
  }
  if (kickoffHasPassed(match)) {
    throw new Error('Final predictions are locked because kickoff has passed');
  }

  if (existing) {
    const matchIds = [...new Set([Number(existing.match_id), Number(match.id)])];
    const deletes = [
      'DELETE FROM final_predictions',
      'DELETE FROM final_runs',
      ...matchIds.map((matchId) => ({ sql: 'DELETE FROM predictions WHERE match_id = ?', args: [matchId] })),
    ];
    await db.batch(deletes);
  }

  const context = await buildContext(match);
  const createdAt = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO final_runs (id, match_id, home_team, away_team, kickoff_ict, context_json, created_at)
          VALUES (1, ?, ?, ?, ?, ?, ?)`,
    args: [match.id, match.home_team, match.away_team, match.local_date_ict, JSON.stringify(context), createdAt],
  });
  return {
    row: {
      id: 1,
      match_id: match.id,
      home_team: match.home_team,
      away_team: match.away_team,
      kickoff_ict: match.local_date_ict,
      created_at: createdAt,
    },
    context,
  };
}

async function ensureBasePredictions(match) {
  const existing = await db.execute({
    sql: 'SELECT * FROM predictions WHERE match_id = ? ORDER BY order_index ASC',
    args: [match.id],
  });
  const snapshotsMatch = existing.rows.every((row) =>
    row.home_team_snapshot === match.home_team && row.away_team_snapshot === match.away_team
  );
  if (existing.rows.length && !snapshotsMatch) {
    await db.execute({ sql: 'DELETE FROM predictions WHERE match_id = ?', args: [match.id] });
  }
  return getPredictions(match.id);
}

async function savePrediction(model, prediction, orderIndex) {
  const values = FINAL_FIELDS.map((field) => prediction.prediction[field]);
  await db.execute({
    sql: `INSERT OR IGNORE INTO final_predictions
          (run_id, model_name, ${FINAL_FIELDS.join(', ')}, order_index, predicted_at, input_tokens, output_tokens)
          VALUES (1, ?, ${FINAL_FIELDS.map(() => '?').join(', ')}, ?, ?, ?, ?)`,
    args: [
      model.name,
      ...values,
      orderIndex,
      new Date().toISOString(),
      prediction.inputTokens,
      prediction.outputTokens,
    ],
  });
}

async function getFinalPredictions() {
  const passStartedAt = Date.now();
  const match = await getFinalMatch();
  if (!match) throw new Error('No final match is scheduled');
  if (!isConfirmed(match)) throw new Error('Final predictions require two confirmed teams');
  if (kickoffEpoch(match.local_date_ict) == null) throw new Error('Final predictions require a scheduled kickoff');
  if (kickoffHasPassed(match)) throw new Error('Final predictions are locked because kickoff has passed');

  console.log(
    `[final] generation pass started match=${match.id} teams="${match.home_team} vs ${match.away_team}" kickoff_ict="${match.local_date_ict}"`
  );

  const run = await ensureRun(match);
  const existing = await readRows();
  if (existing.length >= MODELS.length) {
    console.log(`[final] generation skipped saved=${existing.length}/${MODELS.length} reason=complete`);
    return readFinalPredictions();
  }

  let baseRows = await ensureBasePredictions(match);
  const baseFailures = baseRows.filter((row) => row.failed).map((row) => row.model_name);
  console.log(
    `[final] base forecasts ready valid=${baseRows.length - baseFailures.length}/${MODELS.length}` +
    (baseFailures.length ? ` failed="${baseFailures.join(',')}"` : '')
  );
  if (kickoffHasPassed(match)) {
    console.log('[final] generation stopped reason=kickoff_passed_after_base_forecasts');
    return readFinalPredictions();
  }

  async function generateAvailable(rows) {
    const saved = await readRows();
    const completed = new Set(saved.map((row) => row.model_name));
    const baseByModel = new Map(
      rows
        .filter((row) =>
          !row.failed &&
          row.home_score_90 != null &&
          row.away_score_90 != null &&
          Number.isInteger(Number(row.home_score_90)) &&
          Number.isInteger(Number(row.away_score_90))
        )
        .map((row) => [row.model_name, row])
    );
    const missing = MODELS.filter((model) => !completed.has(model.name) && baseByModel.has(model.name));

    if (missing.length) {
      console.log(`[final] event forecasts starting models="${missing.map((model) => model.name).join(',')}"`);
    }

    await Promise.all(missing.map(async (model) => {
      if (kickoffHasPassed(match)) {
        console.log(`[final:${model.name}] skipped reason=kickoff_passed`);
        return;
      }
      const modelStartedAt = Date.now();
      const basePrediction = baseByModel.get(model.name);
      console.log(
        `[final:${model.name}] started locked_score=${basePrediction.home_score_90}-${basePrediction.away_score_90}`
      );
      try {
        const prediction = await predictModel(model, run.context, basePrediction);
        await savePrediction(model, prediction, MODELS.findIndex((entry) => entry.name === model.name));
        const progress = (await readRows()).length;
        console.log(
          `[final:${model.name}] saved duration_ms=${Date.now() - modelStartedAt}` +
          ` tokens_in=${prediction.inputTokens || 0} tokens_out=${prediction.outputTokens || 0}` +
          ` progress=${progress}/${MODELS.length}`
        );
      } catch (error) {
        console.error(
          `[final:${model.name}] failed duration_ms=${Date.now() - modelStartedAt} error="${error.message}"`
        );
      }
    }));
  }

  // Publish every model that already has a locked score before attempting to
  // recover a failed base forecast. A silent provider must not hold back the
  // other charts.
  await generateAvailable(baseRows);

  if (baseRows.some((row) => row.failed) && !kickoffHasPassed(match)) {
    console.log(
      `[final] base recovery starting models="${baseRows.filter((row) => row.failed).map((row) => row.model_name).join(',')}"`
    );
    baseRows = await retryFailedPredictions(match.id);
    const remainingFailures = baseRows.filter((row) => row.failed).map((row) => row.model_name);
    console.log(
      `[final] base recovery finished valid=${baseRows.length - remainingFailures.length}/${MODELS.length}` +
      (remainingFailures.length ? ` failed="${remainingFailures.join(',')}"` : '')
    );
    if (!kickoffHasPassed(match)) await generateAvailable(baseRows);
  }

  const result = await readFinalPredictions();
  console.log(
    `[final] generation pass finished duration_ms=${Date.now() - passStartedAt}` +
    ` saved=${result.predictions.length}/${result.total} status=${result.status}`
  );
  return result;
}

module.exports = {
  FINAL_FIELDS,
  buildPrompt,
  validateResponse,
  kickoffEpoch,
  kickoffHasPassed,
  getFinalPredictions,
  readFinalPredictions,
};
