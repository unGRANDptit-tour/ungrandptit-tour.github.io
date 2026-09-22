/* Filtrage côté client du classement par thème / région, à partir des
   attributs data-themes / data-region posés sur chaque .fiche-card par
   build.js (aucune donnée n'est rechargée : tout est déjà dans la page). */
(function () {
  "use strict";

  var themeChips = document.getElementById("themeChips");
  var regionChips = document.getElementById("regionChips");
  var list = document.getElementById("rankList");
  if (!themeChips || !regionChips || !list) return;

  var items = Array.prototype.slice.call(list.children);
  var emptyNote = document.createElement("div");
  emptyNote.className = "empty-note";
  emptyNote.textContent = "Aucun lieu ne correspond à ces filtres pour l'instant.";
  emptyNote.hidden = true;
  list.appendChild(emptyNote);

  var state = { theme: "tous", region: "tous" };

  function applyFilters() {
    var visible = 0;
    items.forEach(function (el) {
      var themes = (el.getAttribute("data-themes") || "").split(",");
      var region = el.getAttribute("data-region") || "";
      var themeOk = state.theme === "tous" || themes.indexOf(state.theme) !== -1;
      var regionOk = state.region === "tous" || region === state.region;
      var show = themeOk && regionOk;
      el.hidden = !show;
      if (show) visible++;
    });
    emptyNote.hidden = visible !== 0;
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
      applyFilters();
    });
  }

  wireChips(themeChips, "theme");
  wireChips(regionChips, "region");
  applyFilters();
})();
