/* Vraie carte interactive (Leaflet + tuiles OpenStreetMap), à partir
   de window.__FICHES_MAP__ embarqué par build.js. Remplace l'ancienne
   carte stylisée en SVG de la version Artifact. */
(function () {
  "use strict";

  var el = document.getElementById("mapEl");
  if (!el || typeof L === "undefined" || !window.__FICHES_MAP__) return;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var THEME_VAR = { patrimoine: "--forest", spirituel: "--ochre", insolite: "--trail", nature: "--water" };
  function themeColor(theme) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(THEME_VAR[theme] || "--forest");
    return v && v.trim() ? v.trim() : "#2f4d3a";
  }

  var map = L.map(el, { zoomControl: true, attributionControl: true }).setView([46.6, 2.3], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  }).addTo(map);

  var entries = [];
  window.__FICHES_MAP__.forEach(function (f) {
    if (!f.coords || typeof f.coords.lat !== "number" || typeof f.coords.lon !== "number") return;
    var marker = L.circleMarker([f.coords.lat, f.coords.lon], {
      radius: 9,
      color: "#fbfbf5",
      weight: 2,
      fillColor: themeColor(f.theme),
      fillOpacity: 0.95,
    });
    marker.bindPopup(
      "<b>" + esc(f.title) + "</b>" + (f.summary ? esc(f.summary) : "") + '<br><a href="' + esc(f.url) + '">Voir la fiche →</a>'
    );
    marker.on("click", function () {
      marker.openPopup();
    });
    entries.push({ marker: marker, region: f.region, country: f.country, latlng: [f.coords.lat, f.coords.lon] });
  });

  function fitTo(list) {
    var pts = list.map(function (e) {
      return e.latlng;
    });
    if (pts.length > 1) {
      map.fitBounds(pts, { padding: [30, 30], maxZoom: 11 });
    } else if (pts.length === 1) {
      map.setView(pts[0], 11);
    } else {
      map.setView([46.6, 2.3], 6);
    }
  }

  // Le filtre pays (#mapCountryChips) n'existe dans la page que si un deuxième
  // pays a été ajouté à site.json — tant que seule la France est présente,
  // filterState.country reste "tous" en permanence et ce bloc est inerte.
  var filterState = { country: "tous", region: "tous" };

  function applyMapFilter() {
    var visible = [];
    entries.forEach(function (e) {
      var countryOk = filterState.country === "tous" || e.country === filterState.country;
      var regionOk = filterState.region === "tous" || e.region === filterState.region;
      var show = countryOk && regionOk;
      if (show) {
        if (!map.hasLayer(e.marker)) e.marker.addTo(map);
        visible.push(e);
      } else if (map.hasLayer(e.marker)) {
        map.removeLayer(e.marker);
      }
    });
    fitTo(visible);
  }

  applyMapFilter();

  function wireChips(chipsEl, key) {
    if (!chipsEl) return;
    chipsEl.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest(".chip") : null;
      if (!btn || !chipsEl.contains(btn)) return;
      Array.prototype.forEach.call(chipsEl.querySelectorAll(".chip"), function (c) {
        c.classList.remove("active");
      });
      btn.classList.add("active");
      filterState[key] = btn.getAttribute("data-" + key) || "tous";
      applyMapFilter();
    });
  }

  wireChips(document.getElementById("mapRegionChips"), "region");
  wireChips(document.getElementById("mapCountryChips"), "country");
})();
