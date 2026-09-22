/* Rendu HTML en lecture seule d'un plan d'itinéraire (sortie de
   itinerary-engine.js). Partagé par /itineraire/ (résultat juste après
   génération) et /mon-itineraire/ (suivi de la demande) pour ne jamais
   avoir deux affichages qui divergent. L'édition (admin) a sa propre
   UI dans admin.js — ce fichier ne fait que de l'affichage. */
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmt(min) {
    return window.UGPT_ITINERARY_ENGINE ? window.UGPT_ITINERARY_ENGINE.formatDuration(min) : Math.round(min) + " min";
  }

  var REASON_MSG = {
    no_candidates: "Aucun lieu vérifié du magazine ne correspond encore à ces critères. Essayez d'élargir les thèmes ou les régions.",
    budget_insuffisant: "Le rythme choisi ne laisse pas assez de temps pour visiter un lieu correspondant à ces critères. Essayez un rythme plus intensif, ou réduisez la sélection.",
  };

  // Bloc "ajout personnel" : jamais fusionné avec le plan calculé (pas de
  // coordonnées, donc pas de place dans l'algorithme), jamais accompagné
  // d'un avis ou d'un conseil de la rédaction — uniquement le texte tel
  // que la personne l'a saisi, avec un avertissement explicite.
  function clientNoteHtml(placeRequest) {
    if (!placeRequest) return "";
    return (
      '<div class="itin-client-note"><b>Ajouté à votre demande, pas par la rédaction</b>' +
      esc(placeRequest) +
      " — ce lieu n'est pas encore vérifié par le magazine : il figure ici tel que vous l'avez indiqué, sans avis ni recommandation de notre part. À vous de l'intégrer dans votre parcours." +
      "</div>"
    );
  }

  function renderPlan(el, plan, ficheById, opts) {
    opts = opts || {};
    if (!el) return;
    ficheById = ficheById || {};
    var clientNote = clientNoteHtml(opts.placeRequest);

    if (!plan || !plan.ok) {
      var reason = (plan && REASON_MSG[plan.reason]) || "Impossible de générer un itinéraire avec ces critères pour l'instant.";
      el.innerHTML = clientNote + '<div class="itin-summary warn">' + esc(reason) + "</div>";
      return;
    }

    var html = clientNote;
    var shortfall = plan.actualDays < plan.requestedDays;
    var extraNotes = [];
    if (shortfall) {
      extraNotes.push(
        "Seuls " + plan.actualDays + " jour(s) sur les " + plan.requestedDays + " demandé(s) ont pu être remplis avec des lieux vérifiés correspondant à vos critères."
      );
    }
    if (plan.unusedFicheIds && plan.unusedFicheIds.length) {
      extraNotes.push(plan.unusedFicheIds.length + " autre(s) lieu(x) correspondaient mais n'ont pas pu être inclus dans ce nombre de jours.");
    }
    if (plan.tooLongFicheIds && plan.tooLongFicheIds.length) {
      extraNotes.push(plan.tooLongFicheIds.length + " lieu(x) demandent plus de temps que le rythme choisi ne le permet en une journée.");
    }

    html +=
      '<div class="itin-summary' +
      (shortfall ? " warn" : "") +
      '">' +
      "Itinéraire sur " +
      plan.actualDays +
      (plan.actualDays > 1 ? " jours" : " jour") +
      " · rythme " +
      esc(plan.pace) +
      (extraNotes.length ? "<br>" + extraNotes.map(esc).join("<br>") : "") +
      "</div>";

    plan.days.forEach(function (day) {
      html +=
        '<div class="itin-day"><div class="itin-day-head"><span>Jour ' +
        day.dayIndex +
        "</span><span class=\"muted\">" +
        day.stops.length +
        (day.stops.length > 1 ? " lieux" : " lieu") +
        " · " +
        fmt(day.totalVisitMin) +
        " de visite · " +
        fmt(day.totalTravelMin) +
        " de route</span></div>";
      day.stops.forEach(function (stop, idx) {
        var f = ficheById[stop.ficheId];
        var title = f ? f.title : stop.ficheId;
        var body = f && f.url ? '<a href="' + esc(f.url) + '">' + esc(title) + "</a>" : "<b>" + esc(title) + "</b>";
        var meta =
          (idx === 0 ? "Première étape" : "+" + fmt(stop.travelMinFromPrev) + " de route") +
          " · visite ~" +
          fmt(stop.visitMin);
        html +=
          '<div class="itin-stop"><div class="itin-stop-num">' +
          (idx + 1) +
          '</div><div class="itin-stop-body">' +
          body +
          '<div class="itin-stop-meta">' +
          meta +
          "</div></div></div>";
      });
      html += "</div>";
    });

    el.innerHTML = html;
  }

  window.UGPT_renderItineraryPlan = renderPlan;
})();
