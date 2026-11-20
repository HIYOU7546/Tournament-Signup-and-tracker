// ---------------------------------------------------------------
// Word filter for sign-up names. Edit the lists below to taste.
// All words must be lowercase letters only.
//
// BLOCK_ANYWHERE : blocked even when inside a longer word (use for words
//                  that never appear in normal names).
// BLOCK_WHOLE    : blocked only as a whole word (so "Dickson", "Essex"
//                  and "Cummings" are fine, but "dick" is not).
// ALLOWED_WORDS  : exceptions that are always OK (e.g. a real student's
//                  name that gets flagged).
// ---------------------------------------------------------------
const BLOCK_ANYWHERE = [
  "fuck", "shit", "bitch", "cunt", "nigger", "nigga", "whore", "slut",
  "bastard", "pussy", "faggot", "retard", "porn", "asshole", "dumbass",
  "jackass", "dickhead", "cocksucker", "blowjob", "handjob", "jizz",
  "wanker", "twat"
];
const BLOCK_WHOLE = [
  "ass", "arse", "dick", "cock", "tit", "tits", "boob", "boobs", "anus",
  "penis", "vagina", "cum", "sex", "horny", "rape", "rapist", "fag", "fags",
  "dyke", "spic", "chink", "kike", "coon", "negro", "tranny", "nazi", "kys",
  "hoe", "thot", "balls", "damn", "crap", "piss", "hell"
];
const ALLOWED_WORDS = [];

// ---- matching engine (no need to edit below) ----
const _VOWELS = "aeiou";
function _pattern(word, whole) {
  // Each letter may repeat ("fuuuck"); a doubled letter ("ss") must stay doubled.
  // Vowels also match "*" so "f*ck" and "sh*t" are caught.
  let re = "", i = 0;
  while (i < word.length) {
    let j = i;
    while (j < word.length && word[j] === word[i]) j++;
    const n = j - i, ch = word[i];
    re += (_VOWELS.includes(ch) ? `[${ch}*]` : ch) + (n > 1 ? `{${n},}` : "+");
    i = j;
  }
  return new RegExp(whole ? `^${re}$` : re);
}
const _ANYWHERE = BLOCK_ANYWHERE.map(w => _pattern(w, false));
const _WHOLE = BLOCK_WHOLE.map(w => _pattern(w, true));

function _tokens(text) {
  let s = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/(?<=[a-z])!(?=[a-z])/g, "i");           // sh!t
  s = s.replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e")
       .replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t")
       .replace(/@/g, "a").replace(/\$/g, "s");
  const tokens = s.split(/[^a-z*]+/).filter(Boolean);
  // Catch spaced-out words like "f u c k" or "s.h.i.t"
  let run = "";
  const flush = () => { if (run.length >= 3) tokens.push(run); run = ""; };
  for (const t of s.split(/[^a-z*]+/).filter(Boolean)) {
    if (t.length === 1) run += t; else flush();
  }
  flush();
  return tokens;
}

function containsBlockedWord(text) {
  return _tokens(text).some(t =>
    !ALLOWED_WORDS.includes(t) && (_ANYWHERE.some(r => r.test(t)) || _WHOLE.some(r => r.test(t)))
  );
}
if (typeof module !== "undefined") module.exports = { containsBlockedWord };
