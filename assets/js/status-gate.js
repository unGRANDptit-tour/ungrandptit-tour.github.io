/* Reads site/status from Firestore and gates votes/comments/suggestions
   site-wide when the emergency-stop button has been activated. */
(function () {
  "use strict";
  window.UGPT_PAUSED = false;

  function applyBanner(paused, reason) {
    window.UGPT_PAUSED = !!paused;
    var banner = document.getElementById("statusBanner");
    var text = document.getElementById("statusBannerText");
    if (!banner) return;
    banner.hidden = !paused;
    if (text) {
      text.textContent =
        "Les votes, commentaires et suggestions sont suspendus pour l'instant" + (reason ? " — " + reason : ".");
    }
    document.dispatchEvent(new CustomEvent("ugpt:status", { detail: { paused: !!paused } }));
    // disable obvious action buttons present on the page
    ["voteBtn", "sg-submit", "it-submit"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.disabled = !!paused;
    });
  }

  (window.UGPT ? window.UGPT.ready : Promise.resolve(false)).then(function (ok) {
    if (!ok || !window.UGPT.db) return;
    window.UGPT.db
      .doc("site/status")
      .onSnapshot(
        function (snap) {
          var d = snap.exists ? snap.data() || {} : {};
          applyBanner(!!d.paused, d.reason || "");
        },
        function () {}
      );
  });
})();
