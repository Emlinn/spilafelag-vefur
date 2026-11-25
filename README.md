# Vefur Spilafélags Vestfjarða

Public website for the club: front page, membership application, member login
and a (so far empty) members area. Separate from the board dashboard in
`../spilafelag` — that is the board's private tool, this is what the public sees.

**No dependencies.** Node 24 (`node:http` + `node:sqlite`), plain HTML/CSS/JS.
Nothing to `npm install`.

## Getting started

Install **Node 24** (https://nodejs.org — check with `node --version`), then:

```bash
git clone git@github.com:Emlinn/spilafelag-vefur.git
cd spilafelag-vefur
npm run dev          # → http://localhost:3200, restarts when you save a file
```

Your local database (`data/vefur.db`) is created on first run and never
committed. To log in locally, apply on the site, then approve yourself:
`npm run felagar -- samthykkja you@example.is`.

Most text and people live in **`public/efni.json`** (board, roadmap, sponsors,
grant) — no code needed. Page copy is in `public/*.html`, styles in
`public/styles.css`. Keep URLs relative (`img/x.jpg`, `api/...`), never
`/img/x.jpg`: the site also runs under `/heimasida/` (see `deploy/README.md`).

**Test copy:** https://stjornbord.emlinn.is/heimasida/ (dashboard login).
Emil updates it from his machine with `deploy/deploy.sh`.

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
Content fades up out of a blur as it scrolls in. Navigating between pages cross-fades via cross-document View
Transitions (Chrome/Edge/Safari; Firefox just navigates normally). All motion
turns off under `prefers-reduced-motion`.

## Editing the front page — `public/efni.json`

Board, grant and sponsors are read from `public/efni.json`; edit it and reload,
no code. Images go in `public/img/stjorn/` and `public/img/bakhjarlar/` and are
referenced as `/img/...`. Empty values are not shown.

- `stjorn` — name, role, photo, a short line for the card (`texti`), a bio (`um`,
  blank line = new paragraph) and favourite games (`uppahaldsspil`, a list).
  Cards with a bio open it in a dialog; no photo → italic initials.
- `styrkir` — grants. Uppbyggingarsjóður Vestfjarða 2027 is in. Its 2027 rules
  (§10) require crediting **Sóknaráætlun Vestfjarða** in publicity, hence the
  `studningur` line on the card and in the footer. Put the official logo in
  `img/bakhjarlar/` and set `merki`; until then the card shows the year.
- `bakhjarlar` — sponsors, linked with `rel="sponsored"`. The one marked
  `ljosmyndari_forsidu: true` also gets a photo credit in the hero corner.
  A logo goes in `img/bakhjarlar/` via `merki` and replaces the name, unless
  `syna_nafn: true` (for logos that don't spell the name, e.g. Haukur Sig's Purple Hat).
- `styrkja_netfang` — if set, the "Þitt fyrirtæki?" card becomes a mailto link.
- `framtid` — the roadmap under "Næst á dagskrá". Each item: `heiti`, `stada`
  (e.g. "Í gangi", "Næst", "Síðar" — anything containing "gangi" is lit up), `texti`.
  Move an item to "Í gangi" when that game night starts.
- `samband_netfang` — if set, "Hafðu samband" on the "Brennur þú fyrir ákveðnu
  spili?" card becomes a mailto; otherwise it scrolls to the board.

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
