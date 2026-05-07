// ============================================================
// ECCA STACK — Main JavaScript
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initReveal();
  initParticles();
  initTabs();
  initCounters();
  initMobileNav();
});

// --- Navigation scroll effect ---
function initNav() {
  const nav = document.querySelector('.nav');
  if (!nav) return;

  const onScroll = () => {
    if (window.scrollY > 60) {
      nav.classList.add('scrolled');
    } else {
      nav.classList.remove('scrolled');
    }
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// --- Scroll reveal ---
function initReveal() {
  const reveals = document.querySelectorAll('.reveal');
  if (!reveals.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

  reveals.forEach(el => observer.observe(el));
}

// --- Floating Particles ---
function initParticles() {
  const container = document.querySelector('.content-wrapper');
  if (!container) return;

  const colors = ['#00dcff', '#ff00e5', '#00ff88', '#a855f7'];

  function spawnParticle() {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = Math.random() * 3 + 1;
    const color = colors[Math.floor(Math.random() * colors.length)];
    const duration = Math.random() * 15 + 10;
    const left = Math.random() * 100;

    p.style.cssText = `
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      box-shadow: 0 0 ${size * 2}px ${color};
      left: ${left}%;
      animation-duration: ${duration}s;
      animation-delay: ${Math.random() * 5}s;
    `;

    document.body.appendChild(p);
    setTimeout(() => p.remove(), (duration + 5) * 1000);
  }

  // Spawn periodically
  setInterval(spawnParticle, 800);
  // Initial burst
  for (let i = 0; i < 8; i++) {
    setTimeout(spawnParticle, i * 200);
  }
}

// --- Audience Tabs ---
function initTabs() {
  const tabs = document.querySelectorAll('.audience-tab');
  const contents = document.querySelectorAll('.audience-content');
  if (!tabs.length) return;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;

      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      const el = document.getElementById(target);
      if (el) el.classList.add('active');
    });
  });
}

// --- Animated counters ---
function initCounters() {
  const counters = document.querySelectorAll('[data-count]');
  if (!counters.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const el = entry.target;
        const target = parseInt(el.dataset.count, 10);
        const suffix = el.dataset.suffix || '';
        const duration = 2000;
        const start = Date.now();

        function animate() {
          const elapsed = Date.now() - start;
          const progress = Math.min(elapsed / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          const value = Math.floor(eased * target);
          el.textContent = value + suffix;
          if (progress < 1) requestAnimationFrame(animate);
        }

        animate();
        observer.unobserve(el);
      }
    });
  }, { threshold: 0.5 });

  counters.forEach(el => observer.observe(el));
}

// --- Mobile navigation ---
function initMobileNav() {
  const toggle = document.querySelector('.nav-mobile-toggle');
  const links = document.querySelector('.nav-links');
  if (!toggle || !links) return;

  toggle.addEventListener('click', () => {
    links.classList.toggle('open');
  });

  // Close on link click
  links.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      links.classList.remove('open');
    });
  });
}

// --- Smooth scroll for anchor links ---
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href^="#"]');
  if (!link) return;

  const target = document.querySelector(link.getAttribute('href'));
  if (target) {
    e.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});
