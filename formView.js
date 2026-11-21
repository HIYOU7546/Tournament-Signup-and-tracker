// Shared by the sign-up page and the form builder: loads forms and draws them.

const Q_TYPES = {
  short: "Short answer",
  long: "Paragraph",
  choice: "Multiple choice",
  checks: "Checkboxes",
  dropdown: "Dropdown",
  number: "Number",
  email: "Email",
  date: "Date",
  info: "Text block (no answer)",
  section: "Section break (new page)"
};
const isAsk = q => q.type !== "info" && q.type !== "section";
const CHOICE_TYPES = ["choice", "checks", "dropdown"];

function _toArr(x) {
  if (!x) return [];
  if (Array.isArray(x)) return x.filter(v => v !== null && v !== undefined);
  return Object.keys(x).sort((a, b) => a - b).map(k => x[k]);
}

function normLogic(l) {
  if (!l) return null;
  const rules = _toArr(l.rules).filter(r => r && r.src && r.op).map(r => ({ src: String(r.src), op: String(r.op), val: r.val == null ? "" : String(r.val) }));
  if (!rules.length) return null;
  return { action: l.action === "show" ? "show" : "hide", match: l.match === "any" ? "any" : "all", rules };
}

async function getForms() {
  const d = await db("forms");
  if (!d) return [];
  return Object.entries(d).map(([id, v]) => ({
    id,
    title: v.title || "Untitled form",
    description: v.description || "",
    confirmation: v.confirmation || "",
    open: v.open === true,
    requireLogin: v.requireLogin === true,
    order: v.order || 0,
    questions: _toArr(v.questions).map(q => ({
      id: q.id, type: q.type || "short", text: q.text || "", help: q.help || "",
      required: q.required === true, options: _toArr(q.options).map(String), logic: normLogic(q.logic)
    }))
  })).sort((a, b) => a.order - b.order);
}

function _fe(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Draws a form into host. opts: { onSubmit(answers) -> Promise, submitText, preview }
// A "section" question starts a new page, like Google Forms. People move with Next / Back.
// Checkbox answers are stored as one string with each choice on its own line.
function renderForm(host, form, opts = {}) {
  host.replaceChildren();
  const wrap = _fe("div", "fm");

  // split into pages
  const pages = [{ title: "", desc: "", qs: [] }];
  form.questions.forEach(q => {
    if (q.type === "section") pages.push({ title: q.text, desc: q.help, qs: [] });
    else pages[pages.length - 1].qs.push(q);
  });
  const multi = pages.length > 1;

  const head = _fe("div", "fm-head");
  head.appendChild(_fe("h2", "fm-title", form.title));
  if (form.description) head.appendChild(_fe("p", "fm-desc", form.description));
  if (form.questions.some(q => q.required && isAsk(q))) head.appendChild(_fe("p", "fm-note", "* Required"));
  wrap.appendChild(head);

  const progress = _fe("div", "fm-prog");
  if (multi) wrap.appendChild(progress);

  const getters = [], cardOf = {}, getOf = {}, vis = {};
  const pageEls = pages.map((pg, pi) => {
    const box = _fe("div", "fm-page");
    if (pi > 0 && (pg.title || pg.desc)) {
      const sh = _fe("div", "fm-head sec");
      if (pg.title) sh.appendChild(_fe("h2", "fm-title", pg.title));
      if (pg.desc) sh.appendChild(_fe("p", "fm-desc", pg.desc));
      box.appendChild(sh);
    }
    pg.qs.forEach(q => {
      const card = _fe("div", "fm-q" + (q.type === "info" ? " info" : ""));
      cardOf[q.id] = card;
      const lab = _fe("div", "fm-label", q.text || (q.type === "info" ? "" : "Untitled question"));
      if (q.required && isAsk(q)) lab.appendChild(_fe("span", "fm-star", " *"));
      if (q.text || q.type !== "info") card.appendChild(lab);
      if (q.help) card.appendChild(_fe("div", "fm-help", q.help));

      let get = null;
      if (q.type === "short" || q.type === "number" || q.type === "email" || q.type === "date") {
        const i = document.createElement("input");
        i.type = q.type === "short" ? "text" : q.type;
        if (q.type === "short") i.maxLength = 300;
        if (q.type === "number") i.step = "any";
        i.autocomplete = "off";
        card.appendChild(i); get = () => i.value.trim();
      } else if (q.type === "long") {
        const t = document.createElement("textarea"); t.maxLength = 2000;
        card.appendChild(t); get = () => t.value.trim();
      } else if (q.type === "dropdown") {
        const s = document.createElement("select");
        const first = document.createElement("option"); first.value = ""; first.textContent = "Choose..."; s.appendChild(first);
        q.options.forEach(o => { const op = document.createElement("option"); op.value = o; op.textContent = o; s.appendChild(op); });
        card.appendChild(s); get = () => s.value;
      } else if (q.type === "choice" || q.type === "checks") {
        const kind = q.type === "choice" ? "radio" : "checkbox";
        const inputs = [];
        q.options.forEach(o => {
          const row = _fe("label", "fm-opt");
          const i = document.createElement("input"); i.type = kind; i.name = "q_" + q.id; i.value = o;
          row.append(i, _fe("span", "", o)); card.appendChild(row); inputs.push(i);
        });
        get = () => inputs.filter(i => i.checked).map(i => i.value).join("\n");
      }
      const err = _fe("div", "fm-err");
      card.appendChild(err);
      if (get) { getters.push({ q, get, err, card, page: pi }); getOf[q.id] = get; }
      box.appendChild(card);
    });
    wrap.appendChild(box);
    return box;
  });

  // validate one page (or all pages when pi is undefined). Returns first bad page index or -1.
  function check(pi, answers) {
    let firstCard = null, firstPage = -1;
    getters.forEach(({ q, get, err, card, page }) => {
      if (pi !== undefined && page !== pi) return;
      if (vis[q.id] === false) return;
      err.textContent = ""; card.classList.remove("bad");
      const val = get(); let msg = "";
      if (!val) { if (q.required) msg = "This question is required."; }
      else if (q.type === "number" && !Number.isFinite(Number(val))) msg = "Enter a valid number.";
      else if (q.type === "email" && !/^\S+@\S+\.\S+$/.test(val)) msg = "Enter a valid email address.";
      if (msg) { err.textContent = msg; card.classList.add("bad"); if (!firstCard) { firstCard = card; firstPage = page; } }
      else if (val && answers) answers[q.id] = val;
    });
    return { page: firstPage, card: firstCard };
  }

  let cur = 0;
  const back = _fe("button", "gray", "Back");
  const next = _fe("button", "fm-submit", "Next");
  const btn = _fe("button", "fm-submit", opts.submitText || "Submit");
  const msg = _fe("div", "msg err");
  if (opts.preview) { btn.disabled = true; btn.textContent = "Submit (preview only)"; }

  // ---- conditional logic: show / hide questions based on settings or earlier answers ----
  function evalRule(r) {
    if (r.src === "setting:login") return r.op === "off" ? form.requireLogin !== true : form.requireLogin === true;
    const raw = vis[r.src] !== false && getOf[r.src] ? getOf[r.src]() : "";
    const parts = raw ? raw.split("\n") : [];
    const val = r.val || "";
    switch (r.op) {
      case "equals": return parts.includes(val);
      case "notequals": return !parts.includes(val);
      case "contains": return raw.toLowerCase().includes(val.toLowerCase());
      case "empty": return !raw;
      case "filled": return !!raw;
      default: return false;
    }
  }
  function updateLogic() {
    form.questions.forEach(q => {
      if (q.type === "section") return;
      let show = true;
      if (q.logic && q.logic.rules && q.logic.rules.length) {
        const res = q.logic.rules.map(evalRule);
        const hit = q.logic.match === "any" ? res.some(Boolean) : res.every(Boolean);
        show = q.logic.action === "show" ? hit : !hit;
      }
      vis[q.id] = show;
      if (cardOf[q.id]) cardOf[q.id].hidden = !show;
    });
  }
  // a page with no visible questions is skipped (the first page always shows)
  const pageShown = pi => pi === 0 || pages[pi].qs.some(q => vis[q.id] !== false);
  const shownPages = () => pages.map((_, i) => i).filter(pageShown);
  function refreshNav() {
    updateLogic();
    const sp = shownPages(), hasNext = sp.some(i => i > cur);
    next.hidden = !hasNext; btn.hidden = hasNext; back.hidden = !sp.some(i => i < cur);
    progress.textContent = sp.length > 1 ? `Page ${Math.max(1, sp.filter(i => i <= cur).length)} of ${sp.length}` : "";
  }
  function go(n) {
    cur = n;
    pageEls.forEach((p, i) => p.hidden = i !== cur);
    refreshNav(); msg.textContent = "";
    if (shownPages().length > 1 && wrap.scrollIntoView) wrap.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  back.onclick = () => { const p = shownPages().filter(i => i < cur).pop(); if (p !== undefined) go(p); };
  next.onclick = () => { if (check(cur).page === -1) { const n = shownPages().find(i => i > cur); if (n !== undefined) go(n); } };
  wrap.addEventListener("input", refreshNav);
  wrap.addEventListener("change", refreshNav);
  btn.onclick = async () => {
    const answers = {}, bad = check(undefined, answers);
    if (bad.page !== -1) { if (bad.page !== cur) go(bad.page); if (bad.card && bad.card.scrollIntoView) bad.card.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    msg.textContent = ""; btn.disabled = true;
    try { await opts.onSubmit(answers); } catch (e) { msg.textContent = e.message; }
    btn.disabled = !!opts.preview;
  };

  const actions = _fe("div", "fm-actions");
  actions.append(back, next, btn, msg);
  wrap.appendChild(actions);
  host.appendChild(wrap);
  go(0);
  return { check };
}