const db = require('./db');

async function migrate() {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS stadiums (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      api_id        TEXT    NOT NULL UNIQUE,
      name          TEXT    NOT NULL,
      city          TEXT    NOT NULL,
      region        TEXT    NOT NULL CHECK (region IN ('Eastern', 'Central', 'Western')),
      last_synced_at TEXT   NOT NULL
    )`,

    `CREATE TABLE IF NOT EXISTS matches (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      api_id           TEXT    NOT NULL UNIQUE,
      home_team_id     TEXT    NOT NULL,
      away_team_id     TEXT    NOT NULL,
      home_team        TEXT,
      away_team        TEXT,
      home_team_label  TEXT,
      away_team_label  TEXT,
      stage_group      TEXT,
      type             TEXT,
      stadium_id       INTEGER,
      local_date_ict   TEXT,
      home_score       INTEGER,
      away_score       INTEGER,
      finished         INTEGER NOT NULL DEFAULT 0,
      last_synced_at   TEXT    NOT NULL
    )`,

    `CREATE TABLE IF NOT EXISTS predictions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id     INTEGER NOT NULL,
      model_name   TEXT    NOT NULL,
      pick         TEXT    CHECK (pick IN ('home', 'draw', 'away')),
      reasoning    TEXT,
      failed       INTEGER NOT NULL DEFAULT 0,
      order_index  INTEGER,
      predicted_at TEXT    NOT NULL,
      UNIQUE (match_id, model_name)
    )`,
  ]);

  // Add order_index to existing predictions tables and wipe rows for debate format regeneration.
  // Only deletes when the column is newly added so restarts don't clear data.
  let columnAdded = false;
  try {
    await db.execute(`ALTER TABLE predictions ADD COLUMN order_index INTEGER`);
    columnAdded = true;
  } catch (e) {
    if (!e.message.toLowerCase().includes('duplicate column')) throw e;
  }
  if (columnAdded) {
    await db.execute(`DELETE FROM predictions`);
  }
}

module.exports = migrate;
