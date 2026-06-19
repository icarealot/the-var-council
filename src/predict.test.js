'use strict';

const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');

// ---------- Mock state ----------
let capturedFetches = [];  // { url, modelId, prompt }
let capturedInserts = [];  // DB row objects
let mockDbRows = [];
let fetchResponses = {};   // apiId -> { pick, reasoning } | 'fail'

const GROUP_MATCH = {
  id: 1,
  home_team: 'Brazil',
  away_team: 'Argentina',
  type: 'group',
  stage_group: 'Group C',
  stadium_name: 'MetLife Stadium',
  stadium_city: 'East Rutherford',
};

const KNOCKOUT_MATCH = {
  id: 2,
  home_team: 'Brazil',
  away_team: 'Argentina',
  type: 'round_of_16',
  stage_group: null,
  stadium_name: 'MetLife Stadium',
  stadium_city: 'East Rutherford',
};

// ---------- Mock DB ----------
const mockDb = {
  execute: async (stmt) => {
    const sql = typeof stmt === 'string' ? stmt : stmt.sql;
    const args = typeof stmt === 'string' ? [] : (stmt.args || []);

    if (sql.includes('SELECT m.*') && sql.includes('FROM matches')) {
      const match = Number(args[0]) === 2 ? KNOCKOUT_MATCH : GROUP_MATCH;
      return { rows: [match] };
    }
    if (sql.includes('SELECT * FROM predictions') && sql.includes('ORDER BY order_index')) {
      return { rows: [...mockDbRows] };
    }
    if (sql.includes('DELETE FROM predictions')) {
      mockDbRows = [];
      return {};
    }
    if (sql.includes('INSERT INTO predictions')) {
      const insert = {
        match_id: args[0], model_name: args[1], pick: args[2],
        reasoning: args[3], failed: args[4], order_index: args[5], predicted_at: args[6],
      };
      const existingIdx = mockDbRows.findIndex(r => r.model_name === insert.model_name && r.match_id === insert.match_id);
      if (existingIdx >= 0) {
        if (!insert.failed) mockDbRows[existingIdx] = insert;
      } else {
        mockDbRows.push(insert);
      }
      capturedInserts.push(insert);
      return {};
    }
    return { rows: [] };
  },
};

require.cache[require.resolve('./db')] = { exports: mockDb };

// ---------- Mock fetch ----------
global.fetch = async (url, opts) => {
  const body = opts?.body ? JSON.parse(opts.body) : {};

  let modelId, prompt;
  if (url.includes('/messages')) {
    modelId = body.model;
    prompt = body.messages?.[0]?.content || '';
  } else if (url.includes('/responses')) {
    modelId = body.model;
    prompt = body.input || '';
  } else if (url.includes(':generateContent')) {
    modelId = url.match(/\/models\/([^:]+):/)?.[1] || 'unknown';
    prompt = body.contents?.[0]?.parts?.[0]?.text || '';
  } else {
    modelId = body.model;
    prompt = body.messages?.[0]?.content || '';
  }

  capturedFetches.push({ url, modelId, prompt });

  const response = fetchResponses[modelId];
  if (response === 'fail') {
    return { ok: false, status: 500, text: async () => 'Simulated failure' };
  }

  const pick = response?.pick || 'home';
  const reasoning = response?.reasoning || `${modelId} picks home`;
  const responseJson = JSON.stringify({ pick, reasoning });

  let data;
  if (url.includes('/messages')) data = { content: [{ text: responseJson }] };
  else if (url.includes('/responses')) data = { output_text: responseJson };
  else if (url.includes(':generateContent')) data = { candidates: [{ content: { parts: [{ text: responseJson }] } }] };
  else data = { choices: [{ message: { content: responseJson } }] };

  return { ok: true, json: async () => data, text: async () => JSON.stringify(data) };
};

// ---------- Load module under test ----------
const { getPredictions, MODELS } = require('./predict');

// ---------- Reset before each test ----------
beforeEach(() => {
  capturedFetches = [];
  capturedInserts = [];
  mockDbRows = [];
  fetchResponses = {};
  for (const m of MODELS) {
    fetchResponses[m.apiId] = { pick: 'home', reasoning: `${m.name} picks home` };
  }
});

// ── Test 1: all 8 models called, order_index 0–7 ──────────────────────────────
test('calls all 8 models and saves each with order_index 0–7', async () => {
  await getPredictions(1);

  assert.equal(capturedInserts.length, 8, 'should insert 8 prediction rows');
  const indexes = capturedInserts.map(r => r.order_index).sort((a, b) => a - b);
  assert.deepEqual(indexes, [0, 1, 2, 3, 4, 5, 6, 7], 'order_index values must be 0–7');
});

// ── Test 2: model at index 0 gets opener prompt ───────────────────────────────
test('model at index 0 receives opener prompt with no prior context', async () => {
  await getPredictions(1);

  const firstPrompt = capturedFetches[0].prompt;
  assert.ok(firstPrompt.includes('first of eight'), 'opener must identify as first of eight');
  assert.ok(
    !firstPrompt.includes('WHAT THE COUNCIL HAS SAID SO FAR'),
    'opener must not include council context section'
  );
});

// ── Test 3: models at index 1–7 get debate prompt with prior picks ─────────────
test('models at index 1–7 receive debate prompt including prior picks', async () => {
  await getPredictions(1);

  assert.equal(capturedFetches.length, 8, 'should have 8 fetch calls');
  for (let i = 1; i < capturedFetches.length; i++) {
    const prompt = capturedFetches[i].prompt;
    assert.ok(
      prompt.includes('WHAT THE COUNCIL HAS SAID SO FAR'),
      `model at position ${i} must receive debate prompt with council context`
    );
    assert.ok(
      prompt.includes('picks: HOME') || prompt.includes('picks: AWAY') || prompt.includes('picks: DRAW'),
      `model at position ${i} must see at least one prior pick`
    );
  }
});

// ── Test 4: each result saved to DB before the next model is called ────────────
test('each model result is saved to DB before the next model is called', async () => {
  // Track interleaved order of fetches and inserts
  const callLog = [];

  const origFetch = global.fetch;
  global.fetch = async (url, opts) => {
    callLog.push('fetch');
    return origFetch(url, opts);
  };

  const origExecute = mockDb.execute;
  mockDb.execute = async (stmt) => {
    const sql = typeof stmt === 'string' ? stmt : stmt.sql;
    if (sql?.includes('INSERT INTO predictions')) callLog.push('insert');
    return origExecute(stmt);
  };

  await getPredictions(1);

  global.fetch = origFetch;
  mockDb.execute = origExecute;

  // Verify pattern: for each insert, no subsequent fetch precedes it without a prior insert
  // i.e., fetch[i] and insert[i] alternate — never two fetches in a row at the model level
  let insertsSeen = 0;
  let fetchesSeen = 0;
  for (const entry of callLog) {
    if (entry === 'fetch') fetchesSeen++;
    if (entry === 'insert') {
      insertsSeen++;
      // At each insert, we should never have more fetches ahead than inserts behind
      assert.ok(fetchesSeen <= insertsSeen + 1, `insert ${insertsSeen}: too many in-flight fetches — calls are not sequential`);
    }
  }
  assert.equal(insertsSeen, 8, 'should have 8 DB inserts total');
});

// ── Test 5: failed model placeholder in next model's context ──────────────────
test('failed model placeholder appears in the next model\'s debate context', async () => {
  // Fail gpt-5.5 (responses endpoint — easiest to target by apiId)
  const targetModel = MODELS.find(m => m.endpoint === 'responses');
  fetchResponses[targetModel.apiId] = 'fail';

  await getPredictions(1);

  const failedInsert = capturedInserts.find(r => r.model_name === targetModel.name);
  assert.ok(failedInsert, 'failed model must still produce a DB row');
  assert.equal(failedInsert.failed, 1, 'failed row must have failed=1');

  // A failing model makes 4 retry fetches before giving up — so we can't index
  // by order_index+1. Instead scan all debate prompts for the placeholder text.
  if (failedInsert.order_index < MODELS.length - 1) {
    const hasPlaceholder = capturedFetches.some(f =>
      f.prompt.includes("crashed and couldn't form an opinion") &&
      f.prompt.includes(targetModel.name)
    );
    assert.ok(
      hasPlaceholder,
      'at least one subsequent model must see the failure placeholder naming the failed model'
    );
  }
});

// ── Test 6: knockout match never offers "draw" ────────────────────────────────
test('knockout match never includes "draw" as a valid pick in any prompt', async () => {
  await getPredictions(2); // matchId=2 is KNOCKOUT_MATCH

  for (let i = 0; i < capturedFetches.length; i++) {
    assert.ok(
      !capturedFetches[i].prompt.includes('"draw"'),
      `model at position ${i}: knockout prompt must not offer "draw" as a pick`
    );
  }
});

// ── Test 7: cached predictions returned without any API calls ─────────────────
test('returns 8 cached rows without any API calls', async () => {
  for (let i = 0; i < MODELS.length; i++) {
    mockDbRows.push({ match_id: 1, model_name: MODELS[i].name, pick: 'home', reasoning: 'cached', failed: 0, order_index: i });
  }

  const rows = await getPredictions(1);

  assert.equal(capturedFetches.length, 0, 'must make no API calls for fully-cached match');
  assert.equal(rows.length, 8, 'must return all 8 cached rows');
});

// ── Test 8: partial predictions wiped and full chain re-run ──────────────────
test('partial predictions (< 8 rows) are wiped and the full 8-model chain runs', async () => {
  for (let i = 0; i < 3; i++) {
    mockDbRows.push({ match_id: 1, model_name: MODELS[i].name, pick: 'home', reasoning: 'partial', failed: 0, order_index: i });
  }

  await getPredictions(1);

  assert.equal(capturedFetches.length, 8, 'must call all 8 models after wiping partials');
  assert.equal(capturedInserts.length, 8, 'must insert 8 fresh rows after wipe');
  const indexes = capturedInserts.map(r => r.order_index).sort((a, b) => a - b);
  assert.deepEqual(indexes, [0, 1, 2, 3, 4, 5, 6, 7], 'fresh rows must have order_index 0–7');
});
