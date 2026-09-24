/* Carte « Situer le lieu » d'une fiche (charte Signature) : vraie carte
   Leaflet, fond OpenStreetMap France, centrée sur le lieu, avec les autres
   lieux du guide autour. Données embarquées par build.js dans
   window.__FICHE_MAP__ = {title, lat, lon, verified, others:[{title,url,lat,lon,verified}]}. */
(function () {
  "use strict";

  var el = document.getElementById("ficheMap");
  var d = window.__FICHE_MAP__;
  if (!el || !d) return;

  if (typeof L === "undefined") {
    el.innerHTML = '<div class="map-fallback">La carte n’a pas pu se charger. Vérifiez la connexion puis rechargez la page.</div>';
    return;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var map = L.map(el, { zoomControl: true, scrollWheelZoom: false }).setView([d.lat, d.lon], 10);
  L.tileLayer("https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", {
    maxZoom: 19,
    subdomains: "abc",
    attribution:
      '&copy; <a href="https://www.openstreetmap.fr/" target="_blank" rel="noopener">OpenStreetMap France</a> | &copy; contributeurs <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(map);

  // Le lieu de la fiche : gros repère (bleu si vérifié, ambre sinon).
  var mainIcon = L.divIcon({
    className: "",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: '<span class="pin-main' + (d.verified ? "" : " draft") + '"></span>',
  });
  L.marker([d.lat, d.lon], { icon: mainIcon, title: d.title, alt: d.title, keyboard: false }).addTo(map);

  // Les autres lieux du guide, plus discrets, cliquables vers leur fiche.
  (d.others || []).forEach(function (o) {
    if (typeof o.lat !== "number" || typeof o.lon !== "number") return;
    L.circleMarker([o.lat, o.lon], {
      radius: 7,
      color: "#ffffff",
      weight: 2.5,
      fillColor: o.verified ? "#2b4c8c" : "#b3862b",
      fillOpacity: 1,
    })
      .addTo(map)
      .bindPopup("<b>" + esc(o.title) + '</b><a class="popup-link" href="' + esc(o.url) + '">Lire la fiche →</a>');
  });
})();
