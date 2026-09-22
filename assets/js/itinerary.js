/* Assistant "Créer mon itinéraire" (/itineraire/). Le calcul du plan se
   fait entièrement côté navigateur (algorithme déterministe de
   itinerary-engine.js — aucun appel IA, aucun serveur nécessaire), puis
   la demande est enregistrée dans Firestore pour passer par la file de
   modération de /bord/ avant toute confirmation à la personne. */
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toast(msg) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(el.__t);
    el.__t = setTimeout(function () {
      el.classList.remove("show");
    }, 2200);
  }

  var form = document.getElementById("itinForm");
  var resultEl = document.getElementById("itineraryResult");
  if (!form || !resultEl || !window.UGPT_ITINERARY_ENGINE || !window.__FICHES_FOR_ITINERARY__) return;

  var fiches = window.__FICHES_FOR_ITINERARY__;
  var cfg = window.__UGPT_ITINERARY_CFG__ || {};
  var ficheById = {};
  fiches.forEach(function (f) {
    ficheById[f.id] = f;
  });

  function wireToggleGroup(containerId) {
    var el = document.getElementById(containerId);
    if (!el) return el;
    el.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest(".itin-toggle") : null;
      if (!btn || !el.contains(btn)) return;
      btn.classList.toggle("active");
    });
    return el;
  }

  function activeValues(el) {
    if (!el) return [];
    return Array.prototype.map.call(el.querySelectorAll(".itin-toggle.active"), function (b) {
      return b.getAttribute("data-value");
    });
  }

  var themesEl = wireToggleGroup("it-themes");
  var regionsEl = wireToggleGroup("it-regions");

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (window.UGPT_PAUSED) {
      toast("La génération d'itinéraires est suspendue pour l'instant");
      return;
    }

    var daysInput = document.getElementById("it-days");
    var days = parseInt(daysInput.value, 10);
    var maxDays = cfg.maxDaysRequestable || 14;
    if (!days || days < 1) days = 1;
    if (days > maxDays) days = maxDays;
    daysInput.value = days;

    var params = {
      days: days,
      themes: activeValues(themesEl),
      regions: activeValues(regionsEl),
      pace: document.getElementById("it-pace").value,
    };
    var email = document.getElementById("it-email").value.trim();
    var placeRequest = document.getElementById("it-place-request").value.trim().slice(0, 300);
    var note = document.getElementById("it-note");
    var submitBtn = document.getElementById("it-submit");

    var plan = window.UGPT_ITINERARY_ENGINE.planItinerary(fiches, params, cfg);
    window.UGPT_renderItineraryPlan(resultEl, plan, ficheById, { placeRequest: placeRequest });
    resultEl.scrollIntoView({ behavior: "smooth", block: "start" });

    // On enregistre dès qu'il y a un plan utilisable OU qu'un lieu manquant a
    // été signalé — sinon la rédaction ne verrait jamais cette demande, même
    // quand le site n'a pas encore de quoi construire un itinéraire complet.
    if (!plan.ok && !placeRequest) return;

    (window.UGPT ? window.UGPT.ready : Promise.resolve(false)).then(function (ok) {
      if (!ok || !window.UGPT.db) {
        if (note) note.textContent = "Itinéraire généré ci-dessous. Firebase n'est pas encore configuré : cette demande n'a pas pu être transmise à la rédaction pour l'instant.";
        return;
      }
      var uid = window.UGPT.auth && window.UGPT.auth.currentUser ? window.UGPT.auth.currentUser.uid : null;
      if (submitBtn) submitBtn.disabled = true;
      window.UGPT.db
        .collection("itinerary_requests")
        .add({
          status: "brouillon_auto",
          uid: uid,
          email: email || null,
          placeRequest: placeRequest || null,
          params: params,
          plan: plan,
          createdAt: new Date().toISOString(),
        })
        .then(function (ref) {
          if (note) {
            note.innerHTML =
              (placeRequest ? "Itinéraire (et votre suggestion de lieu) transmis" : "Itinéraire transmis") +
              ' à la rédaction pour relecture. Vous pouvez suivre son statut ici : <a href="/mon-itineraire/?id=' +
              esc(ref.id) +
              '">/mon-itineraire/?id=' +
              esc(ref.id) +
              "</a>";
          }
          toast("Demande envoyée");
        })
        .catch(function () {
          if (note) note.textContent = "Itinéraire généré ci-dessous, mais la demande n'a pas pu être transmise à la rédaction (erreur réseau).";
        })
        .then(function () {
          if (submitBtn) submitBtn.disabled = false;
        });
    });
  });
})();
