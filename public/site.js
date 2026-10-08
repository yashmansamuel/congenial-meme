/* Signaturesi — shared header, mobile menu and fade-in. Load with <script src="/site.js" defer></script> */
(() => {
  const init = () => {
    const header = document.querySelector('.site-header');
    const toggle = document.querySelector('.nav-toggle');

    if (header) {
      const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }

    if (header && toggle) {
      const setMenu = (open) => {
        header.classList.toggle('menu-open', open);
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      };
      toggle.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
      header.querySelectorAll('.nav a').forEach((a) => a.addEventListener('click', () => setMenu(false)));
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && header.classList.contains('menu-open')) { setMenu(false); toggle.focus(); }
      });
      window.matchMedia('(min-width: 861px)').addEventListener?.('change', (e) => { if (e.matches) setMenu(false); });
    }

    const items = document.querySelectorAll('[data-reveal]');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!items.length || reduce || !('IntersectionObserver' in window)) return;
    document.documentElement.classList.add('js');
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      });
    }, { threshold: 0.05, rootMargin: '0px 0px -40px 0px' });
    items.forEach((el) => { el.classList.add('reveal'); io.observe(el); });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
