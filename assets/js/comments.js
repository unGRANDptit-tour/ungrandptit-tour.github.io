/* Commentaires modérés sur la page fiche : liste des commentaires
   approuvés (#commentList) + formulaire d'envoi (#commentFormWrap).
   Chaque nouveau commentaire est créé avec status:"pending" et
   n'apparaît publiquement qu'une fois validé depuis /bord/. */
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

  function timeAgo(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return "à l'instant";
    if (diff < 3600) return Math.floor(diff / 60) + " min";
    if (diff < 86400) return Math.floor(diff / 3600) + " h";
    return Math.floor(diff / 86400) + " j";
  }

  function renderList(el, comments) {
    if (!comments.length) {
      el.innerHTML = '<p class="muted-note">Aucun commentaire pour l’instant — soyez le premier à réagir.</p>';
      return;
    }
    el.innerHTML = comments
      .map(function (c) {
        return (
          '<div class="comment-item"><div class="comment-head"><b>' +
          esc(c.name || "Anonyme") +
          "</b><span>" +
          esc(timeAgo(c.createdAt)) +
          '</span></div><div class="comment-text">' +
          esc(c.text) +
          "</div></div>"
        );
      })
      .join("");
  }

  var listEl = document.getElementById("commentList");
  var formWrap = document.getElementById("commentFormWrap");
  if (!listEl || !formWrap || !window.__CURRENT_FICHE__) return;
  var ficheId = window.__CURRENT_FICHE__;

  formWrap.innerHTML =
    '<form class="comment-form" id="commentForm">' +
    '<input id="c-name" placeholder="Votre prénom" maxlength="60" required>' +
    '<textarea id="c-text" rows="3" placeholder="Votre commentaire…" maxlength="600" required></textarea>' +
    '<button class="btn-primary" id="c-submit" type="button">Envoyer</button>' +
    '<p class="muted-note" id="c-note">Les commentaires sont publiés après relecture par la rédaction.</p>' +
    "</form>";

  listEl.innerHTML = '<p class="muted-note">Chargement des commentaires…</p>';

  (window.UGPT ? window.UGPT.ready : Promise.resolve(false)).then(function (ok) {
    var submitBtn = document.getElementById("c-submit");
    var note = document.getElementById("c-note");

    if (!ok || !window.UGPT.db) {
      listEl.innerHTML = '<p class="muted-note">Commentaires indisponibles pour l’instant (Firebase non configuré).</p>';
      if (submitBtn) submitBtn.disabled = true;
      return;
    }
    var db = window.UGPT.db;
    var uid = window.UGPT.auth && window.UGPT.auth.currentUser ? window.UGPT.auth.currentUser.uid : null;

    db.collection("comments")
      .where("ficheId", "==", ficheId)
      .onSnapshot(
        function (snap) {
          var items = [];
          snap.forEach(function (doc) {
            var d = doc.data();
            if (d.status === "approved") items.push(d);
          });
          items.sort(function (a, b) {
            return new Date(b.createdAt) - new Date(a.createdAt);
          });
          renderList(listEl, items);
        },
        function () {
          listEl.innerHTML = '<p class="muted-note">Impossible de charger les commentaires pour le moment.</p>';
        }
      );

    if (submitBtn) {
      submitBtn.addEventListener("click", function () {
        if (window.UGPT_PAUSED) {
          toast("Les commentaires sont suspendus pour l'instant");
          return;
        }
        var nameEl = document.getElementById("c-name");
        var textEl = document.getElementById("c-text");
        var name = nameEl.value.trim();
        var text = textEl.value.trim();
        if (!name || !text) {
          toast("Merci de remplir votre prénom et votre commentaire");
          return;
        }
        submitBtn.disabled = true;
        db.collection("comments")
          .add({ ficheId: ficheId, name: name, text: text, status: "pending", uid: uid, createdAt: new Date().toISOString() })
          .then(function () {
            nameEl.value = "";
            textEl.value = "";
            if (note) note.textContent = "Merci ! Votre commentaire sera visible après validation par la rédaction.";
            toast("Commentaire envoyé");
          })
          .catch(function () {
            toast("Le commentaire n'a pas pu être envoyé");
          })
          .then(function () {
            submitBtn.disabled = false;
          });
      });
    }
  });
})();
