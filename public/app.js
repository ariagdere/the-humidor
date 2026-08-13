// ============================================================================
// The Humidor — frontend logic. No build step, runs directly in the browser.
// ============================================================================

// index.html, app.js'ten önce window.__HUMIDOR_API_KEY__'i (Railway'deki
// gerçek API_KEY'i) küçük bir inline <script> ile enjekte ediyor. Bu dosya
// kendisi tamamen statik kalıyor, sunucu tarafında hiç işlenmiyor.
const API_KEY = window.__HUMIDOR_API_KEY__ || "";
let glossaryCache = [];
let currentCigarData = null;
let editingTastingId = null;
let editingPurchaseId = null;

// --- API helper -------------------------------------------------------------
async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "x-api-key": API_KEY,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    const err = new Error("unauthorized");
    err.code = 401;
    throw err;
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body.error) msg = body.error;
    } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

function esc(str) {
  const d = document.createElement("div");
  d.textContent = str ?? "";
  return d.innerHTML;
}

function cap(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

function fmtMoney(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// --- Tabs --------------------------------------------------------------------
function switchView(name) {
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== `view-${name}`));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
}
document.querySelectorAll("[data-view]").forEach((el) =>
  el.addEventListener("click", () => switchView(el.dataset.view))
);

// --- Dashboard -------------------------------------------------------------
async function loadStats() {
  const stats = await apiFetch("/api/stats");
  document.getElementById("stat-types").textContent = stats.total_cigar_types;
  document.getElementById("stat-stock").textContent = stats.total_in_stock;
  document.getElementById("stat-smoked").textContent = stats.total_smoked;

  const lists = [
    { title: "Top rated", items: stats.top_rated, metric: (i) => `${i.overall_score}/5` },
    { title: "Most smoked", items: stats.most_smoked, metric: (i) => `${i.tasting_count} tastings` },
    { title: "Most repurchased", items: stats.most_repurchased, metric: (i) => `${i.purchase_count} purchases` },
  ];

  const container = document.getElementById("dash-lists");
  container.innerHTML = lists.map((l) => `
    <div class="dash-list">
      <h4>${l.title}</h4>
      ${l.items.length
        ? `<ol>${l.items.map((i) => `
            <li data-cigar-id="${i.id}">
              <span class="dash-list-name">${esc([i.brand, i.line].filter(Boolean).join(" "))}</span>
              <span class="dash-list-metric">${l.metric(i)}</span>
            </li>`).join("")}</ol>`
        : `<p class="dash-empty">No data yet</p>`}
    </div>
  `).join("");

  container.querySelectorAll("[data-cigar-id]").forEach((el) =>
    el.addEventListener("click", () => openCigarModal(Number(el.dataset.cigarId)))
  );
}

// --- Inventory (list view) --------------------------------------------------
async function loadInventory() {
  const list = document.getElementById("inventory-list");
  const empty = document.getElementById("inventory-empty");
  const count = document.getElementById("inventory-count");
  list.innerHTML = `<p class="loading">Loading…</p>`;

  const cigars = await apiFetch("/api/cigars");
  list.innerHTML = "";

  if (cigars.length === 0) {
    empty.hidden = false;
    count.textContent = "";
    return;
  }
  empty.hidden = true;
  count.textContent = `${cigars.length} cigar${cigars.length === 1 ? "" : "s"}`;

  for (const c of cigars) {
    const remaining = Number(c.quantity_remaining ?? 0);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "cigar-row";
    row.addEventListener("click", () => openCigarModal(c.id));

    const photoHtml = c.photo_url
      ? `<img class="cigar-row-photo" src="${esc(c.photo_url)}" alt="" />`
      : `<div class="cigar-row-photo-placeholder">${esc((c.brand || "?").charAt(0))}</div>`;

    const title = [c.brand, c.line].filter(Boolean).join(" ");

    row.innerHTML = `
      ${photoHtml}
      <div class="cigar-row-main">
        <div class="cigar-row-title">${esc(title)}</div>
        <div class="cigar-row-sub">${esc(c.vitola) || "&nbsp;"}</div>
      </div>
      <div class="cigar-row-nums">
        <div class="cigar-row-num"><span class="cigar-row-num-val">${c.total_bought}</span><span class="cigar-row-num-lbl">bought</span></div>
        <div class="cigar-row-num"><span class="cigar-row-num-val">${c.total_smoked}</span><span class="cigar-row-num-lbl">smoked</span></div>
        <div class="cigar-row-num"><span class="cigar-row-num-val">${remaining}</span><span class="cigar-row-num-lbl">left</span></div>
      </div>
      <span class="cigar-row-score${c.overall_score ? "" : " unscored"}">${c.overall_score ? c.overall_score + "/5" : "—"}</span>
    `;
    list.appendChild(row);
  }
}

// --- Cigar detail modal ------------------------------------------------------
const modal = document.getElementById("modal");
const modalBody = document.getElementById("modal-body");
document.getElementById("modal-close").addEventListener("click", closeModal);
modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) closeModal(); });

function closeModal() {
  modal.hidden = true;
  modalBody.innerHTML = "";
  editingTastingId = null;
  editingPurchaseId = null;
}

async function openCigarModal(id) {
  modal.hidden = false;
  modalBody.innerHTML = `<p class="modal-loading">Loading…</p>`;
  const c = await apiFetch(`/api/cigars/${id}`);
  editingTastingId = null;
  editingPurchaseId = null;
  renderCigarModal(c);
}

const TASTING_FIELDS = ["tasting_date", "location"];
const PURCHASE_FIELDS = ["source", "purchase_date", "quantity", "unit_price", "box_code", "reference_url"];
const RATING_FIELDS = ["draw_score", "burn_score", "construction_score", "finish_score", "overall_score", "strength_experienced", "scoring_notes"];
const STRENGTH_OPTIONS = ["mild", "mild-medium", "medium", "medium-full", "full"];

function strengthSelectHtml(name, current) {
  const label = (s) => s.split("-").map(cap).join("-");
  const opts = STRENGTH_OPTIONS.map((s) => `<option value="${s}"${current === s ? " selected" : ""}>${label(s)}</option>`).join("");
  return `<select name="${name}"><option value="">—</option>${opts}</select>`;
}

function tastingLineHtml(t) {
  return `
    <div class="tasting-line" data-tasting-id="${t.id}">
      <span class="tasting-line-text">${fmtDate(t.tasting_date)}${t.location ? ` · ${esc(t.location)}` : ""}</span>
      <span class="tasting-line-actions">
        <button type="button" class="tasting-edit-btn" data-id="${t.id}">Edit</button>
        <button type="button" class="tasting-delete-btn danger" data-id="${t.id}">Delete</button>
      </span>
    </div>`;
}

function purchaseLineHtml(p) {
  return `
    <div class="tasting-line" data-purchase-id="${p.id}">
      <span class="tasting-line-text">${fmtDate(p.purchase_date)}${p.source ? ` · ${esc(p.source)}` : ""} · ${p.quantity} pcs${p.unit_price ? ` · ${fmtMoney(p.unit_price)}` : ""}</span>
      <span class="tasting-line-actions">
        <button type="button" class="purchase-edit-btn" data-id="${p.id}">Edit</button>
        <button type="button" class="purchase-delete-btn danger" data-id="${p.id}">Delete</button>
      </span>
    </div>`;
}

function glossaryLookup(term, category) {
  if (!term) return null;
  const hit = glossaryCache.find((g) => g.category === category && g.term.toLowerCase() === String(term).toLowerCase());
  return hit ? hit.description : null;
}

function factLineHtml(label, value, category) {
  if (!value) return "";
  const info = category ? glossaryLookup(value, category) : null;
  const icon = info
    ? `<span class="fact-info" tabindex="0"><span class="fact-info-icon">ⓘ</span><span class="fact-info-tip">${esc(info)}</span></span>`
    : "";
  return `<div><span class="md-fact-label">${label}:</span> ${esc(value)}${icon}</div>`;
}

const RATING_TAG_FIELDS = [
  ["draw_score", "Draw", "/5"], ["burn_score", "Burn", "/5"], ["construction_score", "Construction", "/5"],
  ["finish_score", "Finish", "/5"], ["overall_score", "Overall", "/5"],
];

function ratingSummaryHtml(c) {
  const tags = RATING_TAG_FIELDS.filter(([k]) => c[k]).map(([k, label, suffix]) => `${label} ${c[k]}${suffix}`);
  if (c.strength_experienced) tags.push(cap(c.strength_experienced).replace(/-(\w)/, (_, ch) => "-" + ch.toUpperCase()));
  return tags.length ? tags.join(" · ") : "Not rated — click to add";
}

function renderCigarModal(c) {
  const remaining = Number(c.quantity_remaining ?? 0);
  currentCigarData = c;

  const title = [c.brand, c.line].filter(Boolean).join(" ");

  const factRows = [
    factLineHtml("Filler", c.filler, "filler"),
    factLineHtml("Binder", c.binder, "binder"),
    factLineHtml("Wrapper", c.wrapper, "wrapper"),
    factLineHtml("Origin", c.origin, "origin"),
    factLineHtml("Length", c.length_mm ? `${c.length_mm} mm` : null, null),
    factLineHtml("Ring gauge", c.ring_gauge, null),
  ].filter(Boolean);

  const lastPurchase = c.purchases[0];
  const lastPurchaseHtml = lastPurchase
    ? `<div class="purchase-row">
         <div>
           <div class="pr-source">${esc(lastPurchase.source || "Unknown source")}</div>
           <div class="pr-meta">${fmtDate(lastPurchase.purchase_date)} · ${lastPurchase.quantity} pcs</div>
         </div>
         <div class="pr-price">${fmtMoney(lastPurchase.unit_price) || ""}</div>
       </div>`
    : `<p class="pr-meta">No purchases logged yet.</p>`;
  const allPurchasesHtml = c.purchases.length
    ? c.purchases.map(purchaseLineHtml).join("")
    : `<p class="pr-meta">No purchases logged yet.</p>`;

  const lastTasting = c.tastings[0];
  const lastTastingHtml = lastTasting
    ? `<div class="tasting-line" style="border-top:none"><span class="tasting-line-text">${fmtDate(lastTasting.tasting_date)}${lastTasting.location ? ` · ${esc(lastTasting.location)}` : ""}</span></div>`
    : `<p class="pr-meta">No tastings logged yet.</p>`;
  const allTastingsHtml = c.tastings.length
    ? c.tastings.map(tastingLineHtml).join("")
    : `<p class="pr-meta">No tastings logged yet.</p>`;

  modalBody.innerHTML = `
    <div class="md-header">
      <div class="md-header-text">
        <h3 class="md-title">${esc(title)}</h3>
        <p class="md-sub">${esc(c.vitola) || "&nbsp;"}</p>
      </div>
      ${c.photo_url ? `<img class="md-photo" src="${esc(c.photo_url)}" alt="" id="md-photo-img" />` : ""}
    </div>
    <div class="md-stock-row">
      <p class="md-stock">${remaining} left &nbsp;·&nbsp; ${c.total_bought} bought, ${c.total_smoked} smoked</p>
      <span class="md-score-badge${c.overall_score ? "" : " unscored"}">${c.overall_score ? c.overall_score + "/5" : "Not rated"}</span>
    </div>

    ${factRows.length ? `<div class="md-facts">${factRows.join("")}</div>` : ""}
    ${c.flavor_profile ? `<p class="md-fact-label" style="margin-top:8px">Expected profile: <span style="color:var(--ink)">${esc(c.flavor_profile)}</span></p>` : ""}

    <details class="add-term" id="profile-details" style="margin-top:14px">
      <summary>Edit profile</summary>
      <form id="profile-form" class="ledger-form" style="margin-top:12px">
        <div class="field-row">
          <label class="field"><span>Brand <em>*</em></span><input name="brand" required value="${esc(c.brand)}" /></label>
          <label class="field"><span>Line</span><input name="line" value="${esc(c.line || "")}" /></label>
          <label class="field"><span>Vitola</span><input name="vitola" value="${esc(c.vitola || "")}" /></label>
        </div>
        <div class="field-row">
          <label class="field field-sm"><span>Length (mm)</span><input name="length_mm" type="number" min="0" value="${c.length_mm ?? ""}" /></label>
          <label class="field field-sm"><span>Ring gauge</span><input name="ring_gauge" type="number" min="0" value="${c.ring_gauge ?? ""}" /></label>
          <label class="field field-sm"><span>Strength</span>${strengthSelectHtml("strength", c.strength)}</label>
        </div>
        <div class="field-row">
          <label class="field"><span>Filler</span><input name="filler" list="dl-filler" value="${esc(c.filler || "")}" /></label>
          <label class="field"><span>Binder</span><input name="binder" list="dl-binder" value="${esc(c.binder || "")}" /></label>
          <label class="field"><span>Wrapper</span><input name="wrapper" list="dl-wrapper" value="${esc(c.wrapper || "")}" /></label>
        </div>
        <label class="field"><span>Origin</span><input name="origin" list="dl-origin" value="${esc(c.origin || "")}" /></label>
        <label class="field"><span>Expected flavor profile</span><textarea name="flavor_profile" rows="2">${esc(c.flavor_profile || "")}</textarea></label>
        <label class="field"><span>Photo URL</span><input name="photo_url" type="url" value="${esc(c.photo_url || "")}" /></label>
        <label class="field"><span>Notes</span><textarea name="notes" rows="2">${esc(c.notes || "")}</textarea></label>
        <div class="form-actions">
          <button type="submit" class="btn-primary">Save profile</button>
          <span class="form-status" data-status-for="profile"></span>
        </div>
      </form>
    </details>

    <div class="md-section">
      <h4>Rating</h4>
      <details class="add-term" id="rating-details">
        <summary>${ratingSummaryHtml(c)}</summary>
        <form id="rating-form" class="ledger-form" style="margin-top:12px">
          <div class="rating-grid">
            <label class="field"><span>Draw (1-5)</span><input name="draw_score" type="number" min="1" max="5" value="${c.draw_score ?? ""}" /></label>
            <label class="field"><span>Burn (1-5)</span><input name="burn_score" type="number" min="1" max="5" value="${c.burn_score ?? ""}" /></label>
            <label class="field"><span>Construction (1-5)</span><input name="construction_score" type="number" min="1" max="5" value="${c.construction_score ?? ""}" /></label>
            <label class="field"><span>Finish (1-5)</span><input name="finish_score" type="number" min="1" max="5" value="${c.finish_score ?? ""}" /></label>
            <label class="field"><span>Overall (1-5)</span><input name="overall_score" type="number" min="1" max="5" value="${c.overall_score ?? ""}" /></label>
            <label class="field"><span>Strength felt</span>${strengthSelectHtml("strength_experienced", c.strength_experienced)}</label>
          </div>
          <label class="field"><span>Notes</span><textarea name="scoring_notes" rows="2">${esc(c.scoring_notes || "")}</textarea></label>
          <div class="form-actions">
            <button type="submit" class="btn-primary">Save rating</button>
            <span class="form-status" data-status-for="rating"></span>
          </div>
        </form>
      </details>
    </div>

    <div class="md-section">
      <div class="tasting-summary-row">
        <h4>Purchases</h4>
        <span class="tasting-count">${c.total_bought} bought</span>
      </div>
      ${lastPurchaseHtml}
      <details class="add-term" style="margin-top:10px">
        <summary>Show all &amp; add</summary>
        <div class="tasting-log">${allPurchasesHtml}</div>
        <form id="purchase-form" class="ledger-form" style="margin-top:12px">
          <div class="field-row">
            <label class="field"><span>Source</span><input name="source" placeholder="sarayasigara.com" /></label>
            <label class="field field-sm"><span>Date</span><input name="purchase_date" type="date" /></label>
          </div>
          <div class="field-row">
            <label class="field field-sm"><span>Quantity *</span><input name="quantity" type="number" min="1" required /></label>
            <label class="field field-sm"><span>Unit price ($)</span><input name="unit_price" type="number" min="0" step="0.01" /></label>
            <label class="field"><span>Box code</span><input name="box_code" /></label>
          </div>
          <label class="field"><span>Reference link</span><input name="reference_url" type="url" placeholder="https://…" /></label>
          <div class="form-actions">
            <button type="submit" class="btn-primary" id="purchase-submit-btn">Save</button>
            <button type="button" id="purchase-cancel-edit" class="link-btn" hidden>Cancel edit</button>
            <span class="form-status" data-status-for="purchase"></span>
          </div>
        </form>
      </details>
    </div>

    <div class="md-section">
      <div class="tasting-summary-row">
        <h4>Tastings</h4>
        <span class="tasting-count">${c.total_smoked} smoked</span>
      </div>
      ${lastTastingHtml}
      <details class="add-term" id="tasting-details" style="margin-top:10px">
        <summary>Show all &amp; log a tasting</summary>
        <div class="tasting-log">${allTastingsHtml}</div>
        <form id="tasting-form" class="ledger-form" style="margin-top:12px">
          <div class="field-row">
            <label class="field field-sm"><span>Date</span><input name="tasting_date" type="date" value="${todayISO()}" /></label>
            <label class="field"><span>Location</span><input name="location" placeholder="Home, lounge, backyard…" /></label>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn-primary" id="tasting-submit-btn">Log tasting</button>
            <button type="button" id="tasting-cancel-edit" class="link-btn" hidden>Cancel edit</button>
            <span class="form-status" data-status-for="tasting"></span>
          </div>
        </form>
      </details>
    </div>

    <div class="md-section md-danger-zone">
      <button type="button" id="delete-cigar-btn" class="btn-danger">Delete this cigar</button>
      <span class="form-status" data-status-for="delete"></span>
    </div>
  `;

  wireModalForms(c.id);
}

function openLightbox(src) {
  const overlay = document.createElement("div");
  overlay.className = "lightbox";
  overlay.innerHTML = `<img src="${esc(src)}" alt="" />`;
  overlay.addEventListener("click", () => overlay.remove());
  document.body.appendChild(overlay);
}

function wireModalForms(cigarId) {
  const photoImg = document.getElementById("md-photo-img");
  if (photoImg) photoImg.addEventListener("click", () => openLightbox(photoImg.src));

  const profileForm = document.getElementById("profile-form");
  profileForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = profileForm.querySelector('[data-status-for="profile"]');
    const data = Object.fromEntries(new FormData(profileForm));
    Object.keys(data).forEach((k) => { if (data[k] === "") delete data[k]; });
    try {
      await apiFetch(`/api/cigars/${cigarId}`, { method: "PUT", body: JSON.stringify(data) });
      status.textContent = "Saved ✓"; status.className = "form-status ok";
      const fresh = await apiFetch(`/api/cigars/${cigarId}`);
      renderCigarModal(fresh);
      loadInventory(); loadStats();
    } catch (err) {
      status.textContent = err.message; status.className = "form-status err";
    }
  });

  const ratingForm = document.getElementById("rating-form");
  ratingForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = ratingForm.querySelector('[data-status-for="rating"]');
    const data = Object.fromEntries(new FormData(ratingForm));
    Object.keys(data).forEach((k) => { if (data[k] === "") delete data[k]; });
    for (const key of RATING_FIELDS) if (!(key in data)) data[key] = null;
    try {
      await apiFetch(`/api/cigars/${cigarId}`, { method: "PUT", body: JSON.stringify(data) });
      status.textContent = "Saved ✓"; status.className = "form-status ok";
      const fresh = await apiFetch(`/api/cigars/${cigarId}`);
      renderCigarModal(fresh);
      loadInventory(); loadStats();
    } catch (err) {
      status.textContent = err.message; status.className = "form-status err";
    }
  });

  // --- Purchases: add/edit/delete ---
  const purchaseForm = document.getElementById("purchase-form");
  const purchaseCancelBtn = document.getElementById("purchase-cancel-edit");
  const purchaseSubmitBtn = document.getElementById("purchase-submit-btn");

  if (editingPurchaseId) {
    const p = currentCigarData.purchases.find((x) => x.id === editingPurchaseId);
    if (p) {
      for (const key of PURCHASE_FIELDS) {
        const el = purchaseForm.querySelector(`[name="${key}"]`);
        if (el && p[key] !== null && p[key] !== undefined) el.value = p[key];
      }
      purchaseSubmitBtn.textContent = "Update purchase";
      purchaseCancelBtn.hidden = false;
      purchaseForm.closest("details").open = true;
    } else {
      editingPurchaseId = null;
    }
  }

  purchaseForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = purchaseForm.querySelector('[data-status-for="purchase"]');
    const data = Object.fromEntries(new FormData(purchaseForm));
    Object.keys(data).forEach((k) => { if (data[k] === "") delete data[k]; });
    if (!editingPurchaseId && !data.quantity) return;
    try {
      if (editingPurchaseId) {
        await apiFetch(`/api/purchases/${editingPurchaseId}`, { method: "PUT", body: JSON.stringify(data) });
        status.textContent = "Updated ✓";
      } else {
        await apiFetch(`/api/cigars/${cigarId}/purchases`, { method: "POST", body: JSON.stringify(data) });
        status.textContent = "Added ✓";
      }
      status.className = "form-status ok";
      editingPurchaseId = null;
      const fresh = await apiFetch(`/api/cigars/${cigarId}`);
      renderCigarModal(fresh);
      loadInventory(); loadStats();
    } catch (err) {
      status.textContent = err.message; status.className = "form-status err";
    }
  });

  purchaseCancelBtn.addEventListener("click", () => {
    editingPurchaseId = null;
    purchaseForm.reset();
    purchaseSubmitBtn.textContent = "Save";
    purchaseCancelBtn.hidden = true;
  });

  modalBody.querySelectorAll(".purchase-edit-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      editingPurchaseId = Number(btn.dataset.id);
      renderCigarModal(currentCigarData);
    });
  });

  modalBody.querySelectorAll(".purchase-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this purchase? This cannot be undone.")) return;
      try {
        await apiFetch(`/api/purchases/${btn.dataset.id}`, { method: "DELETE" });
        const fresh = await apiFetch(`/api/cigars/${cigarId}`);
        renderCigarModal(fresh);
        loadInventory(); loadStats();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  // --- Tastings: add/edit/delete ---
  const tastingForm = document.getElementById("tasting-form");
  const cancelEditBtn = document.getElementById("tasting-cancel-edit");
  const submitBtn = document.getElementById("tasting-submit-btn");

  if (editingTastingId) {
    const t = currentCigarData.tastings.find((x) => x.id === editingTastingId);
    if (t) {
      for (const key of TASTING_FIELDS) {
        const el = tastingForm.querySelector(`[name="${key}"]`);
        if (el && t[key] !== null && t[key] !== undefined) el.value = t[key];
      }
      submitBtn.textContent = "Update tasting";
      cancelEditBtn.hidden = false;
      document.getElementById("tasting-details").open = true;
    } else {
      editingTastingId = null;
    }
  }

  tastingForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = tastingForm.querySelector('[data-status-for="tasting"]');
    const data = Object.fromEntries(new FormData(tastingForm));
    Object.keys(data).forEach((k) => { if (data[k] === "") delete data[k]; });
    try {
      if (editingTastingId) {
        await apiFetch(`/api/tastings/${editingTastingId}`, { method: "PUT", body: JSON.stringify(data) });
        status.textContent = "Updated ✓";
      } else {
        await apiFetch(`/api/cigars/${cigarId}/tastings`, { method: "POST", body: JSON.stringify(data) });
        status.textContent = "Saved ✓";
      }
      status.className = "form-status ok";
      editingTastingId = null;
      const fresh = await apiFetch(`/api/cigars/${cigarId}`);
      renderCigarModal(fresh);
      loadInventory(); loadStats();
    } catch (err) {
      status.textContent = err.message; status.className = "form-status err";
    }
  });

  cancelEditBtn.addEventListener("click", () => {
    editingTastingId = null;
    tastingForm.reset();
    tastingForm.querySelector('[name="tasting_date"]').value = todayISO();
    submitBtn.textContent = "Log tasting";
    cancelEditBtn.hidden = true;
  });

  modalBody.querySelectorAll(".tasting-edit-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      editingTastingId = Number(btn.dataset.id);
      renderCigarModal(currentCigarData);
    });
  });

  modalBody.querySelectorAll(".tasting-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this tasting? This cannot be undone.")) return;
      try {
        await apiFetch(`/api/tastings/${btn.dataset.id}`, { method: "DELETE" });
        const fresh = await apiFetch(`/api/cigars/${cigarId}`);
        renderCigarModal(fresh);
        loadInventory(); loadStats();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  // --- Delete the whole cigar ---
  document.getElementById("delete-cigar-btn").addEventListener("click", async () => {
    const label = [currentCigarData.brand, currentCigarData.line].filter(Boolean).join(" ");
    if (!confirm(`Delete "${label}" completely? This also removes all its purchases and tastings. This cannot be undone.`)) return;
    try {
      await apiFetch(`/api/cigars/${cigarId}`, { method: "DELETE" });
      closeModal();
      loadInventory(); loadStats();
    } catch (err) {
      const status = document.querySelector('[data-status-for="delete"]');
      if (status) { status.textContent = err.message; status.className = "form-status err"; }
    }
  });
}

// --- New cigar form ----------------------------------------------------------
const cigarForm = document.getElementById("cigar-form");
cigarForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = document.getElementById("cigar-form-status");
  const data = Object.fromEntries(new FormData(cigarForm));
  Object.keys(data).forEach((k) => { if (data[k] === "") delete data[k]; });
  try {
    const created = await apiFetch("/api/cigars", { method: "POST", body: JSON.stringify(data) });
    status.textContent = "Cigar saved ✓";
    status.className = "form-status ok";
    cigarForm.reset();
    document.getElementById("photo-preview").hidden = true;
    document.getElementById("extract-url").value = "";
    document.getElementById("extract-status").textContent = "";
    document.getElementById("extract-notes").hidden = true;
    await loadInventory(); loadStats();
    switchView("inventory");
    openCigarModal(created.id);
  } catch (err) {
    status.textContent = err.message;
    status.className = "form-status err";
  }
});

// --- Fill from link (AI-assisted) -------------------------------------------
const CIGAR_FIELDS = ["brand", "line", "vitola", "length_mm", "ring_gauge", "filler", "binder", "wrapper", "origin", "strength", "flavor_profile"];

document.getElementById("extract-btn").addEventListener("click", async () => {
  const btn = document.getElementById("extract-btn");
  const url = document.getElementById("extract-url").value.trim();
  const status = document.getElementById("extract-status");
  const notes = document.getElementById("extract-notes");
  if (!url) return;

  btn.disabled = true;
  btn.textContent = "Reading…";
  status.textContent = "Reading the page, searching the web for anything missing — this can take 20-30 seconds…";
  status.className = "form-status";
  notes.hidden = true;

  try {
    const data = await apiFetch("/api/extract", { method: "POST", body: JSON.stringify({ url }) });
    for (const key of CIGAR_FIELDS) {
      const el = cigarForm.querySelector(`[name="${key}"]`);
      if (el && data[key] !== null && data[key] !== undefined && data[key] !== "") el.value = data[key];
    }
    if (data.photo_url) {
      document.getElementById("cigar-photo-url").value = data.photo_url;
      document.getElementById("photo-preview-img").src = data.photo_url;
      document.getElementById("photo-preview").hidden = false;
    }
    status.textContent = "Filled ✓ — review before saving";
    status.className = "form-status ok";
    if (data.confidence_notes) {
      notes.textContent = data.confidence_notes;
      notes.hidden = false;
    }
  } catch (err) {
    status.textContent = err.message;
    status.className = "form-status err";
  } finally {
    btn.disabled = false;
    btn.textContent = "Fill";
  }
});

document.getElementById("photo-remove").addEventListener("click", () => {
  document.getElementById("cigar-photo-url").value = "";
  document.getElementById("photo-preview").hidden = true;
});

// --- Glossary ------------------------------------------------------------
const CAT_LABELS = { wrapper: "Wrapper", binder: "Binder", filler: "Filler", origin: "Origin" };

async function loadGlossary() {
  glossaryCache = await apiFetch("/api/glossary");
  renderGlossary();
  fillDatalists();
}

function renderGlossary() {
  const container = document.getElementById("glossary-groups");
  container.innerHTML = "";
  for (const cat of ["wrapper", "binder", "filler", "origin"]) {
    const items = glossaryCache.filter((g) => g.category === cat);
    if (items.length === 0) continue;
    const section = document.createElement("div");
    section.className = "glossary-cat";
    section.innerHTML = `
      <h3>${CAT_LABELS[cat]}</h3>
      ${items.map((g) => `
        <div class="g-entry">
          <div class="g-term">${esc(g.term)}</div>
          <p class="g-desc">${esc(g.description)}</p>
        </div>`).join("")}
    `;
    container.appendChild(section);
  }
}

function fillDatalists() {
  const map = { wrapper: "dl-wrapper", binder: "dl-binder", filler: "dl-filler", origin: "dl-origin" };
  for (const [cat, id] of Object.entries(map)) {
    const dl = document.getElementById(id);
    dl.innerHTML = glossaryCache
      .filter((g) => g.category === cat)
      .map((g) => `<option value="${esc(g.term)}"></option>`)
      .join("");
  }
}

const glossaryForm = document.getElementById("glossary-form");
glossaryForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = document.getElementById("glossary-form-status");
  const data = Object.fromEntries(new FormData(glossaryForm));
  try {
    await apiFetch("/api/glossary", { method: "POST", body: JSON.stringify(data) });
    status.textContent = "Added ✓"; status.className = "form-status ok";
    glossaryForm.reset();
    await loadGlossary();
  } catch (err) {
    status.textContent = err.message; status.className = "form-status err";
  }
});

// --- Sensors / Humidors ------------------------------------------------
async function loadHumidors() {
  const grid = document.getElementById("humidor-grid");
  const empty = document.getElementById("humidor-empty");
  grid.innerHTML = `<p class="loading">Loading…</p>`;

  const humidors = await apiFetch("/api/humidors");
  renderDashboardSensors(humidors);
  grid.innerHTML = "";

  if (humidors.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  for (const h of humidors) {
    const card = document.createElement("div");
    card.className = "humidor-card";
    const hasReading = h.latest_reading_time != null;
    card.innerHTML = `
      <div class="humidor-name">${esc(h.name)}</div>
      ${h.location_note ? `<div class="humidor-note">${esc(h.location_note)}</div>` : ""}
      ${hasReading
        ? `<div class="humidor-readings">
             <div><span class="humidor-reading-num">${Number(h.latest_temperature_c)}°</span><div class="humidor-reading-lbl">temp</div></div>
             <div><span class="humidor-reading-num">${Number(h.latest_humidity_pct)}%</span><div class="humidor-reading-lbl">humidity</div></div>
           </div>`
        : `<p class="humidor-waiting">${h.mac_address ? "Waiting for data…" : "No MAC address yet — readings will start once the device is set up"}</p>`}
      ${h.mac_address ? `<div class="humidor-mac">${esc(h.mac_address)}</div>` : ""}
    `;
    grid.appendChild(card);
  }
}

// Renders the compact, right-aligned sensor summary in the dashboard's stat row.
// With zero humidors nothing renders — the row just keeps its 3 numbers.
function renderDashboardSensors(humidors) {
  const container = document.getElementById("dash-sensors");
  if (!humidors || humidors.length === 0) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = humidors.map((h) => {
    const hasReading = h.latest_reading_time != null;
    return `
      <div class="dash-sensor">
        <span class="dash-sensor-name">${esc(h.name)}</span>
        ${hasReading
          ? `<span class="dash-sensor-reading">${Number(h.latest_temperature_c)}° · ${Number(h.latest_humidity_pct)}%</span>`
          : `<span class="dash-sensor-waiting">waiting for data</span>`}
      </div>`;
  }).join("");
}

const humidorForm = document.getElementById("humidor-form");
humidorForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = document.getElementById("humidor-form-status");
  const data = Object.fromEntries(new FormData(humidorForm));
  Object.keys(data).forEach((k) => { if (data[k] === "") delete data[k]; });
  try {
    await apiFetch("/api/humidors", { method: "POST", body: JSON.stringify(data) });
    status.textContent = "Added ✓"; status.className = "form-status ok";
    humidorForm.reset();
    await loadHumidors();
  } catch (err) {
    status.textContent = err.message; status.className = "form-status err";
  }
});

// --- Startup -----------------------------------------------------------
function initApp() {
  switchView("inventory");
  loadStats().catch((e) => console.error(e));
  loadInventory().catch((e) => console.error(e));
  loadGlossary().catch((e) => console.error(e));
  loadHumidors().catch((e) => console.error(e));
}

initApp();
