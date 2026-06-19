'use strict';

const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');
const fs = require('node:fs');
const path = require('node:path');

// Unique temp file per process so parallel runs don't collide
const DB_FILE = path.join(__dirname, `../.test-migrate-${process.pid}.db`);

// Inject test DB into require cache before migrate.js captures it
const db = createClient({ url: `file:${DB_FILE}` });
require.cache[require.resolve('./db')] = { exports: db };
const migrate = require('./migrate');

const cols = async () => {
  const r = await db.execute('PRAGMA table_info(predictions)');
  return r.rows.map(row => row.name);
};
const rowCount = async () => {
  const r = await db.execute('SELECT COUNT(*) as n FROM predictions');
  return Number(r.rows[0].n);
};

before(async () => {
  // Simulate a pre-existing DB with the old predictions schema (no order_index)
  await db.execute(`CREATE TABLE IF NOT EXISTS predictions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id     INTEGER NOT NULL,
    model_name   TEXT    NOT NULL,
    pick         TEXT    CHECK (pick IN ('home', 'draw', 'away')),
    reasoning    TEXT,
    failed       INTEGER NOT NULL DEFAULT 0,
    predicted_at TEXT    NOT NULL,
    UNIQUE (match_id, model_name)
  )`);
  await db.batch([
    `INSERT INTO predictions (match_id, model_name, pick, failed, predicted_at) VALUES (1, 'gpt-4o', 'home', 0, '2026-01-01')`,
    `INSERT INTO predictions (match_id, model_name, pick, failed, predicted_at) VALUES (1, 'claude-opus', 'draw', 0, '2026-01-01')`,
  ]);
});

after(async () => {
  await db.close();
  fs.rmSync(DB_FILE, { force: true });
});

test('adds order_index column on first run', async () => {
  assert.ok(!(await cols()).includes('order_index'), 'pre-condition: order_index should not exist yet');
  await migrate();
  assert.ok((await cols()).includes('order_index'), 'order_index column missing after migration');
});

test('wipes all existing prediction rows on first run', async () => {
  assert.equal(await rowCount(), 0, 'pre-existing predictions should be deleted by migration');
});

test('preserves UNIQUE(match_id, model_name) constraint', async () => {
  await db.execute(`INSERT INTO predictions (match_id, model_name, pick, failed, order_index, predicted_at) VALUES (1, 'gpt-4o', 'home', 0, 1, '2026-01-01')`);
  await assert.rejects(
    () => db.execute(`INSERT INTO predictions (match_id, model_name, pick, failed, order_index, predicted_at) VALUES (1, 'gpt-4o', 'away', 0, 2, '2026-01-01')`),
    /UNIQUE/i,
  );
  await db.execute('DELETE FROM predictions');
});

test('idempotent — second run does not error and does not wipe post-migration rows', async () => {
  await db.execute(`INSERT INTO predictions (match_id, model_name, pick, failed, order_index, predicted_at) VALUES (2, 'claude-opus', 'draw', 0, 1, '2026-01-01')`);
  await assert.doesNotReject(() => migrate(), 'second migrate() call should not throw');
  assert.equal(await rowCount(), 1, 'rows added after first migration should survive second run');
});
