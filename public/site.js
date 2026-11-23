// Scroll tone, reveal-on-scroll, header state, and the two forms.
// One small script for every page; each part checks whether it applies.

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── body tone follows whichever section is in the middle of the screen ── */
const toned = document.querySelectorAll('[data-tone]:not(body)');
if (toned.length) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) document.body.dataset.tone = e.target.dataset.tone;
  }, { rootMargin: '-50% 0px -50% 0px' });
  toned.forEach((s) => io.observe(s));
}

/* ── reveal ── */
const reveals = document.querySelectorAll('.reveal');
if (reduced || !('IntersectionObserver' in window)) {
  reveals.forEach((el) => el.classList.add('in'));
} else {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  reveals.forEach((el) => io.observe(el));
}

/* ── header gets a glass background once you leave the top ── */
const header = document.querySelector('.site-header');
const onScroll = () => header?.classList.toggle('scrolled', scrollY > 24);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* ── slow parallax on the card fan ── */
const fan = document.querySelector('.fan');
if (fan && !reduced) {
  addEventListener('scroll', () => { fan.style.translate = `0 ${Math.min(scrollY, 900) * -0.12}px`; }, { passive: true });
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
