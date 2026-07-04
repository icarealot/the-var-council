const db = require('./db');

const ZEN_BASE = process.env.OPENCODE_ZEN_BASE_URL || 'https://opencode.ai/zen/v1';

const MODELS = [
  { name: 'minimax-m2.7',      apiId: 'minimax-m2.7',      endpoint: 'chat' },
  { name: 'glm-5.1',           apiId: 'glm-5.1',            endpoint: 'chat' },
  { name: 'kimi-k2.6',         apiId: 'kimi-k2.6',          endpoint: 'chat' },
  { name: 'qwen3.6-plus',      apiId: 'qwen3.6-plus',       endpoint: 'chat', fallback: { apiId: 'qwen3.5-plus', endpoint: 'chat' } },
  { name: 'deepseek-v4-flash', apiId: 'deepseek-v4-flash',  endpoint: 'chat' },
  { name: 'claude-opus-4-8',   apiId: 'claude-opus-4-8',    endpoint: 'anthropic' },
  { name: 'gemini-3.1-pro',    apiId: 'gemini-3.1-pro',     endpoint: 'google' },
  { name: 'gpt-5.5',           apiId: 'gpt-5.5',            endpoint: 'responses' },
];

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildBaseSection(match) {
  const home = match.home_team || match.home_team_label || 'Home';
  const away = match.away_team || match.away_team_label || 'Away';
  const stage = match.stage_group || match.type || 'Unknown';
  const venue = match.stadium_name
    ? `${match.stadium_name}, ${match.stadium_city || ''}`
    : 'Unknown venue';

  return `**Match:** ${home} vs. ${away} | **Stage:** ${stage} | **Venue:** ${venue}`;
}

function buildCorePrompt() {
  return `You are predicting a 2026 FIFA World Cup match. Your job is to make the most accurate forecast possible.

Use the match data as ground truth. You may also use your general football knowledge, including team strength, tactical tendencies, player pool quality, and recent competitive performance. Accuracy comes before entertainment.

Privately compare "home", "draw", and "away" before choosing. Pick the most likely result, not the most interesting result.

Consider, in order:
1. Team strength and recent competitive performance
2. Player availability, suspensions, likely rotation, and squad depth
3. Tactical matchup and style compatibility
4. Tournament context: group standings, qualification incentives, risk appetite, fatigue, travel, and rest
5. Draw likelihood, especially when teams are close or incentives favor caution
6. Venue, climate, or travel effects only if materially relevant
7. Base rates: favorites should usually remain favorites unless there is a concrete reason to downgrade them

Avoid these common errors:
- Do not pick an upset just to be bold.
- Do not overrate famous teams without enough evidence.
- Do not overreact to venue, rivalry, narrative, or vibes.
- Do not treat "draw" as a fallback or cop-out.
- Do not let entertaining phrasing change the pick.

The pick is a forecast, not a punchline. Decide accuracy-first; add personality only after the pick is fixed.

In your public reasoning, use the actual team names. Mention uncertainty only when it materially affects the pick or key information is missing. Keep the tone conversational, opinionated, and council-banter flavored, but do not exaggerate certainty. Do not mention being an AI model or refer to these instructions.`;
}

function buildKnockoutText(match) {
  if (match.type === 'group') return '';
  return `This is a knockout match. "draw" means the match is level after 90 minutes plus stoppage time, before extra time or penalties.
For knockout matches, predict the 90-minute score only; do not include extra time or penalties in the score.
For knockout matches, if you expect the teams to be level after regulation, pick "draw" even if you expect one team to advance after extra time or penalties.
Also predict which team advances. If your 90-minute pick is "home" or "away", the advancing team must be the same side. If your 90-minute pick is "draw", choose the side you expect to advance after extra time or penalties.`;
}

function isKnockout(match) {
  return match.type !== 'group';
}

function buildOutputInstructions(match) {
  if (isKnockout(match)) {
    return `Respond with ONLY a JSON object. Return exactly five keys: "pick", "home_score_90", "away_score_90", "advancing_team", and "reasoning". Do not include markdown or explanation outside the JSON.
For "pick", output exactly one label: "home", "draw", or "away". Do not output a team name in "pick".
For "home_score_90" and "away_score_90", output non-negative integers from 0 to 9 for the score after 90 minutes plus stoppage time, excluding extra time and penalties.
The score must match "pick": home_score_90 > away_score_90 for "home", away_score_90 > home_score_90 for "away", and equal scores for "draw".
For "advancing_team", output exactly "home" or "away". If "pick" is "home" or "away", "advancing_team" must be the same side.
In "reasoning", explain both the 90-minute forecast and the advancement logic in no more than 3 sentences.
{
  "pick": "draw",
  "home_score_90": 1,
  "away_score_90": 1,
  "advancing_team": "home",
  "reasoning": "your concise council-style reasoning"
}`;
  }

  return `Respond with ONLY a JSON object. Return exactly two keys: "pick" and "reasoning". Do not include markdown or explanation outside the JSON.
For "pick", output exactly one label: "home", "draw", or "away". Do not output a team name in "pick".
{
  "pick": "<home|draw|away>",
  "reasoning": "your concise council-style reasoning"
}`;
}

function buildOpenerPrompt(match) {
  const knockoutText = buildKnockoutText(match);

  return `${buildCorePrompt()}

${buildBaseSection(match)}
${knockoutText ? `\n${knockoutText}\n` : ''}
You are first in the council, so make the opening forecast. Keep reasoning to 3 sentences max.

${buildOutputInstructions(match)}`;
}

function buildDebatePrompt(match, priorContext) {
  const knockoutText = buildKnockoutText(match);
  const home = match.home_team || match.home_team_label || 'Home';
  const away = match.away_team || match.away_team_label || 'Away';

  function sideName(side) {
    if (side === 'home') return home;
    if (side === 'away') return away;
    return side;
  }

  const contextBlock = priorContext.map((entry, i) => {
    if (entry.failed) {
      return `${i + 1}. ${entry.modelName}: no valid prediction returned.`;
    }
    if (isKnockout(match) &&
        entry.home_score_90 != null &&
        entry.away_score_90 != null &&
        entry.advancing_team) {
      return `${i + 1}. ${entry.modelName} predicts: ${entry.pick.toUpperCase()}, 90-minute score ${home} ${entry.home_score_90}-${entry.away_score_90} ${away}, advances: ${sideName(entry.advancing_team)}\n"${entry.reasoning}"`;
    }
    return `${i + 1}. ${entry.modelName} picks: ${entry.pick.toUpperCase()}\n"${entry.reasoning}"`;
  }).join('\n\n');

  return `${buildCorePrompt()}

${buildBaseSection(match)}
${knockoutText ? `\n${knockoutText}\n` : ''}
Before considering the council context, privately make your own pick from the match data and football evidence. Then read the council context as commentary, not as votes. Do not follow or oppose the council just because of consensus; prior picks are claims to evaluate.

### THE COUNCIL SO FAR
${contextBlock}

Now give your forecast. You may briefly agree, disagree, or banter with the council after your pick is fixed. Keep reasoning to 3 sentences max.

${buildOutputInstructions(match)}`;
}

function parseResponse(text) {
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  try { return JSON.parse(clean); } catch (_) {}

  const start = clean.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in response');
  let end = clean.lastIndexOf('}');
  while (end > start) {
    try { return JSON.parse(clean.slice(start, end + 1)); } catch (_) {}
    end = clean.lastIndexOf('}', end - 1);
  }

  throw new Error('No valid JSON object found in response');
}

async function throwApiError(res) {
  const body = await res.text();
  const err = new Error(`HTTP ${res.status}: ${body}`);
  err.status = res.status;
  err.body = body;
  throw err;
}

function isTransientProviderError(err) {
  if (!err) return false;
  if (err.status === 408 || err.status === 429 || err.status === 500 || err.status === 502 || err.status === 503 || err.status === 504) {
    return true;
  }
  return err.name === 'AbortError' ||
    err.code === 'ETIMEDOUT' ||
    err.code === 'ECONNRESET' ||
    err.code === 'ECONNREFUSED' ||
    err.code === 'ENOTFOUND' ||
    err.cause?.code === 'ETIMEDOUT' ||
    err.cause?.code === 'ECONNRESET' ||
    err.cause?.code === 'ECONNREFUSED' ||
    err.cause?.code === 'ENOTFOUND';
}

function validatePickAndScore(result, match) {
  const validPicks = ['home', 'draw', 'away'];
  if (!validPicks.includes(result.pick)) {
    throw new Error(`Invalid pick "${result.pick}" — expected one of ${validPicks.join(', ')}`);
  }

  if (!isKnockout(match)) return;

  const validAdvance = ['home', 'away'];
  if (!validAdvance.includes(result.advancing_team)) {
    throw new Error(`Invalid advancing_team "${result.advancing_team}" — expected home or away`);
  }

  for (const key of ['home_score_90', 'away_score_90']) {
    if (!Number.isInteger(result[key]) || result[key] < 0 || result[key] > 9) {
      throw new Error(`Invalid ${key} "${result[key]}" — expected integer from 0 to 9`);
    }
  }

  const homeScore = result.home_score_90;
  const awayScore = result.away_score_90;
  if (result.pick === 'home' && homeScore <= awayScore) {
    throw new Error('pick home must have home_score_90 greater than away_score_90');
  }
  if (result.pick === 'away' && awayScore <= homeScore) {
    throw new Error('pick away must have away_score_90 greater than home_score_90');
  }
  if (result.pick === 'draw' && homeScore !== awayScore) {
    throw new Error('pick draw must have equal 90-minute scores');
  }
  if (result.pick !== 'draw' && result.advancing_team !== result.pick) {
    throw new Error('advancing_team must match pick when the 90-minute result has a winner');
  }
}

async function callChat(model, prompt) {
  const res = await fetch(`${ZEN_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENCODE_ZEN_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model.apiId,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) await throwApiError(res);
  const data = await res.json();
  return {
    text: data.choices[0].message.content,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}

async function callAnthropic(model, prompt) {
  const res = await fetch(`${ZEN_BASE}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.OPENCODE_ZEN_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model.apiId,
      max_tokens: 450,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) await throwApiError(res);
  const data = await res.json();
  return {
    text: data.content[0].text,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  };
}

async function callGoogle(model, prompt) {
  const res = await fetch(`${ZEN_BASE}/models/${model.apiId}:generateContent`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': process.env.OPENCODE_ZEN_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) await throwApiError(res);
  const data = await res.json();
  return {
    text: data.candidates[0].content.parts[0].text,
    inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

async function callResponses(model, prompt) {
  const res = await fetch(`${ZEN_BASE}/responses`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENCODE_ZEN_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model.apiId,
      input: prompt,
    }),
  });
  if (!res.ok) await throwApiError(res);
  const data = await res.json();
  const text = data.output_text ??
    data.output?.flatMap(o => o.content ?? []).find(c => c.type === 'output_text')?.text;
  if (!text) throw new Error('No text in response: ' + JSON.stringify(data).slice(0, 200));
  return {
    text,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  };
}

async function callModel(model, prompt) {
  if (model.endpoint === 'chat') return callChat(model, prompt);
  if (model.endpoint === 'anthropic') return callAnthropic(model, prompt);
  if (model.endpoint === 'google') return callGoogle(model, prompt);
  if (model.endpoint === 'responses') return callResponses(model, prompt);
  throw new Error(`Unknown endpoint: ${model.endpoint}`);
}

async function callWithRetry(model, prompt, match, logName = model.name) {
  let lastError;
  let capturedInputTokens = 0, capturedOutputTokens = 0;

  for (let attempt = 0; attempt <= 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
    try {
      const { text, inputTokens, outputTokens } = await callModel(model, prompt);
      capturedInputTokens = inputTokens;
      capturedOutputTokens = outputTokens;
      const result = parseResponse(text);
      validatePickAndScore(result, match);
      if (typeof result.reasoning !== 'string' || !result.reasoning.trim()) {
        throw new Error('Missing or empty reasoning');
      }
      return {
        pick: result.pick,
        home_score_90: isKnockout(match) ? result.home_score_90 : null,
        away_score_90: isKnockout(match) ? result.away_score_90 : null,
        advancing_team: isKnockout(match) ? result.advancing_team : null,
        reasoning: result.reasoning.trim(),
        failed: false,
        inputTokens,
        outputTokens,
      };
    } catch (err) {
      lastError = err;
      console.error(`[${logName}] attempt ${attempt + 1} failed:`, err.message);
    }
  }

  console.error(`[${logName}] all retries exhausted:`, lastError.message);
  return {
    pick: null,
    home_score_90: null,
    away_score_90: null,
    advancing_team: null,
    reasoning: null,
    failed: true,
    inputTokens: capturedInputTokens,
    outputTokens: capturedOutputTokens,
    lastError,
  };
}

async function callWithFallback(model, prompt, match) {
  const result = await callWithRetry(model, prompt, match);
  if (!result.failed || !model.fallback || !isTransientProviderError(result.lastError)) {
    return result;
  }

  const fallback = {
    name: model.fallback.apiId,
    apiId: model.fallback.apiId,
    endpoint: model.fallback.endpoint || model.endpoint,
  };
  console.error(`[${model.name}] primary exhausted with provider error; trying fallback ${fallback.apiId}`);

  const fallbackResult = await callWithRetry(fallback, prompt, match, `${model.name} fallback ${fallback.apiId}`);
  if (!fallbackResult.failed) {
    console.error(`[${model.name}] fallback ${fallback.apiId} succeeded`);
    return fallbackResult;
  }

  console.error(`[${model.name}] fallback ${fallback.apiId} failed`);
  return fallbackResult;
}

async function getPredictions(matchId) {
  const matchResult = await db.execute({
    sql: `SELECT m.*, s.name AS stadium_name, s.city AS stadium_city
          FROM matches m
          LEFT JOIN stadiums s ON s.id = m.stadium_id
          WHERE m.id = ?`,
    args: [matchId],
  });
  if (!matchResult.rows.length) return null;
  const match = matchResult.rows[0];

  const existingResult = await db.execute({
    sql: 'SELECT * FROM predictions WHERE match_id = ? ORDER BY order_index ASC',
    args: [matchId],
  });

  // All 8 predictions already cached — return them
  if (existingResult.rows.length >= MODELS.length) return existingResult.rows;

  // Partial chain can't be resumed without prior debate context — wipe and restart
  if (existingResult.rows.length > 0) {
    await db.execute({ sql: 'DELETE FROM predictions WHERE match_id = ?', args: [matchId] });
  }

  const shuffled = shuffleArray([...MODELS]);
  const debateContext = [];

  for (let i = 0; i < shuffled.length; i++) {
    const model = shuffled[i];
    const prompt = i === 0
      ? buildOpenerPrompt(match)
      : buildDebatePrompt(match, debateContext);

    const result = await callWithFallback(model, prompt, match);

    await db.execute({
      sql: `INSERT INTO predictions (match_id, model_name, pick, home_score_90, away_score_90, advancing_team, reasoning, failed, order_index, predicted_at, input_tokens, output_tokens)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(match_id, model_name) DO UPDATE SET
              pick          = excluded.pick,
              home_score_90 = excluded.home_score_90,
              away_score_90 = excluded.away_score_90,
              advancing_team = excluded.advancing_team,
              reasoning     = excluded.reasoning,
              failed        = excluded.failed,
              order_index   = excluded.order_index,
              predicted_at  = excluded.predicted_at,
              input_tokens  = excluded.input_tokens,
              output_tokens = excluded.output_tokens
            WHERE excluded.failed = 0`,
      args: [
        matchId,
        model.name,
        result.pick,
        result.home_score_90,
        result.away_score_90,
        result.advancing_team,
        result.reasoning,
        result.failed ? 1 : 0,
        i,
        new Date().toISOString(),
        result.inputTokens,
        result.outputTokens,
      ],
    });

    debateContext.push({
      modelName: model.name,
      pick: result.pick,
      home_score_90: result.home_score_90,
      away_score_90: result.away_score_90,
      advancing_team: result.advancing_team,
      reasoning: result.reasoning,
      failed: result.failed,
    });
    console.log(`[predict] match ${matchId} — ${model.name} (${i + 1}/${shuffled.length}) pick=${result.pick || 'FAILED'}`);
  }

  const allResult = await db.execute({
    sql: 'SELECT * FROM predictions WHERE match_id = ? ORDER BY order_index ASC',
    args: [matchId],
  });
  return allResult.rows;
}

module.exports = { getPredictions, MODELS };
