"use strict";
/* ============================================================================
   OptiDesk — interface branchée sur l'API (FastAPI).
   Plus de base locale : toutes les données viennent du serveur et tous les calculs
   métier (couverture, totaux, statistiques) sont faits par l'API.
   app1.js : outils, client API, état, navigation, comptoir
   app2.js : vues (vente, clients, catalogue, règles, tableau de bord…)
   app3.js : fenêtres, connexion, événements
   ============================================================================ */
function showFatal(msg) {
  try {
    const t = document.createElement("div");
    t.style.cssText =
      "position:fixed;bottom:16px;left:16px;z-index:999;background:#C4574A;color:#fff;padding:12px 16px;border-radius:12px;font:13px Outfit,sans-serif;max-width:360px";
    t.textContent = "Erreur : " + msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 8000);
  } catch (_) {}
}
window.addEventListener("error", (e) => showFatal(e.message));
window.addEventListener("unhandledrejection", (e) => {
  const r = e.reason;
  if (r instanceof ApiError) return; // déjà présentée à l'utilisateur
  showFatal(r?.message || String(r));
});

const IC = {
  search:
    '<circle cx="11" cy="11" r="7" stroke-width="2.4"/><path d="m21 21-4.3-4.3" stroke-width="2.4"/>',
  box: '<path d="M12 3 3.5 7.5v9L12 21l8.5-4.5v-9Z" stroke-width="2"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" stroke-width="2"/>',
  bag: '<path d="M5 8h14l-1 12H6Z" stroke-width="2"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8" stroke-width="2"/>',
  plus: '<path d="M12 5v14M5 12h14" stroke-width="2.6"/>',
  minus: '<path d="M5 12h14" stroke-width="2.6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18" stroke-width="2.4"/>',
  check: '<path d="M4 12.5 9.5 18 20 6.5" stroke-width="2.6"/>',
  chevL: '<path d="M14.5 5 8 12l6.5 7" stroke-width="2.4"/>',
  chevR: '<path d="M9.5 5 16 12l-6.5 7" stroke-width="2.4"/>',
  alert:
    '<path d="M12 3 2.5 20h19Z" fill="currentColor" stroke="none"/><rect x="11" y="9" width="2" height="5" rx="1" fill="#fff" stroke="none"/><circle cx="12" cy="16.6" r="1.2" fill="#fff" stroke="none"/>',
  upload:
    '<path d="M12 16V4M7 9l5-5 5 5" stroke-width="2.2"/><path d="M4 20h16" stroke-width="2.2"/>',
  download:
    '<path d="M12 4v12M7 11l5 5 5-5" stroke-width="2.2"/><path d="M4 20h16" stroke-width="2.2"/>',
  trash: '<path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13" stroke-width="2.2"/>',
  edit: '<path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19Z" stroke-width="2.2"/>',
  camera:
    '<rect x="3" y="7" width="18" height="13" rx="3" stroke-width="2.2"/><circle cx="12" cy="13.5" r="3.5" stroke-width="2.2"/><path d="M9 7l1.5-2.5h3L15 7" stroke-width="2.2"/>',
  print:
    '<rect x="6" y="3" width="12" height="6" rx="1.5" stroke-width="2.2"/><rect x="4" y="9" width="16" height="7" rx="2" stroke-width="2.2"/><rect x="7" y="16" width="10" height="5" rx="1.5" stroke-width="2.2"/>',
};
const ico = (n, s = 16) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="width:${s}px;height:${s}px;flex-shrink:0">${IC[n] || ""}</svg>`;

/* ---------------------------------------------------------------------------
   Connexion au serveur
   --------------------------------------------------------------------------- */
// Où se trouve l'API ? Deux cas (détectés au démarrage par resolveApiBase) :
//  1. l'interface est servie par l'API elle-même (Lancer OptiDesk.bat, .exe, http://127.0.0.1:8765) -> même origine
//  2. l'interface est ouverte autrement (Live Server de VS Code, double-clic sur index.html...) -> API locale sur le port 8765
let API_BASE = "/api/v1";
const API_LOCAL = "http://127.0.0.1:8765/api/v1";
async function apiAnswers(base) {
  try {
    const r = await fetch(base + "/health", { cache: "no-store" });
    return r.ok && (await r.json()).status === "ok";
  } catch (_) {
    return false;
  }
}
async function resolveApiBase() {
  const candidates = location.protocol.startsWith("http") ? ["/api/v1", API_LOCAL] : [API_LOCAL];
  for (const base of candidates) {
    if (await apiAnswers(base)) {
      API_BASE = base;
      return true;
    }
  }
  API_BASE = API_LOCAL;
  return false;
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
const errMsg = (e) => (e instanceof ApiError ? e.message : "Action interrompue : " + (e?.message || e));

const tokens = { access: null, refresh: null };
let refreshing = null;

function refreshTokens() {
  if (!refreshing)
    refreshing = (async () => {
      try {
        const p = await api("/auth/refresh", {
          method: "POST",
          body: { refresh_token: tokens.refresh },
          auth: false,
        });
        tokens.access = p.access_token;
        tokens.refresh = p.refresh_token;
        return true;
      } catch (_) {
        return false;
      } finally {
        refreshing = null;
      }
    })();
  return refreshing;
}

async function api(path, { method = "GET", body, form, blob = false, auth = true, _retry = false } = {}) {
  const headers = {};
  if (auth && tokens.access) headers.Authorization = "Bearer " + tokens.access;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(API_BASE + path, { method, headers, body: payload });
  } catch (_) {
    throw new ApiError("Le serveur OptiDesk ne répond pas. Démarrez-le (Lancer OptiDesk.bat, ou « python run.py » dans le dossier api), puis réessayez.", 0);
  }
  if (res.status === 401 && auth && session.userId) {
    if (!_retry && tokens.refresh && (await refreshTokens()))
      return api(path, { method, body, form, blob, auth, _retry: true });
    resetToLogin("Votre session a expiré. Reconnectez-vous avec votre code PIN.");
    throw new ApiError("Votre session a expiré. Reconnectez-vous.", 401);
  }
  if (!res.ok) {
    let msg = `Une erreur est survenue (code ${res.status}).`;
    try {
      const j = await res.json();
      if (typeof j.detail === "string") msg = j.detail;
    } catch (_) {}
    throw new ApiError(msg, res.status);
  }
  if (res.status === 204) return null;
  return blob ? res.blob() : res.json();
}
const enc = encodeURIComponent;
const debounce = (fn, ms = 250) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};

/* ---------------------------------------------------------------------------
   État de l'interface (aucune donnée métier stockée ici, seulement des caches d'affichage)
   --------------------------------------------------------------------------- */
let USER = null; // utilisateur connecté (profil renvoyé par l'API)
let session = { userId: null, view: "comptoir" };
let cart = { client: null, lines: [] }; // lignes : { p: id|null, name, price, q }
let QUOTE = null; // dernière simulation du panier renvoyée par l'API
let comptoirSearch = "";
let carTimer = null;
const PCACHE = new Map(); // produits vus récemment (id -> produit)
const CCACHE = new Map(); // clients vus récemment (id -> client)
const rememberP = (list) => list.forEach((p) => PCACHE.set(p.id, p));
const rememberC = (list) => list.forEach((c) => CCACHE.set(c.id, c));

const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const fmt = (n) => Number(n).toLocaleString("fr-FR") + " FCFA";
/* Les horodatages de l'API sont en UTC (le Togo est à UTC+0) ; les dates seules sont des dates locales. */
function parseTs(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + "T00:00:00");
  return new Date(/(Z|[+-]\d\d:\d\d)$/.test(s) ? s : s + "Z");
}
const fmtD = (s, none = "aucun") =>
  s
    ? parseTs(s).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })
    : none;
const fmtDT = (s) =>
  parseTs(s).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) +
  " à " +
  parseTs(s).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const me = () => USER;
const isAdmin = () => USER?.role === "admin";
const cname = (c) => c.full_name;
const cInits = (c) => (c.last_name[0] || "") + (c.first_name[0] || "");
const avatarHTML = (c) => (c.photo ? `<img src="${c.photo}">` : esc(cInits(c)));
const prenom = (nm) =>
  String(nm || "")
    .trim()
    .split(/\s+/)
    .pop();
const nameInits = (nm) => {
  const p = String(nm || "")
    .trim()
    .split(/\s+/);
  return (p[0]?.[0] || "") + (p[1]?.[0] || "");
};
let lastToast = { msg: "", t: 0 };
function toast(msg, err = false) {
  if (msg === lastToast.msg && Date.now() - lastToast.t < 1500) return; // évite les doublons
  lastToast = { msg, t: Date.now() };
  const t = document.createElement("div");
  t.className = "toast" + (err ? " err" : "");
  t.innerHTML = ico(err ? "alert" : "check") + `<b>${esc(msg)}</b>`;
  $("#toasts").appendChild(t);
  setTimeout(() => {
    t.style.opacity = "0";
    t.style.transition = "opacity .4s";
    setTimeout(() => t.remove(), 400);
  }, 3200);
}

/* Étiquette de couverture : `cov` vient de l'API ({status, rate, alert}) */
function covTag(cov) {
  if (!cov) return "";
  if (cov.alert) return `<span class="tag warn">Couverture à vérifier</span>`;
  if (cov.status === "full") return `<span class="tag ok">Couvert 100%</span>`;
  if (cov.status === "partial") return `<span class="tag info">Couvert ${cov.rate}%</span>`;
  return `<span class="tag bad">Non couvert</span>`;
}
function stockTag(p) {
  return p.availability === "disponible"
    ? `<span class="tag ok">En stock · ${p.stock}</span>`
    : p.availability === "faible"
      ? `<span class="tag warn">Stock faible · ${p.stock}</span>`
      : `<span class="tag bad">Rupture</span>`;
}

/* ---------------------------------------------------------------------------
   Panier : les totaux et la couverture viennent de POST /sales/quote (jamais calculés ici)
   --------------------------------------------------------------------------- */
function addProduct(p, q) {
  const ex = cart.lines.find((l) => l.p === p.id);
  if (ex) ex.q += q;
  else cart.lines.push({ p: p.id, name: p.name, price: p.price, q });
}
function salePayload(lines, clientId, note, date) {
  const body = {
    lines: lines.map((l) =>
      l.p !== null
        ? { product_id: l.p, quantity: l.q }
        : { name: l.name, price: l.price, quantity: l.q },
    ),
  };
  if (clientId) body.client_id = clientId;
  if (note) body.note = note;
  if (date) body.date = date;
  return body;
}
async function refreshQuote() {
  QUOTE = null;
  if (!cart.lines.length) return;
  try {
    QUOTE = await api("/sales/quote", {
      method: "POST",
      body: salePayload(cart.lines, cart.client?.id),
    });
  } catch (e) {
    toast(e.message, true);
  }
}

/* ---------------------------------------------------------------------------
   Navigation
   --------------------------------------------------------------------------- */
const NAV = [
  { id: "comptoir", label: "Comptoir", roles: ["admin", "vendeur"] },
  { id: "vente", label: "Vente rapide", roles: ["admin", "vendeur"] },
  { id: "manuel", label: "Vente manuelle", roles: ["admin", "vendeur"] },
  { id: "clients", label: "Clients assurés", roles: ["admin", "vendeur"] },
  { id: "catalogue", label: "Catalogue & stock", roles: ["admin"] },
  { id: "regles", label: "Règles de couverture", roles: ["admin"] },
  { id: "dashboard", label: "Tableau de bord", roles: ["admin"] },
  { id: "journal", label: "Journal d'audit", roles: ["admin"] },
  { id: "parametres", label: "Paramètres", roles: ["admin", "vendeur"] },
];
function go(view) {
  session.view = view;
  if (view === "catalogue") catState = { q: "", limit: 50 };
  if (view === "journal") auditFilter = { user: "", days: "" };
  renderNav();
  return renderView();
}
function renderNav() {
  $("#nav").innerHTML = NAV.filter((n) => n.roles.includes(me()?.role))
    .map(
      (n) =>
        `<button class="${session.view === n.id ? "active" : ""}" data-nav="${n.id}">${n.label}</button>`,
    )
    .join("");
}
function stopCarousel() {
  if (carTimer) {
    clearInterval(carTimer);
    carTimer = null;
  }
}
let renderSeq = 0;
async function renderView({ keepScroll = false } = {}) {
  stopCarousel();
  const seq = ++renderSeq;
  const v = session.view;
  const R =
    {
      comptoir: vComptoir,
      vente: vVente,
      manuel: vManuel,
      clients: vClients,
      catalogue: vCatalogue,
      regles: vRegles,
      dashboard: vDashboard,
      journal: vJournal,
      parametres: vParametres,
    }[v] || vComptoir;
  let html;
  try {
    html = await R();
  } catch (err) {
    if (seq !== renderSeq) return;
    html = `<div class="card empty">${esc(errMsg(err))}<div style="margin-top:12px"><button class="btn btn-ghost sm" data-retry>Réessayer</button></div></div>`;
  }
  if (seq !== renderSeq) return; // une navigation plus récente a pris le relais
  const c = $("#content");
  const top = c.scrollTop;
  c.innerHTML = html;
  c.scrollTop = keepScroll ? top : 0;
  if (v === "comptoir") {
    const i = $("#prodSearch");
    if (i) i.value = comptoirSearch;
    if (!comptoirSearch) initCarousel();
  }
}

/* ---------------------------------------------------------------------------
   Comptoir
   --------------------------------------------------------------------------- */
const FOL_COLORS = ["#D8EDBE", "#DCEFE2", "#E7E3F5", "#F6E7D4", "#DDEBF3", "#F2E3E0"];
/* Illustration de la bannière du comptoir (PNG transparent). Vide = cadre d'emplacement. */
const BANNER_ILLUS = "banniere.png";

function noteCard(bg, color, num, lbl, val, tr) {
  return `<div class="note" style="background:${bg};color:${color}">
    <span class="num">${num}</span>
    <div class="lbl">${lbl}</div>
    <div class="val">${val}</div>
    <div class="trend">${tr}</div>
  </div>`;
}
function statCards(t) {
  const pct = t.sales_count ? Math.round((t.assured_count / t.sales_count) * 100) : 0;
  const trend =
    t.trend_percent !== null && t.trend_percent !== undefined
      ? ` · ${t.trend_percent >= 0 ? "+" : ""}${t.trend_percent}% vs hier`
      : "";
  return `<div class="notes-row">
    ${noteCard("#2F5D46", "#FFFFFF", "01", "Chiffre d'affaires du jour", fmt(t.gross_total), `${t.sales_count} vente(s) enregistrée(s)${trend}`)}
    ${noteCard("#D8EDBE", "#26402F", "02", "Ventes assurées", fmt(t.assured_total), `${t.assured_count} vente(s) · ${pct}% du total`)}
    ${noteCard("#DCEFE2", "#26402F", "03", "Ventes simples", fmt(t.simple_total), `${t.simple_count} vente(s) au prix plein`)}
    ${noteCard("#F6E7D4", "#5C4A1E", "04", "Clients servis", t.clients_served, "clients assurés identifiés aujourd'hui")}
  </div>`;
}
function alternativesHTML(p) {
  if (!p.alternatives?.length) return "";
  return `<div style="background:var(--side);border-radius:10px;padding:9px 11px">
    <div class="mini" style="font-weight:600;color:var(--deep)">Alternatives disponibles</div>
    ${p.alternatives.map((a) => `<div style="display:flex;justify-content:space-between;font-size:12px;margin-top:3px"><span>${esc(a.name)}</span><b>${fmt(a.price)}</b></div>`).join("")}</div>`;
}
function expiryLine(p) {
  const d = p.days_to_expiry;
  return d < 0
    ? `périmé depuis ${-d} jour(s) · ${fmtD(p.expiry)}`
    : `${d} jour(s) restant(s) · ${fmtD(p.expiry)}`;
}

/* Corps du comptoir : résultats de recherche OU (péremptions + clients fréquents + chiffres du jour) */
async function comptoirBody(today) {
  const q = comptoirSearch.trim();
  if (q) {
    const r = await api(`/products?q=${enc(q)}&limit=24&with_alternatives=true`);
    rememberP(r.items);
    if (!r.items.length)
      return `<div class="card empty">Aucun produit ne correspond à « ${esc(comptoirSearch)} ». Vérifiez l'orthographe, ou créez-le dans le catalogue.</div>`;
    return `<div class="prod-grid" style="margin-top:16px">${r.items
      .map(
        (p) => `<div class="prod-card">
        <div><div class="nm">${esc(p.name)}</div><div class="dci">${esc(p.dci || "·")} · ${esc(p.category)}</div></div>
        <div class="row"><span class="price">${fmt(p.price)}</span>${stockTag(p)}</div>
        ${alternativesHTML(p)}
        <button class="btn btn-primary sm" data-addcart="${p.id}" style="margin-top:auto">${ico("plus", 13)} Ajouter au panier</button>
      </div>`,
      )
      .join("")}</div>${r.total > r.items.length ? `<p class="mini" style="margin-top:12px">${r.total} résultats : affichage limité aux ${r.items.length} premiers. Précisez votre recherche.</p>` : ""}`;
  }
  const [exp, freq, t] = await Promise.all([
    api("/products/expiring"),
    api("/clients/frequent"),
    today ? Promise.resolve(today) : api("/sales/summary/today"),
  ]);
  rememberC(freq);
  const items = exp.items;
  return `
    ${
      items.length
        ? `<div class="card-lemon" style="margin-top:22px;padding:16px 20px;border-radius:16px">
      <div style="display:flex;align-items:center;gap:10px"><span style="color:var(--amber)">${ico("alert", 17)}</span><b style="font-size:14px">Péremption proche : ${items.length} produit(s)</b>
      <span class="mini" style="color:#3B5546;margin-left:auto">Retour fournisseur possible sous ${exp.return_window_days} jours</span></div>
      <div style="margin-top:10px;display:flex;flex-direction:column;gap:5px">
        ${items
          .slice(0, 3)
          .map(
            (p) =>
              `<div style="display:flex;justify-content:space-between;font-size:13px"><span>${esc(p.name)}</span><b>${expiryLine(p)}</b></div>`,
          )
          .join("")}
        ${items.length > 3 ? `<div class="mini" style="color:#3B5546">et ${items.length - 3} autre(s), voir le catalogue.</div>` : ""}
      </div>
    </div>`
        : ""
    }
    <div class="fol-head">
      <h2>Clients fréquents</h2>
      <div class="fol-arrows">
        <button data-fol="-1" title="Précédent">${ico("chevL")}</button>
        <button data-fol="1" title="Suivant">${ico("chevR")}</button>
      </div>
    </div>
    <div class="fol-track" id="folTrack">
      ${freq
        .map(
          (c, i) => `
      <button class="folder" data-freq="${c.id}" style="--fc:${FOL_COLORS[i % FOL_COLORS.length]}">
        <div class="tab"></div>
        <div class="fbody">
          <span class="fchip">${esc(c.insurer)}</span>
          <div class="fname">${esc(cname(c))}</div>
          <div class="fmeta">${c.usual_cart_count} produit(s) habituel(s)</div>
          <div class="fmeta2">Dernier achat : ${fmtD(c.last_purchase)}</div>
        </div>
      </button>`,
        )
        .join("")}
    </div>
    ${statCards(t)}`;
}

async function vComptoir() {
  const u = me();
  const [fresh, today] = await Promise.all([api("/stock/freshness"), api("/sales/summary/today")]);
  const body = await comptoirBody(today);
  const sd = fresh.last_import ? parseTs(fresh.last_import) : null;
  const stockSmall = sd
    ? `${sd.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })} · ${sd.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
    : "aucun import pour l'instant";
  return `<div class="view-anim">
    <div class="banner">
      <div class="banner-deco"><span class="bd-circle"></span><span class="bd-dot"></span></div>
      <div class="banner-body">
        <div class="ov">Pharmacie Adjololo · Lomé</div>
        <h2>Bienvenue au comptoir, ${esc(prenom(u.name))}</h2>
        <p>${new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
        <button class="btn banner-cta" data-gov="vente">${ico("plus", 15)} Commencer une vente</button>
        <div class="banner-stats">
          <div class="bstat">
            <span class="bs-ic">${ico("box", 20)}</span>
            <div><b>${fresh.stale ? "Stock à réimporter" : "Stock à jour"}</b><small>${stockSmall}</small></div>
          </div>
          <div class="bstat">
            <span class="bs-ic alt">${ico("bag", 20)}</span>
            <div><b>Ventes du jour</b><small>${today.sales_count} enregistrée(s)</small></div>
          </div>
        </div>
      </div>
      <svg class="banner-wave" viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden="true"><path d="M0,0V74C15.0,79.3,55.0,99.0,90,106C125.0,113.0,170.0,116.7,210,116C250.0,115.3,290.0,109.7,330,102C370.0,94.3,411.7,77.0,450,70C488.3,63.0,521.7,56.7,560,60C598.3,63.3,640.0,80.7,680,90C720.0,99.3,763.3,112.7,800,116C836.7,119.3,865.0,116.0,900,110C935.0,104.0,975.0,88.7,1010,80C1045.0,71.3,1078.3,57.0,1110,58C1141.7,59.0,1185.0,81.3,1200,86V0Z" opacity=".25"/><path d="M0,0V52C13.3,58.3,48.3,80.0,80,90C111.7,100.0,153.3,111.3,190,112C226.7,112.7,265.0,103.0,300,94C335.0,85.0,366.7,66.3,400,58C433.3,49.7,465.0,41.0,500,44C535.0,47.0,573.3,64.7,610,76C646.7,87.3,685.0,108.7,720,112C755.0,115.3,785.0,104.7,820,96C855.0,87.3,893.3,69.0,930,60C966.7,51.0,1006.7,40.0,1040,42C1073.3,44.0,1103.3,62.7,1130,72C1156.7,81.3,1188.3,93.7,1200,98V0Z" opacity=".5"/><path d="M0,0V30C16.7,36.0,65.0,55.3,100,66C135.0,76.7,173.3,94.3,210,94C246.7,93.7,283.3,75.3,320,64C356.7,52.7,393.3,35.0,430,26C466.7,17.0,503.3,7.0,540,10C576.7,13.0,613.3,31.0,650,44C686.7,57.0,725.0,84.3,760,88C795.0,91.7,826.7,76.0,860,66C893.3,56.0,925.0,37.7,960,28C995.0,18.3,1036.7,5.3,1070,8C1103.3,10.7,1138.3,34.0,1160,44C1181.7,54.0,1193.3,64.0,1200,68V0Z"/></svg>
      <div class="banner-illus${BANNER_ILLUS ? " has-img" : ""}">${BANNER_ILLUS ? `<img src="${esc(BANNER_ILLUS)}" alt="">` : "Emplacement<br>illustration"}</div>
    </div>
    <div class="hero-search" style="margin-top:20px">${ico("search", 19)}<input id="prodSearch" placeholder="Chercher un médicament (nom, DCI ou code)" autocomplete="off"></div>
    <div id="compBody">${body}</div>
  </div>`;
}
/* Recherche du comptoir : on ne remplace que le corps, la zone de saisie garde son focus */
let compSeq = 0;
const refreshComptoirBody = debounce(async () => {
  const seq = ++compSeq;
  try {
    const html = await comptoirBody();
    const box = $("#compBody");
    if (seq !== compSeq || !box || session.view !== "comptoir") return;
    box.innerHTML = html;
    stopCarousel();
    if (!comptoirSearch.trim()) initCarousel();
  } catch (e) {
    toast(errMsg(e), true);
  }
}, 220);

function initCarousel() {
  const el = $("#folTrack");
  if (!el) return;
  stopCarousel();
  carTimer = setInterval(() => {
    if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 10)
      el.scrollTo({ left: 0, behavior: "smooth" });
    else el.scrollBy({ left: 224, behavior: "smooth" });
  }, 4200);
  el.onmouseenter = stopCarousel;
  el.onmouseleave = initCarousel;
}
function scrollFol(dir) {
  const el = $("#folTrack");
  if (!el) return;
  if (dir > 0 && el.scrollLeft + el.clientWidth >= el.scrollWidth - 10)
    el.scrollTo({ left: 0, behavior: "smooth" });
  else el.scrollBy({ left: dir * 224, behavior: "smooth" });
}
window.__od1 = true;
