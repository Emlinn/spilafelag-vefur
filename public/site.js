// Scroll tone, reveal-on-scroll, header state, and the two forms.
// One small script for every page; each part checks whether it applies.

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Pages under /en/ have <html lang="en">. L() picks the string for the page's language;
// tx() reads an efni.json field, preferring its "_en" twin on English pages.
const EN = document.documentElement.lang === 'en';
const L = (is, en) => (EN ? en : is);
const tx = (o, k) => (EN && o?.[`${k}_en`]) || o?.[k];

/* ── reveal on scroll ── */
const revealIO = (reduced || !('IntersectionObserver' in window)) ? null : new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); revealIO.unobserve(e.target); }
}, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });
function watchReveals(root = document) {
  root.querySelectorAll('.reveal:not(.in)').forEach((el) => revealIO ? revealIO.observe(el) : el.classList.add('in'));
}
watchReveals();

/* ── skip link: moves focus into the page itself, whatever the URL (also on the 404 page) ── */
document.querySelector('.skip-link')?.addEventListener('click', (e) => {
  const main = document.getElementById('efni');
  if (!main) return;
  e.preventDefault();
  main.tabIndex = -1;
  main.focus();
  main.scrollIntoView();
});

/* ── header turns to frosted glass once you leave the top ── */
const header = document.querySelector('.site-header');
const onScroll = () => header?.classList.toggle('scrolled', scrollY > 16);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* ── phone menu: on narrow screens the section links and Innskráning/EN fold into one button ── */
const navCenter = header?.querySelector('.nav-center');
const navRight = header?.querySelector('.nav-right');
if (navCenter && navRight) {
  navCenter.id = 'valmynd';
  [...navRight.querySelectorAll(':scope > .nav-link.plain')].sort((a) => (a.hasAttribute('lang') ? 1 : -1)).forEach((a) => { // language last
    const copy = a.cloneNode(true);
    copy.classList.remove('plain', 'lang-switch');
    copy.classList.add('m-only');
    if (copy.hasAttribute('lang')) { copy.textContent = copy.getAttribute('aria-label'); copy.removeAttribute('aria-label'); } // "EN" → "English"
    navCenter.append(copy);
  });
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nav-link menu-btn';
  btn.setAttribute('aria-controls', 'valmynd');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2 4.5h12M2 8h12M2 11.5h12"/></svg><span>${L('Valmynd', 'Menu')}</span>`;
  navRight.append(btn);
  const setOpen = (open) => { header.classList.toggle('menu-open', open); btn.setAttribute('aria-expanded', String(open)); };
  btn.addEventListener('click', () => {
    const open = !header.classList.contains('menu-open');
    setOpen(open);
    if (open) navCenter.querySelector('a')?.focus(); // keyboard and screen-reader users land in the menu
  });
  // Tabbing out of the header closes the menu, so it never hangs open behind the focus.
  header.addEventListener('focusout', (e) => { if (e.relatedTarget && !header.contains(e.relatedTarget)) setOpen(false); });
  navCenter.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && header.classList.contains('menu-open')) { setOpen(false); btn.focus(); } });
  document.addEventListener('click', (e) => { if (!header.contains(e.target)) setOpen(false); });
}

/* ── hero: the copy drifts up and fades, the landscape sinks slower (parallax) ── */
const hero = document.querySelector('.hero');
if (hero && !reduced) {
  const content = hero.querySelector('.hero-content');
  const media = hero.querySelector('.hero-media');
  let ticking = false;
  const update = () => {
    ticking = false;
    const p = Math.min(Math.max(scrollY / hero.offsetHeight, 0), 1);
    content.style.transform = `translateY(${p * -80}px) scale(${1 - p * 0.04})`;
    content.style.opacity = String(1 - p * 1.4);
    media.style.translate = `0 ${p * 22}%`;
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
}

/* ── hero video: loaded only on wider screens, when motion is welcome and data isn't scarce
   (on a phone the 6 MB file costs more than it adds).
   Hidden until it actually plays, so a missing file leaves the photo/fjord. ── */
const heroVideo = document.querySelector('video.hero-video[data-src]');
if (heroVideo && !reduced && !navigator.connection?.saveData && matchMedia('(min-width: 768px)').matches) {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'video-toggle';
  const label = () => {
    const paused = heroVideo.paused;
    toggle.setAttribute('aria-label', paused ? L('Spila myndband', 'Play video') : L('Stöðva myndband', 'Pause video'));
    toggle.innerHTML = paused
      ? '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5 3.5v9l7.5-4.5z"/></svg>'
      : '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4.5 3.5h2.5v9H4.5zM9 3.5h2.5v9H9z"/></svg>';
  };
  toggle.addEventListener('click', () => { heroVideo.paused ? heroVideo.play().catch(() => {}) : heroVideo.pause(); });
  heroVideo.addEventListener('play', label);
  heroVideo.addEventListener('pause', label);
  heroVideo.addEventListener('playing', () => { heroVideo.classList.add('on'); label(); heroVideo.closest('.hero')?.append(toggle); }, { once: true });
  heroVideo.src = heroVideo.dataset.src;
  heroVideo.play().catch(() => {});
}

/* ── helpers ── */
async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lang': EN ? 'en' : 'is' },
    body: JSON.stringify(body), credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, data };
}

// Each field's hint and error line get ids and are tied to the input with
// aria-describedby, so a screen reader reads them with the field.
let fieldIds = 0;
function wireFields(form) {
  form.querySelectorAll('.field').forEach((f) => {
    const input = f.querySelector(':scope > input, :scope > textarea, :scope > label > input');
    if (!input) return;
    const ids = [...f.querySelectorAll(':scope > .hint, :scope > .err')].map((n) => (n.id ||= `f${++fieldIds}`));
    if (ids.length) input.setAttribute('aria-describedby', ids.join(' '));
  });
}
document.querySelectorAll('form').forEach(wireFields);

// Shows every error at once; the summary goes in the form's alert so it is announced.
function showFieldErrors(form, errors = {}) {
  form.querySelectorAll('.field').forEach((f) => {
    f.classList.remove('invalid');
    const e = f.querySelector(':scope > .err'); if (e) e.textContent = '';
  });
  form.querySelectorAll('[aria-invalid]').forEach((n) => n.removeAttribute('aria-invalid'));
  let first = null, count = 0;
  for (const [name, msg] of Object.entries(errors)) {
    const input = form.elements[name];
    const ctl = input?.length && !input.tagName ? input[0] : input;
    const field = ctl?.closest('.field');
    if (!field) continue;
    count++;
    field.classList.add('invalid');
    ctl.setAttribute('aria-invalid', 'true');
    const e = field.querySelector(':scope > .err'); if (e) e.textContent = msg;
    first ??= ctl;
  }
  const summary = form.querySelector('.alert');
  if (summary && count > 1) {
    summary.textContent = L(`Það þarf að laga ${count} atriði hér að ofan.`, `${count} things above need fixing.`);
    summary.hidden = false;
  } else if (summary && !count) summary.hidden = true;
  first?.focus();
}

/* ── kennitala: checksum + birth date (same rules as the server) ── */
function parseKennitala(raw) {
  const kt = String(raw ?? '').replace(/[\s-]/g, '');
  if (!/^\d{10}$/.test(kt)) return null;
  const d = [...kt].map(Number);
  const sum = [3, 2, 7, 6, 5, 4, 3, 2].reduce((s, w, i) => s + w * d[i], 0);
  const check = (11 - (sum % 11)) % 11;
  if (check === 10 || check !== d[8]) return null;
  const century = { 9: 1900, 0: 2000 }[d[9]]; // 8 = 1800s: nobody alive
  const day = Number(kt.slice(0, 2)), month = Number(kt.slice(2, 4));
  if (century == null || day < 1 || day > 31 || month < 1 || month > 12) return null; // day > 31 = company
  const year = century + Number(kt.slice(4, 6));
  const born = new Date(Date.UTC(year, month - 1, day));
  if (born.getUTCDate() !== day) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - year;
  if (now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day)) age--;
  if (age < 0) return null;
  return { kt, age };
}

/* ── membership application ── */
const signup = document.getElementById('umsokn');
if (signup) {
  const alert = signup.querySelector('.alert');
  const guardian = document.getElementById('forradamadur');
  const ktInput = signup.elements.kennitala;
  const isMinor = () => { const p = parseKennitala(ktInput.value); return !!p && p.age < 18; };
  // Shown in the HTML so it works without JavaScript; with the script it only appears for under-18s.
  guardian.hidden = !isMinor();
  ktInput.addEventListener('input', () => { guardian.hidden = !isMinor(); });
  signup.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    alert.hidden = true;
    const f = signup.elements;
    const body = {
      name: f.name.value, kennitala: f.kennitala.value, email: f.email.value, phone: f.phone.value,
      guardian_name: isMinor() ? f.guardian_name.value : '', guardian_contact: isMinor() ? f.guardian_contact.value : '',
      message: f.message.value, password: f.password.value, consent: f.consent.checked,
      website: f.website.value,
    };
    // Every field is checked in one go, with the same rules as the server.
    const errors = {};
    if (body.name.trim().length < 2) errors.name = L('Skrifaðu fullt nafn.', 'Please enter your full name.');
    if (!parseKennitala(body.kennitala)) errors.kennitala = body.kennitala.trim()
      ? L('Kennitalan er ekki gild.', 'That kennitala is not valid.')
      : L('Sláðu inn kennitölu.', 'Please enter your kennitala.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) errors.email = body.email.trim()
      ? L('Athugaðu netfangið.', "That email address doesn't look right.")
      : L('Sláðu inn netfang.', 'Please enter your email.');
    if (isMinor()) {
      if (body.guardian_name.trim().length < 2) errors.guardian_name = L('Skráðu nafn forráðamanns.', "Please enter a parent or guardian's name.");
      if (body.guardian_contact.trim().length < 5) errors.guardian_contact = L('Skráðu síma eða netfang forráðamanns.', "Please enter a parent or guardian's phone or email.");
    }
    if (body.password.length < 10) errors.password = L('Lykilorðið þarf að vera minnst 10 stafir.', 'The password must be at least 10 characters.');
    else if (body.password !== f.password2.value) errors.password2 = L('Lykilorðin eru ekki eins.', "The passwords don't match.");
    if (!body.consent) errors.consent = L('Hakaðu við hér til að staðfesta umsóknina.', 'Tick this box to confirm your application.');
    showFieldErrors(signup, errors);
    if (Object.keys(errors).length) return;

    const btn = signup.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const r = await post('api/umsokn', body);
      if (r.ok) {
        const done = document.getElementById('umsokn-takk');
        const minor = isMinor(); // no payment request for under-18s, so they get a different next step
        done.querySelectorAll('[data-adult]').forEach((n) => { n.hidden = minor; });
        done.querySelectorAll('[data-minor]').forEach((n) => { n.hidden = !minor; });
        const swap = () => { signup.hidden = true; done.hidden = false; done.querySelector('h2').focus(); };
        document.startViewTransition && !reduced ? document.startViewTransition(swap) : swap();
        return;
      }
      if (r.data.errors) { showFieldErrors(signup, r.data.errors); if (Object.keys(r.data.errors).length === 1) { alert.hidden = true; } }
      else { alert.textContent = r.data.error ?? L('Eitthvað fór úrskeiðis. Reyndu aftur.', 'Something went wrong. Please try again.'); alert.hidden = false; alert.tabIndex = -1; alert.focus(); }
    } catch {
      alert.textContent = L('Ekki náðist samband. Athugaðu nettenginguna.', "Couldn't connect. Check your internet connection."); alert.hidden = false; alert.tabIndex = -1; alert.focus();
    } finally { btn.disabled = false; }
  });
}

/* ── login ── */
const login = document.getElementById('innskraning');
if (login) {
  const alert = login.querySelector('.alert');
  login.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    alert.hidden = true;
    const btn = login.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const r = await post('api/innskraning', { email: login.elements.email.value, password: login.elements.password.value });
      if (r.ok) {
        const back = new URLSearchParams(location.search).get('aftur');
        location.href = /^(en\/)?[a-z-]+$/.test(back ?? '') ? back : L('felagar', 'en/members'); // a bare page name only — never an outside URL
        return;
      }
      alert.textContent = r.data.error ?? L('Innskráning tókst ekki.', 'Sign-in failed.'); alert.hidden = false; alert.tabIndex = -1; alert.focus();
    } catch {
      alert.textContent = L('Ekki náðist samband. Athugaðu nettenginguna.', "Couldn't connect. Check your internet connection."); alert.hidden = false; alert.tabIndex = -1; alert.focus();
    } finally { btn.disabled = false; }
  });
}

/* ── member area ── */
const memberName = document.getElementById('member-name');
if (memberName) {
  const $ = (k) => document.querySelector(`[data-m="${k}"]`);
  const toLogin = () => { location.href = L('innskraning?aftur=felagar', 'en/login?aftur=en/members'); };
  // Month names spelled out: not every browser ships Icelandic date formats.
  const MON = EN
    ? ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    : ['janúar', 'febrúar', 'mars', 'apríl', 'maí', 'júní', 'júlí', 'ágúst', 'september', 'október', 'nóvember', 'desember'];
  const ymd = (iso) => iso.slice(0, 10).split('-').map(Number);
  const fmt = (iso) => { const [y, m, d] = ymd(iso); return EN ? `${d} ${MON[m - 1]} ${y}` : `${d}. ${MON[m - 1]} ${y}`; };
  const short = (iso) => { const [, m, d] = ymd(iso); return EN ? `${d} ${monAbbr(m - 1)}` : `${d}. ${monAbbr(m - 1)}`; };
  const showError = (msg) => { const e = document.getElementById('m-error'); e.textContent = msg; e.hidden = false; };

  fetch('api/eg', { credentials: 'same-origin' }).then(async (res) => {
    if (!res.ok) return toLogin();
    const { member } = await res.json();
    memberName.textContent = member.name.split(' ')[0];
  });

  Promise.all([
    fetch('api/yfirlit', { credentials: 'same-origin', headers: { 'X-Lang': EN ? 'en' : 'is' } }),
    fetch('efni.json', { cache: 'no-cache' }).then((r) => r.json()).catch(() => ({})),
  ]).then(async ([res, efni]) => {
    if (res.status === 401) return toLogin(); // not logged in, or no longer a member
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return showError(d.error ?? L('Ekki tókst að sækja upplýsingarnar núna.', "Couldn't load your information right now."));
    renderMember(d, efni);
  }).catch(() => showError(L('Ekki tókst að sækja upplýsingarnar núna.', "Couldn't load your information right now.")));

  function renderMember(d, efni) {
    if (d.sample) document.getElementById('m-sample').hidden = false;
    if (d.since) document.getElementById('member-since').textContent = fmt(d.since);
    else document.getElementById('member-sub').hidden = true;

    const t = d.totals ?? {};
    $('this_year').textContent = d.attendance?.this_year ?? 0;
    $('total').textContent = d.attendance?.total ?? 0;
    $('record').textContent = `${t.wins ?? 0}–${t.losses ?? 0}–${t.draws ?? 0}`;
    $('tournament_wins').textContent = t.tournament_wins ?? 0;
    $('tournaments').textContent = t.tournaments ? L(`af ${t.tournaments} ${t.tournaments % 10 === 1 && t.tournaments % 100 !== 11 ? 'móti' : 'mótum'}`, `of ${t.tournaments} ${t.tournaments === 1 ? 'tournament' : 'tournaments'}`) : '';

    // Upcoming sets from the board's Útgáfur list, with a countdown.
    const today0 = Date.parse(new Date().toLocaleDateString('sv-SE', { timeZone: 'Atlantic/Reykjavik' }) + 'T00:00:00Z');
    const daysTo = (iso) => Math.round((Date.parse(iso.slice(0, 10) + 'T00:00:00Z') - today0) / 86_400_000);
    // Icelandic: 1, 21, 31… dagur; everything else dagar (11 is dagar).
    const dagar = (n) => L(n % 10 === 1 && n % 100 !== 11 ? 'dagur' : 'dagar', n === 1 ? 'day' : 'days');
    const sets = d.sets ?? [];
    $('sets-empty').hidden = sets.length > 0;
    $('sets').hidden = sets.length === 0;
    $('sets').replaceChildren(...sets.map((x, i) => {
      const n = daysTo(x.release_date);
      return el('li', { class: i === 0 ? 'next' : null },
        el('span', { class: 'count' }, n <= 0 ? L('Í dag', 'Today') : String(n), n > 0 ? el('small', {}, dagar(n)) : null),
        el('span', { class: 'name' }, x.name),
        el('span', { class: 'date' }, fmt(x.release_date)));
    }));

    const mot = d.tournaments ?? [];
    $('mot-empty').hidden = mot.length > 0;
    $('mot').hidden = mot.length === 0;
    $('mot').tBodies[0].replaceChildren(...mot.map((m) => el('tr', { class: m.place === 1 && m.finished ? 'first' : null },
      el('td', {}, short(m.date)),
      el('td', {}, m.name, m.format ? el('small', {}, m.format) : null),
      el('td', {}, m.finished ? L(`${m.place}. af ${m.players}`, `${m.place} of ${m.players}`) : L('Í gangi', 'In progress')),
      el('td', { class: 'num' }, `${m.wins}–${m.losses}–${m.draws}`))));

    const recent = d.attendance?.recent ?? [];
    $('maeting-empty').hidden = recent.length > 0;
    $('maeting').replaceChildren(...recent.map((e) => el('li', {},
      el('span', { class: 'when' }, short(e.event_date)),
      el('span', {}, e.name, e.won ? el('b', { class: 'won' }, L('Sigur', 'Won')) : null))));

    // The club's own schedule (efni.json) plus events the board has opened for sign-up.
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Atlantic/Reykjavik' });
    const seen = new Set();
    const next = [
      ...(efni.vidburdir ?? []).filter((v) => v.heiti && /^\d{4}-\d{2}-\d{2}$/.test(v.dags ?? ''))
        .map((v) => ({ date: v.dags, name: tx(v, 'heiti'), meta: [v.klukkan, tx(v, 'stadur')].filter(Boolean).join(' · ') })),
      ...(d.upcoming ?? []).map((u) => ({ date: u.event_date, name: u.name, meta: u.format })),
    ].filter((v) => v.date >= today && !seen.has(v.date + v.name) && seen.add(v.date + v.name))
      .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
    $('framundan-empty').hidden = next.length > 0;
    $('framundan').replaceChildren(...next.map((v) => el('li', {},
      el('span', { class: 'when' }, short(v.date)),
      el('span', {}, v.name, v.meta ? el('small', {}, v.meta) : null))));
  }

  document.getElementById('utskraning')?.addEventListener('click', async () => {
    await post('api/utskraning', {});
    location.href = L('./', 'en');
  });

  // Leaving: a dialog that asks for the password before anything happens.
  const dlg = document.getElementById('ursogn');
  const form = document.getElementById('ursogn-form');
  if (dlg && form) {
    const alertBox = document.getElementById('ursogn-error');
    document.getElementById('ursogn-opna').addEventListener('click', () => {
      form.reset(); showFieldErrors(form); alertBox.hidden = true;
      dlg.showModal(); form.elements.password.focus();
    });
    document.getElementById('ursogn-haetta').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      alertBox.hidden = true;
      if (!form.elements.password.value) return showFieldErrors(form, { password: L('Sláðu inn lykilorðið.', 'Enter your password.') });
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        const { ok, data } = await post('api/ursogn', { password: form.elements.password.value });
        if (ok) { location.href = L('./', 'en'); return; }
        if (data.errors) showFieldErrors(form, data.errors);
        else { alertBox.textContent = data.error ?? L('Eitthvað fór úrskeiðis.', 'Something went wrong.'); alertBox.hidden = false; }
      } finally { btn.disabled = false; }
    });
  }
}

/* ── front-page content from efni.json (board, grant, sponsors) ── */
const slots = document.querySelectorAll('[data-render]');
if (slots.length) {
  // News written in the board's dashboard comes from api/frettir; only pages that show news ask for it.
  const wantsNews = !!document.querySelector('[data-render="frettir"], [data-render="frettir-nyjast"]');
  const boardNews = wantsNews
    ? fetch('api/frettir', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : [])).catch(() => [])
    : Promise.resolve([]);
  fetch('efni.json', { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error(`efni.json: HTTP ${r.status}`); return r.json(); })
    .then(async (raw) => {
      const extra = await boardNews;
      if (Array.isArray(extra) && extra.length && raw && typeof raw === 'object') {
        // A dashboard post wins over an efni.json post with the same slod.
        const taken = new Set(extra.map((n) => n && n.slod));
        raw.frettir = [...extra, ...(Array.isArray(raw.frettir) ? raw.frettir : []).filter((n) => !taken.has(n && n.slod))];
      }
      return raw;
    })
    .then((raw) => renderContent(cleanContent(raw)))
    .catch((e) => {
      // A typo in efni.json shouldn't blank the page silently: say so in the console and show the fallbacks.
      console.error('Gat ekki lesið efni.json / could not read efni.json:', e);
      document.querySelectorAll('.dates-empty').forEach((n) => n.removeAttribute('hidden'));
    });
}

// efni.json is edited by hand, so anything of the wrong shape is dropped here rather than breaking a whole section.
function cleanContent(raw) {
  const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  if (!isObj(raw)) return {};
  const plain = (v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
  const LISTS = ['vidburdir', 'stjorn', 'hagnyt', 'styrkir', 'bakhjarlar', 'frettir'];
  const BLOCKS = ['efni', 'efni_en']; // news bodies: lists of paragraphs and blocks
  const block = (b) => {
    if (typeof b === 'string') return b;
    if (!isObj(b)) return null;
    const out = {};
    for (const [k, v] of Object.entries(b)) {
      if (typeof v === 'string') out[k] = v;
      else if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === 'string' || typeof x === 'number').map(String);
    }
    return out;
  };
  const item = (o) => {
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      if (plain(v)) out[k] = v;
      else if (BLOCKS.includes(k) && Array.isArray(v)) out[k] = v.map(block).filter((b) => b !== null);
    }
    return out;
  };
  const c = {};
  for (const [k, v] of Object.entries(raw)) {
    if (LISTS.includes(k)) c[k] = Array.isArray(v) ? v.filter(isObj).map(item) : [];
    else if (plain(v)) c[k] = v;
  }
  return c;
}

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) n.setAttribute(k, v);
  for (const k of kids) if (k != null && k !== '') n.append(k);
  return n;
}
const safeUrl = (u) => { if (typeof u !== 'string' || !u.trim()) return null; try { const x = new URL(u, location.origin); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };
// efni.json may say /img/x or img/x; either way it becomes img/x, relative to <base>
const localImg = (p) => {
  if (typeof p !== 'string') return null;
  if (/^api\/frettir\/mynd\/\d+$/.test(p)) return p; // a news photo from the board's dashboard
  return /^\/?img\/[\w./-]+$/.test(p) && !p.includes('..') ? p.replace(/^\//, '') : null;
};
const EXT = '<svg class="ext" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 11 11 5M6 5h5v5"/></svg>';
const svg = (html) => { const t = document.createElement('template'); t.innerHTML = html; return t.content.firstChild; };
// Month abbreviations: Icelandic "maí" has none and "ágúst" is "ág.".
const MON_ABBR_IS = ['jan.', 'feb.', 'mar.', 'apr.', 'maí', 'jún.', 'júl.', 'ág.', 'sept.', 'okt.', 'nóv.', 'des.'];
const MON_ABBR_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monAbbr = (i) => (EN ? MON_ABBR_EN : MON_ABBR_IS)[i];
const initials = (name) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('');

function renderContent(c) {
  const slot = (k) => document.querySelector(`[data-render="${k}"]`);

  const board = slot('stjorn');
  if (board) {
    (c.stjorn ?? []).filter((p) => p.nafn).forEach((p, i) => {
      const hasBio = !!(tx(p, 'um') ?? '').trim();
      const more = hasBio ? (() => {
        const b = el('button', { class: 'more', type: 'button', 'aria-haspopup': 'dialog' }, L('Lesa meira', 'Read more'), el('span', { class: 'sr-only' }, `: ${p.nafn}`));
        b.append(svg('<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2.5 8h11M9 3.5 13.5 8 9 12.5"/></svg>'));
        b.addEventListener('click', () => openBio(p));
        return b;
      })() : null;
      const card = el('article', { class: `person reveal${hasBio ? ' has-bio' : ''}`, style: `--d:${i * 0.1}s` },
        portrait(p),
        el('div', { class: 'info' },
          el('div', { class: 'role' }, tx(p, 'hlutverk') ?? ''),
          el('h4', { class: 'name' }, p.nafn),
          tx(p, 'texti') ? el('p', { class: 'text' }, tx(p, 'texti')) : null,
          more));
      // The whole card stays clickable with a mouse; the button is what keyboards and screen readers use.
      if (more) card.addEventListener('click', (e) => { if (!e.target.closest('button')) more.click(); });
      board.append(card);
    });
  }

  // upcoming events: past dates drop off by themselves; the next one also goes in the hero
  const MONTHS = ['janúar', 'febrúar', 'mars', 'apríl', 'maí', 'júní', 'júlí', 'ágúst', 'september', 'október', 'nóvember', 'desember'];
  const DAYS = ['sunnudagur', 'mánudagur', 'þriðjudagur', 'miðvikudagur', 'fimmtudagur', 'föstudagur', 'laugardagur'];
  const DAYS_ACC = ['sunnudaginn', 'mánudaginn', 'þriðjudaginn', 'miðvikudaginn', 'fimmtudaginn', 'föstudaginn', 'laugardaginn']; // "Næst: … fimmtudaginn 3. desember"
  const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Atlantic/Reykjavik' }); // YYYY-MM-DD
  const upcoming = (c.vidburdir ?? [])
    .filter((v) => v.heiti && /^\d{4}-\d{2}-\d{2}$/.test(v.dags ?? '') && v.dags >= today)
    .sort((x, y) => x.dags.localeCompare(y.dags))
    .slice(0, 6);
  const parts = (iso) => { const d = new Date(iso + 'T12:00:00Z'); return EN
    ? { day: d.getUTCDate(), m: d.getUTCMonth(), month: MONTHS_EN[d.getUTCMonth()], weekday: DAYS_EN[d.getUTCDay()], weekdayAcc: DAYS_EN[d.getUTCDay()] }
    : { day: d.getUTCDate(), m: d.getUTCMonth(), month: MONTHS[d.getUTCMonth()], weekday: DAYS[d.getUTCDay()], weekdayAcc: DAYS_ACC[d.getUTCDay()] }; };
  const dayNum = (p) => (EN ? `${p.day}` : `${p.day}.`); // "3" in English, "3." in Icelandic

  const dates = slot('vidburdir');
  if (dates) {
    upcoming.forEach((v, i) => {
      const p = parts(v.dags), url = (v.tengill ?? '').trim() ? safeUrl(v.tengill.trim()) : null;
      const title = el('h4', {}, url ? el('a', { href: url, target: '_blank', rel: 'noopener' }, tx(v, 'heiti')) : tx(v, 'heiti'));
      dates.append(el('li', {},
        el('div', { class: 'day' }, dayNum(p), el('small', {}, monAbbr(p.m))),
        el('div', {}, title,
          el('p', { class: 'meta' }, [p.weekday, v.klukkan, tx(v, 'stadur')].filter(Boolean).join(' · ')),
          tx(v, 'texti') ? el('p', { class: 'note' }, tx(v, 'texti')) : null)));
    });
    if (!upcoming.length) document.querySelector('.dates-empty')?.removeAttribute('hidden');
  }
  // news: newest first; the full list on /frettir, and the latest post on the front page while it's fresh
  const news = (c.frettir ?? [])
    .filter((n) => tx(n, 'titill') && /^\d{4}-\d{2}-\d{2}$/.test(n.dags ?? '') && n.dags <= today)
    .sort((x, y) => y.dags.localeCompare(x.dags));
  const longDate = (iso) => { const p = parts(iso), y = iso.slice(0, 4); return EN ? `${p.day} ${p.month} ${y}` : `${p.day}. ${p.month} ${y}`; };
  const slug = (n) => (/^[a-z0-9-]+$/.test(n.slod ?? '') ? n.slod : null);
  const newsHref = EN ? 'en/news' : 'frettir';
  const newsList = slot('frettir');
  if (newsList) {
    if (!news.length) newsList.append(el('p', { class: 'sub' }, L('Engar fréttir enn.', 'No news yet.')));
    for (const n of news) {
      const body = el('div', { class: 'news-body' });
      const blocks = EN && Array.isArray(n.efni_en) ? n.efni_en : n.efni;
      for (const b of Array.isArray(blocks) ? blocks : []) {
        if (typeof b === 'string') body.append(el('p', {}, b));
        else if (b && typeof b.millifyrirsogn === 'string') body.append(el('h3', {}, b.millifyrirsogn));
        else if (b && typeof b.hnappur === 'string' && /^(?:[a-z][a-z0-9/-]*)?(?:#[a-z0-9-]+)?$/.test(b.href ?? '') && b.href) {
          const a = el('a', { class: 'btn', href: b.href }, b.hnappur);
          a.append(svg('<svg class="arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2.5 8h11M9 3.5 13.5 8 9 12.5"/></svg>'));
          body.append(el('p', { class: 'news-action' }, a));
        } else if (b && Array.isArray(b.listi)) {
          if (b.titill) body.append(el('h3', {}, b.titill));
          const ol = el('ol', { class: 'news-list' });
          b.listi.forEach((x) => ol.append(el('li', {}, String(x))));
          body.append(ol);
        } else if (b && Array.isArray(b.spil)) {
          const pre = el('pre', { class: 'decklist' }, b.spil.join('\n'));
          body.append(el('details', { class: 'deck' }, el('summary', {}, b.stokkur || L('Stokkurinn', 'The deck')), pre));
        }
      }
      const img = localImg(n.mynd);
      const time = el('time', { datetime: n.dags }, longDate(n.dags));
      newsList.append(el('article', { class: 'news-post', id: slug(n) },
        el('p', { class: 'news-date' }, time),
        el('h2', {}, tx(n, 'titill')),
        img ? el('figure', { class: 'news-figure' },
          el('img', { class: 'news-img', src: img, alt: tx(n, 'mynd_alt') ?? '', loading: 'lazy', decoding: 'async' }),
          tx(n, 'mynd_texti') ? el('figcaption', {}, tx(n, 'mynd_texti')) : null) : null,
        body));
    }
    // a link to a post (frettir#slod) lands on it once it exists
    if (location.hash) {
      const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (target) { target.tabIndex = -1; target.scrollIntoView(); target.focus({ preventScroll: true }); }
    }
  }
  const latest = slot('frettir-nyjast');
  const fresh = news[0] && (Date.parse(today) - Date.parse(news[0].dags)) / 86_400_000 <= 60;
  if (latest && fresh) {
    const n = news[0];
    latest.append(
      el('span', { class: 'news-latest-date' }, longDate(n.dags)),
      el('a', { href: `${newsHref}${slug(n) ? `#${slug(n)}` : ''}` }, tx(n, 'titill')),
      el('a', { class: 'news-latest-all', href: newsHref }, L('Allar fréttir', 'All news')));
    latest.hidden = false;
  }

  const next = slot('naest');
  if (next && upcoming[0]) {
    const v = upcoming[0], p = parts(v.dags), time = (v.klukkan ?? '').split(/[–-]/)[0].trim();
    next.textContent = EN
      ? `Next: ${tx(v, 'heiti')}, ${p.weekday} ${p.day} ${p.month}${time ? ` at ${time}` : ''}`
      : `Næst: ${v.heiti} ${p.weekdayAcc} ${p.day}. ${p.month}${time ? ` kl. ${time}` : ''}`;
  }

  // "Næst" in the Commander strip: the next two Commander dates, e.g. "3. og 17. des."
  const nextCmd = slot('naest-commander');
  const cmd = upcoming.filter((v) => (v.tegund ?? '') === 'commander').slice(0, 2).map((v) => parts(v.dags));
  if (nextCmd && cmd.length) {
    const short = (p) => monAbbr(p.m), and = L('og', '&');
    nextCmd.textContent = cmd.length === 1 ? `${dayNum(cmd[0])} ${short(cmd[0])}`
      : cmd[0].month === cmd[1].month ? `${dayNum(cmd[0])} ${and} ${dayNum(cmd[1])} ${short(cmd[1])}`
      : `${dayNum(cmd[0])} ${short(cmd[0])} ${and} ${dayNum(cmd[1])} ${short(cmd[1])}`;
  }

  const faq = slot('hagnyt');
  if (faq) for (const q of c.hagnyt ?? []) if (q.spurning) faq.append(el('div', {}, el('dt', {}, tx(q, 'spurning')), el('dd', {}, tx(q, 'svar') ?? '')));

  // kennitala appears under Um félagið once it's filled in
  const kt = (c.kennitala ?? '').trim();
  document.querySelectorAll('[data-render="kennitala"]').forEach((n) => { if (kt) { n.textContent = kt; n.closest('[data-hide-empty]')?.removeAttribute('hidden'); } });

  // "Hafðu samband": mailto with a subject when an address is set
  const contact = slot('samband');
  const mail = (c.samband_netfang ?? '').trim();
  if (contact && mail) contact.href = `mailto:${mail}?subject=${encodeURIComponent(L('Ég vil halda utan um spil hjá félaginu', "I'd like to run a game for the club"))}`;

  // a grant shows only once it is actually awarded ("veittur": true), and so does the funder credit in the footer
  const awarded = (c.styrkir ?? []).filter((g) => g.heiti && g.veittur === true);
  const credit = slot('studningur');
  const creditText = awarded.map((g) => tx(g, 'studningur')).find(Boolean);
  if (credit && creditText) { credit.textContent = creditText; credit.hidden = false; }

  const fee = (tx(c, 'felagsgjald') ?? '').trim();
  document.querySelectorAll('[data-render="felagsgjald"]').forEach((n) => { if (fee) { n.textContent = fee; n.hidden = false; } });

  for (const key of ['facebook', 'facebook_hopur']) {
    const url = safeUrl(c[key]);
    document.querySelectorAll(`[data-render="${key}"]`).forEach((a) => { if (url) { a.href = url; a.target = '_blank'; a.rel = 'noopener'; } });
  }

  const grants = slot('styrkir');
  if (grants) {
    for (const g of awarded) {
      const url = safeUrl(g.vefur), logo = localImg(g.merki);
      grants.append(el('article', { class: 'grant reveal' },
        el('img', { class: 'bg', src: 'img/fjord.svg', alt: '', 'aria-hidden': 'true' }),
        el('div', {},
          el('h3', {}, g.heiti),
          tx(g, 'texti') ? el('p', {}, tx(g, 'texti')) : null,
          tx(g, 'studningur') ? el('p', { class: 'support' }, tx(g, 'studningur')) : null,
          url ? (() => { const a = el('a', { class: 'btn ghost small', href: url, target: '_blank', rel: 'noopener' }, L('Um sjóðinn', 'About the fund')); a.append(svg('<svg class="arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 11 11 5M6 5h5v5"/></svg>')); return a; })() : null),
        el('div', { class: 'mark' },
          logo ? el('img', { src: logo, alt: tx(g, 'merki_alt') ?? '' }) : el('div', {}, el('div', { class: 'year' }, g.ar ?? ''), el('div', { class: 'year-label' }, L('Styrkár', 'Grant year'))))));
    }
  }

  const sponsors = slot('bakhjarlar');
  if (sponsors) {
    for (const b of c.bakhjarlar ?? []) {
      if (!b.nafn) continue;
      const url = safeUrl(b.vefur), logo = localImg(b.merki);
      const card = el(url ? 'a' : 'div', { class: 'sponsor reveal', href: url, target: url && '_blank', rel: url && 'noopener sponsored' },
        el('div', { class: 'logo' },
          logo ? el('img', { src: logo, alt: b.syna_nafn ? '' : b.nafn }) : null,
          !logo || b.syna_nafn ? el('span', { class: 'wordmark' }, b.nafn) : null),
        el('div', { class: 'meta' }, el('span', { class: 'what' }, tx(b, 'framlag') ?? L('Bakhjarl', 'Sponsor')), url ? svg(EXT) : null));
      sponsors.append(card);

      if (b.ljosmyndari_forsidu) {
        const credit = slot('credit');
        if (credit) {
          credit.append(L('Myndefni: ', 'Photos and video: '), url ? el('a', { href: url, target: '_blank', rel: 'noopener' }, b.nafn, el('span', { 'aria-hidden': 'true' }, ' ↗')) : b.nafn);
          credit.hidden = false;
        }
      }
    }
    const smail = (c.styrkja_netfang ?? '').trim();
    sponsors.append(el(smail ? 'a' : 'div', { class: 'sponsor invite reveal', href: smail ? `mailto:${smail}?subject=${encodeURIComponent(L('Styrkur við Spilafélag Vestfjarða', 'Sponsoring Spilafélag Vestfjarða'))}` : null },
      el('div', {}, el('span', { class: 'wordmark' }, el('em', {}, L('Þitt', 'Your')), L(' fyrirtæki?', ' company?')),
        el('p', {}, L('Viltu styrkja spilastarf á Vestfjörðum? Við tökum vel á móti bakhjörlum, stórum sem smáum.', 'Want to support games in the Westfjords? Sponsors of every size are welcome.'))),
      el('div', { class: 'meta' }, el('span', { class: 'what' }, smail ? L('Hafðu samband', 'Get in touch') : L('Bakhjarlar velkomnir', 'Sponsors welcome')), smail ? svg(EXT) : null)));
  }

  watchReveals();
}

function portrait(p) {
  const img = localImg(p.mynd);
  // The name is printed right beside the picture, so the picture itself needs no text.
  return el('div', { class: 'portrait' }, img ? el('img', { src: img, alt: '', loading: 'lazy' }) : el('span', { class: 'monogram', 'aria-hidden': 'true' }, initials(p.nafn)));
}

let bioDialog;
function openBio(p) {
  if (!bioDialog) {
    bioDialog = el('dialog', { class: 'bio', 'aria-labelledby': 'bio-name' });
    // click on the backdrop (outside the box) closes
    bioDialog.addEventListener('click', (e) => { if (e.target === bioDialog) bioDialog.close(); });
    document.body.append(bioDialog);
  }
  const close = el('button', { class: 'bio-close', type: 'button', 'aria-label': L('Loka', 'Close') });
  close.append(svg('<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg>'));
  close.addEventListener('click', () => bioDialog.close());

  const faves = (Array.isArray(p.uppahaldsspil) ? p.uppahaldsspil : []).filter(Boolean);
  const body = el('div', { class: 'bio-body' },
    el('div', { class: 'role' }, tx(p, 'hlutverk') ?? ''),
    el('h2', { id: 'bio-name' }, p.nafn),
    ...tx(p, 'um').trim().split(/\n\s*\n/).map((para) => el('p', {}, para.trim())),
    faves.length ? el('div', { class: 'faves' }, el('p', { class: 'label' }, L('Uppáhaldsspil', 'Favourite games')), el('ul', {}, ...faves.map((f) => el('li', {}, f)))) : null);

  bioDialog.replaceChildren(close, el('div', { class: 'bio-grid' }, portrait(p), body));
  bioDialog.showModal();
  close.focus();
}

/* ── bylaws: a link to #samthykktir opens the folded text ── */
const bylaws = document.getElementById('samthykktir');
if (bylaws?.tagName === 'DETAILS') {
  const openIfTargeted = () => { if (location.hash === '#samthykktir') bylaws.open = true; };
  openIfTargeted();
  addEventListener('hashchange', openIfTargeted);
}
