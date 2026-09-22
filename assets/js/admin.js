/* Tableau de bord (/bord/) : statistiques, connexion rédaction,
   modération (commentaires / suggestions / newsletter) et bouton
   d'arrêt d'urgence. Les compteurs "publics" (votes) sont visibles
   par tout le monde ; les files de modération ne se chargent qu'une
   fois connecté avec un email présent dans UGPT_ADMIN_EMAILS — et
   sont de toute façon protégées côté serveur par firestore.rules. */
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  function tile(num, label) {
    return '<div class="stat-tile"><div class="num">' + esc(num) + '</div><div class="label">' + esc(label) + "</div></div>";
  }

  var dashGrid = document.getElementById("dashGrid");
  var gaText = document.getElementById("gaStatusText");
  var gate = document.getElementById("adminGate");
  var loginBtn = document.getElementById("adminLoginBtn");
  var logoutBtn = document.getElementById("adminLogoutBtn");
  var panel = document.getElementById("adminPanel");
  var modComments = document.getElementById("modComments");
  var modSuggestions = document.getElementById("modSuggestions");
  var modNewsletter = document.getElementById("modNewsletter");
  var modItineraries = document.getElementById("modItineraries");
  var stopBtn = document.getElementById("stopBtn");
  var stopLabel = document.getElementById("stopBtnLabel");

  var stats = window.__FICHE_STATS__ || { total: 0, verifie: 0, brouillon: 0 };
  var live = { votes: 0, pendingComments: "–", suggestions: "–", newsletter: "–", itineraries: "–" };

  // Lieux disponibles pour l'itinéraire (mêmes données que /itineraire/),
  // et config (rythmes, vitesse, etc.) — utilisées pour recalculer les
  // temps après chaque modification manuelle d'un itinéraire proposé.
  var itinFiches = window.__FICHES_FOR_ITINERARY__ || [];
  var itinFicheById = {};
  itinFiches.forEach(function (f) {
    itinFicheById[f.id] = f;
  });
  var itinCfg = window.__UGPT_ITINERARY_CFG__ || {};

  function paintDash() {
    if (!dashGrid) return;
    dashGrid.innerHTML =
      tile(stats.verifie || 0, "Fiches vérifiées") +
      tile(stats.brouillon || 0, "Fiches en brouillon") +
      tile(live.votes, "Votes « coup de cœur »") +
      tile(live.pendingComments, "Commentaires en attente") +
      tile(live.suggestions, "Propositions reçues") +
      tile(live.newsletter, "Abonnés newsletter") +
      tile(live.itineraries, "Itinéraires à relire");
  }
  paintDash();

  if (gaText) {
    var gaId = window.UGPT_GA_ID;
    gaText.textContent =
      gaId && gaId !== "G-XXXXXXX"
        ? "Google Analytics est actif (identifiant " + gaId + ")."
        : "Google Analytics n'est pas encore configuré — voir assets/js/analytics.js.";
  }

  (window.UGPT ? window.UGPT.ready : Promise.resolve(false)).then(function (ok) {
    if (!ok || !window.UGPT.db) {
      if (gate) {
        var p = gate.querySelector("p");
        if (p) p.textContent = "Connectez Firebase (voir assets/js/firebase-init.js) pour activer la modération et les statistiques en direct.";
      }
      if (loginBtn) loginBtn.disabled = true;
      return;
    }
    var db = window.UGPT.db;
    var auth = window.UGPT.auth;

    // Compteur public de votes — mêmes règles que votes.js.
    db.collection("votes").onSnapshot(
      function (snap) {
        live.votes = snap.size;
        paintDash();
      },
      function () {}
    );

    // Bannière/bouton d'arrêt d'urgence — lecture publique, écriture admin.
    db.doc("site/status").onSnapshot(
      function (snap) {
        var d = snap.exists ? snap.data() || {} : {};
        var paused = !!d.paused;
        if (stopBtn) {
          stopBtn.classList.toggle("active", paused);
          stopBtn.dataset.paused = paused ? "1" : "0";
        }
        if (stopLabel) stopLabel.textContent = paused ? "Désactiver l'arrêt d'urgence" : "Activer l'arrêt d'urgence";
      },
      function () {}
    );

    if (stopBtn) {
      stopBtn.addEventListener("click", function () {
        var paused = stopBtn.dataset.paused === "1";
        var next = !paused;
        var msg = next
          ? "Activer l'arrêt d'urgence ? Les votes, commentaires et le formulaire de proposition seront immédiatement suspendus pour tous les visiteurs."
          : "Réactiver le site pour tous les visiteurs ?";
        if (!window.confirm(msg)) return;
        db.doc("site/status")
          .set({ paused: next, reason: next ? "Arrêt d'urgence activé depuis le tableau de bord" : "" }, { merge: true })
          .catch(function () {
            window.alert("Le changement de statut n'a pas pu être enregistré.");
          });
      });
    }

    function isAdmin(user) {
      if (!user || !user.email) return false;
      var list = window.UGPT_ADMIN_EMAILS || [];
      return list.indexOf(user.email) !== -1;
    }

    if (loginBtn) {
      loginBtn.addEventListener("click", function () {
        if (!auth || typeof firebase === "undefined") return;
        var provider = new firebase.auth.GoogleAuthProvider();
        auth.signInWithPopup(provider).catch(function (err) {
          window.alert("Connexion impossible : " + (err && err.message ? err.message : "erreur inconnue"));
        });
      });
    }
    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        if (!auth) return;
        auth.signOut().then(function () {
          if (auth.signInAnonymously) auth.signInAnonymously().catch(function () {});
        });
      });
    }

    // Files de modération : ne démarrent qu'une fois admin identifié,
    // et sont coupées à la déconnexion.
    var unsubs = [];
    // Copie de travail éditable de chaque demande d'itinéraire, indexée
    // par id Firestore : { data, days, dirty }. `days` est la structure
    // manipulée par les boutons d'édition ; `dirty` évite qu'une mise à
    // jour temps réel écrase une édition en cours avant enregistrement.
    var itinState = {};
    function stopModListeners() {
      unsubs.forEach(function (u) {
        try {
          u();
        } catch (e) {}
      });
      unsubs = [];
      live.pendingComments = "–";
      live.suggestions = "–";
      live.newsletter = "–";
      live.itineraries = "–";
      paintDash();
      if (modComments) modComments.innerHTML = "";
      if (modSuggestions) modSuggestions.innerHTML = "";
      if (modNewsletter) modNewsletter.innerHTML = "";
      if (modItineraries) modItineraries.innerHTML = "";
      itinState = {};
    }

    function startModListeners() {
      unsubs.push(
        db.collection("itinerary_requests").onSnapshot(
          function (snap) {
            var pending = 0;
            var rows = [];
            snap.forEach(function (doc) {
              var d = doc.data();
              if (d.status === "brouillon_auto") pending++;
              rows.push({ id: doc.id, data: d });
            });
            rows.sort(function (a, b) {
              return new Date(b.data.createdAt) - new Date(a.data.createdAt);
            });
            live.itineraries = pending;
            paintDash();
            renderModItineraries(rows);
          },
          function () {}
        )
      );

      unsubs.push(
        db.collection("comments").onSnapshot(
          function (snap) {
            var pending = 0;
            var rows = [];
            snap.forEach(function (doc) {
              var d = doc.data();
              if (d.status === "pending") {
                pending++;
                rows.push({ id: doc.id, data: d });
              }
            });
            rows.sort(function (a, b) {
              return new Date(b.data.createdAt) - new Date(a.data.createdAt);
            });
            live.pendingComments = pending;
            paintDash();
            renderModComments(rows);
          },
          function () {}
        )
      );

      unsubs.push(
        db.collection("suggestions").onSnapshot(
          function (snap) {
            live.suggestions = snap.size;
            paintDash();
            var rows = [];
            snap.forEach(function (doc) {
              rows.push({ id: doc.id, data: doc.data() });
            });
            rows.sort(function (a, b) {
              return new Date(b.data.createdAt) - new Date(a.data.createdAt);
            });
            renderModSuggestions(rows);
          },
          function () {}
        )
      );

      unsubs.push(
        db.collection("newsletter").onSnapshot(
          function (snap) {
            live.newsletter = snap.size;
            paintDash();
            var rows = [];
            snap.forEach(function (doc) {
              rows.push({ id: doc.id, data: doc.data() });
            });
            rows.sort(function (a, b) {
              return new Date(b.data.createdAt) - new Date(a.data.createdAt);
            });
            renderModNewsletter(rows);
          },
          function () {}
        )
      );
    }

    function renderModComments(rows) {
      if (!modComments) return;
      if (!rows.length) {
        modComments.innerHTML = '<p class="muted-note">Aucun commentaire en attente.</p>';
        return;
      }
      modComments.innerHTML = rows
        .map(function (r) {
          return (
            '<div class="mod-item"><div><b>' +
            esc(r.data.name || "Anonyme") +
            "</b> — " +
            esc(r.data.text) +
            '<div class="muted-note">' +
            esc(r.data.ficheId) +
            " · " +
            esc(timeAgo(r.data.createdAt)) +
            '</div></div><div class="mod-actions">' +
            '<button class="approve" data-action="approve-comment" data-id="' +
            esc(r.id) +
            '" title="Publier" type="button"><svg viewBox="0 0 24 24"><path d="M4 12.5 9 17l11-11"/></svg></button>' +
            '<button class="reject" data-action="reject-comment" data-id="' +
            esc(r.id) +
            '" title="Supprimer" type="button"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>' +
            "</div></div>"
          );
        })
        .join("");
    }

    function renderModSuggestions(rows) {
      if (!modSuggestions) return;
      if (!rows.length) {
        modSuggestions.innerHTML = '<p class="muted-note">Aucune proposition reçue pour l’instant.</p>';
        return;
      }
      modSuggestions.innerHTML = rows
        .map(function (r) {
          var d = r.data;
          var done = d.status === "traitee";
          return (
            '<div class="mod-item"><div><b>' +
            esc(d.name) +
            "</b> (" +
            esc(d.theme || "?") +
            (d.region ? " · " + esc(d.region) : "") +
            ')<div class="muted-note">' +
            esc(d.desc) +
            "</div>" +
            (d.link ? '<div class="muted-note"><a href="' + esc(d.link) + '" target="_blank" rel="noopener">' + esc(d.link) + "</a></div>" : "") +
            (d.contact ? '<div class="muted-note">Contact : ' + esc(d.contact) + "</div>" : "") +
            '<div class="muted-note">' +
            esc(timeAgo(d.createdAt)) +
            (done ? " · traitée" : "") +
            "</div></div>" +
            '<div class="mod-actions">' +
            (done
              ? ""
              : '<button class="approve" data-action="done-suggestion" data-id="' +
                esc(r.id) +
                '" title="Marquer traitée" type="button"><svg viewBox="0 0 24 24"><path d="M4 12.5 9 17l11-11"/></svg></button>') +
            '<button class="reject" data-action="delete-suggestion" data-id="' +
            esc(r.id) +
            '" title="Supprimer" type="button"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>' +
            "</div></div>"
          );
        })
        .join("");
    }

    function renderModNewsletter(rows) {
      if (!modNewsletter) return;
      if (!rows.length) {
        modNewsletter.innerHTML = '<p class="muted-note">Aucun abonné pour l’instant.</p>';
        return;
      }
      modNewsletter.innerHTML = rows
        .map(function (r) {
          return (
            '<div class="mod-item"><div>' +
            esc(r.data.email) +
            '<div class="muted-note">' +
            esc(timeAgo(r.data.createdAt)) +
            "</div></div>" +
            '<div class="mod-actions"><button class="reject" data-action="delete-newsletter" data-id="' +
            esc(r.id) +
            '" title="Désinscrire" type="button"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div></div>'
          );
        })
        .join("");
    }

    /* -------- demandes d'itinéraire : liste + édition -------- */
    var PACE_LABEL = itinCfg.paceLabels || {};

    function fmtMin(min) {
      return window.UGPT_ITINERARY_ENGINE ? window.UGPT_ITINERARY_ENGINE.formatDuration(min) : Math.round(min) + " min";
    }

    // Retire les jours vides et renumérote — un itinéraire ne doit jamais
    // afficher un jour sans arrêt, même après une suppression manuelle.
    function normalizeDays(days) {
      var out = [];
      (days || []).forEach(function (day) {
        if (day.stops && day.stops.length) out.push({ stops: day.stops });
      });
      return out;
    }

    function recalc(id) {
      var st = itinState[id];
      if (!st) return;
      st.days = window.UGPT_ITINERARY_ENGINE.recomputeTimes(normalizeDays(st.days), itinFicheById, itinCfg);
      st.dirty = true;
    }

    function usedFicheIds(days) {
      var used = {};
      (days || []).forEach(function (day) {
        day.stops.forEach(function (s) {
          used[s.ficheId] = true;
        });
      });
      return used;
    }

    function ctrlBtn(action, id, dayIdx, stopIdx, title, pathD, disabled) {
      return (
        '<button class="itin-ctrl-btn" data-action="' +
        action +
        '" data-id="' +
        esc(id) +
        '" data-day="' +
        dayIdx +
        '" data-stop="' +
        stopIdx +
        '" title="' +
        esc(title) +
        '" type="button"' +
        (disabled ? ' disabled style="opacity:.35;"' : "") +
        '><svg viewBox="0 0 24 24" stroke-width="2"><path d="' +
        pathD +
        '"/></svg></button>'
      );
    }

    function itinItemHtml(id) {
      var st = itinState[id];
      if (!st) return "";
      var d = st.data;
      var p = d.params || {};
      var statusLabel = { brouillon_auto: "à relire", validee: "validé", rejetee: "rejeté" }[d.status] || d.status;
      var statusClass = { brouillon_auto: "brouillon", validee: "validee", rejetee: "rejetee" }[d.status] || "brouillon";
      var summary =
        (p.days || "?") +
        " jour(s) demandé(s) · rythme " +
        esc(PACE_LABEL[p.pace] || p.pace || "?") +
        (p.themes && p.themes.length ? " · thèmes : " + p.themes.map(esc).join(", ") : "") +
        (p.regions && p.regions.length ? " · régions : " + p.regions.map(esc).join(", ") : "");

      var used = usedFicheIds(st.days);
      var available = itinFiches.filter(function (f) {
        return !used[f.id];
      });

      var daysHtml = st.days
        .map(function (day, dayIdx) {
          var stopsHtml = day.stops
            .map(function (stop, stopIdx) {
              var f = itinFicheById[stop.ficheId];
              var title = f ? f.title : stop.ficheId;
              return (
                '<div class="itin-edit-stop"><div class="grow"><b>' +
                esc(title) +
                '</b><br><span class="muted-note">visite ~' +
                fmtMin(stop.visitMin) +
                (stopIdx === 0 ? "" : " · +" + fmtMin(stop.travelMinFromPrev) + " de route") +
                '</span></div><div class="itin-edit-ctrls">' +
                ctrlBtn("itin-up", id, dayIdx, stopIdx, "Monter", "M6 15 12 9l6 6") +
                ctrlBtn("itin-down", id, dayIdx, stopIdx, "Descendre", "M6 9l6 6 6-6") +
                ctrlBtn("itin-prevday", id, dayIdx, stopIdx, "Jour précédent", "M11 5 5 12l6 7M19 5l-6 7 6 7", dayIdx === 0) +
                ctrlBtn("itin-nextday", id, dayIdx, stopIdx, "Jour suivant", "M13 5l6 7-6 7M5 5l6 7-6 7") +
                ctrlBtn("itin-remove", id, dayIdx, stopIdx, "Retirer", "M6 6l12 12M18 6 6 18") +
                "</div></div>"
              );
            })
            .join("");
          return (
            '<div class="itin-day" style="margin:0 0 8px;"><div class="itin-day-head"><span>Jour ' +
            (dayIdx + 1) +
            '</span><span class="muted">' +
            day.stops.length +
            (day.stops.length > 1 ? " lieux" : " lieu") +
            " · " +
            fmtMin(day.totalVisitMin) +
            " de visite · " +
            fmtMin(day.totalTravelMin) +
            " de route</span></div>" +
            stopsHtml +
            "</div>"
          );
        })
        .join("");

      var addPicker = available.length
        ? '<select class="itin-add-picker" data-id="' +
          esc(id) +
          '" style="width:100%;margin-top:6px;border:1px solid var(--line);border-radius:9px;background:var(--paper-raised);padding:8px 10px;font:inherit;font-size:12.5px;color:var(--ink);">' +
          '<option value="">+ Ajouter un lieu à un nouveau jour…</option>' +
          available
            .map(function (f) {
              return '<option value="' + esc(f.id) + '">' + esc(f.title) + "</option>";
            })
            .join("") +
          "</select>"
        : '<p class="muted-note" style="margin-top:6px;">Tous les lieux vérifiés disponibles sont déjà inclus.</p>';

      return (
        '<div class="itin-admin-item" data-request-id="' +
        esc(id) +
        '">' +
        '<div class="itin-admin-head">' +
        "<b>" +
        (d.email ? esc(d.email) : "Visiteur anonyme") +
        ' <span class="itin-status-pill ' +
        statusClass +
        '" style="margin-left:6px;">' +
        esc(statusLabel) +
        "</span>" +
        "</b>" +
        esc(summary) +
        '<div class="muted-note" style="margin-top:2px;">' +
        esc(timeAgo(d.createdAt)) +
        (st.dirty ? " · modifications non enregistrées" : "") +
        "</div>" +
        "</div>" + // fin .itin-admin-head
        (d.placeRequest
          ? '<div class="draft-note" style="margin:10px 12px 0;">Ajouté par le client, pas par la rédaction — non vérifié, sans avis de notre part : ' +
            esc(d.placeRequest) +
            "</div>"
          : "") +
        '<div style="padding:10px 12px;">' +
        (daysHtml || '<p class="muted-note">Itinéraire vide.</p>') +
        addPicker +
        "</div>" +
        '<div class="itin-admin-actions">' +
        '<button class="btn-secondary" data-action="itin-save" data-id="' +
        esc(id) +
        '" type="button">Enregistrer</button>' +
        '<button class="btn-primary" data-action="itin-validate" data-id="' +
        esc(id) +
        '" type="button">Valider</button>' +
        '<button class="btn-secondary" data-action="itin-reject" data-id="' +
        esc(id) +
        '" type="button">Rejeter</button>' +
        "</div>" +
        "</div>" // fin .itin-admin-item
      );
    }

    function renderOneItin(id) {
      if (!modItineraries) return;
      var el = modItineraries.querySelector('[data-request-id="' + id + '"]');
      if (!el) return;
      var wrap = document.createElement("div");
      wrap.innerHTML = itinItemHtml(id);
      if (wrap.firstChild) el.replaceWith(wrap.firstChild);
    }

    function renderModItineraries(rows) {
      if (!modItineraries) return;
      if (!rows.length) {
        modItineraries.innerHTML = '<p class="muted-note">Aucune demande d’itinéraire pour l’instant.</p>';
        itinState = {};
        return;
      }
      rows.forEach(function (r) {
        if (!itinState[r.id] || !itinState[r.id].dirty) {
          itinState[r.id] = { data: r.data, days: (r.data.plan && r.data.plan.days) || [], dirty: false };
        } else {
          itinState[r.id].data = r.data; // édition en cours : on garde les jours locaux, on rafraîchit juste les métadonnées
        }
      });
      Object.keys(itinState).forEach(function (id) {
        if (!rows.some(function (r) { return r.id === id; })) delete itinState[id];
      });
      modItineraries.innerHTML = rows
        .map(function (r) {
          return itinItemHtml(r.id);
        })
        .join("");
    }

    function onItinChange(e) {
      var sel = e.target.closest ? e.target.closest(".itin-add-picker") : null;
      if (!sel) return;
      var id = sel.getAttribute("data-id");
      var ficheId = sel.value;
      if (!id || !ficheId) return;
      var st = itinState[id];
      if (!st) return;
      st.days = st.days.concat([{ stops: [{ ficheId: ficheId }] }]);
      recalc(id);
      renderOneItin(id);
    }

    function persistItin(id, action) {
      var st = itinState[id];
      if (!st) return;
      var recomputed = window.UGPT_ITINERARY_ENGINE.recomputeTimes(normalizeDays(st.days), itinFicheById, itinCfg);
      var payload = {
        plan: {
          ok: recomputed.length > 0,
          requestedDays: (st.data.plan && st.data.plan.requestedDays) || recomputed.length,
          actualDays: recomputed.length,
          pace: (st.data.plan && st.data.plan.pace) || (st.data.params && st.data.params.pace) || "standard",
          days: recomputed,
          unusedFicheIds: [],
          tooLongFicheIds: [],
          generatedAt: (st.data.plan && st.data.plan.generatedAt) || new Date().toISOString(),
        },
      };
      if (action === "itin-validate") payload.status = "validee";
      db.doc("itinerary_requests/" + id)
        .set(payload, { merge: true })
        .then(function () {
          st.dirty = false;
          st.days = recomputed;
          renderOneItin(id);
        })
        .catch(function () {
          window.alert("Impossible d'enregistrer les modifications.");
        });
    }

    function onItinClick(e) {
      var btn = e.target.closest ? e.target.closest("button[data-action]") : null;
      if (!btn) return;
      var action = btn.getAttribute("data-action");
      var id = btn.getAttribute("data-id");
      if (!action || !id) return;

      if (action === "itin-save" || action === "itin-validate") {
        persistItin(id, action);
        return;
      }
      if (action === "itin-reject") {
        if (!window.confirm("Rejeter cette demande d'itinéraire ? Elle ne sera pas confirmée à la personne.")) return;
        db.doc("itinerary_requests/" + id)
          .set({ status: "rejetee" }, { merge: true })
          .catch(function () {
            window.alert("Impossible de mettre à jour le statut.");
          });
        return;
      }

      var st = itinState[id];
      var dayIdx = parseInt(btn.getAttribute("data-day"), 10);
      var stopIdx = parseInt(btn.getAttribute("data-stop"), 10);
      if (!st || isNaN(dayIdx) || isNaN(stopIdx)) return;
      var day = st.days[dayIdx];
      if (!day) return;

      if (action === "itin-remove") {
        day.stops.splice(stopIdx, 1);
      } else if (action === "itin-up") {
        if (stopIdx > 0) {
          var t1 = day.stops[stopIdx - 1];
          day.stops[stopIdx - 1] = day.stops[stopIdx];
          day.stops[stopIdx] = t1;
        }
      } else if (action === "itin-down") {
        if (stopIdx < day.stops.length - 1) {
          var t2 = day.stops[stopIdx + 1];
          day.stops[stopIdx + 1] = day.stops[stopIdx];
          day.stops[stopIdx] = t2;
        }
      } else if (action === "itin-prevday" && dayIdx > 0) {
        var moved = day.stops.splice(stopIdx, 1)[0];
        st.days[dayIdx - 1].stops.push(moved);
      } else if (action === "itin-nextday") {
        var moved2 = day.stops.splice(stopIdx, 1)[0];
        var maxDays = itinCfg.maxDaysRequestable || 14;
        if (dayIdx + 1 >= st.days.length) {
          if (st.days.length >= maxDays) {
            day.stops.splice(stopIdx, 0, moved2); // plafond atteint : on annule le déplacement
            window.alert("Nombre maximum de jours atteint.");
          } else {
            st.days.push({ stops: [moved2] });
          }
        } else {
          st.days[dayIdx + 1].stops.push(moved2);
        }
      } else {
        return;
      }

      recalc(id);
      renderOneItin(id);
    }

    if (modItineraries) {
      modItineraries.addEventListener("click", onItinClick);
      modItineraries.addEventListener("change", onItinChange);
    }

    function onModClick(e) {
      var btn = e.target.closest ? e.target.closest("button[data-action]") : null;
      if (!btn) return;
      var action = btn.getAttribute("data-action");
      var id = btn.getAttribute("data-id");
      if (!action || !id) return;
      if (action === "approve-comment") db.doc("comments/" + id).set({ status: "approved" }, { merge: true });
      else if (action === "reject-comment") db.doc("comments/" + id).delete();
      else if (action === "done-suggestion") db.doc("suggestions/" + id).set({ status: "traitee" }, { merge: true });
      else if (action === "delete-suggestion") db.doc("suggestions/" + id).delete();
      else if (action === "delete-newsletter") db.doc("newsletter/" + id).delete();
    }
    if (modComments) modComments.addEventListener("click", onModClick);
    if (modSuggestions) modSuggestions.addEventListener("click", onModClick);
    if (modNewsletter) modNewsletter.addEventListener("click", onModClick);

    if (auth) {
      auth.onAuthStateChanged(function (user) {
        var admin = isAdmin(user);
        if (panel) panel.hidden = !admin;
        if (loginBtn) loginBtn.hidden = admin;
        if (logoutBtn) logoutBtn.hidden = !admin;
        if (admin) startModListeners();
        else stopModListeners();
      });
    }
  });
})();
