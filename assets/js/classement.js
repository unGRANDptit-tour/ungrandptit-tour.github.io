/* Filtrage côté client du classement par thème / sous-catégorie / pays / région,
   à partir des attributs data-themes / data-sub / data-country / data-region
   posés sur chaque .fiche-card par build.js (aucune donnée n'est rechargée :
   tout est déjà dans la page). Le filtre "pays" (#countryChips) n'existe dans
   le HTML que si un deuxième pays a été ajouté à site.json — tant que seule la
   France est présente, ce bloc reste inactif de lui-même. */
(function () {
  "use strict";

  var themeChips = document.getElementById("themeChips");
  var regionChips = document.getElementById("regionChips");
  var countryChips = document.getElementById("countryChips");
  var subEyebrow = document.getElementById("subEyebrow");
  var list = document.getElementById("rankList");
  if (!themeChips || !regionChips || !list) return;

  var subRows = Array.prototype.slice.call(document.querySelectorAll(".sub-chip-row"));

  var items = Array.prototype.slice.call(list.children);
  var emptyNote = document.createElement("div");
  emptyNote.className = "empty-note";
  emptyNote.textContent = "Aucun lieu ne correspond à ces filtres pour l'instant.";
  emptyNote.hidden = true;
  list.appendChild(emptyNote);

  var state = { theme: "tous", sub: "tous", country: "tous", region: "tous" };

  function applyFilters() {
    var visible = 0;
    items.forEach(function (el) {
      var themes = (el.getAttribute("data-themes") || "").split(",");
      var sub = el.getAttribute("data-sub") || "";
      var country = el.getAttribute("data-country") || "";
      var region = el.getAttribute("data-region") || "";
      var themeOk = state.theme === "tous" || themes.indexOf(state.theme) !== -1;
      var subOk = state.theme === "tous" || state.sub === "tous" || sub === state.sub;
      var countryOk = state.country === "tous" || country === state.country;
      var regionOk = state.region === "tous" || region === state.region;
      var show = themeOk && subOk && countryOk && regionOk;
      el.hidden = !show;
      if (show) visible++;
    });
    emptyNote.hidden = visible !== 0;
  }

  function showSubRowFor(theme) {
    var activeRow = null;
    subRows.forEach(function (row) {
      var match = row.getAttribute("data-for-theme") === theme;
      row.hidden = !match;
      if (match) activeRow = row;
    });
    if (subEyebrow) subEyebrow.hidden = !activeRow;
    // reset sub-selection whenever the theme changes
    state.sub = "tous";
    if (activeRow) {
      Array.prototype.forEach.call(activeRow.querySelectorAll(".chip"), function (c) {
        c.classList.toggle("active", c.getAttribute("data-sub") === "tous");
      });
    }
  }

  function wireChips(container, key) {
    container.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest(".chip") : null;
      if (!btn || !container.contains(btn)) return;
      Array.prototype.forEach.call(container.querySelectorAll(".chip"), function (c) {
        c.classList.remove("active");
      });
      btn.classList.add("active");
      state[key] = btn.getAttribute("data-" + key) || "tous";
      if (key === "theme") showSubRowFor(state.theme);
      applyFilters();
    });
  }

  wireChips(themeChips, "theme");
  wireChips(regionChips, "region");
  if (countryChips) wireChips(countryChips, "country");
  subRows.forEach(function (row) {
    wireChips(row, "sub");
  });

  showSubRowFor(state.theme);
  applyFilters();
})();
