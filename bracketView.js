// Draws a tournament (built with bracket.js) into a page element.
// opts (admin only): onSave(matchId, p1, p2, s1, s2) -> Promise, onClear(matchId) -> Promise

const TYPE_LABELS = { se: "Single elimination", de: "Double elimination", rr: "Round robin" };

async function getTournaments() {
  const d = await db("tournaments");
  if (!d) return [];
  return Object.entries(d).map(([id, v]) => ({
    id,
    name: v.name,
    type: v.type,
    third: v.third === true,
    order: v.order || 0,
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
    row.appendChild(_el("span", "nm", name === null ? "TBD" : name === BYE ? "BYE" : name));
    if (canEdit) {
      const inp = document.createElement("input");
      inp.type = "number"; inp.min = "0"; inp.step = "any"; inp.inputMode = "decimal";
      inp.value = o.done ? String(o["s" + k]) : "";
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
  opts = { ...opts, noTies: st.kind !== "rr" };
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
      const row = _el("div", "rounds");
      rounds.forEach(rd => {
        const col = _el("div", "round");
        col.appendChild(_el("div", "rtitle", rd.name));
        const ms = _el("div", "rmatches");
        rd.ids.forEach(id => ms.appendChild(_matchCard(r.out[id], opts)));
        col.appendChild(ms); row.appendChild(col);
      });
      sc.appendChild(row);
    }
    host.appendChild(sc);
  });

  host.querySelectorAll(".rounds").forEach((e, i) => { if (keep[i]) e.scrollLeft = keep[i]; });
}