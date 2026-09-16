/* 67Client — public site behaviour.
   Pages arrive already translated from the server; this layer fills in live
   data (plans, reviews, modules) and drives the motion. */
(function (window, document) {
  "use strict";

  var SS = window.SS;
  var state = { site: null, catalog: null };

  var CATEGORY_CLASS = {
    COMBAT: "tag--combat",
    RENDER: "tag--render",
    VISUALS: "tag--visuals",
    MISC: "tag--misc",
    CLIENT: "tag--client",
  };

  var DETECTION_ORDER = ["undetected", "risk", "detected", "unrated"];

  function $(selector, scope) {
    return (scope || document).querySelector(selector);
  }

  function $$(selector, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
  }

  /** Dotted lookup into the dictionary the server sent with /api/site. */
  function t(path, fallback) {
    var node = state.site && state.site.i18n;
    var parts = path.split(".");
    for (var i = 0; i < parts.length && node; i++) node = node[parts[i]];
    return typeof node === "string" ? node : fallback || "";
  }

  function reduceMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  // ------------------------------------------------------------------- nav

  function initNav() {
    var nav = $("#nav");
    if (nav) {
      var onScroll = function () {
        nav.classList.toggle("is-stuck", window.scrollY > 8);
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    }

    var toggle = $("#navToggle");
    var links = $("#navLinks");
    if (toggle && links) {
      toggle.addEventListener("click", function () {
        var open = links.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      });
      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && links.classList.contains("is-open")) {
          links.classList.remove("is-open");
          toggle.setAttribute("aria-expanded", "false");
          toggle.focus();
        }
      });
      document.addEventListener("click", function (event) {
        if (!nav.contains(event.target)) {
          links.classList.remove("is-open");
          toggle.setAttribute("aria-expanded", "false");
        }
      });
    }

    var here = window.location.pathname.replace(/\/$/, "") || "/";
    $$(".nav__link").forEach(function (link) {
      if ((link.getAttribute("href") || "").replace(/\/$/, "") === here) {
        link.setAttribute("aria-current", "page");
      }
    });
  }

  /** Language menu: return to the current page after switching, close on blur. */
  function initLanguageMenu() {
    var menu = $("#langMenu");
    if (!menu) return;

    function updateLanguageLinks() {
      var current = new URL(window.location.href);
      // The language route sets the cookie. A stale query would override it.
      current.searchParams.delete("lang");
      var here = current.pathname + current.search + current.hash;
      $$("[data-lang-option]", menu).forEach(function (option) {
        var destination = new URL(option.getAttribute("href"), window.location.origin);
        destination.searchParams.set("next", here);
        option.setAttribute("href", destination.pathname + destination.search);
      });
    }
    updateLanguageLinks();
    menu.addEventListener("toggle", function () { if (menu.open) updateLanguageLinks(); });
    window.addEventListener("hashchange", updateLanguageLinks);

    document.addEventListener("click", function (event) {
      if (menu.open && !menu.contains(event.target)) menu.removeAttribute("open");
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && menu.open) menu.removeAttribute("open");
    });
  }

  /** Hides Discord buttons when no invite URL is configured yet. */
  function initInvite() {
    $$("[data-needs-invite]").forEach(function (el) {
      var href = el.getAttribute("href");
      if (!href || href === "#") (el.closest("li") || el).classList.add("hidden");
    });
  }

  /**
   * Guarantees the hero ends up visible. The entrance animation normally does
   * that itself; if it never advances — a tab the browser never painted, or a
   * refused animation — this drops the elements into their finished state well
   * after the longest stagger has had its turn.
   */
  function guardEntrance() {
    var longest = 1600;
    window.setTimeout(function () {
      document.body.classList.add("anim-safe");
    }, longest);
  }

  var revealObserver;
  var observedReveals = new WeakSet();
  var pendingReveals = new Set();
  function initReveal() {
    pendingReveals.forEach(function (el) {
      if (el.isConnected) return;
      if (revealObserver) revealObserver.unobserve(el);
      pendingReveals.delete(el);
    });
    $$('.footer__grid > div, main .section-head, [data-faq] > details, .module-row, .install-line li, .support-compose, .admin-view .block, .billing-plan-section, .billing-activation-grid > div, .billing-orders, .account-grid > section, .account-help').forEach(function (el) { el.classList.add('reveal'); });
    var reduced = reduceMotion() || !('IntersectionObserver' in window);
    if (!reduced && !revealObserver) {
      revealObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
          pendingReveals.delete(entry.target);
        });
      }, { rootMargin: '0px 0px -28px 0px', threshold: 0.04 });
    }
    $$('.reveal:not(.is-visible)').forEach(function (el) {
      if (reduced) { el.classList.add('is-visible'); return; }
      if (observedReveals.has(el)) return;
      observedReveals.add(el);
      var siblings = Array.prototype.filter.call(el.parentElement.children, function (child) { return child.classList.contains('reveal'); });
      el.style.setProperty('--reveal-delay', Math.min(siblings.indexOf(el) * 65, 195) + 'ms');
      el.classList.add('is-pending');
      pendingReveals.add(el);
      revealObserver.observe(el);
    });
  }
  SS.reveal = initReveal;

  /** The screenshot viewer uses the current client's two real layouts. */
  function initClientPreview() {
    var preview = $("#clientPreview");
    var dialog = $("#previewDialog");
    if (!preview || !dialog) return;
    var stage = $("[data-preview-open]", preview);
    var picture = $("img", stage);
    var selected = "panel";
    $$(".layout-switch button", preview).forEach(function (button) {
      button.addEventListener("click", function () {
        selected = button.getAttribute("data-layout");
        $$(".layout-switch button", preview).forEach(function (item) {
          item.setAttribute("aria-pressed", String(item === button));
        });
        picture.src = "/assets/img/client-" + selected + ".png";
        picture.alt = picture.getAttribute("data-" + selected + "-alt");
        stage.setAttribute("data-layout", selected);
      });
    });
    stage.addEventListener("click", function () {
      var expanded = $("img", dialog);
      expanded.src = picture.src;
      expanded.alt = picture.alt;
      $("#previewDialogTitle").textContent = "67Client — " + (selected === "panel" ? "Panel" : "Dropdown");
      dialog.showModal();
    });
    $("[data-preview-close]", dialog).addEventListener("click", function () { dialog.close(); });
    dialog.addEventListener("click", function (event) {
      if (event.target !== dialog) return;
      var bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    });
  }

  function initAmbientMotion() {
    var surfaces = $$("[data-ambient], .how--animated .how__step");
    if (!surfaces.length) return;
    var syncVisibility = function () {
      document.body.classList.toggle("motion-paused", document.hidden);
    };
    document.addEventListener("visibilitychange", syncVisibility);
    syncVisibility();
    if ("IntersectionObserver" in window) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) { entry.target.classList.toggle("is-offscreen", !entry.isIntersecting); });
      }, { rootMargin: "80px" });
      surfaces.forEach(function (surface) { observer.observe(surface); });
    }
  }

  /** Counts a stat up, writing the final value first so a hidden tab is correct. */
  function countTo(el, value) {
    if (typeof value !== "number") {
      el.textContent = "—";
      return;
    }
    el.textContent = SS.number(value);
    if (value <= 0 || reduceMotion() || document.visibilityState !== "visible") return;

    var start = null;
    var duration = 900;
    function frame(now) {
      if (start === null) start = now;
      var progress = Math.min((now - start) / duration, 1);
      el.textContent = SS.number(Math.round(value * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) window.requestAnimationFrame(frame);
    }
    window.requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ site data

  function renderPlans(host, plans, available, lifetimeOwned) {
    if (!plans.length) {
      host.innerHTML = '<div class="empty">' + SS.escapeHtml(t("faq.empty", "Nothing published yet.")) + "</div>";
      return;
    }
    var check =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg>';
    var arrow = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>';

    host.innerHTML = plans
      .map(function (plan) {
        var features = (plan.features || [])
          .map(function (f) {
            return "<li>" + check + "<span>" + SS.escapeHtml(f) + "</span></li>";
          })
          .join("");
        var formattedPrice = plan.price;
        if (Number.isSafeInteger(plan.amount) && plan.currency) {
          try { formattedPrice = new Intl.NumberFormat(document.documentElement.lang || "en", { style: "currency", currency: plan.currency }).format(plan.amount / 100); } catch (_) {}
        }
        var price = formattedPrice
          ? "<b>" + SS.escapeHtml(formattedPrice) + "</b>"
          : '<b class="is-blank">' + SS.escapeHtml(t("pricing.blank", "—")) + "</b>";

        return (
          '<article class="plan reveal' + (plan.highlight ? " plan--highlight" : "") + '">' +
          '<div class="plan__art" aria-hidden="true"><span class="plan__art-mark"></span><span class="plan__edition">67CLIENT / ' + SS.escapeHtml(plan.name) + '</span><span class="plan__symbol">' + (plan.id === "lifetime" ? "∞" : plan.id === "monthly" ? "30" : "67") + '</span></div>' +
          "<header>" +
          '<div class="plan__name-row"><span class="plan__name">' + SS.escapeHtml(plan.name) + "</span>" +
          (plan.badge ? '<span class="plan__badge">' + SS.escapeHtml(plan.badge) + "</span>" : "") +
          "</div>" +
          '<div class="plan__price">' + price + "<span>" + SS.escapeHtml(plan.period || "") + "</span></div>" +
          '<div class="plan__tagline">' + SS.escapeHtml(plan.tagline || "") + "</div>" +
          "</header>" +
          '<ul class="plan__features">' + features + "</ul>" +
          (lifetimeOwned ? '<div class="plan__foot"><button class="btn btn--ghost btn--block" disabled>' +
          SS.escapeHtml(t("dashboard.onboarding.lifetime_owned", "You already have lifetime access")) + '</button></div>' :
          available ? '<div class="plan__foot"><a class="btn ' + (plan.highlight ? "btn--primary" : "btn--ghost") +
          ' btn--block" href="/checkout?plan=' + encodeURIComponent(plan.id) + '">' +
          '<span>' + SS.escapeHtml(t("pricing.get", "Get") + " " + plan.name) + '</span>' + arrow + "</a></div>" :
          '<div class="plan__foot"><button class="btn btn--ghost btn--block" disabled>' +
          SS.escapeHtml(t("pricing.closed", "Sales are not open yet")) + '</button><p class="price-note">' +
          SS.escapeHtml(t("pricing.closedNote", "You can already create an account. Purchases open when the release is ready.")) + '</p></div>') +
          "</article>"
        );
      })
      .join("");
    initReveal();
  }

  function renderFaq(host, items) {
    if (!items.length) {
      host.innerHTML = '<div class="empty">' + SS.escapeHtml(t("faq.empty", "")) + "</div>";
      return;
    }
    var limit = Number(host.getAttribute("data-limit")) || 0;
    host.innerHTML = (limit ? items.slice(0, limit) : items)
      .map(function (item) {
        return (
          "<details><summary>" + SS.escapeHtml(item.q) + "</summary>" +
          '<div class="faq__body">' + SS.escapeHtml(item.a) + "</div></details>"
        );
      })
      .join("");
  }

  function renderChangelog(host, entries) {
    if (!entries.length) {
      host.innerHTML = '<div class="empty">' + SS.escapeHtml(t("faq.empty", "")) + "</div>";
      return;
    }
    host.innerHTML = entries
      .map(function (entry) {
        var notes = (entry.notes || [])
          .map(function (n) {
            return "<li>" + SS.escapeHtml(n) + "</li>";
          })
          .join("");
        return (
          '<article class="card reveal"><div class="row row--between">' +
          "<h3>v" + SS.escapeHtml(entry.version) + " — " + SS.escapeHtml(entry.title || "") + "</h3>" +
          '<span class="tag">' + SS.escapeHtml(entry.date || "") + "</span></div>" +
          '<ul class="mt-2 muted" style="padding-left:20px;display:grid;gap:6px">' + notes + "</ul></article>"
        );
      })
      .join("");
    initReveal();
  }

  function applySite(site) {
    var stats = site.stats || {};
    $$("[data-stat]").forEach(function (el) {
      var key = el.getAttribute("data-stat");
      if (key === "rating") {
        el.textContent = stats.rating === null || stats.rating === undefined ? "—" : stats.rating.toFixed(1);
        return;
      }
      countTo(el, stats[key]);
    });

    $$("[data-version]").forEach(function (el) {
      el.textContent = site.version ? "v" + site.version.version : "";
      if (!site.version) el.classList.add("hidden");
    });

    $$("[data-module-count]").forEach(function (el) {
      el.textContent = SS.number(stats.modules);
    });

    var plans = $("[data-plans]");
    if (plans) renderPlans(plans, site.plans || [], !!(site.payments && site.payments.available), !!(site.payments && site.payments.lifetimeOwned));

    var faq = $("[data-faq]");
    if (faq) renderFaq(faq, site.faq || []);

    var changelog = $("[data-changelog]");
    if (changelog) renderChangelog(changelog, site.changelog || []);
    initReveal();
  }

  // ---------------------------------------------------------------- modules

  function detectionBadge(status) {
    var known = DETECTION_ORDER.indexOf(status) === -1 ? "unrated" : status;
    return (
      '<span class="det det--' + known + '" title="' + SS.escapeHtml(t("detection." + known + "_help", "")) + '">' +
      '<i class="det__dot"></i>' + SS.escapeHtml(t("detection." + known, known)) + "</span>"
    );
  }

  function moduleCard(mod, index) {
    return (
      '<article class="module-row" style="--module-i:' + Math.min(index, 14) + '">' +
      '<div class="module-row__icon">' + SS.categoryIcon(mod.category) + "</div>" +
      '<div class="module-row__body"><div class="module-row__title"><strong>' + SS.escapeHtml(mod.name) + "</strong>" +
      '<span>' + SS.escapeHtml(mod.categoryName || mod.category) + "</span></div>" +
      "<p>" + SS.escapeHtml(mod.description) + "</p></div>" +
      '<div class="module-row__status">' + detectionBadge(mod.detection) + "</div>" +
      "</article>"
    );
  }

  function initModules() {
    var host = $("[data-modules]");
    if (!host) return;

    var limit = Number(host.getAttribute("data-limit")) || 0;
    var tabsHost = $("[data-module-tabs]");
    var legendHost = $("[data-detection-legend]");
    var searchInput = $("#moduleSearch");
    var countLabel = $("[data-module-shown]");
    var clearButton = $("[data-clear-filters]");
    var filter = { category: "ALL", status: "ALL", query: "" };

    function readFilters() {
      var params = new URLSearchParams(window.location.search);
      var category = (params.get("category") || "ALL").toUpperCase();
      filter.category = state.catalog.categories.some(function (cat) { return cat.id === category; }) ? category : "ALL";
      var status = params.get("status");
      filter.status = DETECTION_ORDER.indexOf(status) !== -1 ? status : "ALL";
      filter.query = params.get("q") || "";
      if (searchInput) searchInput.value = filter.query;
    }

    function syncFilters() {
      $$("[data-cat]", tabsHost || host).forEach(function (el) {
        var active = el.getAttribute("data-cat") === filter.category;
        el.classList.toggle("is-active", active);
        el.setAttribute("aria-pressed", String(active));
      });
      $$("[data-status]", legendHost || host).forEach(function (el) {
        var active = el.getAttribute("data-status") === filter.status;
        el.classList.toggle("is-active", active);
        el.setAttribute("aria-pressed", String(active));
      });
      if (clearButton) clearButton.disabled = filter.category === "ALL" && filter.status === "ALL" && !filter.query;
    }

    function updateUrl() {
      var url = new URL(window.location.href);
      [["category", filter.category === "ALL" ? "" : filter.category], ["status", filter.status === "ALL" ? "" : filter.status], ["q", filter.query]].forEach(function (pair) {
        if (pair[1]) url.searchParams.set(pair[0], pair[1]);
        else url.searchParams.delete(pair[0]);
      });
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }

    function matches(mod) {
      if (filter.category !== "ALL" && mod.category !== filter.category) return false;
      if (filter.status !== "ALL" && mod.detection !== filter.status) return false;
      if (!filter.query) return true;
      var needle = filter.query.toLowerCase();
      return (
        mod.name.toLowerCase().indexOf(needle) !== -1 ||
        mod.description.toLowerCase().indexOf(needle) !== -1
      );
    }

    function draw() {
      host.setAttribute("aria-busy", "false");
      syncFilters();
      var list = state.catalog.modules.filter(matches);
      if (countLabel) countLabel.textContent = list.length + " " + t("modules.shown", "of") + " " + state.catalog.count;
      if (!list.length) {
        host.innerHTML =
          '<div class="empty" style="grid-column:1/-1"><strong>' +
          SS.escapeHtml(t("modules.none_title", "Nothing matches")) + "</strong>" +
          SS.escapeHtml(t("modules.none_body", "")) + "</div>";
        return;
      }
      host.innerHTML = (limit ? list.slice(0, limit) : list).map(moduleCard).join("");
      initReveal();
    }

    function buildTabs(catalog) {
      if (!tabsHost) return;
      tabsHost.innerHTML =
        '<button type="button" class="tab is-active" data-cat="ALL" aria-pressed="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>' + SS.escapeHtml(t("modules.all", "All")) +
        " <b>" + catalog.count + "</b></button>" +
        catalog.categories
          .map(function (cat) {
            return (
              '<button type="button" class="tab" aria-pressed="false" data-cat="' + SS.escapeHtml(cat.id) + '">' +
              SS.categoryIcon(cat.id) + SS.escapeHtml(cat.name) + " <b>" + cat.count + "</b></button>"
            );
          })
          .join("");
      tabsHost.addEventListener("click", function (event) {
        var tab = event.target.closest(".tab");
        if (!tab) return;
        $$(".tab", tabsHost).forEach(function (el) {
          el.classList.toggle("is-active", el === tab);
        });
        filter.category = tab.getAttribute("data-cat");
        updateUrl();
        draw();
      });
    }

    /** The legend doubles as a status filter — click a status to isolate it. */
    function buildLegend(catalog) {
      if (!legendHost) return;
      var counts = catalog.detectionCounts || {};
      legendHost.innerHTML =
        DETECTION_ORDER.filter(function (status) { return status !== "unrated" || counts[status] > 0; })
          .map(function (status) {
            return (
              '<button type="button" class="risk-filter risk-filter--' + status + '" aria-pressed="false" title="' + SS.escapeHtml(t("detection." + status + "_help", "")) + '" data-status="' + status + '">' +
              '<span class="risk-filter__line"><i></i>' + SS.escapeHtml(t("detection." + status, status)) + "</span>" +
              '<strong>' + (counts[status] || 0) + '</strong>' +
              '<small>' + SS.escapeHtml(t("detection." + status + "_help", "")) + "</small></button>"
            );
          })
          .join("");

      legendHost.addEventListener("click", function (event) {
        var button = event.target.closest("[data-status]");
        if (!button) return;
        var status = button.getAttribute("data-status");
        filter.status = filter.status === status ? "ALL" : status;
        updateUrl();
        $$("[data-status]", legendHost).forEach(function (el) {
          el.classList.toggle("is-active", el.getAttribute("data-status") === filter.status);
        });
        draw();
      });
    }

    SS.api
      .get("/api/modules")
      .then(function (catalog) {
        var names = {};
        catalog.categories.forEach(function (cat) {
          names[cat.id] = cat.name;
        });
        catalog.modules.forEach(function (mod) {
          mod.categoryName = names[mod.category] || mod.category;
        });
        state.catalog = catalog;
        readFilters();
        buildTabs(catalog);
        buildLegend(catalog);
        if (searchInput) {
          searchInput.addEventListener("input", function () {
            filter.query = searchInput.value.trim();
            updateUrl();
            draw();
          });
        }
        if (clearButton) clearButton.addEventListener("click", function () {
          filter = { category: "ALL", status: "ALL", query: "" };
          if (searchInput) searchInput.value = "";
          updateUrl();
          draw();
          if (searchInput) searchInput.focus();
        });
        window.addEventListener("popstate", function () { readFilters(); draw(); });
        draw();
      })
      .catch(function () {
        host.setAttribute("aria-busy", "false");
        host.innerHTML =
          '<div class="empty" style="grid-column:1/-1">' + SS.escapeHtml(t("modules.error", "Could not load the module list. Please refresh the page.")) + "</div>";
      });
  }

  // ---------------------------------------------------------------- reviews

  function reviewCard(review) {
    var avatar = review.avatar
      ? '<img class="review__avatar" src="' + SS.escapeHtml(review.avatar) + '" alt="" loading="lazy" width="34" height="34">'
      : '<span class="review__avatar"></span>';
    return (
      '<article class="review reveal"><div class="review__head">' +
      avatar +
      '<div class="review__who"><div class="review__name">' + SS.escapeHtml(review.name) + "</div>" +
      '<div class="review__meta">' +
      (review.plan ? SS.escapeHtml(review.plan) + " · " : "") +
      SS.escapeHtml(SS.relative(review.createdAt)) +
      "</div></div></div>" +
      SS.stars(review.rating) +
      "<p>" + SS.escapeHtml(review.body) + "</p></article>"
    );
  }

  function initReviews() {
    var host = $("[data-reviews]");
    if (!host) return;
    var limit = Number(host.getAttribute("data-limit")) || 24;

    SS.api
      .get("/api/reviews?limit=" + limit)
      .then(function (data) {
        var summary = $("[data-review-summary]");
        if (summary) {
          summary.innerHTML = data.summary.count
            ? SS.stars(Math.round(data.summary.average)) +
              '<span class="muted">' + data.summary.average.toFixed(1) + " " +
              SS.escapeHtml(t("reviews.out_of", "out of 5")) + " · " + data.summary.count + " " +
              SS.escapeHtml(t(data.summary.count === 1 ? "reviews.count_one" : "reviews.count_many", "")) +
              "</span>"
            : '<span class="muted">' + SS.escapeHtml(t("reviews.none_rated", "")) + "</span>";
        }
        if (!data.reviews.length) {
          host.innerHTML =
            '<div class="empty" style="grid-column:1/-1"><strong>' +
            SS.escapeHtml(t("reviews.empty_title", "No reviews yet")) + "</strong>" +
            SS.escapeHtml(t("reviews.empty_body", "")) + "</div>";
          return;
        }
        host.innerHTML = data.reviews.map(reviewCard).join("");
        initReveal();
      })
      .catch(function () {
        host.innerHTML =
          '<div class="empty" style="grid-column:1/-1">' + SS.escapeHtml(t("reviews.error", "")) + "</div>";
      });
  }

  // ------------------------------------------------------------ account cta

  function initAccountLink() {
    var links = $$("[data-account-link]");
    if (!links.length) return;
    SS.api
      .get("/api/me")
      .then(function (me) {
        links.forEach(function (link) {
          var label = me.authenticated
            ? link.getAttribute("data-label-dashboard")
            : link.getAttribute("data-label-signin");
          if (label) link.textContent = label;
          link.setAttribute("href", me.authenticated ? "/dashboard" : "/login");
        });
      })
      .catch(function () {
        /* leave the server-rendered label */
      });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initNav();
    initLanguageMenu();
    initInvite();
    guardEntrance();
    initReveal();
    initClientPreview();
    initAmbientMotion();
    initAccountLink();

    // Everything below needs the dictionary, so it waits for /api/site.
    SS.api
      .get("/api/site")
      .then(function (site) {
        state.site = site;
        applySite(site);
      })
      .catch(function () {
        var plansHost = $("[data-plans]");
        if (plansHost) plansHost.innerHTML = '<div class="empty" style="grid-column:1/-1">' + SS.escapeHtml(t("pricing.error", "Plans could not be loaded. Please refresh the page.")) + '</div>';
        $$("[data-stat]").forEach(function (el) {
          el.textContent = "—";
        });
      })
      .then(function () {
        initModules();
        initReviews();
      });
  });
})(window, document);
