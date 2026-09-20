/* ===========================================================================
   app2.js — l'assistant de vente (cœur du produit) et les pages de gestion
   =========================================================================== */

/* ---------------------------------------------------------------------------
   Assistant de vente : 01 Type → 02 Client → 03 Produits → 04 Vérification
   --------------------------------------------------------------------------- */
let MODELS = []; // modèles de vente récurrente proposés à l'étape Produits
let USUAL = null; // panier habituel du client sélectionné

function saleSteps() {
  return sale.type === "assuree"
    ? [
        { s: 1, t: "Type de vente", d: "Assurée" },
        {
          s: 2,
          t: "Client",
          d: sale.client ? cname(sale.client) : "À identifier",
        },
        {
          s: 3,
          t: "Produits",
          d: sale.lines.length ? `${cartCount()} article(s)` : "Panier vide",
        },
        { s: 4, t: "Vérification", d: "Avant enregistrement" },
      ]
    : [
        { s: 1, t: "Type de vente", d: "Simple" },
        {
          s: 3,
          t: "Produits",
          d: sale.lines.length ? `${cartCount()} article(s)` : "Panier vide",
        },
        { s: 4, t: "Vérification", d: "Avant enregistrement" },
      ];
}
function stepperHTML() {
  return `<div class="stepper" role="list">${saleSteps()
    .map((x, i) => {
      const state =
        x.s === sale.step ? "current" : x.s < sale.step ? "done" : "todo";
      const clickable =
        state === "done" ||
        (state === "todo" && x.s === 3 && sale.lines.length);
      return `<button class="step ${state}" role="listitem" ${clickable ? `data-step="${x.s}"` : "disabled"}>
        <span class="n">${String(i + 1).padStart(2, "0")}</span>
        <span>${esc(x.t)}<small>${esc(x.d)}</small></span></button>`;
    })
    .join("")}</div>`;
}
function saleHead(title, sub) {
  return `<div class="page-head">
    <div><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div></div>
    <div class="actions">${saleStarted() ? `<button class="btn btn-ghost" data-cancelsale>Abandonner cette vente</button>` : ""}</div>
  </div>`;
}

async function vVente() {
  if (sale.slip) return venteDone();
  if (!sale.type) return venteStep1();
  if (sale.step === 2) return venteStep2();
  if (sale.step === 4) return venteStep4();
  return venteStep3();
}

/* --- Étape 1 : quel type de vente ? ------------------------------------- */
function venteStep1() {
  return `<div class="view-anim">
    ${saleHead("Nouvelle vente", "Deux parcours différents : le premier se règle au prix plein, le second calcule la prise en charge.")}
    ${stepperHTML()}
    <div class="section-head"><h2>Quel type de vente souhaitez-vous effectuer ?</h2></div>
    <div class="choice-grid">
      <button class="choice" data-type="simple">
        <span class="ic">${ico("bag", 26)}</span>
        <b>Vente simple</b>
        <p>Vente sans prise en charge par une assurance. Le client règle le prix plein.</p>
        <span class="go">Choisir les produits ${ico("chevR", 14)}</span>
      </button>
      <button class="choice accent" data-type="assuree">
        <span class="ic">${ico("shield", 26)}</span>
        <b>Vente assurée</b>
        <p>Vérifier la couverture et calculer la part patient pour un client INAM, AMU ou assurance privée.</p>
        <span class="go">Identifier le client ${ico("chevR", 14)}</span>
      </button>
    </div>
    <p class="mini" style="margin-top:16px">La facture officielle reste émise dans Winpharma : OptiDesk prépare la vente et vous remet un bordereau à ressaisir.</p>
  </div>`;
}

/* --- Étape 2 : quel est le client ? ------------------------------------- */
async function venteStep2() {
  const c = sale.client;
  if (c) {
    USUAL = await api(`/clients/${c.id}/usual-cart`);
    const lines = USUAL.lines;
    return `<div class="view-anim">
      ${saleHead("Vente assurée", "Client identifié. Vous pouvez repartir de ses produits habituels.")}
      ${stepperHTML()}
      <div class="client-hero">
        <div class="avatar" style="width:56px;height:56px;font-size:17px">${avatarHTML(c)}</div>
        <div class="who">
          <div class="nm">${esc(cname(c))}</div>
          <div class="meta">${esc(c.insurer)} · N° ${esc(c.policy_number || "non renseigné")}</div>
        </div>
        ${c.coverage_alert ? `<span class="status warn">Validité dépassée le ${fmtD(c.valid_until)}</span>` : c.valid_until ? `<span class="status ok">Couverture valide jusqu'au ${fmtD(c.valid_until)}</span>` : `<span class="status neutral">Validité non renseignée</span>`}
        <button class="btn btn-ghost sm" data-detach>Changer de client</button>
      </div>
      ${
        lines.length
          ? `<div class="section">
        <div class="section-head"><h2>Produits habituellement achetés</h2><span class="hint">d'après ses ventes enregistrées dans OptiDesk</span></div>
        <div class="panel flush">
          <div class="panel-body">
            ${lines
              .map(
                (l) => `<div class="cart-line">
              <div class="who"><div class="nm">${esc(l.name)}</div>
                <div class="meta">${fmt(l.price)} × ${l.quantity} · ${l.availability === "rupture" ? "en rupture" : `${l.stock} en stock`}</div></div>
              ${covTag(l.coverage)}
              <div class="amt">${fmt(l.price * l.quantity)}</div></div>`,
              )
              .join("")}
          </div>
          <div class="panel-head" style="border-bottom:none;border-top:1px solid var(--line)">
            <div><b>${fmt(USUAL.totals.gross_total)}</b> <span class="mini">dont ${fmt(USUAL.totals.patient_share)} à la charge du client</span></div>
            <div class="right">
              <button class="btn btn-ghost" data-skipusual>Choisir d'autres produits</button>
              <button class="btn btn-primary lg" data-usual="${c.id}">Ajouter le panier habituel (${lines.length})</button>
            </div>
          </div>
        </div>
      </div>`
          : `<div class="section">${emptyState(
              "cart",
              "Pas encore de panier habituel",
              "Ce client n'a pas d'achat récurrent enregistré dans OptiDesk. Ses produits habituels se construiront au fil des ventes.",
              `<button class="btn btn-primary" data-skipusual>Choisir les produits</button>`,
            )}</div>`
      }
    </div>`;
  }

  const freq = await api("/clients/frequent?limit=8");
  rememberC(freq);
  return `<div class="view-anim">
    ${saleHead("Vente assurée", "Identifiez le client pour calculer sa prise en charge.")}
    ${stepperHTML()}
    <div class="section-head"><h2>Quel est le client ?</h2>
      <div class="right"><button class="btn btn-ghost" data-newclient>${ico("plus", 14)} Nouveau client</button></div>
    </div>
    <div class="hero-search">${ico("search", 19)}
      <input id="clientSearch" placeholder="Rechercher un client par nom, organisme ou n° d'assuré…" autocomplete="off">
    </div>
    <div id="clientResults" style="margin-top:12px;display:flex;flex-direction:column;gap:8px"></div>
    <div class="section">
      <div class="section-head"><h2>Clients fréquents</h2></div>
      ${
        freq.length
          ? `<div style="display:flex;flex-direction:column;gap:8px">${freq.map(clientResultHTML).join("")}</div>`
          : emptyState(
              "users",
              "Aucun client assuré enregistré",
              "Créez la fiche du client : prénom, nom, organisme et numéro d'assuré suffisent pour commencer.",
              `<button class="btn btn-primary" data-newclient>Ajouter un client assuré</button>`,
            )
      }
    </div>
  </div>`;
}

/* --- Étape 3 : les produits --------------------------------------------- */
async function venteStep3() {
  const c = sale.client;
  const [cats, models] = await Promise.all([
    api("/categories"),
    api("/sales/models" + (c ? `?client_id=${c.id}` : "")),
  ]);
  MODELS = models;
  if (c && !sale.lines.length && !USUAL)
    USUAL = await api(`/clients/${c.id}/usual-cart`).catch(() => null);
  await refreshQuote();
  return `<div class="view-anim">
    ${saleHead(
      c ? `Vente assurée — ${cname(c)}` : "Vente simple",
      "Cherchez un produit, parcourez un rayon, ou reprenez un modèle récurrent.",
    )}
    ${stepperHTML()}
    <div class="vente-grid">
      <div>
        ${
          c
            ? `<div class="client-hero" style="margin-bottom:16px;padding:14px 18px">
          <div class="avatar">${avatarHTML(c)}</div>
          <div class="who"><div class="nm" style="font-size:15px">${esc(cname(c))}</div>
            <div class="meta">${esc(c.insurer)} · N° ${esc(c.policy_number || "non renseigné")}</div></div>
          <button class="btn btn-ghost sm" data-step="2">Changer de client</button></div>`
            : ""
        }
        ${
          c && USUAL?.lines.length && !sale.lines.length
            ? `<div class="notice" style="margin-bottom:16px">${ico("cart", 17)}
          <div><b>Panier habituel disponible</b><div class="mini" style="color:inherit">${USUAL.lines.map((u) => esc(u.name)).join(" · ")}</div></div>
          <div class="right"><button class="btn btn-primary sm" data-usual="${c.id}">Ajouter le panier habituel</button></div></div>`
            : ""
        }
        <div class="hero-search">${ico("search", 19)}
          <input id="addSearch" placeholder="Rechercher un produit : nom, DCI ou code…" autocomplete="off">
        </div>
        <div id="addResults" style="margin-top:12px;display:flex;flex-direction:column;gap:8px"></div>
        <div class="section" style="margin-top:18px">
          <div class="section-head"><h2>Parcourir par rayon</h2></div>
          <div class="chip-select">${cats.map((cat) => `<button data-cat="${esc(cat.name)}">${esc(cat.name)}</button>`).join("")}</div>
        </div>
        ${
          models.length
            ? `<div class="section">
          <div class="section-head"><h2>Modèles de vente récurrente</h2><span class="hint">ordonnances chroniques enregistrées</span></div>
          <div class="chip-select">${models.map((m) => `<button data-model="${m.id}">${esc(m.name)} · ${m.lines.length} produit(s)</button>`).join("")}</div>
        </div>`
            : ""
        }
        <div class="section">
          <div class="notice">${ico("empty", 17)}
            <div><b>Un produit n'est pas dans le catalogue ?</b>
            <div class="mini" style="color:inherit">Ajoutez-le à la main pour ne jamais bloquer une vente ; il reste hors catalogue et n'y sera pas créé.</div></div>
            <div class="right"><button class="btn btn-soft sm" data-freeline>Ajouter un produit hors catalogue</button></div>
          </div>
        </div>
      </div>
      <div class="cart-panel">${cartPanelHTML()}</div>
    </div>
  </div>`;
}

/* Le panier, visible en permanence pendant la préparation */
function cartPanelHTML() {
  const c = sale.client;
  const t = QUOTE?.totals || {
    gross_total: 0,
    insurer_share: 0,
    patient_share: 0,
  };
  return `<div class="panel flush">
    <div class="panel-head">
      <b>Panier</b>
      ${c ? `<span class="status ok">Vente assurée</span>` : `<span class="status neutral">Vente simple</span>`}
      <div class="right mini">${cartCount()} article(s)</div>
    </div>
    <div class="panel-body">
      ${
        sale.lines.length
          ? sale.lines
              .map((l, i) => {
                const ql = QUOTE?.lines?.[i];
                const price = ql ? ql.price : l.price;
                return `<div class="cart-line">
          <div class="who">
            <div class="nm">${esc(l.name)}${l.p === null ? ' <span class="tag violet">hors catalogue</span>' : ""}</div>
            <div class="meta">${fmt(price)} l'unité${c && ql?.coverage ? " · " + (ql.coverage.status === "none" ? "non couvert" : `couvert à ${ql.coverage.rate} %`) : ""}</div>
          </div>
          <span class="qty"><button data-q="-1" data-line="${i}" aria-label="Retirer un">${ico("minus", 13)}</button><span>${l.q}</span><button data-q="1" data-line="${i}" aria-label="Ajouter un">${ico("plus", 13)}</button></span>
          <div class="amt">${fmt(price * l.q)}</div>
          <button class="x-btn danger" data-rm="${i}" aria-label="Retirer du panier">${ico("x", 13)}</button>
        </div>`;
              })
              .join("")
          : `<div class="empty-state" style="border:none;padding:24px 8px">
             <div class="ic">${ico("cart", 22)}</div><b>Votre panier est vide</b>
             <p>Cherchez un produit ci-contre ou parcourez un rayon pour le remplir.</p></div>`
      }
    </div>
    ${
      sale.lines.length
        ? `<div class="panel-foot" style="display:block">
      <div class="recap">
        <div class="row"><span class="lbl">Montant brut</span><b>${fmt(t.gross_total)}</b></div>
        ${
          c
            ? `<div class="row"><span class="lbl">Part ${esc(c.insurer)}</span><b style="color:var(--deep)">− ${fmt(t.insurer_share)}</b></div>
        <div class="row total"><span class="lbl">Reste à charge</span><b>${fmt(t.patient_share)}</b></div>`
            : `<div class="row total"><span class="lbl">À régler</span><b>${fmt(t.gross_total)}</b></div>`
        }
      </div>
      <button class="btn btn-primary lg block" style="margin-top:14px" data-step="4">Vérifier la vente</button>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-ghost sm" style="flex:1" data-savemodel>Enregistrer comme modèle</button>
        <button class="btn btn-ghost sm" data-clearcart>Vider</button>
      </div>
    </div>`
        : `<div class="panel-foot"><button class="btn btn-primary block" data-step="4" disabled>Vérifier la vente</button></div>`
    }
  </div>`;
}

/* --- Étape 4 : vérifier avant d'enregistrer ------------------------------ */
async function venteStep4() {
  await refreshQuote();
  const c = sale.client;
  const t = QUOTE?.totals || {
    gross_total: 0,
    insurer_share: 0,
    patient_share: 0,
  };
  const lines = QUOTE?.lines || [];
  return `<div class="view-anim">
    ${saleHead("Vérifier la vente", "Dernier contrôle avant enregistrement dans OptiDesk.")}
    ${stepperHTML()}
    <div class="vente-grid">
      <div class="panel flush">
        <div class="panel-head"><b>${c ? "Client assuré" : "Vente simple"}</b>
          <div class="right">${c ? `<button class="btn btn-ghost sm" data-step="2">Modifier le client</button>` : ""}</div>
        </div>
        <div class="panel-body">
          ${
            c
              ? `<div class="kv">
            <div><div class="lbl">Client</div><b>${esc(cname(c))}</b></div>
            <div><div class="lbl">Organisme</div><b>${esc(c.insurer)}</b></div>
            <div><div class="lbl">N° d'assuré</div><b>${esc(c.policy_number || "non renseigné")}</b></div>
            <div><div class="lbl">Validité</div><b>${fmtD(c.valid_until, "non renseignée")}</b></div>
          </div>${c.coverage_alert ? `<div class="notice warn" style="margin-top:12px">${ico("alert", 16)}<div>La couverture de ce client est arrivée à échéance : vérifiez auprès de lui avant la délivrance.</div></div>` : ""}`
              : `<p class="lead">Vente sans prise en charge : le client règle le prix plein.</p>`
          }
        </div>
        <div class="panel-head" style="border-top:1px solid var(--line)"><b>Produits</b>
          <div class="right"><button class="btn btn-ghost sm" data-step="3">Modifier les produits</button></div>
        </div>
        <div class="table-wrap">
          <table><thead><tr><th>Produit</th><th style="text-align:center">Qté</th><th style="text-align:right">Prix unitaire</th>${c ? "<th>Couverture</th>" : ""}<th style="text-align:right">Total</th></tr></thead>
          <tbody>${lines
            .map(
              (
                l,
              ) => `<tr><td><b>${esc(l.name)}</b>${l.product_id === null ? ' <span class="tag violet">hors catalogue</span>' : ""}</td>
            <td style="text-align:center">${l.quantity}</td>
            <td style="text-align:right">${fmt(l.price)}</td>
            ${c ? `<td>${l.coverage ? covTag(l.coverage) : '<span class="mini">non calculable</span>'}</td>` : ""}
            <td style="text-align:right"><b>${fmt(l.total)}</b></td></tr>`,
            )
            .join("")}</tbody></table>
        </div>
        <div class="panel-body" style="border-top:1px solid var(--line)">
          <div class="form-grid">
            <div class="field"><label>Date de la vente</label>
              <input type="date" id="saleDate" value="${esc(sale.date)}" max="${todayISO()}">
              <div class="help">À changer uniquement pour enregistrer une vente passée.</div></div>
            <div class="field"><label>Note interne (facultative)</label>
              <input id="saleNote" value="${esc(sale.note)}" maxlength="300" placeholder="ex. ordonnance du Dr Amegah"></div>
          </div>
        </div>
      </div>

      <div class="cart-panel">
        <div class="panel">
          <b style="font-size:16px">Montants</b>
          <div class="recap" style="margin-top:16px">
            <div class="row"><span class="lbl">Montant brut</span><b>${fmt(t.gross_total)}</b></div>
            ${
              c
                ? `<div class="row"><span class="lbl">Pris en charge (estimation)</span><b style="color:var(--deep)">${fmt(t.insurer_share)}</b></div>
            <div class="row total"><span class="lbl">Reste à charge du patient</span><b>${fmt(t.patient_share)}</b></div>`
                : `<div class="row total"><span class="lbl">À régler</span><b>${fmt(t.gross_total)}</b></div>`
            }
          </div>
          <button class="btn btn-primary xl block" style="margin-top:20px" data-validate>Enregistrer la vente</button>
          <button class="btn btn-ghost block" style="margin-top:8px" data-step="3">Modifier</button>
          <p class="mini" style="margin-top:14px">L'enregistrement reste dans OptiDesk. La facturation officielle et la télétransmission se font dans Winpharma, à partir du bordereau.</p>
        </div>
      </div>
    </div>
  </div>`;
}

/* --- Vente enregistrée --------------------------------------------------- */
function venteDone() {
  const s = sale.slip;
  const c = s.client;
  return `<div class="view-anim done">
    <div class="seal">${ico("check", 34)}</div>
    <h2>Vente enregistrée</h2>
    <div class="ref">Bordereau ${esc(s.reference)} · ${fmtDT(s.date)}${c ? ` · ${esc(c.full_name)}` : " · vente simple"}</div>
    <div class="amounts">
      <div><div class="lbl">Montant brut</div><div class="val">${fmt(s.totals.gross_total)}</div></div>
      ${
        c
          ? `<div><div class="lbl">Part assurance</div><div class="val">${fmt(s.totals.insurer_share)}</div></div>
      <div><div class="lbl">Reste à charge</div><div class="val">${fmt(s.totals.patient_share)}</div></div>`
          : ""
      }
    </div>
    <div class="acts">
      <button class="btn btn-primary lg" data-slip>${ico("print", 15)} Voir et imprimer le bordereau</button>
      <button class="btn btn-ghost lg" data-newsale>Nouvelle vente</button>
      <button class="btn btn-ghost lg" data-nav="comptoir">Retour au comptoir</button>
    </div>
    <p class="mini" style="margin-top:18px">Reportez ensuite le bordereau dans Winpharma pour émettre la facture officielle.</p>
  </div>`;
}

/* Enregistrement : le serveur recalcule tout, l'interface affiche ce qu'il renvoie */
let saving = false;
async function validateSale() {
  if (saving || !sale.lines.length) return;
  saving = true;
  const btn = $("[data-validate]");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Enregistrement…";
  }
  try {
    const created = await api("/sales", {
      method: "POST",
      body: salePayload(
        sale.lines,
        sale.client?.id,
        sale.note.trim(),
        sale.date,
      ),
    });
    sale.slip = await api(`/sales/${created.reference}/slip`);
    sale.step = 5;
    toast("Vente enregistrée.");
    renderView();
  } catch (e) {
    toast(errMsg(e), true);
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Enregistrer la vente";
    }
  } finally {
    saving = false;
  }
}

/* Bordereau : rendu imprimable, à ressaisir dans Winpharma */
function showBordereau(s) {
  const c = s.client;
  const rows = s.lines
    .map(
      (l) =>
        `<tr><td>${esc(l.name)}</td><td>${l.quantity}</td><td>${fmt(l.price)}</td><td>${fmt(l.total)}</td><td>${l.coverage_rate !== null ? l.coverage_rate + " %" : "—"}</td></tr>`,
    )
    .join("");
  const html = `
  <div class="bhead">
    <div><b style="font-size:16px">OptiDesk · ${esc(s.pharmacy.name)}</b><div class="mini">${esc(s.pharmacy.address)}</div>
    <div>Bordereau de vente ${esc(s.reference)}, à ressaisir dans Winpharma</div></div>
    <div style="text-align:right">Le ${fmtDT(s.date)}<br>Vendeur : ${esc(s.seller || "—")}</div>
  </div>
  ${c ? `<p style="margin-bottom:10px"><b>Client :</b> ${esc(c.full_name)} · ${esc(c.insurer || "—")} · N° ${esc(c.policy_number || "—")}</p>` : '<p style="margin-bottom:10px"><b>Vente simple</b> (sans prise en charge)</p>'}
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
let clientsState = { q: "", selectedId: null };
function clientRowHTML(c, selectedId) {
  return `<button class="list-row ${c.id === selectedId ? "on" : ""}" data-clientrow="${c.id}">
    <div class="avatar">${avatarHTML(c)}</div>
    <div class="who"><div class="nm">${esc(cname(c))}</div>
      <div class="meta">${esc(c.insurer)}${c.policy_number ? ` · ${esc(c.policy_number)}` : ""}</div></div>
    ${c.coverage_alert ? `<span class="status warn">Échue</span>` : c.frequent ? `<span class="tag ok">Fréquent</span>` : ""}
  </button>`;
}
function clientListHTML(list) {
  return (
    list.map((c) => clientRowHTML(c, clientsState.selectedId)).join("") ||
    `<div class="empty">Aucun client ne correspond.</div>`
  );
}
async function vClients() {
  const list = await api(
    `/clients?limit=100${clientsState.q ? `&q=${enc(clientsState.q)}` : ""}`,
  );
  rememberC(list);
  if (!list.some((c) => c.id === clientsState.selectedId))
    clientsState.selectedId = list[0]?.id || null;
  const detail = clientsState.selectedId
    ? await clientFicheHTML(clientsState.selectedId)
    : emptyState(
        "users",
        "Aucun client assuré",
        "Créez la fiche d'un client pour retrouver ses produits habituels à chaque passage.",
        `<button class="btn btn-primary" data-newclient>Ajouter un client</button>`,
      );
  return `<div class="view-anim">
    <div class="page-head">
      <div><h1>Clients</h1><div class="sub">Retrouvez un client assuré, vérifiez sa couverture, lancez sa vente.</div></div>
      <div class="actions"><button class="btn btn-primary" data-newclient>${ico("plus", 14)} Nouveau client</button></div>
    </div>
    <div class="split">
      <div class="list-panel">
        <div class="panel-head"><b>Répertoire</b><div class="right list-count">${list.length} fiche(s)</div></div>
        <div style="padding:10px 12px;border-bottom:1px solid var(--line)">
          <div class="hero-search">${ico("search", 17)}
            <input id="clListSearch" placeholder="Nom, organisme, n° d'assuré…" value="${esc(clientsState.q)}" autocomplete="off"></div>
        </div>
        <div class="list-scroll" id="clList">${clientListHTML(list)}</div>
      </div>
      <div id="clDetail">${detail}</div>
    </div>
  </div>`;
}
/* Fiche complète, affichée dans le panneau de droite (et reprise en fenêtre depuis le comptoir) */
async function clientFicheHTML(id) {
  const { c, usual, hist } = await clientData(id);
  return `<div class="panel flush">
    <div class="panel-head"><b>Fiche client</b>
      <div class="right"><button class="btn btn-ghost sm" data-editclient="${c.id}">${ico("edit", 13)} Modifier</button>
      <button class="btn btn-primary sm" data-sell="${c.id}">Démarrer une vente assurée</button></div>
    </div>
    <div class="panel-body">${clientFicheBody(c, usual, hist)}</div>
  </div>`;
}

function clientResultHTML(c) {
  return `<div class="pick">
    <div class="avatar">${avatarHTML(c)}</div>
    <div class="who"><div class="nm">${esc(cname(c))}</div>
      <div class="meta">${esc(c.insurer)} · N° ${esc(c.policy_number || "non renseigné")}${c.usual_cart_count ? ` · ${c.usual_cart_count} produit(s) habituel(s)` : ""}</div></div>
    ${c.coverage_alert ? `<span class="status warn">À vérifier</span>` : `<span class="status ok">Valide</span>`}
    <button class="btn btn-primary sm" data-pickclient="${c.id}">Choisir ce client</button>
  </div>`;
}

/* ---------------------------------------------------------------------------
   Catalogue & stock (administration)
   --------------------------------------------------------------------------- */
let catState = { q: "", limit: 50, category: "" };
let catSeq = 0;
function catRowHTML(p) {
  const d = p.days_to_expiry;
  return `<tr>
    <td><b>${esc(p.name)}</b><div class="mini">${esc(p.dci || "—")} · ${esc(p.code)}</div></td>
    <td><span class="tag">${esc(p.category)}</span></td>
    <td style="text-align:right"><b>${fmt(p.price)}</b></td>
    <td style="text-align:center"><span class="qty-ctl"><button data-stock="-1" data-pid="${p.id}" aria-label="Retirer une unité">${ico("minus", 12)}</button><span>${p.stock}</span><button data-stock="1" data-pid="${p.id}" aria-label="Ajouter une unité">${ico("plus", 12)}</button></span></td>
    <td>${p.availability === "disponible" ? `<span class="status ok">Disponible</span>` : p.availability === "faible" ? `<span class="status warn">Stock faible</span>` : `<span class="status bad">Rupture</span>`}</td>
    <td>${d === null ? '<span class="mini">—</span>' : p.expiring_soon ? `<span class="status warn">${d < 0 ? "périmé" : d + " j"} · ${fmtD(p.expiry)}</span>` : `<span class="mini">${fmtD(p.expiry)}</span>`}</td>
    <td><span class="tag ${p.source === "import" ? "info" : "violet"}">${p.source === "import" ? "Importé" : "Saisi"}</span></td>
    <td style="white-space:nowrap">
      <button class="x-btn" data-toggle="${p.id}" title="Marquer en rupture ou réactiver">${ico("alert", 14)}</button>
      <button class="x-btn" data-editproduct="${p.id}" title="Modifier">${ico("edit", 14)}</button>
      <button class="x-btn danger" data-delproduct="${p.id}" title="Supprimer">${ico("trash", 14)}</button>
    </td></tr>`;
}
function catBodyHTML(r) {
  return (
    r.items.map(catRowHTML).join("") ||
    `<tr><td colspan="8"><div class="empty">Aucun produit ne correspond. Modifiez la recherche ou le rayon.</div></td></tr>`
  );
}
function catFootHTML(r) {
  return `<span class="mini">${r.items.length} produit(s) affiché(s) sur ${r.total}</span>${
    r.total > r.items.length
      ? ` <button class="btn btn-ghost sm" data-catmore style="margin-left:12px">Afficher 50 de plus</button>`
      : ""
  }`;
}
async function catalogueData() {
  const r = await api(
    `/products?limit=${catState.limit}&q=${enc(catState.q)}${catState.category ? `&category=${enc(catState.category)}` : ""}`,
  );
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
  const [r, cats, fresh] = await Promise.all([
    catalogueData(),
    api("/categories"),
    api("/stock/freshness"),
  ]);
  return `<div class="view-anim">
    <div class="page-head">
      <div><h1>Catalogue &amp; stock</h1><div class="sub">Le catalogue propre à OptiDesk : alimenté par un import Winpharma ou saisi ici. Winpharma n'est jamais modifié.</div></div>
      <div class="actions">
        <button class="btn btn-ghost" data-cats>Gérer les rayons</button>
        <button class="btn btn-ghost" data-import>${ico("upload", 14)} Importer mon stock</button>
        <button class="btn btn-primary" data-newproduct>${ico("plus", 14)} Créer un produit</button>
      </div>
    </div>
    <div class="notice${fresh.stale ? " warn" : ""}" style="margin-bottom:16px">${ico(fresh.stale ? "alert" : "check", 17)}
      <div><b>${fresh.stale ? "Stock à réimporter" : "Stock à jour"}</b>
      <div class="mini" style="color:inherit">${fresh.last_import ? `Dernier import le ${fmtDT(fresh.last_import)} · ${fresh.imported_products} produit(s) importés` : "Aucun import pour l'instant : le catalogue ne contient que les produits saisis à la main."}</div></div>
      <div class="right"><button class="btn btn-ghost sm" data-import>Importer un fichier</button></div>
    </div>
    <div class="toolbar">
      <div class="hero-search grow">${ico("search", 19)}
        <input id="catSearch" placeholder="Rechercher dans le catalogue…" value="${esc(catState.q)}" autocomplete="off"></div>
      <div class="field" style="min-width:210px;margin:0">
        <select id="catCategory"><option value="">Tous les rayons</option>
        ${cats.map((c) => `<option ${c.name === catState.category ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
      </div>
    </div>
    <div class="panel flush">
      <div class="table-wrap">
        <table id="catTable"><thead><tr><th>Produit</th><th>Rayon</th><th style="text-align:right">Prix</th><th style="text-align:center">Stock</th><th>Disponibilité</th><th>Péremption</th><th>Provenance</th><th></th></tr></thead>
        <tbody id="catBody">${catBodyHTML(r)}</tbody></table>
      </div>
      <div class="panel-head" style="border-bottom:none;border-top:1px solid var(--line)"><div id="catFoot">${catFootHTML(r)}</div></div>
    </div>
  </div>`;
}
async function categoriesModal() {
  const cats = await api("/categories");
  modal(`<div class="modal-head"><h3>Rayons du catalogue</h3><button class="x-btn" data-close>${ico("x")}</button></div>
  <div class="modal-body">
    <div style="display:flex;flex-direction:column;gap:8px">
      ${cats
        .map(
          (
            c,
          ) => `<div style="display:flex;align-items:center;gap:10px;padding:10px 13px;background:var(--side);border-radius:10px">
        <b style="font-size:13.5px;flex:1">${esc(c.name)}</b>
        <span class="mini">${c.product_count} produit(s)</span>
        <button class="btn btn-danger sm" data-delcat="${esc(c.name)}" ${c.product_count ? "disabled" : ""} title="${c.product_count ? "Rayon utilisé par des produits" : "Supprimer"}">${ico("trash", 13)}</button>
      </div>`,
        )
        .join("")}
    </div>
    <div style="display:flex;gap:10px;margin-top:16px">
      <div class="field" style="flex:1;margin:0"><input id="newCat" placeholder="Nom du nouveau rayon"></div>
      <button class="btn btn-primary" id="addCat">${ico("plus", 14)} Ajouter</button>
    </div>
  </div>`);
  $("#addCat").onclick = async () => {
    const v = $("#newCat").value.trim();
    if (!v) return toast("Saisissez un nom de rayon.", true);
    try {
      await api("/categories", { method: "POST", body: { name: v } });
      closeModal();
      toast(`Rayon « ${v} » créé.`);
      renderView({ keepScroll: true });
    } catch (e) {
      toast(errMsg(e), true);
    }
  };
}

/* --- Import Winpharma : fichier → colonnes → aperçu → confirmation ------- */
let IMPORT = null;
const IMPORT_LABEL = {
  name: "Nom du produit",
  code: "Code produit",
  stock: "Quantité en stock",
  price: "Prix de vente",
  dci: "DCI (facultatif)",
  category: "Rayon (facultatif)",
  expiry: "Péremption (facultatif)",
};
const IMPORT_REQUIRED = ["name", "code", "stock", "price"];
const importSteps = (on) =>
  `<div class="steps-mini">${[
    "Choisir le fichier",
    "Vérifier les colonnes",
    "Prévisualiser",
    "Confirmer",
  ]
    .map(
      (t, i) =>
        `<span class="${i + 1 === on ? "on" : ""}">${String(i + 1).padStart(2, "0")} ${t}</span>`,
    )
    .join("")}</div>`;

function importModal() {
  IMPORT = null;
  modal(`<div class="modal-head"><h3>Importer mon stock Winpharma</h3><button class="x-btn" data-close>${ico("x")}</button></div>
  <div class="modal-body">
    ${importSteps(1)}
    <div class="dropzone" id="dz">
      ${ico("upload", 36)}
      <div style="font-weight:600;font-size:15px">Glissez-déposez votre fichier CSV ou Excel</div>
      <div class="mini" style="margin-top:5px">exporté depuis Winpharma, ou cliquez pour parcourir</div>
      <input type="file" id="fileInput" accept=".csv,.xlsx" hidden>
    </div>
    <p class="mini" style="margin-top:10px">OptiDesk lit ce fichier pour remplir son propre catalogue. Rien n'est renvoyé vers Winpharma.</p>
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
    toast(
      "Ce fichier n'est pas reconnu. Vérifiez qu'il vient bien de Winpharma (CSV ou Excel).",
      true,
    );
    return;
  }
  $("#importPreview").innerHTML =
    `<div class="loading-line"><span class="spin"></span> Lecture du fichier…</div>`;
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
    (IMPORT_REQUIRED.includes(field)
      ? ""
      : `<option value="">— colonne non utilisée —</option>`) +
    p.columns
      .map(
        (c) =>
          `<option value="${esc(c.header)}" ${p.mapping[field] === c.header ? "selected" : ""}>${esc(c.header)}</option>`,
      )
      .join("");
  const ready = !p.missing_required.length && p.detected_count > 0;
  $("#importPreview").innerHTML = `
    ${importSteps(ready ? 3 : 2)}
    <div class="panel" style="padding:18px">
      <b style="font-size:14px">${esc(p.filename)} <span class="status ok" style="margin-left:6px">Fichier lu</span></b>
      <div style="margin-top:12px;display:flex;flex-direction:column;gap:7px">
        ${Object.keys(IMPORT_LABEL)
          .map(
            (f) =>
              `<div style="display:flex;align-items:center;gap:10px;font-size:13px"><span style="flex:1">${IMPORT_LABEL[f]}</span>
          <div class="field" style="margin:0;width:230px"><select data-impmap="${f}">${IMPORT_REQUIRED.includes(f) && !p.mapping[f] ? `<option value="">— choisir la colonne —</option>` : ""}${options(f)}</select></div></div>`,
          )
          .join("")}
      </div>
      <div class="notice" style="margin-top:14px">
        ${
          ready
            ? `<div><b>${p.detected_count.toLocaleString("fr-FR")} produits reconnus</b>
            <div class="mini" style="color:inherit">${p.new_count.toLocaleString("fr-FR")} nouveau(x) · ${p.update_count.toLocaleString("fr-FR")} à mettre à jour${p.skipped_count ? ` · ${p.skipped_count} ligne(s) ignorée(s)` : ""}</div></div>`
            : p.missing_required.length
              ? `<div>Indiquez la colonne correspondant à : <b>${esc(p.missing_required.join(", "))}</b>.</div>`
              : `<div>Aucun produit exploitable avec ce choix de colonnes.</div>`
        }
      </div>
      ${p.manual_count ? `<p class="mini" style="margin-top:8px">${p.manual_count} produit(s) saisis à la main seront mis à jour par l'import ; ils sont nommés dans le journal d'audit.</p>` : ""}
      ${p.warnings.length ? `<p class="mini" style="margin-top:8px">${p.warnings.map(esc).join("<br>")}</p>` : ""}
      <div style="display:flex;gap:10px;margin-top:16px">
        <button class="btn btn-ghost" data-close>Annuler</button>
        <button class="btn btn-primary" style="flex:1" id="confirmImport" ${ready ? "" : "disabled"}>Confirmer l'import</button>
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
      toast(
        `Import terminé : ${r.created} nouveau(x), ${r.updated} mis à jour.`,
      );
      renderView({ keepScroll: true });
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "Confirmer l'import";
      toast(errMsg(e), true);
    }
  };
}
/* Si les colonnes sont corrigées à la main, le serveur recompte (toujours sans rien écrire) */
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
   Couverture (règles d'assurance)
   --------------------------------------------------------------------------- */
let RULES = [];
async function vRegles() {
  RULES = await api("/rules");
  const groups = {};
  RULES.forEach((r) => (groups[r.insurer] = groups[r.insurer] || []).push(r));
  return `<div class="view-anim">
    <div class="page-head">
      <div><h1>Couverture</h1><div class="sub">Ce que chaque organisme prend en charge. Ces règles s'appliquent automatiquement au comptoir et dans le panier.</div></div>
      <div class="actions"><button class="btn btn-primary" data-newrule>${ico("plus", 14)} Nouvelle règle</button></div>
    </div>
    ${
      Object.keys(groups).length
        ? Object.entries(groups)
            .map(
              ([ins, rules]) => `
    <div class="panel flush" style="margin-bottom:16px">
      <div class="panel-head">
        <div style="width:36px;height:36px;border-radius:10px;background:var(--sel);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:#26402F">${esc(ins.slice(0, 2).toUpperCase())}</div>
        <b>${esc(ins)}</b><span class="mini">${rules.length} règle(s)</span>
      </div>
      <div class="table-wrap"><table><thead><tr><th>S'applique à</th><th>Prise en charge</th><th>Jamais pris en charge</th><th>Note</th><th></th></tr></thead><tbody>
      ${rules
        .map(
          (r) => `<tr>
        <td><b>${esc(r.scope)}</b></td>
        <td><span class="status ${r.rate >= 100 ? "ok" : r.rate > 0 ? "part" : "bad"}">${r.rate} %</span></td>
        <td>${r.exclusion ? `<span class="status bad">${esc(r.exclusion)}</span>` : '<span class="mini">—</span>'}</td>
        <td class="mini">${esc(r.note || "—")}</td>
        <td><button class="x-btn" data-editrule="${r.id}" aria-label="Modifier la règle">${ico("edit", 14)}</button></td></tr>`,
        )
        .join("")}
      </tbody></table></div>
    </div>`,
            )
            .join("")
        : emptyState(
            "shield",
            "Aucune règle de couverture",
            "Ajoutez une règle par organisme : le taux pris en charge, et éventuellement un rayon jamais remboursé.",
            `<button class="btn btn-primary" data-newrule>Créer la première règle</button>`,
          )
    }
    <p class="mini">Toute création ou modification est datée et attribuée dans le journal d'audit.</p>
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
    <div class="page-head">
      <div><h1>Tableau de bord</h1><div class="sub">Les sept derniers jours : ce qui se vend, ce qui bloque au comptoir.</div></div>
      <div class="actions"><button class="btn btn-ghost" data-export>${ico("download", 14)} Exporter la synthèse (CSV)</button></div>
    </div>
    <div class="stat-row">
      <div class="stat-dark">
        <div class="ov">Ventes des 7 derniers jours</div>
        <div class="val">${fmt(d.gross_total)}</div>
        <div class="sub">${d.sales_count} vente(s) enregistrée(s)</div>
      </div>
      <div class="stat"><div class="lbl">Produits hors couverture</div><div class="val">${d.out_of_coverage_total}</div><div class="trend">demandes non couvertes sur la période</div></div>
      <div class="stat"><div class="lbl">Ruptures</div><div class="val">${d.stock_out_count}</div><div class="trend">référence(s) à réapprovisionner</div></div>
      <div class="stat"><div class="lbl">Péremptions proches</div><div class="val">${d.expiring_count}</div><div class="trend">à retourner au fournisseur sous 7 jours</div></div>
    </div>
    <div class="grid-2" style="margin-top:18px;grid-template-columns:1fr 1fr">
      <div class="panel">
        <div class="section-head"><h2>Chiffre d'affaires par jour</h2><span class="hint">montant brut</span></div>
        <div class="bars">
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
      <div class="panel">
        <div class="section-head"><h2>Répartition des ventes</h2></div>
        <div style="display:flex;gap:18px;align-items:center">
          <svg viewBox="0 0 42 42" style="width:110px;height:110px;flex-shrink:0">${seg(d.assured_count, "#2F5D46")}${seg(d.simple_count, "#4FB894")}</svg>
          <div class="donut-legend">
            <div class="li"><i style="background:#2F5D46"></i> Ventes assurées <b style="margin-left:auto">${d.assured_count}</b></div>
            <div class="li"><i style="background:#4FB894"></i> Ventes simples <b style="margin-left:auto">${d.simple_count}</b></div>
            <div class="mini" style="margin-top:6px">Part des ventes assurées : <b>${d.assured_rate} %</b></div>
          </div>
        </div>
      </div>
    </div>
    <div class="grid-2" style="margin-top:18px;grid-template-columns:1fr 1fr">
      <div class="panel flush">
        <div class="panel-head"><b>Produits demandés hors couverture</b><div class="right"><button class="btn btn-ghost sm" data-export>Exporter</button></div></div>
        <div class="table-wrap"><table><thead><tr><th>Produit</th><th>Organisme</th><th style="text-align:right">Demandes</th></tr></thead><tbody>
        ${
          d.out_of_coverage
            .map(
              (x) =>
                `<tr><td><b>${esc(x.name)}</b></td><td><span class="tag">${esc(x.insurer)}</span></td><td style="text-align:right"><b>${x.count}</b></td></tr>`,
            )
            .join("") ||
          `<tr><td colspan="3"><div class="empty">Aucune demande hors couverture sur la période.</div></td></tr>`
        }
        </tbody></table></div>
      </div>
      <div class="panel flush">
        <div class="panel-head"><b>Ruptures et péremptions</b></div>
        <div class="table-wrap"><table><thead><tr><th>Produit</th><th>Statut</th><th>Détail</th></tr></thead><tbody>
        ${d.stock_outs.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td><span class="status bad">Rupture</span></td><td class="mini">stock à zéro</td></tr>`).join("")}
        ${d.expiring
          .map(
            (
              p,
            ) => `<tr><td><b>${esc(p.name)}</b></td><td><span class="status warn">Péremption</span></td>
          <td class="mini">${p.days_to_expiry < 0 ? "périmé depuis " + -p.days_to_expiry + " jour(s)" : p.days_to_expiry + " jour(s) restant(s)"}</td></tr>`,
          )
          .join("")}
        ${!d.stock_outs.length && !d.expiring.length ? `<tr><td colspan="3"><div class="empty">Aucune rupture ni péremption proche.</div></td></tr>` : ""}
        </tbody></table></div>
      </div>
    </div>
  </div>`;
}
async function exportCSV() {
  const blob = await api("/dashboard/out-of-coverage.csv?days=7", {
    blob: true,
  });
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
          `<tr class="log-row"><td>${fmtDT(a.ts)}</td><td><b>${esc(a.user)}</b></td><td><span class="tag">${esc(a.action)}</span></td><td class="mini">${esc(a.detail || "—")}</td></tr>`,
      )
      .join("") ||
    `<tr><td colspan="4"><div class="empty">Aucune entrée pour ce filtre.</div></td></tr>`
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
    <div class="page-head">
      <div><h1>Journal d'audit</h1><div class="sub">Chaque action est rattachée au compte qui l'a réalisée. Le journal ne peut être ni modifié ni effacé.</div></div>
      <div class="actions"><span class="status ok">Écriture seule</span></div>
    </div>
    <div class="toolbar">
      <div class="field" style="min-width:220px;margin:0"><label>Utilisateur</label>
        <select id="auditUser"><option value="">Tous les utilisateurs</option>${AUDIT_USERS.map((u) => `<option ${u === auditFilter.user ? "selected" : ""}>${esc(u)}</option>`).join("")}</select></div>
      <div class="field" style="min-width:220px;margin:0"><label>Période</label>
        <select id="auditPeriod"><option value="">Tout l'historique</option><option value="7" ${auditFilter.days === "7" ? "selected" : ""}>7 derniers jours</option><option value="1" ${auditFilter.days === "1" ? "selected" : ""}>Aujourd'hui</option></select></div>
    </div>
    <div class="panel flush"><div class="table-wrap">
      <table id="auditTable"><thead><tr><th>Date et heure</th><th>Utilisateur</th><th>Action</th><th>Détail</th></tr></thead>
      <tbody>${auditRowsHTML(r.items)}</tbody></table>
    </div></div>
  </div>`;
}

/* ---------------------------------------------------------------------------
   Paramètres
   --------------------------------------------------------------------------- */
let pendingPhoto = null;
let setTab = "profil";
const SET_TABS = [
  {
    id: "profil",
    label: "Mon profil",
    hint: "nom, photo, code PIN",
    admin: false,
  },
  {
    id: "comptes",
    label: "Utilisateurs",
    hint: "comptes de l'équipe",
    admin: true,
  },
  {
    id: "modeles",
    label: "Ventes récurrentes",
    hint: "modèles enregistrés",
    admin: true,
  },
  {
    id: "apropos",
    label: "À propos",
    hint: "version et données",
    admin: false,
  },
];
async function vParametres() {
  const u = me();
  pendingPhoto = null;
  const tabs = SET_TABS.filter((t) => !t.admin || isAdmin());
  if (!tabs.some((t) => t.id === setTab)) setTab = "profil";
  let body = "";
  if (setTab === "profil") body = setProfil(u);
  else if (setTab === "comptes") body = setComptes(await api("/users"), u);
  else if (setTab === "modeles")
    body = setModeles(await api("/sales/models?scope=all"));
  else body = setApropos();
  return `<div class="view-anim">
    <div class="page-head"><div><h1>Paramètres</h1>
      <div class="sub">Votre compte${isAdmin() ? ", les comptes de l'équipe et les modèles de vente" : ""}.</div></div></div>
    <div class="set-layout">
      <nav class="set-nav">
        <div class="hd">Réglages</div>
        ${tabs
          .map(
            (t) =>
              `<button class="${t.id === setTab ? "on" : ""}" data-settab="${t.id}">${esc(t.label)}<small>${esc(t.hint)}</small></button>`,
          )
          .join("")}
      </nav>
      <div id="setBody">${body}</div>
    </div>
  </div>`;
}
function setProfil(u) {
  return `<div class="panel flush">
    <div class="panel-head"><b>Mon profil</b></div>
    <div class="panel-body">
      <div style="display:flex;gap:16px;align-items:center">
        <div class="avatar" style="width:64px;height:64px;font-size:19px;border-radius:8px" id="bigAvatar">${u.photo ? `<img src="${u.photo}">` : esc(nameInits(u.name))}</div>
        <div>
          <div style="font-size:17px">${esc(u.name)}</div>
          <span class="role-chip ${u.role === "vendeur" ? "vendeur" : ""}">${u.role === "admin" ? "Titulaire / Administrateur" : "Vendeur / Préparateur"}</span>
          <div class="mini" style="margin-top:6px">Pharmacie Adjololo · Lomé, Togo</div>
        </div>
      </div>
      <div class="divider"></div>
      <div class="two-col">
        <div class="field"><label>Nom complet (nom, puis prénom)</label><input id="setUserName" value="${esc(u.name)}"></div>
        <div class="field"><label>Nouveau code PIN</label><input id="setUserPin" type="password" maxlength="4" inputmode="numeric" placeholder="····" style="letter-spacing:8px;text-align:center;font-size:16px">
          <div class="help">Laissez vide pour conserver le code actuel.</div></div>
      </div>
      <div class="photo-drop" id="photoDrop" style="margin-top:12px">${ico("camera", 15)} Changer ma photo de profil</div>
      <input type="file" id="photoInput" accept="image/*" hidden>
    </div>
    <div class="panel-foot"><div class="right"><button class="btn btn-primary" data-saveprofile>Enregistrer les modifications</button></div></div>
  </div>`;
}
function setComptes(users, u) {
  return `<div class="panel flush">
    <div class="panel-head"><b>Comptes de l'équipe</b>
      <div class="right"><button class="btn btn-ghost sm" data-newuser>${ico("plus", 13)} Créer un compte</button></div></div>
    <div class="table-wrap"><table><thead><tr><th>Personne</th><th>Rôle</th><th>Créé le</th><th>État</th><th></th></tr></thead><tbody>
    ${users
      .map(
        (x) => `<tr>
      <td><div style="display:flex;align-items:center;gap:10px">
        <div class="avatar" style="width:30px;height:30px;font-size:11px;border-radius:5px">${x.photo ? `<img src="${x.photo}">` : esc(nameInits(x.name))}</div>
        <b>${esc(x.name)}</b>${x.id === u.id ? ' <span class="tag">vous</span>' : ""}</div></td>
      <td>${x.role === "admin" ? "Titulaire / Administrateur" : "Vendeur / Préparateur"}</td>
      <td>${fmtD(x.created_at)}</td>
      <td>${x.active ? `<span class="status ok">Actif</span>` : `<span class="status bad">Désactivé</span>`}</td>
      <td style="text-align:right">${
        x.id !== u.id
          ? `<button class="btn ${x.active ? "btn-danger" : "btn-ghost"} sm" data-toggleuser="${x.id}" data-active="${x.active ? 1 : 0}">${x.active ? "Désactiver" : "Réactiver"}</button>`
          : ""
      }</td></tr>`,
      )
      .join("")}
    </tbody></table></div>
    <div class="panel-foot"><span class="mini">Deux rôles seulement : le Titulaire accède à la gestion, le Vendeur au comptoir. La création de comptes reste réservée au Titulaire.</span></div>
  </div>`;
}
function setModeles(models) {
  return `<div class="panel flush">
    <div class="panel-head"><b>Modèles de vente récurrente</b><div class="right list-count">${models.length} modèle(s)</div></div>
    ${
      models.length
        ? `<div class="table-wrap"><table><thead><tr><th>Nom</th><th>Produits</th><th></th></tr></thead><tbody>
      ${models
        .map(
          (
            m,
          ) => `<tr><td><b>${esc(m.name)}</b></td><td>${m.lines.map((l) => esc(l.name)).join(" · ")}</td>
        <td style="text-align:right"><button class="x-btn danger" data-delmodel="${m.id}" aria-label="Supprimer le modèle">${ico("trash", 14)}</button></td></tr>`,
        )
        .join("")}
      </tbody></table></div>`
        : `<div class="panel-body"><p class="mini">Aucun modèle enregistré. Créez-en un depuis une vente, pour les ordonnances chroniques répétées chaque mois.</p></div>`
    }
  </div>`;
}
function setApropos() {
  return `<div class="panel flush">
    <div class="panel-head"><b>À propos d'OptiDesk</b></div>
    <div class="panel-body">
      <div class="kv">
        <div><div class="lbl">Application</div><b>OptiDesk v1.0</b></div>
        <div><div class="lbl">Officine</div><b>Pharmacie Adjololo · Lomé</b></div>
        <div><div class="lbl">Catalogue</div><b>Import Winpharma + saisie manuelle</b></div>
      </div>
      <p class="mini" style="margin-top:14px">OptiDesk n'est jamais connecté à Winpharma : il prépare la vente et imprime un bordereau, Winpharma émet la facture officielle et assure la télétransmission.</p>
      ${isAdmin() ? "" : `<p class="mini" style="margin-top:10px">Vous êtes connecté(e) comme Vendeur / Préparateur : comptoir, ventes et clients. La gestion du catalogue, des règles de couverture et des comptes est réservée au Titulaire.</p>`}
    </div>
  </div>`;
}
window.__od2 = true;
