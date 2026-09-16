/* 67Client — customer dashboard.
   One fetch of /api/me drives every panel; each action refreshes what it
   touched. Panels are plain sections toggled by the sidebar and the URL hash. */
(function (window, document) {
  "use strict";

  var SS = window.SS;
  var state = { me: null, site: null, admin: {} };
  var downloadWaitUntil = 0;
  var downloadBusy = false;
  var downloadButtonLabel = "Download client";

  var PANELS = ["overview", "download", "licence", "machine", "support", "reviews", "billing", "account", "admin"];

  var SOLID_STAR =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 17.3-6.2 3.7 1.7-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.5 4.8 1.7 7z"/></svg>';
  var CHECK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>';

  var STATUS_CHIP = {
    active: "chip--ok",
    pending: "chip--warn",
    expired: "chip--dim",
    revoked: "chip--danger",
    banned: "chip--danger",
    none: "chip--dim",
    open: "chip--warn",
    waiting_staff: "chip--danger",
    waiting_customer: "chip--accent",
    closed: "chip--dim",
    paid: "chip--ok",
    cancelled: "chip--danger",
    published: "chip--ok",
    hidden: "chip--dim",
  };

  var STATUS_LABEL = {
    open: "New",
    waiting_staff: "Waiting for staff",
    waiting_customer: "Waiting for customer",
    closed: "Closed",
    pending: "Needs review",
    published: "Published",
    hidden: "Hidden",
  };

  function $(sel, scope) {
    return (scope || document).querySelector(sel);
  }

  function $$(sel, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(sel));
  }

  function esc(value) {
    return SS.escapeHtml(value);
  }

  function t(path, fallback) {
    var node = state.site && state.site.i18n;
    path.split(".").forEach(function (part) { node = node && node[part]; });
    return typeof node === "string" ? node : fallback || "";
  }

  function chip(label, tone) {
    var statusKey = String(label).replace(/[^a-z0-9]+/gi, "_").toLowerCase();
    var display = t("dashboard.status." + statusKey, STATUS_LABEL[label] || label);
    return '<span class="chip ' + (tone || STATUS_CHIP[label] || "chip--dim") + '">' + esc(display) + "</span>";
  }

  function empty(title, body) {
    return (
      '<div class="empty-state">' +
      (title ? "<strong>" + esc(title) + "</strong>" : "") +
      (body ? "<span>" + esc(body) + "</span>" : "") +
      "</div>"
    );
  }

  /** label/value rows — the one layout every detail panel uses. */
  function dl(rows) {
    return (
      '<div class="dl">' +
      rows
        .map(function (row) {
          return (
            '<div class="dl__row"><div class="dl__label">' + esc(row[0]) + "</div>" +
            '<div class="dl__value">' + row[1] + "</div></div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  // ------------------------------------------------------------- routing

  var animationTimer = null;
  var panelTransition = null;
  var panelTransitionId = 0;

  /**
   * Plays the panel's entrance once. The class is removed again so the resting
   * state is plain visible content — an animation that never advances then
   * cannot leave the panel blank, and the motion still replays on every switch.
   */
  function playEntrance(panel) {
    if (!panel) return;
    window.clearTimeout(animationTimer);
    panel.classList.remove("is-animating");
    void panel.offsetWidth; // reflow, so re-adding the class restarts the run
    panel.classList.add("is-animating");
    animationTimer = window.setTimeout(function () {
      panel.classList.remove("is-animating");
    }, 1100);
  }

  function showPanel(name, push) {
    if (PANELS.indexOf(name) === -1) name = "overview";
    if (state.me) {
      if (name === "admin" && !state.me.user.staff) name = "overview";
      if (!(state.me.access && state.me.access.fullDashboard) && name !== "billing" && !(name === "admin" && state.me.user.staff)) {
        name = state.me.user.staff ? "admin" : "billing";
      }
    }
    var transitionId = ++panelTransitionId;
    var next = $('[data-panel-body="' + name + '"]');
    var current = $("[data-panel-body].is-active");

    $$(".dash__item[data-panel]").forEach(function (el) {
      el.classList.toggle("is-active", el.getAttribute("data-panel") === name);
      if (el.getAttribute("data-panel") === name) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current");
    });
    if (push && window.location.hash !== "#" + name) {
      window.history.replaceState(null, "", "#" + name);
    }
    if (name === "admin") loadAdmin();
    if (name === "support" && !state.activeTicketId && state.me && (state.me.reports || []).length) {
      var first = state.me.reports.find(function (r) { return r.status !== "closed"; }) || state.me.reports[0];
      loadCustomerTicket(first.id);
    }

    if (!next || current === next) {
      playEntrance(next);
      return;
    }

    if (panelTransition) panelTransition.cancel();
    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function enter() {
      if (transitionId !== panelTransitionId) return;
      if (current) {
        current.classList.remove("is-active", "is-animating");
        current.removeAttribute("aria-hidden");
      }
      if (panelTransition) { panelTransition.cancel(); panelTransition = null; }
      next.classList.add("is-active");
      if (SS.reveal) SS.reveal();
      playEntrance(next);
      window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
    }

    if (!current || reduced || !current.animate) {
      enter();
      return;
    }

    current.setAttribute("aria-hidden", "true");
    panelTransition = current.animate(
      [
        { opacity: 1, transform: "translateX(0)" },
        { opacity: 0, transform: "translateX(-10px)" },
      ],
      { duration: 135, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" },
    );
    panelTransition.finished.catch(function () {}).then(enter);
  }

  function initRouting() {
    $("#dashMenu").addEventListener("click", function (event) {
      var item = event.target.closest("[data-panel]");
      if (item) showPanel(item.getAttribute("data-panel"), true);
    });
    window.addEventListener("hashchange", function () {
      showPanel(window.location.hash.replace("#", ""), false);
    });
  }

  // -------------------------------------------------------------- modal

  function confirmModal(options) {
    return new Promise(function (resolve) {
      var backdrop = document.createElement("div");
      backdrop.className = "modal-backdrop";
      backdrop.innerHTML =
        '<div class="modal" role="dialog" aria-modal="true">' +
        "<h3>" + esc(options.title) + "</h3><p>" + esc(options.body) + "</p>" +
        '<div class="modal__actions">' +
        '<button class="btn btn--subtle" data-act="cancel">Cancel</button>' +
        '<button class="btn ' + (options.danger ? "btn--danger" : "btn--primary") +
        '" data-act="confirm">' + esc(options.confirmLabel || "Confirm") + "</button>" +
        "</div></div>";

      function close(result) {
        document.removeEventListener("keydown", onKey);
        backdrop.remove();
        resolve(result);
      }
      function onKey(event) {
        if (event.key === "Escape") close(false);
      }

      backdrop.addEventListener("click", function (event) {
        var button = event.target.closest("[data-act]");
        if (button) return close(button.getAttribute("data-act") === "confirm");
        if (event.target === backdrop) close(false);
      });
      document.addEventListener("keydown", onKey);
      document.body.appendChild(backdrop);
      var confirm = $('[data-act="confirm"]', backdrop);
      if (confirm) confirm.focus();
    });
  }

  function busy(button, on, label) {
    if (!button) return;
    button.disabled = !!on;
    if (on) {
      button.dataset.label = button.innerHTML;
      button.textContent = label || "Working…";
    } else if (button.dataset.label) {
      button.innerHTML = button.dataset.label;
      delete button.dataset.label;
    }
  }

  function fail(err) {
    SS.toast(err && err.message ? err.message : "Something went wrong.", "error");
  }

  // ------------------------------------------------------------ overview

  function renderStatus() {
    var lic = state.me.license;
    var head = $("#headStatus");
    var host = $("#statusCard");

    // The card already communicates the state. Repeating it as floating chips
    // beside the greeting made the overview busier without adding information.
    head.innerHTML = "";

    if (!lic) {
      host.innerHTML =
        '<div class="overview-card overview-card--empty"><div><span class="overview-card__label">No licence</span>' +
        '<strong>Choose a plan to get started.</strong></div>' +
        '<button class="btn btn--primary" data-go="billing">View plans</button></div>';
      return;
    }

    var left = lic.lifetime ? "Lifetime" : lic.pending ? "Not started" : (lic.daysLeft || 0) + " days";
    var expiry = lic.lifetime ? "Never" : lic.pending ? "On first launch" : SS.date(lic.expiresAt);
    var timed = !lic.lifetime && !lic.pending && lic.daysLeft !== null;
    var pct = timed ? Math.max(2, Math.min(100, (lic.daysLeft / 30) * 100)) : 100;
    var low = timed && lic.daysLeft <= 5;

    host.innerHTML =
      '<div class="overview-card membership-card"><div class="membership-card__content">' +
      '<div class="membership-card__top"><span class="section-label">Your membership</span>' + chip(lic.status) + '</div>' +
      '<h2>' + esc(lic.lifetime ? 'Lifetime access.' : lic.tier + ' access.') + '</h2>' +
      '<p>' + esc(lic.lifetime ? 'Your place in 67Client. Yours to keep.' : lic.pending ? 'Your time starts when you first launch the client.' : left + ' remaining on your current plan.') + '</p>' +
      '<div class="membership-card__facts"><div><span>Expires</span><strong>' + esc(expiry) + '</strong></div><div><span>Device</span><strong>' + (lic.hwid.bound ? 'Linked' : 'Not linked') + '</strong></div><button class="text-link" data-go="licence">View licence ↗</button></div>' +
      (timed ? '<div class="meter"><div class="meter__fill' + (low ? ' is-low' : '') + '" style="width:' + pct + '%"></div></div>' : '') + '</div>' +
      '<div class="membership-card__art" aria-hidden="true"><div class="member-pass"><span>67CLIENT / MEMBER</span><strong>67<i>+</i></strong><small>' + esc(lic.tier) + '<b>↗</b></small></div></div></div>' +
      (lic.status === "expired"
        ? '<div class="note note--warn mt-3">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 9v5"/><path d="M12 17.5h.01"/><circle cx="12" cy="12" r="9"/></svg>' +
          "<span>Your licence has expired. Renewing brings the same key back — your configs are untouched.</span></div>"
        : "");
  }

  function renderActions() {
    var lic = state.me.license;
    var actions = [
      ['download', 'M12 3v12m-5-5 5 5 5-5M4 19h16', 'Download client', 'Your personalised jar file.', !(lic && lic.entitled)],
      ['machine', 'M3 4h18v13H3zM8 21h8m-4-4v4', 'Your device', lic && lic.hwid.bound ? 'Manage your linked PC.' : 'Set up your first PC.', false],
      ['support', 'M21 11a8 8 0 0 1-8 8H6l-4 3V11a9 9 0 0 1 18 0M7 11h.01M12 11h.01M17 11h.01', 'Contact support', 'Pick up a conversation.', false]
    ];
    $('#quickActions').innerHTML = actions.map(function (action) {
      return '<button class="quick-action" data-go="' + action[0] + '"' + (action[4] ? ' disabled' : '') + '><span class="quick-action__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="' + action[1] + '"/></svg></span><strong>' + action[2] + '</strong><span>' + action[3] + '</span><b aria-hidden="true">↗</b></button>';
    }).join('');
  }

  var ACTIVITY_LABEL = {
    login: "Signed in",
    download: "Downloaded the client",
    hwid_reset: "Moved to a new PC",
    review: "Posted a review",
    redeem: "Redeemed a key",
    order: "Placed an order",
    report: "Sent a report",
    admin: "Account change",
  };

  function renderActivity() {
    if (!$("#activityFeed")) return;
    var items = state.me.activity || [];
    $("#activityFeed").innerHTML = items.length
      ? '<div class="feed">' +
        items
          .map(function (item) {
            return (
              '<div class="feed__row"><span class="feed__text">' +
              esc(ACTIVITY_LABEL[item.kind] || item.kind) +
              "</span>" +
              '<span class="feed__time">' + esc(SS.relative(item.at)) + "</span></div>"
            );
          })
          .join("") +
        "</div>"
      : empty("Nothing yet", "Downloads, resets and reports show up here.");
  }

  // ------------------------------------------------------------ download

  function syncDownloadCooldown(result) {
    // Use the server's remaining seconds so an incorrect browser clock is harmless.
    downloadWaitUntil = Date.now() + Math.max(0, Number(result.retryAfterSeconds) || 0) * 1000;
  }

  function renderDownload() {
    var lic = state.me.license;
    var entitled = !!(lic && lic.entitled);
    var open = state.me.downloads.open;
    var ready = state.me.downloads.ready;
    var button = $("#downloadBtn");
    var note = $("#downloadNote");
    var buildChip = $("#buildChip");
    var seconds = Math.max(0, Math.ceil((downloadWaitUntil - Date.now()) / 1000));
    var countdown = Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");

    var blocked = !entitled
      ? "You need an active licence to download."
      : !open
        ? "Downloads are not open yet."
        : !ready
          ? "No build has been uploaded to the server yet."
          : "";

    button.disabled = !!blocked || downloadBusy || seconds > 0;
    if (downloadBusy) button.textContent = "Starting…";
    else if (seconds > 0 && !blocked) button.textContent = "Download in " + countdown;
    else button.innerHTML = downloadButtonLabel;
    note.innerHTML = blocked
      ? '<span style="color:var(--warn)">' + esc(blocked) + "</span>"
      : seconds > 0
        ? "You can download once every five minutes. Your next download is available in " + countdown + "."
        : "Your key is already inside. One download every five minutes. Link expires " + state.me.downloads.ttl + " minutes after you press it.";
    buildChip.className = "chip " + (blocked || seconds > 0 ? "chip--warn" : "chip--ok");
    buildChip.textContent = blocked ? "unavailable" : seconds > 0 ? "cooldown" : "ready";
  }

  function startDownload() {
    // Re-check after the guide: a refresh can change access or cooldown.
    if (!state.me) return;
    renderDownload();
    if ($("#downloadBtn").disabled || downloadBusy) return;
    downloadBusy = true;
    renderDownload();
    SS.api
      .post("/api/download")
      .then(function (res) {
        syncDownloadCooldown(res);
        SS.toast("Your download is starting.", "ok");
        window.location.href = res.url;
        return refresh();
      })
      .catch(function (err) {
        if (err.code === "download_cooldown") syncDownloadCooldown(err);
        fail(err);
      })
      .then(function () {
        downloadBusy = false;
        renderDownload();
      });
  }

  function setProtectionReminder(visible) {
    $("#downloadProtectionReminder").classList.toggle("hidden", !visible);
    // Keep the reminder across reloads; the website cannot read Windows settings.
    try {
      if (visible) window.sessionStorage.setItem("67c-protection-reminder", "1");
      else window.sessionStorage.removeItem("67c-protection-reminder");
    } catch (_) { /* Storage can be unavailable in private browsing. */ }
  }

  function openDownloadGuide(helpOnly) {
    SS.downloadGuide({ t: t, helpOnly: helpOnly }).then(function (result) {
      if (result.remind) setProtectionReminder(true);
      if (result.support) showPanel("support", true);
      if (result.confirmed) startDownload();
    }).catch(fail);
  }

  function initDownload() {
    downloadButtonLabel = $("#downloadBtn").innerHTML;
    $("#downloadBtn").setAttribute("aria-haspopup", "dialog");
    window.setInterval(function () {
      if (state.me) renderDownload();
    }, 1000);
    $("#downloadBtn").addEventListener("click", function () {
      if (this.disabled || downloadBusy || !state.me) return;
      openDownloadGuide(false);
    });
    $("#downloadHelpBtn").addEventListener("click", function () { openDownloadGuide(true); });
    $("#downloadProtectionDone").addEventListener("click", function () { setProtectionReminder(false); });
    try {
      if (window.sessionStorage.getItem("67c-protection-reminder") === "1") setProtectionReminder(true);
    } catch (_) { /* The reminder also works without browser storage. */ }
  }

  // ------------------------------------------------------------- licence

  function renderLicence() {
    var lic = state.me.license;
    var status = $("#licenceStatus");
    var host = $("#licenceCard");

    if (!lic) {
      status.innerHTML = chip("none");
      host.innerHTML =
        '<div class="block"><div class="block__body">' +
        empty("No licence on this account", "Redeem a key below, or choose a plan.") +
        "</div></div>";
      return;
    }

    status.innerHTML = chip(lic.status);
    var masked = lic.key.slice(0, 4) + "••••-••••-••••-••••-••••";
    var expires = lic.lifetime ? "Never" : lic.pending ? "On first launch" : SS.date(lic.expiresAt);

    host.innerHTML =
      '<div class="focus-card licence-card">' +
      '<div class="licence-card__top"><div><span class="section-label">Licence key</span>' +
      '<div class="keyline is-masked" id="keyLine">' +
      '<code id="keyValue">' + esc(masked) + "</code>" +
      '</div></div><div class="key-actions"><button class="btn btn--subtle btn--sm" id="keyReveal">Reveal</button>' +
      '<button class="btn btn--ghost btn--sm" id="keyCopy">Copy</button></div></div>' +
      '<div class="licence-card__facts"><div><span>Plan</span><b>' + esc(lic.tier) +
      '</b></div><div><span>Expires</span><b>' + esc(expires) +
      '</b></div><div><span>Last check</span><b>' +
      (lic.lastVerifyAt ? esc(SS.relative(lic.lastVerifyAt)) : "Never") + "</b></div></div></div>";

    var reveal = $("#keyReveal");
    reveal.addEventListener("click", function () {
      var line = $("#keyLine");
      var hidden = line.classList.contains("is-masked");
      $("#keyValue").textContent = hidden ? lic.key : masked;
      line.classList.toggle("is-masked", !hidden);
      reveal.textContent = hidden ? "Hide" : "Reveal";
    });
    $("#keyCopy").addEventListener("click", function () {
      SS.copy(lic.key)
        .then(function () {
          SS.toast("Licence key copied.", "ok");
        })
        .catch(function () {
          SS.toast("Could not copy — reveal the key and copy it manually.", "error");
        });
    });
  }

  function initRedeem() {
    $("#redeemForm").addEventListener("submit", function (event) {
      event.preventDefault();
      var input = $("#redeemKey");
      var button = $('#redeemForm button[type="submit"]');
      busy(button, true, "Redeeming…");
      SS.api
        .post("/api/redeem", { key: input.value })
        .then(function () {
          SS.toast("Key redeemed — your licence is active.", "ok");
          input.value = "";
          return refresh();
        })
        .catch(fail)
        .then(function () {
          busy(button, false);
        });
    });
  }

  // ------------------------------------------------------------- machine

  function renderMachine() {
    var lic = state.me.license;
    var status = $("#machineStatus");
    var host = $("#machineCard");

    if (!lic) {
      status.innerHTML = chip("none");
      host.innerHTML = '<div class="block"><div class="block__body">' + empty("No licence yet", "Nothing to link.") + "</div></div>";
      return;
    }

    var hwid = lic.hwid;
    var canReset = lic.entitled && hwid.bound && hwid.resetAllowed !== false && hwid.canReset;
    status.innerHTML = hwid.bound ? chip("linked", "chip--ok") : chip("not linked", "chip--dim");

    var reason = !lic.entitled
      ? "Your licence is not active."
      : hwid.resetAllowed === false
        ? "No hardware ID reset is included with Monthly."
      : !hwid.bound
        ? "No PC is linked yet — the first launch claims it."
        : !hwid.canReset
          ? "Available again " + SS.relative(hwid.nextAllowedAt) + "."
          : "";

    host.innerHTML =
      '<div class="focus-card machine-card">' +
      '<div><span class="section-label">Linked fingerprint</span><code class="machine-card__id">' +
      esc(hwid.fingerprint || "Nothing linked yet") + "</code></div>" +
      '<div class="machine-card__reset"><span>' + (hwid.resetAllowed === false ? "Plan rule" : "Next free move") + '</span><b>' +
      (hwid.resetAllowed === false ? "No hardware ID reset" : canReset ? "Available now" : hwid.nextAllowedAt ? SS.date(hwid.nextAllowedAt) : "After first launch") +
      '</b><small>' + (hwid.resetAllowed === false ? "Monthly licence" : hwid.cooldownDays + " day cooldown") + "</small></div>" +
      '<div class="machine-card__action"><button class="btn btn--danger" id="hwidReset"' +
      (canReset ? "" : " disabled") + ">Unlink PC</button>" +
      (reason ? "<span>" + esc(reason) + "</span>" : "") + "</div></div>";

    var button = $("#hwidReset");
    if (!button || button.disabled) return;
    button.addEventListener("click", function () {
      confirmModal({
        title: "Move your licence to another PC?",
        body:
          "This PC is unlinked and the next computer that launches the client claims your licence. " +
          "It uses your free reset — the next one is available in " + hwid.cooldownDays + " days.",
        confirmLabel: "Unlink this PC",
        danger: true,
      }).then(function (ok) {
        if (!ok) return;
        busy(button, true, "Unlinking…");
        SS.api
          .post("/api/hwid/reset")
          .then(function () {
            SS.toast("Unlinked. Launch the client on your new PC to claim it.", "ok");
            return refresh();
          })
          .catch(fail)
          .then(function () {
            busy(button, false);
          });
      });
    });
  }

  // ------------------------------------------------------------- support

  function reportRows(reports) {
    if (!reports.length) return empty('No tickets yet', 'Your conversations with support will appear here.');
    return '<div class="reportlist">' + reports.map(function (r) {
      return '<button class="reportlist__row ticket-row' + (state.activeTicketId === r.id ? ' is-active' : '') + '" data-ticket-open="' + r.id + '" aria-pressed="' + (state.activeTicketId === r.id) + '"><div class="ticket-row__line"><span class="ticket-reference">#' + r.id + '</span>' + chip(r.status) + '</div><strong class="reportlist__subject">' + esc(r.subject) + '</strong><div class="reportlist__meta"><span>' + (r.messageCount || 0) + ' replies</span><span>' + esc(SS.relative(r.updatedAt || r.createdAt)) + '</span></div></button>';
    }).join('') + '</div>';
  }

  function ticketMessages(messages) {
    if (!messages.length) return '<div class="ticket-thread__empty">No replies yet.</div>';
    return messages
      .map(function (m) {
        return (
          '<div class="ticket-message ticket-message--' + esc(m.authorRole) + '">' +
          '<div class="ticket-message__meta"><span class="message-avatar" aria-hidden="true">' + esc(String(m.authorName || '67').slice(0, 1)) + '</span><strong>' + esc(m.authorName) + "</strong><span>" +
          (m.authorRole === "staff" ? "Staff" : "Customer") + " · " + esc(SS.relative(m.createdAt)) + "</span></div>" +
          '<div class="ticket-message__body">' + esc(m.body) + "</div></div>"
        );
      })
      .join("");
  }

  function renderCustomerTicket(data) {
    var report = data.report;
    var closed = report.status === "closed";
    $("#ticketDetail").classList.remove("hidden");
    $("#ticketDetail").innerHTML =
      '<div class="ticket-detail__head"><div><span class="section-label">Ticket #' + report.id + " · " + esc(report.kind) +
      '</span><h2>' + esc(report.subject) + "</h2></div>" + chip(report.status) + "</div>" +
      '<div class="ticket-origin"><span>Original report</span><p>' + esc(report.body) + "</p>" +
      (report.log ? '<details><summary>Crash report / latest.log</summary><pre>' + esc(report.log) + "</pre></details>" : "") + "</div>" +
      '<div class="ticket-thread" id="customerTicketThread">' + ticketMessages(data.messages || []) + "</div>" +
      (closed
        ? '<div class="ticket-closed-note">This ticket is closed. Staff can reopen it if more work is needed.</div>'
        : '<form class="ticket-reply" data-ticket-reply="' + report.id + '"><textarea class="textarea" minlength="2" maxlength="2000" aria-label="Reply to support" placeholder="Write your reply…" required></textarea><div><span>Maximum 2,000 characters</span><button class="btn btn--primary" type="submit">Send reply</button></div></form>');
    var thread = $("#customerTicketThread");
    if (thread) thread.scrollTop = thread.scrollHeight;
  }

  function loadCustomerTicket(id) {
    state.activeTicketId = Number(id);
    $("#reportList").innerHTML = reportRows(state.me.reports || []);
    $("#ticketDetail").classList.remove("hidden");
    $("#ticketDetail").innerHTML = '<div class="empty-state"><span>Loading conversation…</span></div>';
    var requestedId = state.activeTicketId;
    return SS.api.get('/api/reports/' + requestedId).then(function (data) {
      if (state.activeTicketId === requestedId) renderCustomerTicket(data);
    }).catch(function (err) {
      if (state.activeTicketId !== requestedId) return;
      $('#ticketDetail').innerHTML = empty('Could not load this conversation', 'Select the ticket again to retry.');
      fail(err);
    });
  }

  function renderReports() {
    var reports = state.me.reports || [];
    var open = reports.filter(function (r) {
      return r.status !== "closed";
    }).length;

    $('#ticketCount').textContent = reports.length;
    $('#newTicketBtn').disabled = open > 0;
    $('#newTicketBtn').title = open > 0 ? 'Reply to your existing ticket until it is closed.' : 'Start a new conversation';
    $('#supportSummaryTitle').textContent = open ? 'Your conversation is open' : 'Here when you need a hand';
    $('#supportSummaryText').textContent = open ? 'Read the latest reply and continue below.' : 'For installation help, start with the setup guide or open a ticket.';
    $('#reportList').innerHTML = reportRows(reports);
    if ($("#overviewReports")) $("#overviewReports").innerHTML = reportRows(reports.slice(0, 4));

    var badge = $("#reportBadge");
    badge.textContent = open;
    badge.classList.toggle("hidden", open === 0);
    var button = $('#reportForm button[type="submit"]');
    button.disabled = open > 0 || !!button.dataset.label;
    if (!button.dataset.label) button.textContent = open > 0 ? "You already have an open ticket" : "Open ticket";
    $("#reportLimitHint").textContent = open > 0
      ? "Reply to your existing conversation. You can open a new ticket after staff closes it."
      : "Maximum 1 open ticket per account.";
  }

  function initReportForm() {
    $('#newTicketBtn').addEventListener('click', function () {
      $('#ticketComposer').open = true;
      $('#ticketComposer').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
      $('#reportSubject').focus({ preventScroll: true });
    });
    $('#overviewReports').addEventListener('click', function (event) {
      var button = event.target.closest('[data-ticket-open]');
      if (!button) return;
      loadCustomerTicket(Number(button.getAttribute('data-ticket-open')));
      showPanel('support', true);
    });
    $("#reportForm").addEventListener("submit", function (event) {
      event.preventDefault();
      var button = $('#reportForm button[type="submit"]');
      if (button.disabled) return;
      busy(button, true, "Sending…");
      SS.api
        .post("/api/reports", {
          kind: $("#reportKind").value,
          subject: $("#reportSubject").value,
          body: $("#reportBody").value,
          log: $("#reportLog").value,
        })
        .then(function (res) {
          SS.toast("Report #" + res.report.id + " sent. We will pick it up.", "ok");
          $("#reportSubject").value = "";
          $("#reportBody").value = "";
          $("#reportLog").value = "";
          $("#ticketComposer").open = false;
          return refresh().then(function () { return loadCustomerTicket(res.report.id); });
        })
        .catch(fail)
        .then(function () {
          busy(button, false);
          renderReports();
        });
    });

    $("#reportList").addEventListener("click", function (event) {
      var button = event.target.closest("[data-ticket-open]");
      if (button) loadCustomerTicket(Number(button.getAttribute("data-ticket-open")));
    });

    $("#ticketDetail").addEventListener("submit", function (event) {
      var form = event.target.closest("[data-ticket-reply]");
      if (!form) return;
      event.preventDefault();
      var id = Number(form.getAttribute("data-ticket-reply"));
      var button = $('button[type="submit"]', form);
      var textarea = $("textarea", form);
      busy(button, true, "Sending…");
      SS.api
        .post("/api/reports/" + id + "/messages", { body: textarea.value })
        .then(function () {
          textarea.value = "";
          SS.toast("Reply sent to staff.", "ok");
          return refresh().then(function () { if (state.activeTicketId === id) return loadCustomerTicket(id); });
        })
        .catch(fail)
        .then(function () { busy(button, false); });
    });
  }

  // ------------------------------------------------------------- account

  var DISCORD_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.7 5.1a18 18 0 0 0-4.4-1.4l-.6 1.2a16.6 16.6 0 0 0-5.4 0l-.6-1.2a18 18 0 0 0-4.4 1.4C1.5 9.2.7 13.2 1.1 17.1a18 18 0 0 0 5.4 2.7l1.1-1.8-1.7-.8.4-.3a12.8 12.8 0 0 0 11.4 0l.4.3-1.7.8 1.1 1.8a18 18 0 0 0 5.4-2.7c.5-4.5-.9-8.5-3.2-12ZM8.5 14.7c-1 0-1.7-.9-1.7-2s.7-2 1.7-2 1.7.9 1.7 2-.8 2-1.7 2Zm7 0c-1 0-1.7-.9-1.7-2s.7-2 1.7-2 1.7.9 1.7 2-.8 2-1.7 2Z"/></svg>';
  var ACCOUNT_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>';

  function discordErrorMessage() {
    var error = new URLSearchParams(window.location.search).get("discord_error");
    if (!error) return "";
    return {
      not_configured: "Discord linking is temporarily unavailable. Please contact support.",
      expired: "Your connection request expired. Connect Discord again to try once more.",
      denied: "The connection was cancelled. You can try again whenever you're ready.",
      state: "We couldn't verify this connection request. Please start again from this page.",
      conflict: "These accounts couldn't be linked. Use the Discord account that owns your licence, or contact support if it is already linked elsewhere.",
      discord: "Discord couldn't complete the connection. Please try again in a moment."
    }[error] || "Discord couldn't complete the connection. Please try again or contact support.";
  }

  function renderAccount() {
    var profile = state.me.profile || {};
    var user = state.me.user;
    var lic = state.me.license;
    var linked = !!profile.discordId;
    var full = !!(state.me.access && state.me.access.fullDashboard);
    var accountHost = $("#accountCard");
    var billingHost = $("#billingDiscord");
    accountHost.innerHTML = "";
    billingHost.innerHTML = "";
    var error = discordErrorMessage();
    var notice = error ? '<div class="account-notice" role="alert"><strong>Discord connection</strong><p>' + esc(error) + '</p></div>' : '';
    if (!full) {
      billingHost.innerHTML = '<section class="billing-activation" aria-labelledby="billingDiscordTitle">' +
        '<div class="billing-activation__heading"><span class="billing-activation__icon billing-activation__icon--discord">' + DISCORD_ICON + '</span>' +
        '<div><span class="section-label">' + esc(t("dashboard.onboarding.existing", "Existing customer")) + '</span>' +
        '<h2 id="billingDiscordTitle">' + esc(t("dashboard.onboarding.discord_title", "Already own 67Client?")) + '</h2></div></div>' +
        '<p>' + esc(t("dashboard.onboarding.discord_copy", "Connect the Discord account that owns your licence. Your key and remaining time stay the same.")) + '</p>' + notice +
        '<a class="btn btn--ghost billing-activation__action" href="/auth/discord?next=billing">' + DISCORD_ICON +
        esc(t("dashboard.onboarding.discord_action", "Connect Discord")) + ACCOUNT_ARROW + '</a></section>';
      return;
    }
    var discordName = profile.discordDisplayName || profile.discordUsername || "Discord user";
    var planName = lic ? ({ monthly: "Monthly", lifetime: "Lifetime", trial: "Trial", custom: "Custom" }[lic.tier] || lic.tier) : "No licence";
    var expires = lic ? (lic.pending ? "Starts on first launch" : lic.lifetime ? "No expiry date" : SS.date(lic.expiresAt)) : "Choose a plan to get started";
    var discordAvatar = profile.discordAvatar && /^https:\/\/cdn\.discordapp\.com\//.test(profile.discordAvatar)
      ? '<img src="' + esc(profile.discordAvatar) + '" alt="" width="44" height="44" />'
      : DISCORD_ICON;

    accountHost.innerHTML = notice +
      '<div class="account-profile"><div class="account-profile__identity">' +
      '<img class="account-profile__avatar" src="' + esc(user.avatar) + '" alt="" width="64" height="64" />' +
      '<div class="account-profile__details"><span class="section-label">Your profile</span><h2>' + esc(user.name) + '</h2>' +
      '<p>' + esc(user.email) + '</p></div></div>' +
      '<div class="account-profile__signin"><span class="account-google" aria-hidden="true">G</span><div><strong>Google account</strong>' +
      '<span class="account-verified">' + CHECK + 'Verified email</span></div></div></div>' +
      '<div class="account-grid"><section class="account-connection" aria-labelledby="discordConnectionTitle">' +
      '<div class="account-connection__head"><span class="account-service-icon">' + DISCORD_ICON + '</span>' +
      (linked ? chip("Connected", "chip--ok") : chip("Not connected", "chip--dim")) + '</div>' +
      '<div class="account-connection__body"><span class="section-label">Connected accounts</span><h2 id="discordConnectionTitle">Your place in the server.</h2>' +
      '<p>Link your Discord to bring your <strong>67+</strong> membership to the community.</p>' +
      (linked
        ? '<div class="account-discord-user"><span class="account-discord-user__avatar">' + discordAvatar + '</span>' +
          '<div><strong>' + esc(discordName) + '</strong><span>' + esc(profile.discordUsername ? '@' + profile.discordUsername : profile.discordId) + '</span></div></div>'
        : '<div class="account-connection__benefit"><span class="account-plus">67+</span><div><strong>Your member role</strong><span>Added automatically to your connected Discord account.</span></div></div>') +
      '</div><div class="account-connection__footer">' +
      (linked
        ? '<div class="account-role"><span class="account-role__dot' + (profile.roleGranted ? ' is-granted' : '') + '"></span>' +
          '<span>' + (profile.roleGranted ? '67+ role active' : '67+ role pending') + '</span></div>' +
          '<button class="account-disconnect" id="discordUnlink" type="button">Disconnect</button>'
        : '<a class="btn account-connect" href="/auth/discord">' + DISCORD_ICON + 'Connect Discord' + ACCOUNT_ARROW + '</a>' +
          '<span class="account-connection__hint">Your Google login stays the same.</span>') +
      '</div></section>' +
      '<section class="account-membership" aria-labelledby="accountMembershipTitle"><div class="account-membership__top">' +
      '<span class="section-label">Membership</span>' + (lic ? chip(lic.status) : '') + '</div>' +
      '<div class="account-membership__mark" aria-hidden="true">67<span>+</span></div>' +
      '<h2 id="accountMembershipTitle">' + esc(planName) + '</h2><p>' + esc(expires) + '</p>' +
      '<div class="account-membership__footer"><button class="account-link" type="button" data-go="' + (lic ? 'licence' : 'billing') + '">' +
      (lic ? 'View your licence' : 'Explore plans') + ACCOUNT_ARROW + '</button></div></section></div>' +
      '<div class="account-help"><span>Need a hand with your account?</span><button class="account-link" type="button" data-go="support">Contact support ' + ACCOUNT_ARROW + '</button></div>';

    var unlink = $("#discordUnlink");
    if (unlink) {
      unlink.addEventListener("click", function () {
        confirmModal({ title: "Disconnect Discord?", body: "The 67+ role will be removed automatically. Your licence remains on your website account.", confirmLabel: "Disconnect", danger: true })
          .then(function (ok) {
            if (!ok) return;
            return SS.api.post("/api/profile/discord/unlink", {}).then(function () {
              SS.toast("Discord disconnected. Role removal is queued.", "ok");
              return refresh();
            }).catch(fail);
          });
      });
    }
  }

  // ------------------------------------------------------------- reviews

  function renderReview() {
    var host = $("#reviewCard");
    var lic = state.me.license;
    var entitled = !!(lic && lic.entitled);
    var mine = state.me.review;

    if (!entitled) {
      host.innerHTML =
        '<div class="block"><div class="block__body">' +
        empty("Reviews are for licence holders", "Once your licence is active you can post one here.") +
        "</div></div>";
      return;
    }

    var rating = mine ? mine.rating : 0;
    var text = mine ? mine.body : "";
    var stars = "";
    for (var i = 1; i <= 5; i++) {
      stars +=
        '<button type="button" data-star="' + i + '" class="' + (i <= rating ? "is-on" : "") +
        '" aria-pressed="' + (i === rating) + '" aria-label="' + i + ' star' + (i === 1 ? "" : "s") + '">' + SOLID_STAR + "</button>";
    }

    host.innerHTML =
      '<div class="block">' +
      '<div class="block__head"><h3>' + (mine ? "Edit your review" : "Write a review") + "</h3>" +
      (mine ? chip(mine.status) : "") + "</div>" +
      '<div class="block__body form-stack">' +
      '<div class="field"><label>Rating</label><div class="star-picker" id="starPicker" role="group" aria-label="Rating">' + stars + "</div></div>" +
      '<div class="field"><label for="reviewBody">Your review</label>' +
      '<textarea class="textarea" id="reviewBody" maxlength="1000" placeholder="What you use it for, what works, what could be better…">' +
      esc(text) + "</textarea>" +
      '<span class="hint"><span id="reviewCount">' + text.length +
      "</span>/1000 · staff checks every new or edited review before publication</span></div>" +
      "</div>" +
      '<div class="block__foot">' +
      '<button class="btn btn--primary" id="reviewSave">' + (mine ? "Submit changes" : "Submit for review") + "</button>" +
      (mine ? '<button class="btn btn--subtle" id="reviewDelete">Delete</button>' : "") +
      "</div></div>";

    var body = $("#reviewBody");
    var picked = rating;

    $("#starPicker").addEventListener("click", function (event) {
      var button = event.target.closest("[data-star]");
      if (!button) return;
      picked = Number(button.getAttribute("data-star"));
      $$("[data-star]", this).forEach(function (el) {
        el.classList.toggle("is-on", Number(el.getAttribute("data-star")) <= picked);
        el.setAttribute("aria-pressed", String(Number(el.getAttribute("data-star")) === picked));
      });
    });

    body.addEventListener("input", function () {
      $("#reviewCount").textContent = body.value.length;
    });

    $("#reviewSave").addEventListener("click", function () {
      var button = this;
      if (!picked) return SS.toast("Pick a star rating first.", "error");
      busy(button, true, "Saving…");
      SS.api
        .post("/api/reviews", { rating: picked, body: body.value })
        .then(function (res) {
          SS.toast(res.review.status === "pending" ? "Thanks! Waiting for approval." : "Thanks! Your review is live.", "ok");
          return refresh();
        })
        .catch(fail)
        .then(function () {
          busy(button, false);
        });
    });

    var del = $("#reviewDelete");
    if (del) {
      del.addEventListener("click", function () {
        confirmModal({
          title: "Delete your review?",
          body: "It disappears from the public reviews page immediately.",
          confirmLabel: "Delete",
          danger: true,
        }).then(function (ok) {
          if (!ok) return;
          SS.api
            .del("/api/reviews")
            .then(function () {
              SS.toast("Review deleted.", "ok");
              return refresh();
            })
            .catch(fail);
        });
      });
    }
  }

  // ------------------------------------------------------------- billing

  function renderBilling() {
    var host = $("#billingPlans");
    var plans = (state.site && state.site.plans) || [];
    var full = !!(state.me.access && state.me.access.fullDashboard);
    var lifetimeOwned = !!(state.me.access && state.me.access.lifetimeOwned);

    $("#billingRedeem").innerHTML = full ? "" :
      '<section class="billing-activation" aria-labelledby="billingRedeemTitle">' +
      '<div class="billing-activation__heading"><span class="billing-activation__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="8" cy="10" r="4"/><path d="m11 13 8 8m-5-5 3-3m0 6 3-3"/></svg></span>' +
      '<div><span class="section-label">' + esc(t("dashboard.onboarding.key_label", "Already have a key?")) + '</span>' +
      '<h2 id="billingRedeemTitle">' + esc(t("dashboard.onboarding.key_title", "Activate your licence")) + '</h2></div></div>' +
      '<p id="billingRedeemHint">' + esc(t("dashboard.onboarding.key_copy", "Enter your licence key to unlock your dashboard and download the client.")) + '</p>' +
      '<form id="billingRedeemForm" class="billing-redeem-form"><label class="sr-only" for="billingRedeemKey">' + esc(t("dashboard.onboarding.key_input", "Licence key")) + '</label>' +
      '<input class="input input--mono" id="billingRedeemKey" name="key" aria-describedby="billingRedeemHint" placeholder="67C-XXXX-XXXX-XXXX-XXXX-XXXX" maxlength="40" autocomplete="off" spellcheck="false" required />' +
      '<button class="btn btn--ghost" type="submit">' + esc(t("dashboard.onboarding.key_action", "Activate")) + ACCOUNT_ARROW + '</button></form></section>';

    var billingRedeemForm = $("#billingRedeemForm");
    if (billingRedeemForm) billingRedeemForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var button = $('#billingRedeemForm button[type="submit"]');
      busy(button, true, "Redeeming…");
      SS.api.post("/api/redeem", { key: $("#billingRedeemKey").value }).then(function () {
        SS.toast("Licence activated. Your full dashboard is now available.", "ok");
        return refresh().then(function () { showPanel("overview", true); });
      }).catch(fail).then(function () { busy(button, false); });
    });

    host.innerHTML = plans.length
      ? plans
          .map(function (plan) {
            var features = (plan.features || [])
              .map(function (f) {
                return "<li>" + CHECK + "<span>" + esc(f) + "</span></li>";
              })
              .join("");
            var price = plan.price
              ? "<b>" + esc(plan.price) + "</b>"
              : '<b class="is-blank">—</b>';
            return (
              '<article class="dplan' + (plan.highlight ? " dplan--best" : "") + '">' +
              '<div class="dplan__head">' +
              '<div class="dplan__title"><span class="dplan__name">' + esc(plan.name) + "</span>" +
              (plan.badge ? chip(plan.badge, "chip--accent") : "") + "</div>" +
              '<div class="dplan__price">' + price + "<span>" + esc(plan.period || "") + "</span></div>" +
              '<div class="dplan__tagline">' + esc(plan.tagline || "") + "</div></div>" +
              '<ul class="dplan__features">' + features + "</ul>" +
              '<div class="dplan__foot"><button class="btn ' +
              (plan.highlight ? "btn--primary" : "btn--ghost") + ' btn--block" data-reserve="' +
                esc(plan.id) + '"' + (lifetimeOwned ? ' disabled>' + esc(t("dashboard.onboarding.lifetime_owned", "You already have lifetime access")) : state.site.payments && state.site.payments.available ? '>' + esc(t("dashboard.onboarding.choose", "Choose {plan}").replace("{plan}", plan.name)) + ACCOUNT_ARROW : ' disabled>' + esc(t("dashboard.onboarding.sales_closed", "Sales are not open yet"))) + "</button></div></article>"
            );
          })
          .join("")
      : '<div class="block"><div class="block__body">' + empty("No plans published yet", "") + "</div></div>";

    var orders = state.me.orders || [];
    $("#ordersList").innerHTML = orders.length
      ? '<div class="reportlist">' +
        orders
          .map(function (order) {
            return (
              '<div class="reportlist__row"><div>' +
              '<div class="reportlist__subject mono">' + esc(order.id) + "</div>" +
                '<div class="reportlist__meta">' + esc(order.plan) + (order.payment ? " · " + (order.payment.provider === 'sellauth' ? 'SellAuth' : 'Stripe') : '') + " · " + SS.date(order.createdAt) + "</div>" +
                (order.payment && order.payment.licenseKey ? '<div class="reportlist__meta">Licence key: <code>' + esc(order.payment.licenseKey) + '</code></div><button class="text-link" type="button" data-copy-order="' + esc(order.id) + '">Copy key</button> · <button class="text-link" type="button" data-go="download">Download client</button><div class="reportlist__meta">' + (order.payment.emailStatus === 'sent' ? 'Your key has also been emailed to you.' : 'Your key is ready here. Email delivery is retrying automatically.') + '</div>' : '') + '</div>' +
              chip(order.payment ? (order.payment.delivered ? order.payment.state : order.payment.state === 'paid' ? 'activating' : order.payment.state) : order.status) +
              (order.payment && order.status === 'paid' ? '<a class="text-link" href="' + esc(order.payment.confirmationUrl) + '">Confirmation</a>' : '') +
              (order.status === 'paid' ? '<a class="text-link" href="/withdraw">Withdraw</a>' : '') + "</div>"
            );
          })
          .join("") +
        "</div>"
      : '<div class="billing-orders-empty"><span class="billing-orders-empty__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6m-6 4h4"/></svg></span><div><strong>' +
        esc(t("dashboard.onboarding.no_orders", "A fresh start.")) + '</strong><p>' +
        esc(t("dashboard.onboarding.orders_copy", "Your orders and payment status will appear here after checkout.")) + '</p></div></div>';
  }

  function initBilling() {
    document.querySelector('#ordersList').addEventListener('click', function (event) {
      var button = event.target.closest('[data-copy-order]');
      if (!button) return;
      var order = (state.me.orders || []).find(function (o) { return o.id === button.getAttribute('data-copy-order'); });
      if (order && order.payment && order.payment.licenseKey) navigator.clipboard.writeText(order.payment.licenseKey).then(function () {
        SS.toast('Licence key copied.', 'ok');
      }).catch(function () { SS.toast('Select and copy the licence key shown above.', 'ok'); });
    });
    document.querySelector('#billingPlans').addEventListener('click', function (event) {
      var button = event.target.closest('[data-reserve]');
      if (button && !button.disabled && !(state.me.access && state.me.access.lifetimeOwned)) window.location.assign('/checkout?plan=' + encodeURIComponent(button.getAttribute('data-reserve')));
    });
  }

  function applyAccessGate() {
    var full = !!(state.me.access && state.me.access.fullDashboard);
    var admin = !!state.me.user.admin;
    document.body.classList.toggle("dashboard-onboarding", !full && !state.me.user.staff);
    $$(".dash__item[data-panel]").forEach(function (item) {
      var panel = item.getAttribute("data-panel");
      var allowed = full || panel === "billing";
      if (panel === "admin") allowed = !!state.me.user.staff;
      item.classList.toggle("hidden", !allowed);
      item.disabled = !allowed;
    });
    $("#staffTabLabel").textContent = admin ? t("dashboard.nav.admin", "Admin") : "Support tickets";
    $("#staffPanelTitle").textContent = admin ? t("dashboard.title.admin", "Admin") : "Support tickets";
    var lostTeamAccess = !state.me.user.canManageTeam && $('[data-admin-view="team"]').classList.contains("is-active");
    $$("[data-admin-tab]").forEach(function (tab) {
      var name = tab.getAttribute("data-admin-tab");
      var tickets = name === "tickets";
      var allowed = name === "team" ? !!state.me.user.canManageTeam : admin || tickets;
      tab.classList.toggle("hidden", !allowed);
      tab.disabled = !allowed;
      if (!admin || lostTeamAccess) tab.classList.toggle("is-active", tickets);
    });
    $$("[data-admin-view]").forEach(function (view) {
      var name = view.getAttribute("data-admin-view");
      var tickets = name === "tickets";
      var allowed = name === "team" ? !!state.me.user.canManageTeam : admin || tickets;
      view.classList.toggle("hidden", !allowed);
      if (!admin || lostTeamAccess) view.classList.toggle("is-active", tickets);
    });
    if (!full && !state.me.user.staff) showPanel("billing", false);
    document.documentElement.classList.add("dashboard-ready");
  }

  // --------------------------------------------------------------- admin

  function table(columns, rows) {
    if (!rows.length) return empty("Nothing here yet", "");
    return (
      '<div class="table-scroll"><table class="data"><thead><tr>' +
      columns
        .map(function (c) {
          return "<th>" + c + "</th>";
        })
        .join("") +
      "</tr></thead><tbody>" + rows.join("") + "</tbody></table></div>"
    );
  }

  function loadAdmin(force) {
    if (!state.me || !state.me.user.staff) return;
    if (state.admin.loaded && !force) return;
    state.admin.loaded = true;
    $("#adminStats").style.gridTemplateColumns = state.me.user.admin ? "" : "repeat(2, minmax(0, 1fr))";

    if (!state.me.user.admin) {
      loadAdminReports();
      return;
    }

    SS.api
      .get("/api/admin/overview")
      .then(function (data) {
        $("#adminStats").innerHTML = [
          ["Licences", data.licenses.total],
          ["Active", data.licenses.entitled],
          ["Unclaimed", data.licenses.unclaimed],
          ["New this week", data.licenses.newThisWeek],
          ["Open orders", data.orders.pending],
          ["Open reports", data.reports.open],
          ["Reviews to check", data.reviews.pending],
          ["Role queue", data.roleQueue],
        ]
          .map(function (pair) {
            return '<div class="admin-stat"><strong>' + SS.number(pair[1]) + "</strong><span>" + pair[0] + "</span></div>";
          })
          .join("");

        var badge = $("#adminBadge");
        var open = data.orders.pending + data.reviews.pending + data.reports.open + data.roleQueue;
        badge.textContent = open;
        badge.classList.toggle("hidden", open === 0);

        $("#adminEvents").innerHTML = table(
          ["When", "Who", "Action"],
          data.events.map(function (e) {
            return (
              "<tr><td>" + esc(SS.relative(e.at)) + "</td>" +
              '<td class="mono">' + esc(e.discordId || "—") + "</td>" +
              "<td>" + esc(e.kind) + (e.detail ? " · " + esc(e.detail) : "") + "</td></tr>"
            );
          }),
        );
      })
      .catch(function (err) {
        state.admin.loaded = false;
        fail(err);
      });

    loadAdminLicences("");
    loadAdminReviews();
    loadAdminOrders();
    loadAdminReports();
    loadAdminRoleQueue();
    if (state.me.user.canManageTeam) loadAdminTeam();
  }

  function loadAdminLicences(query) {
    SS.api
      .get("/api/admin/licenses?q=" + encodeURIComponent(query || ""))
      .then(function (data) {
        $("#adminLicences").innerHTML = table(
          ["Key", "Owner", "Plan", "Status", "Expires", "PC", "Actions"],
          data.licenses.map(function (lic) {
            return (
              '<tr><td class="mono">' + esc(lic.key) + "</td>" +
              '<td>' + esc(lic.email || lic.discordUsername || lic.ownerId || lic.discordId || "—") +
              (lic.discordId ? '<br><span class="mono muted">' + esc(lic.discordId) + "</span>" : "") + "</td>" +
              "<td>" + esc(lic.tier) + "</td>" +
              "<td>" + chip(lic.status) + "</td>" +
              "<td>" + (lic.expiresAt ? SS.date(lic.expiresAt) : "lifetime") + "</td>" +
              "<td>" + (lic.hwidBound ? "linked" : "—") + " (" + lic.hwidResets + ")</td>" +
              '<td><div class="row" style="gap:5px;flex-wrap:nowrap">' +
              '<button class="btn btn--subtle btn--sm" data-lic="' + esc(lic.key) + '" data-action="extend">+30d</button>' +
              '<button class="btn btn--subtle btn--sm" data-lic="' + esc(lic.key) + '" data-action="resethwid">PC</button>' +
              '<button class="btn btn--subtle btn--sm" data-lic="' + esc(lic.key) + '" data-action="' +
              (lic.status === "revoked" ? "unrevoke" : "revoke") + '">' +
              (lic.status === "revoked" ? "Restore" : "Revoke") + "</button>" +
              "</div></td></tr>"
            );
          }),
        );
      })
      .catch(fail);
  }

  function loadAdminReviews() {
    SS.api
      .get("/api/admin/reviews")
      .then(function (data) {
        var order = { pending: 0, published: 1, hidden: 2 };
        var reviews = data.reviews.slice().sort(function (a, b) {
          return order[a.status] - order[b.status] || b.updatedAt - a.updatedAt;
        });
        $("#adminReviews").innerHTML = reviews.length
          ? '<div class="moderation-list">' + reviews.map(function (r) {
              return (
                '<article class="moderation-card moderation-card--' + esc(r.status) + '">' +
                '<div class="moderation-card__head"><div><strong>' + esc(r.name) + '</strong><span class="mono">' + esc(r.discordId) +
                " · " + esc(r.plan || "no plan") + " · " + esc(SS.relative(r.updatedAt || r.createdAt)) + "</span></div>" + chip(r.status) + "</div>" +
                '<div class="moderation-card__rating">' + r.rating + '/5 <span>★</span></div>' +
                '<p>' + esc(r.body) + "</p>" +
                '<div class="moderation-card__actions">' +
                (r.status !== "published" ? '<button class="btn btn--primary btn--sm" data-review="' + r.id + '" data-status="published">Approve</button>' : "") +
                (r.status !== "hidden" ? '<button class="btn btn--subtle btn--sm" data-review="' + r.id + '" data-status="hidden">Hide</button>' : "") +
                '<button class="btn btn--subtle btn--sm danger-link" data-review-delete="' + r.id + '">Delete</button>' +
                "</div></article>"
              );
            }).join("") + "</div>"
          : empty("No reviews", "New reviews will enter this moderation queue.");
      })
      .catch(fail);
  }

  function loadAdminOrders() {
    SS.api
      .get("/api/admin/orders")
      .then(function (data) {
        $("#adminOrders").innerHTML = table(
          ["Reference", "Customer", "Plan", "Status", "Placed", ""],
          data.orders.map(function (o) {
            return (
              '<tr><td class="mono">' + esc(o.id) + "</td>" +
              "<td>" + esc(o.name || o.discordId) + "</td><td>" + esc(o.plan) + "</td>" +
              "<td>" + chip(o.status) + "</td><td>" + SS.date(o.createdAt) + "</td>" +
              '<td><div class="row" style="gap:5px;flex-wrap:nowrap">' +
              (o.payment ? '<span>' + esc(o.payment.state) + (o.payment.needsSupport ? ' · ATTENTION' : '') + '</span>' :
                '<button class="btn btn--subtle btn--sm" data-order="' + esc(o.id) + '" data-status="paid">Paid</button>' +
                '<button class="btn btn--subtle btn--sm" data-order="' + esc(o.id) + '" data-status="cancelled">Cancel</button>') +
              (o.withdrawal ? '<strong>Withdrawal received ' + SS.date(o.withdrawal.created_at) + '</strong>' : '') +
              "</div></td></tr>"
            );
          }),
        );
      })
      .catch(fail);
  }

  function loadAdminReports() {
    SS.api
      .get("/api/admin/reports")
      .then(function (data) {
        state.admin.reports = data.reports;
        if (!state.me.user.admin) {
          var open = data.reports.filter(function (r) { return r.status !== "closed"; }).length;
          $("#adminStats").innerHTML = '<div class="admin-stat"><strong>' + SS.number(data.reports.length) + '</strong><span>All tickets</span></div>' +
            '<div class="admin-stat"><strong>' + SS.number(open) + '</strong><span>Open tickets</span></div>';
          $("#adminBadge").textContent = open;
          $("#adminBadge").classList.toggle("hidden", open === 0);
        }
        var groups = [
          { title: "Needs staff", statuses: ["open", "waiting_staff"] },
          { title: "Waiting for customer", statuses: ["waiting_customer"] },
          { title: "Closed", statuses: ["closed"] },
        ];
        $("#adminReports").innerHTML = data.reports.length
          ? groups.map(function (group) {
              var rows = data.reports.filter(function (r) { return group.statuses.indexOf(r.status) !== -1; });
              if (!rows.length) return "";
              return '<section class="ticket-queue__group"><div class="ticket-queue__label"><span>' + group.title + "</span><b>" + rows.length + "</b></div>" +
                rows.map(function (r) {
                  return '<button class="staff-ticket-row staff-ticket-row--' + esc(r.status) +
                    (state.admin.activeTicketId === r.id ? " is-active" : "") + '" data-admin-ticket="' + r.id + '">' +
                    '<div class="staff-ticket-row__top"><strong>#' + r.id + " · " + esc(r.subject) + "</strong>" + chip(r.status) + "</div>" +
                    '<div class="staff-ticket-row__meta"><span>' + esc(r.reporterName || r.ownerId) + "</span><span>" + esc(r.kind) +
                    "</span><span>" + (r.messageCount || 0) + " replies</span><span>" + esc(SS.relative(r.updatedAt || r.createdAt)) + "</span></div></button>";
                }).join("") + "</section>";
            }).join("")
          : empty("Ticket queue is empty", "New customer reports will appear here.");
        var selectedExists = data.reports.some(function (r) { return r.id === state.admin.activeTicketId; });
        if (!selectedExists) state.admin.activeTicketId = null;
        if (!state.admin.activeTicketId && data.reports.length) {
          loadAdminTicket(data.reports[0].id);
        }
      })
      .catch(function (err) { state.admin.loaded = false; fail(err); });
  }

  function renderAdminTicket(data) {
    var report = data.report;
    var closed = report.status === "closed";
    var statusOptions = [
      ["open", "Open"],
      ["waiting_staff", "Waiting for staff"],
      ["waiting_customer", "Waiting for customer"],
      ["closed", "Closed"],
    ].map(function (pair) {
      return '<option value="' + pair[0] + '"' + (report.status === pair[0] ? " selected" : "") + ">" + pair[1] + "</option>";
    }).join("");
    $("#adminTicketDetail").innerHTML =
      '<div class="ticket-detail__head"><div><span class="section-label">Ticket #' + report.id + " · " + esc(report.kind) + '</span><h2>' + esc(report.subject) +
      '</h2><p>' + esc(report.reporterName || report.ownerId) + ' <span class="mono">' + esc(report.ownerId) + "</span></p></div>" + chip(report.status) + "</div>" +
      '<div class="ticket-toolbar">' + (state.me.user.admin
        ? '<label>Status<select class="select" id="adminTicketStatus" data-ticket-status="' + report.id + '">' + statusOptions + '</select></label>'
        : '<div><span>Status</span>' + chip(report.status) + '</div>') +
      '<div><span>Assigned</span><strong>' + esc(report.assignedTo || "Nobody yet") + "</strong></div></div>" +
      '<div class="ticket-origin"><span>Original report</span><p>' + esc(report.body) + "</p>" +
      (report.log ? '<details><summary>Crash report / latest.log</summary><pre>' + esc(report.log) + "</pre></details>" : "") + "</div>" +
      '<div class="ticket-thread" id="adminTicketThread">' + ticketMessages(data.messages || []) + "</div>" +
      (closed
        ? (state.me.user.admin
          ? '<div class="ticket-delete-bar"><span>Closed tickets can be permanently removed with their full chat and log.</span><button class="btn btn--danger btn--sm" data-ticket-delete="' + report.id + '">Delete ticket</button></div>'
          : '<div class="ticket-delete-bar"><span>This ticket is closed. An admin can reopen it if another reply is needed.</span></div>')
        : '<form class="ticket-reply" data-admin-ticket-reply="' + report.id + '"><textarea class="textarea" minlength="2" maxlength="2000" aria-label="Reply to customer" placeholder="Write your reply to the customer…" required></textarea><div><span>Replying changes status to “Waiting for customer”.</span><button class="btn btn--primary" type="submit">Send reply</button></div></form>');
    var thread = $("#adminTicketThread");
    if (thread) thread.scrollTop = thread.scrollHeight;
  }

  function loadAdminTicket(id) {
    state.admin.activeTicketId = Number(id);
    $("#adminTicketDetail").innerHTML = '<div class="empty-state"><span>Loading ticket…</span></div>';
    loadAdminReports();
    var requestedId = state.admin.activeTicketId;
    return SS.api.get('/api/admin/reports/' + requestedId).then(function (data) {
      if (state.admin.activeTicketId === requestedId) renderAdminTicket(data);
    }).catch(function (err) {
      if (state.admin.activeTicketId !== requestedId) return;
      $('#adminTicketDetail').innerHTML = empty('Could not load this conversation', 'Select the ticket again to retry.');
      fail(err);
    });
  }

  function loadAdminRoleQueue() {
    SS.api
      .get("/api/admin/role-queue")
      .then(function (data) {
        $("#adminRoleQueue").innerHTML = table(
          ["Account", "Discord", "Requested", ""],
          data.links.map(function (l) {
            return (
              "<tr><td>" + esc(l.email || l.ownerId) + "</td>" +
              "<td>" + esc(l.discordUsername || "—") + '<br><span class="mono muted">' + esc(l.discordId || "—") + "</span></td>" +
              "<td>" + esc(SS.relative(l.linkedAt)) + "</td>" +
              '<td><button class="btn btn--subtle btn--sm" data-role-owner="' + esc(l.ownerId) + '">Queue sync</button></td></tr>'
            );
          }),
        );
      })
      .catch(fail);
  }

  function loadAdminTeam() {
    if (!state.me || !state.me.user.canManageTeam) return Promise.resolve();
    return SS.api.get("/api/admin/staff").then(function (data) {
      state.admin.members = data.members;
      $("#adminTeam").innerHTML = table(["Email address", "Access", "Actions"], data.members.map(function (member) {
        return '<tr><td>' + esc(member.email) + '</td><td>' + (member.role === "admin" ? "Admin" : "Support") + '</td><td><div class="row">' +
          '<button class="btn btn--subtle btn--sm" data-team-edit="' + esc(member.email) + '">Edit</button>' +
          '<button class="btn btn--subtle btn--sm danger-link" data-team-remove="' + esc(member.email) + '">Remove access</button></div></td></tr>';
      }));
    }).catch(fail);
  }

  function saveTeamAccess(email, role) {
    return SS.api.post("/api/admin/staff", { email: email, role: role }).then(function () {
      SS.toast(role === "customer" ? "Team access removed." : "Team access saved.", "ok");
      state.admin.loaded = false;
      return refresh().then(function () {
        if (state.me.user.canManageTeam) return loadAdminTeam();
        showPanel(state.me.user.staff ? "admin" : "billing", true);
      });
    });
  }

  function initAdmin() {
    $("#teamForm").addEventListener("submit", function (event) {
      event.preventDefault();
      var button = $('#teamForm button[type="submit"]');
      busy(button, true, "Saving…");
      saveTeamAccess($("#teamEmail").value.trim(), $("#teamRole").value).then(function () {
        $("#teamEmail").value = "";
      }).catch(fail).then(function () { busy(button, false); });
    });
    $("#adminTeam").addEventListener("click", function (event) {
      var edit = event.target.closest("[data-team-edit]");
      if (edit) {
        var member = (state.admin.members || []).find(function (m) { return m.email === edit.getAttribute("data-team-edit"); });
        if (member) { $("#teamEmail").value = member.email; $("#teamRole").value = member.role; $("#teamEmail").focus(); }
        return;
      }
      var remove = event.target.closest("[data-team-remove]");
      if (!remove) return;
      var email = remove.getAttribute("data-team-remove");
      confirmModal({ title: "Remove team access?", body: email + " will lose access to the team dashboard. Their customer account will remain available.", confirmLabel: "Remove access", danger: true })
        .then(function (ok) { if (ok) return saveTeamAccess(email, "customer"); }).catch(fail);
    });

    $(".admin-tabs").addEventListener("click", function (event) {
      var tab = event.target.closest("[data-admin-tab]");
      if (!tab) return;
      var name = tab.getAttribute("data-admin-tab");
      if (!state.me || (!state.me.user.admin && name !== "tickets")) return;
      if (name === "team" && !state.me.user.canManageTeam) return;
      $$("[data-admin-tab]").forEach(function (item) {
        item.classList.toggle("is-active", item === tab);
      });
      $$("[data-admin-view]").forEach(function (view) {
        view.classList.toggle("is-active", view.getAttribute("data-admin-view") === name);
      });
      var active = $('[data-admin-view="' + name + '"]');
      if (active && active.animate && !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) {
        active.animate(
          [
            { opacity: 0, transform: "translateY(8px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" },
        );
      }
    });

    var search = $("#adminSearch");
    var timer = null;
    search.addEventListener("input", function () {
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        loadAdminLicences(search.value.trim());
      }, 250);
    });

    $("#adminLicences").addEventListener("click", function (event) {
      var button = event.target.closest("[data-lic]");
      if (!button) return;
      var payload = { key: button.getAttribute("data-lic"), action: button.getAttribute("data-action") };
      if (payload.action === "extend") payload.days = 30;
      busy(button, true, "…");
      SS.api
        .post("/api/admin/licenses/action", payload)
        .then(function () {
          SS.toast("Done.", "ok");
          loadAdminLicences(search.value.trim());
        })
        .catch(fail)
        .then(function () {
          busy(button, false);
        });
    });

    $("#adminReviews").addEventListener("click", function (event) {
      var remove = event.target.closest("[data-review-delete]");
      if (remove) {
        var removeId = Number(remove.getAttribute("data-review-delete"));
        confirmModal({
          title: "Delete this review?",
          body: "This permanently removes the review. This cannot be undone.",
          confirmLabel: "Delete review",
          danger: true,
        }).then(function (ok) {
          if (!ok) return;
          SS.api.del("/api/admin/reviews/" + removeId).then(function () {
            SS.toast("Review permanently deleted.", "ok");
            loadAdminReviews();
            loadAdmin(true);
          }).catch(fail);
        });
        return;
      }
      var button = event.target.closest("[data-review]");
      if (!button) return;
      SS.api
        .post("/api/admin/reviews/status", {
          id: Number(button.getAttribute("data-review")),
          status: button.getAttribute("data-status"),
        })
        .then(function () {
          SS.toast("Review updated.", "ok");
          loadAdminReviews();
        })
        .catch(fail);
    });

    $("#adminOrders").addEventListener("click", function (event) {
      var button = event.target.closest("[data-order]");
      if (!button) return;
      SS.api
        .post("/api/admin/orders/status", {
          id: button.getAttribute("data-order"),
          status: button.getAttribute("data-status"),
        })
        .then(function () {
          SS.toast("Order updated.", "ok");
          loadAdminOrders();
          loadAdmin(true);
        })
        .catch(fail);
    });

    $("#adminReports").addEventListener("click", function (event) {
      var button = event.target.closest("[data-admin-ticket]");
      if (button) loadAdminTicket(Number(button.getAttribute("data-admin-ticket")));
    });

    $("#adminTicketDetail").addEventListener("change", function (event) {
      var select = event.target.closest("[data-ticket-status]");
      if (!select) return;
      var id = Number(select.getAttribute("data-ticket-status"));
      select.disabled = true;
      SS.api
        .post("/api/admin/reports/status", {
          id: id,
          status: select.value,
        })
        .then(function () {
          SS.toast("Ticket status updated.", "ok");
          loadAdminReports();
          if (state.admin.activeTicketId === id) loadAdminTicket(id);
          loadAdmin(true);
        })
        .catch(fail)
        .then(function () { select.disabled = false; });
    });

    $("#adminTicketDetail").addEventListener("submit", function (event) {
      var form = event.target.closest("[data-admin-ticket-reply]");
      if (!form) return;
      event.preventDefault();
      var id = Number(form.getAttribute("data-admin-ticket-reply"));
      var textarea = $("textarea", form);
      var button = $('button[type="submit"]', form);
      busy(button, true, "Sending…");
      SS.api.post("/api/admin/reports/" + id + "/messages", { body: textarea.value }).then(function () {
        SS.toast("Reply sent to customer.", "ok");
        loadAdminReports();
        if (state.admin.activeTicketId === id) return loadAdminTicket(id);
      }).catch(fail).then(function () { busy(button, false); });
    });

    $("#adminTicketDetail").addEventListener("click", function (event) {
      var button = event.target.closest("[data-ticket-delete]");
      if (!button) return;
      var id = Number(button.getAttribute("data-ticket-delete"));
      confirmModal({
        title: "Permanently delete ticket #" + id + "?",
        body: "The report, crash log and every chat message will be removed from the VPS. This cannot be undone.",
        confirmLabel: "Delete everything",
        danger: true,
      }).then(function (ok) {
        if (!ok) return;
        SS.api.del("/api/admin/reports/" + id).then(function () {
          state.admin.activeTicketId = null;
          $("#adminTicketDetail").innerHTML = '<div class="empty-state"><strong>Ticket deleted</strong><span>The report and complete chat were removed.</span></div>';
          SS.toast("Ticket and chat deleted.", "ok");
          loadAdminReports();
          loadAdmin(true);
        }).catch(fail);
      });
    });

    $("#adminRoleQueue").addEventListener("click", function (event) {
      var button = event.target.closest("[data-role-owner]");
      if (!button) return;
      SS.api
        .post("/api/admin/role-queue", { ownerId: button.getAttribute("data-role-owner"), granted: true })
        .then(function () {
          SS.toast("Role sync queued for the bot.", "ok");
          loadAdminRoleQueue();
          loadAdmin(true);
        })
        .catch(fail);
    });

    $("#grantForm").addEventListener("submit", function (event) {
      event.preventDefault();
      var button = $('#grantForm button[type="submit"]');
      busy(button, true, "Granting…");
      SS.api
        .post("/api/admin/licenses/grant", {
          target: $("#grantId").value.trim(),
          tier: $("#grantTier").value,
          days: Number($("#grantDays").value) || undefined,
          rank: $("#grantRank").value.trim() || undefined,
        })
        .then(function (res) {
          SS.toast(res.pending
            ? "Pending licence saved for " + res.email + "."
            : (res.created ? "Created" : "Updated") + " licence " + res.license.key + ".", "ok");
          $("#grantId").value = "";
          loadAdminLicences("");
        })
        .catch(fail)
        .then(function () {
          busy(button, false);
        });
    });

    $("#keysForm").addEventListener("submit", function (event) {
      event.preventDefault();
      var button = $('#keysForm button[type="submit"]');
      busy(button, true, "Generating…");
      SS.api
        .post("/api/admin/keys", {
          tier: $("#keysTier").value,
          count: Number($("#keysCount").value) || 1,
          days: Number($("#keysDays").value) || undefined,
        })
        .then(function (res) {
          var out = $("#keysOut");
          out.classList.remove("hidden");
          out.textContent = res.keys.join("\n");
          SS.toast("Generated " + res.keys.length + " key(s).", "ok");
        })
        .catch(fail)
        .then(function () {
          busy(button, false);
        });
    });
  }

  // ---------------------------------------------------------------- boot

  function renderAll() {
    var me = state.me;
    $("#userAvatar").src = me.user.avatar;
    $("#userName").textContent = me.user.name;
    $("#userSub").textContent = me.user.admin ? "Admin" : me.user.staff ? "Support" : me.license ? me.license.tier : t("dashboard.no_licence", "No licence");
    $("#greeting").textContent = t("dashboard.welcome", "Welcome back, {name}").replace("{name}", me.user.name);
    applyAccessGate();

    renderStatus();
    renderActions();
    renderActivity();
    renderReports();
    renderDownload();
    renderLicence();
    renderMachine();
    renderAccount();
    renderReview();
    renderBilling();
    if (SS.reveal) SS.reveal();
  }

  function refresh() {
    return SS.api.get("/api/me").then(function (me) {
      if (!me.authenticated) {
        window.location.replace("/login?next=/dashboard");
        return;
      }
      state.me = me;
      syncDownloadCooldown(me.downloads);
      renderAll();
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initRouting();
    initDownload();
    initRedeem();
    initReportForm();
    initBilling();
    initAdmin();

    document.addEventListener("click", function (event) {
      var go = event.target.closest("[data-go]");
      if (go && !go.disabled) showPanel(go.getAttribute("data-go"), true);
    });

    Promise.all([SS.api.get("/api/me"), SS.api.get("/api/site")])
      .then(function (results) {
        if (!results[0].authenticated) {
          window.location.replace("/login?next=/dashboard");
          return;
        }
        state.me = results[0];
        syncDownloadCooldown(state.me.downloads);
        state.site = results[1];
        renderAll();
        showPanel(window.location.hash.replace("#", "") || "overview", false);
        var params = new URLSearchParams(window.location.search);
        var pendingOrder = (state.me.orders || []).find(function (o) { return o.payment && !o.payment.delivered && (o.payment.state === 'pending' || o.payment.state === 'paid'); });
        var paymentOrderId = params.get('order') || (pendingOrder && pendingOrder.id);
        if (params.get('payment') === 'processing' || pendingOrder) {
          SS.toast('Checking payment. Access appears after confirmation; do not pay again.', 'ok');
          var attempts = 0;
          var poll = setInterval(function () {
            var order = (state.me.orders || []).find(function (o) { return o.id === paymentOrderId; });
            if (++attempts > 24 || !order || (order.payment && (order.payment.delivered || order.payment.state === 'refunded' || order.payment.state === 'disputed' || order.payment.state === 'expired'))) {
              clearInterval(poll);
              if (order && order.payment && order.payment.delivered) SS.toast('Payment confirmed. Your licence is ready.', 'ok');
              else SS.toast('Payment confirmation is still pending. Delivery continues automatically; your key will appear here and arrive by email.', 'ok');
              return;
            }
            refresh().catch(fail);
          }, 5000);
        }
        if (params.get("discord") === "linked") SS.toast("Discord connected. Role sync is queued.", "ok");
        if (params.has("discord_error")) SS.toast(discordErrorMessage(), "error");
      })
      .catch(fail);
  });
})(window, document);
