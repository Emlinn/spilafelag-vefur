// Membership (aðild): who counts as a member, and what a member sees about themselves.
//
// With STJORNBORD_URL set (production), the board dashboard decides. It holds
// the applications, approves them onto players when the fee is paid, and has
// the attendance and tournament results. This site only keeps the login.
// The two talk over localhost with a shared key (INNRI_LYKILL); see
// "Membership and the board dashboard" in README.md for the endpoints.
//
// Without STJORNBORD_URL (local development, no dashboard to hand), this
// site's own members.status decides, approved with `npm run felagar`, and the
// members page shows made-up sample numbers so it can still be styled.

const BASE = (process.env.STJORNBORD_URL ?? '').replace(/\/+$/, '');
const KEY = process.env.INNRI_LYKILL ?? '';
export const REMOTE = BASE !== '';
if (REMOTE && KEY.length < 32) throw new Error('INNRI_LYKILL (32+ characters) must be set together with STJORNBORD_URL');

/** The dashboard did not answer. Callers turn this into a 503, never into "not a member". */
export class Unavailable extends Error {}

async function call(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-innri-lykill': KEY },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    throw new Unavailable(String(e));
  }
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status >= 500) throw new Unavailable(`stjórnborð ${res.status}`);
  return { status: res.status, data };
}

const q = (email) => `?email=${encodeURIComponent(email)}`;
const LOCAL_STATUS = { approved: 'member', pending: 'pending', rejected: 'declined' };

/** Hand a new application to the board. Returns null, or the field that already exists ('email' | 'kennitala'). */
export async function sendApplication(app) {
  if (!REMOTE) return null;
  const { status, data } = await call('/api/innri/umsokn', { method: 'POST', body: app });
  if (status === 409) return data.field ?? 'email';
  if (status !== 201) throw new Unavailable(`umsókn ${status}`);
  return null;
}

/** 'member' | 'pending' | 'declined' | 'inactive' | 'none', plus name and member-since date when a member. */
export async function membership(email, localStatus) {
  if (!REMOTE) return { status: LOCAL_STATUS[localStatus] ?? 'none' };
  const { status, data } = await call('/api/innri/adild' + q(email));
  if (status !== 200) throw new Unavailable(`aðild ${status}`);
  return data;
}

/** Everything the members page shows: membership, attendance, tournaments, totals, upcoming events. */
export async function overview(email, localStatus) {
  if (!REMOTE) return LOCAL_STATUS[localStatus] === 'member' ? SAMPLE : { status: LOCAL_STATUS[localStatus] ?? 'none' };
  const { status, data } = await call('/api/innri/yfirlit' + q(email));
  if (status !== 200) throw new Unavailable(`yfirlit ${status}`);
  return data;
}

/** Leave the club: off the roll at once, application data deleted, board notified. */
export async function leave(email) {
  if (!REMOTE) return;
  const { status } = await call('/api/innri/ursogn', { method: 'POST', body: { email } });
  if (status !== 200 && status !== 404) throw new Unavailable(`úrsögn ${status}`); // 404: nothing on file there
}

// News and upcoming events written in the dashboard (Fréttir, and Viðburðir
// marked "Á heimasíðunni"). Each list is kept for a minute, so a busy page
// doesn't ask the dashboard on every view, and the last good list is served if
// the dashboard stops answering. The site still has efni.json's own entries.
function cachedList(path) {
  let cache = { at: 0, list: [] };
  return async () => {
    if (!REMOTE) return [];
    if (Date.now() - cache.at < 60_000) return cache.list;
    try {
      const { status, data } = await call(path);
      if (status === 200 && Array.isArray(data)) cache = { at: Date.now(), list: data };
      else cache.at = Date.now();
    } catch {
      cache.at = Date.now() - 45_000; // try again in 15 s, not on every request
    }
    return cache.list;
  };
}
export const news = cachedList('/api/innri/frettir');
export const events = cachedList('/api/innri/vidburdir');

/** A news photo from the dashboard: { type, body } or null. Only photos a published post uses are served there. */
export async function newsImage(id) {
  if (!REMOTE) return null;
  try {
    const res = await fetch(`${BASE}/api/innri/frettir/mynd/${id}`, {
      headers: { 'x-innri-lykill': KEY },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!/^image\/(jpeg|png|webp)$/.test(type)) return null;
    return { type, body: Buffer.from(await res.arrayBuffer()) };
  } catch {
    return null;
  }
}

// Local development only. Never shown when the dashboard is connected.
const SAMPLE = {
  status: 'member',
  sample: true,
  sets: [
    { name: 'Nauctis: The Sunken Realm', code: '', release_date: '2027-02-05' },
    { name: 'Kamigawa: Titanbreach', code: '', release_date: '2027-06-04' },
    { name: 'Zhalfir', code: '', release_date: '2027-10-01' },
  ],
  since: '2026-09-04',
  attendance: {
    total: 14,
    this_year: 11,
    recent: [
      { name: 'Commander-kvöld', event_date: '2026-11-19', format: 'Commander', won: false },
      { name: 'Prerelease', event_date: '2026-11-14', format: 'Sealed', won: true },
      { name: 'Commander-kvöld', event_date: '2026-11-05', format: 'Commander', won: false },
      { name: 'Draft-kvöld', event_date: '2026-10-24', format: 'Draft', won: false },
    ],
  },
  tournaments: [
    { name: 'Prerelease', date: '2026-11-14', format: 'Sealed', finished: true, place: 1, players: 18, wins: 4, losses: 0, draws: 0 },
    { name: 'Draft-kvöld', date: '2026-10-24', format: 'Draft', finished: true, place: 5, players: 12, wins: 2, losses: 1, draws: 0 },
    { name: 'Fyrsta mótið', date: '2026-09-27', format: 'Sealed', finished: true, place: 9, players: 16, wins: 1, losses: 2, draws: 1 },
  ],
  totals: { wins: 7, losses: 3, draws: 1, tournaments: 3, tournament_wins: 1, events_won: 1 },
  upcoming: [{ name: 'Prerelease', event_date: '2027-01-16', format: 'Sealed' }],
};
