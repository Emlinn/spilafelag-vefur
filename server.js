// Spilafélag Vestfjarða — public website + member login.
// Zero dependencies: node:http + node:sqlite (Node 24).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import {
  db, hashPassword, verifyPassword, burnTime,
  createSession, sessionMember, destroySession, pruneSessions, SESSION_DAYS,
} from './db.js';
import { parseKennitala } from './kennitala.js';
import { REMOTE, Unavailable, sendApplication, membership, overview, leave } from './adild.js';

const PORT = Number(process.env.PORT ?? 3200);
const HOST = process.env.HOST ?? '0.0.0.0';
const PROD = process.env.NODE_ENV === 'production';
// Served under a sub-path (e.g. /heimasida behind nginx, which strips it before
// proxying)? Pages get <base href="BASE/"> so their relative links follow.
const BASE = (process.env.BASE_PATH ?? '').replace(/\/+$/, '');
// Behind a reverse proxy every socket is 127.0.0.1; trust its X-Real-IP instead.
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const PUBLIC = resolve('public');
const COOKIE = 'spv_session';
// CSS/JS are cached for an hour in production. Pages ask for styles.css?v=… and site.js?v=…
// with a version taken from the files at startup, so every deploy (which restarts us) busts the cache.
const ASSET_VERSION = ['styles.css', 'site.js']
  .map((f) => Math.floor(statSync(join(PUBLIC, f)).mtimeMs).toString(36)).join('');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm', '.json': 'application/json; charset=utf-8', '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
};

// Pretty URLs → files. /felagar is gated server-side.
const PAGES = {
  '/': 'index.html',
  '/ganga-i-felagid': 'ganga-i-felagid.html',
  '/innskraning': 'innskraning.html',
  '/felagar': 'felagar.html',
  '/personuvernd': 'personuvernd.html',
  '/frettir': 'frettir.html',
  // English
  '/en': 'en/index.html',
  '/en/join': 'en/join.html',
  '/en/login': 'en/login.html',
  '/en/members': 'en/members.html',
  '/en/privacy': 'en/privacy.html',
  '/en/news': 'en/news.html',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; font-src 'self'; " +
    "img-src 'self' data:; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
};

/* ── small helpers ─────────────────────────────────────────────────── */

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* a mangled cookie is just ignored */ }
  }
  return out;
}

function sessionCookie(token, maxAge) {
  return `${COOKIE}=${token}; Path=${BASE}/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${PROD ? '; Secure' : ''}`;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

const json = (res, status, data, headers = {}) =>
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });

// Bodies are JSON from site.js, or a plain form post when the script didn't run.
// The forms carry method="post" so a kennitala or password can never end up in a URL.
async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 32_768) throw Object.assign(new Error('too large'), { status: 413 });
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if ((req.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) {
    req.isForm = true;
    const out = Object.fromEntries(new URLSearchParams(text));
    if (out.lang === 'en') req.lang = 'en';
    return out;
  }
  try { return JSON.parse(text || '{}'); }
  catch { throw Object.assign(new Error('bad json'), { status: 400 }); }
}

// What a script-less form post gets back: a plain page, in the form's language.
function formReply(req, res, status, title, lines, back) {
  const en = req.lang === 'en' || req.headers['x-lang'] === 'en';
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const body = `<!doctype html><html lang="${en ? 'en' : 'is'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><link rel="stylesheet" href="${BASE}/styles.css?v=${ASSET_VERSION}"></head>
<body><main class="page narrow"><div class="wrap"><div class="page-intro"><h1>${esc(title)}</h1>
${lines.map((l) => `<p class="sub">${esc(l)}</p>`).join('')}
<p class="form-reply-back"><a class="btn" href="${BASE}/${back}">${en ? 'Back' : 'Til baka'}</a></p></div></div></main></body></html>`;
  send(res, status, body, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
}

// CSRF: cookies are SameSite=Lax, and every write must come from our own origin.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients (curl) carry no ambient cookie risk
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

// Throttles per IP: login and leaving, 10 tries / 15 min; applications, 10 / hour.
function limiter(max, windowMs) {
  const hits = new Map();
  return (ip) => {
    const now = Date.now();
    const list = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
    list.push(now);
    hits.set(ip, list);
    return list.length > max;
  };
}
const throttled = limiter(10, 15 * 60_000);
const applyThrottled = limiter(10, 60 * 60_000);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// 'safnkortaspil' and 'mot' are kept so older applications still validate.
const INTERESTS = new Set(['magic', 'pokemon', 'bordspil', 'hlutverkaspil', 'safnkortaspil', 'mot', 'annad']);
const clean = (v, max) => String(v ?? '').trim().slice(0, max);

/* ── API ───────────────────────────────────────────────────────────── */

async function api(req, res, path) {
  const method = req.method;
  // The English pages send X-Lang: en so their error messages come back in English.
  const t = (is, en) => (req.headers['x-lang'] === 'en' || req.lang === 'en' ? en : is);
  if (method !== 'GET' && !sameOrigin(req)) return json(res, 403, { error: t('Óheimill uppruni.', 'Forbidden origin.') });

  if (path === '/api/umsokn' && method === 'POST') {
    const ip = (TRUST_PROXY && req.headers['x-real-ip']) || req.socket.remoteAddress || '?';
    if (applyThrottled(ip)) return json(res, 429, { error: t('Of margar umsóknir. Reyndu aftur eftir smá stund.', 'Too many applications. Please try again shortly.') });
    const b = await readJson(req);
    const back = req.lang === 'en' ? 'en/join' : 'ganga-i-felagid';
    // A script-less post gets a plain page instead of JSON.
    const reply = (status, data) => {
      if (!req.isForm) return json(res, status, data);
      if (status < 300) return formReply(req, res, 200, t('Takk fyrir umsóknina!', 'Thanks, your application is in'), [t('Stjórnin fer yfir umsóknina og þú færð að vita hvað gerist næst.', 'The board will go through it and let you know what happens next.')], req.lang === 'en' ? 'en' : '');
      const lines = data.errors ? Object.values(data.errors) : [data.error];
      return formReply(req, res, status, t('Athugaðu umsóknina', 'Please check your application'), lines, back);
    };
    if (clean(b.website, 200)) return json(res, 200, { ok: true }); // honeypot: bots fill it, people don't see it
    const name = clean(b.name, 120);
    const kt = parseKennitala(b.kennitala);
    const minor = !!kt && kt.age < 18;
    const guardianName = minor ? clean(b.guardian_name, 120) : '';
    const guardianContact = minor ? clean(b.guardian_contact, 200) : '';
    const email = clean(b.email, 200).toLowerCase();
    const phone = clean(b.phone, 40) || null;
    const message = clean(b.message, 2000) || null;
    const interests = (Array.isArray(b.interests) ? b.interests : []).filter((i) => INTERESTS.has(i));
    const password = String(b.password ?? '');

    const errors = {};
    if (name.length < 2) errors.name = t('Skrifaðu fullt nafn.', 'Please enter your full name.');
    if (!kt) errors.kennitala = clean(b.kennitala, 20)
      ? t('Kennitalan er ekki gild.', 'That kennitala is not valid.')
      : t('Sláðu inn kennitölu.', 'Please enter your kennitala.');
    if (minor && guardianName.length < 2) errors.guardian_name = t('Skráðu nafn forráðamanns.', "Please enter a parent or guardian's name.");
    if (minor && guardianContact.length < 5) errors.guardian_contact = t('Skráðu síma eða netfang forráðamanns.', "Please enter a parent or guardian's phone or email.");
    if (!EMAIL_RE.test(email)) errors.email = email ? t('Athugaðu netfangið.', "That email address doesn't look right.") : t('Sláðu inn netfang.', 'Please enter your email.');
    if (password.length < 10) errors.password = t('Lykilorðið þarf að vera minnst 10 stafir.', 'The password must be at least 10 characters.');
    if (b.password2 !== undefined && String(b.password2) !== password) errors.password2 = t('Lykilorðin eru ekki eins.', "The passwords don't match."); // only plain form posts send it
    if (!b.consent) errors.consent = t('Hakaðu við hér til að staðfesta umsóknina.', 'Tick this box to confirm your application.');
    if (Object.keys(errors).length) return reply(422, { errors });

    const DUP = {
      kennitala: t('Umsókn með þessari kennitölu er þegar til. Skráðu þig inn, eða sendu okkur póst á spilafelagvestfjarda@gmail.com ef eitthvað er að.', 'An application with this kennitala already exists. Sign in, or email spilafelagvestfjarda@gmail.com if something is wrong.'),
      email: t('Umsókn með þessu netfangi er þegar til. Skráðu þig inn, eða sendu okkur póst á spilafelagvestfjarda@gmail.com ef eitthvað er að.', 'An application with this email already exists. Sign in, or email spilafelagvestfjarda@gmail.com if something is wrong.'),
    };
    // With the board dashboard connected, the application itself (kennitala,
    // phone, guardian…) goes there and this site keeps only the login.
    let id;
    try {
      id = REMOTE
        ? db.prepare('INSERT INTO members (name, email, password_hash) VALUES (?,?,?)').run(name, email, hashPassword(password)).lastInsertRowid
        : db.prepare(`INSERT INTO members (name, kennitala, email, phone, interests, message, guardian_name, guardian_contact, password_hash) VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(name, kt.kt, email, phone, JSON.stringify(interests), message, guardianName || null, guardianContact || null, hashPassword(password)).lastInsertRowid;
    } catch (e) {
      if (String(e.message).includes('members.kennitala')) return reply(409, { errors: { kennitala: DUP.kennitala } });
      if (String(e.message).includes('UNIQUE')) return reply(409, { errors: { email: DUP.email } });
      throw e;
    }
    if (REMOTE) {
      let dup;
      try {
        dup = await sendApplication({
          name, email, kennitala: kt.kt, phone, interests, message,
          guardian_name: guardianName, guardian_contact: guardianContact,
        });
      } catch (e) {
        db.prepare('DELETE FROM members WHERE id = ?').run(id);
        if (e instanceof Unavailable) return reply(503, { error: t('Ekki tókst að senda umsóknina núna. Reyndu aftur eftir smá stund.', "Couldn't send the application right now. Please try again shortly.") });
        throw e;
      }
      if (dup) {
        db.prepare('DELETE FROM members WHERE id = ?').run(id);
        return reply(409, { errors: { [dup]: DUP[dup] ?? DUP.email } });
      }
    }
    return reply(201, { ok: true });
  }

  if (path === '/api/innskraning' && method === 'POST') {
    const ip = (TRUST_PROXY && req.headers['x-real-ip']) || req.socket.remoteAddress || '?';
    if (throttled(ip)) return json(res, 429, { error: t('Of margar tilraunir. Reyndu aftur eftir smá stund.', 'Too many attempts. Please try again shortly.') });
    const b = await readJson(req);
    // A script-less post: errors as a plain page, success straight to the members area.
    const fail = (status, data, headers) => req.isForm
      ? formReply(req, res, status, t('Innskráning tókst ekki', 'Sign-in failed'), [data.error], req.lang === 'en' ? 'en/login' : 'innskraning')
      : json(res, status, data, headers);
    const email = clean(b.email, 200).toLowerCase();
    const password = String(b.password ?? '');
    const m = db.prepare('SELECT id, password_hash, status FROM members WHERE email = ?').get(email);
    if (!m) { burnTime(password); return fail(401, { error: t('Rangt netfang eða lykilorð.', 'Wrong email or password.') }); }
    if (!verifyPassword(password, m.password_hash)) return fail(401, { error: t('Rangt netfang eða lykilorð.', 'Wrong email or password.') });
    // Only members get in. With the dashboard connected it is asked every
    // time, and the answer is mirrored into members.status for the session.
    let st;
    try { st = await membership(email, m.status); }
    catch (e) { if (e instanceof Unavailable) return fail(503, { error: t('Innskráning liggur niðri í augnablikinu. Reyndu aftur eftir smá stund.', 'Sign-in is unavailable right now. Please try again shortly.') }); throw e; }
    if (REMOTE) {
      db.prepare(`UPDATE members SET status = ?, approved_at = CASE WHEN ? = 'approved' THEN COALESCE(approved_at, ?) ELSE approved_at END WHERE id = ?`)
        .run(st.status === 'member' ? 'approved' : st.status === 'pending' ? 'pending' : 'rejected',
          st.status === 'member' ? 'approved' : '', `${st.since ?? new Date().toISOString().slice(0, 10)} 00:00:00`, m.id);
    }
    if (st.status === 'pending') return fail(403, { error: t('Aðgangurinn þinn hefur ekki verið virkjaður enn. Stjórnin virkjar hann þegar félagsgjaldið hefur verið greitt, eða þegar hún hefur farið yfir umsóknina ef þú ert yngri en 18 ára.', "Your account hasn't been activated yet. The board activates it once the membership fee has been paid, or once it has reviewed your application if you're under 18.") });
    if (st.status !== 'member') return fail(403, { error: t('Þessi aðgangur er ekki virkur. Hafðu samband við stjórnina ef þú telur að þetta séu mistök.', 'This account is not active. Contact the board if you think this is a mistake.') });
    const token = createSession(m.id);
    const cookie = { 'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86_400) };
    if (req.isForm) return send(res, 303, '', { ...cookie, Location: `${BASE}/${req.lang === 'en' ? 'en/members' : 'felagar'}` });
    return json(res, 200, { ok: true }, cookie);
  }

  if (path === '/api/utskraning' && method === 'POST') {
    destroySession(cookies(req)[COOKIE]);
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }

  // The members page: attendance, tournaments, totals, upcoming events.
  // Membership is checked again here, so someone the board has taken off the
  // roll is logged out the next time they open the page.
  if (path === '/api/yfirlit' && method === 'GET') {
    const token = cookies(req)[COOKIE];
    const me = sessionMember(token);
    if (!me) return json(res, 401, { error: t('Þú þarft að skrá þig inn.', 'You need to sign in.') });
    const local = db.prepare('SELECT status FROM members WHERE id = ?').get(me.id)?.status;
    let data;
    try { data = await overview(me.email, local); }
    catch (e) { if (e instanceof Unavailable) return json(res, 503, { error: t('Náði ekki í upplýsingarnar núna.', "Couldn't load your information right now.") }); throw e; }
    if (data.status !== 'member') {
      db.prepare("UPDATE members SET status = 'rejected' WHERE id = ? AND ? <> 'pending'").run(me.id, data.status);
      destroySession(token);
      return json(res, 401, { error: t('Aðildin er ekki lengur virk.', 'Your membership is no longer active.') }, { 'Set-Cookie': sessionCookie('', 0) });
    }
    return json(res, 200, data);
  }

  // Leaving the club. Password again, because it cannot be undone from here:
  // off the roll at once, the login and the application are deleted, and the
  // board is told. Attendance and results stay with the dashboard's player.
  if (path === '/api/ursogn' && method === 'POST') {
    const ip = (TRUST_PROXY && req.headers['x-real-ip']) || req.socket.remoteAddress || '?';
    if (throttled(ip)) return json(res, 429, { error: t('Of margar tilraunir. Reyndu aftur eftir smá stund.', 'Too many attempts. Please try again shortly.') });
    const me = sessionMember(cookies(req)[COOKIE]);
    if (!me) return json(res, 401, { error: t('Þú þarft að skrá þig inn.', 'You need to sign in.') });
    const b = await readJson(req);
    const m = db.prepare('SELECT id, password_hash FROM members WHERE id = ?').get(me.id);
    if (!verifyPassword(String(b.password ?? ''), m.password_hash)) return json(res, 401, { errors: { password: t('Rangt lykilorð.', 'Wrong password.') } });
    try { await leave(me.email); }
    catch (e) { if (e instanceof Unavailable) return json(res, 503, { error: t('Ekki tókst að ganga frá úrsögninni núna. Reyndu aftur eftir smá stund.', "Couldn't complete leaving the club right now. Please try again shortly.") }); throw e; }
    db.prepare('DELETE FROM members WHERE id = ?').run(me.id); // sessions go with it (ON DELETE CASCADE)
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }

  if (path === '/api/eg' && method === 'GET') {
    const me = sessionMember(cookies(req)[COOKIE]);
    return me ? json(res, 200, { member: { ...me, is_admin: !!me.is_admin } }) : json(res, 401, { error: t('Þú þarft að skrá þig inn.', 'You need to sign in.') });
  }

  return json(res, 404, { error: t('Fannst ekki.', 'Not found.') });
}

/* ── static files ──────────────────────────────────────────────────── */

async function serveFile(req, res, file, status = 200) {
  const full = normalize(join(PUBLIC, file));
  if (full !== PUBLIC && !full.startsWith(PUBLIC + sep)) return send(res, 403, 'Forbidden');
  try {
    const s = await stat(full);
    if (!s.isFile()) throw new Error('not a file');
    const ext = extname(full);
    if (ext === '.mp4' || ext === '.webm') return streamMedia(req, res, full, s.size, ext);
    let body = await readFile(full);
    if (ext === '.html') body = body.toString('utf8')
      .replace('<base href="/">', `<base href="${BASE}/">`)
      .replace('href="styles.css"', `href="styles.css?v=${ASSET_VERSION}"`)
      .replace('src="site.js"', `src="site.js?v=${ASSET_VERSION}"`);
    send(res, status, body, {
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : PROD ? 'public, max-age=3600' : 'no-cache',
    });
  } catch {
    if (file !== '404.html') return serveFile(req, res, '404.html', 404);
    send(res, 404, 'Fannst ekki');
  }
}

// Video is streamed, never buffered whole, and honours Range requests —
// iOS Safari refuses to play a <video> whose server can't answer "bytes=0-1".
function streamMedia(req, res, full, size, ext) {
  const headers = {
    ...SECURITY_HEADERS,
    'Content-Type': TYPES[ext],
    'Accept-Ranges': 'bytes',
    'Cache-Control': PROD ? 'public, max-age=86400' : 'no-cache',
  };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  let start = 0, end = size - 1, status = 200;
  if (m && (m[1] || m[2])) {
    if (m[1]) { start = Number(m[1]); if (m[2]) end = Math.min(Number(m[2]), size - 1); }
    else start = Math.max(size - Number(m[2]), 0);           // suffix: last N bytes
    if (start > end || start >= size) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') return res.end();
  createReadStream(full, { start, end }).on('error', () => res.destroy()).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let path;
    try { path = decodeURIComponent(url.pathname); } catch { return send(res, 400, 'Bad request'); }
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

    if (path.startsWith('/api/')) return await api(req, res, path);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');

    if (path === '/felagar' && !sessionMember(cookies(req)[COOKIE])) {
      return send(res, 302, '', { Location: `${BASE}/innskraning?aftur=felagar` });
    }
    if (path === '/en/members' && !sessionMember(cookies(req)[COOKIE])) {
      return send(res, 302, '', { Location: `${BASE}/en/login?aftur=en/members` });
    }
    if (path === '/innskraning' && sessionMember(cookies(req)[COOKIE])) {
      return send(res, 302, '', { Location: `${BASE}/felagar` });
    }
    if (path === '/en/login' && sessionMember(cookies(req)[COOKIE])) {
      return send(res, 302, '', { Location: `${BASE}/en/members` });
    }
    if (PAGES[path]) return await serveFile(req, res, PAGES[path]);
    if (path.endsWith('.html')) return await serveFile(req, res, '404.html', 404); // only pretty URLs
    return await serveFile(req, res, path.slice(1));
  } catch (e) {
    const status = e.status ?? 500;
    if (status === 500) console.error(e);
    const generic = req.headers['x-lang'] === 'en' ? 'Something went wrong.' : 'Villa kom upp.';
    if (!res.headersSent) json(res, status, { error: status === 500 ? generic : e.message });
  }
});

pruneSessions();
setInterval(pruneSessions, 3_600_000).unref();
server.listen(PORT, HOST, () => console.log(`Spilafélag Vestfjarða → http://localhost:${PORT}`));
