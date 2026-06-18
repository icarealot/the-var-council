const db = require('./db');

const ZEN_BASE = process.env.OPENCODE_ZEN_BASE_URL || 'https://opencode.ai/zen/v1';

const MODELS = [
  { name: 'minimax-m2.7',      apiId: 'minimax-m2.7',      endpoint: 'chat' },
  { name: 'glm-5.1',           apiId: 'glm-5.1',            endpoint: 'chat' },
  { name: 'kimi-k2.6',         apiId: 'kimi-k2.6',          endpoint: 'chat' },
  { name: 'qwen3.6-plus',      apiId: 'qwen3.6-plus',       endpoint: 'chat' },
  { name: 'deepseek-v4-flash', apiId: 'deepseek-v4-flash',  endpoint: 'chat' },
  { name: 'claude-opus-4-8',   apiId: 'claude-opus-4-8',    endpoint: 'anthropic' },
  { name: 'gemini-3.1-pro',    apiId: 'gemini-3.1-pro',     endpoint: 'google' },
  { name: 'gpt-5.5',           apiId: 'gpt-5.5',            endpoint: 'responses' },
];

function buildPrompt(match) {
  const home = match.home_team || match.home_team_label || 'Home';
  const away = match.away_team || match.away_team_label || 'Away';
  const isKnockout = match.type !== 'group';

  const pickOptions = isKnockout
    ? '"home" or "away" (knockout match — no draw possible)'
    : '"home", "draw", or "away"';

  const stage = match.stage_group || match.type || 'Unknown';
  const venue = match.stadium_name
    ? `${match.stadium_name}, ${match.stadium_city || ''}`
    : 'Unknown venue';

  return `You are an expert sports analytics AI specializing in predictive football (soccer) modeling. Your task is to calculate the most statistically probable outcome for an upcoming 2026 FIFA World Cup match.

### MATCH PROFILE
* **Fixture:** ${home} vs. ${away}
* **Stage:** ${stage}
* **Venue & Location:** ${venue}
* **External Conditions:** Use your best knowledge of typical weather, altitude, and travel distances for this venue and these teams.

### TEAM A PROFILE (${home})
* **FIFA Ranking:** Use your best knowledge.
* **Recent Form (Last 5 matches):** Use your best knowledge.
* **Expected Goals (xG) Trend:** Use your best knowledge.
* **Key Injuries/Suspensions:** Use your best knowledge.
* **Tactical Setup:** Use your best knowledge.
* **Tournament Motivation Scenario:** Use your best knowledge based on the stage and group standings context.

### TEAM B PROFILE (${away})
* **FIFA Ranking:** Use your best knowledge.
* **Recent Form (Last 5 matches):** Use your best knowledge.
* **Expected Goals (xG) Trend:** Use your best knowledge.
* **Key Injuries/Suspensions:** Use your best knowledge.
* **Tactical Setup:** Use your best knowledge.
* **Tournament Motivation Scenario:** Use your best knowledge based on the stage and group standings context.

### HISTORICAL & CONTEXTUAL DATA
* **Head-to-Head Record (Last 5 years):** Use your best knowledge.
* **Historical performance under similar tournament pressure:** Use your best knowledge.

### INSTRUCTIONS
Analyze the tactical matchup (how ${home}'s attack pairs against ${away}'s defensive shape), the physical impact of travel and altitude, and the motivation dynamics based on the 2026 48-team group permutations.${isKnockout ? ' This is a knockout match — there is no draw.' : ''}

Respond with ONLY a JSON object — no markdown, no explanation outside the JSON:
{
  "pick": ${pickOptions},
  "reasoning": "your 1-2 sentence tactical justification"
}`;
}

function parseResponse(text) {
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  // Try direct parse first (handles well-formed model responses).
  try { return JSON.parse(clean); } catch (_) {}

  // Walk backward from the last } to find the outermost valid JSON object,
  // skipping any trailing fragments like {see stats} that break greedy matching.
  const start = clean.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in response');
  let end = clean.lastIndexOf('}');
  while (end > start) {
    try { return JSON.parse(clean.slice(start, end + 1)); } catch (_) {}
    end = clean.lastIndexOf('}', end - 1);
  }

  throw new Error('No valid JSON object found in response');
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
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content;
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
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content[0].text;
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
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates[0].content.parts[0].text;
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
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.output_text ??
    data.output?.flatMap(o => o.content ?? []).find(c => c.type === 'output_text')?.text;
  if (!text) throw new Error('No text in response: ' + JSON.stringify(data).slice(0, 200));
  return text;
}

async function callModel(model, prompt) {
  let text;
  if (model.endpoint === 'chat') text = await callChat(model, prompt);
  else if (model.endpoint === 'anthropic') text = await callAnthropic(model, prompt);
  else if (model.endpoint === 'google') text = await callGoogle(model, prompt);
  else if (model.endpoint === 'responses') text = await callResponses(model, prompt);
  else throw new Error(`Unknown endpoint: ${model.endpoint}`);
  return parseResponse(text);
}

async function callWithRetry(model, prompt, isKnockout) {
  const validPicks = isKnockout ? ['home', 'away'] : ['home', 'draw', 'away'];
  let lastError;

  for (let attempt = 0; attempt <= 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
    try {
      const result = await callModel(model, prompt);
      if (!validPicks.includes(result.pick)) {
        throw new Error(`Invalid pick "${result.pick}" — expected one of ${validPicks.join(', ')}`);
      }
      if (typeof result.reasoning !== 'string' || !result.reasoning.trim()) {
        throw new Error('Missing or empty reasoning');
      }
      return { pick: result.pick, reasoning: result.reasoning.trim(), failed: false };
    } catch (err) {
      lastError = err;
      console.error(`[${model.name}] attempt ${attempt + 1} failed:`, err.message);
    }
  }

  console.error(`[${model.name}] all retries exhausted:`, lastError.message);
  return { pick: null, reasoning: null, failed: true };
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
    sql: 'SELECT * FROM predictions WHERE match_id = ?',
    args: [matchId],
  });

  const existingByModel = {};
  for (const row of existingResult.rows) {
    existingByModel[row.model_name] = row;
  }

  const missing = MODELS.filter((m) => !existingByModel[m.name]);
  if (missing.length === 0) return existingResult.rows;

  const isKnockout = match.type !== 'group';
  const prompt = buildPrompt(match);

  const results = await Promise.all(
    missing.map(async (model) => {
      const result = await callWithRetry(model, prompt, isKnockout);
      return { model, result };
    })
  );

  const now = new Date().toISOString();
  // Single round-trip for all inserts. Overwrite a prior failed record only when
  // the new result succeeded — preserves a successful record against a losing race.
  await db.batch(
    results.map(({ model, result }) => ({
      sql: `INSERT INTO predictions (match_id, model_name, pick, reasoning, failed, predicted_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(match_id, model_name) DO UPDATE SET
              pick         = excluded.pick,
              reasoning    = excluded.reasoning,
              failed       = excluded.failed,
              predicted_at = excluded.predicted_at
            WHERE excluded.failed = 0`,
      args: [matchId, model.name, result.pick, result.reasoning, result.failed ? 1 : 0, now],
    }))
  );

  const allResult = await db.execute({
    sql: 'SELECT * FROM predictions WHERE match_id = ?',
    args: [matchId],
  });
  return allResult.rows;
}

module.exports = { getPredictions, MODELS };
