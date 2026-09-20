/* ---------------------------------------------------------------------------
   Fenêtres modales et utilitaires
   --------------------------------------------------------------------------- */
let modalEl = null;
let modalOnClose = null;
function modal(html, onClose = null) {
  closeModal();
  modalOnClose = onClose;
  modalEl = document.createElement("div");
  modalEl.className = "modal-bg";
  modalEl.innerHTML = `<div class="modal">${html}</div>`;
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
      <div class="field"><label>Code produit</label><input id="pCode" value="${esc(p.code)}"></div>
      <div class="field"><label>Catégorie / rayon</label><select id="pCat">${cats.map((c) => `<option ${c.name === p.category ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Prix de vente (FCFA) *</label><input id="pPrice" type="number" min="0" value="${p.price}"></div>
      <div class="field"><label>Quantité en stock</label><input id="pStock" type="number" min="0" value="${p.stock}"></div>
      <div class="field"><label>Date de péremption</label><input id="pExpiry" type="date" value="${esc(p.expiry || "")}"></div>
    </div>
    <div style="display:flex;gap:10px;margin-top:18px">
      <button class="btn btn-ghost" data-close>Annuler</button>
      <button class="btn btn-primary" style="flex:1" id="pSave">${isNew ? "Créer le produit" : "Enregistrer"}</button>
    </div>
  </div>`);
  $("#pSave").onclick = async () => {
    const name = $("#pName").value.trim(),
      priceRaw = $("#pPrice").value;
    if (!name || priceRaw === "" || !(+priceRaw >= 0)) {
      toast("Renseignez au moins le nom et le prix.", true);
      return;
    }
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
      <div class="field"><label>Validité de la couverture</label><input id="cVal" type="date" value="${esc(c.valid_until || "")}"></div>
      <div class="field"><label>Photo (optionnel)</label><div class="photo-drop" id="cPhotoDrop" style="padding:11px">${ico("camera", 14)} Choisir une photo</div><input type="file" id="cPhotoInput" accept="image/*" hidden></div>
    </div>
    <div style="display:flex;gap:10px;margin-top:18px">
      <button class="btn btn-ghost" data-close>Annuler</button>
      <button class="btn btn-primary" style="flex:1" id="cSave">${isNew ? "Créer le client" : "Enregistrer"}</button>
    </div>
  </div>`);
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
    if (!f || !l) {
      toast("Renseignez le nom de famille et le prénom.", true);
      return;
    }
    const body = {
      first_name: f,
      last_name: l,
      insurer: $("#cIns").value,
      policy_number: $("#cPol").value.trim(),
      valid_until: $("#cVal").value || null,
    };
    if (photo !== undefined) body.photo = photo;
    try {
      if (isNew) await api("/clients", { method: "POST", body });
      else await api(`/clients/${c.id}`, { method: "PATCH", body });
      closeModal();
      toast(isNew ? "Client créé, immédiatement utilisable au comptoir." : "Fiche mise à jour (modification journalisée).");
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
    <div class="two-col">
      <div class="field"><label>Organisme assureur</label><select id="rIns">${insurers.map((x) => `<option ${x === r.insurer ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div>
      <div class="field"><label>Périmètre</label><select id="rScope">${scopes.map((x) => `<option ${x === r.scope ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div>
      <div class="field"><label>Taux de prise en charge (%)</label><input id="rRate" type="number" min="0" max="100" value="${r.rate}"></div>
      <div class="field"><label>Exclusion (catégorie, optionnel)</label><input id="rExc" value="${esc(r.exclusion || "")}" placeholder="ex. Parapharmacie"></div>
    </div>
    <div class="field" style="margin-top:14px"><label>Note interne</label><input id="rNote" value="${esc(r.note || "")}"></div>
    <div style="display:flex;gap:10px;margin-top:18px">
      <button class="btn btn-ghost" data-close>Annuler</button>
      <button class="btn btn-primary" style="flex:1" id="rSave">Enregistrer la règle</button>
    </div>
  </div>`);
  $("#rSave").onclick = async () => {
    const rate = +$("#rRate").value;
    if ($("#rRate").value === "" || !(rate >= 0 && rate <= 100)) {
      toast("Le taux doit être compris entre 0 et 100.", true);
      return;
    }
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
      toast("Règle enregistrée, historisée dans le journal.");
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
    <div class="photo-drop" id="uPhotoDrop" style="margin-top:14px">${ico("camera", 16)} Photo de profil (optionnel)</div>
    <input type="file" id="uPhotoInput" accept="image/*" hidden>
    <div style="display:flex;gap:10px;margin-top:18px">
      <button class="btn btn-ghost" data-close>Annuler</button>
      <button class="btn btn-primary" style="flex:1" id="uSave">Créer le compte</button>
    </div>
  </div>`);
  let photo = null;
  $("#uPhotoDrop").onclick = () => $("#uPhotoInput").click();
  $("#uPhotoInput").onchange = (e) =>
    readPhoto(e, (f) => {
      photo = f;
      $("#uPhotoDrop").textContent = "Photo choisie";
    });
  $("#uSave").onclick = async () => {
    const name = $("#uName").value.trim(),
      pin = $("#uPin").value.trim();
    if (!name || !/^\d{4}$/.test(pin)) {
      toast("Renseignez le nom et un code PIN de 4 chiffres.", true);
      return;
    }
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
let authMode = "login", // "login" (PIN) ou "signup" (création de compte autorisée par le titulaire)
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
    if (!name || !/^\d{4}$/.test(p)) {
      toast("Renseignez le nom et un code PIN de 4 chiffres.", true);
      return;
    }
    if (!/^\d{4}$/.test(ap)) {
      toast("Le PIN du titulaire est nécessaire pour autoriser la création du compte.", true);
      return;
    }
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
  if (authMode === "signup") {
    renderSignup();
    return;
  }
  if (authSel) {
    const u = ACCOUNTS.find((x) => x.id === authSel);
    if (!u) {
      authSel = null;
      renderAuth();
      return;
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
  if (k === "del") {
    authPin = authPin.slice(0, -1);
  } else if (k === "ok") {
    submitPin();
    return;
  } else if (/^\d$/.test(k) && authPin.length < 4) {
    authPin += k;
  }
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
  cart = { client: null, lines: [] };
  QUOTE = null;
  manForm = null;
  comptoirSearch = "";
  closeModal();
  stopCarousel();
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
async function clientDetail(id) {
  const [c, usual, hist] = await Promise.all([
    api(`/clients/${id}`),
    api(`/clients/${id}/usual-cart`),
    api(`/sales?client_id=${id}&page_size=5`),
  ]);
  return `<div class="modal-head"><h3>Fiche client</h3><button class="x-btn" data-close>${ico("x")}</button></div>
  <div class="modal-body">
    <div style="display:flex;gap:15px;align-items:center">
      <div class="avatar" style="width:60px;height:60px;font-size:18px">${avatarHTML(c)}</div>
      <div style="flex:1"><b style="font-size:17px">${esc(cname(c))}</b>
      <div style="margin-top:5px">${c.coverage_alert ? `<span class="tag warn">Couverture à vérifier (valide jusqu'au ${fmtD(c.valid_until)})</span>` : c.valid_until ? `<span class="tag ok">Couverture valide jusqu'au ${fmtD(c.valid_until)}</span>` : `<span class="tag">Validité non renseignée</span>`}</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px">
      <div style="padding:12px;background:var(--side);border-radius:11px"><div class="mini">Organisme</div><b>${esc(c.insurer)}</b></div>
      <div style="padding:12px;background:var(--side);border-radius:11px"><div class="mini">Numéro d'assuré</div><b>${esc(c.policy_number || "·")}</b></div>
    </div>
    ${
      usual.lines.length
        ? `<div style="margin-top:16px"><b style="font-size:14px">Produits achetés habituellement</b>
      <div style="margin-top:8px;display:flex;flex-direction:column;gap:7px">${usual.lines
        .map(
          (x) => `
        <div style="display:flex;align-items:center;gap:10px;padding:9px 11px;background:var(--side);border-radius:10px;font-size:13px">
          <span style="flex:1">${esc(x.name)}</span><b>×${x.quantity}</b>${covTag(x.coverage)}</div>`,
        )
        .join("")}</div>
      <button class="btn btn-primary lg" style="width:100%;margin-top:12px" data-usual="${c.id}">Reprendre le panier habituel</button></div>`
        : ""
    }
    ${
      hist.items.length
        ? `<div style="margin-top:16px"><b style="font-size:14px">Dernières ventes</b>
      <div style="margin-top:8px">${hist.items.map((s) => `<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--line);font-size:13px"><span>${esc(s.reference)} · ${fmtD(s.date)}</span><b>${fmt(s.totals.gross_total)}</b></div>`).join("")}</div></div>`
        : ""
    }
    <div style="display:flex;gap:10px;margin-top:18px">
      <button class="btn btn-ghost" data-editclient="${c.id}">Modifier</button>
      <button class="btn btn-primary" style="flex:1" data-sell="${c.id}">Nouvelle vente assurée</button>
    </div>
  </div>`;
}

/* ---------------------------------------------------------------------------
   Événements
   --------------------------------------------------------------------------- */
const CLICK_TARGETS =
  "[data-nav],[data-gov],[data-user],[data-k],[data-freq],[data-fol],[data-usual],[data-addcart],[data-q],[data-line],[data-rm],[data-detach],[data-validate],[data-clearcart],[data-newclient],[data-editclient],[data-sell],[data-newproduct],[data-editproduct],[data-delproduct],[data-toggle],[data-stock],[data-cats],[data-delcat],[data-import],[data-export],[data-newrule],[data-editrule],[data-newuser],[data-toggleuser],[data-close],[data-savemodel],[data-model],[data-delmodel],[data-saveprofile],[data-cat],[data-addline],[data-rmline],[data-saveman],[data-resetman],[data-retry],[data-catmore]";

async function handleClick(d) {
  if (d.nav) return go(d.nav);
  if (d.gov) return go(d.gov);
  if (d.retry !== undefined) return renderView();
  if (d.user) {
    authSel = +d.user;
    authPin = "";
    return renderAuth();
  }
  if (d.k) return authKey(d.k);
  if (d.fol) return scrollFol(+d.fol);
  if (d.freq) return modal(await clientDetail(+d.freq));
  if (d.usual) {
    const id = +d.usual;
    const [c, usual] = await Promise.all([api(`/clients/${id}`), api(`/clients/${id}/usual-cart`)]);
    if (!usual.lines.length) return toast("Aucun panier habituel pour ce client.");
    cart = {
      client: c,
      lines: usual.lines.map((l) => ({ p: l.product_id, name: l.name, price: l.price, q: l.quantity })),
    };
    closeModal();
    toast(`Panier habituel de ${prenom(c.first_name)} reconstitué (${usual.lines.length} produits).`);
    return go("vente");
  }
  if (d.addcart) {
    const p = PCACHE.get(+d.addcart);
    if (!p) return toast("Produit introuvable : relancez la recherche.", true);
    addProduct(p, 1);
    toast("Produit ajouté au panier.");
    closeModal();
    if (session.view !== "vente") return go("vente");
    return renderView({ keepScroll: true });
  }
  if (d.q !== undefined && d.line !== undefined) {
    const l = cart.lines[+d.line];
    if (l) {
      l.q = Math.max(1, l.q + +d.q);
      return renderView({ keepScroll: true });
    }
    return;
  }
  if (d.rm !== undefined) {
    cart.lines.splice(+d.rm, 1);
    return renderView({ keepScroll: true });
  }
  if (d.detach !== undefined) {
    cart.client = null;
    return renderView({ keepScroll: true });
  }
  if (d.validate !== undefined) return validateQuickSale();
  if (d.clearcart !== undefined) {
    cart.lines = [];
    return renderView({ keepScroll: true });
  }
  if (d.newclient !== undefined) return clientModal(null);
  if (d.editclient) return clientModal(await api(`/clients/${+d.editclient}`));
  if (d.sell) {
    cart = { client: await api(`/clients/${+d.sell}`), lines: [] };
    closeModal();
    return go("vente");
  }
  if (d.newproduct !== undefined) return productModal(null);
  if (d.editproduct) {
    const p = PCACHE.get(+d.editproduct);
    return p ? productModal(p) : toast("Produit introuvable : actualisez le catalogue.", true);
  }
  if (d.cats !== undefined) return categoriesModal();
  if (d.delcat) {
    await api(`/categories/${enc(d.delcat)}`, { method: "DELETE" });
    closeModal();
    toast("Catégorie supprimée.");
    return renderView({ keepScroll: true });
  }
  if (d.delproduct) {
    const p = PCACHE.get(+d.delproduct);
    if (!p) return;
    modal(`<div class="modal-head"><h3>Supprimer ce produit ?</h3><button class="x-btn" data-close>${ico("x")}</button></div>
        <div class="modal-body"><p>« <b>${esc(p.name)}</b> » sera définitivement retiré du catalogue OptiDesk. Winpharma n'est pas affecté.</p>
        <div style="display:flex;gap:10px;margin-top:16px"><button class="btn btn-ghost" data-close>Annuler</button>
        <button class="btn btn-danger" style="flex:1" id="delOk">Supprimer définitivement</button></div></div>`);
    $("#delOk").onclick = async () => {
      try {
        await api(`/products/${p.id}`, { method: "DELETE" });
        closeModal();
        toast("Produit supprimé.");
        afterCatalogueChange();
      } catch (e) {
        toast(errMsg(e), true);
      }
    };
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
  if (d.import !== undefined) return importModal();
  if (d.export !== undefined) return exportCSV();
  if (d.newrule !== undefined) return ruleModal(null);
  if (d.editrule) return ruleModal(RULES.find((r) => r.id == +d.editrule));
  if (d.newuser !== undefined) return userModal();
  if (d.toggleuser) {
    const activate = d.active !== "1";
    await api(`/users/${+d.toggleuser}/active`, { method: "PATCH", body: { active: activate } });
    toast(activate ? "Compte réactivé." : "Compte désactivé.");
    return renderView({ keepScroll: true });
  }
  if (d.close !== undefined) return closeModal();
  if (d.savemodel !== undefined) {
    const name = await askText({
      title: "Vente récurrente",
      label: "Nom du modèle (ex. Ordonnance ALD, M. TCHALLA)",
      ok: "Enregistrer le modèle",
    });
    if (!name) return;
    const body = {
      name,
      lines: cart.lines.map((l) =>
        l.p !== null
          ? { product_id: l.p, quantity: l.q }
          : { name: l.name, price: l.price, quantity: l.q },
      ),
    };
    if (cart.client) body.client_id = cart.client.id;
    await api("/sales/models", { method: "POST", body });
    toast("Modèle enregistré, rappelable en un clic.");
    return renderView({ keepScroll: true });
  }
  if (d.model) {
    const m = MODELS.find((x) => x.id == +d.model);
    if (!m) return;
    cart.lines = m.lines.map((l) => ({ p: l.product_id, name: l.name, price: l.price, q: l.quantity }));
    if (m.client_id && !cart.client) cart.client = await api(`/clients/${m.client_id}`);
    toast(`Modèle « ${m.name} » chargé.`);
    return renderView({ keepScroll: true });
  }
  if (d.delmodel) {
    await api(`/sales/models/${+d.delmodel}`, { method: "DELETE" });
    return renderView({ keepScroll: true });
  }
  if (d.cat) {
    const r = await api(`/products?category=${enc(d.cat)}&limit=200`);
    rememberP(r.items);
    return modal(`<div class="modal-head"><h3>Rayon : ${esc(d.cat)}</h3><button class="x-btn" data-close>${ico("x")}</button></div>
        <div class="modal-body"><div style="display:flex;flex-direction:column;gap:8px">${
          r.items
            .map(
              (p) => `
          <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--side);border-radius:11px">
            <div style="flex:1"><b style="font-size:13.5px">${esc(p.name)}</b><div class="mini">${fmt(p.price)} · ${p.stock > 0 ? p.stock + " en stock" : "rupture"}</div></div>
            <button class="btn btn-primary sm" data-addcart="${p.id}" data-close>Ajouter</button></div>`,
            )
            .join("") || '<p class="mini">Aucun produit dans ce rayon.</p>'
        }</div>${r.total > r.items.length ? `<p class="mini" style="margin-top:10px">${r.total} produits dans ce rayon : utilisez la recherche pour affiner.</p>` : ""}</div>`);
  }
  if (d.saveprofile !== undefined) {
    const nn = $("#setUserName").value.trim();
    const np = $("#setUserPin").value.trim();
    const body = {};
    if (nn && nn !== USER.name) body.name = nn;
    if (np) {
      if (!/^\d{4}$/.test(np)) return toast("Le PIN doit contenir exactement 4 chiffres.", true);
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
  if (d.addline !== undefined) {
    manForm.lines.push({ name: "", price: "", q: 1 });
    return renderView({ keepScroll: true });
  }
  if (d.rmline) {
    manForm.lines.splice(+d.rmline, 1);
    return renderView({ keepScroll: true });
  }
  if (d.resetman !== undefined) {
    manForm = defaultManForm();
    return renderView({ keepScroll: true });
  }
  if (d.saveman !== undefined) return submitManualSale();
}

document.addEventListener("click", (e) => {
  const t = e.target.closest(CLICK_TARGETS);
  if (t) {
    handleClick(t.dataset).catch((err) => toast(errMsg(err), true));
    return;
  }
  if (e.target.id === "photoDrop") {
    $("#photoInput").click();
    return;
  }
  if (e.target.id === "createAccountBtn") {
    setAuthMode("signup");
    return;
  }
  if (e.target.id === "authToLoginBtn") {
    setAuthMode("login");
    return;
  }
  if (e.target.id === "authBack") {
    authSel = null;
    authPin = "";
    renderAuth();
    return;
  }
  if (e.target.id === "authRetry") {
    showAuth();
    return;
  }
});
$("#logoutBtn").onclick = () => logout();
$("#accountChip").onclick = () => go("parametres");

/* Recherches : anti-rebond, et on n'affiche que la réponse à la dernière frappe */
const searchClientsVente = debounce(async () => {
  const q = $("#clientSearch")?.value.trim();
  const box = $("#clientResults");
  if (!box) return;
  if (!q) {
    box.innerHTML = "";
    return;
  }
  try {
    const list = await api(`/clients?q=${enc(q)}&limit=8`);
    rememberC(list);
    if ($("#clientSearch")?.value.trim() !== q) return;
    $("#clientResults").innerHTML =
      list.map(clientResultHTML).join("") || '<p class="mini" style="padding:6px 2px">Aucun client trouvé.</p>';
  } catch (e) {
    toast(errMsg(e), true);
  }
});
const searchClientsList = debounce(async () => {
  const q = $("#clListSearch")?.value.trim();
  if (q === undefined) return;
  try {
    const list = await api(`/clients?q=${enc(q)}&limit=100`);
    rememberC(list);
    if ($("#clListSearch")?.value.trim() !== q || !$("#clList")) return;
    $("#clList").innerHTML =
      list.map((cl) => clientCardHTML(cl)).join("") || `<div class="card empty">Aucun client trouvé.</div>`;
  } catch (e) {
    toast(errMsg(e), true);
  }
});
const searchProductsVente = debounce(async () => {
  const q = $("#addSearch")?.value.trim();
  const box = $("#addResults");
  if (!box) return;
  if (!q) {
    box.innerHTML = "";
    return;
  }
  try {
    const r = await api(`/products?q=${enc(q)}&limit=6`);
    rememberP(r.items);
    if ($("#addSearch")?.value.trim() !== q || !$("#addResults")) return;
    $("#addResults").innerHTML =
      r.items
        .map(
          (p) => `<button class="add-result" data-addcart="${p.id}">
      <div style="flex:1"><b style="font-size:13.5px">${esc(p.name)}</b><div class="mini">${esc(p.category)} · ${fmt(p.price)}</div></div>
      ${p.stock > 0 ? `<span class="tag ok">${p.stock}</span>` : `<span class="tag bad">Rupture</span>`}
      <b style="color:var(--deep)">+</b></button>`,
        )
        .join("") ||
      '<p class="mini" style="padding:6px 2px">Aucun produit. Utilisez la vente manuelle.</p>';
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
  if (e.target.dataset.mline !== undefined) {
    const i = +e.target.dataset.mline,
      f = e.target.dataset.f;
    manForm.lines[i][f] = e.target.value;
    const total = manForm.lines.reduce((t, l) => t + (+l.price || 0) * (+l.q || 0), 0);
    const el = e.target.closest(".card").querySelector('b[style*="18px"]');
    if (el) el.textContent = fmt(total);
  }
  if (id === "manType") {
    manForm.type = e.target.value;
    renderView({ keepScroll: true });
  }
  if (id === "manClient") manForm.clientId = e.target.value;
  if (id === "manNote") manForm.note = e.target.value;
  if (id === "manDate") manForm.date = e.target.value;
});
document.addEventListener("change", (e) => {
  const id = e.target.id;
  if (id === "auditUser" || id === "auditPeriod") {
    auditFilter = { user: $("#auditUser").value, days: $("#auditPeriod").value };
    refreshAudit().catch((err) => toast(errMsg(err), true));
  }
  if (id === "photoInput") {
    readPhoto(e, (f) => {
      pendingPhoto = f;
      $("#bigAvatar").innerHTML = `<img src="${f}">`;
      toast("Photo chargée, pensez à enregistrer.");
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
  });
})();
window.__od3 = true;
