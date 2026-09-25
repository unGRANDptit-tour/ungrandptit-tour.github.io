#!/usr/bin/env node
/* ============================================================
   Un Grand P'tit Tour — static site build script
   No dependencies (pure Node.js). Reads src/data/*.json,
   renders every page with plain template-literal functions,
   and writes the finished, ready-to-deploy site into dist/.
   Run with:  node src/build.js
   ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const SITE_ROOT = path.join(ROOT, "..");
const DIST = path.join(SITE_ROOT, "dist");

const gabarits = require("./print/gabarits");
const engine = require("./assets/js/itinerary-engine.js");

const site = JSON.parse(fs.readFileSync(path.join(ROOT, "data/site.json"), "utf8"));
const fiches = JSON.parse(fs.readFileSync(path.join(ROOT, "data/fiches.json"), "utf8"));
const DEPARTEMENTS = JSON.parse(fs.readFileSync(path.join(ROOT, "data/departements.json"), "utf8"));
const fichesById = {};
fiches.forEach((f) => (fichesById[f.id] = f));

/* ---------------- helpers ---------------- */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
// Réglage de cadrage par photo (même échelle que l'export PDF, voir
// src/print/fiche-template.js) : "haut" | "centre" | "bas". Sans ce champ
// sur la photo, on ne force rien en dur — le CSS existant garde la main
// (pas de changement visuel pour les fiches qui n'ont jamais réglé ça).
// Un réglage live (photoFocus/{ficheId} dans Firestore, modifiable depuis
// /bord/) peut ensuite surcharger cette valeur par défaut au chargement
// de la page — voir assets/js/photo-focus.js.
const FOCUS_Y = { haut: 15, centre: 50, bas: 80 };
function focusAttrs(photo) {
  const base = path.basename(String((photo && photo.src) || ""));
  const style = photo && FOCUS_Y.hasOwnProperty(photo.focus) ? ` style="object-position:center ${FOCUS_Y[photo.focus]}%"` : "";
  return { dataAttr: base ? ` data-photo="${esc(base)}"` : "", style };
}
function writeFile(relPath, content) {
  const full = path.join(DIST, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

const THEME_ICONS = site.themeIcons;
const THEMES = site.themes;
const REGIONS = site.regions;
const COUNTRIES = site.countries || {};
// Le site ne montre le filtre "Pays" que lorsqu'un deuxième pays existe vraiment
// dans les données (voir countryChipsHtml) — prêt pour l'Europe sans rien afficher
// tant qu'il n'y a que la France.
const MULTI_COUNTRY = Object.keys(COUNTRIES).length > 1;

function regionLabel(regionKey) {
  const r = REGIONS[regionKey];
  return r ? r.label : regionKey;
}
function countryOfRegion(regionKey) {
  const r = REGIONS[regionKey];
  return (r && r.country) || "france";
}

function themeTag(themeKey) {
  const t = THEMES[themeKey];
  if (!t) return "";
  return `<span class="tag theme-${themeKey}">${esc(t.label)}</span>`;
}
function regionTag(regionKey) {
  return `<span class="tag region">${esc(regionLabel(regionKey))}</span>`;
}

function glyphSvg(themeKey) {
  const paths = THEME_ICONS[themeKey] || THEME_ICONS.patrimoine;
  const varName = (THEMES[themeKey] || {}).varName || "forest";
  return `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" style="stroke:var(--${varName})">${paths}</svg>`;
}
// Statut d'une fiche, dans la langue de la charte « Signature ». Trois états :
// « verifie » (bleu, entre dans les itinéraires), « reserve » (sarcelle, entre
// aussi dans les itinéraires mais garde une réserve visible sur des détails
// pratiques), et tout le reste = brouillon (ambre, écarté des itinéraires).
function statusInfo(status) {
  if (status === "verifie") {
    return {
      key: "verifie",
      itineraryReady: true,
      badgeClass: "verified",
      heroClass: "ok",
      label: "Vérifié sur place",
      labelFull: "Vérifié sur place par la rédaction",
    };
  }
  if (status === "reserve") {
    return {
      key: "reserve",
      itineraryReady: true,
      badgeClass: "reserve",
      heroClass: "reserve",
      label: "Vérifié — détails à confirmer",
      labelFull: "Vérifié sur place — quelques détails à confirmer",
    };
  }
  return {
    key: "brouillon",
    itineraryReady: false,
    badgeClass: "draft",
    heroClass: "draft",
    label: "En cours de vérification",
    labelFull: "En cours de vérification",
  };
}
function isItineraryReady(f) {
  return statusInfo(f.status).itineraryReady;
}
function statusBadge(status, size) {
  const info = statusInfo(status);
  return `<span class="badge ${info.badgeClass}"><i></i>${size === "full" ? info.labelFull : info.label}</span>`;
}

function ficheUrl(f) {
  return `/fiches/${f.id}/`;
}
function absUrl(p) {
  return site.siteUrl.replace(/\/$/, "") + p;
}

/* ---------------- shared partials ---------------- */
function headHtml({ title, description, path: pagePath, ogImage, extraStyles, noIndex }) {
  const fullTitle = title ? `${title} — ${site.siteName}` : `${site.siteName} — ${site.siteTagline}`;
  const desc = description || site.siteTagline;
  const image = ogImage ? absUrl(ogImage) : absUrl(site.logoPath);
  const canonical = absUrl(pagePath);
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc)}">
${noIndex ? '<meta name="robots" content="noindex">\n' : ""}<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(site.siteName)}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(fullTitle)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
<link rel="icon" href="${esc(site.logoPath)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,340;1,9..144,400;1,9..144,500&family=Libre+Franklin:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,400&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/style.css">
${(extraStyles || []).map((s) => `<link rel="stylesheet" href="${s}">`).join("\n")}
${themeInlineScript()}
</head>`;
}

const THEME_TOGGLE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.6"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.4M12 19.1v2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7"/></svg>';

// Bandeau d'arrêt d'urgence (piloté par status-gate.js) — présent sur toutes les pages.
function statusBannerHtml() {
  return `<div class="status-banner" id="statusBanner" hidden>
    <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><path d="M12 9v4M12 16.5h.01M10.3 3.9 2.7 17.3a1.8 1.8 0 0 0 1.56 2.7h15.5a1.8 1.8 0 0 0 1.56-2.7L13.7 3.9a1.8 1.8 0 0 0-3.4 0Z"/></svg>
    <span id="statusBannerText">Les votes, commentaires et suggestions sont temporairement suspendus.</span>
  </div>`;
}

// Barre du haut « Signature » (pages sans grande photo) : masthead en capitales.
// Le menu bureau (navLinksHtml) ne s'affiche qu'à partir de 900px — en dessous,
// la tabbar du bas reste la seule navigation, comme avant.
function topbarHtml(active) {
  return `<header class="topbar">
    <a class="brand-row" href="/">
      <img class="brand-logo" src="${esc(site.logoPath)}" alt="">
      <span class="masthead">${esc(site.siteName)}</span>
    </a>
    ${navLinksHtml(active, false)}
    <div class="topbar-actions">
      <a class="topbar-cta" href="/itineraire/">Composer</a>
      <button class="icon-btn" id="themeToggleBtn" title="Apparence" aria-label="Changer l'apparence" type="button">${THEME_TOGGLE_SVG}</button>
    </div>
  </header>
  ${statusBannerHtml()}`;
}

// Navigation posée sur la photo (accueil et fiches). Même menu bureau que
// topbarHtml, en version blanche/ombrée pour rester lisible sur la photo.
function heroNavHtml({ back, topper, active }) {
  const backLink = back
    ? `<a class="hero-back" href="/" aria-label="Retour à l'accueil"><svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg></a>`
    : "";
  return `<div class="hero-topper">${topper}</div>
    <div class="hero-nav">
      <a class="hero-brand" href="/">${backLink}<img class="brand-logo" src="${esc(site.logoPath)}" alt=""><span class="masthead">${esc(site.siteName)}</span></a>
      ${navLinksHtml(active || null, true)}
      <div class="hero-nav-actions">
        <a class="hero-cta" href="/itineraire/">Composer</a>
        <button class="icon-btn on-photo" id="themeToggleBtn" title="Apparence" aria-label="Changer l'apparence" type="button">${THEME_TOGGLE_SVG}</button>
      </div>
    </div>`;
}

// Partagé entre la barre d'onglets mobile (tabbar, en bas) et le menu bureau
// (topbar-nav / hero-nav-links, en haut, ≥900px — voir navLinksHtml ci-dessous).
const NAV_ITEMS = [
  ["/", "home", "Accueil", '<path d="M4 10.5 12 4l8 6.5V20H4z"/><path d="M10 20v-5h4v5"/>'],
  ["/carte/", "carte", "Carte", '<path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2Z"/><path d="M9 4v14M15 6v14"/>'],
  ["/classement/", "classement", "Classement", '<path d="M8 20V10M13 20V4M18 20v-7"/><path d="M4 20h16"/>'],
  ["/contribuer/", "contribuer", "Contribuer", '<path d="M4 20.5 4.9 17 16 5.9a1.7 1.7 0 0 1 2.4 0l.7.7a1.7 1.7 0 0 1 0 2.4L8 20l-4 .5Z"/>'],
  ["/bord/", "bord", "Bord", '<circle cx="12" cy="12" r="8.5"/><path d="M12 12 15.5 8.5M12 7v1.2M17 12h-1.2M12 17v-1.2M7 12h1.2"/>'],
];

function tabbarHtml(active) {
  return `<nav class="tabbar" aria-label="Navigation">
    ${NAV_ITEMS.map(
      ([href, key, label, svg]) =>
        `<a class="tab-btn${active === key ? " active" : ""}" href="${href}"${active === key ? ' aria-current="page"' : ""}>
        <svg viewBox="0 0 24 24" fill="none">${svg}</svg>
        <span>${label}</span>
      </a>`
    ).join("\n    ")}
  </nav>`;
}

// Menu bureau (≥900px) : mêmes 5 destinations que la tabbar mobile, mais en
// liens texte dans le bandeau du haut — la tabbar du bas se masque à cette
// largeur (voir style.css) puisque la navigation passe alors par ici.
// onPhoto=true pour le rendu blanc/ombré utilisé sur une photo plein cadre
// (accueil, fiche) plutôt que le rendu sombre standard (topbar blanche).
function navLinksHtml(active, onPhoto) {
  return `<nav class="${onPhoto ? "hero-nav-links" : "topbar-nav"}" aria-label="Navigation">
    ${NAV_ITEMS.map(
      ([href, key, label]) =>
        `<a href="${href}"${active === key ? ' class="active" aria-current="page"' : ""}>${esc(label)}</a>`
    ).join("\n    ")}
  </nav>`;
}

// Pied de page sombre en colonnes (charte « Signature »).
function footerHtml() {
  const year = new Date().getFullYear();
  return `<footer class="site-footer">
    <div class="foot-brand">${esc(site.siteName)}</div>
    <p class="foot-tag">Lieux insolites et patrimoine français, vérifiés sur place par la rédaction.</p>
    <div class="foot-cols">
      <div class="foot-col"><h5>Explorer</h5><a href="/carte/">Carte</a><a href="/classement/">Classement</a><a href="/itineraire/">Itinéraire</a></div>
      <div class="foot-col"><h5>Suivre</h5><a href="${esc(site.instagramUrl)}" target="_blank" rel="noopener">Instagram</a>${
        site.facebookUrl ? `<a href="${esc(site.facebookUrl)}" target="_blank" rel="noopener">Facebook</a>` : ""
      }<a href="/contribuer/">Proposer un lieu</a></div>
      <div class="foot-col"><h5>Légal</h5><a href="/mentions-legales/">Mentions légales</a><a href="/confidentialite/">Confidentialité</a><a href="/cookies/">Cookies</a></div>
    </div>
    <div class="foot-bottom"><span>© ${year} ${esc(site.siteName)} — photos ${esc(site.instagramHandle)}</span><span class="mono">Le guide</span></div>
  </footer>`;
}

function cookieBannerHtml() {
  return `<div class="cookie-banner" id="cookieBanner" hidden>
    <div class="cookie-banner-inner">
      <p>Ce site utilise des cookies de mesure d'audience (Google Analytics) pour comprendre comment le guide est lu. Vous pouvez accepter ou refuser — voir notre <a href="/cookies/">politique cookies</a>.</p>
      <div class="cookie-actions">
        <button class="btn-primary" id="cookieAccept" type="button">Accepter</button>
        <button class="btn-secondary" id="cookieRefuse" type="button">Refuser</button>
      </div>
    </div>
  </div>`;
}

function newsletterHtml() {
  return `<div class="newsletter-block">
    <span class="label">La lettre du guide</span>
    <h2>Ne ratez aucun nouveau lieu</h2>
    <p>Un email quand une nouvelle fiche est publiée. Pas de spam, désinscription en un clic.</p>
    <form class="newsletter-form" id="newsletterForm">
      <input type="email" id="newsletterEmail" placeholder="votre@email.fr" required autocomplete="email" aria-label="Votre email">
      <button class="btn-primary" type="submit">S'inscrire</button>
    </form>
    <p class="newsletter-note" id="newsletterNote"></p>
  </div>`;
}

function toastHtml() {
  return `<div class="toast" id="toast"></div>`;
}

function themeInlineScript() {
  // Runs synchronously before paint so the saved theme applies with no flash.
  return `<script>(function(){try{var t=localStorage.getItem('ugpt-theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();</script>`;
}

function scriptsHtml(extra) {
  const firebaseSdk = [
    "https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js",
    "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore-compat.js",
    "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth-compat.js",
  ];
  const base = [
    "/assets/js/firebase-init.js",
    "/assets/js/theme.js",
    "/assets/js/status-gate.js",
    "/assets/js/analytics.js",
    "/assets/js/cookies.js",
  ];
  const all = firebaseSdk.concat(base).concat(extra || []);
  return all.map((s) => `<script defer src="${s}"></script>`).join("\n");
}

const HEART_SVG =
  '<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.8-4.7-10.2-9.4C.4 8 1.7 4.7 4.9 3.7c2-.6 4 .1 5.3 1.8.4.5 1 .5 1.4 0 1.3-1.7 3.3-2.4 5.3-1.8 3.2 1 4.5 4.3 3.1 7.4-2.4 4.7-10.2 9.4-10.2 9.4Z"/></svg>';

function ficheCardHtml(f, opts) {
  opts = opts || {};
  const tags = f.themes.map(themeTag).join("") + (f.region !== "a_confirmer" ? regionTag(f.region) : "");
  const rankNum = opts.rank ? `<span class="rank-num">${String(opts.rank).padStart(2, "0")}</span>` : "";
  const votesHtml = `<span class="card-votes" data-vote-count="${f.id}">${HEART_SVG}<span class="vote-num">0</span></span>`;
  const glyphInner = f.image ? `<img src="${esc(f.image)}" alt="" loading="lazy">` : glyphSvg(f.themes[0]);
  return `<a class="fiche-card" href="${ficheUrl(f)}" data-themes="${f.themes.join(",")}" data-region="${f.region}" data-departement="${esc(f.departement || "")}" data-country="${esc(countryOfRegion(f.region))}" data-sub="${esc(f.subcategory || "")}">
    ${rankNum}
    <div class="card-glyph theme-${f.themes[0]}">${glyphInner}</div>
    <div class="card-body">
      <div class="card-tags">${tags}</div>
      <h3>${esc(f.title)}</h3>
      <div class="card-status">${statusBadge(f.status)}</div>
    </div>
    ${votesHtml}
  </a>`;
}

/* ---------------- page shell ---------------- */
// heroNav: true → la page fournit sa propre navigation posée sur la photo
// (accueil, fiches) ; sinon, barre du haut blanche classique.
function page({ title, description, path: pagePath, ogImage, active, bodyClass, content, extraScripts, extraStyles, noIndex, heroNav }) {
  return `${headHtml({ title, description, path: pagePath, ogImage, extraStyles, noIndex })}
<body${bodyClass ? ` class="${bodyClass}"` : ""}>
<div class="app" id="app">
  ${heroNav ? statusBannerHtml() : topbarHtml(active)}
  <main class="views">
    ${content}
  </main>
  ${tabbarHtml(active)}
</div>
${cookieBannerHtml()}
${toastHtml()}
${scriptsHtml(extraScripts)}
</body>
</html>
`;
}

// Distance à vol d'oiseau entre deux {lat, lon}, en km (même formule que le moteur d'itinéraire).
function kmBetween(a, b) {
  return engine.haversineKm(a, b);
}

// Les villes de référence (site.json → referenceCities) les plus proches d'un lieu,
// avec distance routière estimée et temps de trajet — calculés au build, jamais à la main.
// Estimation d'affichage pour les longs trajets depuis une grande ville : les
// 40 premiers km sur route secondaire (55 km/h), le reste sur voie rapide
// (95 km/h). Le moteur d'itinéraire garde sa propre vitesse (55 km/h), pensée
// pour les petits sauts entre deux lieux d'une même journée.
function longTripMinutes(roadKm) {
  const local = Math.min(roadKm, 40);
  return (local / 55) * 60 + (Math.max(0, roadKm - 40) / 95) * 60;
}
function nearestCities(coords, n) {
  if (!coords) return [];
  return (site.referenceCities || [])
    .map((c) => {
      const roadKm = engine.haversineKm(coords, c.coords) * 1.2;
      return { label: c.label, km: Math.round(roadKm), min: Math.round(longTripMinutes(roadKm) / 5) * 5 };
    })
    .sort((a, b) => a.km - b.km)
    .slice(0, n);
}

// Lieu mis en avant (« coup de cœur ») : la première fiche marquée redactionPick,
// sinon la première fiche vérifiée, sinon une fiche vérifiée avec réserves, sinon la première fiche.
function pickFiche() {
  return (
    fiches.find((f) => f.redactionPick) ||
    fiches.find((f) => f.status === "verifie") ||
    fiches.find((f) => f.status === "reserve") ||
    fiches[0]
  );
}

function arrowSvg() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';
}

// Ligne de lieu compacte (vignette + tags + titre + statut), utilisée sur l'accueil et « À proximité ».
function placeRowHtml(f, metaText) {
  const tagLabel = (THEMES[f.themes[0]] || {}).label || "";
  const thumb = f.image ? `<img src="${esc(f.image)}" alt="" loading="lazy">` : `<span class="p-glyph">${glyphSvg(f.themes[0])}</span>`;
  return `<a class="p-card" href="${ficheUrl(f)}">
      ${thumb}
      <div class="p-card-body"><span class="tag theme-${f.themes[0]}">${esc(tagLabel)}</span><h4>${esc(f.title)}</h4>${
        metaText ? `<span class="p-meta">${esc(metaText)}</span>` : statusBadge(f.status)
      }</div>
      ${arrowSvg()}
    </a>`;
}

/* ================= pages ================= */

function ficheMapJson() {
  return JSON.stringify(
    fiches
      .filter((f) => f.coords)
      .map((f) => ({
        id: f.id,
        title: f.title,
        summary: f.summary,
        coords: f.coords,
        theme: f.themes[0],
        region: f.region,
        departement: f.departement || null,
        country: countryOfRegion(f.region),
        url: ficheUrl(f),
      }))
  );
}

// Remplacé le 24/09/2026 par deux menus déroulants (région, puis département
// filtré selon la région choisie) — voir regionDeptFilterHtml() : les chips de
// région débordaient et coupaient les dernières régions en version bureau.
function regionChipsHtml(idAttr) {
  const regionKeys = Object.keys(REGIONS).filter((k) => k !== "a_confirmer");
  const chip = (key, label) => `<button type="button" class="chip${key === "tous" ? " active" : ""}" data-region="${esc(key)}">${esc(label)}</button>`;
  return `<div class="chip-row" id="${idAttr}">
    ${chip("tous", "Toutes les régions")}
    ${regionKeys.map((k) => chip(k, regionLabel(k))).join("\n    ")}
  </div>`;
}

// Deux menus déroulants : région (toutes présentes), puis département —
// repeuplé côté client (assets/js/region-dept-filter.js) à partir de
// window.__DEPT_BY_REGION__ selon la région choisie. idPrefix distingue
// les instances (accueil+carte partagent "mapRegionChips", classement a
// son propre "regionChips") sans jamais entrer en collision d'ids.
function regionDeptFilterHtml(idPrefix) {
  const regionKeys = Object.keys(REGIONS).filter((k) => k !== "a_confirmer");
  const deptByRegion = {};
  Object.keys(DEPARTEMENTS).forEach((code) => {
    const d = DEPARTEMENTS[code];
    if (!deptByRegion[d.region]) deptByRegion[d.region] = [];
    deptByRegion[d.region].push({ code, name: d.name });
  });
  Object.keys(deptByRegion).forEach((r) => deptByRegion[r].sort((a, b) => a.name.localeCompare(b.name, "fr")));

  return `<div class="region-dept-filter" data-filter-group="${esc(idPrefix)}">
    <div class="rd-field">
      <label for="${idPrefix}Region">Région</label>
      <select id="${idPrefix}Region" class="rd-select" data-role="region">
        <option value="tous">Toutes les régions</option>
        ${regionKeys.map((k) => `<option value="${esc(k)}">${esc(regionLabel(k))}</option>`).join("\n        ")}
      </select>
    </div>
    <div class="rd-field">
      <label for="${idPrefix}Dept">Département</label>
      <select id="${idPrefix}Dept" class="rd-select" data-role="departement" disabled>
        <option value="tous">Tous les départements</option>
      </select>
    </div>
  </div>
  <script>window.__DEPT_BY_REGION__ = window.__DEPT_BY_REGION__ || ${JSON.stringify(deptByRegion)};</script>`;
}

// N'apparaît que lorsqu'un deuxième pays est réellement présent dans site.json
// ("countries" + regions dont "country" diffère de "france") — reste invisible
// aujourd'hui, prêt à s'activer tout seul le jour où l'Europe s'ajoute.
function countryChipsHtml(idAttr) {
  if (!MULTI_COUNTRY) return "";
  const codes = Object.keys(COUNTRIES);
  const chip = (key, label) => `<button type="button" class="chip${key === "tous" ? " active" : ""}" data-country="${esc(key)}">${esc(label)}</button>`;
  return `<div class="eyebrow" style="padding:2px 16px 0;">Pays</div>
  <div class="chip-row" id="${idAttr}">
    ${chip("tous", "Tous les pays")}
    ${codes.map((k) => chip(k, COUNTRIES[k])).join("\n    ")}
  </div>`;
}

// Bandeau de photos en haut de l'accueil. Piloté par site.json → "homeGallery"
// (un tableau de {src, alt}) : Erinson peut changer les photos plus tard en
// modifiant seulement ce tableau, sans toucher au code.
function homeGalleryHtml() {
  const photos = site.homeGallery || [];
  if (!photos.length) return "";
  const slides = photos
    .map((p) => `<div class="home-gallery-slide"><img src="${esc(p.src)}" alt="${esc(p.alt || "")}" loading="lazy"></div>`)
    .join("");
  return `<div class="home-gallery" role="group" aria-label="Photos du guide">${slides}</div>`;
}

function mapLegendHtml() {
  return `<div class="map-legend" id="mapLegend">
      ${Object.keys(THEMES)
        .map((k) => `<span><span class="dot" style="background:var(--${THEMES[k].varName})"></span>${esc(THEMES[k].label)}</span>`)
        .join("")}
    </div>`;
}

function buildHome() {
  const year = new Date().getFullYear();
  // Photos de l'accueil : modifiables sans toucher au code via site.json →
  // "homeHero": {"src", "alt"} et "homeBand": {"src", "alt", "caption"}.
  const hero = Object.assign({ src: "/assets/img/accueil/hero.jpg", alt: "Coucher de soleil sur la mer, vu entre deux rochers" }, site.homeHero || {});
  const band = Object.assign(
    { src: "/assets/img/accueil/falaises.jpg", alt: "Falaises dorées au soleil couchant, reflétées sur le sable mouillé", caption: "Hors des sentiers battus" },
    site.homeBand || {}
  );
  const pick = pickFiche();
  const maxDays = (site.itinerary && site.itinerary.maxDaysRequestable) || 7;
  const verifiedCount = fiches.filter((f) => isItineraryReady(f)).length;
  const themeCount = Object.keys(THEMES).length;

  const topper = [pick ? `<a class="now" href="${ficheUrl(pick)}">Coup de cœur du moment</a>` : ""]
    .concat(Object.keys(THEMES).map((k) => `<a href="/classement/">${esc(THEMES[k].label)}</a>`))
    .join("");

  const dayOptions = Array.from({ length: maxDays }, (_, i) => i + 1)
    .map((d) => `<option value="${d}"${d === 2 ? " selected" : ""}>${d} jour${d > 1 ? "s" : ""}</option>`)
    .join("");

  const pickHtml = pick
    ? `<section class="home-pick">
      <span class="label">Le coup de cœur de la rédaction</span>
      <a class="pick-img" href="${ficheUrl(pick)}">${
        pick.image ? `<img src="${esc(pick.image)}" alt="${esc(pick.title)}" loading="lazy">` : glyphSvg(pick.themes[0])
      }</a>
      <div class="pick-body">
        <div class="card-tags">${pick.themes.map(themeTag).join("")}${pick.region !== "a_confirmer" ? regionTag(pick.region) : ""}</div>
        <h3><a href="${ficheUrl(pick)}">${esc(pick.title)}</a></h3>
        ${pick.highlight ? `<blockquote>« ${esc(pick.highlight)} »</blockquote>` : ""}
        <p>${esc(pick.summary)}</p>
        <div class="meta-row">
          <span class="m mono">${statusInfo(pick.status).label}${
            pick.visitDurationMin ? ` · visite ${engine.formatDuration(pick.visitDurationMin)}` : ""
          }</span>
          <a href="${ficheUrl(pick)}">Lire la fiche →</a>
        </div>
      </div>
    </section>`
    : "";

  const content = `<section class="view home-view">
    <header class="home-hero">
      <img class="home-hero-img" src="${esc(hero.src)}" alt="${esc(hero.alt)}">
      ${heroNavHtml({ back: false, topper, active: "home" })}
      <div class="home-hero-title">
        <span class="hero-eyebrow">Le guide des lieux insolites</span>
        <h1>Votre <span class="w-grand">GRAND</span><br><span class="w-ptit">p'tit tour</span></h1>
      </div>
      <div class="hero-vert"><span>Le guide — édition ${year}</span></div>
      <div class="home-hero-foot">
        <p>Lieux insolites et patrimoine français, repérés puis vérifiés sur le terrain par la rédaction.</p>
        <a href="#carte">Découvrir la carte ↓</a>
      </div>
    </header>

    <form class="home-search" action="/itineraire/" method="get">
      <div class="s-row1">
        <label for="hs-lieu">Où séjournez-vous ?</label>
        <input id="hs-lieu" name="lieu" placeholder="Ex. Bourges, Cher…" autocomplete="off">
      </div>
      <div class="s-row2">
        <div class="s-f"><label for="hs-km">Distance / jour</label><select id="hs-km" name="km"><option value="20">20 km</option><option value="50" selected>50 km</option><option value="100">100 km</option><option value="150">150 km</option><option value="250">250 km</option></select></div>
        <div class="s-f"><label for="hs-jours">Durée</label><select id="hs-jours" name="jours">${dayOptions}</select></div>
        <button class="s-btn" type="submit">Composer</button>
      </div>
    </form>

    <div class="facts">
      <div class="fact"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><path d="M12 21s-7-6.1-7-11.5A7 7 0 0 1 19 9.5C19 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.3"/></svg><b>${fiches.length} lieu${fiches.length > 1 ? "x" : ""}</b><span>Au guide</span></div>
      <div class="fact"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></svg><b>${themeCount} thèmes</b><span>À explorer</span></div>
      <div class="fact"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><path d="M20 6 9 17l-5-5"/></svg><b>${verifiedCount} vérifié${verifiedCount > 1 ? "s" : ""}</b><span>Sur place</span></div>
    </div>

    <section class="home-mission">
      <span class="label">Notre mission</span>
      <blockquote>« Composer des vacances sur mesure, autour de lieux insolites et du patrimoine français. »</blockquote>
      <p>Art brut, curiosités, sites naturels, architecture religieuse — tout ce qui ne figure pas dans les guides habituels. Indiquez où vous séjournez et jusqu'où vous êtes prêt·e à rouler chaque jour : on vous propose les lieux vérifiés autour, vous choisissez, et la rédaction relit tout avant de confirmer votre séjour.</p>
    </section>

    <figure class="home-band">
      <img src="${esc(band.src)}" alt="${esc(band.alt)}" loading="lazy">
      <figcaption><b>${esc(band.caption)}</b><span>Photo ${esc(site.instagramHandle)}</span></figcaption>
    </figure>

    <section class="home-steps">
      <span class="label">Comment ça marche</span>
      <div class="step"><div class="step-n">01</div><div><h3>Point de départ</h3><p>La ville ou le village où vous séjournez, et la distance que vous êtes prêt·e à parcourir chaque jour.</p></div></div>
      <div class="step"><div class="step-n">02</div><div><h3>Vos lieux</h3><p>On vous propose les lieux vérifiés autour, sur la carte ; vous cochez ceux qui vous font envie, la rédaction ajoute ses coups de cœur du coin.</p></div></div>
      <div class="step"><div class="step-n">03</div><div><h3>Votre itinéraire</h3><p>Un parcours jour par jour, temps de route compris, toujours relu par la rédaction avant d'être confirmé.</p></div></div>
    </section>

    ${pickHtml}

    <section class="home-places">
      <div class="sec-head-row"><h2 class="sec-title">Les lieux du guide</h2><a href="/classement/">Tout voir →</a></div>
      ${fiches.map((f) => placeRowHtml(f)).join("\n      ")}
    </section>

    <section class="home-map" id="carte">
      <h2 class="sec-title">La carte du guide</h2>
      <p class="sec-lead">Touchez un repère pour ouvrir la fiche du lieu. Filtrez par région pour ne garder que ce qui est près de vous.</p>
      ${countryChipsHtml("mapCountryChips")}
      ${regionDeptFilterHtml("mapRegionChips")}
      <div id="mapEl" class="real-map home-real-map"></div>
      ${mapLegendHtml()}
    </section>

    <div class="follow-row">
      <a href="${esc(site.instagramUrl)}" target="_blank" rel="noopener">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1"/></svg>
        Instagram
      </a>
      <a href="${esc(site.facebookUrl)}" target="_blank" rel="noopener">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="1.6"><path d="M14 8.5h2.5V5H14c-2 0-3.5 1.6-3.5 3.6V11H8v3h2.5v6h3v-6H16l.5-3h-3V9c0-.3.2-.5.5-.5Z"/></svg>
        Facebook
      </a>
    </div>
    ${newsletterHtml()}
    ${footerHtml()}
  </section>
  <script>window.__FICHES_MAP__ = ${ficheMapJson()};</script>`;
  return page({
    title: "",
    description: `${site.siteTagline} — le guide des lieux insolites et du patrimoine, vérifiés sur place, par ${site.instagramHandle}.`,
    path: "/",
    ogImage: hero.src,
    active: "home",
    content,
    heroNav: true,
    extraScripts: ["/assets/js/votes.js", "/assets/js/newsletter.js", "/assets/js/region-dept-filter.js", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", "/assets/js/map.js"],
    extraStyles: ["https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"],
  });
}

function buildCarte() {
  const list = fiches
    .filter((f) => f.coords)
    .map((f) => ficheCardHtml(f))
    .join("\n");
  const content = `<section class="view map-view">
    ${countryChipsHtml("mapCountryChips")}
    ${regionDeptFilterHtml("mapRegionChips")}
    <div id="mapEl" class="real-map"></div>
    ${mapLegendHtml()}
    <div class="section-head">
      <h1>Autour de la carte</h1>
      <p>Touchez un repère pour ouvrir la fiche du lieu.</p>
    </div>
    <div class="fiche-list">${list}</div>
    ${footerHtml()}
  </section>
  <script>window.__FICHES_MAP__ = ${ficheMapJson()};</script>`;
  return page({
    title: "Carte",
    description: "La carte interactive des lieux insolites et du patrimoine français.",
    path: "/carte/",
    active: "carte",
    content,
    extraScripts: ["/assets/js/votes.js", "/assets/js/region-dept-filter.js", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", "/assets/js/map.js"],
    extraStyles: ["https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"],
  });
}

function buildClassement() {
  const themeChips = ["tous"].concat(Object.keys(THEMES));
  const cards = fiches
    .filter((f) => isItineraryReady(f))
    .map((f, i) => ficheCardHtml(f, { rank: i + 1 }))
    .join("\n");
  const content = `<section class="view">
    <div class="section-head">
      <h1>Classement</h1>
      <p>Les lieux les plus plébiscités, par thème et par région.</p>
    </div>
    <div class="eyebrow" style="padding:2px 16px 0;">Thème</div>
    <div class="chip-row" id="themeChips">
      ${themeChips.map((k) => `<button class="chip${k === "tous" ? " active" : ""}" data-theme="${k}" type="button">${k === "tous" ? "Tous" : esc(THEMES[k].label)}</button>`).join("")}
    </div>
    <div class="eyebrow sub-eyebrow" style="padding:2px 16px 0;" id="subEyebrow" hidden>Sous-catégorie</div>
    ${Object.keys(THEMES)
      .map((themeKey) => {
        const subs = THEMES[themeKey].sub || {};
        const subKeys = ["tous"].concat(Object.keys(subs));
        return `<div class="chip-row sub-chip-row" id="subChips-${themeKey}" data-for-theme="${themeKey}" hidden>
      ${subKeys.map((sk) => `<button class="chip${sk === "tous" ? " active" : ""}" data-sub="${sk}" type="button">${sk === "tous" ? "Toutes" : esc(subs[sk])}</button>`).join("")}
    </div>`;
      })
      .join("\n    ")}
    ${countryChipsHtml("countryChips")}
    ${regionDeptFilterHtml("regionChips")}
    <div class="rank-list" id="rankList">${cards}</div>
    ${footerHtml()}
  </section>`;
  return page({
    title: "Classement",
    description: "Les lieux les plus plébiscités, par thème et par région.",
    path: "/classement/",
    active: "classement",
    content,
    extraScripts: ["/assets/js/votes.js", "/assets/js/region-dept-filter.js", "/assets/js/classement.js"],
  });
}

const CAR_ICON = '<svg viewBox="0 0 24 24"><path d="M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11"/><rect x="3" y="11" width="18" height="6" rx="2"/><circle cx="7.5" cy="17.5" r="1.4"/><circle cx="16.5" cy="17.5" r="1.4"/></svg>';
const CLOCK_ICON = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>';
const PIN_ICON = '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.1-7-11.5A7 7 0 0 1 19 9.5C19 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.3"/></svg>';

function buildFiche(f) {
  const year = new Date().getFullYear();
  const info = statusInfo(f.status);
  const verified = info.key === "verifie";
  const theme0 = THEMES[f.themes[0]] || {};
  const themeLabels = f.themes.map((k) => (THEMES[k] || {}).label).filter(Boolean).join(" · ");
  const subLabel = f.subcategory && theme0.sub ? theme0.sub[f.subcategory] : "";
  const regionText = f.region !== "a_confirmer" ? regionLabel(f.region) : "";

  const heroFocus = f.imageFocus && FOCUS_Y.hasOwnProperty(f.imageFocus) ? ` style="object-position:center ${FOCUS_Y[f.imageFocus]}%"` : "";
  const heroMedia = f.image
    ? `<img class="fiche-hero-img" src="${esc(f.image)}" alt="${esc(f.title)}"${heroFocus}>`
    : `<div class="fiche-hero-glyph">${glyphSvg(f.themes[0])}</div>`;
  const breadcrumb = `<a href="/">Accueil</a><span class="sep">/</span><a href="/classement/">${esc(theme0.label || "Le guide")}</a><span class="sep">/</span><span>${esc(f.title)}</span>`;
  const photoCredit = f.image && f.imageCredit ? `<span class="photo-credit">Photo ${esc(f.imageCredit)}</span>` : "";

  // Rangée d'icônes (façon guides papier) : durée de visite, région, ville de référence la plus proche.
  const cities = nearestCities(f.coords, 3);
  const infoItems = [];
  if (f.visitDurationMin) infoItems.push(`<div class="info-item">${CLOCK_ICON}<b>${engine.formatDuration(f.visitDurationMin)}</b><span>Durée de visite</span></div>`);
  if (regionText) infoItems.push(`<div class="info-item">${PIN_ICON}<b>${esc(regionText)}</b><span>Région</span></div>`);
  if (cities[0]) infoItems.push(`<div class="info-item">${CAR_ICON}<b>~${engine.formatDuration(cities[0].min)}</b><span>De ${esc(cities[0].label)}</span></div>`);
  const infoRow = infoItems.length ? `<div class="info-row">${infoItems.join("")}</div>` : "";

  const draftNote =
    info.key === "brouillon"
      ? `<div class="draft-note"><b>En cours de vérification.</b> Cette fiche attend encore la confirmation des faits par la rédaction (lieu, source, date) avant publication officielle.</div>`
      : info.key === "reserve"
      ? `<div class="draft-note reserve"><b>Quelques détails à confirmer.</b> Le lieu a été vérifié par la rédaction, mais certaines informations pratiques (horaires, tarifs ou position exacte) restent à préciser sur place.</div>`
      : "";

  // Citation mise en avant (optionnelle, par fiche) : coupe le texte en deux,
  // à la manière d'une citation extraite. Renseignée via fiches.json → "highlight".
  const bodyParas = f.body || [];
  const bodyHtml =
    f.highlight && bodyParas.length > 1
      ? `<p>${esc(bodyParas[0])}</p><blockquote class="fiche-pullquote">« ${esc(f.highlight)} »</blockquote>${bodyParas
          .slice(1)
          .map((p) => `<p>${esc(p)}</p>`)
          .join("")}`
      : (f.highlight ? `<blockquote class="fiche-pullquote">« ${esc(f.highlight)} »</blockquote>` : "") + bodyParas.map((p) => `<p>${esc(p)}</p>`).join("");

  // Gabarits de galerie — même moteur que l'export PDF (src/print/gabarits.js).
  const gab = gabarits.assignGallery(f.gallery, gabarits.FULL_SLOTS);
  const fig = (photo) => {
    if (!photo) return "";
    const { dataAttr, style } = focusAttrs(photo);
    return `<figure${dataAttr}><img src="${esc(photo.src)}" alt="${esc(photo.caption || "")}" loading="lazy"${style}>${
      photo.caption ? `<figcaption>${esc(photo.caption)}</figcaption>` : ""
    }</figure>`;
  };
  const galleryBlocks = [];
  if (gab.bandeau_duo) galleryBlocks.push(`<div class="gallery-duo">${gab.bandeau_duo.map((p) => fig(p)).join("")}</div>`);
  if (gab.grand_simple) galleryBlocks.push(`<div class="gallery-tall">${fig(gab.grand_simple[0])}</div>`);
  if (gab.grand_large) galleryBlocks.push(`<div class="gallery-wide">${fig(gab.grand_large[0])}</div>`);
  if (gab.insert_petit) galleryBlocks.push(`<div class="gallery-small">${fig(gab.insert_petit[0])}</div>`);
  if (gab.bande_detail) galleryBlocks.push(`<div class="gallery-wide">${fig(gab.bande_detail[0])}</div>`);
  (gab.trio || []).forEach((trio) => {
    galleryBlocks.push(`<div class="gallery-trio">${trio.map((p, i) => `<div class="t${i + 1}">${fig(p)}</div>`).join("")}</div>`);
  });
  const gallery = galleryBlocks.length
    ? `<section class="fiche-sec fiche-gallery"><h2 class="sec-title">Vu sur place</h2><div class="gallery-block">${galleryBlocks.join("")}</div></section>`
    : "";

  const verdictHtml = f.verdict
    ? `<div class="fiche-verdict">
        <div class="kicker">L'avis de la rédaction</div>
        <p>${esc(f.verdict)}</p>
        <div class="sig">— La rédaction de ${esc(site.siteName)}</div>
      </div>`
    : "";

  // Infos pratiques : champs libres de fiches.json → "practical", plus catégorie, statut et coordonnées.
  const rows = Object.entries(f.practical || {}).map(([k, v]) => [k, esc(v)]);
  if (subLabel) rows.push(["Catégorie", esc(subLabel)]);
  rows.push(["Statut", info.labelFull]);
  if (f.coords) rows.push(["Coordonnées", `<span class="mono">${f.coords.lat}, ${f.coords.lon}</span>`]);
  const practical = `<section class="fiche-sec fiche-practical">
      <h2 class="sec-title">Infos pratiques</h2>
      <div class="p-table">${rows.map(([k, v]) => `<div class="p-row"><div class="k">${esc(k)}</div><div class="v">${v}</div></div>`).join("")}</div>
      <div class="p-cta">
        <a class="btn-primary" href="/itineraire/">Ajouter à mon itinéraire</a>
        ${f.coords ? `<a class="btn-ghost" href="#situer">Voir sur la carte</a>` : ""}
      </div>
    </section>`;

  // Situer le lieu : vraie carte en ligne (fiche-map.js) + temps depuis les villes de référence.
  const gpsUrl = f.coords ? `https://www.google.com/maps/dir/?api=1&amp;destination=${f.coords.lat},${f.coords.lon}` : "";
  const situ = f.coords
    ? `<section class="fiche-sec fiche-situ" id="situer">
      <h2 class="sec-title">Situer le lieu</h2>
      <div id="ficheMap" class="real-map fiche-map"></div>
      ${
        cities.length
          ? `<div class="situ-dist">${cities
              .map((c) => `<div><b>~${engine.formatDuration(c.min)}</b><span>${esc(c.label)} · ${c.km} km</span></div>`)
              .join("")}</div>`
          : ""
      }
      <div class="p-cta">
        <a class="btn-primary" href="${gpsUrl}" target="_blank" rel="noopener">Y aller (GPS)</a>
        <a class="btn-ghost" href="/carte/">Carte du guide</a>
      </div>
      <p class="sec-note">Temps de trajet estimés en voiture depuis les grandes villes, calculés automatiquement.</p>
    </section>`
    : "";

  const others = f.coords
    ? fiches
        .filter((o) => o.id !== f.id && o.coords)
        .map((o) => ({ o, km: kmBetween(f.coords, o.coords) }))
        .sort((a, b) => a.km - b.km)
        .slice(0, 4)
    : [];
  const nearby = others.length
    ? `<section class="fiche-sec fiche-nearby"><h2 class="sec-title">À proximité</h2>${others
        .map(({ o, km }) => placeRowHtml(o, `${Math.round(km)} km à vol d'oiseau · ${statusInfo(o.status).label.toLowerCase()}`))
        .join("")}</section>`
    : "";

  const sources = (f.sources || []).map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)} ↗</a></li>`).join("");

  const content = `<section class="view detail">
    <header class="fiche-hero${f.image ? " has-photo" : ""}">
      ${heroMedia}
      ${heroNavHtml({ back: true, topper: breadcrumb })}
      <div class="hero-vert"><span>Le guide — édition ${year}</span></div>
      <div class="hero-status ${info.heroClass}"><i></i><span>${info.label}</span></div>
      <div class="fiche-hero-text">
        <span class="hero-tags">${esc(themeLabels)}</span>
        <h1>${esc(f.title)}</h1>
      </div>
      ${photoCredit}
    </header>
    ${infoRow}
    <div class="detail-body">
      <p class="detail-summary">${esc(f.summary)}</p>
      <a class="account-credit" href="${esc(site.instagramUrl)}" target="_blank" rel="noopener">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1"/></svg>
        Un lieu du compte ${esc(site.instagramHandle)}
      </a>
      ${draftNote}
      <div class="detail-text">${bodyHtml}</div>
      ${verdictHtml}
    </div>
    ${gallery}
    ${practical}
    ${situ}
    ${sources ? `<section class="fiche-sec fiche-sources"><h2 class="sec-title">Sources</h2><ul class="sources">${sources}</ul></section>` : ""}

    <div class="action-row">
      <button class="vote-btn" id="voteBtn" type="button" data-fiche="${f.id}">
        ${HEART_SVG}
        <span id="voteBtnLabel">Coup de cœur</span>
      </button>
      <span class="vote-count" id="voteCount">0 vote</span>
      <div class="share-row">
        <button class="share-btn" id="shareCopyBtn" title="Copier le lien" aria-label="Copier le lien" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="1.7"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a1 1 0 0 1 1-1h9"/></svg>
        </button>
        <button class="share-btn" id="shareNativeBtn" title="Partager" aria-label="Partager" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="1.7"><circle cx="18" cy="5" r="2.4"/><circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="19" r="2.4"/><path d="M8.2 10.8 15.8 6.2M8.2 13.2l7.6 4.6"/></svg>
        </button>
      </div>
    </div>

    ${nearby}

    <section class="fiche-sec fiche-reco">
      <h2 class="sec-title">Lectures recommandées</h2>
      <div class="reco-scroll" id="recoScroll"></div>
    </section>

    <section class="fiche-sec fiche-comments">
      <h2 class="sec-title">Commentaires</h2>
      <div id="commentList"></div>
      <div id="commentFormWrap"></div>
    </section>
    ${footerHtml()}
  </section>
  <script>
    window.__CURRENT_FICHE__ = ${JSON.stringify(f.id)};
    window.__ALL_FICHES__ = ${JSON.stringify(
      fiches.map((o) => ({ id: o.id, title: o.title, themes: o.themes, region: o.region, image: o.image, url: ficheUrl(o) }))
    )};
    window.__FICHE_MAP__ = ${JSON.stringify(
      f.coords
        ? {
            title: f.title,
            lat: f.coords.lat,
            lon: f.coords.lon,
            statusKey: info.key,
            others: fiches
              .filter((o) => o.id !== f.id && o.coords)
              .map((o) => ({ title: o.title, url: ficheUrl(o), lat: o.coords.lat, lon: o.coords.lon, statusKey: statusInfo(o.status).key })),
          }
        : null
    )};
  </script>`;

  const scripts = ["/assets/js/votes.js", "/assets/js/comments.js", "/assets/js/reco.js", "/assets/js/photo-focus.js"];
  if (f.coords) scripts.push("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", "/assets/js/fiche-map.js");
  return page({
    title: f.title,
    description: f.summary,
    path: ficheUrl(f),
    ogImage: f.image,
    active: null,
    content,
    heroNav: true,
    extraScripts: scripts,
    extraStyles: f.coords ? ["https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"] : [],
  });
}

function buildContribuer() {
  const content = `<section class="view">
    <div class="section-head">
      <h1>Proposer un lieu</h1>
      <p>Vous connaissez un endroit qui mériterait sa fiche ? Dites-nous tout — la rédaction vérifie chaque proposition avant publication.</p>
    </div>
    <form class="form-wrap" id="suggestForm">
      <div class="field">
        <label for="sg-name">Nom du lieu</label>
        <input id="sg-name" required>
      </div>
      <div class="field">
        <label for="sg-region">Région / commune</label>
        <input id="sg-region">
      </div>
      <div class="field">
        <label for="sg-theme">Thème</label>
        <select id="sg-theme">
          ${Object.keys(THEMES)
            .map((k) => `<option value="${k}">${esc(THEMES[k].label)}</option>`)
            .join("")}
        </select>
      </div>
      <div class="field">
        <label for="sg-desc">Pourquoi ce lieu mérite une fiche <span class="hint">(obligatoire)</span></label>
        <textarea id="sg-desc" rows="4" required></textarea>
      </div>
      <div class="field">
        <label for="sg-link">Lien (photo, article, page...) <span class="hint">(optionnel)</span></label>
        <input id="sg-link" type="url">
      </div>
      <div class="field">
        <label for="sg-contact">Votre email <span class="hint">(optionnel, pour vous recontacter)</span></label>
        <input id="sg-contact" type="email">
      </div>
      <button class="btn-primary" id="sg-submit" type="submit">Envoyer la proposition</button>
      <p class="muted-note" id="sg-note" style="margin-top:10px;"></p>
    </form>
    ${footerHtml()}
  </section>`;
  return page({
    title: "Proposer un lieu",
    description: "Proposez un lieu insolite ou patrimonial à ajouter au guide.",
    path: "/contribuer/",
    active: "contribuer",
    content,
    extraScripts: ["/assets/js/suggest.js"],
  });
}

function buildItineraire() {
  const ITIN = site.itinerary;
  const verifiedForItin = fiches
    .filter((f) => isItineraryReady(f) && f.coords)
    .map((f) => ({
      id: f.id,
      title: f.title,
      themes: f.themes,
      region: f.region,
      coords: f.coords,
      visitDurationMin: f.visitDurationMin || ITIN.defaultVisitDurationMin,
      image: f.image || null,
      redactionPick: !!f.redactionPick,
      url: ficheUrl(f),
    }));
  const themeLabels = Object.keys(THEMES).reduce((acc, k) => {
    acc[k] = THEMES[k].label;
    return acc;
  }, {});

  const content = `<section class="view">
    <div class="section-head">
      <h1>Créer mon itinéraire</h1>
      <p>Indiquez où vous comptez séjourner, on vous propose les lieux vérifiés du guide autour — vous choisissez ceux qui vous intéressent, la rédaction relit avant que ce soit définitif.</p>
    </div>

    <form class="form-wrap" id="itinStep1">
      <div class="field">
        <label for="it-depart">Ville de départ <span class="hint">(optionnel — pour des étapes sur la route)</span></label>
        <div class="autocomplete-wrap">
          <input id="it-depart" type="text" autocomplete="off" placeholder="Ex. Paris…">
          <div id="it-depart-suggestions" class="autocomplete-list" hidden></div>
        </div>
        <p class="hint">Si vous l'indiquez, on vous propose des lieux sur la route plutôt qu'autour d'un seul point.</p>
      </div>
      <div class="field">
        <label for="it-place">Où comptez-vous séjourner ? <span class="hint">(ville, village, adresse…)</span></label>
        <div class="autocomplete-wrap">
          <input id="it-place" type="text" autocomplete="off" placeholder="Ex. Bourges, Cher…" required>
          <div id="it-place-suggestions" class="autocomplete-list" hidden></div>
        </div>
        <p class="hint no-idea-hint">Pas d'idée précise ? <a href="/classement/">Découvrir les lieux par thème →</a></p>
      </div>
      <div class="field">
        <label for="it-radius">Distance que vous êtes prêt·e à parcourir par jour</label>
        <select id="it-radius">
          <option value="20">Jusqu'à 20 km</option>
          <option value="50" selected>Jusqu'à 50 km</option>
          <option value="100">Jusqu'à 100 km</option>
          <option value="150">Jusqu'à 150 km</option>
          <option value="250">Au-delà de 150 km</option>
        </select>
      </div>
      <div class="field">
        <label for="it-days">Nombre de jours</label>
        <input id="it-days" type="number" min="1" max="${ITIN.maxDaysRequestable}" value="2" required>
      </div>
      <div class="field">
        <label for="it-pace">Rythme</label>
        <select id="it-pace">
          ${Object.keys(ITIN.paceLabels)
            .map((k) => `<option value="${k}"${k === "standard" ? " selected" : ""}>${esc(ITIN.paceLabels[k])}</option>`)
            .join("")}
        </select>
      </div>
      <button class="btn-primary" id="it-step1-submit" type="submit" disabled>Voir les lieux autour de ce point</button>
      <p class="hint" style="margin-top:6px;">Choisissez un lieu dans la liste qui apparaît sous le champ — c'est lui qui sert de point de départ.</p>
    </form>

    <div id="itinStep2" hidden>
      <div class="section-head">
        <h2>Choisissez vos lieux</h2>
        <p class="muted-note" id="it-step2-sub" style="padding:0 16px;"></p>
      </div>
      <div id="itinMap" class="real-map compact"></div>
      <div id="itinProposals" class="itin-proposal-list"></div>
      <div id="itinRecoBlock" hidden>
        <div class="section-head" style="margin-top:10px;">
          <h2>La rédaction recommande aussi</h2>
          <p>Des coups de cœur du guide un peu plus loin, que vous n'avez pas vus dans les propositions ci-dessus — un clic pour les ajouter.</p>
        </div>
        <div id="itinReco" class="itin-proposal-list"></div>
      </div>
      <div class="form-wrap" style="padding-top:16px;">
        <div class="field">
          <label for="it-place-request">Un lieu en particulier que vous aimeriez inclure et qu'on n'a pas encore ? <span class="hint">(optionnel)</span></label>
          <textarea id="it-place-request" rows="2" maxlength="300" placeholder="Nom du lieu, ville, pourquoi vous y tenez…"></textarea>
          <p class="hint" style="margin-top:2px;">Il apparaîtra dans votre itinéraire, signalé comme votre propre ajout — pas un conseil de la rédaction, qui n'a pas encore vérifié ce lieu.</p>
        </div>
        <div class="field">
          <label for="it-email">Votre email <span class="hint">(optionnel, pour être prévenu·e une fois l'itinéraire validé)</span></label>
          <input id="it-email" type="email">
        </div>
        <button class="btn-primary" id="it-generate" type="button">Générer mon itinéraire</button>
        <button class="btn-secondary" id="it-back" type="button" style="margin-left:8px;">‹ Changer le point de départ</button>
        <p class="muted-note" id="it-note" style="margin-top:10px;"></p>
      </div>
    </div>

    <div id="itineraryResult"></div>
    ${footerHtml()}
  </section>
  <script>
    window.__FICHES_FOR_ITINERARY__ = ${JSON.stringify(verifiedForItin)};
    window.__UGPT_ITINERARY_CFG__ = ${JSON.stringify(ITIN)};
    window.__UGPT_THEME_LABELS__ = ${JSON.stringify(themeLabels)};
    window.__UGPT_ORS_KEY__ = ${JSON.stringify((site.routing && site.routing.orsApiKey) || "")};
  </script>`;

  return page({
    title: "Créer mon itinéraire",
    description: "Indiquez où vous séjournez : on vous propose les lieux vérifiés du guide autour, vous choisissez, la rédaction relit avant confirmation.",
    path: "/itineraire/",
    active: null,
    content,
    extraScripts: [
      "/assets/js/itinerary-engine.js",
      "/assets/js/routing-client.js",
      "/assets/js/itinerary-render.js",
      "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
      "/assets/js/itinerary.js",
    ],
    extraStyles: ["https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"],
  });
}

function buildMonItineraire() {
  const ITIN = site.itinerary;
  const verifiedForItin = fiches
    .filter((f) => isItineraryReady(f) && f.coords)
    .map((f) => ({ id: f.id, title: f.title, image: f.image || null, url: ficheUrl(f) }));

  const content = `<section class="view">
    <div class="section-head">
      <h1>Mon itinéraire</h1>
      <p>Retrouvez ici le suivi de votre demande d'itinéraire.</p>
    </div>
    <div id="trackResult">
      <p class="muted-note" style="padding:0 16px;">Chargement…</p>
    </div>
    ${footerHtml()}
  </section>
  <script>
    window.__FICHES_FOR_ITINERARY__ = ${JSON.stringify(verifiedForItin)};
    window.__UGPT_ITINERARY_CFG__ = ${JSON.stringify(ITIN)};
  </script>`;

  return page({
    title: "Mon itinéraire",
    description: "Suivi d'une demande d'itinéraire personnalisé.",
    path: "/mon-itineraire/",
    active: null,
    content,
    extraScripts: ["/assets/js/itinerary-engine.js", "/assets/js/itinerary-render.js", "/assets/js/itinerary-track.js"],
    noIndex: true,
  });
}

function buildBord() {
  const stats = {
    total: fiches.length,
    verifie: fiches.filter((f) => f.status === "verifie").length,
    reserve: fiches.filter((f) => f.status === "reserve").length,
    brouillon: fiches.filter((f) => statusInfo(f.status).key === "brouillon").length,
  };
  const content = `<section class="view">
    <div class="section-head">
      <h1>Tableau de bord</h1>
      <p>Statistiques internes du guide.</p>
    </div>
    <div class="dash-grid" id="dashGrid"></div>
    <div class="ga-card">
      <h3>Google Analytics</h3>
      <p id="gaStatusText">Chargement des statistiques...</p>
      <p>Propriété GA4 branchée via <span class="mono" style="font-size:11.5px;">gtag</span> — voir <code>assets/js/analytics.js</code>.</p>
    </div>
    <div id="adminGate" class="admin-panel">
      <h3>Espace rédaction</h3>
      <p class="muted-note" style="margin-bottom:10px;">Connectez-vous avec votre compte pour modérer commentaires et suggestions.</p>
      <button class="btn-primary" id="adminLoginBtn" type="button">Se connecter</button>
      <button class="btn-secondary" id="adminLogoutBtn" type="button" hidden>Se déconnecter</button>
    </div>
    <div class="admin-panel" id="adminPanel" hidden>
      <h3><svg viewBox="0 0 24 24" fill="none" stroke-width="1.6"><path d="M12 3 4 6.5v5c0 5 3.4 8.4 8 9.5 4.6-1.1 8-4.5 8-9.5v-5L12 3Z"/></svg> Espace rédaction</h3>
      <div class="eyebrow" style="margin-top:12px;">Demandes d'itinéraire</div>
      <div id="modItineraries"></div>
      <div class="eyebrow" style="margin-top:14px;">Commentaires en attente</div>
      <div id="modComments"></div>
      <div class="eyebrow" style="margin-top:14px;">Propositions reçues</div>
      <div id="modSuggestions"></div>
      <div class="eyebrow" style="margin-top:14px;">Inscriptions newsletter</div>
      <div id="modNewsletter"></div>
      <div class="eyebrow" style="margin-top:14px;">Cadrage des photos</div>
      <p class="muted-note" style="margin-bottom:10px;">Règle le recadrage vertical d'une photo précise dans une fiche (utile quand la photo montre un sujet vertical, comme une tour ou un totem, et que le cadrage automatique n'est pas le bon). S'applique tout de suite sur le site, sans reconstruction.</p>
      <div id="modPhotoFocus"></div>
      <div class="stop-panel">
        <div class="eyebrow" style="margin-bottom:8px;">Bouton d'arrêt d'urgence</div>
        <p class="muted-note" style="margin-bottom:10px;">Suspend immédiatement les votes, commentaires et le formulaire de proposition pour tous les visiteurs — les fiches restent lisibles. À utiliser en cas de modération débordée, de contenu problématique ou de besoin légal.</p>
        <button class="stop-btn" id="stopBtn" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><path d="M12 9v4M12 16.5h.01"/><circle cx="12" cy="12" r="9"/></svg>
          <span id="stopBtnLabel">Activer l'arrêt d'urgence</span>
        </button>
      </div>
    </div>
    ${footerHtml()}
  </section>
  <script>
    window.__FICHE_STATS__ = ${JSON.stringify(stats)};
    window.__FICHES_FOR_ITINERARY__ = ${JSON.stringify(
      fiches
        .filter((f) => isItineraryReady(f) && f.coords)
        .map((f) => ({
          id: f.id,
          title: f.title,
          themes: f.themes,
          region: f.region,
          coords: f.coords,
          visitDurationMin: f.visitDurationMin || site.itinerary.defaultVisitDurationMin,
          image: f.image || null,
          url: ficheUrl(f),
        }))
    )};
    window.__UGPT_ITINERARY_CFG__ = ${JSON.stringify(site.itinerary)};
    window.__FICHES_GALLERIES__ = ${JSON.stringify(
      fiches.map((f) => ({
        id: f.id,
        title: f.title,
        gallery: (f.gallery || []).map((p) => ({
          src: p.src,
          name: path.basename(p.src),
          caption: p.caption || "",
          focus: p.focus || "",
        })),
      })).filter((f) => f.gallery.length)
    )};
  </script>`;
  return page({
    title: "Tableau de bord",
    description: "Statistiques internes et modération du guide.",
    path: "/bord/",
    active: "bord",
    content,
    extraScripts: ["/assets/js/itinerary-engine.js", "/assets/js/admin.js"],
    noIndex: true,
  });
}

function buildLegal(slug, title, bodyHtml) {
  const content = `<section class="view">
    <div class="legal-page">
      <h1>${esc(title)}</h1>
      ${bodyHtml}
    </div>
    ${footerHtml()}
  </section>`;
  return page({
    title,
    description: title,
    path: `/${slug}/`,
    active: null,
    content,
  });
}

/* ================= write everything ================= */
function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  writeFile("index.html", buildHome());
  writeFile("carte/index.html", buildCarte());
  writeFile("classement/index.html", buildClassement());
  writeFile("contribuer/index.html", buildContribuer());
  writeFile("itineraire/index.html", buildItineraire());
  writeFile("mon-itineraire/index.html", buildMonItineraire());
  writeFile("bord/index.html", buildBord());
  fiches.forEach((f) => writeFile(`fiches/${f.id}/index.html`, buildFiche(f)));

  writeFile("mentions-legales/index.html", buildLegal("mentions-legales", "Mentions légales", require("./legal/mentions-legales.js")(site)));
  writeFile("confidentialite/index.html", buildLegal("confidentialite", "Politique de confidentialité", require("./legal/confidentialite.js")(site)));
  writeFile("cookies/index.html", buildLegal("cookies", "Politique cookies", require("./legal/cookies.js")(site)));

  // 404 page (GitHub Pages serves this automatically on unknown paths)
  writeFile(
    "404.html",
    page({
      title: "Page introuvable",
      path: "/404.html",
      active: null,
      content: `<section class="view"><div class="section-head"><h1>Page introuvable</h1><p>Ce lieu n'existe pas (encore). <a href="/" style="color:var(--accent);">Retour à l'accueil</a>.</p></div></section>`,
    })
  );

  // static assets
  copyDir(path.join(ROOT, "assets"), path.join(DIST, "assets"));

  // robots.txt + sitemap.xml
  writeFile("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${absUrl("/sitemap.xml")}\n`);
  const urls = ["/", "/carte/", "/classement/", "/contribuer/", "/itineraire/"].concat(fiches.map(ficheUrl));
  writeFile(
    "sitemap.xml",
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((u) => `  <url><loc>${esc(absUrl(u))}</loc></url>`)
      .join("\n")}\n</urlset>\n`
  );

  console.log(`Build OK — ${fiches.length} fiche(s), fichiers écrits dans ${DIST}`);
}

main();
