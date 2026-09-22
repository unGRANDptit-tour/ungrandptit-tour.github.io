/* "Lectures recommandées" sur la page fiche : quelques autres fiches
   partageant un thème ou une région, calculées côté client à partir
   de window.__ALL_FICHES__ (embarqué par build.js). */
(function () {
  "use strict";

  var scroll = document.getElementById("recoScroll");
  if (!scroll || !window.__ALL_FICHES__ || !window.__CURRENT_FICHE__) return;

  var THEME_VAR = {
    patrimoine: "--forest-tint",
    spirituel: "--ochre-tint",
    insolite: "--trail-tint",
    nature: "--water-tint",
  };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var all = window.__ALL_FICHES__;
  var current = null;
  for (var i = 0; i < all.length; i++) {
    if (all[i].id === window.__CURRENT_FICHE__) {
      current = all[i];
      break;
    }
  }
  var others = all.filter(function (f) {
    return f.id !== window.__CURRENT_FICHE__;
  });

  var scored = others
    .map(function (f) {
      var shared = current ? f.themes.filter(function (t) { return current.themes.indexOf(t) !== -1; }).length : 0;
      var sameRegion = current && f.region === current.region && f.region !== "a_confirmer" ? 1 : 0;
      return { f: f, score: shared * 2 + sameRegion };
    })
    .sort(function (a, b) {
      return b.score - a.score;
    })
    .slice(0, 6)
    .map(function (x) {
      return x.f;
    });

  var block = scroll.closest(".block") || scroll.parentElement;
  if (!scored.length) {
    if (block) block.hidden = true;
    return;
  }

  scroll.innerHTML = scored
    .map(function (f) {
      var glyph = f.image
        ? '<img src="' + esc(f.image) + '" alt="" style="width:100%;height:100%;object-fit:cover;display:block;">'
        : "";
      var bg = f.image ? "" : "background:var(" + (THEME_VAR[f.themes[0]] || "--forest-tint") + ");";
      return (
        '<a class="reco-card" href="' +
        esc(f.url) +
        '" style="display:block;text-decoration:none;color:inherit;">' +
        '<div class="card-glyph" style="' +
        bg +
        '">' +
        glyph +
        "</div>" +
        "<h4>" +
        esc(f.title) +
        "</h4>" +
        "</a>"
      );
    })
    .join("");
})();
