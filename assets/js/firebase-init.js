/* ============================================================
   Firebase configuration.
   REMPLACE les valeurs ci-dessous par celles de TON projet Firebase :
   Console Firebase -> Paramètres du projet -> Vos applications -> Config.
   Tant que ce n'est pas fait, le site fonctionne quand même : votes,
   commentaires, suggestions et newsletter restent visibles localement
   dans le navigateur (non partagés), sans jamais faire planter la page.
   ============================================================ */
window.UGPT_FIREBASE_CONFIG = {
  apiKey: "REMPLACE_MOI",
  authDomain: "REMPLACE_MOI.firebaseapp.com",
  projectId: "REMPLACE_MOI",
  storageBucket: "REMPLACE_MOI.appspot.com",
  messagingSenderId: "REMPLACE_MOI",
  appId: "REMPLACE_MOI",
};

/* Email(s) autorisé(s) à voir le panneau de modération sur /bord/.
   Remplace par ta propre adresse une fois la connexion Firebase Auth configurée. */
window.UGPT_ADMIN_EMAILS = ["REMPLACE_MOI@exemple.fr"];

(function () {
  "use strict";
  var configured = window.UGPT_FIREBASE_CONFIG.apiKey !== "REMPLACE_MOI";
  window.UGPT = { db: null, auth: null, ready: null, configured: configured };

  if (!configured || typeof firebase === "undefined") {
    // Pas encore branché (ou SDK non chargé) : le reste du site tourne en mode local uniquement.
    window.UGPT.ready = Promise.resolve(false);
    return;
  }

  try {
    firebase.initializeApp(window.UGPT_FIREBASE_CONFIG);
    window.UGPT.db = firebase.firestore();
    window.UGPT.auth = firebase.auth();
    window.UGPT.ready = window.UGPT.auth
      .signInAnonymously()
      .then(function () {
        return true;
      })
      .catch(function (err) {
        console.error("Firebase anonymous sign-in failed", err);
        return false;
      });
  } catch (err) {
    console.error("Firebase init failed", err);
    window.UGPT.ready = Promise.resolve(false);
  }
})();
