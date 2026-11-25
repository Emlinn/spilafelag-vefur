// Scroll tone, reveal-on-scroll, header state, and the two forms.
// One small script for every page; each part checks whether it applies.

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── reveal on scroll ── */
const revealIO = (reduced || !('IntersectionObserver' in window)) ? null : new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); revealIO.unobserve(e.target); }
}, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });
function watchReveals(root = document) {
  root.querySelectorAll('.reveal:not(.in)').forEach((el) => revealIO ? revealIO.observe(el) : el.classList.add('in'));
}
watchReveals();

/* ── header turns to frosted glass once you leave the top ── */
const header = document.querySelector('.site-header');
const onScroll = () => header?.classList.toggle('scrolled', scrollY > 16);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

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

/* ── hero video: loaded only when motion is welcome and data isn't scarce.
   Hidden until it actually plays, so a missing file leaves the photo/fjord. ── */
const heroVideo = document.querySelector('video.hero-video[data-src]');
if (heroVideo && !reduced && !navigator.connection?.saveData) {
  heroVideo.addEventListener('playing', () => heroVideo.classList.add('on'), { once: true });
  heroVideo.src = heroVideo.dataset.src;
  heroVideo.play().catch(() => {});
}

/* ── typewriter in the glass pill ── */
const typed = document.querySelector('.typed[data-words]');
if (typed && !reduced) {
  const words = typed.dataset.words.split('|');
  let w = 0, i = words[0].length, deleting = true;
  const tick = () => {
    const word = words[w];
    if (deleting) {
      i--;
      if (i <= 0) { deleting = false; w = (w + 1) % words.length; }
    } else {
      i++;
      if (i >= words[w].length) { deleting = true; typed.textContent = words[w]; return setTimeout(tick, 2200); }
    }
    typed.textContent = (deleting ? word : words[w]).slice(0, Math.max(i, 0));
    setTimeout(tick, deleting ? 45 : 85);
  };
  setTimeout(tick, 2600);
}

/* ── helpers ── */
async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, data };
}

function showFieldErrors(form, errors = {}) {
  form.querySelectorAll('.field').forEach((f) => {
    f.classList.remove('invalid');
    const e = f.querySelector('.err'); if (e) e.textContent = '';
  });
  let first = null;
  for (const [name, msg] of Object.entries(errors)) {
    const input = form.elements[name];
    const field = (input?.length && !input.tagName ? input[0] : input)?.closest('.field');
    if (!field) continue;
    field.classList.add('invalid');
    const e = field.querySelector('.err'); if (e) e.textContent = msg;
    first ??= field;
  }
  first?.querySelector('input,textarea')?.focus();
}

/* ── membership application ── */
const signup = document.getElementById('umsokn');
if (signup) {
  const alert = signup.querySelector('.alert');
  signup.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    alert.hidden = true;
    const f = signup.elements;
    const body = {
      name: f.name.value, email: f.email.value, phone: f.phone.value,
      message: f.message.value, password: f.password.value, consent: f.consent.checked,
      interests: [...signup.querySelectorAll('input[name="interests"]:checked')].map((i) => i.value),
      website: f.website.value,
    };
    const errors = {};
    if (body.password !== f.password2.value) errors.password2 = 'Lykilorðin stemma ekki.';
    if (Object.keys(errors).length) return showFieldErrors(signup, errors);

    const btn = signup.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const r = await post('/api/umsokn', body);
      if (r.ok) {
        const done = document.getElementById('umsokn-takk');
        const swap = () => { signup.hidden = true; done.hidden = false; done.querySelector('h2').focus(); };
        document.startViewTransition && !reduced ? document.startViewTransition(swap) : swap();
        return;
      }
      if (r.data.errors) showFieldErrors(signup, r.data.errors);
      else { alert.textContent = r.data.error ?? 'Eitthvað fór úrskeiðis. Reyndu aftur.'; alert.hidden = false; }
    } catch {
      alert.textContent = 'Náði ekki sambandi. Athugaðu nettenginguna.'; alert.hidden = false;
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
      const r = await post('/api/innskraning', { email: login.elements.email.value, password: login.elements.password.value });
      if (r.ok) {
        const back = new URLSearchParams(location.search).get('aftur');
        location.href = back && back.startsWith('/') && !back.startsWith('//') ? back : '/felagar';
        return;
      }
      alert.textContent = r.data.error ?? 'Innskráning tókst ekki.'; alert.hidden = false;
    } catch {
      alert.textContent = 'Náði ekki sambandi. Athugaðu nettenginguna.'; alert.hidden = false;
    } finally { btn.disabled = false; }
  });
}

/* ── member area ── */
const memberName = document.getElementById('member-name');
if (memberName) {
  fetch('/api/eg', { credentials: 'same-origin' }).then(async (res) => {
    if (!res.ok) { location.href = '/innskraning?aftur=/felagar'; return; }
    const { member } = await res.json();
    memberName.textContent = member.name.split(' ')[0];
    const since = document.getElementById('member-since');
    if (since && member.approved_at) {
      since.textContent = new Date(member.approved_at.replace(' ', 'T') + 'Z')
        .toLocaleDateString('is-IS', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Atlantic/Reykjavik' });
    }
  });
  document.getElementById('utskraning')?.addEventListener('click', async () => {
    await post('/api/utskraning', {});
    location.href = '/';
  });
}

/* ── front-page content from efni.json (board, grant, sponsors) ── */
const slots = document.querySelectorAll('[data-render]');
if (slots.length) {
  fetch('/efni.json', { cache: 'no-cache' }).then((r) => r.json()).then(renderContent).catch(() => {});
}

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) n.setAttribute(k, v);
  for (const k of kids) if (k != null && k !== '') n.append(k);
  return n;
}
const safeUrl = (u) => { try { const x = new URL(u, location.origin); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };
const localImg = (p) => (typeof p === 'string' && p.startsWith('/img/') ? p : null);
const EXT = '<svg class="ext" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 11 11 5M6 5h5v5"/></svg>';
const svg = (html) => { const t = document.createElement('template'); t.innerHTML = html; return t.content.firstChild; };
const initials = (name) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('');

function renderContent(c) {
  const slot = (k) => document.querySelector(`[data-render="${k}"]`);

  const board = slot('stjorn');
  if (board) {
    (c.stjorn ?? []).filter((p) => p.nafn).forEach((p, i) => {
      const hasBio = !!(p.um && p.um.trim());
      const card = el(hasBio ? 'button' : 'article', { class: 'person reveal', style: `--d:${i * 0.1}s`, type: hasBio ? 'button' : null, 'aria-haspopup': hasBio ? 'dialog' : null },
        portrait(p),
        el('div', { class: 'info' },
          el('div', { class: 'role' }, p.hlutverk ?? ''),
          el('h3', { class: 'name' }, p.nafn),
          p.texti ? el('p', { class: 'text' }, p.texti) : null,
          hasBio ? (() => { const m = el('span', { class: 'more' }, 'Lesa meira'); m.append(svg('<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2.5 8h11M9 3.5 13.5 8 9 12.5"/></svg>')); return m; })() : null));
      if (hasBio) card.addEventListener('click', () => openBio(p));
      board.append(card);
    });
  }

  const grants = slot('styrkir');
  if (grants) {
    for (const g of c.styrkir ?? []) {
      if (!g.heiti) continue;
      const url = safeUrl(g.vefur), logo = localImg(g.merki);
      const [first, ...rest] = g.heiti.split(' ');
      grants.append(el('article', { class: 'grant reveal' },
        el('img', { class: 'bg', src: '/img/fjord.svg', alt: '', 'aria-hidden': 'true' }),
        el('div', {},
          el('p', { class: 'label' }, `Styrkþegi ${g.ar ?? ''}`.trim()),
          el('h3', {}, el('em', {}, first), ' ' + rest.join(' ')),
          g.texti ? el('p', {}, g.texti) : null,
          g.studningur ? el('p', { class: 'support' }, g.studningur) : null,
          url ? (() => { const a = el('a', { class: 'btn ghost small', href: url, target: '_blank', rel: 'noopener' }, 'Um sjóðinn'); a.append(svg('<svg class="arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 11 11 5M6 5h5v5"/></svg>')); return a; })() : null),
        el('div', { class: 'mark' },
          logo ? el('img', { src: logo, alt: g.heiti }) : el('div', {}, el('div', { class: 'year' }, g.ar ?? ''), el('div', { class: 'year-label' }, 'Styrkár')))));
    }
  }

  const sponsors = slot('bakhjarlar');
  if (sponsors) {
    for (const b of c.bakhjarlar ?? []) {
      if (!b.nafn) continue;
      const url = safeUrl(b.vefur), logo = localImg(b.merki);
      const card = el(url ? 'a' : 'div', { class: 'sponsor reveal', href: url, target: url && '_blank', rel: url && 'noopener sponsored' },
        el('div', { class: 'logo' }, logo ? el('img', { src: logo, alt: b.nafn }) : el('span', { class: 'wordmark' }, b.nafn)),
        el('div', { class: 'meta' }, el('span', { class: 'what' }, b.framlag ?? 'Bakhjarl'), url ? svg(EXT) : null));
      sponsors.append(card);

      if (b.ljosmyndari_forsidu) {
        const credit = slot('credit');
        if (credit) {
          credit.append('Myndefni: ', url ? el('a', { href: url, target: '_blank', rel: 'noopener' }, b.nafn + ' ↗') : b.nafn);
          credit.hidden = false;
        }
      }
    }
    const mail = (c.styrkja_netfang ?? '').trim();
    sponsors.append(el(mail ? 'a' : 'div', { class: 'sponsor invite reveal', href: mail ? `mailto:${mail}?subject=${encodeURIComponent('Styrkur við Spilafélag Vestfjarða')}` : null },
      el('div', {}, el('span', { class: 'wordmark' }, el('em', {}, 'Þitt'), ' fyrirtæki?'),
        el('p', {}, 'Viltu styrkja spilastarf á Vestfjörðum? Við tökum vel á móti bakhjörlum, stórum sem smáum.')),
      el('div', { class: 'meta' }, el('span', { class: 'what' }, mail ? 'Hafðu samband' : 'Bakhjarlar velkomnir'), mail ? svg(EXT) : null)));
  }

  watchReveals();
}

function portrait(p) {
  const img = localImg(p.mynd);
  return el('div', { class: 'portrait' }, img ? el('img', { src: img, alt: p.nafn, loading: 'lazy' }) : el('span', { class: 'monogram', 'aria-hidden': 'true' }, initials(p.nafn)));
}

let bioDialog;
function openBio(p) {
  if (!bioDialog) {
    bioDialog = el('dialog', { class: 'bio', 'aria-labelledby': 'bio-name' });
    // click on the backdrop (outside the box) closes
    bioDialog.addEventListener('click', (e) => { if (e.target === bioDialog) bioDialog.close(); });
    document.body.append(bioDialog);
  }
  const close = el('button', { class: 'bio-close', type: 'button', 'aria-label': 'Loka' });
  close.append(svg('<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg>'));
  close.addEventListener('click', () => bioDialog.close());

  const faves = (Array.isArray(p.uppahaldsspil) ? p.uppahaldsspil : []).filter(Boolean);
  const body = el('div', { class: 'bio-body' },
    el('div', { class: 'role' }, p.hlutverk ?? ''),
    el('h2', { id: 'bio-name' }, p.nafn),
    ...p.um.trim().split(/\n\s*\n/).map((para) => el('p', {}, para.trim())),
    faves.length ? el('div', { class: 'faves' }, el('p', { class: 'label' }, 'Uppáhaldsspil'), el('ul', {}, ...faves.map((f) => el('li', {}, f)))) : null);

  bioDialog.replaceChildren(close, el('div', { class: 'bio-grid' }, portrait(p), body));
  bioDialog.showModal();
  close.focus();
}
