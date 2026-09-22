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

  var pts = [];
  window.__FICHES_MAP__.forEach(function (f) {
    if (!f.coords || typeof f.coords.lat !== "number" || typeof f.coords.lon !== "number") return;
    var marker = L.circleMarker([f.coords.lat, f.coords.lon], {
      radius: 9,
      color: "#fbfbf5",
      weight: 2,
      fillColor: themeColor(f.theme),
      fillOpacity: 0.95,
    }).addTo(map);
    marker.bindPopup(
      "<b>" + esc(f.title) + "</b>" + (f.summary ? esc(f.summary) : "") + '<br><a href="' + esc(f.url) + '">Voir la fiche →</a>'
    );
    marker.on("click", function () {
      marker.openPopup();
    });
    pts.push([f.coords.lat, f.coords.lon]);
  });

  if (pts.length > 1) {
    map.fitBounds(pts, { padding: [30, 30], maxZoom: 11 });
  } else if (pts.length === 1) {
    map.setView(pts[0], 11);
  }
})();
