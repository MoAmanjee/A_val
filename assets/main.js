(() => {
  'use strict';

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Theme ---------- */
  const root = document.documentElement;
  const toggle = document.getElementById('themeToggle');
  const icon = toggle.querySelector('.theme-toggle__icon');
  const stored = (() => {
    try { return localStorage.getItem('ahmed-theme'); } catch { return null; }
  })();
  const startTheme = stored
    || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  applyTheme(startTheme);

  toggle.addEventListener('click', () => {
    applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  function applyTheme(theme) {
    root.dataset.theme = theme;
    icon.textContent = theme === 'dark' ? '🌙' : '☀️';
    toggle.setAttribute('aria-pressed', String(theme === 'dark'));
    try { localStorage.setItem('ahmed-theme', theme); } catch { /* private mode */ }
  }

  /* ---------- Sticky nav shadow ---------- */
  const nav = document.getElementById('nav');
  const onScroll = () => nav.classList.toggle('is-stuck', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- Reveal on scroll ---------- */
  const revealables = document.querySelectorAll('.reveal');

  if (prefersReducedMotion || !('IntersectionObserver' in window)) {
    revealables.forEach((el) => el.classList.add('is-visible'));
    document.querySelectorAll('.stat__num').forEach(renderFinalCount);
  } else {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry, i) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        el.style.transitionDelay = `${Math.min(i * 90, 360)}ms`;
        el.classList.add('is-visible');
        const num = el.querySelector('.stat__num');
        if (num) countUp(num);
        observer.unobserve(el);
      });
    }, { threshold: 0.2, rootMargin: '0px 0px -40px' });

    revealables.forEach((el) => observer.observe(el));
  }

  function renderFinalCount(el) {
    el.textContent = format(Number(el.dataset.count)) + (el.dataset.suffix || '');
  }

  function countUp(el) {
    const target = Number(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    const duration = 1400;
    const start = performance.now();

    const step = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = format(Math.round(target * eased)) + suffix;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  const format = (n) => n.toLocaleString('en-US');

  /* ---------- Ride calculator ---------- */
  const form = document.getElementById('rideForm');
  const distanceInput = document.getElementById('distance');
  const hoursInput = document.getElementById('hours');
  const minutesInput = document.getElementById('minutes');
  const weightInput = document.getElementById('weight');
  const unitRadios = form.querySelectorAll('input[name="units"]');

  const out = {
    speed: document.getElementById('speedOut'),
    speedLabel: document.getElementById('speedLabel'),
    pace: document.getElementById('paceOut'),
    paceLabel: document.getElementById('paceLabel'),
    calories: document.getElementById('caloriesOut'),
    cake: document.getElementById('cakeOut'),
    note: document.getElementById('calcNote'),
    distanceUnit: document.getElementById('distanceUnit'),
    weightUnit: document.getElementById('weightUnit')
  };

  const KM_PER_MILE = 1.609344;
  const LB_PER_KG = 2.2046226;
  const DEFAULT_NOTE = 'Calories are a friendly estimate based on effort and rider weight. Cake is exact.';

  let units = 'metric';

  // MET values for cycling, keyed by the lower bound of a speed band in mph.
  const MET_BANDS = [
    [20, 15.8], [16, 12], [14, 10], [12, 8], [10, 6.8], [0, 4]
  ];

  form.addEventListener('input', (event) => {
    if (event.target.name === 'units') return;
    calculate();
  });

  unitRadios.forEach((radio) => {
    radio.addEventListener('change', () => switchUnits(radio.value));
  });

  form.addEventListener('submit', (event) => event.preventDefault());

  function switchUnits(next) {
    if (next === units) return;
    const toImperial = next === 'imperial';

    const distance = toNumber(distanceInput.value);
    const weight = toNumber(weightInput.value);

    distanceInput.value = round(toImperial ? distance / KM_PER_MILE : distance * KM_PER_MILE, 1);
    weightInput.value = Math.round(toImperial ? weight * LB_PER_KG : weight / LB_PER_KG);

    units = next;
    out.distanceUnit.textContent = toImperial ? 'mi' : 'km';
    out.weightUnit.textContent = toImperial ? 'lb' : 'kg';
    calculate();
  }

  function calculate() {
    const distance = toNumber(distanceInput.value);
    const hours = toNumber(hoursInput.value);
    const minutes = toNumber(minutesInput.value);
    const weight = toNumber(weightInput.value);
    const totalHours = hours + minutes / 60;

    const distanceLabel = units === 'imperial' ? 'mi' : 'km';
    out.speedLabel.textContent = `average speed (${distanceLabel}/h)`;
    out.paceLabel.textContent = `per ${distanceLabel}`;

    if (distance <= 0 || totalHours <= 0) {
      ['speed', 'pace', 'calories', 'cake'].forEach((key) => { out[key].textContent = '—'; });
      out.note.textContent = 'Add a distance and a time to see the numbers.';
      out.note.classList.add('is-warning');
      return;
    }

    out.note.textContent = DEFAULT_NOTE;
    out.note.classList.remove('is-warning');

    const speed = distance / totalHours;
    const speedMph = units === 'imperial' ? speed : speed / KM_PER_MILE;
    const weightKg = units === 'imperial' ? weight / LB_PER_KG : weight;
    const met = MET_BANDS.find(([floor]) => speedMph >= floor)[1];
    const calories = Math.round(met * Math.max(weightKg, 0) * totalHours);

    out.speed.textContent = round(speed, 1).toFixed(1);
    out.pace.textContent = formatPace(60 / speed);
    out.calories.textContent = format(calories);
    out.cake.textContent = (calories / 350).toFixed(1);
  }

  function formatPace(minutesPerUnit) {
    if (!isFinite(minutesPerUnit)) return '—';
    const mins = Math.floor(minutesPerUnit);
    const secs = Math.round((minutesPerUnit - mins) * 60);
    const carry = secs === 60;
    return `${mins + (carry ? 1 : 0)}:${String(carry ? 0 : secs).padStart(2, '0')}`;
  }

  const toNumber = (value) => {
    const n = parseFloat(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;

  calculate();
})();
