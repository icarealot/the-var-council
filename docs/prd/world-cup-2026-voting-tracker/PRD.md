# World Cup 2026 Voting Tracker

## Problem Statement

A group of friends (~10 people) wants to compete on World Cup 2026 match predictions across all their devices. They need a simple, private web app with no email or password management, a lightweight login system, a voting interface for match outcomes, a personal history of their picks, and a leaderboard to see who predicted the most matches correctly. The app must work from any device, survive server restarts, and be easy to maintain by a non-developer who is testing vibe coding as a learning project.

## Solution

A single web app built with Express + SQLite, hosted on Render’s free tier, using long-lived session cookies stored in a persistent SQLite database. Users register by entering a nickname and receiving a funny, football-themed login key (e.g., `Neymar-Dive`). They log in with this key on any device and stay logged in until they clear cookies or switch browsers. The app fetches match data from the `worldcup26.ir` API on startup, caches it locally, and syncs again every 6 hours or on demand. The vote page shows all 104 matches with a horizontal scrollable tab bar to filter by Today (default), each group, or each knockout round. Users vote 1X2 (home win / draw / away win) before kickoff, and can change their vote until the match starts. The final match also requires an exact score prediction for tie-breaker purposes. Votes are secret until the match ends, then revealed for everyone. A history page shows the user’s own past votes. A leaderboard ranks all players by total correct predictions, with exact final-score prediction and longest consecutive correct streak as tie-breakers. An admin page lets the host reset lost login keys by nickname without touching the database directly.

## Implementation Decisions

- **Stack & Hosting**: Express.js server-side rendered HTML (no frontend framework) with SQLite for persistence, deployed on Render free tier. Rationale: minimal abstraction layers, easy for a beginner to debug, no build step, persistent disk for SQLite, zero cost.
- **Timezone**: All match times and vote lockouts are displayed and calculated in Vietnam time (ICT, UTC+7). The API returns local US/Mexico/Canada dates; the app must convert to ICT for display and lockout logic.
- **Session Management**: `express-session` with `connect-sqlite3` session store, cookie `maxAge` set to 365 days. Rationale: survives Render server sleep, works across browser restarts, no login needed on the same device for a full year.
- **Authentication Flow**: No passwords. Registration: user enters a unique nickname, server assigns a random unused `Player-Action` key (e.g., `Haaland-Eat`, `Mbappe-Sprint`) from a pre-seeded list of ~50 funny football pairs. Login: user enters their key. The server checks it against the `users` table and creates a session cookie. If a user forgets their key, an admin page (`/admin`) with a hardcoded password allows the host to delete the old key for that nickname; the user re-registers with the same nickname and reclaims their account (all votes/history preserved).
- **Match Data Source**: `https://worldcup26.ir` API (open source, no key required). The app fetches all matches, teams, and scores on startup and stores them in a local `matches` table. On every page visit, if the cached data is older than 6 hours, it re-fetches and updates the cache. If the API is unreachable on first visit, the app shows an error page with a retry button. Rationale: no manual data entry, no risk of stale data from the repo, but the app can still display cached data if the API is temporarily down after a successful first sync.
- **Database Schema**:
  - `users`: `id`, `nickname` (unique), `login_key` (unique, nullable for reset), `created_at`.
  - `matches`: `id`, `api_id`, `home_team`, `away_team`, `group_or_stage`, `local_date_ict`, `api_status`, `home_score`, `away_score`, `finished`, `last_synced_at`.
  - `votes`: `id`, `user_id`, `match_id`, `pick` (`home`, `draw`, `away`), `final_exact_score` (nullable, only for final match), `voted_at`.
  - `streaks` (computed on demand or cached): not stored; calculated from `votes` table by grouping consecutive correct predictions with no gaps.
- **API Endpoints**: Server-side rendered pages (GET) with HTML forms, plus JSON endpoints for AJAX if needed. Key routes: `GET /` (login/register page), `POST /register`, `POST /login`, `GET /logout`, `GET /vote`, `GET /api/matches` (filtered by tab), `POST /api/vote`, `GET /history`, `GET /leaderboard`, `GET /admin`, `POST /admin/reset`, `POST /api/sync` (manual sync, requires session).
- **Vote Lockout Logic**: A match is votable only if its ICT kickoff time is in the future. Users can vote and change their vote until kickoff. Once the match starts, the vote is locked. If the API reschedules a match after the original time, the original lockout time remains (no re-opening). The server checks `match.local_date_ict > now()` on every save.
- **Knockout Stage Handling**: Knockout matches do not show a "draw" option. Only "Home win" and "Away win" are available. The winner is determined by the API’s final score (which includes extra time and penalties if applicable).
- **Vote Secrecy**: Before a match finishes, the vote page only shows the logged-in user’s own vote. Other users’ votes are hidden. After the match finishes (`finished = true`), the API updates the scores, and the app reveals all users’ votes for that match. Rationale: creates suspense and banter after the match.
- **Scoring & Leaderboard**: Each correct 1X2 prediction = 1 point. The final match’s exact score prediction is stored but does not award points; it is used only as the first tie-breaker. The leaderboard is a ranked table sorted by total points descending. Tie-breakers: (1) exact final score prediction correct, (2) longest consecutive correct streak (a missed match breaks the streak). Streaks are calculated dynamically from the `votes` table by iterating through matches in chronological order.
- **Tab Bar Design**: Horizontal scrollable CSS tab bar on the vote page. Tabs: Today (default), Group A, Group B, ..., Group L, Round of 32, Round of 16, Quarter-finals, Semi-finals, Final. Each tab filters the match list client-side (or server-side with query param). The tab bar must be scrollable on mobile without wrapping.
- **Final Match Special Case**: On the vote page, the Final tab shows the final match with both a 1X2 picker and an exact score input field (e.g., home: 2, away: 1). The exact score is saved alongside the 1X2 pick. It is never used for scoring; only for tie-breaker.
- **Error & Sync UI**: If the API is unreachable on first visit, a full-page error with a "Retry" button is shown. If the API is unreachable on a subsequent sync (cached data exists), the app shows a yellow banner "Last synced X hours ago" and uses cached data. The manual sync button is visible on the vote page.
- **Admin Page**: A simple `/admin` route protected by a hardcoded password (plain text in server config, acceptable for 10 friends). It shows a table of all users with their nickname, last login time, and a "Reset Key" button. Clicking it nullifies the user’s `login_key`; the user can then re-register with the same nickname to get a new key and reclaim their account.

## Testing Decisions

- **Registration & Login Workflow**: Create a user, note the key, close browser, reopen, log in with key, verify session persists. Then clear cookies, verify re-login required.
- **Vote Lockout**: Vote on a match, verify the pick is saved. Try to change the vote before kickoff, verify it updates. Wait until kickoff (or manually set the match time to the past in the DB), verify the vote form is hidden/replaced with the locked result.
- **API Sync Failure**: Start the app with no network access, verify the error page shows. Start the app with network, then disconnect, verify the yellow banner shows and cached data is used.
- **Leaderboard & Tie-breaker**: Seed multiple users with correct/wrong/missing votes, verify the leaderboard ranking is correct. Verify that a missing vote resets the streak.
- **Admin Reset**: Use the admin page to reset a user’s key, verify the user can re-register with the same nickname and still see their old votes.
- **Timezone Conversion**: Verify that a match scheduled at 12:00 PM local US time is displayed at the correct ICT time and locks out at the correct ICT kickoff.
- **Final Match**: Vote on the final match with both 1X2 and exact score. Verify both are saved. Verify the exact score field does not appear on non-final matches.

## Out of Scope

- Real-time score updates (live match tracking). The app syncs every 6 hours or on demand.
- Exact score prediction for matches other than the final.
- Bracket/points-based scoring systems (e.g., group stage vs. knockout stage weighting).
- Email/password authentication, OAuth, or social login.
- Public leaderboard or unauthenticated access to any page.
- Automated deployment pipelines or CI/CD.
- Mobile app (iOS/Android). This is a web app only.
- Push notifications or reminders.
- Multi-language support (Vietnamese UI only, but team names can remain in English as they appear in the API).
- Automated tests (unit tests, integration tests). Manual testing is sufficient for this project.
- Rate limiting or DDoS protection (acceptable for 10 friends on a private URL).
- SSL certificate management (handled by Render automatically).

## Further Notes

- The Render free tier server sleeps after 15 minutes of inactivity. The first load after sleep will be slow (~30 seconds) while the server wakes up and re-syncs with the API. This is acceptable for a personal project.
- The funny login key list (`Player-Action` pairs) should be culturally appropriate and inoffensive for a friend group. Avoid political, controversial, or potentially offensive player names or actions. Stick to well-known current players and humorous, light-hearted actions (e.g., `Neymar-Dive`, `Haaland-Eat`, `Kane-MissPen`, `Mbappe-Sprint`, `CR7-Siuuu`).
- The API data for World Cup 2026 is static until the tournament begins, then live scores update. Before the tournament starts, the `home_score` and `away_score` will be 0 and `finished` will be `FALSE` for all matches. The app should still work correctly in this pre-tournament state (all matches votable, leaderboard empty).
- The app should gracefully handle the case where the API adds new matches (e.g., knockout stage matchups after the group stage). The sync logic should upsert matches by `api_id` so new matches are added without overwriting existing ones.
- For the tie-breaker streak calculation, the algorithm should iterate through all matches in chronological order and count the longest run of consecutive correct votes. If a user did not vote on a match, the streak breaks and resets to 0. The streak calculation is O(n) per user and can be done on the fly for the leaderboard page; with 10 users and ~100 matches, this is trivially fast and does not need caching.
- The exact score tie-breaker for the final match should be stored as two separate integer fields (e.g., `final_home_score`, `final_away_score`) or as a single string. The tie-breaker check compares both values against the API’s final match result. If both are correct, the user wins the tie-breaker. If multiple users still tie, the streak is used as the second tie-breaker.
- The admin page hardcoded password should be a simple, memorable string (e.g., `worldcup2026`) set via an environment variable or server config. It does not need to be hashed for a 10-friend project, but it should not be committed to the repo in plain text if possible.
