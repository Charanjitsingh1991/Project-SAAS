// Nav: shadow on scroll + mobile toggle
const nav = document.getElementById('nav');
const onScroll = () => nav.classList.toggle('nav--scrolled', window.scrollY > 10);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

const toggle = document.getElementById('navToggle');
toggle.addEventListener('click', () => nav.classList.toggle('nav--open'));
document.querySelectorAll('#navLinks a').forEach(a =>
  a.addEventListener('click', () => nav.classList.remove('nav--open'))
);

// Count-up numbers
function countUp(el) {
  const target = parseFloat(el.dataset.count);
  const decimals = parseInt(el.dataset.decimals || '0', 10);
  const prefix = el.dataset.prefix || '';
  const suffix = el.dataset.suffix || '';
  const start = performance.now();
  const dur = 1600;
  const step = now => {
    const p = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = prefix + (target * eased).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }) + suffix;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Reveal on scroll
const io = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (!e.isIntersecting) return;
    e.target.classList.add('in');
    e.target.querySelectorAll('[data-count]').forEach(countUp);
    if (e.target.matches('[data-count]')) countUp(e.target);
    io.unobserve(e.target);
  });
}, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

document.querySelectorAll('.reveal').forEach((el, i) => {
  el.style.transitionDelay = `${(i % 4) * 70}ms`;
  io.observe(el);
});

// Showcase tabs
const tabs = document.querySelectorAll('.tab');
tabs.forEach(tab => tab.addEventListener('click', () => {
  const key = tab.dataset.tab;
  tabs.forEach(t => t.classList.toggle('active', t === tab));
  document.querySelectorAll('[data-panel]').forEach(p =>
    p.classList.toggle('active', p.dataset.panel === key)
  );
}));

// Billing toggle
const sw = document.getElementById('billingSwitch');
sw.addEventListener('click', () => {
  const yearly = sw.classList.toggle('on');
  document.querySelectorAll('[data-billing-label]').forEach(l =>
    l.classList.toggle('active', (l.dataset.billingLabel === 'yearly') === yearly)
  );
  document.querySelectorAll('.price__val[data-monthly]').forEach(v => {
    v.textContent = yearly ? v.dataset.yearly : v.dataset.monthly;
  });
});

// Demo form (front-end only — wire to your backend/CRM endpoint)
document.getElementById('demoForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = new FormData(e.target).get('name').toString().split(' ')[0];
  document.getElementById('formMsg').textContent = `Thanks ${name}! Our team will reach out within 24 hours.`;
  e.target.reset();
});

document.getElementById('year').textContent = new Date().getFullYear();
