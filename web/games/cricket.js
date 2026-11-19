const TARGETS = [20, 19, 18, 17, 16, 15, 25];
const MARK = ['', '/', 'X', '⦻'];

export default {
  id: 'cricket',
  name: 'Cricket',
  blurb: 'Close 15–20 and bull with three marks each; score on what others have open.',
  showTotal: false,  // the three-dart sum means nothing in this game
  options: [],

  init(n) {
    return {
      marks: Array.from({ length: n }, () => Object.fromEntries(TARGETS.map(t => [t, 0]))),
      points: Array(n).fill(0),
    };
  },

  dart(s, d) {
    const p = s.current;
    const hits = TARGETS.includes(d.seg) ? d.mult : 0;
    for (let i = 0; i < hits; i++) {
      if (s.marks[p][d.seg] < 3) s.marks[p][d.seg]++;
      else if (s.marks.some((m, o) => o !== p && m[d.seg] < 3)) s.points[p] += d.seg;
    }
    const closed = TARGETS.every(t => s.marks[p][t] === 3);
    if (closed && s.points.every(pts => pts <= s.points[p])) s.winner = p;
  },

  summary(s, i) {
    const closed = TARGETS.filter(t => s.marks[i][t] === 3).length;
    return { big: s.points[i], small: `${closed}/7 closed` };
  },

  panel(s) {
    const head = s.players.map((p, i) =>
      `<th class="${i === s.current ? 'cur' : ''}">${p.replace(/</g, '&lt;')}</th>`).join('');
    const rows = TARGETS.map(t => {
      const dead = s.marks.every(m => m[t] === 3);
      return `<tr class="${dead ? 'dead' : ''}"><td>${t === 25 ? 'Bull' : t}</td>` +
        s.marks.map(m => `<td class="mark">${MARK[m[t]]}</td>`).join('') + '</tr>';
    }).join('');
    return `<table class="cricket"><tr><th></th>${head}</tr>${rows}</table>`;
  },
};
