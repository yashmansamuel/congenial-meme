// Signaturesi shared UI: mobile menu, document table of contents, cookie demo toggles.
(function () {
  var btn = document.querySelector(".nav__toggle");
  var menu = document.getElementById("menu");
  if (btn && menu) {
    var set = function (open) {
      btn.setAttribute("aria-expanded", String(open));
      btn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      menu.hidden = !open;
    };
    btn.addEventListener("click", function () { set(menu.hidden); });
    menu.addEventListener("click", function (e) { if (e.target.closest("a")) set(false); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !menu.hidden) { set(false); btn.focus(); }
    });
  }

  var toc = document.querySelector(".toc details");
  if (toc) {
    var wide = window.matchMedia("(min-width: 1080px)");
    var sync = function () { toc.open = wide.matches; };
    sync();
    if (wide.addEventListener) wide.addEventListener("change", sync);
    toc.addEventListener("click", function (e) {
      if (e.target.closest("a") && !wide.matches) toc.open = false;
    });
    var links = Array.prototype.slice.call(toc.querySelectorAll("a[href^='#']"));
    var targets = links.map(function (a) { return document.getElementById(a.getAttribute("href").slice(1)); }).filter(Boolean);
    if ("IntersectionObserver" in window && targets.length) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          links.forEach(function (a) { a.classList.toggle("is-active", a.getAttribute("href") === "#" + entry.target.id); });
        });
      }, { rootMargin: "-20% 0px -70% 0px", threshold: 0 });
      targets.forEach(function (t) { io.observe(t); });
    }
  }

  document.querySelectorAll("[data-cookie-toggle]").forEach(function (t) {
    t.addEventListener("click", function () {
      t.setAttribute("aria-pressed", String(t.getAttribute("aria-pressed") !== "true"));
    });
  });
  var rv = document.querySelectorAll(".rv");
  if (rv.length) {
    if ("IntersectionObserver" in window) {
      var ro = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); ro.unobserve(e.target); } });
      }, { rootMargin: "0px 0px -8% 0px" });
      rv.forEach(function (el) { ro.observe(el); });
    } else { rv.forEach(function (el) { el.classList.add("in"); }); }
  }
})();

/* SIGNATURESI BRAND MARK (same as uasset.signaturesi.com) — black-ink hover
   Tiny spring-driven displacement of the logo path's own
   points toward the cursor. Returns to the exact static
   mark when the cursor leaves. Off for reduced motion.
   ========================================================= */

(function () {
  const MAX = 8, SIGMA = 210, K = 0.08, DAMP = 0.82; // viewBox units

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  document.querySelectorAll("[data-ink]").forEach(svg => {
    const path = svg.querySelector("path");
    if (!path) return;

    const d0 = path.getAttribute("d");
    const toks = d0.match(/[MLCZ]|-?\d*\.?\d+/g) || [];
    const cmds = [];
    const pts = [];

    for (let i = 0; i < toks.length;) {
      const c = toks[i++];
      const n = c === "C" ? 3 : c === "Z" ? 0 : 1;
      cmds.push([c, n]);
      for (let k = 0; k < n; k++) {
        pts.push({ x: +toks[i++], y: +toks[i++], dx: 0, dy: 0, vx: 0, vy: 0 });
      }
    }

    const build = () => {
      let s = "", j = 0;
      for (const [c, n] of cmds) {
        s += c;
        for (let k = 0; k < n; k++) {
          const p = pts[j++];
          s += (p.x + p.dx).toFixed(2) + " " + (p.y + p.dy).toFixed(2) + " ";
        }
      }
      return s;
    };

    // Hover area is the whole brand link, not just the small mark
    const target = svg.closest("a, .brand") || svg;
    let cur = null, raf = 0;

    const toLocal = e =>
      new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());

    function frame() {
      let moving = false;

      for (const p of pts) {
        let tx = 0, ty = 0;
        if (cur) {
          const ex = cur.x - p.x, ey = cur.y - p.y;
          const dist = Math.hypot(ex, ey) || 1;
          const w = Math.exp(-(dist * dist) / (2 * SIGMA * SIGMA)) * Math.min(1, dist / 70);
          tx = ex / dist * MAX * w;
          ty = ey / dist * MAX * w;
        }
        p.vx = (p.vx + (tx - p.dx) * K) * DAMP;
        p.vy = (p.vy + (ty - p.dy) * K) * DAMP;
        p.dx += p.vx;
        p.dy += p.vy;
        if (Math.abs(p.vx) + Math.abs(p.vy) + Math.abs(tx - p.dx) + Math.abs(ty - p.dy) > 0.02) {
          moving = true;
        }
      }

      path.setAttribute("d", build());

      if (moving || cur) {
        raf = requestAnimationFrame(frame);
      } else {
        raf = 0;
        path.setAttribute("d", d0); // exact static mark again
      }
    }

    const start = () => { if (!raf) raf = requestAnimationFrame(frame); };

    target.addEventListener("pointerenter", e => { cur = toLocal(e); start(); });
    target.addEventListener("pointermove", e => { cur = toLocal(e); start(); });
    target.addEventListener("pointerleave", () => { cur = null; start(); });
  });
})();

