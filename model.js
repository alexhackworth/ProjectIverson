// Lock-model parameters and the evidence behind them.
// Fit on the 2025 season of Kash Patel's Legacy (weeks 1-12), tested on weeks 13-25. See tools/backtest*.py.
window.PI_MODEL = {
  version: "v3 · tuned Nov 2026 on 2025 season",
  spread: 0.25,        // game-to-game spread as a share of projection (normal model)
  minSd: 4,            // floor on the spread, in fantasy points
  scratch: 0.10,       // chance he sits any future game (a DNP as his last game scores 0 in Lock-In)
  gtdScratch: 0.30,    // next game when he is listed GTD/DTD/Questionable (heuristic, not backtested)
  launchWeek: 4,       // first week CourtVision was live (2026 season)
  backtest: {
    season: "2025", league: "Kash Patel's Legacy", train: "weeks 1-12", test: "weeks 13-25",
    starterWeeks: 2586,
    checks: [
      { k: "Projections beat averages", v: "Typical miss 5.1 pts with projections vs 8.2 with season average. Blending averages in added nothing.", ok: true },
      { k: "Games are independent", v: "A hot or cold game says nothing about the next one (correlation 0.002 across 2,793 back-to-back pairs).", ok: true },
      { k: "Spread of outcomes", v: "When he plays, results land within about ±35% of projection, with a slight right tail. A 25% normal spread made the best lock calls.", ok: true },
      { k: "Late scratches", v: "Players sat 6–9% of games right after playing one, and a sat final game scores 0. The old model ignored this and rolled too often.", ok: false },
      { k: "2025 projections were revised", v: "Stored projections already knew who sat out (98% of DNPs projected under 1 pt), so the backtest restores the pre-game value for surprise absences.", ok: false }
    ],
    // avg fantasy points kept per starter-week, held-out weeks 13-25 (n = 1,415)
    results: [
      { name: "Perfect hindsight (best game)", pts: 25.87, cap: 1.000, ref: true },
      { name: "CourtVision v3 (this model)", pts: 23.81, cap: 0.762, mine: true },
      { name: "CourtVision v2 (previous)", pts: 23.48, cap: 0.723 },
      { name: "Sheet rule v2.1 (lock at 120% of avg)", pts: 22.67, cap: 0.630 },
      { name: "Real managers in the league", pts: 21.11, cap: 0.449 },
      { name: "Lock the first game", pts: 18.84, cap: 0.186 },
      { name: "Always roll", pts: 17.24, cap: 0.000, ref: true }
    ],
    gain: { mean: 0.333, lo: 0.137, hi: 0.532 },
    // 2025 lock IQ = share of the possible lock gain each manager captured (all weeks)
    managers2025: [
      { team: "Howie's Uncut Gems", iq: 0.607, model: 0.762, left: 1.23 },
      { team: "Pibble Dribble", iq: 0.598, model: 0.770, left: 1.51 },
      { team: "CbiggyWestside", iq: 0.567, model: 0.766, left: 1.59 },
      { team: "KON AIR", iq: 0.553, model: 0.743, left: 1.51 },
      { team: "The Benchwarmers", iq: 0.549, model: 0.807, left: 2.09 },
      { team: "Missouri Mighty Marfans", iq: 0.545, model: 0.795, left: 2.16, mine: true },
      { team: "Vanilla Thunder", iq: 0.517, model: 0.727, left: 1.85 },
      { team: "Sir, This is a Wemby's", iq: 0.501, model: 0.730, left: 1.61 },
      { team: "Rutgers University", iq: 0.499, model: 0.770, left: 2.46 },
      { team: "Sagittal Crest BallKnower", iq: 0.495, model: 0.745, left: 2.14 }
    ]
  }
};
