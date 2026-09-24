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
  var map = null;
  var mapMarkers = [];
  var mapCircle = null;
  var mapRouteLine = null;

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

  function ensureMap(base, radiusKm, entries, depart) {
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
      // Mode "sur la route" : un repère par ville, un trait pointillé entre
      // les deux (approximatif — ce n'est pas un vrai itinéraire routier),
      // pas de cercle puisque la zone de recherche est un couloir, pas un rayon.
      L.circleMarker([depart.lat, depart.lon], { radius: 7, color: "#fff", weight: 2, fillColor: cssVar("--ink", "#1a1a1a"), fillOpacity: 1 })
        .addTo(map)
        .bindPopup("<b>Votre point de départ</b>");
      L.circleMarker([base.lat, base.lon], { radius: 7, color: "#fff", weight: 2, fillColor: cssVar("--accent", "#2b4c8c"), fillOpacity: 1 })
        .addTo(map)
        .bindPopup("<b>Votre destination</b>");
      mapRouteLine = L.polyline(
        [
          [depart.lat, depart.lon],
          [base.lat, base.lon],
        ],
        { color: cssVar("--ink-faint", "#857e6e"), weight: 2, dashArray: "2 8" }
      ).addTo(map);
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

    var pts = [[base.lat, base.lon]]
      .concat(depart ? [[depart.lat, depart.lon]] : [])
      .concat(
        entries.map(function (e) {
          return [e.fiche.coords.lat, e.fiche.coords.lon];
        })
      );
    if (pts.length > 1) map.fitBounds(pts, { padding: [24, 24], maxZoom: 12 });
    else map.setView([base.lat, base.lon], 10);
    setTimeout(function () {
      map.invalidateSize();
    }, 60);
  }

  function goToStep2(base, radiusKm, depart) {
    currentBase = base;
    currentDepart = depart || null;
    selectedIds = {};

    var inRadius = depart ? ENGINE.nearbyOnRoute(fiches, depart, base, radiusKm) : ENGINE.nearbyFiches(fiches, base, radiusKm);
    var inRadiusIds = {};
    inRadius.forEach(function (e) {
      inRadiusIds[e.fiche.id] = true;
    });

    // coups de cœur de la rédaction un peu plus loin que le rayon/couloir
    // choisi, que le visiteur n'aurait pas vus sinon — jamais mélangés aux
    // propositions "dans le rayon", toujours présentés à part.
    var wider = depart ? ENGINE.nearbyOnRoute(fiches, depart, base, radiusKm * 2) : ENGINE.nearbyFiches(fiches, base, radiusKm * 2);
    var reco = wider
      .filter(function (e) {
        return e.fiche.redactionPick && !inRadiusIds[e.fiche.id];
      })
      .slice(0, 5);

    renderProposals(inRadius);
    renderReco(reco);
    ensureMap(base, radiusKm, inRadius.concat(reco), depart);

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

  if (generateBtn) {
    generateBtn.addEventListener("click", function () {
      var ids = Object.keys(selectedIds);
      if (!ids.length) {
        toast("Choisissez au moins un lieu avant de générer votre itinéraire");
        return;
      }

      var params = {
        days: parseInt(daysInput.value, 10) || 1,
        pace: document.getElementById("it-pace").value,
        ficheIds: ids,
        startCoords: currentDepart || currentBase,
      };
      var email = emailEl ? emailEl.value.trim() : "";
      var placeRequest = placeRequestEl ? placeRequestEl.value.trim().slice(0, 300) : "";

      var plan = ENGINE.planItinerary(fiches, params, cfg);
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
        generateBtn.disabled = true;
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
            generateBtn.disabled = false;
          });
      });
    });
  }
})();
