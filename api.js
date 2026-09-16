/* 67Client — shared browser helpers. Plain script, no build step, no globals
   beyond `SS`. Every mutating call carries the dashboard header the server
   requires, which is what stops cross-site form posts from counting. */
(function (window, document) {
  "use strict";

  var DASHBOARD_HEADER = "x-67c-dashboard";

  function request(method, path, body) {
    // The header goes on every request, not just mutations: staff reads are
    // gated on it too, and a browser will not attach it to a cross-site request
    // without a CORS preflight that this server never answers.
    var options = {
      method: method,
      credentials: "same-origin",
      headers: { accept: "application/json" },
    };
    options.headers[DASHBOARD_HEADER] = "1";
    if (method !== "GET" && body !== undefined) {
      options.headers["content-type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    return fetch(path, options).then(function (res) {
      var isJson = (res.headers.get("content-type") || "").indexOf("json") !== -1;
      return (isJson ? res.json() : res.text()).then(function (payload) {
        if (res.ok) return payload;
        var err = new Error(
          (payload && payload.message) || "Request failed (" + res.status + ")",
        );
        err.code = (payload && payload.error) || String(res.status);
        err.status = res.status;
        err.retryAfterSeconds = Number(res.headers.get("retry-after")) || 0;
        err.nextAllowedAt = (payload && payload.nextAllowedAt) || null;
        throw err;
      });
    });
  }

  var api = {
    get: function (path) {
      return request("GET", path);
    },
    post: function (path, body) {
      return request("POST", path, body);
    },
    del: function (path) {
      return request("DELETE", path);
    },
  };

  // ---------------------------------------------------------------- toasts

  function toast(message, kind, href) {
    var host = document.getElementById("toasts");
    if (!host) return;
    var el = document.createElement("div");
    el.className = "toast" + (kind ? " toast--" + kind : "");
    el.setAttribute("role", kind === "error" ? "alert" : "status");

    var icon = document.createElement("span");
    icon.className = "toast__icon";
    var text = document.createElement(href ? "a" : "span");
    text.textContent = message;
    if (href) {
      text.className = "toast__link";
      text.href = href;
      text.target = "_blank";
      text.rel = "noopener noreferrer";
    }

    el.appendChild(icon);
    el.appendChild(text);
    host.appendChild(el);

    window.setTimeout(function () {
      el.style.transition = "opacity .3s, transform .3s";
      el.style.opacity = "0";
      el.style.transform = "translateY(8px)";
      window.setTimeout(function () {
        el.remove();
      }, 320);
    }, kind === "error" ? 6000 : href ? 8000 : 4000);
  }

  // ------------------------------------------------------------ formatting

  function locale() {
    return document.documentElement.lang || "en";
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function number(value) {
    return typeof value === "number" ? value.toLocaleString(locale()) : "—";
  }

  function date(ms) {
    if (!ms) return "—";
    return new Date(ms).toLocaleDateString(locale(), {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function dateTime(ms) {
    if (!ms) return "—";
    return new Date(ms).toLocaleString(locale(), {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  var UNITS = [
    ["year", 31536000000],
    ["month", 2592000000],
    ["day", 86400000],
    ["hour", 3600000],
    ["minute", 60000],
  ];

  /** "3 days ago" / "in 2 months". Falls back to "just now" under a minute. */
  function relative(ms) {
    if (!ms) return "—";
    var diff = ms - Date.now();
    var abs = Math.abs(diff);
    for (var i = 0; i < UNITS.length; i++) {
      if (abs >= UNITS[i][1]) {
        var value = Math.round(diff / UNITS[i][1]);
        if (typeof Intl !== "undefined" && Intl.RelativeTimeFormat) {
          return new Intl.RelativeTimeFormat(locale(), { numeric: "auto" }).format(value, UNITS[i][0]);
        }
        return Math.abs(value) + " " + UNITS[i][0] + (Math.abs(value) === 1 ? "" : "s") +
          (value < 0 ? " ago" : " from now");
      }
    }
    return "just now";
  }

  var STAR = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 17.3-6.2 3.7 1.7-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.5 4.8 1.7 7z"/></svg>';

  /** Five stars with `rating` filled — returns markup, never user input. */
  function stars(rating) {
    var out = '<span class="stars" role="img" aria-label="' + rating + ' out of 5">';
    for (var i = 1; i <= 5; i++) {
      out += i <= rating ? STAR : STAR.replace("<svg", '<svg class="is-empty"');
    }
    return out + "</span>";
  }

  // ------------------------------------------------------ category icons

  /* The client's own category icons, copied from
     assets/sixsevenclient/icons/*.svg so the site shows the same glyphs the
     ClickGUI draws. Stroke is currentColor so they take the surrounding text. */
  var CATEGORY_ICONS = {
    COMBAT:
      '<circle cx="96" cy="96" r="74" stroke-width="12"/><circle cx="96" cy="96" r="29" stroke-width="14"/>',
    MISC:
      '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="12" d="M96 166V26M63 152V40m30.296-17.36-59.98 30.283A6.07 6.07 0 0 0 30 58.343v75.314a6.07 6.07 0 0 0 3.317 5.42l59.98 30.283c1.7.859 3.703.853 5.398-.016l60.021-30.258a6.07 6.07 0 0 0 3.284-5.403V58.317a6.07 6.07 0 0 0-3.284-5.403l-60.02-30.258a5.95 5.95 0 0 0-5.4-.016"/>',
    RENDER:
      '<circle cx="96" cy="144" r="4" stroke-width="8"/><rect width="72" height="148" x="60" y="22" stroke-width="12" ry="6"/><path stroke-linecap="round" stroke-width="10" d="M60 64s11-19 21.5-17S87 66 96 68s9-10 17-12c9-2 19 10 19 10m-72 39.147S62 95 72 96s10 14 20 13 9-19 19-19 21 17.147 21 17.147"/>',
    VISUALS:
      '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="12" d="M25 31a6 6 0 0 1 6-6h130a6 6 0 0 1 6 6v130a6 6 0 0 1-6 6H31a6 6 0 0 1-6-6z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="12" d="M96 47c0 25-24 49-49 49 25 0 49 24 49 49 0-25 24-49 49-49-25 0-49-24-49-49"/>',
    CLIENT:
      '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="14" d="m23 52 56.772 23.377c4.128 1.7 4.128 7.547 0 9.246L23 108m81 34h65"/>',
  };

  /** Inline SVG for a category id, or an empty string for an unknown one. */
  function categoryIcon(id) {
    var body = CATEGORY_ICONS[id];
    if (!body) return "";
    return (
      '<svg viewBox="0 0 192 192" fill="none" stroke="currentColor" stroke-linejoin="round" aria-hidden="true">' +
      body +
      "</svg>"
    );
  }

  // -------------------------------------------------------------- clipboard

  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand("copy") ? resolve() : reject(new Error("copy blocked"));
      } catch (err) {
        reject(err);
      } finally {
        area.remove();
      }
    });
  }

  window.SS = {
    api: api,
    toast: toast,
    escapeHtml: escapeHtml,
    number: number,
    date: date,
    dateTime: dateTime,
    relative: relative,
    stars: stars,
    copy: copy,
    categoryIcon: categoryIcon,
  };
})(window, document);
