/* ============================================================
   Moteur de génération d'itinéraire — algorithme déterministe,
   sans IA, sans dépendance. Utilisé à la fois :
   - côté navigateur (chargé en <script> sur /itineraire/),
   - côté Node (require()'d par src/build.js si besoin un jour).
   C'est pour ça que ce fichier est écrit en UMD : aucune syntaxe
   ES module, aucun import — juste une fonction attachée à
   `module.exports` (Node) ou à `window.UGPT_ITINERARY_ENGINE`
   (navigateur).

   Principe : ne JAMAIS inventer de lieu. On part uniquement des
   fiches vérifiées fournies en entrée (coordonnées + durée de
   visite estimée), on les regroupe géographiquement jour par jour
   en respectant un budget d'heures réaliste, et on s'arrête
   honnêtement dès que ça ne rentre plus — plutôt que de forcer
   un remplissage absurde. Toute la sortie est un plan structuré
   (jours -> arrêts -> lieu/durée/trajet), jamais du texte libre :
   c'est ce qui rend le résultat prévisible, vérifiable et
   modifiable à la main depuis /bord/.
   ============================================================ */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.UGPT_ITINERARY_ENGINE = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DEFAULT_CFG = {
    paceHoursPerDay: { detendu: 4, standard: 6, intensif: 8 },
    avgSpeedKmh: 55, // vitesse moyenne réaliste sur route secondaire française (pas l'autoroute à vol d'oiseau)
    roadDetourFactor: 1.3, // correctif distance à vol d'oiseau -> distance routière approximative
    maxStopsPerDay: 4, // plafond de bon sens, même si le budget-temps permettrait plus d'arrêts courts
    defaultVisitDurationMin: 60,
    maxDaysRequestable: 14,
  };

  function mergeCfg(cfg) {
    var out = {};
    var k;
    for (k in DEFAULT_CFG) out[k] = DEFAULT_CFG[k];
    if (cfg) {
      for (k in cfg) {
        if (k === "paceHoursPerDay" && cfg[k]) {
          out.paceHoursPerDay = {};
          var p;
          for (p in DEFAULT_CFG.paceHoursPerDay) out.paceHoursPerDay[p] = DEFAULT_CFG.paceHoursPerDay[p];
          for (p in cfg[k]) out.paceHoursPerDay[p] = cfg[k][p];
        } else if (cfg[k] !== undefined) {
          out[k] = cfg[k];
        }
      }
    }
    return out;
  }

  function toRad(deg) {
    return (deg * Math.PI) / 180;
  }

  function haversineKm(a, b) {
    var R = 6371;
    var dLat = toRad(b.lat - a.lat);
    var dLon = toRad(b.lon - a.lon);
    var lat1 = toRad(a.lat);
    var lat2 = toRad(b.lat);
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function travelMinutes(distanceKm, cfg) {
    return (distanceKm * cfg.roadDetourFactor / cfg.avgSpeedKmh) * 60;
  }

  function clamp(n, min, max) {
    n = Math.round(Number(n) || min);
    return Math.max(min, Math.min(max, n));
  }

  function formatDuration(min) {
    min = Math.round(min);
    var h = Math.floor(min / 60);
    var m = min % 60;
    if (h <= 0) return m + " min";
    if (m === 0) return h + "h";
    return h + "h" + (m < 10 ? "0" : "") + m;
  }

  /* Filtre + score les fiches candidates avant construction du plan.
     Ne conserve QUE les fiches vérifiées avec des coordonnées : on ne
     propose jamais un brouillon non confirmé dans un itinéraire. */
  function filterCandidates(fiches, params) {
    var themes = params.themes && params.themes.length ? params.themes : null;
    var regions = params.regions && params.regions.length ? params.regions : null;
    return fiches.filter(function (f) {
      if (f.status && f.status !== "verifie") return false;
      if (!f.coords || typeof f.coords.lat !== "number" || typeof f.coords.lon !== "number") return false;
      var themeOk = !themes || (f.themes || []).some(function (t) {
        return themes.indexOf(t) !== -1;
      });
      var regionOk = !regions || regions.indexOf(f.region) !== -1;
      return themeOk && regionOk;
    });
  }

  /* Construit le plan jour par jour. Ne force jamais un jour vide ou un
     enchaînement de lieux trop éloignés pour tenir dans le budget-temps :
     s'arrête plus tôt et le dit clairement plutôt que d'inventer. */
  function planItinerary(fiches, params, cfgInput) {
    var cfg = mergeCfg(cfgInput);
    var requestedDays = clamp(params.days, 1, cfg.maxDaysRequestable);
    var pace = cfg.paceHoursPerDay[params.pace] ? params.pace : "standard";
    var dayBudgetMin = cfg.paceHoursPerDay[pace] * 60;

    var candidates = filterCandidates(fiches, params);
    if (!candidates.length) {
      return {
        ok: false,
        reason: "no_candidates",
        requestedDays: requestedDays,
        pace: pace,
        days: [],
        unusedFicheIds: [],
        tooLongFicheIds: [],
        generatedAt: new Date().toISOString(),
      };
    }

    // tri initial par popularité (votes) puis titre — sert de point de
    // départ quand aucune coordonnée de départ n'est fournie, et de
    // critère de priorité à budget égal.
    candidates = candidates.slice().sort(function (a, b) {
      var av = a.votes || 0;
      var bv = b.votes || 0;
      if (bv !== av) return bv - av;
      return String(a.title).localeCompare(String(b.title));
    });

    // Un lieu dont la seule visite dépasse le budget quotidien ne pourra
    // jamais rentrer, quel que soit le trajet : on l'écarte tout de suite
    // et on le signale, plutôt que de bloquer silencieusement le calcul.
    var tooLong = [];
    var remaining = [];
    candidates.forEach(function (f) {
      var visitMin = f.visitDurationMin || cfg.defaultVisitDurationMin;
      if (visitMin > dayBudgetMin) tooLong.push(f.id);
      else remaining.push(f);
    });

    var planDays = [];
    var currentPos = params.startCoords || null;

    for (var d = 0; d < requestedDays && remaining.length; d++) {
      var dayStops = [];
      var timeLeft = dayBudgetMin;
      var pos = currentPos;

      while (remaining.length && dayStops.length < cfg.maxStopsPerDay) {
        var best = null;
        var bestIdx = -1;
        var bestDist = 0;

        if (pos === null) {
          // Pas de point de départ connu : on démarre sur le lieu le
          // mieux classé parmi les candidats restants.
          best = remaining[0];
          bestIdx = 0;
          bestDist = 0;
        } else {
          var minDist = Infinity;
          for (var i = 0; i < remaining.length; i++) {
            var dist = haversineKm(pos, remaining[i].coords);
            if (dist < minDist) {
              minDist = dist;
              best = remaining[i];
              bestIdx = i;
              bestDist = dist;
            }
          }
        }

        var travelMin = travelMinutes(bestDist, cfg);
        var visitMin = best.visitDurationMin || cfg.defaultVisitDurationMin;
        var needed = travelMin + visitMin;
        if (needed > timeLeft) break; // ne rentre plus dans la journée : on s'arrête là, honnêtement

        dayStops.push({
          ficheId: best.id,
          travelMinFromPrev: Math.round(travelMin),
          visitMin: visitMin,
          distanceKmFromPrev: Math.round(bestDist * 10) / 10,
        });
        timeLeft -= needed;
        pos = best.coords;
        remaining.splice(bestIdx, 1);
      }

      if (!dayStops.length) break; // rien de compatible aujourd'hui : on n'ajoute pas de jour vide

      var totalVisit = dayStops.reduce(function (s, x) {
        return s + x.visitMin;
      }, 0);
      var totalTravel = dayStops.reduce(function (s, x) {
        return s + x.travelMinFromPrev;
      }, 0);

      planDays.push({
        dayIndex: d + 1,
        stops: dayStops,
        totalVisitMin: totalVisit,
        totalTravelMin: totalTravel,
      });
      currentPos = pos;
    }

    return {
      ok: planDays.length > 0,
      reason: planDays.length ? null : "budget_insuffisant",
      requestedDays: requestedDays,
      actualDays: planDays.length,
      pace: pace,
      days: planDays,
      unusedFicheIds: remaining.map(function (f) {
        return f.id;
      }),
      tooLongFicheIds: tooLong,
      generatedAt: new Date().toISOString(),
    };
  }

  /* Recalcule seulement les totaux/temps de trajet d'un plan modifié à la
     main (ajout/suppression/réordonnancement d'arrêts depuis /bord/), sans
     relancer l'algorithme de sélection — pour ne jamais écraser un
     arrangement manuel. `days` = [{stops:[{ficheId}, ...]}, ...] ;
     `ficheById` = { id: {coords, visitDurationMin, ...} }. */
  function recomputeTimes(days, ficheById, cfgInput) {
    var cfg = mergeCfg(cfgInput);
    return days.map(function (day, di) {
      var pos = null;
      var stops = day.stops.map(function (s) {
        var f = ficheById[s.ficheId];
        var dist = 0;
        if (pos && f && f.coords) dist = haversineKm(pos, f.coords);
        var travelMin = pos ? travelMinutes(dist, cfg) : 0;
        var visitMin = (f && f.visitDurationMin) || cfg.defaultVisitDurationMin;
        if (f && f.coords) pos = f.coords;
        return {
          ficheId: s.ficheId,
          travelMinFromPrev: Math.round(travelMin),
          visitMin: visitMin,
          distanceKmFromPrev: Math.round(dist * 10) / 10,
        };
      });
      var totalVisit = stops.reduce(function (s, x) {
        return s + x.visitMin;
      }, 0);
      var totalTravel = stops.reduce(function (s, x) {
        return s + x.travelMinFromPrev;
      }, 0);
      return { dayIndex: di + 1, stops: stops, totalVisitMin: totalVisit, totalTravelMin: totalTravel };
    });
  }

  return {
    DEFAULT_CFG: DEFAULT_CFG,
    haversineKm: haversineKm,
    travelMinutes: travelMinutes,
    formatDuration: formatDuration,
    planItinerary: planItinerary,
    recomputeTimes: recomputeTimes,
  };
});
