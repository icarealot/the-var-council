const path = require('path');
const express = require('express');
const db = require('./db');
const sync = require('./sync');
const { getPredictions } = require('./predict');

const app = express();
app.use(express.json());
app.use('/icons', express.static(path.join(__dirname, '../public/icons')));

const TEAM_FLAGS = {
  'Algeria': '🇩🇿', 'Argentina': '🇦🇷', 'Australia': '🇦🇺', 'Austria': '🇦🇹',
  'Belgium': '🇧🇪', 'Bosnia and Herzegovina': '🇧🇦', 'Brazil': '🇧🇷',
  'Canada': '🇨🇦', 'Cape Verde': '🇨🇻', 'Colombia': '🇨🇴', 'Croatia': '🇭🇷',
  'Curaçao': '🇨🇼', 'Czech Republic': '🇨🇿',
  'Democratic Republic of the Congo': '🇨🇩',
  'Ecuador': '🇪🇨', 'Egypt': '🇪🇬', 'England': '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  'France': '🇫🇷', 'Germany': '🇩🇪', 'Ghana': '🇬🇭',
  'Haiti': '🇭🇹',
  'Iran': '🇮🇷', 'Iraq': '🇮🇶', 'Ivory Coast': '🇨🇮',
  'Japan': '🇯🇵', 'Jordan': '🇯🇴',
  'Mexico': '🇲🇽', 'Morocco': '🇲🇦',
  'Netherlands': '🇳🇱', 'New Zealand': '🇳🇿', 'Norway': '🇳🇴',
  'Panama': '🇵🇦', 'Paraguay': '🇵🇾', 'Portugal': '🇵🇹',
  'Qatar': '🇶🇦',
  'Saudi Arabia': '🇸🇦', 'Scotland': '🏴󠁧󠁢󠁳󠁣󠁴󠁿', 'Senegal': '🇸🇳',
  'South Africa': '🇿🇦', 'South Korea': '🇰🇷', 'Spain': '🇪🇸', 'Sweden': '🇸🇪',
  'Switzerland': '🇨🇭',
  'Tunisia': '🇹🇳', 'Turkey': '🇹🇷',
  'United States': '🇺🇸', 'Uruguay': '🇺🇾', 'Uzbekistan': '🇺🇿',
};

function teamWithFlag(name) {
  const flag = TEAM_FLAGS[name];
  return flag ? `${flag} ${name}` : name;
}

function teamWithFlagAfter(name) {
  const flag = TEAM_FLAGS[name];
  return flag ? `${name} ${flag}` : name;
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

  const options = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([datePart, dayMatches]) => {
      const label = formatDateLabel(datePart);
      const opts = dayMatches
        .sort((a, b) => (a.local_date_ict || '').localeCompare(b.local_date_ict || ''))
        .map((m) => {
          const home = m.home_team || m.home_team_label || '?';
          const away = m.away_team || m.away_team_label || '?';
          const score = m.finished ? `${m.home_score}–${m.away_score}` : '?–?';
          const optLabel = `${formatTimeOnly(m.local_date_ict)}  ${teamWithFlag(home)} ${score} ${teamWithFlagAfter(away)}`;
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

    @media (max-width: 600px) {
      body { padding: 28px 14px 60px; }

      .site-header { margin-bottom: 32px; }
      .site-header .subtitle { font-size: 13px; }

      .selector-card { padding: 18px 14px 22px; }
      select#match-select { font-size: 12px; padding: 10px 36px 10px 12px; }
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
    <a href="/leaderboard">Leaderboard</a>
  </nav>

  <main style="width:100%;max-width:740px;">
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
        Select a match above to load AI predictions.
      </div>
    </div>
  </main>

  <script>
  (function () {
    var sel  = document.getElementById('match-select');
    var area = document.getElementById('prediction-area');

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
      var counts = { home: 0, draw: 0, away: 0 };
      predictions.forEach(function (p) {
        if (!p.failed && counts.hasOwnProperty(p.pick)) counts[p.pick]++;
      });
      var total = counts.home + counts.draw + counts.away;
      if (total === 0) return '';

      function seg(cls, count) {
        if (count === 0) return '';
        return '<div class="vb-seg ' + cls + '" style="flex:' + count + '">' + count + '</div>';
      }

      return '<div class="vote-bar-wrap">' +
        '<div class="vote-bar-teams">' +
          '<span class="vbt-home">' + esc(home) + '</span>' +
          '<span class="vbt-away">' + esc(away) + '</span>' +
        '</div>' +
        '<div class="vote-bar">' +
          seg('vb-home', counts.home) +
          seg('vb-draw', counts.draw) +
          seg('vb-away', counts.away) +
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
            if (sel.value !== String(matchId)) return;
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
        if (sel.value !== String(matchId)) return;
        area.innerHTML = renderBubbles(data2.predictions, data2.match, home, away);
      } catch (err) {
        if (sel.value !== String(matchId)) return;
        area.innerHTML =
          '<div class="placeholder-msg"><strong>Error</strong>Could not load predictions. Please try again.</div>';
      }
    }

    var debounceTimer = null;
    sel.addEventListener('change', function () {
      var opt     = sel.options[sel.selectedIndex];
      var matchId = sel.value;
      var home    = (opt.dataset && opt.dataset.home) || 'Home';
      var away    = (opt.dataset && opt.dataset.away) || 'Away';
      showSpinner(false);
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () { loadPredictions(matchId, home, away); }, 1000);
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

app.get('/api/predictions/:matchId', async (req, res) => {
  const matchId = parseInt(req.params.matchId, 10);
  if (isNaN(matchId)) return res.status(400).json({ error: 'Invalid matchId' });

  try {
    const [predResult, matchResult] = await Promise.all([
      db.execute({ sql: 'SELECT * FROM predictions WHERE match_id = ? ORDER BY order_index ASC', args: [matchId] }),
      db.execute({ sql: 'SELECT id, finished, home_score, away_score FROM matches WHERE id = ?', args: [matchId] }),
    ]);
    if (!predResult.rows.length) return res.status(404).json({ error: 'No predictions found' });
    res.json({ predictions: predResult.rows, match: matchResult.rows[0] || null });
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/leaderboard', (_req, res) => {
  res.send(renderLeaderboardPage());
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
    const predictions = await inFlight.get(matchId);
    res.json({ predictions, match });
  } catch (err) {
    console.error('Prediction error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = app;
