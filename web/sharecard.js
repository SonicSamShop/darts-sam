// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Shareable post-match scorecard PNG (1200x630), drawn on a <canvas> in the
// active theme's colours. Uses navigator.share({ files }) on mobile where
// supported, and falls back to downloading the PNG on desktop.

import { compute, gameById } from './engine.js';
import { matchSheet } from './sync.js';
import { matchSummary } from './stats.js';

function cssVar(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export async function shareMatchCard(match) {
  if (!match) return;
  const s = compute(match);
  const game = gameById(match.gameId);
  const sheet = matchSheet(match);
  const { rows } = matchSummary(sheet);

  const W = 1200, H = 630;
  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const bg = cssVar('--board', cssVar('--bg', '#1e2623'));
  const panel = cssVar('--raised', cssVar('--panel', '#2a3631'));
  const accent = cssVar('--accent', '#f2d16b');
  const gold = cssVar('--gold', '#f2d16b');
  const text = cssVar('--text', '#efeadb');
  const muted = cssVar('--muted', '#a9ab9f');
  const line = cssVar('--line', '#444');
  const frame = cssVar('--bg', '#111');

  // Outer frame + board surface
  ctx.fillStyle = frame;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = bg;
  ctx.fillRect(18, 18, W - 36, H - 36);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.strokeRect(18, 18, W - 36, H - 36);

  // Header
  ctx.fillStyle = accent;
  ctx.font = '700 30px system-ui, -apple-system, sans-serif';
  ctx.fillText('Darts S.A.M', 56, 78);

  const sub = `${game.name}${match.gameId === 'x01' ? ` ${match.opts?.start ?? 501}` : ''} · ${new Date().toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}`;
  ctx.fillStyle = muted;
  ctx.font = '500 22px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(sub, W - 56, 78);
  ctx.textAlign = 'left';

  // Winner / result headline
  const headline = game.result?.(s) ?? (s.winner != null ? `${s.players[s.winner]} wins!` : game.name);
  ctx.fillStyle = gold;
  ctx.font = '800 54px system-ui, -apple-system, sans-serif';
  ctx.fillText(headline, 56, 154, W - 112);

  // Key stats table (up to 7 most informative rows)
  const keep = ['Sets won', 'Legs won', '3-dart average', 'First 9 average', 'Highest visit', '180s', '140+', '100+', 'Checkout rate', 'Highest checkout', 'Best leg (darts)', 'Darts thrown'];
  const picked = rows.filter(r => keep.includes(r.label)).slice(0, 7);
  const show = picked.length ? picked : rows.slice(0, 7);

  const cardY = 186, cardH = H - cardY - 82;
  ctx.fillStyle = panel;
  ctx.beginPath();
  ctx.roundRect(56, cardY, W - 112, cardH, 14);
  ctx.fill();

  const players = sheet.players.slice(0, 4);
  const colW = players.length > 1 ? Math.min(200, (W - 460) / players.length) : 220;
  const colX = i => W - 88 - (players.length - 1 - i) * colW;

  // Player column headers
  let y = cardY + 42;
  if (players.length > 1) {
    ctx.font = '700 24px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'right';
    players.forEach((p, i) => {
      ctx.fillStyle = i === s.winner ? gold : text;
      ctx.fillText(p, colX(i), y, colW - 14);
    });
    ctx.textAlign = 'left';
    y += 18;
  }

  const rowH = Math.min(46, (cardH - (players.length > 1 ? 76 : 36)) / Math.max(1, show.length));
  show.forEach((r, idx) => {
    const ry = y + idx * rowH + 28;
    if (idx > 0 || players.length > 1) {
      ctx.strokeStyle = line;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(84, ry - 26);
      ctx.lineTo(W - 84, ry - 26);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = muted;
    ctx.font = '500 23px system-ui, -apple-system, sans-serif';
    ctx.fillText(r.label, 84, ry);

    ctx.textAlign = 'right';
    players.forEach((_, i) => {
      ctx.fillStyle = r.best === i ? gold : text;
      ctx.font = `${r.best === i ? '800' : '600'} 25px system-ui, -apple-system, sans-serif`;
      ctx.fillText(String(r.cells[i] ?? '–'), colX(i), ry, colW - 14);
    });
    ctx.textAlign = 'left';
  });

  // Footer
  ctx.fillStyle = muted;
  ctx.font = '500 20px system-ui, -apple-system, sans-serif';
  ctx.fillText('Scored free with Darts S.A.M', 56, H - 36);
  ctx.fillStyle = accent;
  ctx.textAlign = 'right';
  ctx.fillText('dartssam.co.uk', W - 56, H - 36);

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return;
  const filename = `dartssam-${match.gameId}.png`;
  const file = typeof File === 'function' ? new File([blob], filename, { type: 'image/png' }) : null;

  if (file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ title: `Darts S.A.M · ${headline}`, files: [file] });
      return;
    } catch { /* user cancelled or share unavailable: fall back to download */ }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
