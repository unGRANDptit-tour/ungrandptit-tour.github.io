/* ============================================================
   Gabarits de galerie — la "charte graphique" appliquée aux photos.

   Principe : chaque fiche fournit une liste ordonnée de photos
   (fiche.gallery). L'ORDRE dans lequel elles sont saisies (dans
   l'outil "Ajouter une fiche", ou à la main dans fiches.json) pilote
   directement leur emplacement dans le PDF : mets tes deux meilleures
   photos en premier pour le bandeau plein cadre, la suivante pour le
   grand format, etc. Rien n'est laissé au hasard, mais rien n'est non
   plus câblé en dur par lieu — le même moteur s'applique à n'importe
   quelle fiche, avec 2 photos comme avec 12.

   Les gabarits eux-mêmes (proportions, hauteurs) sont ceux validés
   dans le livret imprimé v9/v10 : bandeau_duo et bande_detail viennent
   de la page 4, grand_simple/grand_large/insert_petit de la page 2-3.
   trio_mosaique est nouveau : trois photos sur une même ligne, tailles
   inégales — pour retrouver l'effet "planche contact" des carnets
   Bouts du Monde / Éditions Elytis quand une fiche a beaucoup de
   matière photo.

   Ordre de priorité (le plus important d'abord) : si une fiche n'a
   pas assez de photos pour remplir tous les gabarits, on abandonne
   d'abord les moins prioritaires plutôt que de laisser un gabarit à
   moitié vide.
   ============================================================ */
"use strict";

// slots consommés par une fiche "pleine" (4 pages), dans l'ordre de
// priorité décroissante — le nombre = photos nécessaires pour ce slot.
var FULL_SLOTS = [
  { name: "bandeau_duo", need: 2 }, // page 4 — bandeau plein cadre, 2 photos
  { name: "grand_simple", need: 1 }, // page 2 — figure haute, format portrait
  { name: "grand_large", need: 1 }, // page 3 — figure large, format paysage
  { name: "insert_petit", need: 1 }, // page 2 — petite figure centrée
  { name: "bande_detail", need: 1 }, // page 4 — bande détail en pied de page
];

// slots pour une page "digest" condensée (utilisée dans les carnets
// d'itinéraire multi-jours : une page par étape, pas 4).
var DIGEST_SLOTS = [
  { name: "grand_simple", need: 1 },
  { name: "insert_petit", need: 1 },
];

/* Répartit les photos disponibles dans les slots donnés, par ordre de
   priorité. Renvoie { <slotName>: [photo, ...], trio: [[p,p,p], ...],
   leftover: [photo, ...] } — leftover = photos non utilisées dans ce
   gabarit (jamais perdues : juste pas montrées sur ce format-là). */
function assignGallery(photos, slots) {
  photos = (photos || []).slice();
  slots = slots || FULL_SLOTS;
  var out = {};
  var i = 0;
  slots.forEach(function (slot) {
    var chunk = photos.slice(i, i + slot.need);
    if (chunk.length === slot.need) {
      out[slot.name] = chunk;
      i += slot.need;
    }
    // sinon : pas assez de photos restantes pour ce slot, on l'abandonne
    // (priorité décroissante = les slots suivants, moins prioritaires,
    // sont abandonnés en premier naturellement par cet enchaînement).
  });

  // Photos encore disponibles au-delà des slots de base : on les
  // regroupe par trio pour une mosaïque supplémentaire (jusqu'à 3
  // trios = 9 photos de plus, au-delà elles restent en leftover).
  var trio = [];
  while (photos.length - i >= 3 && trio.length < 3) {
    trio.push(photos.slice(i, i + 3));
    i += 3;
  }
  out.trio = trio;
  out.leftover = photos.slice(i);
  return out;
}

module.exports = {
  FULL_SLOTS: FULL_SLOTS,
  DIGEST_SLOTS: DIGEST_SLOTS,
  assignGallery: assignGallery,
};
