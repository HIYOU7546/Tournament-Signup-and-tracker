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
  // During a tournament the Sign Up link disappears entirely.
  db("settings/tournamentMode").then(v => {
    if (v === true) { const l = n.querySelector('a[href="index.html"]'); if (l) l.remove(); }
  }).catch(() => {});
}

// ---- Firebase REST helpers ----
async function db(path, method = "GET", body, auth = false) {
  let url = `${DB}/${path}.json`;
  if (auth) {
    const t = sessionStorage.getItem(auth === "player" ? "ptoken" : "token");
    if (t) url += `?auth=${encodeURIComponent(t)}`;
  }
  const res = await fetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) {
    if (res.status === 401) {
      if (auth === "player") {
        playerLogout();
        throw new Error("Your sign-in expired or isn't allowed. Please sign in again with your @" + SCHOOL_DOMAIN + " account.");
      }
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

async function signup(players, useLogin = false) {
  if (players.length < 1 || players.length > 4) throw new Error("Enter 1 to 4 player names.");
  if (players.some(p => p.length > 30)) throw new Error("Names must be 30 characters or less.");
  // Word filter: checked right here, immediately before anything is sent to the database.
  // If words.js didn't load we refuse to send, so the filter can never be silently skipped.
  if (typeof containsBlockedWord !== "function") {
    console.error("words.js did not load, so sign-ups are paused.");
    throw new Error("The word filter didn't load. Please refresh the page and try again.");
  }
  if (players.some(p => containsBlockedWord(p))) {
    throw new Error("One of the names isn't allowed. Please use school-appropriate names.");
  }
  const now = Date.now();
  const entry = { players, order: now, signedUpAt: now };
  if (!useLogin) return db("queue", "POST", entry);
  const sess = playerSession();
  if (!sess) throw new Error("Please sign in again with your @" + SCHOOL_DOMAIN + " account.");
  // One atomic write: the public queue entry + a private record of who signed up (admins only).
  const key = "s" + now.toString(36) + Math.random().toString(36).slice(2, 8);
  return db("", "PATCH", {
    [`queue/${key}`]: entry,
    [`signups/${key}`]: { email: sess.email, uid: sess.uid, at: now }
  }, "player");
}

// ---- Player (Google) sign-in ----
const SCHOOL_DOMAIN = "hamiltonschools.us";

function playerSession() {
  const t = sessionStorage.getItem("ptoken");
  const uid = sessionStorage.getItem("puid");
  const exp = Number(sessionStorage.getItem("pexp")) || 0;
  if (!t || !uid || Date.now() > exp) return null;
  return { token: t, uid, email: sessionStorage.getItem("pemail") || "" };
}
function playerLogout() {
  ["ptoken", "pemail", "puid", "pexp"].forEach(k => sessionStorage.removeItem(k));
}
// Exchanges the Google ID token (from the Google button) for a Firebase login.
async function googleSignIn(credential) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${CONFIG.apiKey}`, {
    method: "POST",
    body: JSON.stringify({
      postBody: `id_token=${credential}&providerId=google.com`,
      requestUri: location.origin,
      returnIdpCredential: true,
      returnSecureToken: true
    })
  });
  const j = await res.json();
  if (!res.ok) {
    const code = (j.error && j.error.message) || "unknown";
    throw new Error("Google sign-in failed (" + code + "). An admin may need to check the Google setup in Firebase.");
  }
  if (!j.idToken) throw new Error("This email already has a different kind of login. Try another account.");
  const email = (j.email || "").toLowerCase();
  if (!j.emailVerified || !email.endsWith("@" + SCHOOL_DOMAIN)) {
    throw new Error("Please sign in with your @" + SCHOOL_DOMAIN + " account.");
  }
  sessionStorage.setItem("ptoken", j.idToken);
  sessionStorage.setItem("pemail", email);
  sessionStorage.setItem("puid", j.localId);
  sessionStorage.setItem("pexp", String(Date.now() + Number(j.expiresIn || 3600) * 1000 - 60000));
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

// Emails a password-reset link (Firebase sends it; the person picks their own password).
async function sendPasswordReset(email) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${CONFIG.apiKey}`, {
    method: "POST",
    body: JSON.stringify({ requestType: "PASSWORD_RESET", email })
  });
  if (!res.ok) {
    let code = "";
    try { code = ((await res.json()).error || {}).message || ""; } catch {}
    if (code.startsWith("EMAIL_NOT_FOUND")) throw new Error("No login exists for " + email + ".");
    if (code.startsWith("INVALID_EMAIL")) throw new Error("That email address isn't valid.");
    throw new Error("Couldn't send the reset email (" + (code || res.status) + ").");
  }
}

const removeEntry = id => db("", "PATCH", { [`queue/${id}`]: null, [`signups/${id}`]: null }, true);
// Clears only the ids you pass in (the admin page passes the non-hidden ones).
function clearQueue(ids) {
  const u = {};
  ids.forEach(id => { u[`queue/${id}`] = null; u[`signups/${id}`] = null; });
  return Object.keys(u).length ? db("", "PATCH", u, true) : Promise.resolve();
}
function swapOrder(a, b) {
  return db("queue", "PATCH", { [`${a.id}/order`]: b.order, [`${b.id}/order`]: a.order }, true);
}

// ---- Rendering ----
// handlers (optional): { up(entry, index), down(entry, index), hide(entry), done(entry) } -> shows admin buttons
// whoMap (optional, admin only): { entryId: { email } }
function renderQueue(el, queue, handlers, whoMap = {}) {
  el.replaceChildren();
  if (!handlers) queue = queue.filter(e => !e.hidden); // public view never shows hidden entries
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
    const mid = document.createElement("div"); mid.style.flex = "1"; mid.appendChild(pl);
    const who = whoMap[e.id];
    if (who && who.email) {
      const w = document.createElement("div"); w.className = "time"; w.style.marginTop = "4px";
      w.textContent = "Signed up by " + who.email; mid.appendChild(w);
    }
    const t = document.createElement("div"); t.className = "time";
    t.textContent = new Date(e.signedUpAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    row.append(pos, mid, t);
    if (handlers) {
      const act = document.createElement("div"); act.className = "actions";
      act.style.flexWrap = "wrap"; act.style.justifyContent = "flex-end";
      const mk = (label, cls, fn) => { const b = document.createElement("button"); b.className = "small " + cls; b.textContent = label; b.onclick = fn; act.appendChild(b); };
      mk("↑", "gray", () => handlers.up(e, i));
      mk("↓", "gray", () => handlers.down(e, i));
      if (handlers.hide) mk("Hide", "gray", () => handlers.hide(e));
      mk("Done", "bad", () => handlers.done(e));
      row.appendChild(act);
    }
    el.appendChild(row);
  });
}