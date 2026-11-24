// Spilafélag Vestfjarða — public website + member login.
// Zero dependencies: node:http + node:sqlite (Node 24).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import {
  db, hashPassword, verifyPassword, burnTime,
  createSession, sessionMember, destroySession, pruneSessions, SESSION_DAYS,
} from './db.js';

const PORT = Number(process.env.PORT ?? 3200);
const HOST = process.env.HOST ?? '0.0.0.0';
const PROD = process.env.NODE_ENV === 'production';
const PUBLIC = resolve('public');
const COOKIE = 'spv_session';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8',
};

// Pretty URLs → files. /felagar is gated server-side.
const PAGES = {
  '/': 'index.html',
  '/ganga-i-felagid': 'ganga-i-felagid.html',
  '/innskraning': 'innskraning.html',
  '/felagar': 'felagar.html',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' https://fonts.googleapis.com; style-src-attr 'unsafe-inline'; font-src https://fonts.gstatic.com; " +
    "img-src 'self' data:; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
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
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${PROD ? '; Secure' : ''}`;
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
const INTERESTS = new Set(['bordspil', 'safnkortaspil', 'hlutverkaspil', 'mot', 'annad']);
const clean = (v, max) => String(v ?? '').trim().slice(0, max);

/* ── API ───────────────────────────────────────────────────────────── */

async function api(req, res, path) {
  const method = req.method;
  if (method !== 'GET' && !sameOrigin(req)) return json(res, 403, { error: 'Óheimill uppruni.' });

  if (path === '/api/umsokn' && method === 'POST') {
    const b = await readJson(req);
    if (clean(b.website, 200)) return json(res, 200, { ok: true }); // honeypot: bots fill it, people don't see it
    const name = clean(b.name, 120);
    const email = clean(b.email, 200).toLowerCase();
    const phone = clean(b.phone, 40) || null;
    const message = clean(b.message, 2000) || null;
    const interests = (Array.isArray(b.interests) ? b.interests : []).filter((i) => INTERESTS.has(i));
    const password = String(b.password ?? '');

    const errors = {};
    if (name.length < 2) errors.name = 'Skrifaðu fullt nafn.';
    if (!EMAIL_RE.test(email)) errors.email = 'Netfangið lítur ekki rétt út.';
    if (password.length < 10) errors.password = 'Lykilorð þarf að vera minnst 10 stafir.';
    if (!b.consent) errors.consent = 'Þú þarft að samþykkja skilmálana.';
    if (Object.keys(errors).length) return json(res, 422, { errors });

    try {
      db.prepare(`INSERT INTO members (name, email, phone, interests, message, password_hash) VALUES (?,?,?,?,?,?)`)
        .run(name, email, phone, JSON.stringify(interests), message, hashPassword(password));
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return json(res, 409, { errors: { email: 'Umsókn með þessu netfangi er þegar til.' } });
      throw e;
    }
    return json(res, 201, { ok: true });
  }

  if (path === '/api/innskraning' && method === 'POST') {
    const ip = req.socket.remoteAddress ?? '?';
    if (throttled(ip)) return json(res, 429, { error: 'Of margar tilraunir. Reyndu aftur eftir smá stund.' });
    const b = await readJson(req);
    const email = clean(b.email, 200).toLowerCase();
    const password = String(b.password ?? '');
    const m = db.prepare('SELECT id, password_hash, status FROM members WHERE email = ?').get(email);
    if (!m) { burnTime(password); return json(res, 401, { error: 'Rangt netfang eða lykilorð.' }); }
    if (!verifyPassword(password, m.password_hash)) return json(res, 401, { error: 'Rangt netfang eða lykilorð.' });
    if (m.status === 'pending') return json(res, 403, { error: 'Umsóknin þín bíður samþykkis stjórnar. Við látum þig vita.' });
    if (m.status !== 'approved') return json(res, 403, { error: 'Þessi aðgangur er ekki virkur.' });
    const token = createSession(m.id);
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86_400) });
  }

  if (path === '/api/utskraning' && method === 'POST') {
    destroySession(cookies(req)[COOKIE]);
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }

  if (path === '/api/eg' && method === 'GET') {
    const me = sessionMember(cookies(req)[COOKIE]);
    return me ? json(res, 200, { member: { ...me, is_admin: !!me.is_admin } }) : json(res, 401, { error: 'Ekki innskráð(ur).' });
  }

  return json(res, 404, { error: 'Fannst ekki.' });
}

/* ── static files ──────────────────────────────────────────────────── */

async function serveFile(res, file, status = 200) {
  const full = normalize(join(PUBLIC, file));
  if (!full.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');
  try {
    const s = await stat(full);
    if (!s.isFile()) throw new Error('not a file');
    const ext = extname(full);
    send(res, status, await readFile(full), {
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : PROD ? 'public, max-age=3600' : 'no-cache',
    });
  } catch {
    if (file !== '404.html') return serveFile(res, '404.html', 404);
    send(res, 404, 'Fannst ekki');
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let path = decodeURIComponent(url.pathname);
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

    if (path.startsWith('/api/')) return await api(req, res, path);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');

    if (path === '/felagar' && !sessionMember(cookies(req)[COOKIE])) {
      return send(res, 302, '', { Location: '/innskraning?aftur=/felagar' });
    }
    if (path === '/innskraning' && sessionMember(cookies(req)[COOKIE])) {
      return send(res, 302, '', { Location: '/felagar' });
    }
    if (PAGES[path]) return await serveFile(res, PAGES[path]);
    if (path.endsWith('.html')) return await serveFile(res, '404.html', 404); // only pretty URLs
    return await serveFile(res, path.slice(1));
  } catch (e) {
    const status = e.status ?? 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) json(res, status, { error: status === 500 ? 'Villa kom upp.' : e.message });
  }
});

pruneSessions();
setInterval(pruneSessions, 3_600_000).unref();
server.listen(PORT, HOST, () => console.log(`Spilafélag Vestfjarða → http://localhost:${PORT}`));
