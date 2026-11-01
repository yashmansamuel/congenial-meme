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
