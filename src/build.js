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
  return `<span class="tag">${esc(regionLabel(regionKey))}</span>`;
}
function glyphSvg(themeKey) {
  const paths = THEME_ICONS[themeKey] || THEME_ICONS.patrimoine;
  const varName = (THEMES[themeKey] || {}).varName || "forest";
  return `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" style="stroke:var(--${varName})">${paths}</svg>`;
}
function statusBadge(status, size) {
  if (status === "verifie") {
    return `<span class="badge verified"><svg viewBox="0 0 24 24" stroke-width="2"><path d="M4 12.5 9 17l11-11"/></svg>${size === "full" ? "Vérifié par la rédaction" : "Vérifié"}</span>`;
  }
  return `<span class="badge draft"><svg viewBox="0 0 24 24" stroke-width="2"><path d="M12 8v5M12 16.2h.01"/><circle cx="12" cy="12" r="9"/></svg>${size === "full" ? "Brouillon — à vérifier" : "Brouillon"}</span>`;
}
function ficheUrl(f) {
  return `/fiches/${f.id}/`;
}
function absUrl(p) {
  return site.siteUrl.replace(/\/$/, "") + p;
}

/* ---------------- shared partials ---------------- */
function headHtml({ title, description, path: pagePath, ogImage, extraStyles }) {
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
<link rel="canonical" href="${esc(canonical)}">
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
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,500&family=Libre+Franklin:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,400&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/style.css">
${(extraStyles || []).map((s) => `<link rel="stylesheet" href="${s}">`).join("\n")}
${themeInlineScript()}
</head>`;
}

function topbarHtml() {
  return `<div class="topbar">
    <div class="brand-row">
      <a href="/"><img class="brand-logo" src="${esc(site.logoPath)}" alt="Logo ${esc(site.siteName)}"></a>
      <div class="brand">
        <a href="/" style="text-decoration:none;"><span class="name display">${esc(site.siteName)}</span></a>
        <span class="tagline">${esc(site.siteTagline)}</span>
        <a class="handle" href="${esc(site.instagramUrl)}" target="_blank" rel="noopener">${esc(site.instagramHandle)}</a>
      </div>
    </div>
    <button class="icon-btn" id="themeToggleBtn" title="Apparence" aria-label="Changer l'apparence" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="1.6"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.4M12 19.1v2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7"/></svg>
    </button>
  </div>
  <div class="status-banner" id="statusBanner" hidden>
    <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><path d="M12 9v4M12 16.5h.01M10.3 3.9 2.7 17.3a1.8 1.8 0 0 0 1.56 2.7h15.5a1.8 1.8 0 0 0 1.56-2.7L13.7 3.9a1.8 1.8 0 0 0-3.4 0Z"/></svg>
    <span id="statusBannerText">Les votes, commentaires et suggestions sont temporairement suspendus.</span>
  </div>`;
}

function tabbarHtml(active) {
  const items = [
    ["/", "home", "Accueil", '<path d="M4 4.8c2-.7 5-1 8 0v14.4c-3-1-6-.7-8 0V4.8ZM20 4.8c-2-.7-5-1-8 0v14.4c3-1 6-.7 8 0V4.8Z"/>'],
    ["/carte/", "carte", "Carte", '<path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2Z"/><path d="M9 4v14M15 6v14"/>'],
    ["/classement/", "classement", "Classement", '<path d="M8 20V10M13 20V4M18 20v-7"/><path d="M4 20h16"/>'],
    ["/contribuer/", "contribuer", "Contribuer", '<path d="M4 20.5 4.9 17 16 5.9a1.7 1.7 0 0 1 2.4 0l.7.7a1.7 1.7 0 0 1 0 2.4L8 20l-4 .5Z"/>'],
    ["/bord/", "bord", "Bord", '<circle cx="12" cy="12" r="8.5"/><path d="M12 12 15.5 8.5M12 7v1.2M17 12h-1.2M12 17v-1.2M7 12h1.2"/>'],
  ];
  return `<nav class="tabbar">
    ${items
      .map(
        ([href, key, label, svg]) =>
          `<a class="tab-btn${active === key ? " active" : ""}" href="${href}">
        <svg viewBox="0 0 24 24" fill="none">${svg}</svg>
        <span>${label}</span>
      </a>`
      )
      .join("\n    ")}
  </nav>`;
}

function footerHtml() {
  const year = new Date().getFullYear();
  return `<footer class="site-footer">
    <div class="legal-links">
      <a href="/mentions-legales/">Mentions légales</a>
      <a href="/confidentialite/">Confidentialité</a>
      <a href="/cookies/">Cookies</a>
    </div>
    <div class="copyright">© ${year} ${esc(site.siteName)} — contenu et photos ${esc(site.instagramHandle)}</div>
  </footer>`;
}

function cookieBannerHtml() {
  return `<div class="cookie-banner" id="cookieBanner" hidden>
    <div class="cookie-banner-inner">
      <p>Ce site utilise des cookies de mesure d'audience (Google Analytics) pour comprendre comment le magazine est lu. Vous pouvez accepter ou refuser — voir notre <a href="/cookies/">politique cookies</a>.</p>
      <div class="cookie-actions">
        <button class="btn-primary" id="cookieAccept" type="button">Accepter</button>
        <button class="btn-secondary" id="cookieRefuse" type="button">Refuser</button>
      </div>
    </div>
  </div>`;
}

function newsletterHtml() {
  return `<div class="newsletter-block">
    <h2>Ne rate aucun nouveau lieu</h2>
    <p>Un email quand une nouvelle fiche est publiée. Pas de spam, désinscription en un clic.</p>
    <form class="newsletter-form" id="newsletterForm">
      <input type="email" id="newsletterEmail" placeholder="ton@email.fr" required autocomplete="email">
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

function ficheCardHtml(f, opts) {
  opts = opts || {};
  const tags = f.themes.map(themeTag).join("") + (f.region !== "a_confirmer" ? regionTag(f.region) : "");
  const rankNum = opts.rank ? `<span class="rank-num">${opts.rank}</span>` : "";
  const votesHtml = `<span class="card-votes" data-vote-count="${f.id}"><svg viewBox="0 0 24 24"><path d="M12 20.5s-7.8-4.7-10.2-9.4C.4 8 1.7 4.7 4.9 3.7c2-.6 4 .1 5.3 1.8.4.5 1 .5 1.4 0 1.3-1.7 3.3-2.4 5.3-1.8 3.2 1 4.5 4.3 3.1 7.4-2.4 4.7-10.2 9.4-10.2 9.4Z"/></svg><span class="vote-num">0</span></span>`;
  const glyphInner = f.image ? `<img src="${esc(f.image)}" alt="">` : glyphSvg(f.themes[0]);
  return `<a class="fiche-card" href="${ficheUrl(f)}" data-themes="${f.themes.join(",")}" data-region="${f.region}" data-country="${esc(countryOfRegion(f.region))}" data-sub="${esc(f.subcategory || "")}">
    ${rankNum}
    <div class="card-glyph theme-${f.themes[0]}">${glyphInner}</div>
    <div class="card-body">
      <div style="margin-bottom:3px;">${statusBadge(f.status)}</div>
      <h3>${esc(f.title)}</h3>
      <div class="card-tags">${tags}</div>
    </div>
    ${votesHtml}
  </a>`;
}

function magCoverHtml(f) {
  const tags = f.themes.map(themeTag).join("") + (f.region !== "a_confirmer" ? regionTag(f.region) : "");
  const iconHtml = f.image ? "" : `<div class="mag-cover-icon">${glyphSvg(f.themes[0])}</div>`;
  const bg = f.image ? ` style="background-image:url('${esc(f.image)}')"` : "";
  return `<a class="mag-cover${f.image ? "" : " no-photo"}" href="${ficheUrl(f)}"${bg}>
    ${iconHtml}
    <div class="mag-cover-top">
      ${statusBadge(f.status)}
      <span class="mag-cover-votes" data-vote-count="${f.id}"><svg viewBox="0 0 24 24"><path d="M12 20.5s-7.8-4.7-10.2-9.4C.4 8 1.7 4.7 4.9 3.7c2-.6 4 .1 5.3 1.8.4.5 1 .5 1.4 0 1.3-1.7 3.3-2.4 5.3-1.8 3.2 1 4.5 4.3 3.1 7.4-2.4 4.7-10.2 9.4-10.2 9.4Z"/></svg><span class="vote-num">0</span></span>
    </div>
    <div class="mag-cover-bottom">
      <div class="mag-cover-eyebrow">${tags}</div>
      <h2>${esc(f.title)}</h2>
      <p class="mag-cover-summary">${esc(f.summary)}</p>
    </div>
  </a>`;
}

/* ---------------- page shell ---------------- */
function page({ title, description, path: pagePath, ogImage, active, bodyClass, content, extraScripts, extraStyles, noIndex }) {
  return `${headHtml({ title, description, path: pagePath, ogImage, extraStyles })}
<body${bodyClass ? ` class="${bodyClass}"` : ""}>${noIndex ? "" : ""}
<div class="app" id="app">
  ${topbarHtml()}
  <div class="views">
    ${content}
  </div>
  ${tabbarHtml(active)}
</div>
${footerInApp() /* placeholder no-op kept for clarity */}
${cookieBannerHtml()}
${toastHtml()}
${scriptsHtml(extraScripts)}
</body>
</html>
`;
}
function footerInApp() {
  return ""; // footer is injected per-page inside .views where relevant (see buildX functions)
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
        country: countryOfRegion(f.region),
        url: ficheUrl(f),
      }))
  );
}

function regionChipsHtml(idAttr) {
  const regionKeys = Object.keys(REGIONS).filter((k) => k !== "a_confirmer");
  const chip = (key, label) => `<button type="button" class="chip${key === "tous" ? " active" : ""}" data-region="${esc(key)}">${esc(label)}</button>`;
  return `<div class="chip-row" id="${idAttr}">
    ${chip("tous", "Toutes les régions")}
    ${regionKeys.map((k) => chip(k, regionLabel(k))).join("\n    ")}
  </div>`;
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
  return `<div class="home-gallery" role="group" aria-label="Photos du magazine">${slides}</div>`;
}

function mapLegendHtml() {
  return `<div class="map-legend" id="mapLegend">
      ${Object.keys(THEMES)
        .map((k) => `<span><span class="dot" style="background:var(--${THEMES[k].varName})"></span>${esc(THEMES[k].label)}</span>`)
        .join("")}
    </div>`;
}

function buildHome() {
  const grid = fiches.map(magCoverHtml).join("\n");
  const content = `<section class="view home-view">
    <div class="home-hero">
      <img class="home-hero-logo" src="${esc(site.logoPath)}" alt="Logo ${esc(site.siteName)}">
      <h1 class="display home-hero-title">${esc(site.siteName)}</h1>
      <p class="home-hero-tag">${esc(site.siteTagline)}</p>
      <p class="home-hero-intro">Des lieux insolites et du patrimoine français, repérés sur le terrain, vérifiés par la rédaction avant d'être racontés.</p>
    </div>
    <div class="home-mission">
      <h2 class="home-mission-title">Notre mission</h2>
      <p>${esc(site.siteName)} aide à composer des vacances sur mesure autour de lieux insolites et du patrimoine français — art brut, curiosités, sites naturels, architecture religieuse, tout ce qui ne figure pas dans les guides habituels. Indiquez où vous comptez séjourner et jusqu'où vous êtes prêt·e à rouler chaque jour : on vous propose les lieux vérifiés à proximité, vous choisissez ceux qui vous font envie, et on en construit un séjour clé en main pour les visites — un peu de patrimoine, un peu d'insolite, un peu de tout — toujours relu par la rédaction avant d'être définitif.</p>
      <a class="btn-primary" href="/itineraire/" style="text-decoration:none;">Composer mon séjour</a>
    </div>
    <div class="home-steps">
      <div class="home-step">
        <div class="home-step-num">1</div>
        <div class="home-step-body">
          <h3>Indiquez votre point de départ</h3>
          <p>La ville ou le village où vous séjournez, et la distance que vous êtes prêt·e à parcourir chaque jour.</p>
        </div>
      </div>
      <div class="home-step">
        <div class="home-step-num">2</div>
        <div class="home-step-body">
          <h3>Choisissez vos lieux</h3>
          <p>On vous propose les lieux vérifiés autour, sur la carte ; vous cochez ceux qui vous intéressent, et la rédaction glisse ses propres coups de cœur du coin.</p>
        </div>
      </div>
      <div class="home-step">
        <div class="home-step-num">3</div>
        <div class="home-step-body">
          <h3>Recevez votre itinéraire</h3>
          <p>Un parcours jour par jour, temps de route compris, toujours relu par la rédaction avant d'être confirmé.</p>
        </div>
      </div>
    </div>
    ${homeGalleryHtml()}
    <div class="home-hero home-hero-menu">
      <nav class="home-menu" aria-label="Navigation principale">
        <a class="home-menu-item" href="/carte/">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="1.6"><path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2Z"/><path d="M9 4v14M15 6v14"/></svg>
          Carte
        </a>
        <a class="home-menu-item" href="/classement/">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="1.6"><path d="M8 20V10M13 20V4M18 20v-7"/><path d="M4 20h16"/></svg>
          Classement
        </a>
        <a class="home-menu-item" href="/itineraire/">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="1.6"><path d="M4 19 9 6l3 8 3-6 5 11"/></svg>
          Itinéraire
        </a>
        <a class="home-menu-item" href="/contribuer/">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="1.6"><path d="M4 20.5 4.9 17 16 5.9a1.7 1.7 0 0 1 2.4 0l.7.7a1.7 1.7 0 0 1 0 2.4L8 20l-4 .5Z"/></svg>
          Contribuer
        </a>
      </nav>
    </div>
    <div class="section-head">
      <h2>Explorez la carte</h2>
      <p>Filtrez par région, touchez un repère pour ouvrir la fiche du lieu.</p>
    </div>
    ${countryChipsHtml("mapCountryChips")}
    ${regionChipsHtml("mapRegionChips")}
    <div id="mapEl" class="real-map compact"></div>
    ${mapLegendHtml()}
    <div class="section-head">
      <h2>Le magazine</h2>
      <p>Les lieux insolites et le patrimoine français, en couverture.</p>
    </div>
    <div class="mag-grid">${grid}</div>
    <div class="itin-cta">
      <h2>Prêt·e à composer votre séjour ?</h2>
      <p>Indiquez où vous comptez séjourner et jusqu'où vous êtes prêt·e à rouler chaque jour : on s'occupe de vous proposer les lieux vérifiés autour, vous n'avez plus qu'à choisir.</p>
      <a class="btn-primary" href="/itineraire/" style="text-decoration:none;">Créer mon itinéraire</a>
    </div>
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
    description: `${site.siteTagline} — carnet de route et fiches vérifiées, par ${site.instagramHandle}.`,
    path: "/",
    active: "home",
    content,
    extraScripts: ["/assets/js/votes.js", "/assets/js/newsletter.js", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", "/assets/js/map.js"],
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
    ${regionChipsHtml("mapRegionChips")}
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
    extraScripts: ["/assets/js/votes.js", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", "/assets/js/map.js"],
    extraStyles: ["https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"],
  });
}

function buildClassement() {
  const themeChips = ["tous"].concat(Object.keys(THEMES));
  const regionChips = ["tous"].concat(Object.keys(REGIONS).filter((k) => k !== "a_confirmer"));
  const cards = fiches
    .filter((f) => f.status === "verifie")
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
    <div class="eyebrow" style="padding:2px 16px 0;">Région</div>
    <div class="chip-row" id="regionChips">
      ${regionChips.map((k) => `<button class="chip${k === "tous" ? " active" : ""}" data-region="${k}" type="button">${k === "tous" ? "Toutes" : esc(regionLabel(k))}</button>`).join("")}
    </div>
    <div class="rank-list" id="rankList">${cards}</div>
    ${footerHtml()}
  </section>`;
  return page({
    title: "Classement",
    description: "Les lieux les plus plébiscités, par thème et par région.",
    path: "/classement/",
    active: "classement",
    content,
    extraScripts: ["/assets/js/votes.js", "/assets/js/classement.js"],
  });
}

const CAR_ICON = '<svg viewBox="0 0 24 24"><path d="M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11"/><rect x="3" y="11" width="18" height="6" rx="2"/><circle cx="7.5" cy="17.5" r="1.4"/><circle cx="16.5" cy="17.5" r="1.4"/></svg>';
const CLOCK_ICON = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>';

// Mêmes distances/temps réels que l'export PDF (site/src/print/fiche-template.js) :
// calculés une seule fois au build, jamais tapés à la main.
function travelIconsHtml(coords, visitDurationMin) {
  const cfg = engine.DEFAULT_CFG;
  const cities = (coords ? site.referenceCities || [] : [])
    .map((c) => {
      const km = engine.haversineKm(coords, c.coords) * cfg.roadDetourFactor;
      const min = engine.travelMinutes(engine.haversineKm(coords, c.coords), cfg);
      return { label: c.label, km: Math.round(km), min: Math.round(min) };
    })
    .sort((a, b) => a.km - b.km)
    .slice(0, 3);
  const items = cities
    .map(
      (t) =>
        `<div class="item">${CAR_ICON}<span class="val">~${engine.formatDuration(t.min)}</span><span class="lbl">${esc(t.label)} · ${t.km} km</span></div>`
    )
    .join("");
  const visit = visitDurationMin
    ? `<div class="item">${CLOCK_ICON}<span class="val">~${engine.formatDuration(visitDurationMin)}</span><span class="lbl">Durée de visite</span></div>`
    : "";
  return items || visit ? `<div class="travel-icons">${items}${visit}</div>` : "";
}

function buildFiche(f) {
  const tags = f.themes.map(themeTag).join("") + (f.region !== "a_confirmer" ? regionTag(f.region) : "");
  const heroStyle = f.image ? ` style="background-image:url('${esc(f.image)}')"` : "";
  const heroIcon = f.image
    ? ""
    : `<svg viewBox="0 0 24 24" style="position:absolute;right:14px;top:14px;width:56px;height:56px;opacity:.5;fill:none;stroke-width:1.2;stroke:var(--${(THEMES[f.themes[0]] || {}).varName || "forest"})">${THEME_ICONS[f.themes[0]] || THEME_ICONS.patrimoine}</svg>`;
  const photoCredit = f.image && f.imageCredit ? `<span class="photo-credit">Photo ${esc(f.imageCredit)}</span>` : "";
  // Bandeau de thèmes tracé en surimpression sur la photo, façon couverture
  // de magazine (même device que le carnet imprimé) — le thème actif de la
  // fiche ressort en gras/blanc.
  const themestripHtml = `<div class="detail-themestrip">${Object.keys(THEMES)
    .map((k) => {
      const word = k.charAt(0).toUpperCase() + k.slice(1);
      return f.themes.includes(k) ? `<strong>${esc(word)}</strong>` : esc(word);
    })
    .join(" · ")} — Le Mag</div>`;
  const eyebrowLabel = (THEMES[f.themes[0]] || {}).label || site.siteName;
  const locationLine = f.region !== "a_confirmer" ? regionLabel(f.region) : "";
  const draftNote =
    f.status === "brouillon"
      ? `<div class="draft-note">Cette fiche n'est pas encore publiée officiellement : elle attend confirmation des faits par la rédaction (lieu, source, date).</div>`
      : "";
  const coordRow = f.coords
    ? `<a class="coord-link" href="https://www.openstreetmap.org/?mlat=${f.coords.lat}&amp;mlon=${f.coords.lon}#map=15/${f.coords.lat}/${f.coords.lon}" target="_blank" rel="noopener">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="1.7"><path d="M12 21s7-7.5 7-12a7 7 0 0 0-14 0c0 4.5 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/></svg>
        <span>Voir sur la carte<span class="coord-value">${f.coords.lat}, ${f.coords.lon}</span></span>
      </a>`
    : "";
  const practical = f.practical
    ? `<div class="block">
        <h2>Carnet pratique</h2>
        <div class="practical-grid">
          ${Object.entries(f.practical)
            .map(([k, v]) => `<div class="practical-item"><div class="practical-label">${esc(k)}</div><div class="practical-value">${esc(v)}</div></div>`)
            .join("")}
        </div>
      </div>`
    : "";
  // Citation mise en avant (optionnelle, par fiche) : coupe le texte en deux,
  // à la manière d'une "pull quote" de magazine. Renseignée via fiches.json → "highlight".
  const bodyParas = f.body || [];
  const bodyHtml =
    f.highlight && bodyParas.length > 1
      ? `<p>${esc(bodyParas[0])}</p><blockquote class="fiche-pullquote">${esc(f.highlight)}</blockquote>${bodyParas
          .slice(1)
          .map((p) => `<p>${esc(p)}</p>`)
          .join("")}`
      : bodyParas.map((p) => `<p>${esc(p)}</p>`).join("");
  // Gabarits de galerie — même moteur que l'export PDF (src/print/gabarits.js) :
  // l'ordre des photos dans la fiche pilote leur emplacement, pour une vraie
  // variété de tailles au lieu d'un simple empilement de photos identiques.
  const gab = gabarits.assignGallery(f.gallery, gabarits.FULL_SLOTS);
  const fig = (photo, extraClass) => {
    if (!photo) return "";
    const { dataAttr, style } = focusAttrs(photo);
    return `<figure${dataAttr}><img src="${esc(photo.src)}" alt="${esc(photo.caption || "")}" loading="lazy"${style}>${
      photo.caption ? `<figcaption>${esc(photo.caption)}</figcaption>` : ""
    }</figure>`;
  };
  const galleryBlocks = [];
  if (gab.bandeau_duo) {
    galleryBlocks.push(`<div class="gallery-duo">${gab.bandeau_duo.map((p) => fig(p)).join("")}</div>`);
  }
  if (gab.grand_simple) galleryBlocks.push(`<div class="gallery-tall">${fig(gab.grand_simple[0])}</div>`);
  if (gab.grand_large) galleryBlocks.push(`<div class="gallery-wide">${fig(gab.grand_large[0])}</div>`);
  if (gab.insert_petit) galleryBlocks.push(`<div class="gallery-small">${fig(gab.insert_petit[0])}</div>`);
  if (gab.bande_detail) galleryBlocks.push(`<div class="gallery-wide">${fig(gab.bande_detail[0])}</div>`);
  (gab.trio || []).forEach((trio) => {
    galleryBlocks.push(
      `<div class="gallery-trio">${trio.map((p, i) => `<div class="t${i + 1}">${fig(p)}</div>`).join("")}</div>`
    );
  });
  const gallery = galleryBlocks.length ? `<div class="gallery-block">${galleryBlocks.join("")}</div>` : "";
  const verdictHtml = f.verdict
    ? `<div class="fiche-verdict">
        <div class="kicker">L'avis de la rédaction</div>
        <p>${esc(f.verdict)}</p>
        <div class="sig">— La rédaction de ${esc(site.siteName)}</div>
      </div>`
    : "";
  const sources = (f.sources || []).map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)} ↗</a></li>`).join("");

  const content = `<section class="view detail">
    <div class="detail-hero${f.image ? " has-photo" : ""}"${heroStyle}>
      <a class="detail-back" href="javascript:history.length>1?history.back():location.href='/'" aria-label="Retour">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><path d="M15 5 8 12l7 7"/></svg>
      </a>
      ${heroIcon}
      ${themestripHtml}
      <div class="detail-titlewrap">
        <span class="detail-eyebrow">${esc(eyebrowLabel)}</span>
        <h1>${esc(f.title)}</h1>
        ${locationLine ? `<div class="detail-location">${esc(locationLine)}</div>` : ""}
      </div>
      ${photoCredit}
    </div>
    <div class="detail-body">
      <div>${statusBadge(f.status, "full")}</div>
      <div class="detail-tags">${tags}</div>
      <p class="detail-summary">${esc(f.summary)}</p>
      <a class="account-credit" href="${esc(site.instagramUrl)}" target="_blank" rel="noopener">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1"/></svg>
        Un lieu du compte ${esc(site.instagramHandle)}
      </a>
      ${travelIconsHtml(f.coords, f.visitDurationMin)}
      ${draftNote}
      <div class="detail-text">${bodyHtml}</div>
      ${gallery}
      ${verdictHtml}
      ${coordRow}
      ${sources ? `<ul class="sources">${sources}</ul>` : ""}
    </div>
    ${practical}

    <div class="action-row">
      <button class="vote-btn" id="voteBtn" type="button" data-fiche="${f.id}">
        <svg viewBox="0 0 24 24"><path d="M12 20.5s-7.8-4.7-10.2-9.4C.4 8 1.7 4.7 4.9 3.7c2-.6 4 .1 5.3 1.8.4.5 1 .5 1.4 0 1.3-1.7 3.3-2.4 5.3-1.8 3.2 1 4.5 4.3 3.1 7.4-2.4 4.7-10.2 9.4-10.2 9.4Z"/></svg>
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

    <div class="block">
      <h2>Lectures recommandées</h2>
      <div class="reco-scroll" id="recoScroll"></div>
    </div>

    <div class="block">
      <h2>Commentaires</h2>
      <div id="commentList"></div>
      <div id="commentFormWrap"></div>
    </div>
    ${footerHtml()}
  </section>
  <script>
    window.__CURRENT_FICHE__ = ${JSON.stringify(f.id)};
    window.__ALL_FICHES__ = ${JSON.stringify(
      fiches.map((o) => ({ id: o.id, title: o.title, themes: o.themes, region: o.region, image: o.image, url: ficheUrl(o) }))
    )};
  </script>`;

  return page({
    title: f.title,
    description: f.summary,
    path: ficheUrl(f),
    ogImage: f.image,
    active: null,
    content,
    extraScripts: ["/assets/js/votes.js", "/assets/js/comments.js", "/assets/js/reco.js", "/assets/js/photo-focus.js"],
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
    description: "Proposez un lieu insolite ou patrimonial à ajouter au magazine.",
    path: "/contribuer/",
    active: "contribuer",
    content,
    extraScripts: ["/assets/js/suggest.js"],
  });
}

function buildItineraire() {
  const ITIN = site.itinerary;
  const verifiedForItin = fiches
    .filter((f) => f.status === "verifie" && f.coords)
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
      <p>Indiquez où vous comptez séjourner, on vous propose les lieux vérifiés du magazine autour — vous choisissez ceux qui vous intéressent, la rédaction relit avant que ce soit définitif.</p>
    </div>

    <form class="form-wrap" id="itinStep1">
      <div class="field">
        <label for="it-place">Où comptez-vous séjourner ? <span class="hint">(ville, village, adresse…)</span></label>
        <div class="autocomplete-wrap">
          <input id="it-place" type="text" autocomplete="off" placeholder="Ex. Bourges, Cher…" required>
          <div id="it-place-suggestions" class="autocomplete-list" hidden></div>
        </div>
      </div>
      <div class="field">
        <label for="it-radius">Distance que vous êtes prêt·e à parcourir par jour</label>
        <select id="it-radius">
          <option value="20">Jusqu'à 20 km</option>
          <option value="50" selected>Jusqu'à 50 km</option>
          <option value="100">Jusqu'à 100 km</option>
          <option value="150">Jusqu'à 150 km</option>
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
          <p>Des coups de cœur du magazine un peu plus loin, que vous n'avez pas vus dans les propositions ci-dessus — un clic pour les ajouter.</p>
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
  </script>`;

  return page({
    title: "Créer mon itinéraire",
    description: "Indiquez où vous séjournez : on vous propose les lieux vérifiés du magazine autour, vous choisissez, la rédaction relit avant confirmation.",
    path: "/itineraire/",
    active: null,
    content,
    extraScripts: [
      "/assets/js/itinerary-engine.js",
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
    .filter((f) => f.status === "verifie" && f.coords)
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
    brouillon: fiches.filter((f) => f.status !== "verifie").length,
  };
  const content = `<section class="view">
    <div class="section-head">
      <h1>Tableau de bord</h1>
      <p>Statistiques internes du magazine.</p>
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
        .filter((f) => f.status === "verifie" && f.coords)
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
    description: "Statistiques internes et modération du magazine.",
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
      content: `<section class="view"><div class="section-head"><h1>Page introuvable</h1><p>Ce lieu n'existe pas (encore). <a href="/" style="color:var(--forest);">Retour à l'accueil</a>.</p></div></section>`,
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
