/* Deux menus déroulants liés : région, puis département (repeuplé selon la
   région choisie), pour chaque bloc `.region-dept-filter` présent sur la page
   (accueil, carte, classement en ont chacun un). Remplace les anciens chips
   de région, qui débordaient et coupaient les dernières régions en version
   bureau. Émet un événement "rdfilter" (bubbles) sur le bloc à chaque
   changement, avec {region, departement} — c'est ce qu'écoutent map.js et
   classement.js pour appliquer le filtre. Ne connaît rien du reste de la
   page : reste un petit module autonome, réutilisable partout. */
(function () {
  "use strict";

  var groups = Array.prototype.slice.call(document.querySelectorAll(".region-dept-filter[data-filter-group]"));
  if (!groups.length) return;

  var deptByRegion = window.__DEPT_BY_REGION__ || {};

  groups.forEach(function (group) {
    var regionSelect = group.querySelector('select[data-role="region"]');
    var deptSelect = group.querySelector('select[data-role="departement"]');
    if (!regionSelect || !deptSelect) return;

    function populateDept(regionKey) {
      var list = regionKey !== "tous" ? deptByRegion[regionKey] || [] : [];
      deptSelect.innerHTML = "";
      var allOpt = document.createElement("option");
      allOpt.value = "tous";
      allOpt.textContent = regionKey === "tous" ? "Tous les départements" : "Tous les départements de la région";
      deptSelect.appendChild(allOpt);
      list.forEach(function (d) {
        var opt = document.createElement("option");
        opt.value = d.code;
        opt.textContent = d.name;
        deptSelect.appendChild(opt);
      });
      deptSelect.disabled = regionKey === "tous";
      deptSelect.value = "tous";
    }

    function emit() {
      var detail = { region: regionSelect.value, departement: deptSelect.value };
      group.dispatchEvent(new CustomEvent("rdfilter", { detail: detail, bubbles: true }));
    }

    regionSelect.addEventListener("change", function () {
      populateDept(regionSelect.value);
      emit();
    });
    deptSelect.addEventListener("change", emit);

    populateDept("tous");
  });
})();
