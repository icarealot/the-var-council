const db = require('./db');
const {
  MODELS,
  callModel,
  parseResponse,
  isTransientProviderError,
} = require('./predict');

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function matchWinner(match, nextRoundTeams) {
  if (!match.finished) return null;
  if (match.home_score > match.away_score) return match.home_team;
  if (match.away_score > match.home_score) return match.away_team;
  const candidates = [match.home_team, match.away_team].filter(Boolean);
  return candidates.find((team) => nextRoundTeams.has(team)) || null;
}

function matchRef(label) {
  const found = label && String(label).match(/Winner Match (\d+)/i);
  return found ? found[1] : null;
}

async function buildTournamentContext() {
  const knockoutResult = await db.execute(`
    SELECT api_id, home_team, away_team, home_team_id, away_team_id,
           home_team_label, away_team_label, type, local_date_ict,
           home_score, away_score, finished
    FROM matches
    WHERE type IN ('qf', 'sf', 'final')
    ORDER BY local_date_ict ASC
  `);
  const matches = knockoutResult.rows;
  const quarterfinals = matches.filter((match) => match.type === 'qf');
  const semifinals = matches.filter((match) => match.type === 'sf');
  const final = matches.find((match) => match.type === 'final');

  if (quarterfinals.length !== 4) {
    throw new Error('Champion predictions require all four quarterfinal matches');
  }

  const semifinalTeams = new Set(
    semifinals.flatMap((match) => [match.home_team, match.away_team]).filter(Boolean)
  );
  const finalTeams = new Set(
    final ? [final.home_team, final.away_team].filter(Boolean) : []
  );

  const sideByQuarterfinal = new Map();
  for (let index = 0; index < quarterfinals.length; index++) {
    const quarterfinal = quarterfinals[index];
    const parentIndex = semifinals.findIndex((semifinal) =>
      matchRef(semifinal.home_team_label) === String(quarterfinal.api_id) ||
      matchRef(semifinal.away_team_label) === String(quarterfinal.api_id)
    );
    sideByQuarterfinal.set(
      String(quarterfinal.api_id),
      parentIndex >= 0 ? String(parentIndex) : String(index < 2 ? 0 : 1)
    );
  }

  const alive = new Map();
  for (const quarterfinal of quarterfinals) {
    const teams = [
      { name: quarterfinal.home_team, id: quarterfinal.home_team_id },
      { name: quarterfinal.away_team, id: quarterfinal.away_team_id },
    ].filter((team) => team.name && team.id && team.id !== '0');
    if (teams.length !== 2) {
      throw new Error('Champion predictions require confirmed quarterfinal teams');
    }

    const winner = matchWinner(quarterfinal, semifinalTeams);
    if (quarterfinal.finished && !winner) {
      throw new Error(`Cannot determine the winner of quarterfinal ${quarterfinal.api_id}`);
    }
    for (const team of teams) {
      if (!quarterfinal.finished || team.name === winner) {
        alive.set(team.name, {
          name: team.name,
          side: sideByQuarterfinal.get(String(quarterfinal.api_id)),
        });
      }
    }
  }

  for (const semifinal of semifinals) {
    const winner = matchWinner(semifinal, finalTeams);
    if (!semifinal.finished) continue;
    if (!winner) {
      throw new Error(`Cannot determine the winner of semifinal ${semifinal.api_id}`);
    }
    for (const team of [semifinal.home_team, semifinal.away_team].filter(Boolean)) {
      if (team !== winner) alive.delete(team);
    }
  }

  if (final && final.finished) {
    const winner = matchWinner(final, new Set());
    if (!winner) throw new Error(`Cannot determine the winner of final ${final.api_id}`);
    for (const team of [final.home_team, final.away_team].filter(Boolean)) {
      if (team !== winner) alive.delete(team);
    }
  }

  const eligibleTeams = [...alive.values()];
  if (eligibleTeams.length < 2 || new Set(eligibleTeams.map((team) => team.side)).size < 2) {
    throw new Error('At least one eligible team from each side of the bracket is required');
  }

  const resultsResult = await db.execute(`
    SELECT home_team, away_team, home_score, away_score, stage_group, type, local_date_ict
    FROM matches
    WHERE finished = 1 AND home_team IS NOT NULL AND away_team IS NOT NULL
    ORDER BY local_date_ict ASC
  `);

  const completedResults = resultsResult.rows.map((match) =>
    `${match.home_team} ${match.home_score}-${match.away_score} ${match.away_team} (${match.stage_group || match.type})`
  );
  const bracket = matches.map((match) => {
    const home = match.home_team || match.home_team_label || 'TBD';
    const away = match.away_team || match.away_team_label || 'TBD';
    const score = match.finished ? `, result ${match.home_score}-${match.away_score}` : '';
    return `${String(match.type).toUpperCase()}: ${home} vs ${away}${score}`;
  });

  return {
    eligibleTeams,
    bracket,
    completedResults,
    modelOrder: shuffleArray(MODELS.map((model) => model.name)),
  };
}

async function getOrCreateRun() {
  const existing = await db.execute('SELECT context_json, created_at FROM champion_runs WHERE id = 1');
  if (existing.rows.length) {
    return {
      context: JSON.parse(existing.rows[0].context_json),
      createdAt: existing.rows[0].created_at,
    };
  }

  const context = await buildTournamentContext();
  const createdAt = new Date().toISOString();
  await db.execute({
    sql: 'INSERT OR IGNORE INTO champion_runs (id, context_json, created_at) VALUES (1, ?, ?)',
    args: [JSON.stringify(context), createdAt],
  });

  const saved = await db.execute('SELECT context_json, created_at FROM champion_runs WHERE id = 1');
  return {
    context: JSON.parse(saved.rows[0].context_json),
    createdAt: saved.rows[0].created_at,
  };
}

function buildPrompt(context) {
  return `You are forecasting the 2026 FIFA World Cup finalists and champion.

Use the tournament snapshot below as ground truth. Only select teams listed as eligible. Consider team strength, tournament performance, squad quality, injuries or suspensions you reliably know, tactical matchups, and each team's remaining bracket path.

Predict the most likely outcome, not the most entertaining or surprising outcome. Do not select an upset merely to appear bold. Make this forecast independently; you cannot see other council members' predictions. Fix the forecast before writing the reasoning, then use a light, conversational council-banter style without exaggerating certainty.

ELIGIBLE TEAMS
${context.eligibleTeams.map((team) => `- ${team.name}`).join('\n')}

CURRENT KNOCKOUT BRACKET
${context.bracket.join('\n')}

COMPLETED TOURNAMENT RESULTS
${context.completedResults.join('\n')}

Rules:
- Select exactly two different finalists.
- Both finalists must be eligible.
- The finalists must come from opposite sides of the bracket and be capable of meeting in the final.
- The champion must be one of the two finalists.
- Explain the likely paths to the final and why the champion wins.
- Keep the reasoning concise, with no more than three sentences.
- Use actual team names exactly as supplied.

Respond with ONLY this JSON object and no markdown:
{
  "finalist_1": "<team name>",
  "finalist_2": "<team name>",
  "champion": "<team name>",
  "reasoning": "<brief reasoning>"
}`;
}

function canonicalTeam(value, context) {
  if (typeof value !== 'string') return null;
  const wanted = value.trim().toLocaleLowerCase('en');
  return context.eligibleTeams.find((team) =>
    team.name.toLocaleLowerCase('en') === wanted
  ) || null;
}

function validateResponse(result, context) {
  const first = canonicalTeam(result.finalist_1, context);
  const second = canonicalTeam(result.finalist_2, context);
  const champion = canonicalTeam(result.champion, context);
  if (!first || !second || !champion) {
    throw new Error('Finalists and champion must be eligible team names');
  }
  if (first.name === second.name) throw new Error('Finalists must be different teams');
  if (first.side === second.side) throw new Error('Finalists must come from opposite bracket sides');
  if (champion.name !== first.name && champion.name !== second.name) {
    throw new Error('Champion must be one of the finalists');
  }
  if (typeof result.reasoning !== 'string' || !result.reasoning.trim()) {
    throw new Error('Missing or empty reasoning');
  }
  return {
    finalist_1: first.name,
    finalist_2: second.name,
    champion: champion.name,
    reasoning: result.reasoning.trim(),
  };
}

async function predictModel(model, context) {
  const prompt = buildPrompt(context);
  async function attemptCandidate(candidate, label) {
    let lastError;
    for (let attempt = 0; attempt <= 3; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (2 ** (attempt - 1))));
      }
      try {
        const response = await callModel(candidate, prompt);
        return {
          result: {
            ...validateResponse(parseResponse(response.text), context),
            inputTokens: response.inputTokens,
            outputTokens: response.outputTokens,
          },
          error: null,
        };
      } catch (error) {
        lastError = error;
        console.error(`[champion:${label}] attempt ${attempt + 1} failed:`, error.message);
      }
    }
    return { result: null, error: lastError };
  }

  const primary = await attemptCandidate(model, model.name);
  if (primary.result) return primary.result;
  if (!model.fallback || !isTransientProviderError(primary.error)) throw primary.error;

  const fallback = {
    name: model.fallback.apiId,
    apiId: model.fallback.apiId,
    endpoint: model.fallback.endpoint || model.endpoint,
  };
  const secondary = await attemptCandidate(fallback, `${model.name}:fallback`);
  if (secondary.result) return secondary.result;
  throw secondary.error;
}

async function getChampionPredictions() {
  const run = await getOrCreateRun();
  const existing = await db.execute(
    'SELECT * FROM champion_predictions ORDER BY order_index ASC'
  );
  const completed = new Set(existing.rows.map((row) => row.model_name));
  const missing = MODELS.filter((model) => !completed.has(model.name));

  await Promise.all(missing.map(async (model) => {
    try {
      const result = await predictModel(model, run.context);
      const orderIndex = run.context.modelOrder.indexOf(model.name);
      await db.execute({
        sql: `INSERT OR IGNORE INTO champion_predictions
              (run_id, model_name, finalist_1, finalist_2, champion, reasoning,
               order_index, predicted_at, input_tokens, output_tokens)
              VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          model.name,
          result.finalist_1,
          result.finalist_2,
          result.champion,
          result.reasoning,
          orderIndex,
          new Date().toISOString(),
          result.inputTokens,
          result.outputTokens,
        ],
      });
    } catch (error) {
      console.error(`[champion:${model.name}] retries exhausted:`, error.message);
    }
  }));

  const result = await db.execute(
    'SELECT * FROM champion_predictions ORDER BY order_index ASC'
  );
  return { predictions: result.rows, total: MODELS.length };
}

async function readChampionPredictions() {
  const result = await db.execute(
    'SELECT * FROM champion_predictions ORDER BY order_index ASC'
  );
  return { predictions: result.rows, total: MODELS.length };
}

module.exports = {
  getChampionPredictions,
  readChampionPredictions,
  buildTournamentContext,
  validateResponse,
};
