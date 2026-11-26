// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// The Career Mode screen: per-player Pro Tour progression across 5 tiers,
// league fixtures, knockout cups, Order of Merit rankings, and trophy cabinet.

import { compute, newMatch } from '../engine.js';
import {
  PROS, TIERS, canPromote, cupRoundName, newCareer, nextCareerMatch, orderOfMerit,
  proById, recommendedTier, recordCareerResult, seasonComplete, startNextSeason, tierByIndex
} from '../career.js';
import { accentFor, banterClipUrl, careerIntensity, pickBanter, tierAtmosphere } from '../banter.js';
import { starterCall } from '../voice.js';
import { renderLanding } from './landing.js';
import { renderGame } from './game.js';
import { switchRow } from './settings.js';
import {
  $app, account, atmosphereOn, botPlayer, careerOpt, dartsFor, data, esc, flagHtml, flagOf, mark, match, nameOf,
  pageFoot, pageHead, players, refreshStatus, saveSettings, say, sayBanter, screen, setMatch, setScreen,
  settings, sfx, sfxOn, store
} from '../app.js';

export const careerView = {
  player: null,
  tab: 'tour',      // 'tour' | 'rankings' | 'trophies' | 'settings'
  pickTier: 0,      // starting tier chosen on the setup screen
  resetArmed: false,
};

let recordedMatchId = null;
let undoSnapshot = null;  // { matchId, playerId, prev }

export function careerOf(playerId) {
  return playerId != null ? settings.careers?.[playerId] ?? null : null;
}

function saveCareer(playerId, career) {
  const next = { ...(settings.careers ?? {}) };
  if (career) next[playerId] = career; else delete next[playerId];
  settings.careers = next;
  saveSettings();
}

export function careerRemapped(remapped) {
  if (!remapped.length || !settings.careers) return;
  let changed = false;
  const next = { ...settings.careers };
  for (const [old, id] of remapped) {
    if (careerView.player === old) careerView.player = id;
    if (next[old]) {
      next[id] = { ...next[old], playerId: id };
      delete next[old];
      changed = true;
    }
  }
  if (changed) { settings.careers = next; saveSettings(); }
}

export function openCareer(playerId = careerView.player) {
  careerView.resetArmed = false;
  if (playerId != null && players.some(p => p.id === playerId)) careerView.player = playerId;
  else if (!players.some(p => p.id === careerView.player)) careerView.player = players[0]?.id ?? null;
  renderCareer();
}

export function onCareerWon(m) {
  const info = m?.opts?.career;
  if (!info || recordedMatchId === m.id) return;
  const cur = careerOf(info.playerId);
  if (!cur) return;
  const s = compute(m);
  if (s.winner == null) return;
  const won = s.winner === 0;
  const legs = (m.opts.sets ?? 1) > 1 ? [s.sets[0], s.sets[1]] : [s.legs[0], s.legs[1]];
  const avg = s.thrown[0] ? s.points[0] / s.thrown[0] * 3 : 0;
  undoSnapshot = { matchId: m.id, playerId: info.playerId, prev: structuredClone(cur) };
  recordedMatchId = m.id;
  saveCareer(info.playerId, recordCareerResult(cur, { won, legs, avg }));
}

export function onCareerUndone(m) {
  const info = m?.opts?.career;
  if (!info || !undoSnapshot || undoSnapshot.matchId !== m.id) return;
  saveCareer(undoSnapshot.playerId, undoSnapshot.prev);
  recordedMatchId = null;
  undoSnapshot = null;
}

function playCareerMatch() {
  const pid = careerView.player;
  const cur = careerOf(pid);
  const up = nextCareerMatch(cur);
  if (!up || pid == null) return;
  const botId = botPlayer(up.pro.level);
  const proDisplay = `${up.pro.name} "${up.pro.nick}"`;
  const isFinal = up.kind === 'cup' && cur.cup && up.slotIdx === cur.cup.slots.length - 1;
  const opts = {
    ...up.opts,
    career: {
      playerId: pid,
      tier: cur.tier,
      isFinal: !!isFinal,
      kind: up.kind,
      label: up.label,
      proId: up.pro.id,
      proName: up.pro.name,
      proNick: up.pro.nick,
      proCountry: up.pro.country,
      proFlag: up.pro.flag,
      proLevel: up.pro.level,
      fixtureIdx: up.fixtureIdx ?? null,
      slotIdx: up.slotIdx ?? null,
    },
  };
  recordedMatchId = null;
  undoSnapshot = null;
  setMatch({
    ...newMatch('x01', [nameOf(pid), proDisplay], opts),
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    playerIds: [pid, botId],
    darts: [dartsFor(pid), null],
    board: data.wallBoard(),
    bots: [null, up.pro.level],
    seq: 0,
  });
  store.set('match', match);
  say(starterCall(match.players, 0));
  renderGame();
  mark(true);
}

export function careerAct(act, d) {
  const pid = careerView.player;
  switch (act) {
    case 'career-tab':
      careerView.tab = d.ctab || 'tour';
      careerView.resetArmed = false;
      return renderCareer();
    case 'career-picktier':
      careerView.pickTier = +d.tier || 0;
      return renderCareer();
    case 'career-start':
      if (pid == null) return;
      saveCareer(pid, newCareer(pid, { startTier: careerView.pickTier }));
      careerView.tab = 'tour';
      return renderCareer();
    case 'career-play':
      return playCareerMatch();
    case 'career-promote': {
      const cur = careerOf(pid);
      if (!cur) return;
      const targetTier = d.tier != null ? +d.tier : Math.min(TIERS.length - 1, cur.tier + 1);
      saveCareer(pid, startNextSeason(cur, { tierIndex: targetTier }));
      return renderCareer();
    }
    case 'career-nextseason': {
      const cur = careerOf(pid);
      if (!cur) return;
      saveCareer(pid, startNextSeason(cur, { tierIndex: cur.tier }));
      return renderCareer();
    }
    case 'career-opt': {
      const key = d.key;
      if (!key) return;
      const next = !(settings.careerOpts?.[key] !== false);
      if (next && !atmosphereOn()) settings.atmosphere = true;
      settings.careerOpts = { ...(settings.careerOpts ?? {}), [key]: next };
      saveSettings();
      if (next && sfxOn()) {
        if (key === 'coughing') sfx.cough(2);
        else if (key === 'crowdCheers') sfx.cheer('small', 2);
        else if (key === 'banterVoice') sayBanter("Pint's on the loser then, mate?", {
          intensity: 0, proId: 'p01', clipUrl: banterClipUrl('uk_north', 'intro', 0, 0),
        });
      }
      if (!next && key === 'pubNoise') sfx.ambienceStop();
      return renderCareer();
    }
    case 'career-preview': {
      const accent = d.accent || 'uk_north';
      const url = banterClipUrl(accent, 'intro', 0, 0);
      sayBanter("Pint's on the loser then, mate?", { intensity: 0, proId: accent, clipUrl: url });
      return;
    }
    case 'career-reset':
      if (!careerView.resetArmed) { careerView.resetArmed = true; return renderCareer(); }
      careerView.resetArmed = false;
      saveCareer(pid, null);
      careerView.pickTier = 0;
      careerView.tab = 'tour';
      return renderCareer();
  }
}

function formatOpts(opts) {
  if ((opts.sets ?? 1) > 1) return `${opts.start} · First to ${opts.sets} sets (${opts.legs} legs)`;
  return `${opts.start} · Best of ${opts.legs * 2 - 1} legs`;
}

function setupHtml(pid) {
  const name = esc(nameOf(pid));
  const rec = recommendedTier(0);
  return `<div class="career-setup">
    <h2>Start ${name}'s Pro Career</h2>
    <p class="muted">Climb 5 tiers from the Pub League to the World Championship against 30 named AI pros. Earn Order of Merit points and trophies in league fixtures and knockout cups.</p>
    <h3>Choose your starting tier</h3>
    <div class="tier-list">${TIERS.map(t => {
      const atm = tierAtmosphere(t.index);
      return `<button class="tier-card ${careerView.pickTier === t.index ? 'on' : ''}" data-act="career-picktier" data-tier="${t.index}">
      <div class="tier-head"><span><b>${t.icon} ${esc(t.name)}</b>${t.index === rec ? ' <small class="badge">Suggested</small>' : ''}</span>
        <span class="muted small">Levels ${t.levels[0]}–${t.levels[1]}</span></div>
      <div class="muted small">${esc(t.blurb)}</div>
      <div class="career-atm small"><span>${atm.heat} ${esc(atm.vibe)}</span> · <span class="muted">${esc(atm.venue)}</span></div>
    </button>`;
    }).join('')}</div>
    <div class="row"><button class="primary" data-act="career-start">Start Career</button></div>
  </div>`;
}

function cupBracketHtml(cup, playerName, playerFlag) {
  const labelOf = id => {
    if (!id) return '<span class="muted">TBD</span>';
    if (id === 'YOU') return `<b>${playerFlag ? `<span class="flag">${playerFlag}</span>` : ''}${esc(playerName)}</b>`;
    const p = proById(id);
    return `<span class="flag">${p.flag}</span>${esc(p.name)} <small class="muted">L${p.level}</small>`;
  };
  const cols = [];
  for (let r = 0; r < cup.rounds; r++) {
    const slots = cup.slots.filter(s => s.round === r);
    cols.push(`<div class="cup-col"><h4>${esc(cupRoundName(cup, r))}</h4>${slots.map(s => {
      const aWin = s.winner && s.winner === s.a, bWin = s.winner && s.winner === s.b;
      return `<div class="cup-slot ${s.a === 'YOU' || s.b === 'YOU' ? 'mine' : ''}">
        <div class="${aWin ? 'win' : ''}"><span>${labelOf(s.a)}</span><b>${s.score ? s.score[0] : ''}</b></div>
        <div class="${bWin ? 'win' : ''}"><span>${labelOf(s.b)}</span><b>${s.score ? s.score[1] : ''}</b></div>
      </div>`;
    }).join('')}</div>`);
  }
  return `<div class="cup-grid">${cols.join('')}</div>`;
}

function tourPane(career, playerName, playerFlag) {
  const tier = tierByIndex(career.tier);
  const up = nextCareerMatch(career);
  const done = seasonComplete(career);
  const promote = canPromote(career);
  const nextTier = career.tier < TIERS.length - 1 ? TIERS[career.tier + 1] : null;
  const pct = tier.promotePts ? Math.min(100, Math.round((career.points / tier.promotePts) * 100)) : 100;

  let actionCard = '';
  if (up) {
    const isFinal = up.kind === 'cup' && career.cup && up.slotIdx === career.cup.slots.length - 1;
    const lvl = careerIntensity({ tier: career.tier, proLevel: up.pro.level, isFinal });
    const atm = tierAtmosphere(lvl);
    const seed = (up.pro.level * 17 + career.season * 7 + (up.fixtureIdx ?? up.slotIdx ?? 0) * 3) % 100 / 100;
    const taunt = pickBanter('intro', lvl, { random: () => seed });
    actionCard = `<div class="career-next">
      <div class="career-next-top">
        <span class="muted small">${esc(up.label)} · ${esc(formatOpts(up.opts))}</span>
        <span class="career-atm small">${atm.heat} ${esc(atm.vibe)} · ${esc(atm.venue)}</span>
      </div>
      <div class="career-vs">
        <span class="flag">${up.pro.flag}</span>
        <div><b>${esc(up.pro.name)} "${esc(up.pro.nick)}"</b>
          <div class="muted small">Level ${up.pro.level} · ~${up.pro.average} avg</div></div>
      </div>
      <div class="career-taunt">“${esc(taunt)}”</div>
      <button class="primary start" data-act="career-play">Play match</button>
    </div>`;
  } else if (done) {
    const wonCup = career.cup?.winner === 'YOU';
    const cupWinner = wonCup ? playerName : proById(career.cup.winner).name;
    actionCard = `<div class="career-next ${wonCup ? 'won' : ''}">
      <div class="career-banner">${wonCup ? `${tier.icon} Champion! You won the ${esc(tier.cupName)}!` : `${esc(tier.cupName)} complete — won by ${esc(cupWinner)}`}</div>
      <p class="muted small">${promote && nextTier ? `You have qualified for the ${esc(nextTier.name)}!` : 'Ready for the next season.'}</p>
      <div class="row">
        ${promote && nextTier ? `<button class="primary" data-act="career-promote" data-tier="${nextTier.index}">Promote to ${esc(nextTier.name)} ›</button>` : ''}
        <button class="${promote && nextTier ? '' : 'primary'}" data-act="career-nextseason">Start Season ${career.season + 1} (${esc(tier.name)})</button>
      </div>
    </div>`;
  }

  const schedule = career.stage === 'cup' && career.cup
    ? `<h3>${tier.icon} ${esc(career.cup.name)}</h3>${cupBracketHtml(career.cup, playerName, playerFlag)}`
    : `<h3>${esc(tier.name)} Fixtures</h3><div class="fixture-list">${career.fixtures.map((f, i) => {
      const p = proById(f.proId);
      const cls = f.played ? (f.won ? 'won' : 'lost') : (up?.fixtureIdx === i ? 'next' : '');
      const status = f.played ? `<b>${f.won ? 'W' : 'L'} ${f.score[0]}–${f.score[1]}</b>` : (up?.fixtureIdx === i ? '<span class="muted">Up next</span>' : '<span class="muted">Pending</span>');
      return `<div class="fixture ${cls}"><span><span class="flag">${p.flag}</span><b>${esc(p.name)}</b> <small class="muted">"${esc(p.nick)}" · L${p.level}</small></span><span>${status}</span></div>`;
    }).join('')}</div>`;

  return `${tier.promotePts ? `<div class="career-prog">
      <div class="row"><span>Promotion to ${esc(nextTier.name)}</span><b>${career.points} / ${tier.promotePts} pts</b></div>
      <div class="h2h-bar"><i style="width:${pct}%"></i></div>
    </div>` : ''}
    ${actionCard}
    ${schedule}`;
}

function rankingsPane(career, playerName, playerFlag) {
  const rows = orderOfMerit(career, playerName, playerFlag);
  return `<h3>Order of Merit</h3>
    <table class="plain career-rank"><tr><th>#</th><th>Player</th><th>Level</th><th class="num">Points</th></tr>
    ${rows.map(r => `<tr class="${r.isYou ? 'at' : ''}">
      <td><b>${r.rank}</b></td>
      <td>${r.flag ? `<span class="flag">${r.flag}</span>` : ''}<b>${esc(r.name)}</b> <small class="muted">${r.isYou ? esc(r.nick) : `"${esc(r.nick)}"`}</small></td>
      <td>${r.level ? `L${r.level}` : 'You'}</td>
      <td class="num"><b>${r.points}</b></td>
    </tr>`).join('')}</table>`;
}

function trophiesPane(career) {
  const earnedByTier = new Map();
  for (const t of career.trophies) earnedByTier.set(t.tier, (earnedByTier.get(t.tier) ?? 0) + 1);
  const cabinet = `<div class="trophy-grid">${TIERS.map(t => {
    const count = earnedByTier.get(t.index) ?? 0;
    return `<div class="trophy-card ${count ? 'won' : 'locked'}">
      <div class="trophy-icon">${t.icon}</div>
      <b>${esc(t.cupName)}</b>
      <small class="muted">${count ? `Won ×${count}` : 'Locked'}</small>
    </div>`;
  }).join('')}</div>`;
  const hist = career.history.length
    ? `<h3>Recent career matches</h3><table class="plain"><tr><th>Event</th><th>Opponent</th><th>Score</th><th class="num">Avg</th><th class="num">Pts</th></tr>
      ${career.history.slice(0, 20).map(h => `<tr>
        <td>${esc(h.event)}</td>
        <td><span class="flag">${h.oppFlag}</span>${esc(h.opponent)}</td>
        <td><b class="${h.won ? '' : 'warn'}">${h.won ? 'W' : 'L'} ${esc(h.score)}</b></td>
        <td class="num">${h.avg ? h.avg.toFixed(1) : '–'}</td>
        <td class="num">+${h.ptsEarned}</td>
      </tr>`).join('')}</table>`
    : '<p class="muted">No career matches played yet.</p>';
  return `<h3>Trophy Cabinet</h3>${cabinet}${hist}`;
}

function settingsPane() {
  const pubNoise = careerOpt('pubNoise');
  const crowdCheers = careerOpt('crowdCheers');
  const banter = careerOpt('banter');
  const banterVoice = careerOpt('banterVoice');
  const coughing = careerOpt('coughing');
  return `<h3>Career Atmosphere &amp; Audio</h3>
    <div class="settings"><div class="rows">
      ${switchRow('Pub & crowd background noise', pubNoise, 'data-act="career-opt" data-key="pubNoise"', 'Background pub murmur, clinking pint glasses, and arena hum that builds with each tier.')}
      ${switchRow('Crowd cheering & groans', crowdCheers, 'data-act="career-opt" data-key="crowdCheers"', 'Cheers on trebles, bulls, tons and checkouts; groans on busts and misses.')}
      ${switchRow('Opponent back-chat', banter, 'data-act="career-opt" data-key="banter"', 'Fiercer darts slang and sledging as you climb from the Pub League to the World stage.')}
      ${banter ? switchRow('Speak banter aloud', banterVoice, 'data-act="career-opt" data-key="banterVoice"', 'Opponents deliver their back-chat aloud in regional accents between score calls.') : ''}
      ${switchRow('Mid-throw coughing', coughing, 'data-act="career-opt" data-key="coughing"', 'Opponents may cough during your visit to try to put you off, especially on a finish.')}
    </div></div>
    ${banter && banterVoice ? `<div class="row" style="flex-wrap:wrap;gap:6px">
      <span class="muted small" style="width:100%">Preview accent voices:</span>
      <button class="ghost" data-act="career-preview" data-accent="uk_north">🏴󠁧󠁢󠁥󠁮󠁧󠁿 Northern UK</button>
      <button class="ghost" data-act="career-preview" data-accent="scot">🏴󠁧󠁢󠁳󠁣󠁴󠁿 Scottish</button>
      <button class="ghost" data-act="career-preview" data-accent="uk_south">🇬🇧 British</button>
      <button class="ghost" data-act="career-preview" data-accent="euro">🇪🇺 European</button>
      <button class="ghost" data-act="career-preview" data-accent="es">🇪🇸 Spanish</button>
      <button class="ghost" data-act="career-preview" data-accent="us">🇺🇸 American</button>
      <button class="ghost" data-act="career-preview" data-accent="asia">🇯🇵 Asian</button>
    </div>` : ''}
    ${!sfxOn() ? '<p class="muted small">Sound effects are currently muted — unmute them in game or in Settings to hear career audio.</p>' : ''}
    <div class="who-end"><button class="ghost danger" data-act="career-reset">${careerView.resetArmed ? 'Tap again to reset career' : 'Reset career'}</button></div>`;
}

export function renderCareer() {
  if (account.locked) return renderLanding();
  setScreen('career');
  if (!players.length) {
    $app.innerHTML = `<div class="page">${pageHead('home')}
      <div class="fill noplayers"><p class="muted">Add a player first to start a Career.</p>
        <button data-act="manageplayers">Add a player</button></div>${pageFoot('home')}</div>`;
    return refreshStatus();
  }
  if (!players.some(p => p.id === careerView.player)) careerView.player = players[0].id;
  const pid = careerView.player;
  const career = careerOf(pid);
  const pName = nameOf(pid), pFlag = flagOf(pid);

  const playerPick = players.length > 1
    ? `<div class="picks"><label class="pick"><span>Player</span><select data-choose="career-player">${players.map(p =>
      `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label></div>` : '';

  let body = '';
  if (!career) {
    body = setupHtml(pid);
  } else {
    const tier = tierByIndex(career.tier);
    const rank = orderOfMerit(career, pName, pFlag).find(r => r.isYou)?.rank ?? 31;
    const summary = `<div class="tiles career-tiles">
      <div class="tile"><b>${tier.icon} ${esc(tier.name)}</b><span>Season ${career.season}</span></div>
      <div class="tile"><b>#${rank}</b><span>Order of Merit</span></div>
      <div class="tile"><b>${career.points}</b><span>Ranking points</span></div>
      <div class="tile"><b>${career.stats.won}–${career.stats.lost}</b><span>Record (${career.trophies.length} 🏆)</span></div>
    </div>`;
    const tabs = `<div class="row tabs">
      <button class="${careerView.tab === 'tour' ? 'on' : ''}" data-act="career-tab" data-ctab="tour">Tour</button>
      <button class="${careerView.tab === 'rankings' ? 'on' : ''}" data-act="career-tab" data-ctab="rankings">Rankings</button>
      <button class="${careerView.tab === 'trophies' ? 'on' : ''}" data-act="career-tab" data-ctab="trophies">Trophies</button>
      <button class="${careerView.tab === 'settings' ? 'on' : ''}" data-act="career-tab" data-ctab="settings">Settings</button>
    </div>`;
    const pane = careerView.tab === 'rankings' ? rankingsPane(career, pName, pFlag)
      : careerView.tab === 'trophies' ? trophiesPane(career)
      : careerView.tab === 'settings' ? settingsPane()
      : tourPane(career, pName, pFlag);
    body = `${summary}${tabs}<div class="career-pane">${pane}</div>`;
  }

  $app.innerHTML = `<div class="page">
    ${pageHead('home')}
    <div class="row under"><button class="ghost" data-act="home">‹ Menu</button><h1 class="sub">Career Mode</h1></div>
    ${playerPick}
    <div class="fill career-wrap">${body}</div>
    ${pageFoot('home')}
  </div>`;
  refreshStatus();
}
