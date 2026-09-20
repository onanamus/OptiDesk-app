"use strict";
/* ============================================================================
   OptiDesk — interface branchée sur l'API (FastAPI).
   Aucune donnée métier n'est calculée ici : couverture, totaux, alternatives,
   statistiques et péremptions viennent toutes de l'API.
   app1.js : outils, client API, état, navigation, page Comptoir
   app2.js : assistant de vente et pages de gestion
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

/* ---------------------------------------------------------------------------
   Icônes (trait unique, même langage graphique que la sidebar)
   --------------------------------------------------------------------------- */
const IC = {
  search:
    '<circle cx="11" cy="11" r="7" stroke-width="2.4"/><path d="m21 21-4.3-4.3" stroke-width="2.4"/>',
  home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1Z" stroke-width="2"/>',
  cart: '<path d="M3 4h2.2l2.3 11.2a1.5 1.5 0 0 0 1.5 1.2h8.3a1.5 1.5 0 0 0 1.5-1.2L20.5 8H6" stroke-width="2"/><circle cx="10" cy="20" r="1.5" fill="currentColor" stroke="none"/><circle cx="17.5" cy="20" r="1.5" fill="currentColor" stroke="none"/>',
  users:
    '<circle cx="9" cy="8.5" r="3.5" stroke-width="2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" stroke-width="2"/><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M17.5 14.8c2 .7 3.5 2.6 3.5 5.2" stroke-width="2"/>',
  box: '<path d="M12 3 3.5 7.5v9L12 21l8.5-4.5v-9Z" stroke-width="2"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" stroke-width="2"/>',
  shield:
    '<path d="M12 3.5 5 6v6c0 4.2 2.9 7.4 7 8.5 4.1-1.1 7-4.3 7-8.5V6Z" stroke-width="2"/><path d="m9 12 2.2 2.2L15.5 10" stroke-width="2.2"/>',
  chart:
    '<path d="M4 20h16" stroke-width="2.2"/><rect x="6" y="11" width="3.4" height="6" rx="1" stroke-width="2"/><rect x="12" y="7" width="3.4" height="10" rx="1" stroke-width="2"/>',
  clock:
    '<circle cx="12" cy="12" r="8.5" stroke-width="2"/><path d="M12 7.5V12l3 1.8" stroke-width="2.2"/>',
  gear: '<circle cx="12" cy="12" r="3.2" stroke-width="2"/><path d="M12 3.2v2M12 19v2M4.6 7.8l1.7 1M17.7 15.2l1.7 1M4.6 16.2l1.7-1M17.7 8.8l1.7-1" stroke-width="2"/>',
  bag: '<path d="M5 8h14l-1 12H6Z" stroke-width="2"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8" stroke-width="2"/>',
  user: '<circle cx="12" cy="8.5" r="3.6" stroke-width="2"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" stroke-width="2"/>',
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
  file: '<path d="M6 3h7l5 5v13H6Z" stroke-width="2"/><path d="M13 3v5h5" stroke-width="2"/>',
  pill: '<rect x="3.2" y="8.4" width="17.6" height="7.2" rx="3.6" transform="rotate(-45 12 12)" stroke-width="2"/><path d="M9 9l6 6" stroke-width="2"/>',
  empty:
    '<circle cx="12" cy="12" r="8.5" stroke-width="2"/><path d="M8.5 13.5h7" stroke-width="2.2"/>',
};
const ico = (n, s = 16) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="width:${s}px;height:${s}px;flex-shrink:0">${IC[n] || ""}</svg>`;

/* ---------------------------------------------------------------------------
   Connexion au serveur
   --------------------------------------------------------------------------- */
// Où se trouve l'API ? Deux cas (détectés au démarrage par resolveApiBase) :
//  1. l'interface est servie par l'API elle-même (Lancer OptiDesk.bat, .exe) -> même origine
//  2. l'interface est ouverte autrement (Live Server, double-clic) -> API locale sur le port 8765
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
  const candidates = location.protocol.startsWith("http")
    ? ["/api/v1", API_LOCAL]
    : [API_LOCAL];
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
const errMsg = (e) =>
  e instanceof ApiError
    ? e.message
    : "Action interrompue : " + (e?.message || e);

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

async function api(
  path,
  {
    method = "GET",
    body,
    form,
    blob = false,
    auth = true,
    _retry = false,
  } = {},
) {
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
    throw new ApiError(
      "Le serveur OptiDesk ne répond pas. Démarrez-le (Lancer OptiDesk.bat, ou « python run.py » dans le dossier api), puis réessayez.",
      0,
    );
  }
  if (res.status === 401 && auth && session.userId) {
    if (!_retry && tokens.refresh && (await refreshTokens()))
      return api(path, { method, body, form, blob, auth, _retry: true });
    resetToLogin(
      "Votre session a expiré. Reconnectez-vous avec votre code PIN.",
    );
    throw new ApiError("Votre session a expiré. Reconnectez-vous.", 401);
  }
  if (!res.ok) {
    let msg = `L'action n'a pas abouti (code ${res.status}). Réessayez dans un instant.`;
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
   État de l'interface (caches d'affichage uniquement)
   --------------------------------------------------------------------------- */
let USER = null; // utilisateur connecté (profil renvoyé par l'API)
let session = { userId: null, view: "comptoir" };
let QUOTE = null; // dernière simulation du panier renvoyée par l'API
let comptoirSearch = "";
const PCACHE = new Map(); // produits vus récemment (id -> produit)
const CCACHE = new Map(); // clients vus récemment (id -> client)
const rememberP = (list) => list.forEach((p) => PCACHE.set(p.id, p));
const rememberC = (list) => list.forEach((c) => CCACHE.set(c.id, c));

/* La vente en cours : un formulaire à étapes, pas un panier flottant.
   step 1 type · 2 client (vente assurée) · 3 produits · 4 vérification · 5 vente enregistrée */
const todayISO = () => new Date().toISOString().slice(0, 10);
function emptySale() {
  return {
    step: 1,
    type: null,
    client: null,
    lines: [],
    note: "",
    date: todayISO(),
    slip: null,
  };
}
let sale = emptySale();
const saleStarted = () => sale.type !== null;
const cartCount = () => sale.lines.reduce((n, l) => n + l.q, 0);

const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (n) => Number(n).toLocaleString("fr-FR") + " FCFA";
/* Les horodatages de l'API sont en UTC (le Togo est à UTC+0) ; les dates seules sont locales. */
function parseTs(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + "T00:00:00");
  return new Date(/(Z|[+-]\d\d:\d\d)$/.test(s) ? s : s + "Z");
}
const fmtD = (s, none = "aucun") =>
  s
    ? parseTs(s).toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : none;
const fmtDT = (s) =>
  parseTs(s).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) +
  " à " +
  parseTs(s).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
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

/* Statuts : un mot + un symbole, jamais la couleur seule */
function covTag(cov) {
  if (!cov) return "";
  if (cov.alert)
    return `<span class="status warn">Couverture à vérifier</span>`;
  if (cov.status === "full")
    return `<span class="status ok">Couvert à 100 %</span>`;
  if (cov.status === "partial")
    return `<span class="status part">Couvert à ${cov.rate} %</span>`;
  return `<span class="status bad">Non couvert</span>`;
}
function stockTag(p) {
  return p.availability === "disponible"
    ? `<span class="status ok">En stock · ${p.stock}</span>`
    : p.availability === "faible"
      ? `<span class="status warn">Stock faible · ${p.stock}</span>`
      : `<span class="status bad">Rupture</span>`;
}
function emptyState(icon, title, text, actionHTML = "") {
  return `<div class="empty-state"><div class="ic">${ico(icon, 24)}</div>
    <b>${esc(title)}</b><p>${esc(text)}</p>${actionHTML}</div>`;
}
const skeleton = (rows = 3) =>
  `<div>${'<div class="skel row"></div>'.repeat(rows)}</div>`;

/* ---------------------------------------------------------------------------
   Vente en cours : les totaux viennent de POST /sales/quote, jamais d'ici
   --------------------------------------------------------------------------- */
function addProduct(p, q = 1) {
  const ex = sale.lines.find((l) => l.p === p.id);
  if (ex) ex.q += q;
  else sale.lines.push({ p: p.id, name: p.name, price: p.price, q });
}
function addFreeLine(name, price, q) {
  sale.lines.push({ p: null, name, price, q });
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
  if (date && date !== todayISO()) body.date = date;
  return body;
}
async function refreshQuote() {
  QUOTE = null;
  if (!sale.lines.length) return;
  try {
    QUOTE = await api("/sales/quote", {
      method: "POST",
      body: salePayload(sale.lines, sale.client?.id),
    });
  } catch (e) {
    toast(errMsg(e), true);
  }
}
/* Démarre (ou reprend) une vente depuis n'importe quel écran */
function startSale({
  type = "simple",
  client = null,
  lines = null,
  step = null,
} = {}) {
  sale = emptySale();
  sale.type = type;
  sale.client = client;
  if (lines) sale.lines = lines;
  sale.step = step || (type === "assuree" && !client ? 2 : 3);
  QUOTE = null;
  return go("vente");
}
function resetSale() {
  sale = emptySale();
  QUOTE = null;
}

/* ---------------------------------------------------------------------------
   Navigation : trois familles, vocabulaire métier
   --------------------------------------------------------------------------- */
const ALL = ["admin", "vendeur"];
const NAV = [
  {
    group: "Principal",
    items: [
      { id: "comptoir", label: "Comptoir", icon: "home", roles: ALL },
      { id: "vente", label: "Ventes", icon: "cart", roles: ALL },
      { id: "clients", label: "Clients", icon: "users", roles: ALL },
    ],
  },
  {
    group: "Gestion",
    items: [
      {
        id: "catalogue",
        label: "Catalogue & stock",
        icon: "box",
        roles: ["admin"],
      },
      { id: "regles", label: "Couverture", icon: "shield", roles: ["admin"] },
      {
        id: "dashboard",
        label: "Tableau de bord",
        icon: "chart",
        roles: ["admin"],
      },
    ],
  },
  {
    group: "Système",
    items: [
      {
        id: "journal",
        label: "Journal d'audit",
        icon: "clock",
        roles: ["admin"],
      },
      { id: "parametres", label: "Paramètres", icon: "gear", roles: ALL },
    ],
  },
];
const VIEW_OF = {};
NAV.forEach((g) => g.items.forEach((i) => (VIEW_OF[i.id] = i)));

function go(view) {
  const item = VIEW_OF[view];
  if (item && !item.roles.includes(me()?.role)) view = "comptoir";
  session.view = view;
  if (view === "catalogue") catState = { q: "", limit: 50 };
  if (view === "journal") auditFilter = { user: "", days: "" };
  renderNav();
  return renderView();
}
function renderNav() {
  const role = me()?.role;
  $("#nav").innerHTML = NAV.map((g) => {
    const items = g.items.filter((n) => n.roles.includes(role));
    if (!items.length) return "";
    return (
      `<div class="nav-group">${esc(g.group)}</div>` +
      items
        .map(
          (n) =>
            `<button class="${session.view === n.id ? "active" : ""}" data-nav="${n.id}">${ico(n.icon, 16)}<span>${esc(n.label)}</span></button>`,
        )
        .join("")
    );
  }).join("");
}

let renderSeq = 0;
async function renderView({ keepScroll = false } = {}) {
  const seq = ++renderSeq;
  const v = session.view;
  const R =
    {
      comptoir: vComptoir,
      vente: vVente,
      clients: vClients,
      catalogue: vCatalogue,
      regles: vRegles,
      dashboard: vDashboard,
      journal: vJournal,
      parametres: vParametres,
    }[v] || vComptoir;
  const c = $("#content");
  const top = c.scrollTop;
  let html;
  try {
    html = await R();
  } catch (err) {
    if (seq !== renderSeq) return;
    html = `<div class="section">${emptyState(
      "alert",
      "Cette page n'a pas pu être chargée",
      errMsg(err),
      `<button class="btn btn-ghost" data-retry>Réessayer</button>`,
    )}</div>`;
  }
  if (seq !== renderSeq) return; // une navigation plus récente a pris le relais
  c.innerHTML = html;
  c.scrollTop = keepScroll ? top : 0;
  if (v === "comptoir") {
    const i = $("#prodSearch");
    if (i) i.value = comptoirSearch;
  }
  if (typeof afterRender === "function") afterRender(v);
}

/* ---------------------------------------------------------------------------
   Comptoir : « j'ai un client devant moi »
   Bannière (identité) → recherche produit → clients fréquents → indicateurs
   --------------------------------------------------------------------------- */
const FOL_COLORS = [
  "#D8EDBE",
  "#DCEFE2",
  "#E7E3F5",
  "#F6E7D4",
  "#DDEBF3",
  "#F2E3E0",
];
/* Illustration de la bannière du comptoir (PNG transparent). Vide = cadre d'emplacement. */
const BANNER_ILLUS = "banniere.png";

function noteCard(bg, color, num, lbl, val, tr) {
  return `<div class="note" style="background:${bg};color:${color}">
    <span class="num">${num}</span><div class="lbl">${lbl}</div><div class="val">${val}</div><div class="trend">${tr}</div>
  </div>`;
}
function statCards(t) {
  const pct = t.sales_count
    ? Math.round((t.assured_count / t.sales_count) * 100)
    : 0;
  const trend =
    t.trend_percent !== null && t.trend_percent !== undefined
      ? ` · ${t.trend_percent >= 0 ? "+" : ""}${t.trend_percent} % par rapport à hier`
      : "";
  return `<div class="notes-row">
    ${noteCard("#2F5D46", "#FFFFFF", "01", "Ventes du jour", fmt(t.gross_total), `${t.sales_count} vente(s) enregistrée(s)${trend}`)}
    ${noteCard("#D8EDBE", "#26402F", "02", "Ventes assurées", fmt(t.assured_total), `${t.assured_count} vente(s) · ${pct} % du total`)}
    ${noteCard("#DCEFE2", "#26402F", "03", "Ventes simples", fmt(t.simple_total), `${t.simple_count} vente(s) au prix plein`)}
    ${noteCard("#F6E7D4", "#5C4A1E", "04", "Clients servis", t.clients_served, "clients assurés identifiés aujourd'hui")}
  </div>`;
}
function expiryLine(p) {
  const d = p.days_to_expiry;
  return d < 0
    ? `périmé depuis ${-d} jour(s) · ${fmtD(p.expiry)}`
    : `${d} jour(s) restant(s) · ${fmtD(p.expiry)}`;
}
function altBlock(p) {
  if (!p.alternatives?.length) return "";
  return `<div class="res-alt">
    <div class="hd">À la place de « ${esc(p.name)} », disponibles en rayon :</div>
    ${p.alternatives
      .map(
        (
          a,
        ) => `<div class="alt"><span>${esc(a.name)}</span><b>${fmt(a.price)}</b>
      <button class="btn btn-soft sm" data-addcart="${a.id}">Ajouter au panier</button></div>`,
      )
      .join("")}</div>`;
}
/* Une ligne de résultat produit : tout ce qu'il faut décider, sur une seule ligne */
function resultHTML(p) {
  const cov = p.coverage ? covTag(p.coverage) : "";
  return `<div class="res${p.availability === "rupture" ? " off" : ""}">
    <div class="who">
      <div class="nm">${esc(p.name)}</div>
      <div class="meta"><span class="tag">${esc(p.category)}</span>${p.dci ? `<span>${esc(p.dci)}</span>` : ""}<span>${esc(p.code)}</span></div>
    </div>
    ${stockTag(p)}${cov}
    <div class="prc">${fmt(p.price)}</div>
    <div class="cta">${
      p.availability === "rupture"
        ? `<button class="btn btn-ghost sm" data-addcart="${p.id}">Ajouter quand même</button>`
        : `<button class="btn btn-primary sm" data-addcart="${p.id}">${ico("plus", 13)} Ajouter au panier</button>`
    }</div>
  </div>${altBlock(p)}`;
}

/* Corps du comptoir : résultats de recherche OU (clients fréquents + alertes + chiffres) */
async function comptoirBody(today) {
  const q = comptoirSearch.trim();
  if (q) {
    const withClient = sale.client ? `&client_id=${sale.client.id}` : "";
    const r = await api(
      `/products?q=${enc(q)}&limit=24&with_alternatives=true${withClient}`,
    );
    rememberP(r.items);
    if (!r.items.length)
      return `<div class="section">${emptyState(
        "empty",
        "Aucun produit ne correspond à cette recherche",
        `Rien ne ressort pour « ${q} ». Vérifiez l'orthographe, cherchez par DCI, ou ajoutez le produit à la main pour ne pas bloquer la vente.`,
        `<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
           <button class="btn btn-primary" data-freeline>Ajouter un produit hors catalogue</button>
           ${isAdmin() ? `<button class="btn btn-ghost" data-newproduct>Créer ce produit au catalogue</button>` : ""}
         </div>`,
      )}</div>`;
    return `<div class="section">
      <div class="section-head"><h2>${r.total} résultat(s) pour « ${esc(q)} »</h2>
        <div class="right">${sale.client ? `<span class="mini">Couverture calculée pour ${esc(cname(sale.client))}</span>` : ""}
        <button class="btn btn-ghost sm" data-clearsearch>Effacer la recherche</button></div>
      </div>
      <div class="res-list">${r.items.map(resultHTML).join("")}</div>
      ${r.total > r.items.length ? `<p class="mini" style="margin-top:12px">Seuls les ${r.items.length} premiers résultats sont affichés : précisez votre recherche.</p>` : ""}
    </div>`;
  }

  const [exp, freq, t] = await Promise.all([
    api("/products/expiring"),
    api("/clients/frequent"),
    today ? Promise.resolve(today) : api("/sales/summary/today"),
  ]);
  rememberC(freq);
  const items = exp.items;
  return `
    <div class="section">
      <div class="section-head"><h2>Clients fréquents</h2>
        <span class="hint">Un clic reprend leur panier habituel</span>
        <div class="right">
          <div class="fol-arrows"><button data-fol="-1" title="Précédent">${ico("chevL")}</button><button data-fol="1" title="Suivant">${ico("chevR")}</button></div>
        </div>
      </div>
      ${
        freq.length
          ? `<div class="fol-track" id="folTrack">${freq
              .map(
                (c, i) => `
        <div class="folder" style="--fc:${FOL_COLORS[i % FOL_COLORS.length]}">
          <div class="tab"></div>
          <div class="fbody">
            <span class="fchip">${esc(c.insurer)}</span>
            <div class="fname">${esc(cname(c))}</div>
            <div class="fmeta">${c.usual_cart_count} produit(s) habituel(s)</div>
            <div class="fmeta2">Dernier achat : ${fmtD(c.last_purchase)}</div>
            <button class="fgo" data-sell="${c.id}">Nouvelle vente assurée</button>
            <button class="mini" style="text-align:center" data-freq="${c.id}">Voir sa fiche</button>
          </div>
        </div>`,
              )
              .join("")}</div>`
          : emptyState(
              "users",
              "Aucun client fréquent pour l'instant",
              "Les clients assurés apparaissent ici dès leur deuxième vente enregistrée dans OptiDesk.",
              `<button class="btn btn-primary" data-newclient>Ajouter un client assuré</button>`,
            )
      }
    </div>
    ${
      items.length
        ? `<div class="section">
      <div class="notice warn">${ico("alert", 17)}
        <div><b>${items.length} produit(s) approchent de leur péremption</b>
        <div class="mini" style="color:inherit;opacity:.85">${items
          .slice(0, 3)
          .map((p) => `${esc(p.name)} — ${expiryLine(p)}`)
          .join(
            " · ",
          )}${items.length > 3 ? ` · et ${items.length - 3} autre(s)` : ""}</div></div>
        <div class="right"><span class="mini" style="color:inherit">Retour fournisseur possible sous ${exp.return_window_days} jours</span>
        ${isAdmin() ? `<button class="btn btn-ghost sm" data-nav="catalogue">Voir le catalogue</button>` : ""}</div>
      </div>
    </div>`
        : ""
    }
    <div class="section">
      <div class="section-head"><h2>Aujourd'hui en un coup d'œil</h2></div>
      ${statCards(t)}
    </div>`;
}

async function vComptoir() {
  const u = me();
  const [fresh, today] = await Promise.all([
    api("/stock/freshness"),
    api("/sales/summary/today"),
  ]);
  const body = await comptoirBody(today);
  const sd = fresh.last_import ? parseTs(fresh.last_import) : null;
  const stockSmall = sd
    ? `${sd.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })} · ${sd.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
    : "aucun import pour l'instant";
  const enCours = saleStarted() && sale.lines.length && !sale.slip;
  return `<div class="view-anim">
    <div class="banner">
      <div class="banner-deco"><span class="bd-circle"></span><span class="bd-dot"></span></div>
      <div class="banner-body">
        <div class="ov">Pharmacie Adjololo · Lomé</div>
        <h2>Bienvenue au comptoir, ${esc(prenom(u.name))}</h2>
        <p>${new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
        <button class="btn banner-cta" data-newsale>${ico("plus", 15)} ${enCours ? "Reprendre la vente en cours" : "Commencer une vente"}</button>
        <div class="banner-stats">
          <div class="bstat"><span class="bs-ic">${ico("box", 20)}</span>
            <div><b>${fresh.stale ? "Stock à réimporter" : "Stock à jour"}</b><small>Dernier import : ${stockSmall}</small></div></div>
          <div class="bstat"><span class="bs-ic alt">${ico("bag", 20)}</span>
            <div><b>Ventes du jour</b><small>${today.sales_count} enregistrée(s)</small></div></div>
        </div>
      </div>
      <svg class="banner-wave" viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden="true"><path d="M0,0V74C15.0,79.3,55.0,99.0,90,106C125.0,113.0,170.0,116.7,210,116C250.0,115.3,290.0,109.7,330,102C370.0,94.3,411.7,77.0,450,70C488.3,63.0,521.7,56.7,560,60C598.3,63.3,640.0,80.7,680,90C720.0,99.3,763.3,112.7,800,116C836.7,119.3,865.0,116.0,900,110C935.0,104.0,975.0,88.7,1010,80C1045.0,71.3,1078.3,57.0,1110,58C1141.7,59.0,1185.0,81.3,1200,86V0Z" opacity=".25"/><path d="M0,0V52C13.3,58.3,48.3,80.0,80,90C111.7,100.0,153.3,111.3,190,112C226.7,112.7,265.0,103.0,300,94C335.0,85.0,366.7,66.3,400,58C433.3,49.7,465.0,41.0,500,44C535.0,47.0,573.3,64.7,610,76C646.7,87.3,685.0,108.7,720,112C755.0,115.3,785.0,104.7,820,96C855.0,87.3,893.3,69.0,930,60C966.7,51.0,1006.7,40.0,1040,42C1073.3,44.0,1103.3,62.7,1130,72C1156.7,81.3,1188.3,93.7,1200,98V0Z" opacity=".5"/><path d="M0,0V30C16.7,36.0,65.0,55.3,100,66C135.0,76.7,173.3,94.3,210,94C246.7,93.7,283.3,75.3,320,64C356.7,52.7,393.3,35.0,430,26C466.7,17.0,503.3,7.0,540,10C576.7,13.0,613.3,31.0,650,44C686.7,57.0,725.0,84.3,760,88C795.0,91.7,826.7,76.0,860,66C893.3,56.0,925.0,37.7,960,28C995.0,18.3,1036.7,5.3,1070,8C1103.3,10.7,1138.3,34.0,1160,44C1181.7,54.0,1193.3,64.0,1200,68V0Z"/></svg>
      <div class="banner-illus${BANNER_ILLUS ? " has-img" : ""}">${BANNER_ILLUS ? `<img src="${esc(BANNER_ILLUS)}" alt="">` : "Emplacement<br>illustration"}</div>
    </div>

    <div class="section" style="margin-top:18px">
      <div class="hero-search lg">${ico("search", 22)}
        <input id="prodSearch" placeholder="Rechercher un produit, une DCI ou un code…" autocomplete="off" aria-label="Rechercher un produit">
      </div>
      ${
        enCours
          ? `<div class="notice" style="margin-top:12px">${ico("cart", 17)}
        <div><b>Vente ${sale.type === "assuree" ? "assurée" : "simple"} en cours</b>
        <div class="mini" style="color:inherit">${cartCount()} article(s)${sale.client ? ` · ${esc(cname(sale.client))}` : ""} — les produits ajoutés ici la complètent.</div></div>
        <div class="right"><button class="btn btn-ghost sm" data-cancelsale>Abandonner</button>
        <button class="btn btn-primary sm" data-nav="vente">Reprendre la vente</button></div></div>`
          : ""
      }
    </div>
    <div id="compBody">${body}</div>
  </div>`;
}

/* Recherche du comptoir : on ne remplace que le corps, la saisie garde son focus */
let compSeq = 0;
const refreshComptoirBody = debounce(async () => {
  const seq = ++compSeq;
  const box = $("#compBody");
  if (box && comptoirSearch.trim())
    box.innerHTML = `<div class="section">${skeleton(3)}</div>`;
  try {
    const html = await comptoirBody();
    const target = $("#compBody");
    if (seq !== compSeq || !target || session.view !== "comptoir") return;
    target.innerHTML = html;
  } catch (e) {
    toast(errMsg(e), true);
  }
}, 220);

/* Défilement des clients fréquents : uniquement sur action de l'utilisateur */
function scrollFol(dir) {
  const el = $("#folTrack");
  if (!el) return;
  if (dir > 0 && el.scrollLeft + el.clientWidth >= el.scrollWidth - 10)
    el.scrollTo({ left: 0, behavior: "smooth" });
  else el.scrollBy({ left: dir * 238, behavior: "smooth" });
}
window.__od1 = true;
