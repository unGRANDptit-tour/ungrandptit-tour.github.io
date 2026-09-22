/* ============================================================
   Google Analytics 4.
   REMPLACE "G-XXXXXXX" par ton identifiant de mesure une fois ta
   propriété GA4 créée (Firebase te la propose au moment de créer
   le projet, ou crée-la séparément sur analytics.google.com).
   Ce script n'est appelé qu'après acceptation du bandeau cookies
   (voir cookies.js) — jamais avant, conformément au RGPD.
   ============================================================ */
window.UGPT_GA_ID = "G-XXXXXXX";

window.UGPT_loadAnalytics = function () {
  if (!window.UGPT_GA_ID || window.UGPT_GA_ID === "G-XXXXXXX") return; // pas encore configuré
  if (window.__ugptGaLoaded) return;
  window.__ugptGaLoaded = true;
  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + window.UGPT_GA_ID;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  window.gtag = gtag;
  gtag("js", new Date());
  gtag("config", window.UGPT_GA_ID, { anonymize_ip: true });
};
