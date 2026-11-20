const $ = s => document.querySelector(s);
const DB = CONFIG.databaseUrl.replace(/\/$/, "");

function nav(active) {
  const links = [["index.html", "Sign Up"], ["brackets.html", "Brackets"], ["qr.html", "QR Code"], ["admin.html", "Admin"]];
  const n = document.createElement("nav");
  links.forEach(([href, label]) => {
    const a = document.createElement("a");
    a.href = href; a.textContent = label;
    if (href === active) a.className = "active";
    n.appendChild(a);
  });
  document.body.prepend(n);
}

// ---- Firebase REST helpers ----
async function db(path, method = "GET", body, auth = false) {
  let url = `${DB}/${path}.json`;
  if (auth) {
    const t = sessionStorage.getItem("token");
    if (t) url += `?auth=${encodeURIComponent(t)}`;
  }
  const res = await fetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) {
    if (res.status === 401) {
      if (auth) throw new Error("Permission denied. Either your login expired (log out and back in) or the admin email in the database rules doesn't match yours.");
      throw new Error("Permission denied by the database rules.");
    }
    throw new Error("Request failed (" + res.status + "). Check config.js and the database rules.");
  }
  return res.json();
}

async function getQueue() {
  const data = await db("queue");
  if (!data) return [];
  return Object.entries(data)
    .map(([id, v]) => ({ id, ...v, players: Array.isArray(v.players) ? v.players.filter(Boolean) : Object.values(v.players || {}) }))
    .sort((a, b) => a.order - b.order);
}

async function signup(players) {
  if (players.length < 1 || players.length > 4) throw new Error("Enter 1 to 4 player names.");
  if (players.some(p => p.length > 30)) throw new Error("Names must be 30 characters or less.");
  const now = Date.now();
  return db("queue", "POST", { players, order: now, signedUpAt: now });
}

async function adminLogin(email, password) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${CONFIG.apiKey}`, {
    method: "POST",
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  if (!res.ok) throw new Error("Wrong email or password.");
  const j = await res.json();
  sessionStorage.setItem("token", j.idToken);
  sessionStorage.setItem("uid", j.localId);
}

const removeEntry = id => db(`queue/${id}`, "DELETE", undefined, true);
const clearQueue = () => db("queue", "DELETE", undefined, true);
function swapOrder(a, b) {
  return db("queue", "PATCH", { [`${a.id}/order`]: b.order, [`${b.id}/order`]: a.order }, true);
}

// ---- Rendering ----
// handlers (optional): { up(entry, index), down(entry, index), done(entry) } -> shows admin buttons
function renderQueue(el, queue, handlers) {
  el.replaceChildren();
  if (!queue.length) {
    const p = document.createElement("p");
    p.className = "muted"; p.textContent = "Nobody in line yet.";
    el.appendChild(p); return;
  }
  queue.forEach((e, i) => {
    const row = document.createElement("div");
    row.className = "entry" + (i === 0 ? " next" : "");
    const pos = document.createElement("div"); pos.className = "pos"; pos.textContent = i + 1;
    const pl = document.createElement("div"); pl.className = "players";
    e.players.forEach(n => { const c = document.createElement("span"); c.className = "chip"; c.textContent = n; pl.appendChild(c); });
    const t = document.createElement("div"); t.className = "time";
    t.textContent = new Date(e.signedUpAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    row.append(pos, pl, t);
    if (handlers) {
      const act = document.createElement("div"); act.className = "actions";
      const mk = (label, cls, fn) => { const b = document.createElement("button"); b.className = "small " + cls; b.textContent = label; b.onclick = fn; act.appendChild(b); };
      mk("↑", "gray", () => handlers.up(e, i));
      mk("↓", "gray", () => handlers.down(e, i));
      mk("Done", "bad", () => handlers.done(e));
      row.appendChild(act);
    }
    el.appendChild(row);
  });
}