/* Live "coup de cœur" vote counts (list/grid pages) and the vote
   button itself (fiche detail page). Uses one Firestore doc per
   (fiche, visitor) at votes/{ficheId}_{uid} so a visitor's vote is
   idempotent and easy to toggle off. Falls back to a local-only
   toast when Firebase isn't configured yet, so nothing ever breaks. */
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

  function paintCounts(counts) {
    document.querySelectorAll("[data-vote-count]").forEach(function (el) {
      var id = el.getAttribute("data-vote-count");
      var n = counts[id] || 0;
      var numEl = el.querySelector(".vote-num");
      if (numEl) numEl.textContent = n;
    });
    var voteCountEl = document.getElementById("voteCount");
    if (voteCountEl && window.__CURRENT_FICHE__) {
      var n = counts[window.__CURRENT_FICHE__] || 0;
      voteCountEl.textContent = n + (n === 1 ? " vote" : " votes");
    }
  }

  function paintVoted(voted) {
    var btn = document.getElementById("voteBtn");
    var label = document.getElementById("voteBtnLabel");
    if (!btn) return;
    btn.classList.toggle("voted", voted);
    if (label) label.textContent = voted ? "Vous y êtes allé(e) de votre cœur" : "Coup de cœur";
  }

  (window.UGPT ? window.UGPT.ready : Promise.resolve(false)).then(function (ok) {
    if (!ok || !window.UGPT.db) return;
    var uid = window.UGPT.auth && window.UGPT.auth.currentUser ? window.UGPT.auth.currentUser.uid : null;
    var myVotes = {};

    var btn = document.getElementById("voteBtn");
    if (btn && window.__CURRENT_FICHE__) {
      btn.addEventListener("click", function () {
        if (window.UGPT_PAUSED || !uid) {
          toast(uid ? "Les votes sont suspendus pour l'instant" : "Vote non connecté — branchez Firebase pour l'activer");
          return;
        }
        var ficheId = window.__CURRENT_FICHE__;
        var ref = window.UGPT.db.doc("votes/" + ficheId + "_" + uid);
        var already = !!myVotes[ficheId];
        var action = already
          ? ref.delete()
          : ref.set({ ficheId: ficheId, uid: uid, createdAt: new Date().toISOString() });
        action.catch(function () {
          toast("Le vote n'a pas pu être enregistré");
        });
      });
    }

    window.UGPT.db.collection("votes").onSnapshot(
      function (snap) {
        var counts = {};
        var mine = {};
        snap.forEach(function (doc) {
          var d = doc.data();
          counts[d.ficheId] = (counts[d.ficheId] || 0) + 1;
          if (uid && d.uid === uid) mine[d.ficheId] = true;
        });
        myVotes = mine;
        paintCounts(counts);
        if (window.__CURRENT_FICHE__) paintVoted(!!mine[window.__CURRENT_FICHE__]);
      },
      function () {}
    );
  });
})();
