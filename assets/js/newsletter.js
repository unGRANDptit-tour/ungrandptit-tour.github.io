/* Capture email sur la page d'accueil. Un document par adresse
   (id = adresse normalisée) dans la collection "newsletter", pour
   éviter les doublons. */
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

  var form = document.getElementById("newsletterForm");
  if (!form) return;

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var note = document.getElementById("newsletterNote");
    var emailEl = document.getElementById("newsletterEmail");
    var email = emailEl.value.trim().toLowerCase();
    if (!email) return;

    (window.UGPT ? window.UGPT.ready : Promise.resolve(false)).then(function (ok) {
      if (!ok || !window.UGPT.db) {
        if (note) note.textContent = "Firebase n'est pas encore configuré — l'inscription n'a pas pu être enregistrée.";
        toast("Non envoyé (Firebase non configuré)");
        return;
      }
      var id = email.replace(/[^a-z0-9@._-]/g, "_");
      window.UGPT.db
        .doc("newsletter/" + id)
        .set({ email: email, createdAt: new Date().toISOString() }, { merge: true })
        .then(function () {
          emailEl.value = "";
          if (note) note.textContent = "Inscription confirmée, merci !";
          toast("Inscription enregistrée");
        })
        .catch(function () {
          toast("L'inscription n'a pas pu être enregistrée");
        });
    });
  });
})();
