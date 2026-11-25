// Icelandic kennitala for a person: DDMMYY-NNCV, C = checksum, V = century (9 = 1900s, 0 = 2000s).
// Returns { kt, age } or null. Company kennitölur (day + 40) are rejected.
// public/site.js has a copy of this for the form; keep the two in step.
export function parseKennitala(raw, now = new Date()) {
  const kt = String(raw ?? '').replace(/[\s-]/g, '');
  if (!/^\d{10}$/.test(kt)) return null;
  const d = [...kt].map(Number);
  const sum = [3, 2, 7, 6, 5, 4, 3, 2].reduce((s, w, i) => s + w * d[i], 0);
  const check = (11 - (sum % 11)) % 11;
  if (check === 10 || check !== d[8]) return null;
  const century = { 9: 1900, 0: 2000 }[d[9]]; // 8 = 1800s: nobody alive
  const day = Number(kt.slice(0, 2)), month = Number(kt.slice(2, 4));
  if (century == null || day < 1 || day > 31 || month < 1 || month > 12) return null;
  const year = century + Number(kt.slice(4, 6));
  const born = new Date(Date.UTC(year, month - 1, day));
  if (born.getUTCDate() !== day) return null;
  let age = now.getUTCFullYear() - year;
  if (now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day)) age--;
  if (age < 0) return null;
  return { kt, age };
}
