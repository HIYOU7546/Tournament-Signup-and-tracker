// Draws a tournament (built with bracket.js) into a page element.
// opts (admin only): onSave(matchId, p1, p2, s1, s2) -> Promise, onClear(matchId) -> Promise

const LINE_COLORS = { gold: "#f2b705", white: "#f5f1e6", gray: "#8a8f98", red: "#e5484d", blue: "#4aa3ff", green: "#5fd068" };

// SVG path for one connector. kind: elbow | rounded | curve | diagonal.
// stub=false leaves off the final horizontal run (so two feeders don't draw it twice).
function _linePath(kind, x1, y1, x2, y2, stub = true) {
  const xm = (x1 + x2) / 2, dy = y2 - y1;
  if (kind === "diagonal") return `M${x1},${y1} L${x2},${y2}`;
  if (kind === "curve") return `M${x1},${y1} C${xm},${y1} ${xm},${y2} ${x2},${y2}`;
  if (Math.abs(dy) < 0.5) return stub ? `M${x1},${y1} H${x2}` : `M${x1},${y1} H${xm}`;
  if (kind === "rounded") {
    const r = Math.max(0, Math.min(10, Math.abs(dy) / 2, (x2 - x1) / 2)), s = dy > 0 ? 1 : -1;
    return `M${x1},${y1} H${xm - r} Q${xm},${y1} ${xm},${y1 + s * r} V${y2 - s * r} Q${xm},${y2} ${xm + r},${y2}` + (stub ? ` H${x2}` : "");
  }
  return `M${x1},${y1} H${xm} V${y2}` + (stub ? ` H${x2}` : "");
}

function _lineStyle(t) {
  return {
    kind: t.lineStyle || "elbow",
    pattern: t.linePattern || "solid",
    width: t.lineWidth || 2,
    color: LINE_COLORS[t.lineColor] || LINE_COLORS.gold
  };
}

// Draws the connector lines for one winners/losers/single bracket section.
function _drawLines(row, cardOf, st, s) {
  const old = row.querySelector("svg.bl-lines");
  if (old) old.remove();
  if (s.kind === "none") return;
  const cr = row.getBoundingClientRect();
  if (!cr.width) return; // not visible yet; the ResizeObserver redraws when it is
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "bl-lines");
  svg.setAttribute("width", row.scrollWidth);
  svg.setAttribute("height", row.scrollHeight);
  const pos = el => {
    const r = el.getBoundingClientRect();
    return { l: r.left - cr.left + row.scrollLeft, r: r.right - cr.left + row.scrollLeft, y: (r.top + r.bottom) / 2 - cr.top + row.scrollTop };
  };
  for (const id of st.order) {
    const to = cardOf[id];
    if (!to || to.classList.contains("empty")) continue;
    const tp = pos(to), m = st.matches[id];
    let stub = true;
    [m.p1, m.p2].forEach(src => {
      const from = src && src.win ? cardOf[src.win] : null;
      if (!from || from.classList.contains("empty")) return;
      const fp = pos(from);
      const p = document.createElementNS(ns, "path");
      p.setAttribute("d", _linePath(s.kind, fp.r, fp.y, tp.l, tp.y, stub));
      stub = false;
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", s.color);
      p.setAttribute("stroke-width", s.width);
      p.setAttribute("stroke-linejoin", "round");
      if (s.pattern === "dashed") p.setAttribute("stroke-dasharray", `${s.width * 3 + 4} ${s.width * 2 + 3}`);
      if (s.pattern === "dotted") { p.setAttribute("stroke-dasharray", `0.1 ${s.width * 2 + 3}`); p.setAttribute("stroke-linecap", "round"); }
      svg.appendChild(p);
    });
  }
  row.appendChild(svg);
}

function _attachLines(row, cardOf, st, s) {
  if (s.kind === "none") return;
  const draw = () => _drawLines(row, cardOf, st, s);
  (window.requestAnimationFrame || (f => setTimeout(f, 0)))(draw);
  if (window.ResizeObserver) new ResizeObserver(draw).observe(row);
}

const TYPE_LABELS = { se: "Single elimination", de: "Double elimination", rr: "Round robin" };

async function getTournaments() {
  const d = await db("tournaments");
  if (!d) return [];
  return Object.entries(d).map(([id, v]) => ({
    id,
    name: v.name,
    type: v.type,
    third: v.third === true,
    gf: typeof v.gf === "number" ? v.gf : 2,
    iter: typeof v.iter === "number" ? v.iter : 1,
    showSeeds: v.showSeeds === true,
    lineStyle: v.lineStyle || "elbow",
    linePattern: v.linePattern || "solid",
    lineWidth: typeof v.lineWidth === "number" ? v.lineWidth : 2,
    lineColor: v.lineColor || "gold",
    sport: v.sport || "",
    description: v.description || "",
    order: v.order || 0,
    hidden: v.hidden === true,
    participants: Array.isArray(v.participants) ? v.participants : Object.values(v.participants || {}),
    results: v.results || {}
  })).sort((a, b) => a.order - b.order);
}

function tournamentStatus(t) {
  const r = Bracket.resolve(t);
  if (r.champion) return "Complete. Champion: " + r.champion;
  return r.doneCount ? `In progress (${r.doneCount} of ${r.total} matches)` : "Not started";
}

function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function _matchCard(o, opts) {
  const BYE = Bracket.BYE;
  const card = _el("div", "mcard");
  if (o.bye && o.p1 === BYE && o.p2 === BYE) { card.classList.add("empty"); return card; }
  if (o.bye) card.classList.add("byecard");

  const canEdit = !!opts.onSave && !o.bye && o.p1 !== null && o.p2 !== null;
  const inputs = [];
  [1, 2].forEach(k => {
    const name = o["p" + k];
    const row = _el("div", "mrow");
    if (name === null || name === BYE) row.classList.add("tbd");
    if (o.done && !o.bye) {
      if (o.winner === k) row.classList.add("win");
      else if (o.winner) row.classList.add("lose");
    }
    const nm = _el("span", "nm");
    const sd = opts.seedOf && name !== null && name !== BYE ? opts.seedOf(name) : 0;
    if (sd) nm.appendChild(_el("span", "seed", String(sd)));
    nm.appendChild(document.createTextNode(name === null ? "TBD" : name === BYE ? "BYE" : name));
    row.appendChild(nm);
    if (canEdit) {
      const inp = document.createElement("input");
      inp.type = "number"; inp.min = "0"; inp.step = "any"; inp.inputMode = "decimal";
      inp.value = o.done ? String(o["s" + k]) : "0";   // scores start at 0
      inp.onfocus = () => inp.select();                // typing replaces the 0
      inputs.push(inp); row.appendChild(inp);
    } else if (o.done && !o.bye) {
      row.appendChild(_el("span", "sc", String(o["s" + k])));
    }
    card.appendChild(row);
  });

  if (canEdit) {
    const bar = _el("div", "medit");
    const err = _el("div", "merr");
    const run = async fn => {
      err.textContent = "";
      try { await fn(); } catch (e) { err.textContent = e.message; }
    };
    const save = _el("button", "small", "Save");
    save.onclick = () => run(async () => {
      const [a, b] = inputs.map(i => (i.value.trim() === "" ? NaN : Number(i.value)));
      if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error("Enter both scores.");
      if (a < 0 || b < 0) throw new Error("Scores can't be negative.");
      if (a === b && opts.noTies) throw new Error("Scores can't tie in this bracket.");
      await opts.onSave(o.id, o.p1, o.p2, a, b);
    });
    bar.appendChild(save);
    if (o.done) {
      const clr = _el("button", "small gray", "Clear");
      clr.onclick = () => run(() => opts.onClear(o.id));
      bar.appendChild(clr);
    }
    card.append(bar, err);
  }
  return card;
}

function renderBracket(host, t, opts = {}) {
  const keep = Array.from(host.querySelectorAll(".rounds")).map(e => e.scrollLeft);
  const r = Bracket.resolve(t);
  const st = r.structure;
  opts = {
    ...opts,
    noTies: st.kind !== "rr",
    seedOf: t.showSeeds ? (n => t.participants.indexOf(n) + 1) : null
  };
  host.replaceChildren();

  if (r.champion) host.appendChild(_el("div", "champ", "🏆 Champion: " + r.champion));

  if (st.kind === "rr") {
    const wrap = _el("div", "tablewrap");
    const tbl = _el("table", "standings");
    const head = _el("tr");
    ["#", "Player", "P", "W", "D", "L", "PF", "PA", "Pts"].forEach(h => head.appendChild(_el("th", "", h)));
    tbl.appendChild(head);
    r.standings.forEach((s, i) => {
      const tr = _el("tr", i === 0 && r.champion ? "first" : "");
      [i + 1, s.name, s.p, s.w, s.d, s.l, s.pf, s.pa, s.pts].forEach(v => tr.appendChild(_el("td", "", String(v))));
      tbl.appendChild(tr);
    });
    wrap.appendChild(tbl); host.appendChild(wrap);
  }

  const lineJobs = [];
  st.sections.forEach(sec => {
    const sc = _el("div", "bsec");
    sc.appendChild(_el("h3", "", sec.title));
    const rounds = sec.rounds.filter(rd => rd.ids.some(id => !r.out[id].skipped));
    if (!rounds.length) return;
    if (st.kind === "rr") {
      const box = _el("div", "rr-rounds");
      rounds.forEach(rd => {
        const block = _el("div");
        block.appendChild(_el("div", "rtitle", rd.name));
        const cards = _el("div", "rr-cards");
        rd.ids.forEach(id => cards.appendChild(_matchCard(r.out[id], opts)));
        block.appendChild(cards); box.appendChild(block);
      });
      sc.appendChild(box);
    } else {
      const row = _el("div", "rounds"), cardOf = {};
      rounds.forEach(rd => {
        const col = _el("div", "round");
        col.appendChild(_el("div", "rtitle", rd.name));
        const ms = _el("div", "rmatches");
        rd.ids.forEach(id => {
          const slot = _el("div", "mslot"), card = _matchCard(r.out[id], opts);
          slot.appendChild(card); ms.appendChild(slot); cardOf[id] = card;
        });
        col.appendChild(ms); row.appendChild(col);
      });
      sc.appendChild(row);
      lineJobs.push({ row, cardOf });
    }
    host.appendChild(sc);
  });

  host.querySelectorAll(".rounds").forEach((e, i) => { if (keep[i]) e.scrollLeft = keep[i]; });
  const ls = _lineStyle(t);
  lineJobs.forEach(j => _attachLines(j.row, j.cardOf, st, ls));
}