# ProjectIverson

A live Lock-In console for Sleeper fantasy basketball. It reads league, roster, matchup, stats and projection data from the public Sleeper API straight from the browser, and turns it into LOCK / ROLL / WAIT calls for every starter.

**Live:** https://alexhackworth.github.io/ProjectIverson/

## What it does
- Works out each starter's lock status from Sleeper scores (in Lock-In, a player's weekly score equals one of his games).
- Scores every game with the league's own scoring settings.
- Uses an optimal-stopping model to decide whether a banked score beats the expected value of rolling into his remaining games, and shows the break-even ("lock ≥") for each upcoming game.
- Themes itself to your favorite NBA team (primary, secondary or tertiary colors) over a drawn overhead court.
- First-run setup, a guided tour, and settings to switch fantasy team or Sleeper league.

## Files
- `index.html` – layout and styles
- `app.js` – data loading, decision model, UI
- `teams.js` – NBA team color palettes

Not affiliated with the NBA or Sleeper. No logos or court artwork are reproduced; courts are drawn generically in team colors.
