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
`/img/x.jpg`: the site can also run under a sub-path (`BASE_PATH`), as it did during testing.

**Live:** https://spilvest.is (dashboard: https://stjorn.spilvest.is).
Emil updates it from his machine with `deploy/deploy.sh`.

## Pages

| URL | File | |
|---|---|---|
| `/` | `public/index.html` | front page |
| `/ganga-i-felagid` | `public/ganga-i-felagid.html` | membership application |
| `/innskraning` | `public/innskraning.html` | member login |
| `/felagar` | `public/felagar.html` | members area (server redirects to login if not signed in) |
| `/personuvernd` | `public/personuvernd.html` | privacy statement (linked from the form and footer) |
| `/en`, `/en/join`, `/en/login`, `/en/members`, `/en/privacy` | `public/en/*.html` | English versions of the above |

## Samþykktir (bylaws)

The bylaws are written out on the front page (`#samthykktir`, one `<details>` per
article) in `public/index.html`, with an unofficial English translation in
`public/en/index.html`. The signed copy (kennitölur removed) is
`public/skjol/samthykktir-spilafelag-vestfjarda.pdf`. After any lagabreyting at an
aðalfundur, update all three.

## English

Every page has an English twin under `public/en/`; the header's IS/EN link switches
between them. `site.js` reads `<html lang>`: on English pages it uses English UI
strings and, for any `efni.json` field, its `_en` twin (`heiti_en`, `svar_en`, …)
when there is one. The client sends `X-Lang: en`, so API errors come back in English.
When you change Icelandic copy, change the English page too.

## Fonts and caching

Fonts are self-hosted in `public/fonts/` (latin subset, which covers Icelandic; OFL
licences alongside), so no visitor data goes to Google. Pages request
`styles.css?v=…` and `site.js?v=…`; the version comes from the files' mtimes at
startup, so each deploy busts the one-hour browser cache.

## Design

Modelled on useorigin.com (fonts/colours read from its CSS): near-black `#0f1011`,
light serif headlines opening on an italic word (Newsreader ≈ Lyon Display),
Inter (≈ Suisse Intl), Roboto Mono uppercase for nav/buttons, frosted floating
nav, full-bleed landscape dissolving into black, tall photo cards with glass
panels. Photos go in `public/img/` (see `img/README.txt`); a drawn fjord stands in.
Content fades up out of a blur as it scrolls in. Navigating between pages cross-fades via cross-document View
Transitions (Chrome/Edge/Safari; Firefox just navigates normally). All motion
turns off under `prefers-reduced-motion`.

## Editing content — `public/efni.json`

Events, board, grant, sponsors and félag details are read from `public/efni.json`; edit it and reload,
no code. Images go in `public/img/stjorn/` and `public/img/bakhjarlar/` and are
referenced as `/img/...`. Empty values are not shown.

- `vidburdir` — upcoming events under "Næstu viðburðir": `dags` (YYYY-MM-DD),
  `tegund` (`commander` also puts the date in the Commander strip), `heiti`,
  `klukkan`, `stadur`, optional `texti` and `tengill` (e.g. a Facebook event). Past dates drop off by themselves; the next one also appears in the hero.
  Add the next few dates whenever they're booked.
- `hagnyt` — "Í fyrsta sinn?" questions and answers (`spurning`, `svar`).
- `stjorn` — the board under Um félagið. Name, role, photo, a short line for the card (`texti`), a bio (`um`,
  blank line = new paragraph) and favourite games (`uppahaldsspil`, a list).
  Cards with a bio open it in a dialog; no photo → italic initials.
- `styrkir` — grants. A grant is only shown when `"veittur": true`. The
  Uppbyggingarsjóður Vestfjarða 2027 result is announced 26 Nov 2026; if it
  isn't awarded, set it to `false` before the site goes live. Its 2027 rules (§10) require
  crediting **Sóknaráætlun Vestfjarða** in publicity, hence the `studningur`
  line on the card and in the footer (the footer line also appears only once a
  grant is `veittur`). Logo in `img/bakhjarlar/`, referenced by `merki`.
- `felagsgjald` — the fee sentence shown on the front page and the join page.
  Update it after each aðalfundur.
- `facebook`, `facebook_hopur` — URLs of the félag's Facebook page and the MTG
  Vestfirðir group, linked under the events.
- `bakhjarlar` — sponsors, linked with `rel="sponsored"`. The one marked
  `ljosmyndari_forsidu: true` also gets a photo credit in the hero corner.
  A logo goes in `img/bakhjarlar/` via `merki` and replaces the name, unless
  `syna_nafn: true` (for logos that don't spell the name, e.g. Haukur Sig's Purple Hat).
- `styrkja_netfang` — if set, the "Þitt fyrirtæki?" card becomes a mailto link.
- `kennitala` — shown under Um félagið once filled in.
- `samband_netfang` — if set, "Hafðu samband" on the "Brennur þú fyrir ákveðnu
  spili?" card gets a mailto subject.

## Membership flow

> With the board dashboard connected (production), steps 1–3 happen there:
> the kennitala for the krafa and the Samþykkja button are under Spilarar →
> Umsóknir um aðild. See the next section. The `npm run felagar` commands
> below are for running this site on its own.

Under 4. gr. of the samþykktir, someone is a member once the félagsgjald is paid.

1. Someone applies at `/ganga-i-felagid` with their kennitala and picks a password
   → `members.status = 'pending'`. The kennitala is checksum-validated; under-18s
   (worked out from it) must give a guardian and pay no fee.
2. The board sends a krafa through Landsbankinn (name + kennitala from `listi`;
   rows marked `undir18` get none).
3. Once it's paid (or straight away for under-18s), the board activates:
   `npm run felagar -- samthykkja netfang@daemi.is`
4. They log in with email + password. Pending/rejected accounts cannot log in.

Existing databases get the `kennitala`, `guardian_name` and `guardian_contact`
columns added automatically on start.

```bash
npm run felagar -- listi            # all applications (or: listi pending)
npm run felagar -- samthykkja <netfang>
npm run felagar -- hafna <netfang>  # also kills their sessions
npm run felagar -- admin <netfang> "Fullt nafn"   # create/reset an admin; password from stdin
```

## Membership and the board dashboard

Only members can log in. **Who is a member is decided in the board dashboard**
(stjórnborð, a separate app on the same server), not here:

1. Someone applies at `/ganga-i-felagid`. This site keeps the login (name,
   email, password hash); the application itself (kennitala, phone,
   guardian, interests, message) goes to the dashboard.
2. The board approves it under **Spilarar → Umsóknir um aðild** when the fee
   is paid. That links the application to a player and ticks them onto the
   roll. Every login asks the dashboard again, so unticking a player there
   locks them out (and logs them out the next time they open `/felagar`).
3. `/felagar` shows their attendance, tournament placings and record
   (computed by the dashboard), plus upcoming events from `efni.json`.
4. **Segja mig úr félaginu** (password required) takes effect at once: off
   the roll, login and application deleted, the board sees it under
   Úrsagnir. Their attendance and results stay, as part of other players'
   standings.

The two servers talk over localhost, with a shared key in the
`x-innri-lykill` header (`INNRI_LYKILL`, same value in both env files;
nginx also returns 404 for `/api/innri/` from outside). Code: `adild.js`.

| Dashboard endpoint | Used for |
|---|---|
| `POST /api/innri/umsokn` | new application; 409 `{field}` if email/kennitala exists |
| `GET /api/innri/adild?email=` | `{status: member/pending/declined/inactive/none}` on login |
| `GET /api/innri/yfirlit?email=` | everything on `/felagar` |
| `POST /api/innri/ursogn` | leaving |

**Working on the site without the dashboard:** leave `STJORNBORD_URL` unset
(the default for `npm run dev`). Then this site decides on its own: approve
yourself with `npm run felagar -- samthykkja you@example.is`, and `/felagar`
shows made-up sample numbers (marked "Sýnishorn") so you can still work on it.

## Security

scrypt password hashes; session cookie is HttpOnly + SameSite=Lax (+ Secure in
production) and only its SHA-256 is stored; writes must come from the site's own
origin; login is throttled to 10 attempts / 15 min per IP; a honeypot field
catches form bots; strict CSP (scripts from self only).

## Data

`data/vefur.db` (gitignored) — real people's names, emails and kennitölur. Override with
`DB_PATH`. Back up with `VACUUM INTO`, not `cp` (WAL).

## Not done yet

- Hosting / domain.
- Email notifications (to the board on a new application, to the member on approval).
- Members-area content (events, registrations) — could read from the board dashboard later.
- Password reset (the login page points people to the félag email for now).
