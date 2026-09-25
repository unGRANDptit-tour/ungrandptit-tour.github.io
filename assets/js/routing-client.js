/* Client léger pour OpenRouteService (openrouteservice.org) : calcule de
   vrais trajets routiers (au lieu d'une ligne droite à vol d'oiseau) pour
   le tracé sur la carte de /itineraire/ et les temps de route affichés
   dans le plan généré.

   Principe de robustesse : toute fonction ici peut échouer (service
   indisponible, quota dépassé, pas de clé configurée, requête trop
   longue) — dans ce cas la Promise est rejetée et l'appelant (itinerary.js)
   retombe sur l'estimation à vol d'oiseau de itinerary-engine.js, comme
   avant l'ajout de ce fichier. Aucun appel ici ne doit jamais faire
   planter la génération d'itinéraire.

   Clé API : window.__UGPT_ORS_KEY__, injectée par build.js depuis
   site.json → routing.orsApiKey. C'est une clé gratuite prévue par
   OpenRouteService pour un usage direct depuis le navigateur (site
   statique, pas de serveur) — elle est donc visible dans le code de la
   page, comme le veut ce modèle d'usage. */
(function () {
  "use strict";

  var ORS_BASE = "https://api.openrouteservice.org/v2";
  var TIMEOUT_MS = 7000;
  var MAX_MATRIX_LOCATIONS = 45; // marge sous la limite gratuite (matrice 50x50)

  function apiKey() {
    return window.__UGPT_ORS_KEY__ || "";
  }

  function postJson(path, body) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (ctrl) ctrl.abort();
    }, TIMEOUT_MS);
    return fetch(ORS_BASE + path, {
      method: "POST",
      headers: { Authorization: apiKey(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined,
    }).then(
      function (r) {
        clearTimeout(timer);
        return r.ok ? r.json() : Promise.reject(new Error("http_" + r.status));
      },
      function (err) {
        clearTimeout(timer);
        return Promise.reject(err);
      }
    );
  }

  /* Vrai trajet routier entre plusieurs points, dans l'ordre donné.
     coords = [{lat, lon}, ...], 2 points minimum. Résout avec :
       { geometry: [[lat,lon], ...], totalDistanceKm, totalDurationMin }
     ou rejette (service indisponible, pas de clé, timeout 7s...). */
  function fetchRoute(coords) {
    if (!apiKey()) return Promise.reject(new Error("no_api_key"));
    if (!coords || coords.length < 2) return Promise.reject(new Error("not_enough_points"));
    return postJson("/directions/driving-car/geojson", {
      coordinates: coords.map(function (c) {
        return [c.lon, c.lat];
      }),
    }).then(function (data) {
      var feat = data && data.features && data.features[0];
      if (!feat || !feat.geometry || !feat.geometry.coordinates) return Promise.reject(new Error("empty_route"));
      var geometry = feat.geometry.coordinates.map(function (c) {
        return [c[1], c[0]]; // GeoJSON = [lon,lat] -> on repasse en [lat,lon] (convention Leaflet du reste du site)
      });
      var summary = (feat.properties && feat.properties.summary) || {};
      return {
        geometry: geometry,
        totalDistanceKm: (summary.distance || 0) / 1000,
        totalDurationMin: (summary.duration || 0) / 60,
      };
    });
  }

  /* Matrice de distances/durées routières réelles entre tous les points
     donnés (coords = [{lat, lon}, ...]). Résout avec :
       { distancesKm: [[...]], durationsMin: [[...]] }   (index i -> j)
     ou rejette (service indisponible, pas de clé, trop de points, timeout). */
  function fetchMatrix(coords) {
    if (!apiKey()) return Promise.reject(new Error("no_api_key"));
    if (!coords || coords.length < 2) return Promise.reject(new Error("not_enough_points"));
    if (coords.length > MAX_MATRIX_LOCATIONS) return Promise.reject(new Error("too_many_points"));
    return postJson("/matrix/driving-car", {
      locations: coords.map(function (c) {
        return [c.lon, c.lat];
      }),
      metrics: ["distance", "duration"],
    }).then(function (data) {
      if (!data || !data.distances || !data.durations) return Promise.reject(new Error("empty_matrix"));
      var distancesKm = data.distances.map(function (row) {
        return row.map(function (m) {
          return m == null ? null : m / 1000;
        });
      });
      var durationsMin = data.durations.map(function (row) {
        return row.map(function (s) {
          return s == null ? null : s / 60;
        });
      });
      return { distancesKm: distancesKm, durationsMin: durationsMin };
    });
  }

  /* Projette un point sur le tracé routier réel `geometry` (celui renvoyé
     par fetchRoute, [[lat,lon], ...]) : distance perpendiculaire au
     segment le plus proche, et position le long du trajet (0 = au départ,
     1 = à l'arrivée, mesurée en distance réelle le long de la route —
     pas à vol d'oiseau). Remplace crossTrack() de itinerary-engine.js
     (qui mesure par rapport à la ligne droite) quand un vrai tracé est
     disponible. Projection plane simple avec correction cosinus sur la
     longitude, comme le reste du moteur — largement suffisante à
     l'échelle de la France. */
  function projectToRoute(geometry, point) {
    if (!geometry || geometry.length < 2) return { distanceKm: Infinity, t: 0 };
    var latRef = geometry[Math.floor(geometry.length / 2)][0];
    var kx = 111.32 * Math.cos((latRef * Math.PI) / 180);
    var ky = 110.57;
    function toXY(lat, lon) {
      return [lon * kx, lat * ky];
    }
    var px = point.lon * kx;
    var py = point.lat * ky;

    var cum = [0];
    var i, a, b, segLen;
    for (i = 0; i < geometry.length - 1; i++) {
      a = toXY(geometry[i][0], geometry[i][1]);
      b = toXY(geometry[i + 1][0], geometry[i + 1][1]);
      segLen = Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]));
      cum.push(cum[cum.length - 1] + segLen);
    }
    var totalLen = cum[cum.length - 1] || 0;

    var best = Infinity;
    var bestAlong = 0;
    for (i = 0; i < geometry.length - 1; i++) {
      a = toXY(geometry[i][0], geometry[i][1]);
      b = toXY(geometry[i + 1][0], geometry[i + 1][1]);
      var dx = b[0] - a[0];
      var dy = b[1] - a[1];
      var len2 = dx * dx + dy * dy;
      var t = len2 === 0 ? 0 : ((px - a[0]) * dx + (py - a[1]) * dy) / len2;
      var tc = Math.max(0, Math.min(1, t));
      var projx = a[0] + tc * dx;
      var projy = a[1] + tc * dy;
      var ddx = px - projx;
      var ddy = py - projy;
      var d = Math.sqrt(ddx * ddx + ddy * ddy);
      if (d < best) {
        best = d;
        bestAlong = cum[i] + tc * Math.sqrt(len2);
      }
    }
    return { distanceKm: best, t: totalLen ? bestAlong / totalLen : 0 };
  }

  window.UGPT_ROUTING = {
    isConfigured: function () {
      return !!apiKey();
    },
    fetchRoute: fetchRoute,
    fetchMatrix: fetchMatrix,
    projectToRoute: projectToRoute,
    MAX_MATRIX_LOCATIONS: MAX_MATRIX_LOCATIONS,
  };
})();
