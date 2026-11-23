# Vefur Spilafélags Vestfjarða

Public website for the club: front page, membership application, member login
and a (so far empty) members area. Separate from the board dashboard in
`../spilafelag` — that is the board's private tool, this is what the public sees.

**No dependencies.** Node 24 (`node:http` + `node:sqlite`), plain HTML/CSS/JS.
Nothing to `npm install`.

```bash
export PATH="$HOME/.local/node24/bin:$PATH"   # on the OV box; system Node is 18
npm run dev                                   # → http://localhost:3200 (restarts on change)
```

## Pages

| URL | File | |
|---|---|---|
| `/` | `public/index.html` | front page |
| `/ganga-i-felagid` | `public/ganga-i-felagid.html` | membership application |
| `/innskraning` | `public/innskraning.html` | member login |
| `/felagar` | `public/felagar.html` | members area (server redirects to login if not signed in) |

## Design

Modelled on useorigin.com (fonts/colours read from its CSS): near-black `#0f1011`,
light serif headlines opening on an italic word (Newsreader ≈ Lyon Display),
Inter (≈ Suisse Intl), Roboto Mono uppercase for nav/buttons, frosted floating
nav, full-bleed landscape dissolving into black, tall photo cards with glass
panels. Photos go in `public/img/` (see `img/README.txt`); a drawn fjord stands in.
they enter. Navigating between pages cross-fades via cross-document View
Transitions (Chrome/Edge/Safari; Firefox just navigates normally). All motion
turns off under `prefers-reduced-motion`.

## Membership flow

1. Someone applies at `/ganga-i-felagid` and picks a password → `members.status = 'pending'`.
2. The board approves: `npm run felagar -- samthykkja netfang@daemi.is`
3. They log in with email + password. Pending/rejected accounts cannot log in.

```bash
npm run felagar -- listi            # all applications (or: listi pending)
npm run felagar -- samthykkja <netfang>
npm run felagar -- hafna <netfang>  # also kills their sessions
npm run felagar -- admin <netfang> "Fullt nafn"   # create/reset an admin; password from stdin
```

## Security

scrypt password hashes; session cookie is HttpOnly + SameSite=Lax (+ Secure in
production) and only its SHA-256 is stored; writes must come from the site's own
origin; login is throttled to 10 attempts / 15 min per IP; a honeypot field
catches form bots; strict CSP (scripts from self only).

## Data

`data/vefur.db` (gitignored) — real people's names and emails. Override with
`DB_PATH`. Back up with `VACUUM INTO`, not `cp` (WAL).

## Not done yet

- Hosting / domain.
- Email notifications (to the board on a new application, to the member on approval).
- Members-area content (events, registrations) — could read from the board dashboard later.
- Password reset.
