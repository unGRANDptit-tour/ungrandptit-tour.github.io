(function () {
  "use strict";
  var KEY = "ugpt-cookie-consent"; // "accepted" | "refused"
  var banner = document.getElementById("cookieBanner");
  var acceptBtn = document.getElementById("cookieAccept");
  var refuseBtn = document.getElementById("cookieRefuse");

  function loadAnalyticsIfReady() {
    if (window.UGPT_loadAnalytics) window.UGPT_loadAnalytics();
    else window.addEventListener("load", function () { if (window.UGPT_loadAnalytics) window.UGPT_loadAnalytics(); });
  }

  var saved = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch (e) {}

  if (saved === "accepted") {
    loadAnalyticsIfReady();
  } else if (saved !== "refused" && banner) {
    banner.hidden = false;
  }

  if (acceptBtn) {
    acceptBtn.addEventListener("click", function () {
      try {
        localStorage.setItem(KEY, "accepted");
      } catch (e) {}
      if (banner) banner.hidden = true;
      loadAnalyticsIfReady();
    });
  }
  if (refuseBtn) {
    refuseBtn.addEventListener("click", function () {
      try {
        localStorage.setItem(KEY, "refused");
      } catch (e) {}
      if (banner) banner.hidden = true;
    });
  }
})();
