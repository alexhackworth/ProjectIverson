# ProjectIverson

A live Lock-In console for Sleeper fantasy basketball. It reads league, roster, matchup, stats, projection and news data from the public Sleeper API straight from the browser.

**Live:** https://alexhackworth.github.io/ProjectIverson/

## Tabs
- **Lock Console** – LOCK / ROLL / WAIT calls for every starter, a day-by-day game plan, and the lock grid.
- **Performance** – Lock IQ (share of the possible lock gain captured), how often decisions matched CourtVision, CourtVision wins, biggest misses, league leaderboard, the model report card and on-device usage.
- **Team** – record, weekly points vs opponent and league, schedule volume, top contributors, standings, next-week outlook.
- **Players** – roster form table (trend, consistency, minutes, ownership) and per-player game log, news and lock history.
- **Trade Lab (beta)** – buy-low, sell-high and waiver-riser signals from form, minutes, shooting luck, starting role, ownership trends, news and team depth charts.

## Lock model (v3)
Optimal stopping: for a starter's remaining games, work backward from the last game to find what rolling is worth on average, then lock if the banked score beats it. Each game is modeled as a normal spread of 25% around the projection with a 10% chance he sits (a sat final game scores 0 in Lock-In).

Backtested on the league's full 2025 season (`tools/backtest.py`, `tools/backtest_scratch.py`; train weeks 1-12, test weeks 13-25): v3 kept 76% of the possible lock gain on held-out weeks, vs 72% for v2, 63% for the old sheet rule and 45% for the league's real managers. Re-run the scripts each season to recalibrate `model.js`.

v4 (`tools/backtest_slots.py`) makes the call per lineup slot instead of per player: open slots draw on any eligible bench player or free agent whose game hasn't tipped. On held-out 2025 weeks it averaged 278 points per team-week vs 261 for v3 and 232 for real managers (+17.2/week over v3, 95% CI +12.3 to +22.4); allowing two free-agent adds raised it to 284. Caveats: nightly decisions only, end-of-week rosters, free-agent pool not shared across teams.

## Files
- `index.html` – layout and styles
- `app.js` – data loading, decision model, Lock Console, setup, settings, tour
- `console.js` – v4 slot engine: per-slot lock/sub/roll calls drawing on bench and free agents, live hold/swap (ESPN scoreboard for tip times, clock and margin)
- `impact.js` – Player impact (beta) on the Performance tab: a player's games played vs a fantasy team's weekly score this season, and last season's correlation with and without his own points
- `tabs.js` – Performance, Team, Players, Trade Lab
- `charts.js` – small SVG chart kit
- `model.js` – model parameters and backtest results
- `teams.js` – NBA team color palettes
- `tools/` – backtest scripts (download data with curl first if Python can't verify HTTPS)

Not affiliated with the NBA or Sleeper. No logos or court artwork are reproduced; courts are drawn generically in team colors.
