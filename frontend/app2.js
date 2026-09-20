/* ---------------------------------------------------------------------------
   Vente rapide
   --------------------------------------------------------------------------- */
let MODELS = [];
async function vVente() {
  const c = cart.client;
  const [cats, models, usual] = await Promise.all([
    api("/categories"),
    api("/sales/models" + (c ? `?client_id=${c.id}` : "")),
    c && !cart.lines.length && c.usual_cart_count
      ? api(`/clients/${c.id}/usual-cart`)
      : Promise.resolve(null),
  ]);
  MODELS = models;
  await refreshQuote();
  const t = QUOTE?.totals || { gross_total: 0, insurer_share: 0, patient_share: 0 };
  return `<div class="view-anim grid-2">
    <div>
      ${
        c
          ? `
      <div class="vr-clientcard">
        <div class="avatar">${avatarHTML(c)}</div>
        <div style="flex:1">
          <b>${esc(cname(c))}</b> <span class="tag ok" style="margin-left:6px">Vente assurée</span>
          <div class="mini" style="color:#3B5546;margin-top:2px">${esc(c.insurer)} · N° ${esc(c.policy_number)} · valide jusqu'au ${fmtD(c.valid_until, "date non renseignée")}</div>
        </div>
        <button class="btn btn-ghost sm" data-detach>Détacher</button>
      </div>
      ${
        usual?.lines.length
          ? `
      <div class="card-lemon" style="margin-top:12px;padding:13px 16px;border-radius:13px;display:flex;align-items:center;gap:12px">
        <b style="font-size:13.5px">Panier habituel détecté</b>
        <span class="mini" style="flex:1;color:#3B5546">${usual.lines.map((u) => esc(u.name)).join(" · ")}</span>
        <button class="btn btn-primary sm" data-usual="${c.id}">Reprendre (${usual.lines.length})</button>
      </div>`
          : ""
      }`
          : `
      <div class="hero-search">${ico("search", 19)}<input id="clientSearch" placeholder="Client assuré (optionnel) : nom, organisme ou n° d'assuré" style="font-size:14.5px;padding:14px 18px 14px 48px"></div>
      <div id="clientResults" style="margin-top:10px;display:flex;flex-direction:column;gap:8px"></div>
      <p class="mini" style="margin-top:8px">Sans client attaché, la vente est automatiquement une <b>vente simple</b>. Attachez un client pour passer en <b>vente assurée</b>.</p>`
      }
      ${models.length ? `<div class="chip-select" style="margin-top:14px">${models.map((m) => `<button data-model="${m.id}">Modèle : ${esc(m.name)}</button>`).join("")}</div>` : ""}
      <div class="hero-search" style="margin-top:14px">${ico("search", 19)}<input id="addSearch" placeholder="Ajouter un produit : nom, DCI ou code" style="font-size:14.5px;padding:14px 18px 14px 48px"></div>
      <div id="addResults" style="margin-top:10px;display:flex;flex-direction:column;gap:8px"></div>
      <div class="chip-select" style="margin-top:12px">${cats.map((cat) => `<button data-cat="${esc(cat.name)}">${esc(cat.name)}</button>`).join("")}</div>
      <div class="card" style="margin-top:14px">
        ${
          cart.lines.length
            ? `<table><thead><tr><th>Produit</th><th style="text-align:center">Qté</th><th style="text-align:right">PU</th><th style="text-align:right">Total</th>${c ? "<th>Couverture</th>" : ""}<th></th></tr></thead><tbody>
        ${cart.lines
          .map((l, i) => {
            const ql = QUOTE?.lines?.[i];
            const price = ql ? ql.price : l.price;
            return `<tr>
          <td><b>${esc(l.name)}</b>${l.p === null ? ' <span class="tag violet">Hors catalogue</span>' : ""}</td>
          <td style="text-align:center"><span class="qty-ctl"><button data-q="-1" data-line="${i}">${ico("minus", 12)}</button><span>${l.q}</span><button data-q="1" data-line="${i}">${ico("plus", 12)}</button></span></td>
          <td style="text-align:right">${fmt(price)}</td>
          <td style="text-align:right"><b>${fmt(price * l.q)}</b></td>
          ${c ? `<td>${ql?.coverage ? covTag(ql.coverage) : '<span class="mini">non calculée</span>'}</td>` : ""}
          <td><button class="x-btn" data-rm="${i}">${ico("x", 13)}</button></td></tr>`;
          })
          .join("")}
        </tbody></table>`
            : `<div class="empty">Panier vide. Recherchez un produit, reprenez le panier habituel, ou utilisez la vente manuelle pour un produit hors catalogue.</div>`
        }
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
          <button class="btn btn-ghost sm" data-gov="manuel">Vente manuelle (produit hors catalogue)</button>
          ${cart.lines.length ? `<button class="btn btn-ghost sm" data-savemodel>Enregistrer comme vente récurrente</button>` : ""}
        </div>
      </div>
    </div>
    <div>
      <div class="card" style="position:sticky;top:0">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <b style="font-size:16px">Récapitulatif</b>
          ${c ? `<span class="tag ok">Vente assurée</span>` : `<span class="tag violet">Vente simple</span>`}
        </div>
        <div style="margin-top:16px;display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;justify-content:space-between"><span class="mini">Montant brut</span><b>${fmt(t.gross_total)}</b></div>
          ${
            c
              ? `<div style="display:flex;justify-content:space-between"><span class="mini">Part assurance (${esc(c.insurer)})</span><b style="color:var(--deep)">− ${fmt(t.insurer_share)}</b></div>
          <div style="display:flex;justify-content:space-between;font-size:15.5px;padding-top:6px;border-top:1px solid var(--line)"><b>Reste à charge</b><b>${fmt(t.patient_share)}</b></div>`
              : ""
          }
        </div>
        <button class="btn btn-primary lg" style="width:100%;margin-top:18px" data-validate ${cart.lines.length ? "" : "disabled"}>Enregistrer la vente</button>
        <button class="btn btn-ghost sm" style="width:100%;margin-top:8px" data-clearcart ${cart.lines.length ? "" : "disabled"}>Vider le panier</button>
      </div>
    </div>
  </div>`;
}

/* ---------------------------------------------------------------------------
   Vente manuelle (produits hors catalogue)
   --------------------------------------------------------------------------- */
let manForm = null;
function defaultManForm() {
  return {
    date: new Date().toISOString().slice(0, 10),
    type: "simple",
    clientId: "",
    lines: [{ name: "", price: "", q: 1 }],
    note: "",
  };
}
async function vManuel() {
  if (!manForm) manForm = defaultManForm();
  const f = manForm;
  const clients = await api("/clients?limit=200");
  rememberC(clients);
  const total = f.lines.reduce((t, l) => t + (+l.price || 0) * (+l.q || 0), 0);
  return `<div class="view-anim" style="max-width:820px;margin:0 auto">
    <div class="card">
      <b style="font-size:16px">Vente manuelle</b>
      <p class="mini" style="margin:4px 0 18px">Pour les produits absents du catalogue : remplissez ce formulaire, rien n'est ajouté au catalogue.</p>
      <div class="two-col">
        <div class="field"><label>Date de la vente</label><input type="date" id="manDate" value="${esc(f.date)}" max="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="field"><label>Type de vente</label>
          <select id="manType">
            <option value="simple" ${f.type === "simple" ? "selected" : ""}>Vente simple (prix plein)</option>
            <option value="assuree" ${f.type === "assuree" ? "selected" : ""}>Vente assurée (client identifié)</option>
          </select></div>
      </div>
      <div class="field" style="margin-top:14px"><label>Client assuré ${f.type === "assuree" ? "(requis)" : "(optionnel)"}</label>
        <select id="manClient">
          <option value="">Aucun</option>
          ${clients.map((c) => `<option value="${c.id}" ${String(f.clientId) === String(c.id) ? "selected" : ""}>${esc(cname(c))} · ${esc(c.insurer)}</option>`).join("")}
        </select></div>
      <div style="margin-top:18px">
        <b style="font-size:13.5px">Produits vendus</b>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
          ${f.lines
            .map(
              (l, i) => `
          <div style="display:grid;grid-template-columns:1fr 150px 90px 40px;gap:10px;align-items:center">
            <div class="field" style="margin:0"><input placeholder="Nom du produit" data-mline="${i}" data-f="name" value="${esc(l.name)}"></div>
            <div class="field" style="margin:0"><input type="number" min="0" placeholder="Prix" data-mline="${i}" data-f="price" value="${l.price}"></div>
            <div class="field" style="margin:0"><input type="number" min="1" placeholder="Qté" data-mline="${i}" data-f="q" value="${l.q}"></div>
            ${f.lines.length > 1 ? `<button class="x-btn" data-rmline="${i}">${ico("x", 14)}</button>` : "<span></span>"}
          </div>`,
            )
            .join("")}
        </div>
        <button class="btn btn-ghost sm" style="margin-top:12px" data-addline>${ico("plus", 13)} Ajouter une ligne</button>
      </div>
      <div class="field" style="margin-top:16px"><label>Note interne (optionnel)</label><input id="manNote" value="${esc(f.note)}" placeholder="ex. ordonnance, remarque du client"></div>
      <div style="display:flex;align-items:center;gap:16px;margin-top:18px;padding:14px 16px;background:var(--side);border-radius:12px">
        <span class="mini">Total de la vente</span><b style="font-size:18px;margin-left:auto">${fmt(total)}</b>
      </div>
      ${f.type === "assuree" ? `<p class="mini" style="margin-top:10px">Produits hors catalogue : la couverture assurantielle ne peut pas être calculée automatiquement. Vérifiez le reste à charge avec la fiche du client.</p>` : ""}
      <div style="display:flex;gap:10px;margin-top:16px">
        <button class="btn btn-ghost" data-resetman>Réinitialiser</button>
        <button class="btn btn-primary" style="flex:1" data-saveman>Enregistrer la vente manuelle</button>
      </div>
    </div>
  </div>`;
}

/* Enregistrement : le serveur recalcule tout, l'interface affiche le bordereau qu'il renvoie */
let saving = false;
async function postSale(body) {
  if (saving) return null;
  saving = true;
  try {
    const sale = await api("/sales", { method: "POST", body });
    const slip = await api(`/sales/${sale.reference}/slip`);
    return { sale, slip };
  } finally {
    saving = false;
  }
}
async function validateQuickSale() {
  const r = await postSale(salePayload(cart.lines, cart.client?.id));
  if (!r) return;
  cart = { client: null, lines: [] };
  QUOTE = null;
  showBordereau(r.slip);
  renderView();
}
async function submitManualSale() {
  const f = manForm;
  const lines = f.lines
    .filter((l) => l.name.trim() && +l.price >= 0 && +l.q >= 1)
    .map((l) => ({ p: null, name: l.name.trim(), price: Math.round(+l.price), q: Math.round(+l.q) }));
  if (!lines.length) {
    toast("Renseignez au moins un produit (nom, prix, quantité).", true);
    return;
  }
  if (f.type === "assuree" && !f.clientId) {
    toast("Une vente assurée nécessite un client.", true);
    return;
  }
  const r = await postSale(
    salePayload(lines, f.type === "assuree" ? +f.clientId : null, f.note.trim(), f.date),
  );
  if (!r) return;
  manForm = null;
  session.view = "comptoir";
  showBordereau(r.slip);
  renderNav();
  renderView();
}
function showBordereau(s) {
  const c = s.client;
  const rows = s.lines
    .map(
      (l) =>
        `<tr><td>${esc(l.name)}</td><td>${l.quantity}</td><td>${fmt(l.price)}</td><td>${fmt(l.total)}</td><td>${l.coverage_rate !== null ? l.coverage_rate + "%" : "·"}</td></tr>`,
    )
    .join("");
  const html = `
  <div class="bhead">
    <div><b style="font-size:16px">OptiDesk · ${esc(s.pharmacy.name)}</b><div class="mini">${esc(s.pharmacy.address)}</div><div>Bordereau de vente ${esc(s.reference)}, à ressaisir dans Winpharma</div></div>
    <div style="text-align:right">Le ${fmtDT(s.date)}<br>Vendeur : ${esc(s.seller || "·")}</div>
  </div>
  ${c ? `<p style="margin-bottom:10px"><b>Client :</b> ${esc(c.full_name)} · ${esc(c.insurer || "·")} · N° ${esc(c.policy_number || "·")}</p>` : '<p style="margin-bottom:10px"><b>Vente simple</b> (sans prise en charge)</p>'}
  <table><thead><tr><th>Produit</th><th>Qté</th><th>P.U.</th><th>Total</th><th>Couverture</th></tr></thead><tbody>${rows}</tbody></table>
  <div style="margin-top:14px;font-size:14px">
    <p>Montant brut : <b>${fmt(s.totals.gross_total)}</b></p>
    ${c ? `<p>Part assurance : <b>${fmt(s.totals.insurer_share)}</b></p><p style="font-size:16px">Reste à charge client : <b>${fmt(s.totals.patient_share)}</b></p>` : ""}
  </div>
  <p style="margin-top:18px;font-size:11px;color:#777">${esc(s.mention)}</p>`;
  $("#printArea").innerHTML = html;
  modal(`<div class="modal-head"><h3>Bordereau de vente</h3><button class="x-btn" data-close>${ico("x")}</button></div>
  <div class="modal-body">
    <div style="background:var(--side);border-radius:13px;padding:16px">${html}</div>
    <div style="display:flex;gap:10px;margin-top:16px">
      <button class="btn btn-ghost" onclick="window.print()">${ico("print", 14)} Imprimer / PDF</button>
      <button class="btn btn-primary" style="flex:1" data-close>Terminer</button>
    </div>
  </div>`);
}

/* ---------------------------------------------------------------------------
   Clients assurés
   --------------------------------------------------------------------------- */
async function vClients() {
  const list = await api("/clients?limit=100");
  rememberC(list);
  return `<div class="view-anim">
    <div class="card" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <div class="hero-search" style="flex:1;min-width:260px">${ico("search", 19)}<input id="clListSearch" placeholder="Chercher un client : nom, organisme ou n° d'assuré" style="font-size:14.5px;padding:13px 18px 13px 48px"></div>
      <button class="btn btn-primary" data-newclient>${ico("plus", 14)} Nouveau client</button>
    </div>
    <div id="clList" style="margin-top:16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px">
      ${list.map((cl) => clientCardHTML(cl)).join("") || `<div class="card empty">Aucun client enregistré.</div>`}
    </div>
  </div>`;
}
function clientCardHTML(c) {
  const usual = c.usual_products;
  return `<div class="card" style="display:flex;flex-direction:column;gap:12px">
    <div style="display:flex;gap:13px;align-items:center">
      <div class="avatar" style="width:50px;height:50px;font-size:15px">${avatarHTML(c)}</div>
      <div style="flex:1"><b style="font-size:15px">${esc(cname(c))}</b>
      <div class="mini">${esc(c.insurer)} · N° ${esc(c.policy_number || "·")}</div></div>
      ${c.frequent ? `<span class="tag ok">Fréquent</span>` : ""}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${c.coverage_alert ? `<span class="tag warn">Validité dépassée (${fmtD(c.valid_until)})</span>` : c.valid_until ? `<span class="tag info">Valide jusqu'au ${fmtD(c.valid_until)}</span>` : `<span class="tag">Validité non renseignée</span>`}
      <span class="tag">Dernier achat : ${fmtD(c.last_purchase)}</span>
    </div>
    ${usual.length ? `<div class="mini"><b style="color:var(--ink)">Produits habituels :</b> ${usual.map(esc).join(" · ")}</div>` : ""}
    <div style="display:flex;gap:8px;margin-top:auto">
      <button class="btn btn-primary sm" style="flex:1" data-sell="${c.id}">Vente assurée</button>
      <button class="btn btn-ghost sm" data-editclient="${c.id}">${ico("edit", 13)}</button>
    </div>
  </div>`;
}
function clientResultHTML(c) {
  return `<button class="user-card" style="margin:0;padding:11px 14px">
        <div class="avatar">${avatarHTML(c)}</div>
        <div style="flex:1"><b>${esc(cname(c))}</b><div class="mini">${esc(c.insurer)} · N° ${esc(c.policy_number || "·")}</div></div>
        ${c.coverage_alert ? `<span class="tag warn">À vérifier</span>` : `<span class="tag info">Valide</span>`}
        <button class="btn btn-primary sm" data-sell="${c.id}">Choisir</button>
      </button>`;
}

/* ---------------------------------------------------------------------------
   Catalogue & stock
   --------------------------------------------------------------------------- */
let catState = { q: "", limit: 50 };
let catSeq = 0;
function catRowHTML(p) {
  const d = p.days_to_expiry;
  return `<tr>
        <td><b>${esc(p.name)}</b><div class="mini">${esc(p.dci || "·")} · ${esc(p.code)}</div></td>
        <td><span class="tag">${esc(p.category)}</span></td>
        <td style="text-align:right"><b>${fmt(p.price)}</b></td>
        <td style="text-align:center"><span class="qty-ctl"><button data-stock="-1" data-pid="${p.id}">${ico("minus", 12)}</button><span>${p.stock}</span><button data-stock="1" data-pid="${p.id}">${ico("plus", 12)}</button></span></td>
        <td>${p.availability === "disponible" ? `<span class="tag ok">Disponible</span>` : p.availability === "faible" ? `<span class="tag warn">Stock faible</span>` : `<span class="tag bad">Rupture</span>`}</td>
        <td>${d === null ? '<span class="mini">·</span>' : p.expiring_soon ? `<span class="tag warn">${d < 0 ? "périmé" : d + " j"} · ${fmtD(p.expiry)}</span>` : `<span class="mini">${fmtD(p.expiry)}</span>`}</td>
        <td><span class="tag ${p.source === "import" ? "info" : "violet"}">${p.source === "import" ? "Importé" : "Saisi"}</span></td>
        <td style="white-space:nowrap">
          <button class="x-btn" data-toggle="${p.id}" title="Rupture / réactiver">${ico("alert", 14)}</button>
          <button class="x-btn" data-editproduct="${p.id}" title="Modifier">${ico("edit", 14)}</button>
          <button class="x-btn" data-delproduct="${p.id}" title="Supprimer">${ico("trash", 14)}</button>
        </td></tr>`;
}
function catBodyHTML(r) {
  return r.items.map(catRowHTML).join("") || `<tr><td colspan="8" class="empty">Aucun produit trouvé.</td></tr>`;
}
function catFootHTML(r) {
  return `<span class="mini">${r.items.length} produit(s) affiché(s) sur ${r.total}</span>${r.total > r.items.length ? ` <button class="btn btn-ghost sm" data-catmore style="margin-left:12px">Afficher plus</button>` : ""}`;
}
async function catalogueData() {
  const r = await api(`/products?limit=${catState.limit}&q=${enc(catState.q)}`);
  rememberP(r.items);
  return r;
}
async function refreshCatalogue() {
  const seq = ++catSeq;
  const r = await catalogueData();
  if (seq !== catSeq || !$("#catBody")) return;
  $("#catBody").innerHTML = catBodyHTML(r);
  $("#catFoot").innerHTML = catFootHTML(r);
}
const searchCatalogue = debounce(() => {
  catState.limit = 50;
  refreshCatalogue().catch((e) => toast(errMsg(e), true));
}, 250);
async function vCatalogue() {
  const r = await catalogueData();
  return `<div class="view-anim">
    <div class="card" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <div class="hero-search" style="flex:1;min-width:240px">${ico("search", 19)}<input id="catSearch" placeholder="Chercher dans le catalogue" value="${esc(catState.q)}" style="font-size:14.5px;padding:13px 18px 13px 48px"></div>
      <button class="btn btn-ghost" data-cats>Gérer les catégories</button>
      <button class="btn btn-ghost" data-import>${ico("upload", 14)} Importer mon stock</button>
      <button class="btn btn-primary" data-newproduct>${ico("plus", 14)} Créer un produit</button>
    </div>
    <div class="card" style="margin-top:16px;overflow-x:auto">
      <table id="catTable"><thead><tr><th>Produit</th><th>Catégorie</th><th style="text-align:right">Prix</th><th style="text-align:center">Stock</th><th>Disponibilité</th><th>Péremption</th><th>Provenance</th><th></th></tr></thead><tbody id="catBody">
      ${catBodyHTML(r)}
      </tbody></table>
      <div id="catFoot" style="margin-top:14px">${catFootHTML(r)}</div>
    </div>
  </div>`;
}
async function categoriesModal() {
  const cats = await api("/categories");
  modal(`<div class="modal-head"><h3>Catégories / rayons</h3><button class="x-btn" data-close>${ico("x")}</button></div>
  <div class="modal-body">
    <div style="display:flex;flex-direction:column;gap:8px">
      ${cats
        .map(
          (
            c,
          ) => `<div style="display:flex;align-items:center;gap:10px;padding:10px 13px;background:var(--side);border-radius:10px">
        <b style="font-size:13.5px;flex:1">${esc(c.name)}</b>
        <span class="mini">${c.product_count} produit(s)</span>
        <button class="btn btn-danger sm" data-delcat="${esc(c.name)}" ${c.product_count ? "disabled" : ""} title="${c.product_count ? "Catégorie utilisée par des produits" : "Supprimer"}">${ico("trash", 13)}</button>
      </div>`,
        )
        .join("")}
    </div>
    <div style="display:flex;gap:10px;margin-top:16px">
      <div class="field" style="flex:1;margin:0"><input id="newCat" placeholder="Nom de la nouvelle catégorie"></div>
      <button class="btn btn-primary" id="addCat">${ico("plus", 14)} Ajouter</button>
    </div>
  </div>`);
  $("#addCat").onclick = async () => {
    const v = $("#newCat").value.trim();
    if (!v) {
      toast("Saisissez un nom de catégorie.", true);
      return;
    }
    try {
      await api("/categories", { method: "POST", body: { name: v } });
      closeModal();
      toast(`Catégorie « ${v} » créée.`);
      renderView({ keepScroll: true });
    } catch (e) {
      toast(errMsg(e), true);
    }
  };
}

/* Import Winpharma : aperçu (rien n'est écrit), puis confirmation */
let IMPORT = null;
const IMPORT_LABEL = {
  name: "Nom du produit",
  code: "Code produit",
  stock: "Quantité en stock",
  price: "Prix de vente",
  dci: "DCI (optionnel)",
  category: "Catégorie (optionnel)",
  expiry: "Péremption (optionnel)",
};
const IMPORT_REQUIRED = ["name", "code", "stock", "price"];
function importModal() {
  IMPORT = null;
  modal(`<div class="modal-head"><h3>Importer mon stock Winpharma</h3><button class="x-btn" data-close>${ico("x")}</button></div>
  <div class="modal-body">
    <div class="dropzone" id="dz">
      ${ico("upload", 36)}
      <div style="font-weight:600;font-size:15px">Glissez-déposez votre fichier CSV / Excel</div>
      <div class="mini" style="margin-top:5px">exporté depuis Winpharma, ou cliquez pour parcourir</div>
      <input type="file" id="fileInput" accept=".csv,.xlsx" hidden>
    </div>
    <div id="importPreview" style="margin-top:16px"></div>
  </div>`);
  const dz = $("#dz"),
    fi = $("#fileInput");
  dz.onclick = () => fi.click();
  dz.ondragover = (e) => {
    e.preventDefault();
    dz.classList.add("drag");
  };
  dz.ondragleave = () => dz.classList.remove("drag");
  dz.ondrop = (e) => {
    e.preventDefault();
    dz.classList.remove("drag");
    previewImport(e.dataTransfer.files[0]);
  };
  fi.onchange = () => previewImport(fi.files[0]);
}
async function previewImport(file) {
  if (!file) return;
  if (!/\.(csv|xlsx|xls|txt)$/i.test(file.name)) {
    toast("Ce fichier n'est pas reconnu. Vérifiez qu'il vient bien de Winpharma (CSV ou Excel).", true);
    return;
  }
  $("#importPreview").innerHTML = `<p class="mini">Analyse du fichier en cours…</p>`;
  const fd = new FormData();
  fd.append("file", file);
  try {
    IMPORT = await api("/import/winpharma", { method: "POST", form: fd });
  } catch (e) {
    $("#importPreview").innerHTML = "";
    toast(errMsg(e), true);
    return;
  }
  renderImportPreview();
}
function renderImportPreview() {
  const p = IMPORT;
  const options = (field) =>
    (IMPORT_REQUIRED.includes(field) ? "" : `<option value="">— non utilisée —</option>`) +
    p.columns
      .map(
        (c) =>
          `<option value="${esc(c.header)}" ${p.mapping[field] === c.header ? "selected" : ""}>${esc(c.header)}</option>`,
      )
      .join("");
  const ready = !p.missing_required.length && p.detected_count > 0;
  $("#importPreview").innerHTML = `
    <div class="card" style="padding:16px">
      <b style="font-size:14px">${esc(p.filename)} <span class="tag ok" style="margin-left:6px">Fichier reconnu</span></b>
      <div style="margin-top:12px;display:flex;flex-direction:column;gap:6px">
        ${Object.keys(IMPORT_LABEL)
          .map(
            (f) =>
              `<div style="display:flex;align-items:center;gap:10px;font-size:13px"><span style="flex:1">${IMPORT_LABEL[f]}</span><div class="field" style="margin:0;width:230px"><select data-impmap="${f}">${IMPORT_REQUIRED.includes(f) && !p.mapping[f] ? `<option value="">— choisir la colonne —</option>` : ""}${options(f)}</select></div></div>`,
          )
          .join("")}
      </div>
      <div style="margin-top:12px;padding:12px;background:var(--sel);border-radius:11px;font-size:13.5px;font-weight:600;color:#26402F">
        ${
          ready
            ? `${p.detected_count.toLocaleString("fr-FR")} produits détectés : ${p.new_count.toLocaleString("fr-FR")} nouveau(x), ${p.update_count.toLocaleString("fr-FR")} à mettre à jour. Import prêt.`
            : p.missing_required.length
              ? `Indiquez la colonne : ${esc(p.missing_required.join(", "))}.`
              : "Aucun produit exploitable avec ce choix de colonnes."
        }
      </div>
      ${p.manual_count ? `<p class="mini" style="margin-top:8px">${p.manual_count} produit(s) saisi(s) à la main seront mis à jour par l'import (nommés dans le journal d'audit).</p>` : ""}
      ${p.warnings.length ? `<p class="mini" style="margin-top:8px">${p.warnings.map(esc).join("<br>")}</p>` : ""}
      <div style="display:flex;gap:10px;margin-top:14px">
        <button class="btn btn-ghost sm" data-close>Annuler</button>
        <button class="btn btn-primary sm" style="flex:1" id="confirmImport" ${ready ? "" : "disabled"}>Confirmer l'import</button>
      </div>
    </div>`;
  $("#confirmImport").onclick = async () => {
    const btn = $("#confirmImport");
    btn.disabled = true;
    btn.textContent = "Import en cours…";
    try {
      const r = await api("/import/winpharma/commit", {
        method: "POST",
        body: { import_id: p.import_id, mapping: p.mapping },
      });
      closeModal();
      toast(`Import terminé : ${r.created} nouveau(x), ${r.updated} mis à jour.`);
      renderView({ keepScroll: true });
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "Confirmer l'import";
      toast(errMsg(e), true);
    }
  };
}
/* Si le mapping est modifié à la main, le serveur recompte (toujours sans rien écrire) */
async function recountImport(field, header) {
  IMPORT.mapping[field] = header || null;
  try {
    const r = await api("/import/winpharma/recount", {
      method: "POST",
      body: { import_id: IMPORT.import_id, mapping: IMPORT.mapping },
    });
    IMPORT = { ...IMPORT, ...r, mapping: IMPORT.mapping };
  } catch (e) {
    toast(errMsg(e), true);
  }
  renderImportPreview();
}

/* ---------------------------------------------------------------------------
   Règles de couverture
   --------------------------------------------------------------------------- */
let RULES = [];
async function vRegles() {
  RULES = await api("/rules");
  const groups = {};
  RULES.forEach((r) => {
    (groups[r.insurer] = groups[r.insurer] || []).push(r);
  });
  return `<div class="view-anim">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
      <p class="mini" style="max-width:560px">Ces règles sont appliquées automatiquement au comptoir et dans le panier. Toute modification est historisée dans le journal d'audit.</p>
      <button class="btn btn-primary" data-newrule>${ico("plus", 14)} Nouvelle règle</button>
    </div>
    ${Object.entries(groups)
      .map(
        ([ins, rules]) => `
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <div style="width:36px;height:36px;border-radius:10px;background:var(--sel);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:#26402F">${esc(ins.slice(0, 2).toUpperCase())}</div>
        <b style="font-size:15px">${esc(ins)}</b><span class="mini">${rules.length} règle(s)</span>
      </div>
      <table><thead><tr><th>Périmètre</th><th>Taux</th><th>Exclusions</th><th>Note</th><th></th></tr></thead><tbody>
      ${rules
        .map(
          (r) => `<tr>
        <td><b>${esc(r.scope)}</b></td>
        <td><span class="tag ${r.rate >= 100 ? "ok" : "info"}">${r.rate}%</span></td>
        <td>${r.exclusion ? `<span class="tag bad">${esc(r.exclusion)}</span>` : '<span class="mini">·</span>'}</td>
        <td class="mini">${esc(r.note || "·")}</td>
        <td><button class="x-btn" data-editrule="${r.id}">${ico("edit", 14)}</button></td></tr>`,
        )
        .join("")}
      </tbody></table>
    </div>`,
      )
      .join("")}
  </div>`;
}

/* ---------------------------------------------------------------------------
   Tableau de bord (chiffres calculés par GET /dashboard)
   --------------------------------------------------------------------------- */
async function vDashboard() {
  const d = await api("/dashboard?days=7");
  const max = Math.max(...d.daily.map((x) => x.gross_total), 1);
  const total = d.sales_count || 1;
  const seg = (v, c) =>
    `<circle r="15.9" cx="21" cy="21" fill="transparent" stroke="${c}" stroke-width="6.5" stroke-dasharray="${((v / total) * 100).toFixed(1)} 100" stroke-dashoffset="${(100 - (v / total) * 100).toFixed(1)}" pathLength="100" transform="rotate(-90 21 21)"/>`;
  return `<div class="view-anim">
    <div class="stat-row">
      <div class="stat-dark">
        <div class="ov">Ventes des 7 derniers jours</div>
        <div class="val">${fmt(d.gross_total)}</div>
        <div class="sub">${d.sales_count} vente(s) enregistrée(s)</div>
      </div>
      <div class="stat"><div class="lbl">Produits hors couverture</div><div class="val">${d.out_of_coverage_total}</div><div class="trend">demandes non couvertes sur la période</div></div>
      <div class="stat"><div class="lbl">Ruptures</div><div class="val">${d.stock_out_count}</div><div class="trend">référence(s) à réapprovisionner</div></div>
      <div class="stat"><div class="lbl">Péremptions proches</div><div class="val">${d.expiring_count}</div><div class="trend">à retourner fournisseur sous 7 jours</div></div>
    </div>
    <div class="grid-2" style="margin-top:18px">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:15px">Chiffre d'affaires par jour</b><span class="mini">valeur brute</span></div>
        <div class="bars" style="margin-top:14px">
          ${d.daily
            .map(
              (x) => `<div class="bwrap">
            <span class="bval">${x.gross_total ? Math.round(x.gross_total / 1000) + "k" : ""}</span>
            <div class="bar" style="height:${Math.max(4, (x.gross_total / max) * 100)}%"></div>
            <span class="blabel">${parseTs(x.date).toLocaleDateString("fr-FR", { weekday: "short" })}</span></div>`,
            )
            .join("")}
        </div>
      </div>
      <div class="card">
        <b style="font-size:15px">Répartition des ventes</b>
        <div style="display:flex;gap:18px;align-items:center;margin-top:14px">
          <svg viewBox="0 0 42 42" style="width:110px;height:110px;flex-shrink:0">${seg(d.assured_count, "#2F5D46")}${seg(d.simple_count, "#4FB894")}</svg>
          <div class="donut-legend">
            <div class="li"><i style="background:#2F5D46"></i> Ventes assurées <b style="margin-left:auto">${d.assured_count}</b></div>
            <div class="li"><i style="background:#4FB894"></i> Ventes simples <b style="margin-left:auto">${d.simple_count}</b></div>
            <div class="mini" style="margin-top:6px">Taux de ventes assurées : <b>${d.assured_rate}%</b></div>
          </div>
        </div>
      </div>
    </div>
    <div class="grid-2" style="margin-top:18px">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><b style="font-size:15px">Produits les plus demandés hors couverture</b>
        <button class="btn btn-ghost sm" data-export>Exporter CSV</button></div>
        <table><thead><tr><th>Produit</th><th>Organisme</th><th style="text-align:right">Demandes</th></tr></thead><tbody>
        ${d.out_of_coverage.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td><span class="tag">${esc(x.insurer)}</span></td><td style="text-align:right"><b>${x.count}</b></td></tr>`).join("") || `<tr><td colspan="3" class="mini">Aucune demande hors couverture sur la période.</td></tr>`}
        </tbody></table>
      </div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><b style="font-size:15px">Ruptures et péremptions</b>
        <button class="btn btn-ghost sm" data-export>Exporter CSV</button></div>
        <table><thead><tr><th>Produit</th><th>Statut</th><th>Détail</th></tr></thead><tbody>
        ${d.stock_outs.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td><span class="tag bad">Rupture</span></td><td class="mini">stock à zéro</td></tr>`).join("")}
        ${d.expiring.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td><span class="tag warn">Péremption</span></td><td class="mini">${p.days_to_expiry < 0 ? "périmé depuis " + -p.days_to_expiry + " jour(s)" : p.days_to_expiry + " jour(s) restant(s)"}</td></tr>`).join("")}
        ${!d.stock_outs.length && !d.expiring.length ? `<tr><td colspan="3" class="mini">Aucune rupture ni péremption proche.</td></tr>` : ""}
        </tbody></table>
      </div>
    </div>
  </div>`;
}
async function exportCSV() {
  const blob = await api("/dashboard/out-of-coverage.csv?days=7", { blob: true });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "optidesk-synthese.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast("Synthèse exportée en CSV.");
}

/* ---------------------------------------------------------------------------
   Journal d'audit (lecture seule)
   --------------------------------------------------------------------------- */
let auditFilter = { user: "", days: "" };
let AUDIT_USERS = [];
async function auditData() {
  const p = new URLSearchParams({ limit: "300" });
  if (auditFilter.user) p.set("user", auditFilter.user);
  if (auditFilter.days) p.set("days", auditFilter.days);
  return api("/audit?" + p);
}
function auditRowsHTML(items) {
  return (
    items
      .map(
        (a) =>
          `<tr><td class="mini" style="white-space:nowrap">${fmtDT(a.ts)}</td><td><b>${esc(a.user)}</b></td><td><span class="tag info">${esc(a.action)}</span></td><td class="mini">${esc(a.detail || "")}</td></tr>`,
      )
      .join("") || `<tr><td colspan="4" class="empty">Aucune entrée pour ce filtre.</td></tr>`
  );
}
async function refreshAudit() {
  const r = await auditData();
  const tb = $("#auditTable tbody");
  if (tb) tb.innerHTML = auditRowsHTML(r.items);
}
async function vJournal() {
  const r = await auditData();
  AUDIT_USERS = r.users;
  return `<div class="view-anim">
    <div class="card" style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="flex:1;min-width:200px"><label>Filtrer par utilisateur</label>
        <select id="auditUser"><option value="">Tous les utilisateurs</option>${AUDIT_USERS.map((u) => `<option ${u === auditFilter.user ? "selected" : ""}>${esc(u)}</option>`).join("")}</select></div>
      <div class="field" style="flex:1;min-width:200px"><label>Filtrer par période</label>
        <select id="auditPeriod"><option value="">Tout l'historique</option><option value="7" ${auditFilter.days === "7" ? "selected" : ""}>7 derniers jours</option><option value="1" ${auditFilter.days === "1" ? "selected" : ""}>Aujourd'hui</option></select></div>
      <span class="tag ok" style="margin-bottom:12px">Journal en écriture seule</span>
    </div>
    <div class="card" style="margin-top:16px;overflow-x:auto">
      <table id="auditTable"><thead><tr><th>Horodatage</th><th>Utilisateur</th><th>Action</th><th>Détail</th></tr></thead><tbody>
      ${auditRowsHTML(r.items)}
      </tbody></table>
    </div>
  </div>`;
}

/* ---------------------------------------------------------------------------
   Paramètres
   --------------------------------------------------------------------------- */
let pendingPhoto = null;
async function vParametres() {
  const u = me();
  pendingPhoto = null;
  const [users, models] = isAdmin()
    ? await Promise.all([api("/users"), api("/sales/models?scope=all")])
    : [[], []];
  return `<div class="view-anim grid-2">
    <div>
      <div class="card">
        <b style="font-size:16px">Mon profil</b>
        <div style="display:flex;gap:18px;align-items:center;margin-top:16px">
          <div class="avatar" style="width:72px;height:72px;font-size:21px" id="bigAvatar">${u.photo ? `<img src="${u.photo}">` : esc(nameInits(u.name))}</div>
          <div>
            <div style="font-weight:700;font-size:17px">${esc(u.name)}</div>
            <span class="role-chip ${u.role === "vendeur" ? "vendeur" : ""}">${u.role === "admin" ? "Titulaire / Administrateur" : "Vendeur / Préparateur"}</span>
            <div class="mini" style="margin-top:6px">Pharmacie Adjololo · Lomé, Togo</div>
          </div>
        </div>
        <div class="two-col" style="margin-top:20px">
          <div class="field"><label>Nom complet (nom, puis prénom)</label><input id="setUserName" value="${esc(u.name)}"></div>
          <div class="field"><label>Changer mon code PIN</label><input id="setUserPin" type="password" maxlength="4" inputmode="numeric" placeholder="····" style="letter-spacing:8px;text-align:center;font-size:17px"></div>
        </div>
        <div class="photo-drop" id="photoDrop" style="margin-top:14px">${ico("camera", 16)} Changer ma photo de profil (bibliothèque interne)</div>
        <input type="file" id="photoInput" accept="image/*" hidden>
        <button class="btn btn-primary" style="margin-top:14px" data-saveprofile>Enregistrer les modifications</button>
      </div>
      <div class="card" style="margin-top:16px">
        <b style="font-size:16px">À propos</b>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px" class="mini">
          <div style="display:flex;justify-content:space-between"><span>Application</span><b>OptiDesk v1.0</b></div>
          <div style="display:flex;justify-content:space-between"><span>Officine</span><b>Pharmacie Adjololo · Lomé, Togo</b></div>
          <div style="display:flex;justify-content:space-between"><span>Mode de données</span><b>Catalogue propre : import Winpharma et saisie manuelle</b></div>
        </div>
      </div>
    </div>
    <div>
      ${
        isAdmin()
          ? `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:16px">Comptes de l'équipe</b>
        <button class="btn btn-primary sm" data-newuser>${ico("plus", 13)} Créer un compte</button></div>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:14px">
          ${users
            .map(
              (
                x,
              ) => `<div style="display:flex;align-items:center;gap:12px;padding:12px;background:${x.active ? "var(--side)" : "var(--red-bg)"};border-radius:12px;${x.active ? "" : "opacity:.6"}">
            <div class="avatar" style="width:38px;height:38px;font-size:12px">${x.photo ? `<img src="${x.photo}">` : esc(nameInits(x.name))}</div>
            <div style="flex:1"><b style="font-size:13.5px">${esc(x.name)}</b><div class="mini">${x.role === "admin" ? "Titulaire / Admin" : "Vendeur / Préparateur"}</div></div>
            ${x.id !== u.id ? `<button class="btn ${x.active ? "btn-danger" : "btn-ghost"} sm" data-toggleuser="${x.id}" data-active="${x.active ? 1 : 0}">${x.active ? "Désactiver" : "Réactiver"}</button>` : '<span class="tag ok">Vous</span>'}
          </div>`,
            )
            .join("")}
        </div>
        <p class="mini" style="margin-top:12px">Deux rôles : Titulaire/Admin (accès complet) et Vendeur/Préparateur (comptoir). La création de comptes est réservée au Titulaire.</p>
      </div>
      <div class="card" style="margin-top:16px">
        <b style="font-size:16px">Modèles de vente récurrente</b>
        ${
          models.length
            ? `<div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">${models
                .map(
                  (m) => `
          <div style="display:flex;align-items:center;gap:10px;padding:11px;background:var(--side);border-radius:11px">
            <div style="flex:1"><b style="font-size:13.5px">${esc(m.name)}</b><div class="mini">${m.lines.map((l) => esc(l.name)).join(" · ")}</div></div>
            <button class="x-btn" data-delmodel="${m.id}">${ico("trash", 13)}</button></div>`,
                )
                .join("")}</div>`
            : `<p class="mini" style="margin-top:10px">Aucun modèle enregistré. Créez-en depuis la vente rapide pour les ordonnances chroniques.</p>`
        }
      </div>`
          : `
      <div class="card">
        <b style="font-size:16px">Session</b>
        <p class="mini" style="margin-top:8px">Vous êtes connecté(e) comme Vendeur / Préparateur. Les fonctions de gestion (catalogue, règles, tableau de bord, comptes) sont réservées au Titulaire.</p>
      </div>`
      }
    </div>
  </div>`;
}
window.__od2 = true;
