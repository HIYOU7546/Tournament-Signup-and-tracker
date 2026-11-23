const $ = s => document.querySelector(s);
const DB = CONFIG.databaseUrl.replace(/\/$/, "");

// Text shown on the sign-up page. Admins can change any of these on the Edit Text page.
const TEXT_DEFAULTS = {
  tabOp: "Open Play",
  tabTour: "Tournament Sign-Up",
  opHeading: "Open Play Sign Up",
  opIntro: "Add up to 4 players. You'll be placed at the end of the line.",
  opP1: "Player 1 (required)",
  opP2: "Player 2 (optional)",
  opP3: "Player 3 (optional)",
  opP4: "Player 4 (optional)",
  opButton: "Join the line",
  opSuccess: "You're in line!",
  opLineHeading: "The Line",
  opEmpty: "Nobody in line yet.",
  opLoginHeading: "Sign in to join the line",
  opLoginIntro: "Use your @{domain} Google account.",
  tourHeading: "Tournament Sign Up",
  tourIntro: "",
  tourLoginHeading: "Sign in to continue",
  tourLoginIntro: "This form needs your @{domain} Google account.",
  tourClosed: "Tournament sign-ups are not active right now.",
  closed: "Sign-ups are currently closed. Check back soon!"
};
let TEXT = { ...TEXT_DEFAULTS };

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
  // The Sign Up link only disappears when a tournament is running AND tournament sign-up is off.
  db("settings").then(st => {
    st = st || {};
    if (st.tournamentMode === true && st.tournamentSignupEnabled !== true) {
      const l = n.querySelector('a[href="index.html"]'); if (l) l.remove();
    }
  }).catch(() => {});
}

// ---- Firebase REST helpers ----
// ---- Login tokens ----
// Firebase login tokens only last 1 hour by design. Instead of keeping one forever, we swap the
// refresh token for a brand-new login token shortly before it runs out (and again if the
// database ever says "expired"), so the token in use is always a recent one.
const TK = {
  admin:  { token: "token",  refresh: "rtoken",  exp: "texp" },
  player: { token: "ptoken", refresh: "prtoken", exp: "pexp" }
};
const _refreshing = {};
function refreshToken(kind) {
  const k = TK[kind];
  if (_refreshing[kind]) return _refreshing[kind];
  const rt = sessionStorage.getItem(k.refresh);
  if (!rt) return Promise.resolve(null);
  _refreshing[kind] = (async () => {
    try {
      const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${CONFIG.apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(rt)
      });
      if (!res.ok) throw new Error("refresh failed");
      const j = await res.json();
      sessionStorage.setItem(k.token, j.id_token);
      if (j.refresh_token) sessionStorage.setItem(k.refresh, j.refresh_token);
      sessionStorage.setItem(k.exp, String(Date.now() + Number(j.expires_in || 3600) * 1000 - 120000));
      return j.id_token;
    } catch {
      [k.token, k.refresh, k.exp].forEach(x => sessionStorage.removeItem(x));
      if (kind === "admin") sessionStorage.removeItem("uid"); else ["pemail", "puid"].forEach(x => sessionStorage.removeItem(x));
      return null;
    } finally { delete _refreshing[kind]; }
  })();
  return _refreshing[kind];
}
// Returns a login token that is valid right now (refreshing it first if it's about to expire).
async function freshToken(kind, force = false) {
  const k = TK[kind === "player" ? "player" : "admin"];
  const t = sessionStorage.getItem(k.token);
  if (!t) return null;
  const exp = Number(sessionStorage.getItem(k.exp)) || 0;
  if (!force && exp && Date.now() < exp) return t;
  if (!sessionStorage.getItem(k.refresh)) return t; // old login with no refresh token: use as is
  return refreshToken(kind === "player" ? "player" : "admin");
}

async function db(path, method = "GET", body, auth = false) {
  const kind = auth === "player" ? "player" : "admin";
  const send = async force => {
    let url = `${DB}/${path}.json`;
    if (auth) {
      const t = await freshToken(kind, force);
      if (t) url += `?auth=${encodeURIComponent(t)}`;
    }
    return fetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  };
  let res = await send(false);
  // Expired or rejected login token: get a new one and try once more.
  if (res.status === 401 && auth && sessionStorage.getItem(TK[kind].refresh)) res = await send(true);
  if (!res.ok) {
    if (res.status === 401) {
      if (auth === "player" && method !== "GET") {
        throw new Error("That sign-up wasn't accepted. The line may be closed, you may be on a timeout, or you signed up a moment ago. Please try again shortly.");
      }
      if (auth === "player") {
        playerLogout();
        throw new Error("Your sign-in expired or isn't allowed. Please sign in again with your " + domainWord() + " account.");
      }
      if (auth) {
        // An old login with no way to renew: drop it so the admin page goes back to the login screen.
        if (!sessionStorage.getItem("rtoken")) ["token", "texp", "uid"].forEach(k => sessionStorage.removeItem(k));
      }
      if (auth) throw new Error("Permission denied. Your login may have expired (please log in again), or this account isn't in the admins list.");
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
  const TS = { ".sv": "timestamp" }; // the database stamps the real time, so nobody can fake their place in line
  const entry = { players, order: TS, signedUpAt: TS };
  if (!useLogin) return db("queue", "POST", entry);
  await freshToken("player");
  const sess = playerSession();
  if (!sess) throw new Error("Please sign in again with your " + domainWord() + " account.");
  try {
    const last = await db("lastSignup/" + sess.uid, "GET", undefined, "player");
    if (last && Date.now() - last < 30000) throw new Error("Please wait a few seconds before signing up again.");
  } catch (e) { if (/wait a few/.test(e.message)) throw e; }
  // Banned or timed-out accounts can't sign up (the database rules enforce this too).
  try {
    const b = await db("bans/" + sess.uid, "GET", undefined, "player");
    if (b && b.until && Date.now() < b.until) {
      const perm = b.until > 4e12;
      throw new Error(perm ? "Your account can't sign up right now. Please talk to a teacher or staff member."
        : "Your account is on a timeout until " + new Date(b.until).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + ".");
    }
  } catch (e) { if (/timeout|can't sign up/.test(e.message)) throw e; }
  // One atomic write: the public queue entry + a private record of who signed up (admins only).
  const key = "s" + now.toString(36) + Math.random().toString(36).slice(2, 8);
  return db("", "PATCH", {
    [`queue/${key}`]: entry,
    [`signups/${key}`]: { email: sess.email, uid: sess.uid, at: TS },
    [`lastSignup/${sess.uid}`]: TS
  }, "player");
}

// ---- Player (Google) sign-in ----
// Which email addresses may sign in. Admins change this on the Admin page (settings/emailDomain).
// "*" means any Google account. Until a setting is saved, it stays hamiltonschools.us.
const DEFAULT_DOMAIN = "hamiltonschools.us";
let SCHOOL_DOMAIN = DEFAULT_DOMAIN;
const anyDomain = () => SCHOOL_DOMAIN === "*";
const domainWord = () => anyDomain() ? "Google" : "@" + SCHOOL_DOMAIN;
function setDomain(d) { SCHOOL_DOMAIN = (typeof d === "string" && d.trim() ? d.trim().toLowerCase() : DEFAULT_DOMAIN); }
// Fills {domain} in editable text. "@{domain} " disappears when any account is allowed.
function fillDomain(str) {
  return String(str).replace(/@\{domain\} ?/g, anyDomain() ? "" : "@" + SCHOOL_DOMAIN + " ").replace(/\{domain\}/g, anyDomain() ? "any" : SCHOOL_DOMAIN);
}

function playerSession() {
  const t = sessionStorage.getItem("ptoken");
  const uid = sessionStorage.getItem("puid");
  const exp = Number(sessionStorage.getItem("pexp")) || 0;
  // Still signed in if the token is fresh, or if we hold a refresh token that can renew it.
  if (!t || !uid || (Date.now() > exp && !sessionStorage.getItem("prtoken"))) return null;
  return { token: t, uid, email: sessionStorage.getItem("pemail") || "" };
}
function playerLogout() {
  ["ptoken", "prtoken", "pemail", "puid", "pexp"].forEach(k => sessionStorage.removeItem(k));
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
  try { setDomain(await db("settings/emailDomain")); } catch {}
  if (!j.emailVerified || (!anyDomain() && !email.endsWith("@" + SCHOOL_DOMAIN))) {
    throw new Error("Please sign in with your " + domainWord() + " account.");
  }
  sessionStorage.setItem("ptoken", j.idToken);
  if (j.refreshToken) sessionStorage.setItem("prtoken", j.refreshToken);
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
  if (j.refreshToken) sessionStorage.setItem("rtoken", j.refreshToken);
  sessionStorage.setItem("texp", String(Date.now() + Number(j.expiresIn || 3600) * 1000 - 120000));
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
    p.className = "muted"; p.textContent = TEXT.opEmpty;
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