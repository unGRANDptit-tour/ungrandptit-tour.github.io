/* Formulaire "Proposer un lieu" (/contribuer/). Écrit une proposition
   dans la collection Firestore "suggestions", visible uniquement par
   la rédaction depuis /bord/. */
(function () {
  "use strict";

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

  var form = document.getElementById("suggestForm");
  if (!form) return;

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = document.getElementById("sg-submit");
    var note = document.getElementById("sg-note");

    if (window.UGPT_PAUSED) {
      toast("L'envoi de propositions est suspendu pour l'instant");
      return;
    }

    var data = {
      name: document.getElementById("sg-name").value.trim(),
      region: document.getElementById("sg-region").value.trim(),
      theme: document.getElementById("sg-theme").value,
      desc: document.getElementById("sg-desc").value.trim(),
      link: document.getElementById("sg-link").value.trim(),
      contact: document.getElementById("sg-contact").value.trim(),
      status: "nouvelle",
      createdAt: new Date().toISOString(),
    };
    if (!data.name || !data.desc) return;

    (window.UGPT ? window.UGPT.ready : Promise.resolve(false)).then(function (ok) {
      if (!ok || !window.UGPT.db) {
        if (note) note.textContent = "Firebase n'est pas encore configuré — votre proposition n'a pas pu être enregistrée en ligne.";
        toast("Non envoyé (Firebase non configuré)");
        return;
      }
      if (btn) btn.disabled = true;
      window.UGPT.db
        .collection("suggestions")
        .add(data)
        .then(function () {
          form.reset();
          if (note) note.textContent = "Merci ! Votre proposition a bien été transmise à la rédaction.";
          toast("Proposition envoyée");
        })
        .catch(function () {
          toast("La proposition n'a pas pu être envoyée");
        })
        .then(function () {
          if (btn) btn.disabled = false;
        });
    });
  });
})();
