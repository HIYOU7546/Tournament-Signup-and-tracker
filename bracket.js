// ---------------------------------------------------------------
// Bracket engine (pure logic, no page code). Used by the Brackets page
// and the Manage page. Supports:
//   se = single elimination (optional third-place match)
//   de = double elimination (with grand-final reset)
//   rr = round robin
//
// A tournament is stored as: { type, third, participants: [names], results: { matchId: {a,b,s1,s2} } }
// The match tree is rebuilt from that every time, so changing or clearing a
// score automatically un-advances anything that depended on it.
// ---------------------------------------------------------------
const Bracket = (() => {
  const BYE = "\u0000BYE";
  const isBye = x => x === BYE;
  const pow2 = n => { let s = 2; while (s < n) s *= 2; return s; };
  const log2 = n => Math.round(Math.log2(n));

  function seedOrder(size) {
    let a = [1];
    while (a.length < size) { const m = a.length * 2; a = a.flatMap(s => [s, m + 1 - s]); }
    return a;
  }
  function roundName(r, total) {
    const left = total - r;
    return left === 0 ? "Final" : left === 1 ? "Semifinals" : left === 2 ? "Quarterfinals" : "Round " + r;
  }

  // ---- Build the empty match structure ----
  function build(t) {
    const n = t.participants.length;
    const matches = {}, order = [], sections = [];
    const add = (id, p1, p2) => { matches[id] = { id, p1, p2 }; order.push(id); };
    const seed = i => ({ seed: i }), win = id => ({ win: id }), lose = id => ({ lose: id });

    if (t.type === "rr") {
      const m = n % 2 ? n + 1 : n;
      const iter = Math.max(1, Math.min(3, t.iter || 1));
      const rounds = [];
      let roundNo = 0;
      for (let c = 0; c < iter; c++) {
        let arr = Array.from({ length: m }, (_, x) => x + 1);
        for (let r = 0; r < m - 1; r++) {
          roundNo++;
          const ids = [];
          for (let x = 0; x < m / 2; x++) {
            const id = `R${roundNo}-${x + 1}`;
            const a = arr[x], b = arr[m - 1 - x];
            add(id, seed(c % 2 ? b : a), seed(c % 2 ? a : b)); // sides swap on repeat rounds
            ids.push(id);
          }
          rounds.push({ name: "Round " + roundNo, ids });
          arr = [arr[0], arr[m - 1], ...arr.slice(1, m - 1)];
        }
      }
      sections.push({ title: "Matches", rounds });
      return { kind: "rr", matches, order, sections };
    }

    const de = t.type === "de";
    const size = pow2(Math.max(n, de ? 3 : 2)), k = log2(size), so = seedOrder(size);
    const wb = [];
    for (let r = 1; r <= k; r++) {
      const ids = [], count = size / 2 ** r;
      for (let i = 1; i <= count; i++) {
        const id = `W${r}-${i}`;
        if (r === 1) add(id, seed(so[2 * i - 2]), seed(so[2 * i - 1]));
        else add(id, win(`W${r - 1}-${2 * i - 1}`), win(`W${r - 1}-${2 * i}`));
        ids.push(id);
      }
      wb.push({ name: roundName(r, k), ids });
    }
    sections.push({ title: de ? "Winners bracket" : "Bracket", rounds: wb });

    if (!de) {
      if (t.third && k >= 2) {
        add("T-1", lose(`W${k - 1}-1`), lose(`W${k - 1}-2`));
        sections.push({ title: "Third place", rounds: [{ name: "Third place", ids: ["T-1"] }] });
      }
      return { kind: "se", matches, order, sections, finalId: `W${k}-1` };
    }

    const total = 2 * (k - 1), lb = [];
    for (let j = 1; j <= total; j++) {
      const ids = [];
      const tt = j % 2 === 0 ? j / 2 : (j - 1) / 2;
      const count = j === 1 ? size / 4 : j % 2 === 0 ? size / 2 ** (tt + 1) : size / 2 ** (tt + 2);
      for (let i = 1; i <= count; i++) {
        const id = `L${j}-${i}`;
        if (j === 1) add(id, lose(`W1-${2 * i - 1}`), lose(`W1-${2 * i}`));
        else if (j % 2 === 0) add(id, win(`L${j - 1}-${i}`), lose(`W${tt + 1}-${count + 1 - i}`));
        else add(id, win(`L${j - 1}-${2 * i - 1}`), win(`L${j - 1}-${2 * i}`));
        ids.push(id);
      }
      lb.push({ name: j === total ? "Losers final" : "Losers round " + j, ids });
    }
    sections.push({ title: "Losers bracket", rounds: lb });
    const gf = t.gf === undefined || t.gf === null ? 2 : t.gf; // 2 = with reset, 1 = single game, 0 = none
    if (gf >= 1) {
      add("GF1", win(`W${k}-1`), win(`L${total}-1`));
      const gr = [{ name: "Grand final", ids: ["GF1"] }];
      if (gf >= 2) {
        add("GF2", { reset: true }, { reset: true });
        gr.push({ name: "Reset (only if needed)", ids: ["GF2"] });
      }
      sections.push({ title: "Grand final", rounds: gr });
    }
    return { kind: "de", matches, order, sections, gf, finals: { w: `W${k}-1`, l: `L${total}-1` } };
  }

  // ---- Fill in players and results ----
  function resolve(t) {
    const st = build(t);
    const n = t.participants.length, res = t.results || {};
    const out = {};
    const val = src => {
      if (src.seed !== undefined) return src.seed > n ? BYE : t.participants[src.seed - 1];
      const o = out[src.win || src.lose];
      if (!o) return null;
      return src.win ? o.winnerName : o.loserName;
    };

    for (const id of st.order) {
      const m = st.matches[id];
      const o = { id, p1: null, p2: null, s1: null, s2: null, winner: null, winnerName: null, loserName: null, done: false, bye: false, skipped: false };
      if (m.p1.reset) {
        const g = out["GF1"];
        if (g.done) { if (g.winner === 2) { o.p1 = g.p1; o.p2 = g.p2; } else o.skipped = true; }
      } else { o.p1 = val(m.p1); o.p2 = val(m.p2); }

      if (!o.skipped && o.p1 !== null && o.p2 !== null) {
        if (isBye(o.p1) || isBye(o.p2)) {
          o.bye = true; o.done = true;
          if (isBye(o.p1) && isBye(o.p2)) { o.winnerName = BYE; o.loserName = BYE; }
          else if (isBye(o.p1)) { o.winner = 2; o.winnerName = o.p2; o.loserName = BYE; }
          else { o.winner = 1; o.winnerName = o.p1; o.loserName = BYE; }
        } else {
          const r = res[id];
          if (r && r.a === o.p1 && r.b === o.p2 && typeof r.s1 === "number" && typeof r.s2 === "number" &&
              (st.kind === "rr" || r.s1 !== r.s2)) {
            o.s1 = r.s1; o.s2 = r.s2; o.done = true;
            if (r.s1 > r.s2) { o.winner = 1; o.winnerName = o.p1; o.loserName = o.p2; }
            else if (r.s2 > r.s1) { o.winner = 2; o.winnerName = o.p2; o.loserName = o.p1; }
            else o.winner = 0; // draw (round robin only)
          }
        }
      }
      out[id] = o;
    }

    // standings (round robin)
    let standings = null;
    if (st.kind === "rr") {
      const row = {};
      standings = t.participants.map((name, i) => (row[name] = { name, seed: i + 1, p: 0, w: 0, d: 0, l: 0, pf: 0, pa: 0, pts: 0 }));
      for (const id of st.order) {
        const o = out[id];
        if (!o.done || o.bye) continue;
        const a = row[o.p1], b = row[o.p2];
        a.p++; b.p++; a.pf += o.s1; a.pa += o.s2; b.pf += o.s2; b.pa += o.s1;
        if (o.winner === 1) { a.w++; b.l++; a.pts += 3; }
        else if (o.winner === 2) { b.w++; a.l++; b.pts += 3; }
        else { a.d++; b.d++; a.pts++; b.pts++; }
      }
      standings.sort((x, y) => y.pts - x.pts || (y.pf - y.pa) - (x.pf - x.pa) || y.pf - x.pf || x.seed - y.seed);
    }

    // counts + champion
    let total = 0, doneCount = 0;
    for (const id of st.order) {
      const o = out[id];
      if (o.skipped || o.bye || (id === "GF2" && o.p1 === null)) continue;
      total++; if (o.done) doneCount++;
    }
    let champion = null;
    if (st.kind === "se") { const f = out[st.finalId]; if (f.done) champion = f.winnerName; }
    else if (st.kind === "de") {
      if (st.gf === 0) {
        const w = out[st.finals.w], l = out[st.finals.l];
        if (w.done && l.done) champion = w.winnerName; // no grand final: winners-bracket champion
      } else {
        const g1 = out["GF1"], g2 = out["GF2"];
        if (g1.done) {
          if (g1.winner === 1 || st.gf === 1) champion = g1.winnerName;
          else champion = g2.done ? g2.winnerName : null;
        }
      }
    } else if (total > 0 && doneCount === total) champion = standings[0].name;

    return { structure: st, out, standings, champion, total, doneCount };
  }

  return { BYE, build, resolve };
})();
if (typeof module !== "undefined") module.exports = Bracket;