// Board tool for membership applications.
//   npm run felagar -- listi [pending|approved|rejected]
//   npm run felagar -- samthykkja <netfang>
//   npm run felagar -- hafna <netfang>
//   npm run felagar -- admin <netfang> "Fullt nafn"     (password read from stdin)
import { db, hashPassword } from '../db.js';
import { parseKennitala } from '../kennitala.js';
import { createInterface } from 'node:readline/promises';

const [cmd, arg, name] = process.argv.slice(2);

function setStatus(email, status) {
  const r = db.prepare(`UPDATE members SET status = ?, approved_at = CASE WHEN ? = 'approved' THEN datetime('now') ELSE approved_at END WHERE email = ?`)
    .run(status, status, email);
  if (!r.changes) { console.error(`Enginn félagi með netfangið ${email}`); process.exit(1); }
  if (status !== 'approved') db.prepare('DELETE FROM sessions WHERE member_id = (SELECT id FROM members WHERE email = ?)').run(email);
  console.log(`${email} → ${status}`);
}

switch (cmd) {
  case 'listi': {
    const rows = arg
      ? db.prepare('SELECT id, name, kennitala, email, phone, guardian_name, guardian_contact, interests, status, created_at FROM members WHERE status = ? ORDER BY created_at').all(arg)
      : db.prepare('SELECT id, name, kennitala, email, phone, guardian_name, guardian_contact, interests, status, created_at FROM members ORDER BY status, created_at').all();
    // undir18: no félagsgjald, so no krafa to send
    console.table(rows.map(({ guardian_name, guardian_contact, ...r }) => ({
      ...r,
      undir18: (parseKennitala(r.kennitala)?.age ?? 99) < 18 ? 'já' : '',
      forradamadur: guardian_name ? `${guardian_name} (${guardian_contact})` : '',
      interests: JSON.parse(r.interests).join(', '),
    })));
    break;
  }
  case 'samthykkja': setStatus(arg, 'approved'); break;
  case 'hafna': setStatus(arg, 'rejected'); break;
  case 'admin': {
    if (!arg || !name) { console.error('Notkun: npm run felagar -- admin <netfang> "Fullt nafn"'); process.exit(1); }
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const pw = (await rl.question('Lykilorð: ')).trim();
    rl.close();
    if (pw.length < 10) { console.error('Lykilorð þarf að vera minnst 10 stafir.'); process.exit(1); }
    db.prepare(`INSERT INTO members (name, email, password_hash, status, is_admin, approved_at)
                VALUES (?, ?, ?, 'approved', 1, datetime('now'))
                ON CONFLICT(email) DO UPDATE SET name = excluded.name, password_hash = excluded.password_hash,
                  status = 'approved', is_admin = 1, approved_at = COALESCE(members.approved_at, excluded.approved_at)`)
      .run(name, arg.toLowerCase(), hashPassword(pw));
    console.log(`${arg} er stjórnandi.`);
    break;
  }
  default:
    console.log('Skipanir: listi [staða] | samthykkja <netfang> | hafna <netfang> | admin <netfang> "Nafn"');
}
