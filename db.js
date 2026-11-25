import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

const DB_PATH = resolve(process.env.DB_PATH ?? 'data/vefur.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA foreign_keys = ON;

  -- One row per person who has applied. Login works only once status = 'approved'.
  CREATE TABLE IF NOT EXISTS members (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    kennitala     TEXT,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone         TEXT,
    interests     TEXT NOT NULL DEFAULT '[]',
    message       TEXT,
    guardian_name    TEXT,   -- only for applicants under 18
    guardian_contact TEXT,
    password_hash TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    is_admin      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    approved_at   TEXT
  );

  -- The cookie holds a random token; only its SHA-256 is stored.
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
`);

// Databases created before kennitala/guardian existed get the columns added in place.
const cols = new Set(db.prepare('PRAGMA table_info(members)').all().map((c) => c.name));
for (const col of ['kennitala', 'guardian_name', 'guardian_contact']) {
  if (!cols.has(col)) db.exec(`ALTER TABLE members ADD COLUMN ${col} TEXT`);
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS members_kennitala ON members (kennitala) WHERE kennitala IS NOT NULL');

/* ── passwords ─────────────────────────────────────────────────────── */

export function hashPassword(pw) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(pw, salt, 64).toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(pw, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Verifying against a throwaway hash makes "no such email" take as long as "wrong password".
const DUMMY = hashPassword(randomBytes(24).toString('hex'));
export const burnTime = (pw) => verifyPassword(pw, DUMMY);

/* ── sessions ──────────────────────────────────────────────────────── */

export const SESSION_DAYS = 30;
const sha = (s) => createHash('sha256').update(s).digest('hex');

export function createSession(memberId) {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, member_id, expires_at) VALUES (?,?,?)').run(sha(token), memberId, expires);
  return token;
}

export function sessionMember(token) {
  if (!token) return null;
  return db.prepare(`
    SELECT m.id, m.name, m.email, m.is_admin, m.created_at, m.approved_at
      FROM sessions s JOIN members m ON m.id = s.member_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND m.status = 'approved'
  `).get(sha(token), new Date().toISOString()) ?? null;
}

export function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
}

export function pruneSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
}
