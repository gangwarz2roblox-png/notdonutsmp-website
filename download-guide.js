/* Visual download help. Illustrations never change Windows settings. */
(function (window, document) {
  "use strict";
  var SS = window.SS;
  var active = null;
  var STEPS = ["check", "settings", "pause"];
  var SHIELD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m12 3 8 3v6c0 4-3 7-8 9-5-2-8-5-8-9V6Z"/><path d="M12 8v5m0 3h.01"/></svg>';
  var ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>';
  var DOWNLOAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 19h16"/></svg>';
  var CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>';
  var MICROSOFT = "https://support.microsoft.com/en-au/windows/stay-protected-with-the-windows-security-app-2ae0363d-0ada-c064-8b56-6a39afb6a963";

  SS.downloadGuide = function (options) {
    if (active) return active;
    active = new Promise(function (resolve) {
      var previousFocus = document.activeElement;
      var dialog = document.createElement("dialog");
      var step = options.helpOnly ? 0 : -1;
      var verified = false;
      var restoreReminder = false;
      var result = { confirmed: false, remind: false };
      var oldOverflow = document.body.style.overflow;
      function copy(key) { return SS.escapeHtml(options.t("dashboard.download_guide." + key)); }
      function button(action, label, primary) {
        return '<button type="button" class="btn ' + (primary ? "btn--primary" : "btn--ghost") + '" data-guide-action="' + action + '">' + copy(label) + (primary ? ARROW : "") + '</button>';
      }
      function toggle() {
        return '<div class="download-guide__setting"><strong>' + copy("realtime") + '</strong><div class="download-guide__switch-row"><span class="download-guide__switch"></span><b>' + copy("off") + '</b></div></div>';
      }
      function sketch(content) {
        return '<div class="download-guide__window" aria-hidden="true"><div class="download-guide__window-bar">' + SHIELD + '<span>' + copy("security") + '</span><span class="download-guide__window-controls">− &nbsp; □ &nbsp; ×</span></div><div class="download-guide__window-body">' + content + '</div></div><p class="download-guide__caption">' + copy("illustration") + '</p>';
      }
      function finish(confirmed, support) {
        result = { confirmed: confirmed, remind: restoreReminder, support: !!support };
        dialog.close();
      }
      function render() {
        var intro = step === -1;
        var progress = intro ? "" : '<ol class="download-guide__progress" aria-label="' + copy("steps") + '">' + STEPS.map(function (label, i) {
          return '<li' + (i === step ? ' aria-current="step"' : '') + ' class="' + (i <= step ? "is-reached" : "") + '"><span>' + (i + 1) + '</span>' + copy(label) + '</li>';
        }).join("") + '</ol>';
        var content = "";
        var actions = "";
        if (intro) {
          content = '<div class="download-guide__hero" aria-hidden="true"><div class="download-guide__jar"><span>67<span>+</span></span><small>MINECRAFT / .JAR</small></div><span class="download-guide__download-icon">' + DOWNLOAD + '</span></div>' +
            '<h2 id="downloadGuideTitle" tabindex="-1">' + copy("title") + '</h2><p id="downloadGuideDescription">' + copy("intro") + '</p>' +
            '<div class="download-guide__notice">' + SHIELD + '<div><strong>' + copy("warning_title") + '</strong><p>' + copy("warning_body") + '</p></div></div>';
          actions = button("guide", "open_guide", false) + button("download", "download", true);
        } else {
          content = '<div class="download-guide__step-copy"><span class="download-guide__eyebrow">0' + (step + 1) + ' / ' + String(STEPS.length).padStart(2, "0") + '</span><h2 id="downloadGuideTitle" tabindex="-1">' + copy("step" + step + "_title") + '</h2><p id="downloadGuideDescription">' + copy("step" + step + "_body") + '</p></div>';
          if (step === 0) {
            content += sketch('<div class="download-guide__window-heading">' + SHIELD + '<strong>' + copy("history") + '</strong></div><div class="download-guide__history"><span class="download-guide__warning-mark">!</span><div><strong>' + copy("detection") + '</strong><span>' + copy("detection_detail") + '</span></div><span>⌄</span></div>') +
              '<p class="download-guide__fact">' + copy("certificate") + '</p><label class="download-guide__check"><input type="checkbox" id="downloadGuideVerified"' + (verified ? " checked" : "") + '><span>' + copy("verified") + '</span></label>';
          } else if (step === 1) {
            content += sketch('<div class="download-guide__search"><span>⌕</span>' + copy("security") + '</div><div class="download-guide__path"><span>' + SHIELD + copy("threat") + '</span>' + ARROW + '<strong>' + copy("manage") + '</strong></div>');
          } else {
            content += sketch('<strong class="download-guide__window-title">' + copy("threat_settings") + '</strong>' + toggle() + '<div class="download-guide__window-warning"><span>!</span>' + copy("unprotected") + '</div>') + '<p class="download-guide__fact">' + copy("managed") + '</p>';
          }
          actions = button(options.helpOnly && step === 0 ? "done" : "back", "back", false) + (step === STEPS.length - 1 ? button(options.helpOnly ? "done" : "download", options.helpOnly ? "done" : "download", true) : button("next", step === 0 ? "next_verified" : "next", true));
        }
        dialog.innerHTML = '<div class="download-guide__top"><span>' + (intro ? '67CLIENT <i>/</i> .JAR' : SHIELD + copy("windows_guide")) + '</span><button type="button" class="download-guide__close" data-guide-action="close" aria-label="' + copy("close") + '">' + CLOSE + '</button></div>' + progress + '<div class="download-guide__content">' + content + '</div><div class="download-guide__actions">' + actions + '</div><div class="download-guide__foot"><button type="button" data-guide-action="support">' + copy("support") + '</button><a href="' + MICROSOFT + '" target="_blank" rel="noopener noreferrer">' + copy("microsoft") + ' ↗</a></div>';
        if (step === 0) dialog.querySelector('[data-guide-action="next"]').disabled = !verified;
        if (dialog.open) dialog.querySelector("h2").focus({ preventScroll: true });
        dialog.scrollTop = 0;
      }
      dialog.className = "download-guide";
      dialog.setAttribute("aria-labelledby", "downloadGuideTitle");
      dialog.setAttribute("aria-describedby", "downloadGuideDescription");
      dialog.addEventListener("change", function (event) {
        if (event.target.id !== "downloadGuideVerified") return;
        verified = event.target.checked;
        dialog.querySelector('[data-guide-action="next"]').disabled = !verified;
      });
      dialog.addEventListener("click", function (event) {
        var control = event.target.closest("[data-guide-action]");
        if (!control || control.disabled) return;
        var action = control.dataset.guideAction;
        if (action === "close" || action === "done") return finish(false);
        if (action === "support") return finish(false, true);
        if (action === "download") return finish(true);
        if (action === "guide") step = 0;
        if (action === "back") step = Math.max(-1, step - 1);
        if (action === "next") {
          if (step === 0 && !verified) return;
          step = Math.min(STEPS.length - 1, step + 1);
          if (step === 2) restoreReminder = true;
        }
        render();
      });
      dialog.addEventListener("cancel", function (event) { event.preventDefault(); finish(false); });
      dialog.addEventListener("keydown", function (event) {
        if (event.key !== "Tab") return;
        var controls = Array.prototype.slice.call(dialog.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled)'));
        var index = controls.indexOf(document.activeElement);
        if (index === -1 || (event.shiftKey && index === 0) || (!event.shiftKey && index === controls.length - 1)) {
          event.preventDefault();
          controls[event.shiftKey ? controls.length - 1 : 0].focus();
        }
      });
      dialog.addEventListener("close", function () {
        document.body.style.overflow = oldOverflow;
        dialog.remove();
        active = null;
        if (previousFocus && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
        resolve(result);
      }, { once: true });
      render();
      document.body.appendChild(dialog);
      document.body.style.overflow = "hidden";
      dialog.showModal();
      dialog.querySelector("h2").focus({ preventScroll: true });
    });
    return active;
  };
})(window, document);
