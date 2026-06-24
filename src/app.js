const path = require('path');
const express = require('express');
const db = require('./db');
const sync = require('./sync');
const { getPredictions } = require('./predict');

const app = express();
app.use(express.json());
app.use('/icons', express.static(path.join(__dirname, '../public/icons')));

const TEAM_FLAGS = {
  'Algeria': 'dz', 'Argentina': 'ar', 'Australia': 'au', 'Austria': 'at',
  'Belgium': 'be', 'Bosnia and Herzegovina': 'ba', 'Brazil': 'br',
  'Canada': 'ca', 'Cape Verde': 'cv', 'Colombia': 'co', 'Croatia': 'hr',
  'Curaçao': 'cw', 'Czech Republic': 'cz',
  'Democratic Republic of the Congo': 'cd',
  'Ecuador': 'ec', 'Egypt': 'eg', 'England': 'gb-eng',
  'France': 'fr', 'Germany': 'de', 'Ghana': 'gh',
  'Haiti': 'ht',
  'Iran': 'ir', 'Iraq': 'iq', 'Ivory Coast': 'ci',
  'Japan': 'jp', 'Jordan': 'jo',
  'Mexico': 'mx', 'Morocco': 'ma',
  'Netherlands': 'nl', 'New Zealand': 'nz', 'Norway': 'no',
  'Panama': 'pa', 'Paraguay': 'py', 'Portugal': 'pt',
  'Qatar': 'qa',
  'Saudi Arabia': 'sa', 'Scotland': 'gb-sct', 'Senegal': 'sn',
  'South Africa': 'za', 'South Korea': 'kr', 'Spain': 'es', 'Sweden': 'se',
  'Switzerland': 'ch',
  'Tunisia': 'tn', 'Turkey': 'tr',
  'United States': 'us', 'Uruguay': 'uy', 'Uzbekistan': 'uz',
};

function flagImg(code) {
  return `<img src="https://flagcdn.com/w20/${code}.png" alt="" style="height:15px;vertical-align:middle;margin-right:4px;" onerror="this.style.display='none'">`;
}

function teamWithFlag(name) {
  const code = TEAM_FLAGS[name];
  return code ? `${flagImg(code)} ${name}` : name;
}

function teamWithFlagAfter(name) {
  const code = TEAM_FLAGS[name];
  return code ? `${name} ${flagImg(code)}` : name;
}

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

  const matchData = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([datePart, dayMatches]) => {
      const [, month, day] = datePart.split('-').map(Number);
      const shortLabel = `${MONTHS[month - 1]} ${day}`;
      const mList = dayMatches
        .sort((a, b) => (a.local_date_ict || '').localeCompare(b.local_date_ict || ''))
        .map((m) => {
          const home = m.home_team || m.home_team_label || '?';
          const away = m.away_team || m.away_team_label || '?';
          const timePart = m.local_date_ict ? m.local_date_ict.split(' ')[1] : null;
          return {
            id: m.id,
            home,
            away,
            homeFlag: TEAM_FLAGS[home] ? flagImg(TEAM_FLAGS[home]) : '',
            awayFlag: TEAM_FLAGS[away] ? flagImg(TEAM_FLAGS[away]) : '',
            time: timePart || '—',
            finished: !!m.finished,
            homeScore: m.home_score ?? null,
            awayScore: m.away_score ?? null,
          };
        });
      return { datePart, shortLabel, matches: mList };
    });

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
  <title>The Var Council</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><text y='14' font-size='14'>⚽</text></svg>" />
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

    /* ── Date strip ── */
    .date-strip {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 4px;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    .date-strip::-webkit-scrollbar { display: none; }

    .date-chip {
      flex-shrink: 0;
      padding: 8px 16px;
      border-radius: 20px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text-muted);
      font-family: 'Space Mono', monospace;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
      letter-spacing: 0.04em;
      transition: border-color 0.15s, background 0.15s, color 0.15s;
    }
    .date-chip:hover { border-color: var(--accent); color: var(--text); }
    .date-chip.active { border-color: var(--accent); background: var(--accent-dim); color: var(--accent); }

    /* ── Match cards ── */
    .match-grid {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 16px;
    }

    .match-card {
      width: 100%;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px 20px;
      cursor: pointer;
      display: grid;
      grid-template-columns: 44px 1fr auto 1fr;
      align-items: center;
      gap: 12px;
      text-align: left;
      font-family: inherit;
      color: var(--text);
      transition: border-color 0.15s, background 0.15s;
    }
    .match-card:hover { border-color: var(--accent); background: var(--surface-2); }
    .match-card.selected { border-color: var(--accent); background: var(--accent-dim); }

    .match-card-time {
      font-family: 'Space Mono', monospace;
      font-size: 11px;
      color: var(--text-muted);
    }

    .match-card-home {
      font-size: 14px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .match-card-score {
      font-family: 'Space Mono', monospace;
      font-size: 14px;
      font-weight: 700;
      color: var(--text-muted);
      text-align: center;
      white-space: nowrap;
      padding: 0 4px;
    }

    .match-card-away {
      font-size: 14px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      text-align: right;
    }

    /* ── Back button ── */
    .back-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-family: 'Space Mono', monospace;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--accent);
      cursor: pointer;
      padding: 8px 0;
      border: none;
      background: none;
      transition: opacity 0.15s;
    }
    .back-btn:hover { opacity: 0.75; }

    .selector-hint {
      margin-top: 12px;
      font-size: 12px;
      color: var(--text-muted);
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
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
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
    .page-nav a.active { background: var(--accent); color: #0F172A; }

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

    /* ── Pick badges ── */
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

    /* ── Prediction bubbles ── */
    .chat-feed {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .chat-row {
      display: flex;
      flex-direction: column;
      max-width: 72%;
    }

    .chat-row.left  { align-self: flex-start; }
    .chat-row.right { align-self: flex-end; align-items: flex-end; }

    .chat-sender {
      font-family: 'Space Mono', monospace;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.04em;
      color: var(--text);
      margin-bottom: 4px;
      padding: 0 4px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .model-icon {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      display: inline-block;
    }

    .chat-bubble {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .chat-row.left  .chat-bubble { border-top-left-radius: 4px; }
    .chat-row.right .chat-bubble { border-top-right-radius: 4px; }

    .bubble-pick { display: flex; align-items: center; gap: 6px; }
    .result-icon { font-size: 18px; line-height: 1; display: flex; align-items: center; align-self: center; }

    .bubble-reason {
      font-size: 15px;
      color: var(--text-muted);
      line-height: 1.6;
    }

    /* ── Vote bar ── */
    .vote-bar-wrap {
      margin-bottom: 16px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 20px 20px 16px;
    }

    .vote-bar-teams {
      display: flex;
      justify-content: space-between;
      margin-bottom: 10px;
      font-family: 'Space Mono', monospace;
      font-size: 12px;
      font-weight: 700;
    }

    .vote-bar-teams .vbt-home { color: #38BDF8; }
    .vote-bar-teams .vbt-away { color: #A78BFA; }

    .vote-bar {
      display: flex;
      height: 44px;
      border-radius: 6px;
      overflow: hidden;
      gap: 2px;
    }

    .vb-seg {
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Space Mono', monospace;
      font-size: 16px;
      font-weight: 700;
      color: #fff;
    }

    .vb-home { background: #38BDF8; }
    .vb-draw { background: #64748B; }
    .vb-away { background: #A78BFA; }

    .vote-bar-legend {
      display: flex;
      gap: 16px;
      margin-top: 12px;
      font-size: 12px;
      color: var(--text-muted);
      justify-content: center;
    }

    .vbl-dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 2px;
      margin-right: 5px;
      vertical-align: middle;
    }

    .vbl-dot.home { background: #38BDF8; }
    .vbl-dot.draw { background: #64748B; }
    .vbl-dot.away { background: #A78BFA; }

    .vote-bar-container { position: relative; }

    .vb-seg { cursor: pointer; }

    .vb-tooltip {
      display: none;
      position: absolute;
      bottom: calc(100% + 8px);
      background: #0f172a;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 12px;
      font-size: 12px;
      color: var(--text);
      white-space: nowrap;
      z-index: 100;
      pointer-events: none;
      transform: translateX(-50%);
    }

    .vb-tooltip.active { display: block; }

    .vb-tooltip ul { margin: 0; padding: 0; list-style: none; }

    .vb-tooltip li {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 2px 0;
    }

    .vb-tooltip .model-icon { width: 16px; height: 16px; }

    @media (max-width: 600px) {
      body { padding: 28px 14px 60px; }

      .site-header { margin-bottom: 32px; }
      .site-header .subtitle { font-size: 13px; }

      .date-chip { font-size: 11px; padding: 6px 12px; }
      .match-card { padding: 12px 14px; gap: 8px; }
      .match-card-home, .match-card-away { font-size: 13px; }
      .match-card-score { font-size: 12px; }
      .match-card-time { font-size: 10px; }
      .selector-hint { font-size: 11px; }

      .page-nav { margin-bottom: 18px; }

      .chat-row { max-width: 88%; }
      .chat-sender { font-size: 12px; }
      .chat-bubble { padding: 10px 12px; }
      .pick-badge { font-size: 11px; padding: 2px 7px; }
      .bubble-reason { font-size: 14px; }

      .vote-bar-wrap { padding: 14px 14px 12px; }
      .vote-bar-teams { font-size: 11px; }
      .vote-bar { height: 36px; }
      .vb-seg { font-size: 13px; }
      .vote-bar-legend { gap: 10px; font-size: 11px; flex-wrap: wrap; }

      .placeholder-msg { padding: 28px 16px; }
    }
  </style>
</head>
<body>
  <header class="site-header">
    <p class="eyebrow">THE VAR COUNCIL</p>
    <h1><em>Predictions</em></h1>
    <p class="subtitle">World Cup 2026 — 8 language models predict every match. Select one to see their picks.</p>
  </header>

  ${errorBanner}

  <nav class="page-nav">
    <a href="/" class="active">Predictions</a>
    <a href="/leaderboard">Leaderboard</a>
    <a href="/tables">Tables</a>
    <a href="/knockout">Knockout</a>
  </nav>

  <main style="width:100%;max-width:740px;">
    <div id="nav-area"></div>
    <p class="selector-hint" id="strip-hint">All times in ICT (UTC+7). Knockout matches with unconfirmed teams are hidden until qualified.</p>
    <div id="match-area" class="match-grid" style="display:none"></div>
    <div id="prediction-area" class="prediction-area" style="display:none"></div>
  </main>

  <script>
  (function () {
    var MATCH_DATA = ${JSON.stringify(matchData)};

    var navArea   = document.getElementById('nav-area');
    var matchArea = document.getElementById('match-area');
    var area      = document.getElementById('prediction-area');
    var hint      = document.getElementById('strip-hint');

    var activeDate    = null;
    var activeMatchId = null;

    /* ── Helpers ── */
    function esc(s) {
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    var MODEL_ICON_MAP = {
      'minimax':  'minimax-color.svg',
      'glm':      'zai.svg',
      'kimi':     'kimi-color.svg',
      'qwen':     'qwen-color.svg',
      'deepseek': 'deepseek-color.svg',
      'claude':   'claude-color.svg',
      'gemini':   'google-color.svg',
      'gpt':      'openai.svg',
    };

    function modelIcon(name) {
      var lower = (name || '').toLowerCase();
      for (var prefix in MODEL_ICON_MAP) {
        if (lower.indexOf(prefix) === 0) {
          return '<img src="/icons/' + MODEL_ICON_MAP[prefix] + '" class="model-icon" alt="">';
        }
      }
      return '';
    }

    function pickBadge(pick, home, away) {
      if (pick === 'home') return '<span class="pick-badge pick-home">' + esc(home) + '</span>';
      if (pick === 'draw') return '<span class="pick-badge pick-draw">Draw</span>';
      if (pick === 'away') return '<span class="pick-badge pick-away">' + esc(away) + '</span>';
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

    function renderVoteBar(predictions, home, away) {
      var counts  = { home: 0, draw: 0, away: 0 };
      var voters  = { home: [], draw: [], away: [] };
      predictions.forEach(function (p) {
        if (!p.failed && counts.hasOwnProperty(p.pick)) {
          counts[p.pick]++;
          voters[p.pick].push(p.model_name);
        }
      });
      var total = counts.home + counts.draw + counts.away;
      if (total === 0) return '';

      function seg(cls, pick, count) {
        if (count === 0) return '';
        var data = esc(JSON.stringify(voters[pick]));
        return '<div class="vb-seg ' + cls + '" style="flex:' + count + '" data-voters="' + data + '">' + count + '</div>';
      }

      return '<div class="vote-bar-wrap">' +
        '<div class="vote-bar-teams">' +
          '<span class="vbt-home">' + esc(home) + '</span>' +
          '<span class="vbt-away">' + esc(away) + '</span>' +
        '</div>' +
        '<div class="vote-bar-container">' +
          '<div class="vote-bar">' +
            seg('vb-home', 'home', counts.home) +
            seg('vb-draw', 'draw', counts.draw) +
            seg('vb-away', 'away', counts.away) +
          '</div>' +
          '<div class="vb-tooltip"></div>' +
        '</div>' +
        '<div class="vote-bar-legend">' +
          '<span><span class="vbl-dot home"></span>' + esc(home) + '</span>' +
          '<span><span class="vbl-dot draw"></span>Draw</span>' +
          '<span><span class="vbl-dot away"></span>' + esc(away) + '</span>' +
        '</div>' +
      '</div>';
    }

    function renderBubbles(predictions, match, home, away) {
      var actualResult = deriveResult(match);

      var bubbles = predictions.slice()
        .sort(function (a, b) { return (a.order_index || 0) - (b.order_index || 0); })
        .map(function (p, i) {
          var side = i % 2 === 0 ? 'left' : 'right';
          var isCorrect = actualResult && !p.failed && p.pick === actualResult;
          var isWrong   = actualResult && (p.failed || p.pick !== actualResult);
          var iconHtml  = isCorrect ? '<span class="result-icon">✅</span>'
                        : isWrong   ? '<span class="result-icon">❌</span>'
                        : '';

          var badgeHtml = '<div class="bubble-pick">' + (p.failed
            ? '<span class="pick-badge pick-failed">Prediction unavailable</span>'
            : pickBadge(p.pick, home, away)) + iconHtml + '</div>';

          var reasonHtml = p.failed
            ? '<span class="bubble-reason" style="font-style:italic">Prediction unavailable</span>'
            : '<span class="bubble-reason">' + esc(p.reasoning || '') + '</span>';

          return '<div class="chat-row ' + side + '">' +
            '<div class="chat-sender">' + modelIcon(p.model_name) + esc(p.model_name) + '</div>' +
            '<div class="chat-bubble">' +
              badgeHtml +
              reasonHtml +
            '</div>' +
          '</div>';
        })
        .join('');

      return renderVoteBar(predictions, home, away) +
        '<div class="chat-feed">' + bubbles + '</div>';
    }

    function showSpinner(generating) {
      area.innerHTML =
        '<div class="spinner-wrap">' +
          '<div class="spinner"></div>' +
          '<p class="spinner-msg">' + (generating ? 'Models are debating — this takes up to 2 minutes…' : 'Loading predictions…') + '</p>' +
        '</div>';
    }

    async function loadPredictions(matchId, home, away) {
      showSpinner(false);

      try {
        var r = await fetch('/api/predictions/' + matchId);
        if (r.ok) {
          var data = await r.json();
          if (data.predictions && data.predictions.length >= 8) {
            if (activeMatchId !== String(matchId)) return;
            area.innerHTML = renderBubbles(data.predictions, data.match, home, away);
            return;
          }
        }
      } catch (_) {}

      showSpinner(true);

      try {
        var r2 = await fetch('/api/predict/' + matchId, { method: 'POST' });
        if (!r2.ok) throw new Error('HTTP ' + r2.status);
        var data2 = await r2.json();
        if (activeMatchId !== String(matchId)) return;
        area.innerHTML = renderBubbles(data2.predictions, data2.match, home, away);
      } catch (err) {
        if (activeMatchId !== String(matchId)) return;
        area.innerHTML =
          '<div class="placeholder-msg"><strong>Error</strong>Could not load predictions. Please try again.</div>';
      }
    }

    /* ── Date strip ── */
    function renderDateStrip() {
      var html = '';
      for (var i = 0; i < MATCH_DATA.length; i++) {
        var d = MATCH_DATA[i];
        var active = d.datePart === activeDate ? ' active' : '';
        html += '<button class="date-chip' + active + '" data-date="' + esc(d.datePart) + '" data-short="' + esc(d.shortLabel) + '">' + esc(d.shortLabel) + '</button>';
      }
      return '<div class="date-strip">' + html + '</div>';
    }

    function attachChipListeners() {
      navArea.querySelectorAll('.date-chip').forEach(function (chip) {
        chip.addEventListener('click', function () { showMatchCards(chip.dataset.date); });
      });
    }

    /* ── Match cards ── */
    function renderMatchCards(group) {
      var html = '';
      for (var i = 0; i < group.matches.length; i++) {
        var m = group.matches[i];
        var selected = String(m.id) === String(activeMatchId) ? ' selected' : '';
        var scoreStr = m.finished ? (m.homeScore + '–' + m.awayScore) : 'vs';
        html += '<button class="match-card' + selected + '" data-id="' + m.id + '" data-home="' + esc(m.home) + '" data-away="' + esc(m.away) + '">' +
          '<span class="match-card-time">' + esc(m.time) + '</span>' +
          '<span class="match-card-home">' + m.homeFlag + ' ' + esc(m.home) + '</span>' +
          '<span class="match-card-score">' + esc(scoreStr) + '</span>' +
          '<span class="match-card-away">' + esc(m.away) + ' ' + m.awayFlag + '</span>' +
        '</button>';
      }
      return html;
    }

    function attachCardListeners(group) {
      matchArea.querySelectorAll('.match-card').forEach(function (card) {
        card.addEventListener('click', function () {
          gotoPredictions(card.dataset.id, card.dataset.home, card.dataset.away, group.datePart, group.shortLabel);
        });
      });
    }

    /* ── State transitions ── */
    function showMatchCards(datePart) {
      activeDate = datePart;
      var activeChip = null;
      navArea.querySelectorAll('.date-chip').forEach(function (chip) {
        var isActive = chip.dataset.date === datePart;
        chip.classList.toggle('active', isActive);
        if (isActive) activeChip = chip;
      });
      if (activeChip) activeChip.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      var group = null;
      for (var i = 0; i < MATCH_DATA.length; i++) {
        if (MATCH_DATA[i].datePart === datePart) { group = MATCH_DATA[i]; break; }
      }
      if (!group) return;
      matchArea.innerHTML = renderMatchCards(group);
      attachCardListeners(group);
      matchArea.style.display = '';
      area.style.display = 'none';
      hint.style.display = '';
    }

    function gotoPredictions(matchId, home, away, datePart, shortLabel) {
      activeMatchId = String(matchId);
      navArea.innerHTML = '<button class="back-btn">← ' + esc(shortLabel) + '</button>';
      navArea.querySelector('.back-btn').addEventListener('click', function () {
        navArea.innerHTML = renderDateStrip();
        attachChipListeners();
        hint.style.display = '';
        area.style.display = 'none';
        showMatchCards(datePart);
      });
      matchArea.style.display = 'none';
      area.style.display = '';
      hint.style.display = 'none';
      loadPredictions(matchId, home, away);
    }

    /* ── Vote bar tooltips (delegated once to area) ── */
    var isTouch = false;
    document.addEventListener('touchstart', function () { isTouch = true; }, { once: true });

    function tooltipFor(container) { return container.querySelector('.vb-tooltip'); }

    function showTooltip(seg) {
      var container = seg.closest('.vote-bar-container');
      var tooltip   = tooltipFor(container);
      var names     = JSON.parse(seg.getAttribute('data-voters') || '[]');
      tooltip.innerHTML = '<ul>' + names.map(function (n) {
        return '<li>' + modelIcon(n) + esc(n) + '</li>';
      }).join('') + '</ul>';
      var cRect = container.getBoundingClientRect();
      var sRect = seg.getBoundingClientRect();
      tooltip.style.left = (sRect.left + sRect.width / 2 - cRect.left) + 'px';
      tooltip.classList.add('active');
    }

    function hideAll() {
      area.querySelectorAll('.vb-tooltip.active').forEach(function (t) { t.classList.remove('active'); });
    }

    area.addEventListener('mouseover', function (e) {
      if (isTouch) return;
      var seg = e.target.closest('.vb-seg');
      if (!seg) return;
      showTooltip(seg);
    });

    area.addEventListener('mouseout', function (e) {
      if (isTouch) return;
      var seg = e.target.closest('.vb-seg');
      if (!seg) return;
      if (!seg.contains(e.relatedTarget)) hideAll();
    });

    area.addEventListener('click', function (e) {
      if (!isTouch) return;
      var seg = e.target.closest('.vb-seg');
      if (!seg) { hideAll(); return; }
      var container = seg.closest('.vote-bar-container');
      var tooltip   = tooltipFor(container);
      var wasActive = tooltip.classList.contains('active');
      hideAll();
      if (!wasActive) showTooltip(seg);
    });

    /* ── Init ── */
    navArea.innerHTML = renderDateStrip();
    attachChipListeners();

    // Auto-select today in ICT (UTC+7), or nearest upcoming date
    var nowICT   = new Date(Date.now() + 7 * 60 * 60 * 1000);
    var todayStr = nowICT.toISOString().slice(0, 10);
    var autoDate = null;
    for (var ai = 0; ai < MATCH_DATA.length; ai++) {
      if (MATCH_DATA[ai].datePart === todayStr) { autoDate = todayStr; break; }
    }
    if (!autoDate) {
      for (var aj = 0; aj < MATCH_DATA.length; aj++) {
        if (MATCH_DATA[aj].datePart > todayStr) { autoDate = MATCH_DATA[aj].datePart; break; }
      }
    }
    if (autoDate) showMatchCards(autoDate);
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
  <title>The Var Council · Loading</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><text y='14' font-size='14'>⚽</text></svg>" />
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
    <p class="eyebrow">THE VAR COUNCIL</p>
    <h1><em>Predictions</em></h1>
    <p class="subtitle">World Cup 2026 — 8 language models predict every match. Select one to see their picks.</p>
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

async function attachHistory(predictions, matchId) {
  const historyResult = await db.execute({
    sql: `SELECT p.model_name, p.pick, p.failed, m.home_score, m.away_score
          FROM predictions p
          JOIN matches m ON p.match_id = m.id
          WHERE m.finished = 1
            AND m.local_date_ict < (SELECT local_date_ict FROM matches WHERE id = ?)
          ORDER BY m.local_date_ict DESC`,
    args: [matchId],
  });
  const historyByModel = {};
  for (const row of historyResult.rows) {
    const name = row.model_name;
    if (!historyByModel[name]) historyByModel[name] = [];
    if (historyByModel[name].length >= 5) continue;
    let status;
    if (row.failed) {
      status = 'failed';
    } else {
      let actual;
      if (row.home_score > row.away_score) actual = 'home';
      else if (row.away_score > row.home_score) actual = 'away';
      else actual = 'draw';
      status = row.pick === actual ? 'correct' : 'wrong';
    }
    historyByModel[name].push(status);
  }
  return predictions.map(p => ({
    id: p.id, match_id: p.match_id, model_name: p.model_name, pick: p.pick,
    reasoning: p.reasoning, failed: p.failed, order_index: p.order_index,
    predicted_at: p.predicted_at, history: (historyByModel[p.model_name] || []).reverse(),
  }));
}

app.get('/api/predictions/:matchId', async (req, res) => {
  const matchId = parseInt(req.params.matchId, 10);
  if (isNaN(matchId)) return res.status(400).json({ error: 'Invalid matchId' });

  try {
    const [predResult, matchResult] = await Promise.all([
      db.execute({ sql: 'SELECT * FROM predictions WHERE match_id = ? ORDER BY order_index ASC', args: [matchId] }),
      db.execute({ sql: 'SELECT id, finished, home_score, away_score FROM matches WHERE id = ?', args: [matchId] }),
    ]);
    if (!predResult.rows.length) return res.status(404).json({ error: 'No predictions found' });
    const predictions = await attachHistory(predResult.rows, matchId);
    res.json({ predictions, match: matchResult.rows[0] || null });
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/leaderboard', (_req, res) => {
  res.send(renderLeaderboardPage());
});

app.get('/tables', async (_req, res) => {
  try {
    const groups = await computeGroupStandings();
    res.send(renderTablesPage(groups));
  } catch (err) {
    console.error('Tables error:', err);
    res.status(500).send('Error loading tables');
  }
});

app.get('/api/leaderboard', async (_req, res) => {
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
    res.json({ rows: result.rows });
  } catch (err) {
    console.error('Leaderboard DB error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function renderLeaderboardPage() {

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>The Var Council · Leaderboard</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><text y='14' font-size='14'>⚽</text></svg>" />
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
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
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
    .page-nav a.active { background: var(--accent); color: #0F172A; }

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


    .rank-cell {
      font-family: 'Space Mono', monospace;
      font-size: 13px;
      font-weight: 700;
      color: var(--text-muted);
      width: 48px;
      text-align: center;
    }


    .model-name {
      font-family: 'Space Mono', monospace;
      font-size: 12px;
      color: var(--text);
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .model-icon {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
    }

    .num-cell {
      font-family: 'Space Mono', monospace;
      font-size: 13px;
      text-align: center;
    }

    .lb-table th:nth-child(1),
    .lb-table th:nth-child(n+3) { text-align: center; }

    .empty-cell {
      text-align: center;
      color: var(--text-muted);
      padding: 40px;
      font-size: 14px;
    }

    @media (max-width: 600px) {
      body { padding: 28px 14px 60px; }
      .site-header { margin-bottom: 32px; }
      .site-header .subtitle { font-size: 13px; }
      .page-nav { margin-bottom: 18px; }
      .lb-table { font-size: 12px; }
      .lb-table th { padding: 10px 8px; font-size: 10px; }
      .lb-table td { padding: 10px 8px; }
      .num-cell { font-size: 12px; }
      .rank-cell { width: 32px; }
      .model-name { font-size: 11px; word-break: break-word; }
    }

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
  </style>
</head>
<body>
  <header class="site-header">
    <p class="eyebrow">THE VAR COUNCIL</p>
    <h1><em>Leaderboard</em></h1>
    <p class="subtitle">Ranked by total correct predictions across finished matches.</p>
  </header>

  <nav class="page-nav">
    <a href="/">Predictions</a>
    <a href="/leaderboard" class="active">Leaderboard</a>
    <a href="/tables">Tables</a>
    <a href="/knockout">Knockout</a>
  </nav>

  <main style="width:100%;max-width:740px;">
    <div id="lb-container">
      <div class="spinner-wrap">
        <div class="spinner"></div>
        <p class="spinner-msg">Loading leaderboard&hellip;</p>
      </div>
    </div>
  </main>

<script>
  const MODEL_ICON_MAP = {
    'minimax':  'minimax-color.svg',
    'glm':      'zai.svg',
    'kimi':     'kimi-color.svg',
    'qwen':     'qwen-color.svg',
    'deepseek': 'deepseek-color.svg',
    'claude':   'claude-color.svg',
    'gemini':   'google-color.svg',
    'gpt':      'openai.svg',
  };

  function modelIcon(name) {
    const lower = (name || '').toLowerCase();
    for (const prefix in MODEL_ICON_MAP) {
      if (lower.startsWith(prefix)) {
        return \`<img src="/icons/\${MODEL_ICON_MAP[prefix]}" class="model-icon" alt="">\`;
      }
    }
    return '';
  }

  fetch('/api/leaderboard')
    .then(r => r.json())
    .then(({ rows }) => {
      const container = document.getElementById('lb-container');
      if (!rows || rows.length === 0) {
        container.innerHTML = '<div class="spinner-wrap"><p class="spinner-msg">No finished matches with predictions yet.</p></div>';
        return;
      }
      const bodyRows = rows.map((r, i) => {
        const acc = r.matches_predicted > 0
          ? ((r.correct / r.matches_predicted) * 100).toFixed(1)
          : '0.0';
        const name = r.model_name.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        return \`<tr>
          <td class="rank-cell">\${i + 1}</td>
          <td><span class="model-name">\${modelIcon(r.model_name)}\${name}</span></td>
          <td class="num-cell">\${r.correct}</td>
          <td class="num-cell">\${r.matches_predicted}</td>
          <td class="num-cell">\${acc}%</td>
        </tr>\`;
      }).join('');
      container.innerHTML = \`<div class="lb-wrap">
        <table class="lb-table">
          <thead><tr>
            <th>Rank</th><th>Model</th><th>Correct</th><th>Predicted</th><th>Accuracy</th>
          </tr></thead>
          <tbody>\${bodyRows}</tbody>
        </table>
      </div>\`;
    })
    .catch(() => {
      document.getElementById('lb-container').innerHTML = '<div class="spinner-wrap"><p class="spinner-msg">Failed to load leaderboard.</p></div>';
    });
</script>
</body>
</html>`;
}

async function computeGroupStandings() {
  const result = await db.execute(
    "SELECT home_team, away_team, home_team_id, away_team_id, home_score, away_score, finished, stage_group, local_date_ict FROM matches WHERE type = 'group' ORDER BY local_date_ict ASC"
  );

  const groups = new Map();

  for (const m of result.rows) {
    const g = m.stage_group;
    if (!groups.has(g)) groups.set(g, new Map());
    const gm = groups.get(g);
    const home = m.home_team;
    const away = m.away_team;
    if (home && m.home_team_id !== '0' && !gm.has(home))
      gm.set(home, { mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, results: [] });
    if (away && m.away_team_id !== '0' && !gm.has(away))
      gm.set(away, { mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, results: [] });
  }

  for (const m of result.rows) {
    if (!m.finished || m.home_score === null || m.away_score === null) continue;
    const home = m.home_team;
    const away = m.away_team;
    if (!home || !away) continue;
    const gm = groups.get(m.stage_group);
    if (!gm) continue;
    const hs = gm.get(home);
    const as_ = gm.get(away);
    if (!hs || !as_) continue;
    const h = Number(m.home_score);
    const a = Number(m.away_score);
    hs.mp++; as_.mp++;
    hs.gf += h; hs.ga += a;
    as_.gf += a; as_.ga += h;
    if (h > a) {
      hs.w++; as_.l++;
      hs.results.push('w'); as_.results.push('l');
    } else if (h < a) {
      hs.l++; as_.w++;
      hs.results.push('l'); as_.results.push('w');
    } else {
      hs.d++; as_.d++;
      hs.results.push('d'); as_.results.push('d');
    }
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([letter, gm]) => {
      const teams = [...gm.entries()]
        .map(([name, s]) => {
          const gd = s.gf - s.ga;
          const pts = s.w * 3 + s.d;
          const raw = s.results.slice(-3);
          const last3 = [...raw, null, null, null].slice(0, 3);
          return { name, mp: s.mp, w: s.w, d: s.d, l: s.l, gf: s.gf, ga: s.ga, gd, pts, last3 };
        })
        .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
      return { name: 'Group ' + letter, teams };
    });
}

function renderTablesPage(groups) {
  function ri(r) {
    if (r === 'w') return '<span class="ri ri-w">✓</span>';
    if (r === 'l') return '<span class="ri ri-l">✕</span>';
    if (r === 'd') return '<span class="ri ri-d">−</span>';
    return '<span class="ri ri-n">?</span>';
  }

  function gSign(n) {
    return n > 0 ? '+' + n : String(n);
  }

  const groupStrip = `<div class="group-strip">
    ${groups.map((g, i) => `<button class="group-chip${i === 0 ? ' active' : ''}" data-group="${escHtml(g.name)}">${escHtml(g.name)}</button>`).join('')}
  </div>`;

  const groupCards = groups.map(({ name, teams }) => {
    const rows = teams.map((t, i) => {
      const flag = TEAM_FLAGS[t.name] ? flagImg(TEAM_FLAGS[t.name]) : '';
      const last3html = t.last3.map(ri).join('');
      return `<tr>
            <td class="gt-rank">${i + 1}</td>
            <td class="gt-team">${flag ? flag + ' ' : ''}${escHtml(t.name)}</td>
            <td class="gt-num">${t.mp}</td>
            <td class="gt-num">${t.w}</td>
            <td class="gt-num">${t.d}</td>
            <td class="gt-num">${t.l}</td>
            <td class="gt-num">${t.gf}</td>
            <td class="gt-num">${t.ga}</td>
            <td class="gt-num">${gSign(t.gd)}</td>
            <td class="gt-pts">${t.pts}</td>
            <td class="gt-last3">${last3html}</td>
          </tr>`;
    }).join('');

    return `<div class="group-card" data-group="${escHtml(name)}">
      <div class="group-card-header">${escHtml(name)}</div>
      <div class="group-table-wrap">
        <table class="group-table">
          <thead><tr>
            <th class="gt-rank"></th>
            <th class="gt-team">Team</th>
            <th class="gt-num">MP</th>
            <th class="gt-num">W</th>
            <th class="gt-num">D</th>
            <th class="gt-num">L</th>
            <th class="gt-num">GF</th>
            <th class="gt-num">GA</th>
            <th class="gt-num">GD</th>
            <th class="gt-pts">Pts</th>
            <th class="gt-last3">Last 3</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>The Var Council — Tables</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><text y='14' font-size='14'>⚽</text></svg>" />
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

    .site-header h1 em { font-style: normal; color: var(--accent); }

    .site-header .subtitle {
      font-size: 14px;
      color: var(--text-muted);
      margin-top: 4px;
    }

    .page-nav {
      width: 100%;
      max-width: 740px;
      margin-bottom: 32px;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .page-nav a {
      display: inline-flex;
      align-items: center;
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
    .page-nav a.active { background: var(--accent); color: #0F172A; }

    /* ── Group strip ── */
    .group-strip {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 4px;
      scrollbar-width: none;
      -ms-overflow-style: none;
      margin-bottom: 16px;
    }
    .group-strip::-webkit-scrollbar { display: none; }

    .group-chip {
      flex-shrink: 0;
      padding: 8px 16px;
      border-radius: 20px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text-muted);
      font-family: 'Space Mono', monospace;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
      letter-spacing: 0.04em;
      transition: border-color 0.15s, background 0.15s, color 0.15s;
    }
    .group-chip:hover { border-color: var(--accent); color: var(--text); }
    .group-chip.active { border-color: var(--accent); background: var(--accent-dim); color: var(--accent); }

    /* ── Groups grid ── */
    .groups-grid {
      width: 100%;
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
    }



    /* ── Group card ── */
    .group-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
    }

    .group-card-header {
      padding: 12px 16px;
      font-family: 'Space Mono', monospace;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--accent);
      border-bottom: 1px solid var(--border);
    }

    .group-table-wrap { overflow-x: auto; }

    /* ── Group table ── */
    .group-table {
      width: 100%;
      min-width: 440px;
      table-layout: fixed;
      border-collapse: collapse;
      font-size: 13px;
    }

    .group-table thead th {
      padding: 8px 6px;
      font-family: 'Space Mono', monospace;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }

    .group-table tbody td {
      padding: 10px 6px;
      border-bottom: 1px solid var(--border);
      vertical-align: middle;
    }

    .group-table tbody tr:last-child td { border-bottom: none; }

    .gt-rank {
      text-align: center;
      width: 28px;
      white-space: nowrap;
      color: var(--text-muted);
      font-family: 'Space Mono', monospace;
      font-size: 11px;
    }

    .gt-team {
      text-align: left;
      padding-left: 10px !important;
      white-space: normal;
      word-break: break-word;
    }

    .gt-num {
      text-align: center;
      width: 30px;
      white-space: nowrap;
      font-family: 'Space Mono', monospace;
      color: var(--text-muted);
    }

    .gt-pts {
      text-align: center;
      width: 32px;
      white-space: nowrap;
      font-family: 'Space Mono', monospace;
      font-weight: 700;
      color: var(--text);
    }

    .gt-last3 {
      text-align: right;
      width: 76px;
      white-space: nowrap;
      padding-right: 12px !important;
    }

    .group-table thead th.gt-rank,
    .group-table thead th.gt-num,
    .group-table thead th.gt-pts { text-align: center; }

    .group-table thead th.gt-team { text-align: left; padding-left: 10px; }
    .group-table thead th.gt-last3 { text-align: right; padding-right: 12px; }

    /* ── Result icons ── */
    .ri {
      display: inline-block;
      font-size: 13px;
      font-weight: 700;
      font-family: 'Space Mono', monospace;
    }

    .ri + .ri { margin-left: 4px; }

    .ri-w { color: #22C55E; }
    .ri-l { color: #EF4444; }
    .ri-d { color: #64748B; }
    .ri-n { color: #475569; }

    @media (max-width: 600px) {
      body { padding: 28px 14px 60px; }
      .site-header { margin-bottom: 32px; }
      .site-header .subtitle { font-size: 13px; }
      .page-nav { margin-bottom: 18px; }
      .group-table { font-size: 12px; }
    }
  </style>
</head>
<body>
  <header class="site-header">
    <p class="eyebrow">THE VAR COUNCIL</p>
    <h1><em>Tables</em></h1>
    <p class="subtitle">World Cup 2026 group stage standings.</p>
  </header>

  <nav class="page-nav">
    <a href="/">Predictions</a>
    <a href="/leaderboard">Leaderboard</a>
    <a href="/tables" class="active">Tables</a>
    <a href="/knockout">Knockout</a>
  </nav>

  <main style="width:100%;max-width:740px;">
    ${groupStrip}
    <div class="groups-grid">
      ${groupCards}
    </div>
  </main>
  <script>
    (function () {
      var chips = document.querySelectorAll('.group-chip');
      var cards = document.querySelectorAll('.group-card');
      function showGroup(name) {
        chips.forEach(function (c) { c.classList.toggle('active', c.dataset.group === name); });
        cards.forEach(function (c) { c.style.display = c.dataset.group === name ? '' : 'none'; });
      }
      chips.forEach(function (c) { c.addEventListener('click', function () { showGroup(c.dataset.group); }); });
      if (chips.length) showGroup(chips[0].dataset.group);
    })();
  </script>
</body>
</html>`;
}

// ─── Knockout bracket ──────────────────────────────────────────────────────

const KO_ROUNDS_CFG = [
  { type: 'r32',   label: 'Round of 32',   short: 'R32'   },
  { type: 'r16',   label: 'Round of 16',   short: 'R16'   },
  { type: 'qf',    label: 'Quarterfinals', short: 'QF'    },
  { type: 'sf',    label: 'Semifinals',    short: 'SF'     },
  { type: 'third', label: 'Third Place',   short: '3RD'   },
  { type: 'final', label: 'Final',         short: 'Final' },
];

function parseMatchRef(label) {
  const m = label && label.match(/Winner Match (\d+)/i);
  return m ? m[1] : null;
}

function buildBracketOrder(allMatches) {
  const byApiId = {};
  for (const m of allMatches) byApiId[m.api_id] = m;
  const byType = {};
  for (const m of allMatches) {
    if (!byType[m.type]) byType[m.type] = [];
    byType[m.type].push(m);
  }
  const finalMatch = (byType['final'] || [])[0];
  if (!finalMatch) return null;

  function collectLeaves(apiId) {
    const m = byApiId[apiId];
    if (!m) return [];
    if (m.type === 'r32') return [m];
    const homeId = parseMatchRef(m.home_team_label);
    const awayId = parseMatchRef(m.away_team_label);
    return [
      ...(homeId ? collectLeaves(homeId) : []),
      ...(awayId ? collectLeaves(awayId) : []),
    ];
  }
  const r32Order = collectLeaves(finalMatch.api_id);

  function findParent(id1, id2, candidates) {
    return candidates.find(m => {
      const h = parseMatchRef(m.home_team_label);
      const a = parseMatchRef(m.away_team_label);
      return (h === id1 && a === id2) || (h === id2 && a === id1);
    });
  }
  function deriveOrder(prevOrder, candidates) {
    const result = [];
    for (let i = 0; i < prevOrder.length; i += 2) {
      const a = prevOrder[i], b = prevOrder[i + 1];
      if (!b) continue;
      const parent = findParent(a.api_id, b.api_id, candidates);
      if (parent) result.push(parent);
    }
    return result;
  }
  const r16Order   = deriveOrder(r32Order,   byType['r16']   || []);
  const qfOrder    = deriveOrder(r16Order,   byType['qf']    || []);
  const sfOrder    = deriveOrder(qfOrder,    byType['sf']    || []);
  const finalOrder = deriveOrder(sfOrder,    byType['final'] || []);
  return {
    r32: r32Order, r16: r16Order, qf: qfOrder, sf: sfOrder,
    final: finalOrder.length ? finalOrder : (byType['final'] || []),
  };
}

function koTeamRow(name, teamId, score, finished) {
  const tbd = !name || !teamId || teamId === '0';
  const flag = !tbd && TEAM_FLAGS[name] ? flagImg(TEAM_FLAGS[name]) : '';
  const scoreHtml = finished && score != null ? `<span class="ko-score">${score}</span>` : '';
  if (tbd) {
    return `<div class="ko-team-row"><span class="ko-shield"></span><span class="ko-name ko-tbd">TBD</span>${scoreHtml}</div>`;
  }
  return `<div class="ko-team-row"><span class="ko-flag">${flag}</span><span class="ko-name">${escHtml(name)}</span>${scoreHtml}</div>`;
}

function koCardHtml(m) {
  const dateStr = m.local_date_ict
    ? formatDateLabel(m.local_date_ict.split(' ')[0]) + ', ' + m.local_date_ict.split(' ')[1]
    : '—';
  return `<div class="ko-card">
  <div class="ko-date">${escHtml(dateStr)}</div>
  ${koTeamRow(m.home_team, m.home_team_id, m.home_score, m.finished)}
  ${koTeamRow(m.away_team, m.away_team_id, m.away_score, m.finished)}
</div>`;
}

// SVG bracket connector: vertical bar connecting two card centers with a stub going right.
// Uses percentage coordinates so it scales to any card height without JS measurement.
const PAIR_CONN = `<div class="ko-pair-conn-wrap"><svg class="ko-pair-conn" xmlns="http://www.w3.org/2000/svg"><line x1="0%" y1="25%" x2="50%" y2="25%"/><line x1="50%" y1="25%" x2="50%" y2="75%"/><line x1="0%" y1="75%" x2="50%" y2="75%"/><line x1="50%" y1="50%" x2="100%" y2="50%"/></svg></div>`;

async function getKnockoutMatches() {
  const result = await db.execute(`
    SELECT id, api_id, home_team, away_team, home_team_id, away_team_id,
           home_team_label, away_team_label, type,
           local_date_ict, home_score, away_score, finished
    FROM matches
    WHERE type IN ('r32', 'r16', 'qf', 'sf', 'third', 'final')
    ORDER BY local_date_ict ASC
  `);
  return result.rows;
}

function renderKnockoutPage(matches) {
  const byTypeDate = {};
  for (const r of KO_ROUNDS_CFG) byTypeDate[r.type] = [];
  for (const m of matches) {
    if (byTypeDate[m.type]) byTypeDate[m.type].push(m);
  }

  // Default: earliest round with at least one unfinished match; fallback to 'final'
  let defaultPhase = 'final';
  for (const r of KO_ROUNDS_CFG) {
    if (byTypeDate[r.type].some(m => !m.finished)) {
      defaultPhase = r.type;
      break;
    }
  }

  // Bracket order gives correct pairing (adjacent pairs feed same next-round slot)
  const bracketOrder = buildBracketOrder(matches);

  const chipsHtml = KO_ROUNDS_CFG.map(r =>
    `<button class="ko-round-chip${r.type === defaultPhase ? ' active' : ''}" data-phase="${r.type}">${escHtml(r.short)}</button>`
  ).join('');

  let phasesHtml = '';
  for (const r of KO_ROUNDS_CFG) {
    const roundMatches = (bracketOrder && bracketOrder[r.type] && bracketOrder[r.type].length)
      ? bracketOrder[r.type]
      : byTypeDate[r.type];

    let innerHtml = '';
    if (!roundMatches || roundMatches.length === 0) {
      innerHtml = `<p class="ko-empty">No matches scheduled yet.</p>`;
    } else if (roundMatches.length === 1) {
      innerHtml = `<div class="ko-single">${koCardHtml(roundMatches[0])}</div>`;
    } else {
      for (let i = 0; i < roundMatches.length; i += 2) {
        const a = roundMatches[i];
        const b = roundMatches[i + 1];
        if (!b) {
          innerHtml += koCardHtml(a);
        } else {
          innerHtml += `<div class="ko-pair-group"><div class="ko-pair-cards">${koCardHtml(a)}${koCardHtml(b)}</div>${PAIR_CONN}</div>`;
        }
      }
    }

    phasesHtml += `<div class="ko-phase" data-phase="${r.type}"${r.type !== defaultPhase ? ' style="display:none"' : ''}><div class="ko-bracket-view">${innerHtml}</div></div>`;
  }

  const mainContent = matches.length
    ? `<div class="ko-round-strip">${chipsHtml}</div>
<div class="ko-list">${phasesHtml}</div>`
    : `<div class="placeholder-msg"><strong>Knockout bracket</strong>No knockout matches found.</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>The Var Council — Knockout</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><text y='14' font-size='14'>⚽</text></svg>" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0F172A; --surface: #1E293B; --surface-2: #263347; --border: #334155;
      --accent: #38BDF8; --accent-dim: rgba(56,189,248,0.15);
      --text: #F1F5F9; --text-muted: #94A3B8; --radius: 10px;
    }
    body { background: var(--bg); color: var(--text); font-family: 'Space Grotesk', system-ui, sans-serif; min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 48px 20px 80px; }
    .site-header { width: 100%; max-width: 740px; margin-bottom: 48px; display: flex; flex-direction: column; gap: 6px; }
    .site-header .eyebrow { font-family: 'Space Mono', monospace; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--accent); }
    .site-header h1 { font-size: clamp(28px,5vw,42px); font-weight: 700; line-height: 1.1; color: var(--text); letter-spacing: -0.02em; }
    .site-header h1 em { font-style: normal; color: var(--accent); }
    .site-header .subtitle { font-size: 14px; color: var(--text-muted); margin-top: 4px; }
    .page-nav { width: 100%; max-width: 740px; margin-bottom: 24px; display: flex; gap: 8px; flex-wrap: wrap; }
    .page-nav a { display: inline-flex; align-items: center; gap: 6px; font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); text-decoration: none; padding: 8px 14px; border: 1px solid var(--accent); border-radius: 6px; transition: background 0.15s; }
    .page-nav a:hover { background: var(--accent-dim); }
    .page-nav a.active { background: var(--accent); color: #0F172A; }
    .ko-round-strip { width: 100%; max-width: 740px; display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; margin-bottom: 24px; scrollbar-width: none; -ms-overflow-style: none; }
    .ko-round-strip::-webkit-scrollbar { display: none; }
    .ko-round-chip { flex-shrink: 0; padding: 8px 16px; border-radius: 20px; border: 1px solid var(--border); background: var(--surface); color: var(--text-muted); font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; letter-spacing: 0.04em; transition: border-color 0.15s, background 0.15s, color 0.15s; }
    .ko-round-chip:hover { border-color: var(--accent); color: var(--text); }
    .ko-round-chip.active { border-color: var(--accent); background: var(--accent-dim); color: var(--accent); }
    .ko-list { width: 100%; max-width: 740px; }
    .ko-bracket-view { display: flex; flex-direction: column; gap: 16px; width: 100%; }
    .ko-pair-group { display: flex; flex-direction: row; align-items: stretch; width: 320px; margin: 0 auto; }
    .ko-pair-cards { flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .ko-single { width: 320px; margin: 0 auto; }
    .ko-pair-conn-wrap { width: 28px; flex-shrink: 0; position: relative; align-self: stretch; }
    .ko-pair-conn { position: absolute; top: 0; left: 0; width: 100%; height: 100%; overflow: visible; }
    .ko-pair-conn line { stroke: var(--border); stroke-width: 1.5; stroke-linecap: round; fill: none; }
    .ko-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
    .ko-date { font-family: 'Space Mono', monospace; font-size: 10px; color: var(--text-muted); }
    .ko-team-row { display: flex; align-items: center; gap: 7px; }
    .ko-shield { width: 15px; height: 17px; flex-shrink: 0; background: var(--border); clip-path: polygon(50% 0%, 100% 14%, 100% 62%, 50% 100%, 0% 62%, 0% 14%); }
    .ko-flag { font-size: 15px; line-height: 1; width: 20px; text-align: center; flex-shrink: 0; }
    .ko-name { font-size: 13px; font-weight: 500; color: var(--text); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ko-tbd { color: var(--text-muted); font-weight: 400; }
    .ko-score { font-family: 'Space Mono', monospace; font-size: 13px; font-weight: 700; color: var(--text); margin-left: auto; flex-shrink: 0; }
    .ko-empty { font-size: 13px; color: var(--text-muted); text-align: center; padding: 24px 0; }
    .placeholder-msg { background: var(--surface); border: 1px dashed var(--border); border-radius: var(--radius); padding: 40px; text-align: center; color: var(--text-muted); font-size: 14px; }
    .placeholder-msg strong { display: block; font-size: 16px; color: var(--text); margin-bottom: 6px; }
    @media (max-width: 560px) {
      .ko-round-chip { font-size: 11px; padding: 7px 12px; }
    }
  </style>
</head>
<body>
  <header class="site-header">
    <p class="eyebrow">THE VAR COUNCIL</p>
    <h1><em>Knockout</em></h1>
    <p class="subtitle">World Cup 2026 knockout stage — one round at a time.</p>
  </header>
  <nav class="page-nav">
    <a href="/">Predictions</a>
    <a href="/leaderboard">Leaderboard</a>
    <a href="/tables">Tables</a>
    <a href="/knockout" class="active">Knockout</a>
  </nav>
  <main style="width:100%;max-width:740px;">
    ${mainContent}
  </main>
  <script>
    document.querySelectorAll('.ko-round-chip').forEach(function(chip) {
      chip.addEventListener('click', function() {
        document.querySelectorAll('.ko-round-chip').forEach(function(c) { c.classList.remove('active'); });
        chip.classList.add('active');
        document.querySelectorAll('.ko-phase').forEach(function(el) {
          el.style.display = el.dataset.phase === chip.dataset.phase ? '' : 'none';
        });
      });
    });
  </script>
</body>
</html>`;
}

app.get('/knockout', async (_req, res) => {
  try {
    const matches = await getKnockoutMatches();
    res.send(renderKnockoutPage(matches));
  } catch (err) {
    console.error('Knockout error:', err);
    res.status(500).send('Error loading knockout bracket');
  }
});

const inFlight = new Map();

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
    if (!inFlight.has(matchId)) {
      inFlight.set(matchId, getPredictions(matchId).finally(() => inFlight.delete(matchId)));
    }
    const raw = await inFlight.get(matchId);
    const predictions = await attachHistory(raw, matchId);
    res.json({ predictions, match });
  } catch (err) {
    console.error('Prediction error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = app;
