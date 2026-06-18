const express = require('express');
const db = require('./db');
const sync = require('./sync');
const { getPredictions } = require('./predict');

const app = express();
app.use(express.json());

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// "YYYY-MM-DD HH:MM" → "Jun 12, 01:00"
function formatICT(ictStr) {
  if (!ictStr) return '—';
  const [datePart, timePart] = ictStr.split(' ');
  const [, month, day] = datePart.split('-');
  return `${MONTHS[parseInt(month) - 1]} ${parseInt(day)}, ${timePart}`;
}

// "YYYY-MM-DD" → "Thu, Jun 11"
function formatDateLabel(datePart) {
  const [year, month, day] = datePart.split('-').map(Number);
  const dow = DAYS[new Date(year, month - 1, day).getDay()];
  return `${dow}, ${MONTHS[month - 1]} ${day}`;
}

// "YYYY-MM-DD HH:MM" → "[01:00]"
function formatTimeOnly(ictStr) {
  if (!ictStr) return '[—]';
  const timePart = ictStr.split(' ')[1];
  return `[${timePart}]`;
}

function isUnconfirmed(m) {
  return m.home_team_id === '0' || m.away_team_id === '0';
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderPage({ matches, syncError }) {
  const confirmed = matches.filter((m) => !isUnconfirmed(m));

  const byDate = new Map();
  for (const m of confirmed) {
    const datePart = (m.local_date_ict || '').split(' ')[0];
    if (!byDate.has(datePart)) byDate.set(datePart, []);
    byDate.get(datePart).push(m);
  }

  const options = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([datePart, dayMatches]) => {
      const label = formatDateLabel(datePart);
      const opts = dayMatches
        .sort((a, b) => (a.local_date_ict || '').localeCompare(b.local_date_ict || ''))
        .map((m) => {
          const home = m.home_team || m.home_team_label || '?';
          const away = m.away_team || m.away_team_label || '?';
          const optLabel = `${formatTimeOnly(m.local_date_ict)}  ${home} vs ${away}`;
          return `<option value="${m.id}" data-home="${escAttr(home)}" data-away="${escAttr(away)}">${optLabel}</option>`;
        })
        .join('\n            ');
      return `<optgroup label="${escAttr(label)}">\n            ${opts}\n          </optgroup>`;
    })
    .join('\n          ');

  const errorBanner = syncError
    ? `<div class="error-banner">
        <span class="error-icon">⚠</span>
        Could not reach worldcup26.ir — showing cached data. ${syncError}
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>World Cup 2026 · AI Predictions</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:          #0F172A;
      --surface:     #1E293B;
      --surface-2:   #273549;
      --border:      #334155;
      --accent:      #38BDF8;
      --accent-dim:  rgba(56, 189, 248, 0.15);
      --text:        #F1F5F9;
      --text-muted:  #94A3B8;
      --disabled:    #475569;
      --error-bg:    rgba(248, 113, 113, 0.12);
      --error-text:  #FCA5A5;
      --error-border:#F87171;
      --radius:      10px;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Space Grotesk', system-ui, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 48px 20px 80px;
    }

    /* ── Header ── */
    .site-header {
      width: 100%;
      max-width: 740px;
      margin-bottom: 48px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .site-header .eyebrow {
      font-family: 'Space Mono', monospace;
      font-size: 11px;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: var(--accent);
    }

    .site-header h1 {
      font-size: clamp(28px, 5vw, 42px);
      font-weight: 700;
      line-height: 1.1;
      color: var(--text);
      letter-spacing: -0.02em;
    }

    .site-header h1 em {
      font-style: normal;
      color: var(--accent);
    }

    .site-header .subtitle {
      font-size: 14px;
      color: var(--text-muted);
      margin-top: 4px;
    }

    /* ── Error banner ── */
    .error-banner {
      width: 100%;
      max-width: 740px;
      margin-bottom: 24px;
      background: var(--error-bg);
      border: 1px solid var(--error-border);
      border-radius: var(--radius);
      padding: 12px 16px;
      font-size: 14px;
      color: var(--error-text);
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }

    .error-icon {
      flex-shrink: 0;
      font-size: 16px;
    }

    /* ── Match selector card ── */
    .selector-card {
      width: 100%;
      max-width: 740px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 28px 28px 32px;
    }

    .selector-card label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 12px;
      font-family: 'Space Mono', monospace;
    }

    .select-wrapper {
      position: relative;
    }

    .select-wrapper::after {
      content: '▾';
      position: absolute;
      right: 16px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--accent);
      pointer-events: none;
      font-size: 14px;
    }

    select#match-select {
      width: 100%;
      appearance: none;
      -webkit-appearance: none;
      background: var(--surface-2);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 13px 44px 13px 16px;
      font-family: 'Space Mono', monospace;
      font-size: 13px;
      cursor: pointer;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }

    select#match-select:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-dim);
    }

    select#match-select option {
      background: #1E293B;
      color: var(--text);
      padding: 8px 0;
    }

    select#match-select option.opt-disabled {
      color: var(--disabled);
    }

    .selector-hint {
      margin-top: 12px;
      font-size: 12px;
      color: var(--text-muted);
    }

    .selector-hint span {
      display: inline-block;
      width: 10px;
      height: 10px;
      background: var(--disabled);
      border-radius: 2px;
      margin-right: 5px;
      vertical-align: middle;
      opacity: 0.6;
    }

    /* ── Placeholder content area (future: prediction table) ── */
    .prediction-area {
      width: 100%;
      max-width: 740px;
      margin-top: 24px;
    }

    .placeholder-msg {
      background: var(--surface);
      border: 1px dashed var(--border);
      border-radius: var(--radius);
      padding: 40px;
      text-align: center;
      color: var(--text-muted);
      font-size: 14px;
    }

    .placeholder-msg strong {
      display: block;
      font-size: 16px;
      color: var(--text);
      margin-bottom: 6px;
    }

    /* ── Nav link ── */
    .page-nav {
      width: 100%;
      max-width: 740px;
      margin-bottom: 24px;
    }

    .page-nav a {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-family: 'Space Mono', monospace;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--accent);
      text-decoration: none;
      padding: 8px 14px;
      border: 1px solid var(--accent);
      border-radius: 6px;
      transition: background 0.15s;
    }

    .page-nav a:hover { background: var(--accent-dim); }

    /* ── Footer ── */
    footer {
      margin-top: 64px;
      font-size: 12px;
      color: var(--text-muted);
      font-family: 'Space Mono', monospace;
    }

    /* ── Spinner ── */
    .spinner-wrap {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 48px;
      text-align: center;
    }

    .spinner {
      display: inline-block;
      width: 32px;
      height: 32px;
      border: 3px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-bottom: 16px;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    .spinner-msg {
      color: var(--text-muted);
      font-size: 14px;
    }

    /* ── Prediction table ── */
    .pred-table-wrap {
      overflow-x: auto;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
    }

    .pred-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }

    .pred-table th {
      text-align: left;
      padding: 14px 16px;
      font-family: 'Space Mono', monospace;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }

    .pred-table td {
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }

    .pred-table tr:last-child td { border-bottom: none; }
    .pred-table tbody tr:hover td { background: var(--surface-2); }

    .model-name {
      font-family: 'Space Mono', monospace;
      font-size: 12px;
      color: var(--text);
      white-space: nowrap;
    }

    .pick-badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
    }

    .pick-home   { background: rgba(56, 189, 248, 0.15); color: var(--accent); }
    .pick-draw   { background: rgba(148, 163, 184, 0.15); color: var(--text-muted); }
    .pick-away   { background: rgba(167, 139, 250, 0.15); color: #A78BFA; }
    .pick-failed { background: rgba(248, 113, 113, 0.10); color: var(--error-text); }

    .reasoning-text { color: var(--text-muted); line-height: 1.5; }

    .cell-correct { background: rgba(34, 197, 94, 0.15); }
    .cell-wrong   { background: rgba(248, 113, 113, 0.12); }

    .result-summary {
      margin-bottom: 12px;
      padding: 10px 14px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      font-family: 'Space Mono', monospace;
      font-size: 13px;
      color: var(--text-muted);
    }

    @media (max-width: 480px) {
      .selector-card { padding: 20px 16px 24px; }
      select#match-select { font-size: 11px; }
    }
  </style>
</head>
<body>
  <header class="site-header">
    <p class="eyebrow">FIFA World Cup 2026</p>
    <h1>AI <em>Predictions</em></h1>
    <p class="subtitle">8 language models predict every match. Select one to see their picks.</p>
  </header>

  ${errorBanner}

  <nav class="page-nav">
    <a href="/leaderboard">&#9651; Model Leaderboard</a>
  </nav>

  <main>
    <section class="selector-card">
      <label for="match-select">Select a match</label>
      <div class="select-wrapper">
        <select id="match-select">
          <option value="" disabled selected>— choose a match —</option>
          ${options}
        </select>
      </div>
      <p class="selector-hint">
        All times in ICT (UTC+7). Knockout matches with unconfirmed teams are hidden until qualified.
      </p>
    </section>

    <div id="prediction-area" class="prediction-area">
      <div class="placeholder-msg">
        <strong>Predictions</strong>
        Select a match above to load AI predictions.
      </div>
    </div>
  </main>

  <footer>worldcup26.ir · ${matches.length} matches loaded</footer>

  <script>
  (function () {
    var sel  = document.getElementById('match-select');
    var area = document.getElementById('prediction-area');

    function esc(s) {
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function pickBadge(pick, home, away) {
      if (pick === 'home') return '<span class="pick-badge pick-home">' + esc(home) + ' Win</span>';
      if (pick === 'draw') return '<span class="pick-badge pick-draw">Draw</span>';
      if (pick === 'away') return '<span class="pick-badge pick-away">' + esc(away) + ' Win</span>';
      return '<span class="pick-badge pick-failed">Prediction unavailable</span>';
    }

    function deriveResult(match) {
      if (!match || !match.finished) return null;
      var h = match.home_score, a = match.away_score;
      if (h == null || a == null) return null;
      if (h > a) return 'home';
      if (a > h) return 'away';
      return 'draw';
    }

    function renderTable(predictions, match, home, away) {
      var actualResult = deriveResult(match);
      var correctCount = 0;

      var rows = predictions.slice()
        .sort(function (a, b) { return a.model_name.localeCompare(b.model_name); })
        .map(function (p) {
          var isCorrect = actualResult && !p.failed && p.pick === actualResult;
          var isWrong   = actualResult && (p.failed || p.pick !== actualResult);
          if (isCorrect) correctCount++;
          var cellClass = isCorrect ? ' class="cell-correct"' : (isWrong ? ' class="cell-wrong"' : '');

          if (p.failed) {
            return '<tr>' +
              '<td><span class="model-name">' + esc(p.model_name) + '</span></td>' +
              '<td' + cellClass + '><span class="pick-badge pick-failed">Prediction unavailable</span></td>' +
              '<td class="reasoning-text" style="font-style:italic">Prediction unavailable</td>' +
              '</tr>';
          }
          return '<tr>' +
            '<td><span class="model-name">' + esc(p.model_name) + '</span></td>' +
            '<td' + cellClass + '>' + pickBadge(p.pick, home, away) + '</td>' +
            '<td class="reasoning-text">' + esc(p.reasoning || '') + '</td>' +
            '</tr>';
        })
        .join('');

      var summary = actualResult
        ? '<p class="result-summary">' + correctCount + '/8 models predicted correctly</p>'
        : '';

      return summary + '<div class="pred-table-wrap">' +
        '<table class="pred-table">' +
          '<thead><tr><th>Model</th><th>Prediction</th><th>Reasoning</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table></div>';
    }

    function showSpinner() {
      area.innerHTML =
        '<div class="spinner-wrap">' +
          '<div class="spinner"></div>' +
          '<p class="spinner-msg">Asking 8 AI models — this takes 10&ndash;30 seconds&hellip;</p>' +
        '</div>';
    }

    async function loadPredictions(matchId, home, away) {
      try {
        var r = await fetch('/api/predictions/' + matchId);
        if (r.ok) {
          var data = await r.json();
          if (data.predictions && data.predictions.length >= 8) {
            if (sel.value !== String(matchId)) return;
            area.innerHTML = renderTable(data.predictions, data.match, home, away);
            return;
          }
        }
      } catch (_) {}

      showSpinner();

      try {
        var r2 = await fetch('/api/predict/' + matchId, { method: 'POST' });
        if (!r2.ok) throw new Error('HTTP ' + r2.status);
        var data2 = await r2.json();
        if (sel.value !== String(matchId)) return;
        area.innerHTML = renderTable(data2.predictions, data2.match, home, away);
      } catch (err) {
        if (sel.value !== String(matchId)) return;
        area.innerHTML =
          '<div class="placeholder-msg"><strong>Error</strong>Could not load predictions. Please try again.</div>';
      }
    }

    sel.addEventListener('change', function () {
      var opt     = sel.options[sel.selectedIndex];
      var matchId = sel.value;
      var home    = (opt.dataset && opt.dataset.home) || 'Home';
      var away    = (opt.dataset && opt.dataset.away) || 'Away';
      area.innerHTML = '';
      loadPredictions(matchId, home, away);
    });
  })();
  </script>
</body>
</html>`;
}

function renderLoadingPage(next) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>World Cup 2026 · Loading</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:         #0F172A;
      --surface:    #1E293B;
      --border:     #334155;
      --accent:     #38BDF8;
      --accent-dim: rgba(56, 189, 248, 0.15);
      --text:       #F1F5F9;
      --text-muted: #94A3B8;
      --radius:     10px;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Space Grotesk', system-ui, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 48px 20px 80px;
    }

    .site-header {
      width: 100%;
      max-width: 740px;
      margin-bottom: 48px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .site-header .eyebrow {
      font-family: 'Space Mono', monospace;
      font-size: 11px;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: var(--accent);
    }

    .site-header h1 {
      font-size: clamp(28px, 5vw, 42px);
      font-weight: 700;
      line-height: 1.1;
      color: var(--text);
      letter-spacing: -0.02em;
    }

    .site-header h1 em {
      font-style: normal;
      color: var(--accent);
    }

    .site-header .subtitle {
      font-size: 14px;
      color: var(--text-muted);
      margin-top: 4px;
    }

    .loading-card {
      width: 100%;
      max-width: 740px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 48px;
      text-align: center;
    }

    .spinner {
      display: inline-block;
      width: 32px;
      height: 32px;
      border: 3px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-bottom: 16px;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    .spinner-msg {
      color: var(--text-muted);
      font-size: 14px;
    }

    .retry-msg {
      color: var(--text-muted);
      font-size: 14px;
      margin-bottom: 20px;
    }

    .retry-btn {
      display: inline-block;
      font-family: 'Space Mono', monospace;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--accent);
      background: transparent;
      border: 1px solid var(--accent);
      border-radius: 6px;
      padding: 8px 20px;
      cursor: pointer;
      transition: background 0.15s;
    }

    .retry-btn:hover { background: var(--accent-dim); }
  </style>
</head>
<body>
  <header class="site-header">
    <p class="eyebrow">FIFA World Cup 2026</p>
    <h1>AI <em>Predictions</em></h1>
    <p class="subtitle">8 language models predict every match. Select one to see their picks.</p>
  </header>

  <div class="loading-card">
    <div id="loading-area">
      <div class="spinner"></div>
      <p class="spinner-msg">Fetching&hellip;</p>
    </div>
  </div>

  <script>
  (function () {
    var NEXT = ${JSON.stringify(next)};
    var TIMEOUT_MS = 15000;
    var POLL_MS = 1000;
    var elapsed = 0;

    function showRetry() {
      document.getElementById('loading-area').innerHTML =
        '<p class="retry-msg">Could not reach data source. Please try again.</p>' +
        '<button class="retry-btn" onclick="window.location.reload()">Retry</button>';
    }

    function poll() {
      fetch('/api/ready', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.ready) {
            window.location.href = NEXT;
          } else {
            next_tick();
          }
        })
        .catch(function () { next_tick(); });
    }

    function next_tick() {
      elapsed += POLL_MS;
      if (elapsed >= TIMEOUT_MS) {
        showRetry();
      } else {
        setTimeout(poll, POLL_MS);
      }
    }

    poll();
  })();
  </script>
</body>
</html>`;
}

app.get('/loading', (req, res) => {
  const next = req.query.next || '/?ready=1';
  res.send(renderLoadingPage(next));
});

app.get('/api/ready', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    await sync();
  } catch (err) {
    console.error('Sync failed in /api/ready:', err);
  }
  res.json({ ready: true });
});

app.get('/', async (req, res) => {
  if (!req.query.ready) {
    return res.redirect('/loading?next=' + encodeURIComponent('/?ready=1'));
  }

  let syncError = null;

  try {
    const result = await db.execute(
      'SELECT * FROM matches ORDER BY local_date_ict ASC'
    );
    const matches = result.rows;
    res.send(renderPage({ matches, syncError }));
  } catch (err) {
    console.error('DB query failed:', err);
    res.status(500).send(
      renderPage({
        matches: [],
        syncError: err.message,
      })
    );
  }
});

app.get('/api/predictions/:matchId', async (req, res) => {
  const matchId = parseInt(req.params.matchId, 10);
  if (isNaN(matchId)) return res.status(400).json({ error: 'Invalid matchId' });

  try {
    const [predResult, matchResult] = await Promise.all([
      db.execute({ sql: 'SELECT * FROM predictions WHERE match_id = ?', args: [matchId] }),
      db.execute({ sql: 'SELECT id, finished, home_score, away_score FROM matches WHERE id = ?', args: [matchId] }),
    ]);
    if (!predResult.rows.length) return res.status(404).json({ error: 'No predictions found' });
    res.json({ predictions: predResult.rows, match: matchResult.rows[0] || null });
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/leaderboard', async (req, res) => {
  if (!req.query.ready) {
    return res.redirect('/loading?next=' + encodeURIComponent('/leaderboard?ready=1'));
  }

  try {
    const result = await db.execute(`
      SELECT
        p.model_name,
        COUNT(*) AS matches_predicted,
        SUM(
          CASE
            WHEN p.failed = 0
              AND m.home_score IS NOT NULL
              AND m.away_score IS NOT NULL
              AND (
                (m.home_score > m.away_score AND p.pick = 'home') OR
                (m.away_score > m.home_score AND p.pick = 'away') OR
                (m.home_score = m.away_score AND p.pick = 'draw')
              )
            THEN 1 ELSE 0
          END
        ) AS correct
      FROM predictions p
      JOIN matches m ON p.match_id = m.id
      WHERE m.finished = 1
      GROUP BY p.model_name
      ORDER BY correct DESC, p.model_name ASC
    `);
    res.send(renderLeaderboardPage({ rows: result.rows }));
  } catch (err) {
    console.error('Leaderboard DB error:', err);
    res.status(500).send('Internal server error');
  }
});

function renderLeaderboardPage({ rows }) {
  const tableRows = rows.length === 0
    ? `<tr><td colspan="5" class="empty-cell">No finished matches with predictions yet.</td></tr>`
    : rows.map((r, i) => {
      const acc = r.matches_predicted > 0
        ? ((r.correct / r.matches_predicted) * 100).toFixed(1)
        : '0.0';
      return `<tr>
          <td class="rank-cell">${i + 1}</td>
          <td><span class="model-name">${escHtml(r.model_name)}</span></td>
          <td class="num-cell">${r.correct}</td>
          <td class="num-cell">${r.matches_predicted}</td>
          <td class="num-cell">${acc}%</td>
        </tr>`;
    }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>World Cup 2026 · Model Leaderboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:          #0F172A;
      --surface:     #1E293B;
      --surface-2:   #273549;
      --border:      #334155;
      --accent:      #38BDF8;
      --accent-dim:  rgba(56, 189, 248, 0.15);
      --text:        #F1F5F9;
      --text-muted:  #94A3B8;
      --radius:      10px;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Space Grotesk', system-ui, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 48px 20px 80px;
    }

    .site-header {
      width: 100%;
      max-width: 740px;
      margin-bottom: 48px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .site-header .eyebrow {
      font-family: 'Space Mono', monospace;
      font-size: 11px;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: var(--accent);
    }

    .site-header h1 {
      font-size: clamp(28px, 5vw, 42px);
      font-weight: 700;
      line-height: 1.1;
      color: var(--text);
      letter-spacing: -0.02em;
    }

    .site-header h1 em {
      font-style: normal;
      color: var(--accent);
    }

    .site-header .subtitle {
      font-size: 14px;
      color: var(--text-muted);
      margin-top: 4px;
    }

    .page-nav {
      width: 100%;
      max-width: 740px;
      margin-bottom: 24px;
    }

    .page-nav a {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-family: 'Space Mono', monospace;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--accent);
      text-decoration: none;
      padding: 8px 14px;
      border: 1px solid var(--accent);
      border-radius: 6px;
      transition: background 0.15s;
    }

    .page-nav a:hover { background: var(--accent-dim); }

    .lb-wrap {
      width: 100%;
      max-width: 740px;
      overflow-x: auto;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
    }

    .lb-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }

    .lb-table th {
      text-align: left;
      padding: 14px 16px;
      font-family: 'Space Mono', monospace;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }

    .lb-table td {
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
      vertical-align: middle;
    }

    .lb-table tr:last-child td { border-bottom: none; }
    .lb-table tbody tr:hover td { background: var(--surface-2); }

    .rank-cell {
      font-family: 'Space Mono', monospace;
      font-size: 13px;
      font-weight: 700;
      color: var(--text-muted);
      width: 48px;
    }

    .lb-table tbody tr:first-child .rank-cell { color: var(--accent); }

    .model-name {
      font-family: 'Space Mono', monospace;
      font-size: 12px;
      color: var(--text);
    }

    .num-cell {
      font-family: 'Space Mono', monospace;
      font-size: 13px;
      text-align: right;
    }

    .lb-table th:nth-child(n+3) { text-align: right; }

    .empty-cell {
      text-align: center;
      color: var(--text-muted);
      padding: 40px;
      font-size: 14px;
    }

    footer {
      margin-top: 64px;
      font-size: 12px;
      color: var(--text-muted);
      font-family: 'Space Mono', monospace;
    }

    @media (max-width: 480px) {
      .lb-table { font-size: 12px; }
      .lb-table th, .lb-table td { padding: 10px 10px; }
    }
  </style>
</head>
<body>
  <header class="site-header">
    <p class="eyebrow">FIFA World Cup 2026</p>
    <h1>Model <em>Leaderboard</em></h1>
    <p class="subtitle">Ranked by total correct predictions across finished matches.</p>
  </header>

  <nav class="page-nav">
    <a href="/">&#9651; AI Predictions</a>
  </nav>

  <main style="width:100%;max-width:740px;">
    <div class="lb-wrap">
      <table class="lb-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Model</th>
            <th>Correct</th>
            <th>Predicted</th>
            <th>Accuracy</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>
  </main>

  <footer>worldcup26.ir · ${rows.length} models ranked</footer>
</body>
</html>`;
}

app.post('/api/predict/:matchId', async (req, res) => {
  const matchId = parseInt(req.params.matchId, 10);
  if (isNaN(matchId)) return res.status(400).json({ error: 'Invalid matchId' });

  // Fetch match metadata first — validates existence, guards against unconfirmed
  // knockout teams, and avoids a second DB round-trip after expensive LLM calls.
  let match;
  try {
    const r = await db.execute({
      sql: 'SELECT id, home_team_id, away_team_id, finished, home_score, away_score FROM matches WHERE id = ?',
      args: [matchId],
    });
    if (!r.rows.length) return res.status(404).json({ error: 'Match not found' });
    match = r.rows[0];
  } catch (err) {
    console.error('DB error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }

  if (match.home_team_id === '0' || match.away_team_id === '0') {
    return res.status(422).json({ error: 'Cannot predict for a match with unconfirmed teams' });
  }

  try {
    const predictions = await getPredictions(matchId);
    res.json({ predictions, match });
  } catch (err) {
    console.error('Prediction error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = app;
