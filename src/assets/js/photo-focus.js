/* Applique en direct le réglage de cadrage par photo choisi depuis
   /bord/ (collection Firestore "photoFocus", un document par fiche,
   une clé par nom de fichier photo -> "haut"|"centre"|"bas"). Aucun
   rebuild du site n'est nécessaire : ce script lit le document au
   chargement de la page fiche et surcharge l'object-position de
   l'image concernée. Si Firebase n'est pas configuré, ou si aucun
   réglage n'existe pour cette fiche, rien ne change — la page garde
   le cadrage déjà écrit dans fiches.json (voir build.js -> fig()). */
(function () {
  "use strict";

  var FOCUS_Y = { haut: 15, centre: 50, bas: 80 };

  function applyOverrides(map) {
    if (!map) return;
    document.querySelectorAll(".gallery-block figure[data-photo]").forEach(function (fig) {
      var name = fig.getAttribute("data-photo");
      var val = map[name];
      if (!val || !FOCUS_Y.hasOwnProperty(val)) return;
      var img = fig.querySelector("img");
      if (img) img.style.objectPosition = "center " + FOCUS_Y[val] + "%";
    });
  }

  var ficheId = window.__CURRENT_FICHE__;
  if (!ficheId) return;

  (window.UGPT ? window.UGPT.ready : Promise.resolve(false)).then(function (ok) {
    if (!ok || !window.UGPT.db) return;
    window.UGPT.db
      .doc("photoFocus/" + ficheId)
      .get()
      .then(function (snap) {
        if (snap.exists) applyOverrides(snap.data());
      })
      .catch(function () {
        /* silencieux : la page garde le cadrage par défaut */
      });
  });
})();
