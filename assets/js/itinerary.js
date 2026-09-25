/* Assistant "Créer mon itinéraire" (/itineraire/), en deux étapes :
   1. le visiteur indique où il compte séjourner (autocomplétion via
      l'API Adresse du gouvernement — gratuite, sans clé) et la distance
      qu'il est prêt à parcourir chaque jour ; on lui montre alors, sur
      la carte et dans une liste, les lieux vérifiés du magazine dans ce
      rayon, plus quelques coups de cœur de la rédaction un peu plus
      loin qu'il n'aurait pas choisis de lui-même ;
   2. il coche les lieux qui l'intéressent, et c'est CETTE sélection
      (jamais un filtre thème/région automatique) qui sert de base au
      calcul de l'itinéraire — algorithme déterministe de
      itinerary-engine.js, aucun appel IA, aucun serveur nécessaire.
   La demande est ensuite enregistrée dans Firestore pour passer par la
   file de modération de /bord/ avant toute confirmation à la personne. */
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

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return v && v.trim() ? v.trim() : fallback;
  }

  var step1 = document.getElementById("itinStep1");
  var step2 = document.getElementById("itinStep2");
  var resultEl = document.getElementById("itineraryResult");
  if (!step1 || !step2 || !resultEl || !window.UGPT_ITINERARY_ENGINE || !window.__FICHES_FOR_ITINERARY__) return;

  var ENGINE = window.UGPT_ITINERARY_ENGINE;
  var fiches = window.__FICHES_FOR_ITINERARY__;
  var cfg = window.__UGPT_ITINERARY_CFG__ || {};
  var THEME_LABELS = window.__UGPT_THEME_LABELS__ || {};
  var ficheById = {};
  fiches.forEach(function (f) {
    ficheById[f.id] = f;
  });

  /* ---------- étape 1 : point de départ (optionnel) + destination ----------
     Même mécanique d'autocomplétion (API Adresse gratuite) pour les deux
     champs : fabriquée une fois par setupAutocomplete(), instanciée deux
     fois avec son propre état (annulation de requête, minuteur, sélection)
     pour que les deux champs ne se marchent pas dessus. */
  var radiusSelect = document.getElementById("it-radius");
  var daysInput = document.getElementById("it-days");
  var step1Submit = document.getElementById("it-step1-submit");

  function setupAutocomplete(input, box, onSelectChange) {
    var selected = null; // {label, lat, lon}
    var searchAbort = null;
    var searchTimer = null;

    function clearSuggestions() {
      if (!box) return;
      box.innerHTML = "";
      box.hidden = true;
      box.__items = null;
    }

    function showSuggestions(items) {
      if (!box) return;
      if (!items.length) {
        box.innerHTML = '<div class="autocomplete-empty">Aucun lieu trouvé — essayez un autre nom.</div>';
        box.hidden = false;
        return;
      }
      box.innerHTML = items
        .map(function (it, i) {
          return '<div class="autocomplete-item" data-idx="' + i + '">' + esc(it.label) + "</div>";
        })
        .join("");
      box.hidden = false;
      box.__items = items;
    }

    function geocode(query) {
      if (searchAbort) {
        try {
          searchAbort.abort();
        } catch (e) {}
      }
      var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      searchAbort = ctrl;
      var url = "https://api-adresse.data.gouv.fr/search/?limit=6&q=" + encodeURIComponent(query);
      fetch(url, ctrl ? { signal: ctrl.signal } : {})
        .then(function (r) {
          return r.ok ? r.json() : Promise.reject(new Error("http_" + r.status));
        })
        .then(function (data) {
          var items = (data.features || [])
            .map(function (f) {
              if (!f.geometry || !f.geometry.coordinates) return null;
              return {
                label: (f.properties && f.properties.label) || query,
                lon: f.geometry.coordinates[0],
                lat: f.geometry.coordinates[1],
              };
            })
            .filter(Boolean);
          showSuggestions(items);
        })
        .catch(function (err) {
          if (err && err.name === "AbortError") return;
          if (box) {
            box.innerHTML = '<div class="autocomplete-empty">Recherche impossible pour l’instant — réessayez.</div>';
            box.hidden = false;
          }
        });
    }

    if (input) {
      input.addEventListener("input", function () {
        selected = null;
        if (onSelectChange) onSelectChange(null);
        var q = input.value.trim();
        clearTimeout(searchTimer);
        if (q.length < 3) {
          clearSuggestions();
          return;
        }
        searchTimer = setTimeout(function () {
          geocode(q);
        }, 300);
      });
      input.addEventListener("blur", function () {
        // délai pour laisser le mousedown sur une suggestion se déclencher
        // avant que le blur ne referme la liste
        setTimeout(clearSuggestions, 150);
      });
    }

    if (box) {
      box.addEventListener("mousedown", function (e) {
        var item = e.target.closest ? e.target.closest(".autocomplete-item") : null;
        if (!item) return;
        e.preventDefault();
        var idx = parseInt(item.getAttribute("data-idx"), 10);
        var items = box.__items || [];
        var picked = items[idx];
        if (!picked) return;
        selected = picked;
        if (input) input.value = picked.label;
        clearSuggestions();
        if (onSelectChange) onSelectChange(selected);
      });
    }

    return {
      setValue: function (v) {
        selected = v;
      },
      get: function () {
        return selected;
      },
      triggerSearch: function (q) {
        if (input) input.value = q;
        geocode(q);
      },
    };
  }

  var selectedPlace = null; // {label, lat, lon} — destination (obligatoire)
  var selectedDepart = null; // {label, lat, lon} — départ (optionnel, pour le mode "sur la route")

  function updateStep1Submit() {
    if (step1Submit) step1Submit.disabled = !selectedPlace;
  }

  var placeInput = document.getElementById("it-place");
  var placeAuto = setupAutocomplete(placeInput, document.getElementById("it-place-suggestions"), function (v) {
    selectedPlace = v;
    updateStep1Submit();
  });
  var departInput = document.getElementById("it-depart");
  var departAuto = setupAutocomplete(departInput, document.getElementById("it-depart-suggestions"), function (v) {
    selectedDepart = v;
  });

  updateStep1Submit();

  /* ---------- pré-remplissage depuis le formulaire de l'accueil ----------
     /itineraire/?lieu=Bourges&km=50&jours=2 : on recopie les valeurs et on
     lance la recherche du lieu ; le visiteur n'a plus qu'à choisir la bonne
     suggestion (c'est elle qui fixe le point de départ exact). */
  (function prefillFromQuery() {
    var qs;
    try {
      qs = new URLSearchParams(window.location.search);
    } catch (e) {
      return;
    }
    var km = qs.get("km");
    var jours = qs.get("jours");
    var lieu = qs.get("lieu");
    if (km && radiusSelect && /^\d{1,3}$/.test(km) && radiusSelect.querySelector('option[value="' + km + '"]')) {
      radiusSelect.value = km;
    }
    if (jours && daysInput && /^\d{1,2}$/.test(jours)) {
      var max = parseInt(daysInput.getAttribute("max") || "14", 10);
      daysInput.value = String(Math.max(1, Math.min(max, parseInt(jours, 10))));
    }
    if (lieu && placeInput) {
      placeInput.value = lieu.slice(0, 120);
      try {
        placeInput.focus({ preventScroll: true });
      } catch (e) {}
      placeInput.dispatchEvent(new Event("input"));
    }
  })();

  /* ---------- étape 2 : propositions + sélection ---------- */
  var proposalsEl = document.getElementById("itinProposals");
  var recoBlockEl = document.getElementById("itinRecoBlock");
  var recoEl = document.getElementById("itinReco");
  var step2Sub = document.getElementById("it-step2-sub");
  var mapEl = document.getElementById("itinMap");
  var backBtn = document.getElementById("it-back");
  var generateBtn = document.getElementById("it-generate");
  var placeRequestEl = document.getElementById("it-place-request");
  var emailEl = document.getElementById("it-email");
  var noteEl = document.getElementById("it-note");

  var selectedIds = {};
  var currentBase = null;
  var currentDepart = null; // non-null quand le mode "sur la route" est actif
  var currentRouteGeometry = null; // vrai tracé routier (OpenRouteService), sinon null = ligne droite de secours
  var map = null;
  var mapMarkers = [];
  var mapCircle = null;
  var mapRouteLine = null;

  var ROUTING = window.UGPT_ROUTING || null;

  /* Variante de ENGINE.nearbyOnRoute() qui mesure la distance au vrai
     tracé routier (routeGeometry, renvoyé par ROUTING.fetchRoute) plutôt
     qu'à la ligne droite départ->destination — même filtre/tri, juste la
     mesure de distance qui change. Utilisée seulement quand un tracé réel
     a pu être obtenu ; sinon on retombe sur ENGINE.nearbyOnRoute comme
     avant. */
  function nearbyOnRouteReal(list, routeGeometry, corridorKm) {
    var out = [];
    list.forEach(function (f) {
      if (f.status && f.status !== "verifie" && f.status !== "reserve") return;
      if (!f.coords || typeof f.coords.lat !== "number") return;
      var r = ROUTING.projectToRoute(routeGeometry, f.coords);
      if (r.t < -0.05 || r.t > 1.05) return;
      if (r.distanceKm <= corridorKm) out.push({ fiche: f, distanceKm: r.distanceKm, t: r.t });
    });
    out.sort(function (a, b) {
      return a.t - b.t;
    });
    return out;
  }

  var THEME_VAR = { patrimoine: "--forest", spirituel: "--ochre", insolite: "--trail", nature: "--water" };
  function themeColor(theme) {
    return cssVar(THEME_VAR[theme] || "--forest", "#2f4d3a");
  }

  function proposalItemHtml(entry) {
    var f = entry.fiche;
    var theme = (f.themes && f.themes[0]) || null;
    var themeLabel = theme && THEME_LABELS[theme] ? THEME_LABELS[theme] : "";
    var visitMin = f.visitDurationMin || cfg.defaultVisitDurationMin || 60;
    var visitTxt = ENGINE.formatDuration(visitMin);
    var glyph = f.image
      ? '<img src="' + esc(f.image) + '" alt="" loading="lazy">'
      : '<svg viewBox="0 0 24 24" style="width:26px;height:26px;stroke:var(--accent);fill:none;stroke-width:1.5;"><circle cx="12" cy="12" r="8"/></svg>';
    return (
      '<label class="itin-proposal-item">' +
      '<input type="checkbox" class="itin-proposal-check" data-fiche="' +
      esc(f.id) +
      '"' +
      (selectedIds[f.id] ? " checked" : "") +
      "><span class=\"card-glyph\">" +
      glyph +
      '</span><span class="card-body"><span class="itin-proposal-title">' +
      esc(f.title) +
      (f.redactionPick ? ' <span class="tag reco-tag">Coup de cœur</span>' : "") +
      '</span><span class="itin-proposal-meta">' +
      Math.round(entry.distanceKm) +
      " km" +
      (themeLabel ? " · " + esc(themeLabel) : "") +
      " · visite ~" +
      visitTxt +
      "</span></span></label>"
    );
  }

  function renderProposals(list) {
    if (!proposalsEl) return;
    if (!list.length) {
      proposalsEl.innerHTML =
        '<p class="muted-note" style="padding:0 16px;">Aucun lieu vérifié à proximité pour l’instant — essayez une distance journalière plus large.</p>';
      return;
    }
    proposalsEl.innerHTML = list.map(proposalItemHtml).join("");
  }

  function renderReco(list) {
    if (!recoBlockEl || !recoEl) return;
    if (!list.length) {
      recoBlockEl.hidden = true;
      recoEl.innerHTML = "";
      return;
    }
    recoBlockEl.hidden = false;
    recoEl.innerHTML = list.map(proposalItemHtml).join("");
  }

  function updateMapSelection() {
    mapMarkers.forEach(function (m) {
      var on = !!selectedIds[m.id];
      m.marker.setStyle({ fillOpacity: on ? 1 : 0.5, radius: on ? 10 : 8, weight: on ? 3 : 1.5 });
    });
  }

  function onProposalChange(e) {
    var box = e.target.closest ? e.target.closest(".itin-proposal-check") : null;
    if (!box) return;
    var id = box.getAttribute("data-fiche");
    if (!id) return;
    if (box.checked) selectedIds[id] = true;
    else delete selectedIds[id];
    updateMapSelection();
  }
  if (proposalsEl) proposalsEl.addEventListener("change", onProposalChange);
  if (recoEl) recoEl.addEventListener("change", onProposalChange);

  function ensureMap(base, radiusKm, entries, depart, routeGeometry) {
    if (!mapEl || typeof L === "undefined") return;
    if (!map) {
      map = L.map(mapEl, { zoomControl: true, attributionControl: true });
      L.tileLayer("https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", {
        maxZoom: 19,
        subdomains: "abc",
        attribution:
          '&copy; <a href="https://www.openstreetmap.fr/" target="_blank" rel="noopener">OpenStreetMap France</a> | &copy; contributeurs <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      }).addTo(map);
    }
    mapMarkers.forEach(function (m) {
      map.removeLayer(m.marker);
    });
    mapMarkers = [];
    if (mapCircle) {
      map.removeLayer(mapCircle);
      mapCircle = null;
    }
    if (mapRouteLine) {
      map.removeLayer(mapRouteLine);
      mapRouteLine = null;
    }

    if (depart) {
      // Mode "sur la route" : un repère par ville, et le trajet entre les
      // deux — un vrai tracé routier (routeGeometry, via OpenRouteService)
      // quand on a pu l'obtenir ; sinon une ligne droite en pointillés,
      // de secours uniquement (service indisponible), pas de cercle
      // puisque la zone de recherche est un couloir, pas un rayon.
      L.circleMarker([depart.lat, depart.lon], { radius: 7, color: "#fff", weight: 2, fillColor: cssVar("--ink", "#1a1a1a"), fillOpacity: 1 })
        .addTo(map)
        .bindPopup("<b>Votre point de départ</b>");
      L.circleMarker([base.lat, base.lon], { radius: 7, color: "#fff", weight: 2, fillColor: cssVar("--accent", "#2b4c8c"), fillOpacity: 1 })
        .addTo(map)
        .bindPopup("<b>Votre destination</b>");
      if (routeGeometry && routeGeometry.length > 1) {
        mapRouteLine = L.polyline(routeGeometry, {
          color: cssVar("--accent-deep", "#1e3665"),
          weight: 4,
          opacity: 0.85,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(map);
      } else {
        mapRouteLine = L.polyline(
          [
            [depart.lat, depart.lon],
            [base.lat, base.lon],
          ],
          { color: cssVar("--accent-deep", "#1e3665"), weight: 4, opacity: 0.85, dashArray: "10 6", lineCap: "round" }
        ).addTo(map);
      }
    } else {
      L.circleMarker([base.lat, base.lon], { radius: 7, color: "#fff", weight: 2, fillColor: cssVar("--ink", "#1a1a1a"), fillOpacity: 1 })
        .addTo(map)
        .bindPopup("<b>Votre point de départ</b>");

      mapCircle = L.circle([base.lat, base.lon], {
        radius: radiusKm * 1000,
        color: cssVar("--forest", "#2f4d3a"),
        weight: 1,
        fillOpacity: 0.05,
      }).addTo(map);
    }

    entries.forEach(function (entry) {
      var f = entry.fiche;
      var theme = (f.themes && f.themes[0]) || null;
      var marker = L.circleMarker([f.coords.lat, f.coords.lon], {
        radius: 8,
        color: "#fbfbf5",
        weight: 1.5,
        fillColor: themeColor(theme),
        fillOpacity: 0.5,
      }).addTo(map);
      marker.bindPopup("<b>" + esc(f.title) + "</b>");
      marker.on("click", function () {
        marker.openPopup();
      });
      mapMarkers.push({ id: f.id, marker: marker });
    });

    var routePts = depart && routeGeometry && routeGeometry.length > 1 ? routeGeometry : depart ? [[depart.lat, depart.lon]] : [];
    var pts = [[base.lat, base.lon]]
      .concat(routePts)
      .concat(
        entries.map(function (e) {
          return [e.fiche.coords.lat, e.fiche.coords.lon];
        })
      );
    if (pts.length > 1) map.fitBounds(pts, { padding: [48, 48], maxZoom: depart ? 10 : 12 });
    else map.setView([base.lat, base.lon], 10);
    setTimeout(function () {
      map.invalidateSize();
    }, 60);
  }

  function finishStep2(base, radiusKm, depart, inRadius, wider, routeGeometry) {
    currentRouteGeometry = routeGeometry || null;
    var inRadiusIds = {};
    inRadius.forEach(function (e) {
      inRadiusIds[e.fiche.id] = true;
    });

    // coups de cœur de la rédaction un peu plus loin que le rayon/couloir
    // choisi, que le visiteur n'aurait pas vus sinon — jamais mélangés aux
    // propositions "dans le rayon", toujours présentés à part.
    var reco = wider
      .filter(function (e) {
        return e.fiche.redactionPick && !inRadiusIds[e.fiche.id];
      })
      .slice(0, 5);

    renderProposals(inRadius);
    renderReco(reco);
    ensureMap(base, radiusKm, inRadius.concat(reco), depart, routeGeometry);

    if (step2Sub) {
      if (depart) {
        step2Sub.textContent =
          (inRadius.length
            ? inRadius.length + (inRadius.length > 1 ? " lieux vérifiés trouvés sur la route entre " : " lieu vérifié trouvé sur la route entre ")
            : "Aucun lieu vérifié sur la route entre ") +
          depart.label +
          " et " +
          base.label +
          (inRadius.length ? "" : " pour l’instant") +
          " (couloir de " +
          radiusKm +
          " km). Cochez ceux qui vous intéressent.";
      } else {
        step2Sub.textContent =
          (inRadius.length
            ? inRadius.length + (inRadius.length > 1 ? " lieux vérifiés trouvés autour de " : " lieu vérifié trouvé autour de ") + base.label
            : "Aucun lieu vérifié autour de " + base.label + " pour l’instant") +
          " (jusqu'à " +
          radiusKm +
          " km/jour). Cochez ceux qui vous intéressent.";
      }
    }

    step1.hidden = true;
    step2.hidden = false;
    resultEl.innerHTML = "";
    step2.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function setStep1Loading(on) {
    if (!step1Submit) return;
    if (on) {
      step1Submit.disabled = true;
      if (!step1Submit.__defaultLabel) step1Submit.__defaultLabel = step1Submit.textContent;
      step1Submit.textContent = "Calcul de l'itinéraire routier…";
    } else {
      step1Submit.disabled = !selectedPlace;
      if (step1Submit.__defaultLabel) step1Submit.textContent = step1Submit.__defaultLabel;
    }
  }

  function goToStep2(base, radiusKm, depart) {
    currentBase = base;
    currentDepart = depart || null;
    selectedIds = {};

    if (depart && ROUTING && ROUTING.isConfigured()) {
      // On essaie d'obtenir le vrai tracé routier départ -> destination :
      // sert à la fois à dessiner un trait crédible sur la carte et à
      // mesurer la distance des lieux candidats à la vraie route plutôt
      // qu'à une ligne droite. En cas d'échec (service indisponible,
      // quota, délai dépassé), on retombe silencieusement sur l'ancien
      // calcul à vol d'oiseau — l'assistant continue de fonctionner.
      setStep1Loading(true);
      ROUTING.fetchRoute([depart, base])
        .then(function (routeInfo) {
          var inRadius = nearbyOnRouteReal(fiches, routeInfo.geometry, radiusKm);
          var wider = nearbyOnRouteReal(fiches, routeInfo.geometry, radiusKm * 2);
          finishStep2(base, radiusKm, depart, inRadius, wider, routeInfo.geometry);
        })
        .catch(function () {
          var inRadius = ENGINE.nearbyOnRoute(fiches, depart, base, radiusKm);
          var wider = ENGINE.nearbyOnRoute(fiches, depart, base, radiusKm * 2);
          finishStep2(base, radiusKm, depart, inRadius, wider, null);
        })
        .then(function () {
          setStep1Loading(false);
        });
      return;
    }

    var inRadius = depart ? ENGINE.nearbyOnRoute(fiches, depart, base, radiusKm) : ENGINE.nearbyFiches(fiches, base, radiusKm);
    var wider = depart ? ENGINE.nearbyOnRoute(fiches, depart, base, radiusKm * 2) : ENGINE.nearbyFiches(fiches, base, radiusKm * 2);
    finishStep2(base, radiusKm, depart, inRadius, wider, null);
  }

  step1.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!selectedPlace) {
      toast("Choisissez un lieu dans la liste proposée");
      return;
    }
    if (window.UGPT_PAUSED) {
      toast("La génération d'itinéraires est suspendue pour l'instant");
      return;
    }
    var maxDays = cfg.maxDaysRequestable || 14;
    var days = parseInt(daysInput.value, 10);
    if (!days || days < 1) days = 1;
    if (days > maxDays) days = maxDays;
    daysInput.value = days;

    var radiusKm = parseInt(radiusSelect.value, 10) || 50;
    goToStep2(selectedPlace, radiusKm, selectedDepart);
  });

  if (backBtn) {
    backBtn.addEventListener("click", function () {
      step2.hidden = true;
      step1.hidden = false;
      resultEl.innerHTML = "";
    });
  }

  var generateBtnDefaultLabel = generateBtn ? generateBtn.textContent : "";
  function setGenerateLoading(on) {
    if (!generateBtn) return;
    generateBtn.disabled = on;
    generateBtn.textContent = on ? "Calcul des temps de route…" : generateBtnDefaultLabel;
  }

  /* Construit, à partir d'une vraie matrice de distances/durées routières
     (ROUTING.fetchMatrix), la fonction distanceFn attendue par
     ENGINE.planItinerary : (fromId, toFiche) -> {distanceKm, travelMin}.
     matrixCoords[0] est toujours le point de départ ("start") ; les
     suivants correspondent à selectedFiches, dans le même ordre. */
  function buildMatrixDistanceFn(matrix, selectedFiches) {
    var idxById = {};
    selectedFiches.forEach(function (f, i) {
      idxById[f.id] = i + 1;
    });
    return function (fromId, toFiche) {
      var fromIdx = fromId === "start" ? 0 : idxById[fromId];
      var toIdx = idxById[toFiche.id];
      if (fromIdx == null || toIdx == null) return null;
      var km = matrix.distancesKm[fromIdx] ? matrix.distancesKm[fromIdx][toIdx] : null;
      var min = matrix.durationsMin[fromIdx] ? matrix.durationsMin[fromIdx][toIdx] : null;
      if (km == null || min == null) return null;
      return { distanceKm: km, travelMin: min };
    };
  }

  function finishGenerate(params, plan, email, placeRequest) {
    window.UGPT_renderItineraryPlan(resultEl, plan, ficheById, {
      placeRequest: placeRequest,
      startLabel: currentDepart ? currentDepart.label : currentBase ? currentBase.label : null,
    });
    resultEl.scrollIntoView({ behavior: "smooth", block: "start" });

    if (!plan.ok && !placeRequest) return;

    (window.UGPT ? window.UGPT.ready : Promise.resolve(false)).then(function (ok) {
      if (!ok || !window.UGPT.db) {
        if (noteEl)
          noteEl.textContent =
            "Itinéraire généré ci-dessous. Firebase n'est pas encore configuré : cette demande n'a pas pu être transmise à la rédaction pour l'instant.";
        return;
      }
      var uid = window.UGPT.auth && window.UGPT.auth.currentUser ? window.UGPT.auth.currentUser.uid : null;
      if (generateBtn) generateBtn.disabled = true;
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
          if (noteEl) {
            noteEl.innerHTML =
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
          if (noteEl)
            noteEl.textContent = "Itinéraire généré ci-dessous, mais la demande n'a pas pu être transmise à la rédaction (erreur réseau).";
        })
        .then(function () {
          if (generateBtn) generateBtn.disabled = false;
        });
    });
  }

  if (generateBtn) {
    generateBtn.addEventListener("click", function () {
      var ids = Object.keys(selectedIds);
      if (!ids.length) {
        toast("Choisissez au moins un lieu avant de générer votre itinéraire");
        return;
      }

      var startCoords = currentDepart || currentBase;
      var params = {
        days: parseInt(daysInput.value, 10) || 1,
        pace: document.getElementById("it-pace").value,
        ficheIds: ids,
        startCoords: startCoords,
      };
      var email = emailEl ? emailEl.value.trim() : "";
      var placeRequest = placeRequestEl ? placeRequestEl.value.trim().slice(0, 300) : "";

      var selectedFiches = ids.map(function (id) {
        return ficheById[id];
      }).filter(function (f) {
        return f && f.coords;
      });

      // Vraie matrice de distances/durées routières entre le point de
      // départ et tous les lieux cochés : sert à regrouper les jours de
      // façon réaliste et à afficher des temps de route exacts. Au-delà
      // de la limite gratuite de points, ou en cas d'échec/délai dépassé,
      // on retombe sur l'estimation habituelle à vol d'oiseau — jamais de
      // blocage de la génération pour une question de routage.
      var canUseMatrix =
        ROUTING && ROUTING.isConfigured() && startCoords && selectedFiches.length && 1 + selectedFiches.length <= ROUTING.MAX_MATRIX_LOCATIONS;

      if (canUseMatrix) {
        setGenerateLoading(true);
        ROUTING.fetchMatrix([startCoords].concat(selectedFiches.map(function (f) { return f.coords; })))
          .then(function (matrix) {
            var distanceFn = buildMatrixDistanceFn(matrix, selectedFiches);
            var plan = ENGINE.planItinerary(fiches, params, cfg, distanceFn);
            finishGenerate(params, plan, email, placeRequest);
          })
          .catch(function () {
            var plan = ENGINE.planItinerary(fiches, params, cfg);
            finishGenerate(params, plan, email, placeRequest);
          })
          .then(function () {
            setGenerateLoading(false);
          });
        return;
      }

      var plan = ENGINE.planItinerary(fiches, params, cfg);
      finishGenerate(params, plan, email, placeRequest);
    });
  }
})();
