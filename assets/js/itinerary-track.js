/* Page de suivi (/mon-itineraire/?id=...) : lit une demande d'itinéraire
   via son id Firestore (transmis dans le lien donné après génération sur
   /itineraire/) et affiche son statut de relecture en direct. Un visiteur
   ne peut lire que SA PROPRE demande (uid anonyme correspondant), suivant
   les mêmes règles Firestore que le reste du site. */
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var el = document.getElementById("trackResult");
  if (!el || !window.UGPT_ITINERARY_ENGINE) return;

  var qs = new URLSearchParams(window.location.search);
  var id = qs.get("id");
  if (!id) {
    el.innerHTML = '<p class="muted-note" style="padding:0 16px;">Aucune demande à afficher. Créez-en une depuis <a href="/itineraire/">la page itinéraire</a>.</p>';
    return;
  }

  var fiches = window.__FICHES_FOR_ITINERARY__ || [];
  var ficheById = {};
  fiches.forEach(function (f) {
    ficheById[f.id] = f;
  });

  var STATUS_LABEL = { brouillon_auto: "En cours de relecture par la rédaction", validee: "Validé", rejetee: "Non retenu" };
  var STATUS_CLASS = { brouillon_auto: "brouillon", validee: "validee", rejetee: "rejetee" };

  (window.UGPT ? window.UGPT.ready : Promise.resolve(false)).then(function (ok) {
    if (!ok || !window.UGPT.db) {
      el.innerHTML = '<p class="muted-note" style="padding:0 16px;">Suivi indisponible pour l’instant (Firebase non configuré).</p>';
      return;
    }
    window.UGPT.db.doc("itinerary_requests/" + id).onSnapshot(
      function (snap) {
        if (!snap.exists) {
          el.innerHTML = '<p class="muted-note" style="padding:0 16px;">Cette demande est introuvable.</p>';
          return;
        }
        var d = snap.data();
        var label = STATUS_LABEL[d.status] || d.status;
        var cls = STATUS_CLASS[d.status] || "brouillon";
        el.innerHTML = '<div style="padding:0 16px 14px;"><span class="itin-status-pill ' + cls + '">' + esc(label) + "</span></div>";
        var planEl = document.createElement("div");
        el.appendChild(planEl);
        window.UGPT_renderItineraryPlan(planEl, d.plan, ficheById, { placeRequest: d.placeRequest });
      },
      function () {
        el.innerHTML = '<p class="muted-note" style="padding:0 16px;">Impossible d’afficher cette demande (accès refusé ou lien invalide).</p>';
      }
    );
  });
})();
