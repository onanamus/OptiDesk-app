/* ===========================================================================
   app3.js — fenêtres, connexion, fiche client, événements
   =========================================================================== */

/* ---------------------------------------------------------------------------
   Fenêtres modales et utilitaires
   --------------------------------------------------------------------------- */
let modalEl = null;
let modalOnClose = null;
function modal(html, onClose = null, cls = "") {
  closeModal();
  modalOnClose = onClose;
  modalEl = document.createElement("div");
  modalEl.className = "modal-bg";
  modalEl.innerHTML = `<div class="modal ${cls}">${html}</div>`;
  modalEl.onclick = (e) => {
    if (e.target === modalEl) closeModal();
  };
  document.body.appendChild(modalEl);
}
function closeModal() {
  const cb = modalOnClose;
  modalOnClose = null;
  modalEl?.remove();
  modalEl = null;
  if (cb) cb();
}
/* Petite fenêtre de saisie (remplace window.prompt, absent d'Electron) : résout null si annulée */
function askText({ title, label, type = "text", placeholder = "", ok = "Valider", maxlength = 80, numeric = false }) {
  return new Promise((resolve) => {
    modal(
      `<div class="modal-head"><h3>${esc(title)}</h3><button class="x-btn" data-close>${ico("x")}</button></div>
    <div class="modal-body">
      <div class="field"><label>${esc(label)}</label><input id="askInput" type="${type}" maxlength="${maxlength}" placeholder="${esc(placeholder)}" ${numeric ? 'inputmode="numeric" style="letter-spacing:8px;text-align:center;font-size:17px"' : ""}></div>
      <div style="display:flex;gap:10px;margin-top:18px"><button class="btn btn-ghost" data-close>Annuler</button><button class="btn btn-primary" style="flex:1" id="askOk">${esc(ok)}</button></div>
    </div>`,
      () => resolve(null),
    );
    const inp = $("#askInput");
    inp.focus();
    const done = () => {
      const v = inp.value.trim();
      if (!v) return;
      modalOnClose = null;
      closeModal();
      resolve(v);
    };
    $("#askOk").onclick = done;
    inp.onkeydown = (e) => e.key === "Enter" && done();
  });
}
/* Confirmation explicite, en langage clair, avant toute action destructrice */
function confirmAction({ title, text, ok = "Confirmer", danger = true }) {
  return new Promise((resolve) => {
    modal(
      `<div class="modal-head"><h3>${esc(title)}</h3><button class="x-btn" data-close>${ico("x")}</button></div>
    <div class="modal-body"><p class="lead">${text}</p>
      <div style="display:flex;gap:10px;margin-top:18px">
        <button class="btn btn-ghost" data-close>Annuler</button>
        <button class="btn ${danger ? "btn-danger" : "btn-primary"}" style="flex:1" id="confirmOk">${esc(ok)}</button>
      </div></div>`,
      () => resolve(false),
    );
    $("#confirmOk").onclick = () => {
      modalOnClose = null;
      closeModal();
      resolve(true);
    };
  });
}
/* Photo de profil : réduite à 256 px avant envoi (l'API refuse les images trop lourdes) */
function readPhoto(e, cb) {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 256 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      cb(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => toast("Cette image n'a pas pu être lue.", true);
    img.src = r.result;
  };
  r.readAsDataURL(f);
}
const afterCatalogueChange = () =>
  session.view === "catalogue" ? refreshCatalogue().catch((e) => toast(errMsg(e), true)) : renderView({ keepScroll: true });

/* Après chaque rendu : le curseur se place là où l'utilisateur va taper */
function afterRender(view) {
  if (view === "comptoir" && !comptoirSearch) $("#prodSearch")?.focus();
  if (view === "vente") ($("#addSearch") || $("#clientSearch"))?.focus();
}

/* ---------------------------------------------------------------------------
   Produit hors catalogue : la « vente manuelle » devenue contextuelle
   --------------------------------------------------------------------------- */
function freeLineModal() {
  modal(`<div class="modal-head"><h3>Ajouter un produit hors catalogue</h3><button class="x-btn" data-close>${ico("x")}</button></div>
  <div class="modal-body">
    <p class="lead" style="margin-bottom:16px">Pour un produit absent du catalogue OptiDesk. Il est ajouté à cette vente uniquement : le catalogue n'est pas modifié, et la couverture ne peut pas être calculée automatiquement.</p>
    <div class="form-grid">
      <div class="field"><label>Nom du produit</label><input id="flName" maxlength="150" placeholder="ex. Sirop antitussif 150 ml"></div>
      <div class="field"><label>Prix de vente (FCFA)</label><input id="flPrice" type="number" min="0" placeholder="0"></div>
      <div class="field"><label>Quantité</label><input id="flQty" type="number" min="1" value="1"></div>
    </div>
    <div style="display:flex;gap:10px;margin-top:18px">
      <button class="btn btn-ghost" data-close>Annuler</button>
      <button class="btn btn-primary" style="flex:1" id="flOk">Ajouter au panier</button>
    </div>
  </div>`);
  $("#flName").focus();
  $("#flOk").onclick = () => {
    const name = $("#flName").value.trim();
    const price = $("#flPrice").value;
    const q = Math.round(+$("#flQty").value || 1);
    if (!name || price === "" || !(+price >= 0) || q < 1)
      return toast("Renseignez le nom, un prix et une quantité d'au moins 1.", true);
    if (sale.slip) resetSale(); // la vente précédente est close : on en ouvre une nouvelle
    if (!saleStarted()) {
      sale.type = "simple";
      sale.step = 3;
    }
    addFreeLine(name, Math.round(+price), q);
    closeModal();
    toast(`${name} ajouté au panier.`);
    if (session.view !== "vente") return go("vente");
    renderView({ keepScroll: true });
  };
}

/* ---------------------------------------------------------------------------
   Produit, client, règle, compte
   --------------------------------------------------------------------------- */
async function productModal(p) {
  const isNew = !p;
  const cats = await api("/categories");
  p = p || { name: "", dci: "", code: "", category: cats[0]?.name, price: "", stock: "", expiry: "" };
  modal(`<div class="modal-head"><h3>${isNew ? "Créer un produit" : "Modifier le produit"}</h3><button class="x-btn" data-close>${ico("x")}</button></div>
  <div class="modal-body">
    <div class="two-col">
      <div class="field"><label>Nom commercial *</label><input id="pName" value="${esc(p.name)}"></div>
      <div class="field"><label>DCI</label><input id="pDci" value="${esc(p.dci)}"></div>
      <div class="field"><label>Code produit</label><input id="pCode" value="${esc(p.code)}"><div class="help">Laissé vide, un code est attribué automatiquement.</div></div>
      <div class="field"><label>Rayon</label><select id="pCat">${cats.map((c) => `<option ${c.name === p.category ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Prix de vente (FCFA) *</label><input id="pPrice" type="number" min="0" value="${p.price}"></div>
      <div class="field"><label>Quantité en stock</label><input id="pStock" type="number" min="0" value="${p.stock}"></div>
      <div class="field"><label>Date de péremption</label><input id="pExpiry" type="date" value="${esc(p.expiry || "")}"></div>
    </div>
    <div style="display:flex;gap:10px;margin-top:18px">
      <button class="btn btn-ghost" data-close>Annuler</button>
      <button class="btn btn-primary" style="flex:1" id="pSave">${isNew ? "Créer le produit" : "Enregistrer les modifications"}</button>
    </div>
  </div>`);
  $("#pName").focus();
  $("#pSave").onclick = async () => {
    const name = $("#pName").value.trim(),
      priceRaw = $("#pPrice").value;
    if (!name || priceRaw === "" || !(+priceRaw >= 0)) return toast("Renseignez au moins le nom et le prix.", true);
    const body = {
      name,
      dci: $("#pDci").value.trim(),
      category: $("#pCat").value,
      price: Math.round(+priceRaw),
      expiry: $("#pExpiry").value || null,
    };
    const code = $("#pCode").value.trim();
    if (code) body.code = code;
    const stock = $("#pStock").value;
    if (isNew) body.stock = +stock || 0;
    else if (stock !== "") body.stock = Math.round(+stock);
    try {
      if (isNew) await api("/products", { method: "POST", body });
      else await api(`/products/${p.id}`, { method: "PATCH", body });
      closeModal();
      toast(isNew ? "Produit créé dans le catalogue." : "Produit mis à jour.");
      afterCatalogueChange();
    } catch (e) {
      toast(errMsg(e), true);
    }
  };
}
async function clientModal(c) {
  const isNew = !c;
  const insurers = await api("/rules/insurers");
  c = c || { first_name: "", last_name: "", insurer: insurers[0], policy_number: "", valid_until: "" };
  modal(`<div class="modal-head"><h3>${isNew ? "Nouveau client assuré" : "Modifier la fiche client"}</h3><button class="x-btn" data-close>${ico("x")}</button></div>
  <div class="modal-body">
    <div class="two-col">
      <div class="field"><label>Nom de famille *</label><input id="cLast" value="${esc(c.last_name)}"></div>
      <div class="field"><label>Prénom *</label><input id="cFirst" value="${esc(c.first_name)}"></div>
      <div class="field"><label>Organisme assureur</label><select id="cIns">${insurers.map((x) => `<option ${x === c.insurer ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div>
      <div class="field"><label>Numéro d'assuré</label><input id="cPol" value="${esc(c.policy_number)}"></div>
      <div class="field"><label>Couverture valable jusqu'au</label><input id="cVal" type="date" value="${esc(c.valid_until || "")}"></div>
      <div class="field"><label>Photo (facultatif)</label><div class="photo-drop" id="cPhotoDrop" style="padding:11px">${ico("camera", 14)} Choisir une photo</div><input type="file" id="cPhotoInput" accept="image/*" hidden></div>
    </div>
    <div style="display:flex;gap:10px;margin-top:18px">
      <button class="btn btn-ghost" data-close>Annuler</button>
      <button class="btn btn-primary" style="flex:1" id="cSave">${isNew ? "Créer le client" : "Enregistrer les modifications"}</button>
    </div>
  </div>`);
  $("#cLast").focus();
  let photo; // undefined = inchangée
  $("#cPhotoDrop").onclick = () => $("#cPhotoInput").click();
  $("#cPhotoInput").onchange = (e) =>
    readPhoto(e, (f) => {
      photo = f;
      $("#cPhotoDrop").textContent = "Photo choisie";
    });
  $("#cSave").onclick = async () => {
    const f = $("#cFirst").value.trim(),
      l = $("#cLast").value.trim();
    if (!f || !l) return toast("Renseignez le nom de famille et le prénom.", true);
    const body = {
      first_name: f,
      last_name: l,
      insurer: $("#cIns").value,
      policy_number: $("#cPol").value.trim(),
      valid_until: $("#cVal").value || null,
    };
    if (photo !== undefined) body.photo = photo;
    try {
      const saved = isNew
        ? await api("/clients", { method: "POST", body })
        : await api(`/clients/${c.id}`, { method: "PATCH", body });
      CCACHE.set(saved.id, saved);
      closeModal();
      toast(isNew ? "Client créé, immédiatement utilisable au comptoir." : "Fiche mise à jour (modification journalisée).");
      // Créé au milieu d'une vente assurée : on l'attache tout de suite
      if (isNew && session.view === "vente" && sale.type === "assuree" && !sale.client) {
        sale.client = saved;
        sale.step = 2;
        USUAL = null;
      } else if (!isNew && sale.client?.id === saved.id) {
        sale.client = saved;
      }
      if (session.view === "clients") clientsState.selectedId = saved.id;
      renderView({ keepScroll: true });
    } catch (e) {
      toast(errMsg(e), true);
    }
  };
}
async function ruleModal(r) {
  const isNew = !r;
  const [insurers, cats] = await Promise.all([api("/rules/insurers"), api("/categories")]);
  r = r || { insurer: insurers[0], scope: "Tous", rate: 80, exclusion: "", note: "" };
  const scopes = ["Tous", "Tous médicaments", ...cats.map((c) => c.name)];
  modal(`<div class="modal-head"><h3>${isNew ? "Nouvelle règle de couverture" : "Modifier la règle"}</h3><button class="x-btn" data-close>${ico("x")}</button></div>
  <div class="modal-body">
    <p class="lead" style="margin-bottom:16px">Une règle répond à une question simple : pour cet organisme, quelle part est prise en charge sur ce type de produits ?</p>
    <div class="two-col">
      <div class="field"><label>Organisme assureur</label><select id="rIns">${insurers.map((x) => `<option ${x === r.insurer ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div>
      <div class="field"><label>S'applique à</label><select id="rScope">${scopes.map((x) => `<option ${x === r.scope ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div>
      <div class="field"><label>Part prise en charge (%)</label><input id="rRate" type="number" min="0" max="100" value="${r.rate}"></div>
      <div class="field"><label>Rayon jamais pris en charge</label><input id="rExc" value="${esc(r.exclusion || "")}" placeholder="ex. Parapharmacie"><div class="help">Facultatif. Ce rayon reste à la charge du client.</div></div>
    </div>
    <div class="field" style="margin-top:14px"><label>Note interne</label><input id="rNote" value="${esc(r.note || "")}"></div>
    <div style="display:flex;gap:10px;margin-top:18px">
      <button class="btn btn-ghost" data-close>Annuler</button>
      <button class="btn btn-primary" style="flex:1" id="rSave">Enregistrer la règle</button>
    </div>
  </div>`);
  $("#rSave").onclick = async () => {
    const rate = +$("#rRate").value;
    if ($("#rRate").value === "" || !(rate >= 0 && rate <= 100)) return toast("La part prise en charge doit être comprise entre 0 et 100 %.", true);
    const body = {
      insurer: $("#rIns").value,
      scope: $("#rScope").value,
      rate: Math.round(rate),
      exclusion: $("#rExc").value.trim() || null,
      note: $("#rNote").value.trim(),
    };
    try {
      if (isNew) await api("/rules", { method: "POST", body });
      else await api(`/rules/${r.id}`, { method: "PATCH", body });
      closeModal();
      toast("Règle enregistrée et historisée dans le journal.");
      renderView({ keepScroll: true });
    } catch (e) {
      toast(errMsg(e), true);
    }
  };
}
function userModal() {
  modal(`<div class="modal-head"><h3>Créer un compte OptiDesk</h3><button class="x-btn" data-close>${ico("x")}</button></div>
  <div class="modal-body">
    <div class="field" style="margin-bottom:14px"><label>Nom complet (nom, puis prénom) *</label><input id="uName" placeholder="ex. AGBEVON Rachelle"></div>
    <div class="field" style="margin-bottom:14px"><label>Rôle</label><select id="uRole"><option value="vendeur">Vendeur / Préparateur</option><option value="admin">Titulaire / Administrateur</option></select></div>
    <div class="field"><label>Code PIN (4 chiffres) *</label><input id="uPin" type="password" maxlength="4" inputmode="numeric" placeholder="····" style="letter-spacing:8px;text-align:center;font-size:17px"></div>
    <div class="photo-drop" id="uPhotoDrop" style="margin-top:14px">${ico("camera", 16)} Photo de profil (facultatif)</div>
    <input type="file" id="uPhotoInput" accept="image/*" hidden>
    <div style="display:flex;gap:10px;margin-top:18px">
      <button class="btn btn-ghost" data-close>Annuler</button>
      <button class="btn btn-primary" style="flex:1" id="uSave">Créer le compte</button>
    </div>
  </div>`);
  let photo = null;
  $("#uName").focus();
  $("#uPhotoDrop").onclick = () => $("#uPhotoInput").click();
  $("#uPhotoInput").onchange = (e) =>
    readPhoto(e, (f) => {
      photo = f;
      $("#uPhotoDrop").textContent = "Photo choisie";
    });
  $("#uSave").onclick = async () => {
    const name = $("#uName").value.trim(),
      pin = $("#uPin").value.trim();
    if (!name || !/^\d{4}$/.test(pin)) return toast("Renseignez le nom et un code PIN de 4 chiffres.", true);
    try {
      await api("/users", { method: "POST", body: { name, role: $("#uRole").value, pin, photo } });
      closeModal();
      toast(`Compte créé pour ${name}.`);
      renderView({ keepScroll: true });
    } catch (e) {
      toast(errMsg(e), true);
    }
  };
}

/* ---------------------------------------------------------------------------
   Connexion (comptes et PIN vérifiés par le serveur)
   --------------------------------------------------------------------------- */
let authSel = null,
  authPin = "",
  authBusy = false;
let authMode = "login", // "login" (PIN) ou "signup" (création autorisée par le titulaire)
  signupPhoto = null;
let ACCOUNTS = [],
  authError = "";

function updateAuthFoot() {
  const f = $("#authFoot");
  if (!f || f.dataset.mode === authMode) return;
  f.dataset.mode = authMode;
  f.innerHTML =
    authMode === "signup"
      ? `<p class="account">déjà un compte ?</p><button class="auth-btn" id="authToLoginBtn">Se connecter</button>`
      : `<p class="account">pas encore de compte ?</p><button class="auth-btn" id="createAccountBtn">Créer un compte</button>`;
}
/* Bascule connexion <-> création : le panneau glisse de l'autre côté, la carte du logo prend sa place. */
function setAuthMode(m) {
  if (authMode === m) return;
  authMode = m;
  authSel = null;
  authPin = "";
  const stage = $(".auth-stage"),
    right = $("#authRight"),
    brand = $(".auth-brand");
  stage.classList.toggle("signup", m === "signup");
  brand.classList.remove("flip");
  void brand.offsetWidth;
  brand.classList.add("flip");
  right.classList.add("swapping");
  setTimeout(() => {
    renderAuth();
    right.classList.remove("swapping");
  }, 300);
}
function renderSignup() {
  signupPhoto = null;
  $("#authRight").innerHTML = `
    <h3 class="auth-title">Inscription</h3>
    <form class="auth-form" id="signupForm" autocomplete="off" novalidate>
      <input id="suName" type="text" placeholder="nom complet (NOM Prénom)" maxlength="60">
      <select id="suRole">
        <option value="vendeur">Vendeur / Préparateur</option>
        <option value="admin">Titulaire / Administrateur</option>
      </select>
      <input id="suPin" type="password" maxlength="4" inputmode="numeric" placeholder="code PIN (4 chiffres)">
      <input id="suAdminPin" type="password" maxlength="4" inputmode="numeric" placeholder="PIN du titulaire (autorisation)">
      <button type="button" class="su-photo" id="suPhotoDrop">${ico("camera", 16)} <span>photo de profil (optionnel)</span></button>
      <input type="file" id="suPhotoInput" accept="image/*" hidden>
      <button type="submit" class="auth-submit">Créer le compte</button>
    </form>`;
  for (const id of ["#suPin", "#suAdminPin"]) {
    const inp = $(id);
    inp.oninput = () => (inp.value = inp.value.replace(/\D/g, ""));
  }
  $("#suPhotoDrop").onclick = () => $("#suPhotoInput").click();
  $("#suPhotoInput").onchange = (e) =>
    readPhoto(e, (f) => {
      signupPhoto = f;
      $("#suPhotoDrop span").textContent = "photo choisie ✓";
    });
  $("#signupForm").onsubmit = async (ev) => {
    ev.preventDefault();
    if (authBusy) return;
    const name = $("#suName").value.trim(),
      p = $("#suPin").value.trim(),
      ap = $("#suAdminPin").value.trim(),
      role = $("#suRole").value;
    if (!name || !/^\d{4}$/.test(p)) return toast("Renseignez le nom et un code PIN de 4 chiffres.", true);
    if (!/^\d{4}$/.test(ap)) return toast("Le PIN du titulaire est nécessaire pour autoriser la création du compte.", true);
    authBusy = true;
    try {
      await api("/auth/register", {
        method: "POST",
        auth: false,
        body: { name, role, pin: p, photo: signupPhoto, admin_pin: ap },
      });
      signupPhoto = null;
      toast(`Compte créé pour ${name}.`);
      await loadAccounts();
      setAuthMode("login");
    } catch (e) {
      toast(errMsg(e), true);
    } finally {
      authBusy = false;
    }
  };
}
async function loadAccounts() {
  try {
    ACCOUNTS = await api("/auth/accounts", { auth: false });
    authError = "";
  } catch (e) {
    ACCOUNTS = [];
    authError = errMsg(e);
  }
}
async function showAuth() {
  authSel = null;
  authPin = "";
  authMode = "login";
  $(".auth-stage").classList.remove("signup");
  await resolveApiBase(); // (re)trouve l'API : même origine ou http://127.0.0.1:8765
  await loadAccounts();
  renderAuth();
}
function renderAuth() {
  $(".auth-stage").classList.toggle("signup", authMode === "signup");
  updateAuthFoot();
  if (authMode === "signup") return renderSignup();
  if (authSel) {
    const u = ACCOUNTS.find((x) => x.id === authSel);
    if (!u) {
      authSel = null;
      return renderAuth();
    }
    $("#authRight").innerHTML = `
    <button class="btn btn-ghost sm" id="authBack" style="align-self:flex-start">Autre compte</button>
    <div style="text-align:center;margin-top:16px">
      <div class="avatar" style="width:62px;height:62px;font-size:19px;margin:0 auto">${u.photo ? `<img src="${u.photo}">` : esc(nameInits(u.name))}</div>
      <h3 class="auth-name">${esc(u.name)}</h3>
      <span class="role-chip ${u.role === "vendeur" ? "vendeur" : ""}">${u.role === "admin" ? "Titulaire / Administrateur" : "Vendeur / Préparateur"}</span>
    </div>
    <div class="pin-dots" id="authDots"><i></i><i></i><i></i><i></i></div>
    <p class="mini" style="text-align:center;margin-bottom:14px">Saisissez votre code PIN</p>
    <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button class="key" data-k="${n}">${n}</button>`).join("")}
      <button class="key fn" data-k="del">Effacer</button><button class="key" data-k="0">0</button><button class="key fn" data-k="ok">OK</button>
    </div>`;
  } else {
    $("#authRight").innerHTML = `
    <h3 class="auth-title">Connexion</h3>
    <p class="sub">Sélectionnez votre compte, puis saisissez votre code PIN.</p>
    ${
      authError
        ? `<p class="sub" style="margin-top:14px">${esc(authError)}</p><button class="btn btn-ghost sm" id="authRetry" style="margin-top:10px">Réessayer</button>`
        : ACCOUNTS.map(
            (u) => `<button class="user-card" data-user="${u.id}">
      <div class="avatar">${u.photo ? `<img src="${u.photo}">` : esc(nameInits(u.name))}</div>
      <div style="flex:1"><b>${esc(u.name)}</b><div class="mini">${u.role === "admin" ? "Titulaire / Administrateur" : "Vendeur / Préparateur"}</div></div>
      <span class="role-chip ${u.role === "vendeur" ? "vendeur" : ""}">${u.role === "admin" ? "Admin" : "Vendeur"}</span>
    </button>`,
          ).join("")
    }`;
  }
}
function authKey(k) {
  if (authBusy || !ACCOUNTS.find((x) => x.id === authSel)) return;
  if (k === "del") authPin = authPin.slice(0, -1);
  else if (k === "ok") return submitPin();
  else if (/^\d$/.test(k) && authPin.length < 4) authPin += k;
  $("#authDots")
    ?.querySelectorAll("i")
    .forEach((d, i) => d.classList.toggle("on", i < authPin.length));
  if (authPin.length === 4) submitPin();
}
async function submitPin() {
  const acc = ACCOUNTS.find((x) => x.id === authSel);
  if (!acc || authBusy) return;
  const pin = authPin;
  authBusy = true;
  try {
    const t = await api("/auth/login", { method: "POST", auth: false, body: { login: acc.login, pin } });
    tokens.access = t.access_token;
    tokens.refresh = t.refresh_token;
    USER = await api("/auth/me");
    session.userId = USER.id;
    authPin = "";
    $("#auth").style.display = "none";
    $("#app").classList.add("show");
    renderUser();
    go("comptoir");
    toast(`Bienvenue, ${prenom(USER.name)} !`);
  } catch (err) {
    authPin = "";
    const dots = $("#authRight").querySelector(".pin-dots");
    if (dots) {
      dots.querySelectorAll("i").forEach((d) => d.classList.remove("on"));
      dots.classList.add("err", "shake");
      setTimeout(() => dots.classList.remove("err", "shake"), 600);
    }
    toast(err.status === 401 ? "Code PIN incorrect, réessayez." : errMsg(err), true);
  } finally {
    authBusy = false;
  }
}
function resetToLogin(msg) {
  tokens.access = tokens.refresh = null;
  USER = null;
  session.userId = null;
  resetSale();
  USUAL = null;
  comptoirSearch = "";
  closeModal();
  $("#app").classList.remove("show");
  $("#auth").style.display = "flex";
  const st = $("#logoStage");
  st.classList.remove("run");
  void st.offsetWidth;
  st.classList.add("run");
  if (msg) toast(msg, true);
  showAuth();
}
async function logout() {
  try {
    await api("/auth/logout", { method: "POST", body: { refresh_token: tokens.refresh } });
  } catch (_) {}
  resetToLogin();
}
function renderUser() {
  const u = me();
  if (!u) return;
  $("#sideName").textContent = u.name;
  $("#sideRole").textContent = u.role === "admin" ? "Titulaire / Admin" : "Vendeur / Préparateur";
  $("#topAvatar").innerHTML = u.photo ? `<img src="${u.photo}">` : esc(nameInits(u.name));
  $("#topName").textContent = u.name;
}

/* ---------------------------------------------------------------------------
   Fiche client (fenêtre)
   --------------------------------------------------------------------------- */
async function clientData(id) {
  const [c, usual, hist] = await Promise.all([
    api(`/clients/${id}`),
    api(`/clients/${id}/usual-cart`),
    api(`/sales?client_id=${id}&page_size=5`),
  ]);
  CCACHE.set(c.id, c);
  return { c, usual, hist };
}
/* Corps de fiche : identité, assurance, produits habituels, historique */
function clientFicheBody(c, usual, hist) {
  return `<div style="display:flex;gap:14px;align-items:center">
      <div class="avatar" style="width:52px;height:52px;font-size:16px;border-radius:8px">${avatarHTML(c)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-family:var(--font-title);font-size:19px">${esc(cname(c))}</div>
        <div class="mini" style="margin-top:3px">Dernier achat : ${fmtD(c.last_purchase, "aucun")}</div>
      </div>
      ${c.coverage_alert ? `<span class="status warn">Couverture échue le ${fmtD(c.valid_until)}</span>` : c.valid_until ? `<span class="status ok">Valide jusqu'au ${fmtD(c.valid_until)}</span>` : `<span class="status neutral">Validité non renseignée</span>`}
    </div>
    <div class="divider"></div>
    <div class="kv">
      <div><div class="lbl">Organisme</div><b>${esc(c.insurer)}</b></div>
      <div><div class="lbl">Numéro d'assuré</div><b>${esc(c.policy_number || "non renseigné")}</b></div>
      <div><div class="lbl">Ventes enregistrées</div><b>${hist.total}</b></div>
    </div>
    <div class="section">
      <div class="section-head"><h2>Produits habituels</h2>
        ${usual.lines.length ? `<div class="right"><button class="btn btn-soft sm" data-usual="${c.id}">Utiliser le panier habituel</button></div>` : ""}</div>
      ${
        usual.lines.length
          ? `<div class="rows">${usual.lines
              .map(
                (x) => `<div class="r"><span>${esc(x.name)}</span><b class="mini">× ${x.quantity}</b>
        ${covTag(x.coverage)}<span class="amt">${fmt(x.price * x.quantity)}</span></div>`,
              )
              .join("")}</div>`
          : `<p class="mini">Aucun achat récurrent pour l'instant : les produits habituels se construisent au fil des ventes.</p>`
      }
    </div>
    <div class="section">
      <div class="section-head"><h2>Dernières ventes</h2></div>
      ${
        hist.items.length
          ? `<div class="rows">${hist.items
              .map(
                (sv) => `<div class="r"><span>${esc(sv.reference)}</span><span class="mini">${fmtD(sv.date)}</span>
        ${sv.type === "assuree" ? `<span class="tag ok">assurée</span>` : `<span class="tag">simple</span>`}
        <span class="amt">${fmt(sv.totals.gross_total)}</span></div>`,
              )
              .join("")}</div>`
          : `<p class="mini">Aucune vente enregistrée dans OptiDesk pour ce client.</p>`
      }
    </div>`;
}
/* Version fenêtre, ouverte depuis le comptoir */
async function clientDetail(id) {
  const { c, usual, hist } = await clientData(id);
  return `<div class="modal-head"><h3>Fiche client</h3><button class="x-btn" data-close>${ico("x")}</button></div>
  <div class="modal-body">
    ${clientFicheBody(c, usual, hist)}
    <div style="display:flex;gap:10px;margin-top:20px">
      <button class="btn btn-ghost" data-editclient="${c.id}">Modifier la fiche</button>
      <button class="btn btn-primary" style="flex:1" data-sell="${c.id}">Démarrer une vente assurée</button>
    </div>
  </div>`;
}

/* ---------------------------------------------------------------------------
   Événements
   --------------------------------------------------------------------------- */
const CLICK_TARGETS =
  "[data-nav],[data-user],[data-k],[data-freq],[data-fol],[data-usual],[data-skipusual],[data-addcart]," +
  "[data-q],[data-rm],[data-detach],[data-validate],[data-clearcart],[data-newclient],[data-editclient]," +
  "[data-sell],[data-pickclient],[data-newproduct],[data-editproduct],[data-delproduct],[data-toggle]," +
  "[data-stock],[data-cats],[data-delcat],[data-import],[data-export],[data-newrule],[data-editrule]," +
  "[data-newuser],[data-toggleuser],[data-close],[data-savemodel],[data-model],[data-delmodel]," +
  "[data-saveprofile],[data-cat],[data-retry],[data-catmore],[data-type],[data-step],[data-newsale]," +
  "[data-settab],[data-clientrow]," +
  "[data-cancelsale],[data-slip],[data-freeline],[data-clearsearch]";

async function handleClick(d) {
  /* --- navigation générale --- */
  if (d.nav) return go(d.nav);
  if (d.retry !== undefined) return renderView();
  if (d.close !== undefined) return closeModal();
  if (d.user) {
    authSel = +d.user;
    authPin = "";
    return renderAuth();
  }
  if (d.k) return authKey(d.k);
  if (d.fol) return scrollFol(+d.fol);
  if (d.clearsearch !== undefined) {
    comptoirSearch = "";
    return renderView();
  }

  /* --- parcours de vente --- */
  if (d.newsale !== undefined) {
    if (sale.slip || !sale.lines.length) resetSale();
    return go("vente");
  }
  if (d.cancelsale !== undefined) {
    if (sale.lines.length && !(await confirmAction({
      title: "Abandonner cette vente ?",
      text: `Le panier en cours (${cartCount()} article(s)) sera vidé. Aucune vente n'aura été enregistrée.`,
      ok: "Abandonner la vente",
    })))
      return;
    resetSale();
    USUAL = null;
    toast("Vente abandonnée.");
    return go("comptoir");
  }
  if (d.type) {
    sale.type = d.type;
    sale.step = d.type === "assuree" ? 2 : 3;
    return renderView();
  }
  if (d.step) {
    sale.step = +d.step;
    return renderView();
  }
  if (d.validate !== undefined) return validateSale();
  if (d.slip !== undefined) return sale.slip && showBordereau(sale.slip);
  if (d.freeline !== undefined) return freeLineModal();
  if (d.skipusual !== undefined) {
    sale.step = 3;
    return renderView();
  }
  if (d.detach !== undefined) {
    sale.client = null;
    USUAL = null;
    return renderView();
  }
  if (d.pickclient) {
    sale.client = CCACHE.get(+d.pickclient) || (await api(`/clients/${+d.pickclient}`));
    USUAL = null;
    sale.type = "assuree";
    sale.step = 2;
    return renderView();
  }
  if (d.sell) {
    const c = CCACHE.get(+d.sell) || (await api(`/clients/${+d.sell}`));
    closeModal();
    USUAL = null;
    return startSale({ type: "assuree", client: c, step: 2 });
  }
  if (d.usual) {
    const id = +d.usual;
    const [c, usual] = await Promise.all([api(`/clients/${id}`), api(`/clients/${id}/usual-cart`)]);
    if (!usual.lines.length) return toast("Aucun panier habituel pour ce client.");
    closeModal();
    sale.type = "assuree";
    sale.client = c;
    sale.slip = null;
    sale.lines = usual.lines.map((l) => ({ p: l.product_id, name: l.name, price: l.price, q: l.quantity }));
    sale.step = 3;
    USUAL = usual;
    toast(`Panier habituel de ${prenom(c.first_name)} repris (${usual.lines.length} produits).`);
    return session.view === "vente" ? renderView() : go("vente");
  }
  if (d.addcart) {
    const p = PCACHE.get(+d.addcart);
    if (!p) return toast("Ce produit n'est plus affiché : relancez la recherche.", true);
    if (sale.slip) resetSale(); // la vente précédente est close : on en ouvre une nouvelle
    if (!saleStarted()) {
      sale.type = "simple";
      sale.step = 3;
    }
    addProduct(p, 1);
    closeModal();
    toast(`${p.name} ajouté au panier.`);
    return renderView({ keepScroll: true });
  }
  if (d.q !== undefined && d.line !== undefined) {
    const l = sale.lines[+d.line];
    if (l) l.q = Math.max(1, l.q + +d.q);
    return renderView({ keepScroll: true });
  }
  if (d.rm !== undefined) {
    sale.lines.splice(+d.rm, 1);
    return renderView({ keepScroll: true });
  }
  if (d.clearcart !== undefined) {
    if (!(await confirmAction({ title: "Vider le panier ?", text: "Tous les produits ajoutés seront retirés de cette vente.", ok: "Vider le panier" })))
      return;
    sale.lines = [];
    QUOTE = null;
    return renderView({ keepScroll: true });
  }
  if (d.savemodel !== undefined) {
    const name = await askText({
      title: "Enregistrer une vente récurrente",
      label: "Nom du modèle (ex. Ordonnance ALD, M. TCHALLA)",
      ok: "Enregistrer le modèle",
    });
    if (!name) return;
    const body = {
      name,
      lines: sale.lines.map((l) => (l.p !== null ? { product_id: l.p, quantity: l.q } : { name: l.name, price: l.price, quantity: l.q })),
    };
    if (sale.client) body.client_id = sale.client.id;
    await api("/sales/models", { method: "POST", body });
    toast("Modèle enregistré, rappelable en un clic.");
    return renderView({ keepScroll: true });
  }
  if (d.model) {
    const m = MODELS.find((x) => x.id == +d.model);
    if (!m) return;
    sale.lines = m.lines.map((l) => ({ p: l.product_id, name: l.name, price: l.price, q: l.quantity }));
    if (m.client_id && !sale.client) {
      sale.client = await api(`/clients/${m.client_id}`);
      sale.type = "assuree";
    }
    toast(`Modèle « ${m.name} » chargé dans le panier.`);
    return renderView({ keepScroll: true });
  }
  if (d.delmodel) {
    if (!(await confirmAction({ title: "Supprimer ce modèle ?", text: "Le modèle de vente récurrente ne sera plus proposé. Les ventes déjà enregistrées ne changent pas.", ok: "Supprimer le modèle" })))
      return;
    await api(`/sales/models/${+d.delmodel}`, { method: "DELETE" });
    toast("Modèle supprimé.");
    return renderView({ keepScroll: true });
  }
  if (d.cat) {
    const r = await api(`/products?category=${enc(d.cat)}&limit=200${sale.client ? `&client_id=${sale.client.id}` : ""}`);
    rememberP(r.items);
    return modal(`<div class="modal-head"><h3>Rayon : ${esc(d.cat)}</h3><button class="x-btn" data-close>${ico("x")}</button></div>
        <div class="modal-body"><div style="display:flex;flex-direction:column;gap:8px">${
          r.items
            .map(
              (p) => `<div class="pick">
            <div class="who"><div class="nm">${esc(p.name)}</div>
              <div class="meta">${fmt(p.price)} · ${p.stock > 0 ? p.stock + " en stock" : "en rupture"}</div></div>
            ${p.coverage ? covTag(p.coverage) : ""}
            <button class="btn btn-primary sm" data-addcart="${p.id}">Ajouter</button></div>`,
            )
            .join("") || '<p class="mini">Aucun produit dans ce rayon.</p>'
        }</div>${r.total > r.items.length ? `<p class="mini" style="margin-top:10px">${r.total} produits dans ce rayon : utilisez la recherche pour affiner.</p>` : ""}</div>`, null, "wide");
  }

  /* --- clients --- */
  if (d.clientrow) {
    clientsState.selectedId = +d.clientrow;
    const box = $("#clDetail");
    if (box) {
      document.querySelectorAll("#clList .list-row").forEach((el) => el.classList.toggle("on", el.dataset.clientrow === d.clientrow));
      box.innerHTML = `<div class="panel"><div class="loading-line"><span class="spin"></span> Ouverture de la fiche…</div></div>`;
      box.innerHTML = await clientFicheHTML(clientsState.selectedId);
    }
    return;
  }
  if (d.settab) {
    setTab = d.settab;
    return renderView();
  }
  if (d.freq) return modal(await clientDetail(+d.freq), null, "wide");
  if (d.newclient !== undefined) return clientModal(null);
  if (d.editclient) return clientModal(await api(`/clients/${+d.editclient}`));

  /* --- catalogue --- */
  if (d.newproduct !== undefined) return productModal(null);
  if (d.editproduct) {
    const p = PCACHE.get(+d.editproduct);
    return p ? productModal(p) : toast("Produit introuvable : actualisez le catalogue.", true);
  }
  if (d.delproduct) {
    const p = PCACHE.get(+d.delproduct);
    if (!p) return;
    if (
      !(await confirmAction({
        title: "Supprimer ce produit ?",
        text: `« <b>${esc(p.name)}</b> » sera définitivement retiré du catalogue OptiDesk. Les ventes déjà enregistrées le conservent. Winpharma n'est pas affecté.`,
        ok: "Supprimer définitivement",
      }))
    )
      return;
    try {
      await api(`/products/${p.id}`, { method: "DELETE" });
      toast("Produit supprimé du catalogue.");
      afterCatalogueChange();
    } catch (e) {
      toast(errMsg(e), true);
    }
    return;
  }
  if (d.stock !== undefined && d.pid !== undefined) {
    await api(`/products/${+d.pid}/stock`, { method: "PATCH", body: { delta: +d.stock } });
    return afterCatalogueChange();
  }
  if (d.toggle) {
    const p = PCACHE.get(+d.toggle);
    if (!p) return;
    await api(`/products/${p.id}/outofstock`, { method: "PATCH", body: { out_of_stock: p.stock > 0 } });
    toast(p.stock > 0 ? "Produit marqué en rupture." : "Produit réactivé.");
    return afterCatalogueChange();
  }
  if (d.catmore !== undefined) {
    catState.limit += 50;
    return refreshCatalogue();
  }
  if (d.cats !== undefined) return categoriesModal();
  if (d.delcat) {
    if (!(await confirmAction({ title: "Supprimer ce rayon ?", text: `Le rayon « ${esc(d.delcat)} » sera retiré du catalogue.`, ok: "Supprimer le rayon" }))) return;
    try {
      await api(`/categories/${enc(d.delcat)}`, { method: "DELETE" });
      toast("Rayon supprimé.");
      renderView({ keepScroll: true });
    } catch (e) {
      toast(errMsg(e), true);
    }
    return;
  }
  if (d.import !== undefined) return importModal();
  if (d.export !== undefined) return exportCSV();

  /* --- couverture, comptes, profil --- */
  if (d.newrule !== undefined) return ruleModal(null);
  if (d.editrule) return ruleModal(RULES.find((r) => r.id == +d.editrule));
  if (d.newuser !== undefined) return userModal();
  if (d.toggleuser) {
    const activate = d.active !== "1";
    if (
      !activate &&
      !(await confirmAction({
        title: "Désactiver ce compte ?",
        text: "La personne ne pourra plus se connecter. Ses actions passées restent dans le journal d'audit, et le compte peut être réactivé à tout moment.",
        ok: "Désactiver le compte",
      }))
    )
      return;
    await api(`/users/${+d.toggleuser}/active`, { method: "PATCH", body: { active: activate } });
    toast(activate ? "Compte réactivé." : "Compte désactivé.");
    return renderView({ keepScroll: true });
  }
  if (d.saveprofile !== undefined) {
    const nn = $("#setUserName").value.trim();
    const np = $("#setUserPin").value.trim();
    const body = {};
    if (nn && nn !== USER.name) body.name = nn;
    if (np) {
      if (!/^\d{4}$/.test(np)) return toast("Le code PIN doit contenir exactement 4 chiffres.", true);
      const old = await askText({
        title: "Confirmer le changement de PIN",
        label: "Saisissez votre code PIN actuel",
        type: "password",
        maxlength: 4,
        numeric: true,
        ok: "Confirmer",
      });
      if (!old) return;
      body.pin = np;
      body.old_pin = old;
    }
    if (pendingPhoto) body.photo = pendingPhoto;
    if (!Object.keys(body).length) return toast("Aucune modification à enregistrer.");
    USER = await api("/users/me", { method: "PATCH", body });
    pendingPhoto = null;
    renderUser();
    renderView({ keepScroll: true });
    return toast("Profil mis à jour.");
  }
}

document.addEventListener("click", (e) => {
  const t = e.target.closest(CLICK_TARGETS);
  if (t) {
    handleClick(t.dataset).catch((err) => toast(errMsg(err), true));
    return;
  }
  if (e.target.id === "photoDrop") return $("#photoInput").click();
  if (e.target.id === "createAccountBtn") return setAuthMode("signup");
  if (e.target.id === "authToLoginBtn") return setAuthMode("login");
  if (e.target.id === "authBack") {
    authSel = null;
    authPin = "";
    return renderAuth();
  }
  if (e.target.id === "authRetry") return showAuth();
});
$("#logoutBtn").onclick = () => logout();
$("#accountChip").onclick = () => go("parametres");

/* Recherches : anti-rebond, et on n'affiche que la réponse à la dernière frappe */
const searchClientsVente = debounce(async () => {
  const q = $("#clientSearch")?.value.trim();
  const box = $("#clientResults");
  if (!box) return;
  if (!q) return void (box.innerHTML = "");
  try {
    const list = await api(`/clients?q=${enc(q)}&limit=8`);
    rememberC(list);
    if ($("#clientSearch")?.value.trim() !== q || !$("#clientResults")) return;
    $("#clientResults").innerHTML =
      list.map(clientResultHTML).join("") ||
      `<div class="notice">${ico("empty", 16)}<div>Aucun client à ce nom.</div>
       <div class="right"><button class="btn btn-soft sm" data-newclient>Créer ce client</button></div></div>`;
  } catch (e) {
    toast(errMsg(e), true);
  }
});
const searchClientsList = debounce(async () => {
  const q = $("#clListSearch")?.value.trim();
  if (q === undefined) return;
  clientsState.q = q;
  try {
    const list = await api(`/clients?q=${enc(q)}&limit=100`);
    rememberC(list);
    if ($("#clListSearch")?.value.trim() !== q || !$("#clList")) return;
    $("#clList").innerHTML = clientListHTML(list);
  } catch (e) {
    toast(errMsg(e), true);
  }
});
const searchProductsVente = debounce(async () => {
  const q = $("#addSearch")?.value.trim();
  const box = $("#addResults");
  if (!box) return;
  if (!q) return void (box.innerHTML = "");
  try {
    const r = await api(`/products?q=${enc(q)}&limit=8&with_alternatives=true${sale.client ? `&client_id=${sale.client.id}` : ""}`);
    rememberP(r.items);
    if ($("#addSearch")?.value.trim() !== q || !$("#addResults")) return;
    $("#addResults").innerHTML = r.items.length
      ? r.items.map(resultHTML).join("")
      : `<div class="notice">${ico("empty", 16)}
         <div><b>Produit introuvable dans le catalogue</b>
         <div class="mini" style="color:inherit">Rien ne correspond à « ${esc(q)} ».</div></div>
         <div class="right"><button class="btn btn-soft sm" data-freeline>Ajouter manuellement</button></div></div>`;
  } catch (e) {
    toast(errMsg(e), true);
  }
});
document.addEventListener("input", (e) => {
  const id = e.target.id;
  if (id === "prodSearch") {
    comptoirSearch = e.target.value;
    refreshComptoirBody();
  }
  if (id === "clientSearch") searchClientsVente();
  if (id === "clListSearch") searchClientsList();
  if (id === "catSearch") {
    catState.q = e.target.value.trim();
    searchCatalogue();
  }
  if (id === "addSearch") searchProductsVente();
  if (id === "saleNote") sale.note = e.target.value;
  if (id === "saleDate") sale.date = e.target.value || todayISO();
});
document.addEventListener("change", (e) => {
  const id = e.target.id;
  if (id === "auditUser" || id === "auditPeriod") {
    auditFilter = { user: $("#auditUser").value, days: $("#auditPeriod").value };
    refreshAudit().catch((err) => toast(errMsg(err), true));
  }
  if (id === "catCategory") {
    catState.category = e.target.value;
    catState.limit = 50;
    refreshCatalogue().catch((err) => toast(errMsg(err), true));
  }
  if (id === "photoInput") {
    readPhoto(e, (f) => {
      pendingPhoto = f;
      $("#bigAvatar").innerHTML = `<img src="${f}">`;
      toast("Photo chargée : pensez à enregistrer.");
    });
  }
  if (e.target.dataset.impmap && IMPORT) recountImport(e.target.dataset.impmap, e.target.value);
});

(function boot() {
  $("#auth").style.display = "flex";
  showAuth();
  document.addEventListener("keydown", (e) => {
    if ($("#auth").style.display === "flex" && authSel && authMode === "login") {
      if (/^[0-9]$/.test(e.key)) authKey(e.key);
      else if (e.key === "Backspace") authKey("del");
      else if (e.key === "Enter") authKey("ok");
    }
    if (e.key === "Escape" && modalEl) closeModal();
  });
})();
window.__od3 = true;
