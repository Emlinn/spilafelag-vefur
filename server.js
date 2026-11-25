// Spilafélag Vestfjarða — public website + member login.
// Zero dependencies: node:http + node:sqlite (Node 24).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
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

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm', '.json': 'application/json; charset=utf-8',
};

// Pretty URLs → files. /felagar is gated server-side.
const PAGES = {
  '/': 'index.html',
  '/ganga-i-felagid': 'ganga-i-felagid.html',
  '/innskraning': 'innskraning.html',
  '/felagar': 'felagar.html',
  '/personuvernd': 'personuvernd.html',
  '/um-felagid': 'um-felagid.html',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' https://fonts.googleapis.com; style-src-attr 'unsafe-inline'; font-src https://fonts.gstatic.com; " +
    "img-src 'self' data:; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
};

/* ── small helpers ─────────────────────────────────────────────────── */

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
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

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 32_768) throw Object.assign(new Error('too large'), { status: 413 });
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('bad json'), { status: 400 }); }
}

// CSRF: cookies are SameSite=Lax, and every write must come from our own origin.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients (curl) carry no ambient cookie risk
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

// Login throttle: 10 attempts / 15 min per IP.
const attempts = new Map();
function throttled(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) ?? []).filter((t) => now - t < 15 * 60_000);
  list.push(now);
  attempts.set(ip, list);
  return list.length > 10;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// 'safnkortaspil' and 'mot' are kept so older applications still validate.
const INTERESTS = new Set(['magic', 'pokemon', 'bordspil', 'hlutverkaspil', 'safnkortaspil', 'mot', 'annad']);
const clean = (v, max) => String(v ?? '').trim().slice(0, max);

/* ── API ───────────────────────────────────────────────────────────── */

async function api(req, res, path) {
  const method = req.method;
  if (method !== 'GET' && !sameOrigin(req)) return json(res, 403, { error: 'Óheimill uppruni.' });

  if (path === '/api/umsokn' && method === 'POST') {
    const b = await readJson(req);
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
    if (name.length < 2) errors.name = 'Skrifaðu fullt nafn.';
    if (!kt) errors.kennitala = 'Kennitalan er ekki gild.';
    if (minor && guardianName.length < 2) errors.guardian_name = 'Skráðu nafn forráðamanns.';
    if (minor && guardianContact.length < 5) errors.guardian_contact = 'Skráðu síma eða netfang forráðamanns.';
    if (!EMAIL_RE.test(email)) errors.email = 'Netfangið lítur ekki rétt út.';
    if (password.length < 10) errors.password = 'Lykilorðið þarf að vera minnst 10 stafir.';
    if (!b.consent) errors.consent = 'Hakaðu hér til að staðfesta umsóknina.';
    if (Object.keys(errors).length) return json(res, 422, { errors });

    const DUP = {
      kennitala: 'Umsókn með þessari kennitölu er þegar til.',
      email: 'Umsókn með þessu netfangi er þegar til.',
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
      if (String(e.message).includes('members.kennitala')) return json(res, 409, { errors: { kennitala: DUP.kennitala } });
      if (String(e.message).includes('UNIQUE')) return json(res, 409, { errors: { email: DUP.email } });
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
        if (e instanceof Unavailable) return json(res, 503, { error: 'Ekki tókst að senda umsóknina núna. Reyndu aftur eftir smá stund.' });
        throw e;
      }
      if (dup) {
        db.prepare('DELETE FROM members WHERE id = ?').run(id);
        return json(res, 409, { errors: { [dup]: DUP[dup] ?? DUP.email } });
      }
    }
    return json(res, 201, { ok: true });
  }

  if (path === '/api/innskraning' && method === 'POST') {
    const ip = (TRUST_PROXY && req.headers['x-real-ip']) || req.socket.remoteAddress || '?';
    if (throttled(ip)) return json(res, 429, { error: 'Of margar tilraunir. Reyndu aftur eftir smá stund.' });
    const b = await readJson(req);
    const email = clean(b.email, 200).toLowerCase();
    const password = String(b.password ?? '');
    const m = db.prepare('SELECT id, password_hash, status FROM members WHERE email = ?').get(email);
    if (!m) { burnTime(password); return json(res, 401, { error: 'Rangt netfang eða lykilorð.' }); }
    if (!verifyPassword(password, m.password_hash)) return json(res, 401, { error: 'Rangt netfang eða lykilorð.' });
    // Only members get in. With the dashboard connected it is asked every
    // time, and the answer is mirrored into members.status for the session.
    let st;
    try { st = await membership(email, m.status); }
    catch (e) { if (e instanceof Unavailable) return json(res, 503, { error: 'Innskráning liggur niðri í augnablikinu. Reyndu aftur eftir smá stund.' }); throw e; }
    if (REMOTE) {
      db.prepare(`UPDATE members SET status = ?, approved_at = CASE WHEN ? = 'approved' THEN COALESCE(approved_at, ?) ELSE approved_at END WHERE id = ?`)
        .run(st.status === 'member' ? 'approved' : st.status === 'pending' ? 'pending' : 'rejected',
          st.status === 'member' ? 'approved' : '', `${st.since ?? new Date().toISOString().slice(0, 10)} 00:00:00`, m.id);
    }
    if (st.status === 'pending') return json(res, 403, { error: 'Aðgangurinn þinn hefur ekki verið virkjaður enn. Það gerist þegar félagsgjaldið hefur verið greitt.' });
    if (st.status !== 'member') return json(res, 403, { error: 'Þessi aðgangur er ekki virkur. Hafðu samband við stjórnina ef þú telur það rangt.' });
    const token = createSession(m.id);
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86_400) });
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
    if (!me) return json(res, 401, { error: 'Ekki innskráð(ur).' });
    const local = db.prepare('SELECT status FROM members WHERE id = ?').get(me.id)?.status;
    let data;
    try { data = await overview(me.email, local); }
    catch (e) { if (e instanceof Unavailable) return json(res, 503, { error: 'Náði ekki í upplýsingarnar núna.' }); throw e; }
    if (data.status !== 'member') {
      db.prepare("UPDATE members SET status = 'rejected' WHERE id = ? AND ? <> 'pending'").run(me.id, data.status);
      destroySession(token);
      return json(res, 401, { error: 'Aðildin er ekki lengur virk.' }, { 'Set-Cookie': sessionCookie('', 0) });
    }
    return json(res, 200, data);
  }

  // Leaving the club. Password again, because it cannot be undone from here:
  // off the roll at once, the login and the application are deleted, and the
  // board is told. Attendance and results stay with the dashboard's player.
  if (path === '/api/ursogn' && method === 'POST') {
    const ip = (TRUST_PROXY && req.headers['x-real-ip']) || req.socket.remoteAddress || '?';
    if (throttled(ip)) return json(res, 429, { error: 'Of margar tilraunir. Reyndu aftur eftir smá stund.' });
    const me = sessionMember(cookies(req)[COOKIE]);
    if (!me) return json(res, 401, { error: 'Ekki innskráð(ur).' });
    const b = await readJson(req);
    const m = db.prepare('SELECT id, password_hash FROM members WHERE id = ?').get(me.id);
    if (!verifyPassword(String(b.password ?? ''), m.password_hash)) return json(res, 401, { errors: { password: 'Rangt lykilorð.' } });
    try { await leave(me.email); }
    catch (e) { if (e instanceof Unavailable) return json(res, 503, { error: 'Ekki tókst að ganga frá úrsögninni núna. Reyndu aftur eftir smá stund.' }); throw e; }
    db.prepare('DELETE FROM members WHERE id = ?').run(me.id); // sessions go with it (ON DELETE CASCADE)
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }

  if (path === '/api/eg' && method === 'GET') {
    const me = sessionMember(cookies(req)[COOKIE]);
    return me ? json(res, 200, { member: { ...me, is_admin: !!me.is_admin } }) : json(res, 401, { error: 'Ekki innskráð(ur).' });
  }

  return json(res, 404, { error: 'Fannst ekki.' });
}

/* ── static files ──────────────────────────────────────────────────── */

async function serveFile(req, res, file, status = 200) {
  const full = normalize(join(PUBLIC, file));
  if (!full.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');
  try {
    const s = await stat(full);
    if (!s.isFile()) throw new Error('not a file');
    const ext = extname(full);
    if (ext === '.mp4' || ext === '.webm') return streamMedia(req, res, full, s.size, ext);
    let body = await readFile(full);
    if (ext === '.html') body = body.toString('utf8').replace('<base href="/">', `<base href="${BASE}/">`);
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
    let path = decodeURIComponent(url.pathname);
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

    if (path.startsWith('/api/')) return await api(req, res, path);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');

    if (path === '/felagar' && !sessionMember(cookies(req)[COOKIE])) {
      return send(res, 302, '', { Location: `${BASE}/innskraning?aftur=felagar` });
    }
    if (path === '/innskraning' && sessionMember(cookies(req)[COOKIE])) {
      return send(res, 302, '', { Location: `${BASE}/felagar` });
    }
    if (PAGES[path]) return await serveFile(req, res, PAGES[path]);
    if (path.endsWith('.html')) return await serveFile(req, res, '404.html', 404); // only pretty URLs
    return await serveFile(req, res, path.slice(1));
  } catch (e) {
    const status = e.status ?? 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) json(res, status, { error: status === 500 ? 'Villa kom upp.' : e.message });
  }
});

pruneSessions();
setInterval(pruneSessions, 3_600_000).unref();
server.listen(PORT, HOST, () => console.log(`Spilafélag Vestfjarða → http://localhost:${PORT}`));
