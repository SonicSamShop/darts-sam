// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Career Mode: a 5-tier Pro Tour progression ladder against 30 named AI pros
// (bot levels 1-15), with league fixtures, knockout cups, Order of Merit
// rankings, and a trophy cabinet. Pure functions: zero DOM, easy to test.

import { botLevel, levelFor } from './bot.js';

export const TIERS = [
  {
    id: 'pub', index: 0, name: 'Pub League', icon: '🍺', cupName: 'Pub League Cup',
    levels: [1, 4], startPts: 0, promotePts: 25,
    leagueCount: 3, cupSize: 4,
    matchOpts: { start: 501, legs: 2, sets: 1, out: 'double' },
    finalOpts: { start: 501, legs: 3, sets: 1, out: 'double' },
    pts: { leagueWin: 8, leagueLoss: 2, cupRound: 6, cupWin: 20 },
    blurb: 'Local pub nights against friendly regulars (avg 18–38).',
  },
  {
    id: 'county', index: 1, name: 'County Circuit', icon: '🏅', cupName: 'County Open Shield',
    levels: [4, 7], startPts: 30, promotePts: 95,
    leagueCount: 4, cupSize: 8,
    matchOpts: { start: 501, legs: 3, sets: 1, out: 'double' },
    finalOpts: { start: 501, legs: 4, sets: 1, out: 'double' },
    pts: { leagueWin: 14, leagueLoss: 3, cupRound: 10, cupWin: 35 },
    blurb: 'County-level competition with sharper scoring (avg 38–57).',
  },
  {
    id: 'challenge', index: 2, name: 'Challenge Tour', icon: '🏆', cupName: 'Challenge Masters',
    levels: [7, 10], startPts: 100, promotePts: 210,
    leagueCount: 4, cupSize: 8,
    matchOpts: { start: 501, legs: 3, sets: 1, out: 'double' },
    finalOpts: { start: 501, legs: 5, sets: 1, out: 'double' },
    pts: { leagueWin: 22, leagueLoss: 5, cupRound: 16, cupWin: 55 },
    blurb: 'Semi-pro circuit chasing a Tour Card (avg 57–77).',
  },
  {
    id: 'pro', index: 3, name: 'Pro Tour', icon: '🥇', cupName: 'Pro Tour Classic',
    levels: [10, 13], startPts: 220, promotePts: 380,
    leagueCount: 4, cupSize: 8,
    matchOpts: { start: 501, legs: 4, sets: 1, out: 'double' },
    finalOpts: { start: 501, legs: 5, sets: 1, out: 'double' },
    pts: { leagueWin: 32, leagueLoss: 6, cupRound: 24, cupWin: 80 },
    blurb: 'Ranked televised floor events against top pros (avg 77–97).',
  },
  {
    id: 'world', index: 4, name: 'World Championship', icon: '👑', cupName: 'World Championship',
    levels: [12, 15], startPts: 400, promotePts: null,
    leagueCount: 3, cupSize: 8,
    matchOpts: { start: 501, legs: 3, sets: 2, out: 'double' },
    finalOpts: { start: 501, legs: 3, sets: 3, out: 'double' },
    pts: { leagueWin: 45, leagueLoss: 10, cupRound: 35, cupWin: 120 },
    blurb: 'The biggest stage in darts, played in sets (avg 90–110).',
  },
];

// 30 fictional AI pros (2 per bot level 1..15) with country flags and base Order of Merit points.
export const PROS = [
  ['p01', 'Davey', 'The Pint', 'GB-ENG', '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 1, 4],
  ['p02', 'Terry', 'Lucky Bounce', 'GB-WLS', '🏴󠁧󠁢󠁷󠁬󠁳󠁿', 1, 7],
  ['p03', 'Gavin', 'The Wire', 'GB-SCT', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', 2, 11],
  ['p04', 'Kev', 'Double One', 'IE', '🇮🇪', 2, 15],
  ['p05', 'Bas', 'The Tulip', 'NL', '🇳🇱', 3, 20],
  ['p06', 'Toby', 'Chalkie', 'GB-ENG', '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 3, 26],
  ['p07', 'Dieter', 'Der Pfeil', 'DE', '🇩🇪', 4, 34],
  ['p08', 'Sean', 'The Shamrock', 'IE', '🇮🇪', 4, 42],
  ['p09', 'Craig', 'Outback', 'AU', '🇦🇺', 5, 52],
  ['p10', 'Wim', 'The Windmill', 'NL', '🇳🇱', 5, 62],
  ['p11', 'Connor', 'Maple Leaf', 'CA', '🇨🇦', 6, 74],
  ['p12', 'Marek', 'The Eagle', 'PL', '🇵🇱', 6, 86],
  ['p13', 'Callum', 'Highland', 'GB-SCT', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', 7, 102],
  ['p14', 'Bram', 'De Molen', 'BE', '🇧🇪', 7, 116],
  ['p15', 'Stefan', 'Alpine', 'AT', '🇦🇹', 8, 132],
  ['p16', 'Ricky', 'The Bull', 'US', '🇺🇸', 8, 148],
  ['p17', 'Maren', 'Iron Sight', 'SE', '🇸🇪', 9, 166],
  ['p18', 'Rhys', 'Red Dragon', 'GB-WLS', '🏴󠁧󠁢󠁷󠁬󠁳󠁿', 9, 184],
  ['p19', 'Koji', 'Laser', 'JP', '🇯🇵', 10, 205],
  ['p20', 'Lukas', 'Der Hammer', 'DE', '🇩🇪', 10, 228],
  ['p21', 'Liam', 'The Belfast Kid', 'GB-NIR', '🇬🇧', 11, 255],
  ['p22', 'Jeroen', 'Orange Flash', 'NL', '🇳🇱', 11, 282],
  ['p23', 'Mateo', 'El Toro', 'ES', '🇪🇸', 12, 315],
  ['p24', 'Rory', 'The Viper', 'GB-SCT', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', 12, 348],
  ['p25', 'Paolo', 'Maestro', 'PH', '🇵🇭', 13, 385],
  ['p26', 'Jack', 'The Governor', 'GB-ENG', '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 13, 425],
  ['p27', 'Sander', 'Clockwork', 'NL', '🇳🇱', 14, 470],
  ['p28', 'Owen', 'The Hurricane', 'GB-WLS', '🏴󠁧󠁢󠁷󠁬󠁳󠁿', 14, 520],
  ['p29', 'Viktor', 'Ice Cold', 'DE', '🇩🇪', 15, 580],
  ['p30', 'Arthur', 'The Crown', 'GB-ENG', '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 15, 650],
].map(([id, name, nick, country, flag, level, basePts]) => ({
  id, name, nick, country, flag, level, basePts, average: botLevel(level).average,
}));

export const proById = id => PROS.find(p => p.id === id) ?? PROS[0];
export const tierByIndex = i => TIERS[Math.min(TIERS.length - 1, Math.max(0, i | 0))];

// Suggest a starting tier index (0..4) from a player's X01 3-dart average.
export function recommendedTier(avg) {
  if (!avg || avg <= 0) return 0;
  const lvl = levelFor(avg).level;
  if (lvl <= 3) return 0;
  if (lvl <= 6) return 1;
  if (lvl <= 9) return 2;
  if (lvl <= 12) return 3;
  return 4;
}

// Deterministic-friendly shuffle using supplied random().
function shuffle(list, random = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Pick `count` pros suited to tier `t` (ordered from lower to higher level for a nice ramp).
function pickPros(tier, count, random = Math.random) {
  const [lo, hi] = tier.levels;
  const pool = PROS.filter(p => p.level >= lo && p.level <= hi);
  const picked = shuffle(pool, random).slice(0, count);
  while (picked.length < count) {
    const extra = PROS.find(p => !picked.includes(p) && Math.abs(p.level - lo) <= 2);
    if (!extra) break;
    picked.push(extra);
  }
  return picked.sort((a, b) => a.level - b.level);
}

function makeFixtures(tier, random = Math.random) {
  return pickPros(tier, tier.leagueCount, random).map((p, i) => ({
    id: `f${i + 1}`, proId: p.id, played: false, won: null, score: null, avg: null,
  }));
}

// Build a 4- or 8-player knockout cup bracket with the player ('YOU') and `cupSize - 1` pros.
function makeCup(tier, random = Math.random) {
  const size = tier.cupSize;
  const opponents = pickPros(tier, size - 1, random);
  // Seed the player in slot 0 against the lowest-ranked opponent in the draw, top pros on the far side.
  const entries = ['YOU', opponents[0].id, ...shuffle(opponents.slice(1).map(p => p.id), random)];
  const rounds = Math.log2(size);
  const slots = [];
  for (let r = 0; r < rounds; r++) {
    const count = size / (2 ** (r + 1));
    for (let j = 0; j < count; j++) {
      slots.push({
        round: r,
        a: r === 0 ? entries[j * 2] : null,
        b: r === 0 ? entries[j * 2 + 1] : null,
        winner: null,
        score: null,
      });
    }
  }
  return { name: tier.cupName, size, rounds, slots, winner: null, finished: false };
}

export function cupRoundName(cup, r) {
  const left = cup.rounds - 1 - r;
  return ['Final', 'Semi-final', 'Quarter-final'][left] ?? `Round ${r + 1}`;
}

function nextSlotIndex(cup, idx) {
  const r = cup.slots[idx].round;
  if (r >= cup.rounds - 1) return null;
  let rStart = 0;
  for (let k = 0; k < r; k++) rStart += cup.size / (2 ** (k + 1));
  const pos = idx - rStart;
  const nextStart = rStart + cup.size / (2 ** (r + 1));
  return { idx: nextStart + Math.floor(pos / 2), side: pos % 2 ? 'b' : 'a' };
}

// Simulate an AI-vs-AI cup match based on their bot averages.
function simAiMatch(aId, bId, legsTo, random = Math.random) {
  const a = proById(aId), b = proById(bId);
  const diff = (a.average - b.average) / 18;
  const pA = 1 / (1 + Math.exp(-diff));
  let la = 0, lb = 0;
  while (la < legsTo && lb < legsTo) {
    if (random() < pA) la++; else lb++;
  }
  return { winner: la > lb ? aId : bId, score: [la, lb] };
}

// Simulate any ready AI-vs-AI matches in the current cup bracket and award them ranking points.
function simulateAiCupMatches(cup, tier, proPoints, random = Math.random) {
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < cup.slots.length; i++) {
      const s = cup.slots[i];
      if (s.winner || !s.a || !s.b || s.a === 'YOU' || s.b === 'YOU') continue;
      const legsTo = s.round === cup.rounds - 1 ? tier.finalOpts.legs : tier.matchOpts.legs;
      const res = simAiMatch(s.a, s.b, legsTo, random);
      s.winner = res.winner;
      s.score = res.score;
      proPoints[res.winner] = (proPoints[res.winner] ?? 0) + tier.pts.cupRound;
      const nxt = nextSlotIndex(cup, i);
      if (nxt) cup.slots[nxt.idx][nxt.side] = res.winner;
      else {
        cup.winner = res.winner;
        cup.finished = true;
        proPoints[res.winner] = (proPoints[res.winner] ?? 0) + tier.pts.cupWin;
      }
      changed = true;
    }
  }
}

export function newCareer(playerId, { startTier = 0, random = Math.random } = {}) {
  const tier = tierByIndex(startTier);
  const proPoints = Object.fromEntries(PROS.map(p => [p.id, p.basePts]));
  return {
    playerId,
    season: 1,
    tier: tier.index,
    unlockedTier: tier.index,
    points: tier.startPts,
    proPoints,
    trophies: [],
    history: [],
    stage: 'league',
    fixtures: makeFixtures(tier, random),
    cup: null,
    stats: { played: 0, won: 0, lost: 0, bestAvg: 0, cupsWon: 0 },
  };
}

// What match is up next in this career, or null if the season is complete and ready to advance.
export function nextCareerMatch(career) {
  if (!career) return null;
  const tier = tierByIndex(career.tier);
  if (career.stage === 'league') {
    const idx = career.fixtures.findIndex(f => !f.played);
    if (idx < 0) return null;
    const pro = proById(career.fixtures[idx].proId);
    return {
      kind: 'league',
      label: `${tier.name} · Match ${idx + 1} of ${career.fixtures.length}`,
      pro,
      opts: { ...tier.matchOpts },
      fixtureIdx: idx,
    };
  }
  if (career.stage === 'cup' && career.cup && !career.cup.finished) {
    const idx = career.cup.slots.findIndex(s => !s.winner && (s.a === 'YOU' || s.b === 'YOU') && s.a && s.b);
    if (idx < 0) return null;
    const slot = career.cup.slots[idx];
    const pro = proById(slot.a === 'YOU' ? slot.b : slot.a);
    const isFinal = slot.round === career.cup.rounds - 1;
    return {
      kind: 'cup',
      label: `${career.cup.name} · ${cupRoundName(career.cup, slot.round)}`,
      pro,
      opts: { ...(isFinal ? tier.finalOpts : tier.matchOpts) },
      slotIdx: idx,
    };
  }
  return null;
}

// Whether the player can promote to the next tier or start the next season.
export function seasonComplete(career) {
  return !!career && career.stage === 'cup' && !!career.cup?.finished;
}

export function canPromote(career) {
  if (!career || career.tier >= TIERS.length - 1) return false;
  const tier = tierByIndex(career.tier);
  return career.unlockedTier > career.tier || (tier.promotePts != null && career.points >= tier.promotePts);
}

// Start the next season (either in a newly unlocked tier or defending/retrying the current tier).
export function startNextSeason(career, { tierIndex = career.tier, random = Math.random } = {}) {
  const next = structuredClone(career);
  const allowed = Math.min(next.unlockedTier, Math.max(0, tierIndex));
  const tier = tierByIndex(allowed);
  next.season += 1;
  next.tier = tier.index;
  next.stage = 'league';
  next.fixtures = makeFixtures(tier, random);
  next.cup = null;
  return next;
}

// Record the outcome of the current career match. Returns a brand-new career object.
export function recordCareerResult(career, { won, legs = [0, 0], avg = 0, now = Date.now(), random = Math.random }) {
  const next = structuredClone(career);
  const tier = tierByIndex(next.tier);
  const up = nextCareerMatch(next);
  if (!up) return next;

  const avgNum = Number.isFinite(+avg) ? +(+avg).toFixed(1) : 0;
  let ptsEarned = 0;

  if (up.kind === 'league') {
    const f = next.fixtures[up.fixtureIdx];
    f.played = true;
    f.won = !!won;
    f.score = legs;
    f.avg = avgNum;
    ptsEarned = won ? tier.pts.leagueWin : tier.pts.leagueLoss;
    next.points += ptsEarned;
    // Opponent also earns points for their result
    next.proPoints[up.pro.id] = (next.proPoints[up.pro.id] ?? up.pro.basePts) + (won ? tier.pts.leagueLoss : tier.pts.leagueWin);
    // If all league fixtures are done, open the tier's Knockout Cup!
    if (next.fixtures.every(x => x.played)) {
      next.stage = 'cup';
      next.cup = makeCup(tier, random);
      simulateAiCupMatches(next.cup, tier, next.proPoints, random);
    }
  } else if (up.kind === 'cup' && next.cup) {
    const slot = next.cup.slots[up.slotIdx];
    const oppId = slot.a === 'YOU' ? slot.b : slot.a;
    slot.winner = won ? 'YOU' : oppId;
    slot.score = slot.a === 'YOU' ? legs : [legs[1], legs[0]];
    const nxt = nextSlotIndex(next.cup, up.slotIdx);
    if (won) {
      ptsEarned = nxt ? tier.pts.cupRound : tier.pts.cupRound + tier.pts.cupWin;
      next.points += ptsEarned;
      if (nxt) {
        next.cup.slots[nxt.idx][nxt.side] = 'YOU';
      } else {
        // Won the Cup Final!
        next.cup.winner = 'YOU';
        next.cup.finished = true;
        next.stats.cupsWon += 1;
        next.trophies.unshift({
          id: `${tier.id}-s${next.season}`,
          tier: tier.index,
          name: tier.cupName,
          icon: tier.icon,
          season: next.season,
          date: now,
          opponent: `${up.pro.name} "${up.pro.nick}"`,
          score: `${legs[0]}–${legs[1]}`,
        });
        if (next.tier < TIERS.length - 1) {
          next.unlockedTier = Math.max(next.unlockedTier, next.tier + 1);
        }
      }
    } else {
      // Eliminated from the cup: opponent moves on and remaining AI rounds finish
      ptsEarned = tier.pts.leagueLoss;
      next.points += ptsEarned;
      next.proPoints[oppId] = (next.proPoints[oppId] ?? up.pro.basePts) + tier.pts.cupRound;
      if (nxt) next.cup.slots[nxt.idx][nxt.side] = oppId;
      else { next.cup.winner = oppId; next.cup.finished = true; }
      simulateAiCupMatches(next.cup, tier, next.proPoints, random);
    }
  }

  // Check points-based promotion unlock
  if (tier.promotePts != null && next.points >= tier.promotePts && next.tier < TIERS.length - 1) {
    next.unlockedTier = Math.max(next.unlockedTier, next.tier + 1);
  }

  next.stats.played += 1;
  if (won) next.stats.won += 1; else next.stats.lost += 1;
  if (avgNum > next.stats.bestAvg) next.stats.bestAvg = avgNum;

  next.history.unshift({
    date: now,
    season: next.season,
    tier: tier.index,
    event: up.label,
    opponent: up.pro.name,
    oppNick: up.pro.nick,
    oppFlag: up.pro.flag,
    oppLevel: up.pro.level,
    won: !!won,
    score: `${legs[0]}–${legs[1]}`,
    avg: avgNum,
    ptsEarned,
  });
  if (next.history.length > 50) next.history.length = 50;
  return next;
}

// The live Order of Merit ranking table: all 30 AI pros + the player, sorted by points desc.
export function orderOfMerit(career, playerName = 'You', playerFlag = '') {
  const rows = PROS.map(p => ({
    id: p.id,
    name: p.name,
    nick: p.nick,
    flag: p.flag,
    level: p.level,
    points: career?.proPoints?.[p.id] ?? p.basePts,
    isYou: false,
  }));
  rows.push({
    id: 'YOU',
    name: playerName,
    nick: tierByIndex(career?.tier ?? 0).name,
    flag: playerFlag,
    level: null,
    points: career?.points ?? 0,
    isYou: true,
  });
  rows.sort((a, b) => b.points - a.points || (b.isYou ? 1 : 0) - (a.isYou ? 1 : 0));
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}
