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

// /photos/cigars/:id 1 haftalık uzun cache ile dönüyor (bkz. photosRoute.ts) --
// bu doğru, ANCAK URL sabit kalırsa foto URL'den/dosyadan güncellendiğinde
// tarayıcı eski görseli hâlâ cache'ten gösterir. c.updated_at her foto
// değişiminde değiştiği için (hem PUT /:id hem PUT /:id/photo bunu set ediyor)
// query param olarak eklemek URL'i "versiyonluyor" -- foto değişince URL de
// değişip tazeyi çeker, değişmeyen fotoğraflar hâlâ tam cache avantajını korur.
function photoUrl(c) {
  if (!c.has_photo) return null;
  const v = Date.parse(c.updated_at) || 0;
  return `/photos/cigars/${c.id}?v=${v}`;
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
  document.getElementById("stat-bought").textContent = stats.total_bought;
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

// --- Inventory (list view, with search/sort/filter) ------------------------
let cigarsCache = [];
const INVENTORY_PAGE_SIZE = 20;
let inventoryVisibleCount = INVENTORY_PAGE_SIZE;

async function loadInventory() {
  cigarsCache = await apiFetch("/api/cigars");
  populateWrapperFilterOptions();
  applyInventoryFilters(true);
}

function populateWrapperFilterOptions() {
  const sel = document.getElementById("inv-filter-wrapper");
  const current = sel.value;
  const distinct = [...new Set(cigarsCache.map((c) => c.wrapper).filter(Boolean))].sort();
  sel.innerHTML = `<option value="">All wrappers</option>` + distinct.map((w) => `<option value="${esc(w)}">${esc(w)}</option>`).join("");
  if (distinct.includes(current)) sel.value = current;
}

// resetPagination: filtre/arama/sıralama değiştiğinde true (baştan 20 göster),
// "Load more" tıklandığında false (sadece görünen sayıyı artır, listeyi
// başa sarma).
function applyInventoryFilters(resetPagination) {
  if (resetPagination) inventoryVisibleCount = INVENTORY_PAGE_SIZE;

  const search = document.getElementById("inv-search").value.trim().toLowerCase();
  const sortBy = document.getElementById("inv-sort").value;
  const strengthFilter = document.getElementById("inv-filter-strength").value;
  const wrapperFilter = document.getElementById("inv-filter-wrapper").value;
  const inStockOnly = document.getElementById("inv-in-stock-only").checked;

  let filtered = cigarsCache.filter((c) => {
    if (search) {
      const haystack = [c.brand, c.line, c.vitola].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (strengthFilter && c.strength !== strengthFilter) return false;
    if (wrapperFilter && c.wrapper !== wrapperFilter) return false;
    if (inStockOnly && Number(c.quantity_remaining ?? 0) <= 0) return false;
    return true;
  });

  filtered.sort((a, b) => {
    // Favoriler seçili sıralama kriterinden bağımsız her zaman önce gelir --
    // backend'in ORDER BY is_favorite DESC'i burada eziliyordu, düzeltiyoruz.
    if (Boolean(a.is_favorite) !== Boolean(b.is_favorite)) {
      return a.is_favorite ? -1 : 1;
    }
    switch (sortBy) {
      case "rating":
        return (b.overall_score || 0) - (a.overall_score || 0);
      case "smoked":
        return b.total_smoked - a.total_smoked;
      case "stock":
        return Number(b.quantity_remaining ?? 0) - Number(a.quantity_remaining ?? 0);
      case "newest":
        return new Date(b.created_at) - new Date(a.created_at);
      case "name":
      default:
        return [a.brand, a.line].filter(Boolean).join(" ").localeCompare([b.brand, b.line].filter(Boolean).join(" "));
    }
  });

  const filtersActive = Boolean(search || strengthFilter || wrapperFilter || inStockOnly);
  renderInventoryList(filtered, filtersActive);
}

async function toggleFavorite(e, id, starEl) {
  e.preventDefault();
  e.stopPropagation();
  const cigar = cigarsCache.find((x) => x.id === id);
  if (!cigar) return;
  const newVal = !cigar.is_favorite;
  starEl.classList.toggle("is-favorite", newVal);
  try {
    await apiFetch(`/api/cigars/${id}`, { method: "PUT", body: JSON.stringify({ is_favorite: newVal }) });
    cigar.is_favorite = newVal;
    if (currentCigarData && currentCigarData.id === id) currentCigarData.is_favorite = newVal;
  } catch (err) {
    starEl.classList.toggle("is-favorite", !newVal);
    alert(err.message);
  }
}

function renderInventoryList(cigars, filtersActive) {
  const list = document.getElementById("inventory-list");
  const empty = document.getElementById("inventory-empty");
  const noMatch = document.getElementById("inventory-no-match");
  const count = document.getElementById("inventory-count");
  const loadMoreBtn = document.getElementById("inv-load-more");
  list.innerHTML = "";

  if (cigarsCache.length === 0) {
    empty.hidden = false;
    noMatch.hidden = true;
    count.textContent = "";
    loadMoreBtn.hidden = true;
    return;
  }
  empty.hidden = true;

  if (cigars.length === 0) {
    noMatch.hidden = false;
    count.textContent = `0 of ${cigarsCache.length} cigars`;
    loadMoreBtn.hidden = true;
    return;
  }
  noMatch.hidden = true;

  const visible = cigars.slice(0, inventoryVisibleCount);
  const remainingCount = cigars.length - visible.length;

  let countText = remainingCount > 0
    ? `Showing ${visible.length} of ${cigars.length} cigar${cigars.length === 1 ? "" : "s"}`
    : `${cigars.length} cigar${cigars.length === 1 ? "" : "s"}`;
  if (filtersActive) countText += ` (${cigarsCache.length} total)`;
  count.textContent = countText;

  for (const c of visible) {
    const remaining = Number(c.quantity_remaining ?? 0);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "cigar-row";
    row.addEventListener("click", () => openCigarModal(c.id));

    const photoHtml = c.has_photo
      ? `<img class="cigar-row-photo" src="${photoUrl(c)}" alt="" />`
      : `<div class="cigar-row-photo-placeholder">${esc((c.brand || "?").charAt(0))}</div>`;

    const title = [c.brand, c.line].filter(Boolean).join(" ");

    row.innerHTML = `
      ${photoHtml}
      <div class="cigar-row-main">
        <div class="cigar-row-title">${esc(title)}</div>
        <div class="cigar-row-sub">${esc(c.vitola) || "&nbsp;"}</div>
      </div>
      <div class="cigar-row-nums">
        ${c.strength ? strengthBadgeHtml(c.strength) : `<span class="strength-badge strength-none">—</span>`}
        <div class="cigar-row-num"><span class="cigar-row-num-val">${c.total_bought}</span><span class="cigar-row-num-lbl">bought</span></div>
        <div class="cigar-row-num"><span class="cigar-row-num-val">${c.total_smoked}</span><span class="cigar-row-num-lbl">smoked</span></div>
        <div class="cigar-row-num"><span class="cigar-row-num-val">${remaining}</span><span class="cigar-row-num-lbl">left</span></div>
        <span class="cigar-row-score${c.overall_score ? "" : " unscored"}">${c.overall_score ? c.overall_score + "/5" : "—"}</span>
        <span class="favorite-star${c.is_favorite ? " is-favorite" : ""}" data-id="${c.id}" role="button" tabindex="0" aria-label="Toggle favorite">★</span>
      </div>
    `;
    list.appendChild(row);
  }

  list.querySelectorAll(".favorite-star").forEach((star) => {
    star.addEventListener("click", (e) => toggleFavorite(e, Number(star.dataset.id), star));
    star.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") toggleFavorite(e, Number(star.dataset.id), star);
    });
  });

  if (remainingCount > 0) {
    loadMoreBtn.hidden = false;
    loadMoreBtn.textContent = remainingCount > INVENTORY_PAGE_SIZE
      ? `Load ${INVENTORY_PAGE_SIZE} more`
      : `Load remaining ${remainingCount}`;
  } else {
    loadMoreBtn.hidden = true;
  }
}

document.getElementById("inv-load-more").addEventListener("click", () => {
  inventoryVisibleCount += INVENTORY_PAGE_SIZE;
  applyInventoryFilters(false);
});

["inv-search"].forEach((id) => document.getElementById(id).addEventListener("input", () => applyInventoryFilters(true)));
["inv-sort", "inv-filter-strength", "inv-filter-wrapper", "inv-in-stock-only"].forEach((id) =>
  document.getElementById(id).addEventListener("change", () => applyInventoryFilters(true))
);
document.getElementById("inv-clear-filters").addEventListener("click", () => {
  document.getElementById("inv-search").value = "";
  document.getElementById("inv-filter-strength").value = "";
  document.getElementById("inv-filter-wrapper").value = "";
  document.getElementById("inv-in-stock-only").checked = false;
  applyInventoryFilters(true);
});

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
  if (humidorChartInstance) {
    humidorChartInstance.destroy();
    humidorChartInstance = null;
  }
}

async function openCigarModal(id) {
  modal.hidden = false;
  modalBody.innerHTML = `<p class="modal-loading">Loading…</p>`;
  if (humidorChartInstance) {
    humidorChartInstance.destroy();
    humidorChartInstance = null;
  }
  const c = await apiFetch(`/api/cigars/${id}`);
  editingTastingId = null;
  editingPurchaseId = null;
  renderCigarModal(c);
}

const TASTING_FIELDS = ["tasting_date", "location", "humidor_id"];
const PURCHASE_FIELDS = ["source", "purchase_date", "quantity", "unit_price", "box_code", "reference_url"];
const RATING_FIELDS = ["draw_score", "burn_score", "construction_score", "finish_score", "overall_score", "strength_experienced", "scoring_notes", "duration_minutes"];
const STRENGTH_OPTIONS = ["mild", "mild-medium", "medium", "medium-full", "full"];

// Purchase/tasting formlarındaki "hangi humidor" seçicisi için ortak seçenek listesi.
// humidorsCache app başlarken loadHumidors() ile zaten dolduruluyor (bkz. initApp).
function humidorOptionsHtml(selectedId) {
  const sel = selectedId != null ? String(selectedId) : "";
  const opts = humidorsCache.map(
    (h) => `<option value="${h.id}"${String(h.id) === sel ? " selected" : ""}>${esc(h.name)}</option>`
  );
  return `<option value=""${sel === "" ? " selected" : ""}>—</option>${opts.join("")}`;
}

// Sertlik seçimini de wrapper/origin ile GÖRSEL OLARAK AYNI özel dropdown ile
// gösteriyoruz (native <select> farklı görünüyordu, bkz. ekran görüntüsü).
// Görünen metin (ör. "Mild-Medium") ile gerçek değer (ör. "mild-medium") farklı
// olduğu için ayrı bir gizli input'ta gerçek değeri tutuyoruz.
function strengthSelectHtml(name, current) {
  const currentLabel = current ? strengthLabel(current) : "";
  return `
    <div class="combo">
      <input type="text" class="combo-display" readonly value="${esc(currentLabel)}" placeholder="—" />
      <input type="hidden" name="${name}" value="${current || ""}" />
      <div class="combo-options" hidden></div>
    </div>`;
}

function wireFixedCombo(container) {
  if (!container) return;
  const display = container.querySelector(".combo-display");
  const hidden = container.querySelector('input[type="hidden"]');
  const dropdown = container.querySelector(".combo-options");

  function renderOptions() {
    const opts = [{ value: "", label: "—" }, ...STRENGTH_OPTIONS.map((s) => ({ value: s, label: strengthLabel(s) }))];
    dropdown.innerHTML = opts.map((o) => `<div class="combo-option" data-value="${o.value}">${esc(o.label)}</div>`).join("");
    dropdown.hidden = false;
  }

  display.addEventListener("focus", renderOptions);
  display.addEventListener("blur", () => setTimeout(() => { dropdown.hidden = true; }, 150));

  dropdown.addEventListener("mousedown", (e) => {
    const opt = e.target.closest(".combo-option");
    if (!opt) return;
    display.value = opt.textContent;
    hidden.value = opt.dataset.value;
    dropdown.hidden = true;
  });
}

function humidorName(id) {
  if (id == null) return null;
  const h = humidorsCache.find((x) => x.id === Number(id));
  return h ? h.name : null;
}

function allocationLineHtml(a) {
  return `
    <div class="tasting-line" data-humidor-id="${a.humidor_id}">
      <span class="tasting-line-text">${esc(a.humidor_name)} · ${a.quantity} pcs</span>
      <span class="tasting-line-actions">
        <button type="button" class="allocation-remove-btn danger" data-humidor-id="${a.humidor_id}">Remove</button>
      </span>
    </div>`;
}

// Tadım formunda sadece bu puronun ŞU AN atanmış olduğu humidor(lar) listelenir --
// hiçbir humidor'a atanmamışsa alan hiç gösterilmez (bkz. kullanıcı isteği).
function tastingHumidorFieldHtml(c) {
  const allocations = c.humidor_allocations || [];
  if (allocations.length === 0) return "";
  const options = allocations
    .map((a) => `<option value="${a.humidor_id}">${esc(a.humidor_name)} (${a.quantity})</option>`)
    .join("");
  return `<label class="field field-sm"><span>From humidor</span><select name="humidor_id"><option value="">—</option>${options}</select></label>`;
}

function tastingLineHtml(t) {
  const hName = humidorName(t.humidor_id);
  return `
    <div class="tasting-line" data-tasting-id="${t.id}">
      <span class="tasting-line-text">${fmtDate(t.tasting_date)}${t.location ? ` · ${esc(t.location)}` : ""}${hName ? ` · <span class="tasting-line-humidor">${esc(hName)}</span>` : ""}</span>
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

function ratingFactsHtml(c) {
  const rows = [
    ["Draw", c.draw_score ? `${c.draw_score}/5` : null],
    ["Burn", c.burn_score ? `${c.burn_score}/5` : null],
    ["Construction", c.construction_score ? `${c.construction_score}/5` : null],
    ["Finish", c.finish_score ? `${c.finish_score}/5` : null],
    ["Overall", c.overall_score ? `${c.overall_score}/5` : null],
    ["Strength felt", c.strength_experienced ? strengthLabel(c.strength_experienced) : null],
    ["Duration", c.duration_minutes ? `${c.duration_minutes} min` : null],
  ].filter(([, v]) => v);
  return rows.map(([l, v]) => `<div><span class="md-fact-label">${l}:</span> ${esc(v)}</div>`).join("");
}

function strengthLabel(s) {
  return s.split("-").map(cap).join("-");
}

function strengthBadgeHtml(s) {
  if (!s) return "";
  return `<span class="strength-badge strength-${s}">${strengthLabel(s)}</span>`;
}

function renderCigarModal(c) {
  const remaining = Number(c.quantity_remaining ?? 0);
  currentCigarData = c;

  const allocations = c.humidor_allocations || [];
  const unassignedCount = remaining - allocations.reduce((sum, a) => sum + Number(a.quantity), 0);

  const title = [c.brand, c.line].filter(Boolean).join(" ");

  const factRows = [
    factLineHtml("Wrapper", c.wrapper, "wrapper"),
    factLineHtml("Origin", c.origin, "origin"),
    factLineHtml("Size", c.vitola, null),
    factLineHtml("Strength", c.strength ? strengthLabel(c.strength) : null, null),
    factLineHtml("Length", c.length_mm ? `${c.length_mm} mm` : null, null),
    factLineHtml("Ring gauge", c.ring_gauge, null),
  ].filter(Boolean);

  const hasRating = c.overall_score || c.draw_score || c.burn_score || c.construction_score || c.finish_score || c.strength_experienced || c.duration_minutes;

  const lastPurchase = c.purchases[0];
  const lastPurchaseHtml = lastPurchase
    ? `<p class="mini-label">Last purchased</p>
       <div class="purchase-row" data-purchase-id="${lastPurchase.id}">
         <div>
           <div class="pr-source">${esc(lastPurchase.source || "Unknown source")}</div>
           <div class="pr-meta">${fmtDate(lastPurchase.purchase_date)} · ${lastPurchase.quantity} pcs</div>
         </div>
         <div style="text-align:right">
           <div class="pr-price">${fmtMoney(lastPurchase.unit_price) || ""}</div>
           <div class="tasting-line-actions" style="margin-top:5px; justify-content:flex-end">
             <button type="button" class="purchase-edit-btn" data-id="${lastPurchase.id}">Edit</button>
             <button type="button" class="purchase-delete-btn danger" data-id="${lastPurchase.id}">Delete</button>
           </div>
         </div>
       </div>`
    : `<p class="pr-meta">No purchases logged yet.</p>`;

  const lastTasting = c.tastings[0];
  const lastTastingHtml = lastTasting
    ? `<p class="mini-label">Last tasting</p>${tastingLineHtml(lastTasting)}`
    : `<p class="pr-meta">No tastings logged yet.</p>`;

  modalBody.innerHTML = `
    <div class="md-header">
      <div class="md-header-text">
        <h3 class="md-title">${esc(title)} <span class="favorite-star favorite-star-lg${c.is_favorite ? " is-favorite" : ""}" id="md-favorite-star" role="button" tabindex="0" aria-label="Toggle favorite">★</span></h3>
        <p class="md-sub">${esc(c.vitola) || "&nbsp;"}</p>
      </div>
      ${c.has_photo ? `<img class="md-photo" src="${photoUrl(c)}" alt="" id="md-photo-img" />` : ""}
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
          <label class="field"><span>Size</span><input name="vitola" value="${esc(c.vitola || "")}" /></label>
        </div>
        <div class="field-row">
          <label class="field field-sm"><span>Length (mm)</span><input name="length_mm" type="number" min="0" value="${c.length_mm ?? ""}" /></label>
          <label class="field field-sm"><span>Ring gauge</span><input name="ring_gauge" type="number" min="0" value="${c.ring_gauge ?? ""}" /></label>
          <label class="field field-sm"><span>Strength</span>${strengthSelectHtml("strength", c.strength)}</label>
        </div>
        <div class="field-row">
          <label class="field">
            <span>Wrapper</span>
            <div class="combo" data-category="wrapper">
              <input name="wrapper" type="text" autocomplete="off" value="${esc(c.wrapper || "")}" />
              <div class="combo-options" hidden></div>
            </div>
          </label>
          <label class="field">
            <span>Origin</span>
            <div class="combo" data-category="origin">
              <input name="origin" type="text" autocomplete="off" value="${esc(c.origin || "")}" />
              <div class="combo-options" hidden></div>
            </div>
          </label>
        </div>
        <label class="field"><span>Expected flavor profile</span><textarea name="flavor_profile" rows="2">${esc(c.flavor_profile || "")}</textarea></label>
        <label class="field"><span>Photo URL</span><input name="photo_url" type="url" value="${esc(c.photo_url || "")}" /></label>
        <label class="field"><span>Or upload a photo</span><input type="file" id="profile-photo-file" accept="image/*" /></label>
        <label class="field"><span>Notes</span><textarea name="notes" rows="2">${esc(c.notes || "")}</textarea></label>
        <div class="form-actions">
          <button type="submit" class="btn-primary">Save profile</button>
          <span class="form-status" data-status-for="profile"></span>
          <button type="button" id="delete-cigar-btn" class="btn-icon-danger" title="Delete this cigar" aria-label="Delete this cigar">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16z"/></svg>
          </button>
        </div>
        <span class="form-status" data-status-for="delete"></span>
      </form>
    </details>

    <div class="md-section">
      <h4>Rating</h4>
      ${hasRating
        ? `<div class="md-facts">${ratingFactsHtml(c)}</div>${c.scoring_notes ? `<p class="pr-meta" style="margin-top:6px"><span class="md-fact-label">Notes:</span> ${esc(c.scoring_notes)}</p>` : ""}`
        : `<p class="pr-meta">Not rated yet.</p>`}
      <details class="add-term" id="rating-details" style="margin-top:10px">
        <summary>${hasRating ? "Edit rating" : "Add rating"}</summary>
        <form id="rating-form" class="ledger-form" style="margin-top:12px">
          <div class="rating-grid">
            <label class="field"><span>Draw (1-5)</span><input name="draw_score" type="number" min="1" max="5" value="${c.draw_score ?? ""}" /></label>
            <label class="field"><span>Burn (1-5)</span><input name="burn_score" type="number" min="1" max="5" value="${c.burn_score ?? ""}" /></label>
            <label class="field"><span>Construction (1-5)</span><input name="construction_score" type="number" min="1" max="5" value="${c.construction_score ?? ""}" /></label>
            <label class="field"><span>Finish (1-5)</span><input name="finish_score" type="number" min="1" max="5" value="${c.finish_score ?? ""}" /></label>
            <label class="field"><span>Overall (1-5)</span><input name="overall_score" type="number" min="1" max="5" value="${c.overall_score ?? ""}" /></label>
            <label class="field"><span>Strength felt</span>${strengthSelectHtml("strength_experienced", c.strength_experienced)}</label>
            <label class="field"><span>Duration (min)</span><input name="duration_minutes" type="number" min="0" value="${c.duration_minutes ?? ""}" /></label>
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
        <h4>Humidor</h4>
        <span class="tasting-count">${unassignedCount} unassigned</span>
      </div>
      ${allocations.length > 0
        ? `<div class="tasting-log">${allocations.map(allocationLineHtml).join("")}</div>`
        : `<p class="pr-meta">Not assigned to a humidor yet.</p>`}
      <form id="allocation-form" class="ledger-form" style="margin-top:10px">
        <div class="field-row purchase-row-compact">
          <label class="field"><span>Humidor</span><select name="humidor_id" id="allocation-humidor-select" required>${humidorOptionsHtml()}</select></label>
          <label class="field field-sm"><span>Qty *</span><input name="quantity" id="allocation-qty-input" type="number" min="1" required /></label>
        </div>
        <p class="field-hint" id="allocation-max-hint"></p>
        <div class="form-actions">
          <button type="submit" class="btn-primary">Set</button>
          <span class="form-status" data-status-for="allocation"></span>
        </div>
      </form>
    </div>

    <div class="md-section">
      <div class="tasting-summary-row">
        <h4>Purchases</h4>
        <span class="tasting-count">${c.total_bought} bought</span>
      </div>
      ${lastPurchaseHtml}
      <form id="purchase-form" class="ledger-form" style="margin-top:10px">
        <div class="field-row purchase-row-compact">
          <label class="field field-sm"><span>Date</span><input name="purchase_date" type="date" value="${todayISO()}" /></label>
          <label class="field"><span>Source</span><input name="source" placeholder="Where did you purchase?" /></label>
          <label class="field field-sm"><span>Qty *</span><input name="quantity" type="number" min="1" required /></label>
          <label class="field field-sm"><span>Price ($)</span><input name="unit_price" type="number" min="0" step="0.01" /></label>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn-primary" id="purchase-submit-btn">Save</button>
          <button type="button" id="purchase-cancel-edit" class="link-btn" hidden>Cancel edit</button>
          <span class="form-status" data-status-for="purchase"></span>
        </div>
      </form>
      ${c.purchases.length > 0 ? `
        <details class="add-term" style="margin-top:12px">
          <summary>Show all ${c.purchases.length} purchase${c.purchases.length === 1 ? "" : "s"}</summary>
          <div class="tasting-log">${c.purchases.map(purchaseLineHtml).join("")}</div>
        </details>` : ""}
    </div>

    <div class="md-section">
      <div class="tasting-summary-row">
        <h4>Tastings</h4>
        <span class="tasting-count">${c.total_smoked} smoked</span>
      </div>
      ${lastTastingHtml}
      <form id="tasting-form" class="ledger-form" style="margin-top:10px">
        <div class="field-row">
          <label class="field field-sm"><span>Date</span><input name="tasting_date" type="date" value="${todayISO()}" /></label>
          <label class="field"><span>Location</span><input name="location" placeholder="Where did you smoke?" /></label>
          ${tastingHumidorFieldHtml(c)}
        </div>
        <div class="form-actions">
          <button type="submit" class="btn-primary" id="tasting-submit-btn">Log tasting</button>
          <button type="button" id="tasting-cancel-edit" class="link-btn" hidden>Cancel edit</button>
          <span class="form-status" data-status-for="tasting"></span>
        </div>
      </form>
      ${c.tastings.length > 0 ? `
        <details class="add-term" id="tasting-details" style="margin-top:12px">
          <summary>Show all ${c.tastings.length} tasting${c.tastings.length === 1 ? "" : "s"}</summary>
          <div class="tasting-log">${c.tastings.map(tastingLineHtml).join("")}</div>
        </details>` : ""}
    </div>
  `;

  wireModalForms(c.id);
  wireCombo(document.querySelector('#profile-form .combo[data-category="wrapper"]'), "wrapper");
  wireCombo(document.querySelector('#profile-form .combo[data-category="origin"]'), "origin");
  wireFixedCombo(document.querySelector('#profile-form .combo:not([data-category])'));
  wireFixedCombo(document.querySelector('#rating-form .combo:not([data-category])'));
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

  const favStar = document.getElementById("md-favorite-star");
  if (favStar) {
    favStar.addEventListener("click", (e) => toggleFavorite(e, cigarId, favStar));
    favStar.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") toggleFavorite(e, cigarId, favStar);
    });
  }

  const profileForm = document.getElementById("profile-form");
  profileForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = profileForm.querySelector('[data-status-for="profile"]');
    const data = Object.fromEntries(new FormData(profileForm));
    Object.keys(data).forEach((k) => { if (data[k] === "") delete data[k]; });
    // photo_url alanı da gönderiliyorsa PUT /api/cigars/:id zaten onu indirip
    // photo_data'yı DEĞİŞTİRİYOR (bkz. cigars.ts). Elle dosya seçildiyse aynı
    // "yerine geçme" davranışını /photo endpoint'iyle ayrıca yapıyoruz.
    const photoFile = document.getElementById("profile-photo-file")?.files[0];
    try {
      await apiFetch(`/api/cigars/${cigarId}`, { method: "PUT", body: JSON.stringify(data) });
      let photoWarning = "";
      if (photoFile) {
        try {
          await apiFetch(`/api/cigars/${cigarId}/photo`, {
            method: "PUT",
            body: photoFile,
            headers: { "Content-Type": photoFile.type || "application/octet-stream" },
          });
        } catch (photoErr) {
          photoWarning = ` (photo upload failed: ${photoErr.message})`;
        }
      }
      status.textContent = `Saved ✓${photoWarning}`;
      status.className = photoWarning ? "form-status err" : "form-status ok";
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

  // --- Humidor: allocation set/remove ---
  const allocationForm = document.getElementById("allocation-form");
  const allocationHumidorSelect = document.getElementById("allocation-humidor-select");
  const allocationQtyInput = document.getElementById("allocation-qty-input");
  const allocationMaxHint = document.getElementById("allocation-max-hint");

  // Seçilen humidor değiştikçe "en fazla kaç tane atayabilirsin" ipucunu
  // güncelliyoruz -- bu humidor'un kendi mevcut değeri hariç tutuluyor (onu
  // aynı değere ya da daha büyüğe ayarlamak serbest olmalı, backend de aynı mantıkla doğruluyor).
  function updateAllocationMaxHint() {
    const selectedHumidorId = Number(allocationHumidorSelect.value);
    const allocs = currentCigarData.humidor_allocations || [];
    const remaining = Number(currentCigarData.quantity_remaining ?? 0);
    const unassigned = remaining - allocs.reduce((sum, a) => sum + Number(a.quantity), 0);
    const existing = allocs.find((a) => a.humidor_id === selectedHumidorId);
    const maxAllowed = unassigned + (existing ? Number(existing.quantity) : 0);

    if (!allocationHumidorSelect.value) {
      allocationMaxHint.textContent = "";
      allocationQtyInput.removeAttribute("max");
      return;
    }
    allocationMaxHint.textContent = maxAllowed > 0 ? `Up to ${maxAllowed} available` : "No cigars available to allocate here";
    allocationQtyInput.max = Math.max(maxAllowed, 0);
  }

  allocationHumidorSelect.addEventListener("change", updateAllocationMaxHint);
  updateAllocationMaxHint();

  allocationForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = allocationForm.querySelector('[data-status-for="allocation"]');
    const data = Object.fromEntries(new FormData(allocationForm));
    if (!data.humidor_id) {
      status.textContent = "Pick a humidor"; status.className = "form-status err";
      return;
    }
    try {
      await apiFetch(`/api/cigars/${cigarId}/allocations/${data.humidor_id}`, {
        method: "PUT",
        body: JSON.stringify({ quantity: Number(data.quantity) }),
      });
      status.textContent = "Saved ✓"; status.className = "form-status ok";
      const fresh = await apiFetch(`/api/cigars/${cigarId}`);
      renderCigarModal(fresh);
      loadInventory();
    } catch (err) {
      status.textContent = err.message; status.className = "form-status err";
    }
  });

  modalBody.querySelectorAll(".allocation-remove-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Remove this humidor assignment? These cigars will become unassigned again.")) return;
      try {
        await apiFetch(`/api/cigars/${cigarId}/allocations/${btn.dataset.humidorId}`, { method: "DELETE" });
        const fresh = await apiFetch(`/api/cigars/${cigarId}`);
        renderCigarModal(fresh);
        loadInventory();
      } catch (err) {
        alert(err.message);
      }
    });
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

// Native <input list="..."> (datalist) bazı tarayıcılarda, alanda zaten bir
// değer varken odaklanınca öneri listesini açmıyor — bu yüzden Wrapper/Origin
// için elle kurulmuş, tamamen kontrol edilebilir bir açılır liste kullanıyoruz.
function wireCombo(container, category) {
  if (!container) return;
  const input = container.querySelector("input");
  const dropdown = container.querySelector(".combo-options");

  function renderOptions(filter) {
    const f = (filter || "").toLowerCase();
    const matches = glossaryCache
      .filter((g) => g.category === category && g.term.toLowerCase().includes(f));
    if (matches.length === 0) {
      dropdown.hidden = true;
      return;
    }
    dropdown.innerHTML = matches.map((g) => `<div class="combo-option">${esc(g.term)}</div>`).join("");
    dropdown.hidden = false;
  }

  // Odaklanınca MEVCUT değeri yok sayıp tüm seçenekleri gösteriyoruz — asıl şikayet buydu.
  input.addEventListener("focus", () => renderOptions(""));
  input.addEventListener("input", () => renderOptions(input.value));
  input.addEventListener("blur", () => setTimeout(() => { dropdown.hidden = true; }, 150));

  dropdown.addEventListener("mousedown", (e) => {
    const opt = e.target.closest(".combo-option");
    if (!opt) return;
    input.value = opt.textContent;
    dropdown.hidden = true;
  });
}

// Native confirm() yerine tema ile uyumlu bir kart. resolve(true) = "mevcut
// olanı aç", resolve(false) = "yine de yeni ayrı kayıt olarak ekle".
function showDupeConfirm(message) {
  return new Promise((resolve) => {
    const modal = document.getElementById("dupe-modal");
    document.getElementById("dupe-message").textContent =
      message + " Open the existing one to log a purchase there, or add this as a separate new entry.";
    modal.hidden = false;

    const openBtn = document.getElementById("dupe-open-existing");
    const anywayBtn = document.getElementById("dupe-add-anyway");

    function cleanup(result) {
      modal.hidden = true;
      openBtn.removeEventListener("click", onOpen);
      anywayBtn.removeEventListener("click", onAnyway);
      resolve(result);
    }
    function onOpen() { cleanup(true); }
    function onAnyway() { cleanup(false); }

    openBtn.addEventListener("click", onOpen);
    anywayBtn.addEventListener("click", onAnyway);
  });
}

// --- New cigar form ----------------------------------------------------------
const cigarForm = document.getElementById("cigar-form");

// AI çıkarımı brand/line sınırını her seferinde aynı çizmeyebilir (örn. bir
// seferinde brand="Nub" line="Connecticut", başka seferinde brand="Nub"
// line="Nub Connecticut"). Tam eşleşme yerine, birleşik marka+seri metninin
// biri diğerini içeriyor mu diye bakıyoruz — bu iki durumu da yakalıyor.
function normalizeForCompare(s) {
  return (s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function looksLikeDuplicate(newBrand, newLine, existingBrand, existingLine) {
  const a = normalizeForCompare([newBrand, newLine].filter(Boolean).join(" "));
  const b = normalizeForCompare([existingBrand, existingLine].filter(Boolean).join(" "));
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}
wireCombo(document.querySelector('#cigar-form .combo[data-category="wrapper"]'), "wrapper");
wireCombo(document.querySelector('#cigar-form .combo[data-category="origin"]'), "origin");
wireFixedCombo(document.querySelector('#cigar-form .combo:not([data-category])'));

cigarForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = document.getElementById("cigar-form-status");
  const data = Object.fromEntries(new FormData(cigarForm));
  Object.keys(data).forEach((k) => { if (data[k] === "") delete data[k]; });

  const dupe = cigarsCache.find((c) => looksLikeDuplicate(data.brand, data.line, c.brand, c.line));
  if (dupe) {
    const label = [dupe.brand, dupe.line].filter(Boolean).join(" ");
    const goToExisting = await showDupeConfirm(`You already have "${label}" in your inventory.`);
    if (goToExisting) {
      switchView("inventory");
      openCigarModal(dupe.id);
      return;
    }
  }

  try {
    const created = await apiFetch("/api/cigars", { method: "POST", body: JSON.stringify(data) });

    // photo_url verildiyse sunucu zaten indirmeyi denedi. Elle bir dosya da
    // seçilmişse (link çalışmadıysa yedek olarak, ya da baştan tercih
    // edildiyse) onu ayrıca yüklüyoruz — cigars.ts'teki UPDATE tek satır
    // olduğu için bu, indirilen fotoğrafın YERİNE geçer, ikisi birikmez.
    const photoFile = document.getElementById("cigar-photo-file").files[0];
    let photoWarning = "";
    if (photoFile) {
      try {
        await apiFetch(`/api/cigars/${created.id}/photo`, {
          method: "PUT",
          body: photoFile,
          headers: { "Content-Type": photoFile.type || "application/octet-stream" },
        });
      } catch (photoErr) {
        photoWarning = ` (photo upload failed: ${photoErr.message})`;
      }
    }

    status.textContent = `Cigar saved ✓${photoWarning}`;
    status.className = photoWarning ? "form-status err" : "form-status ok";
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
const CIGAR_FIELDS = ["brand", "line", "vitola", "length_mm", "ring_gauge", "wrapper", "origin", "strength", "flavor_profile"];

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
let editingHumidorId = null;
let humidorsCache = [];

async function loadHumidors() {
  const grid = document.getElementById("humidor-grid");
  const empty = document.getElementById("humidor-empty");
  grid.innerHTML = `<p class="loading">Loading…</p>`;

  humidorsCache = await apiFetch("/api/humidors");
  renderDashboardSensors(humidorsCache);
  grid.innerHTML = "";

  if (humidorsCache.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  for (const h of humidorsCache) {
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
      <div class="humidor-card-actions">
        <button type="button" class="link-btn humidor-history-btn" data-id="${h.id}">Details</button>
        <button type="button" class="link-btn humidor-edit-btn" data-id="${h.id}">Edit</button>
        <button type="button" class="link-btn danger humidor-delete-btn" data-id="${h.id}">Delete</button>
      </div>
    `;
    grid.appendChild(card);
  }

  grid.querySelectorAll(".humidor-history-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const h = humidorsCache.find((x) => x.id === Number(btn.dataset.id));
      if (h) openHumidorDetail(h);
    });
  });

  grid.querySelectorAll(".humidor-edit-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const h = humidorsCache.find((x) => x.id === Number(btn.dataset.id));
      if (h) startEditHumidor(h);
    });
  });

  grid.querySelectorAll(".humidor-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this humidor? Its sensor reading history will be deleted too. This cannot be undone.")) return;
      try {
        await apiFetch(`/api/humidors/${btn.dataset.id}`, { method: "DELETE" });
        if (editingHumidorId === Number(btn.dataset.id)) cancelEditHumidor();
        await loadHumidors();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

function startEditHumidor(h) {
  editingHumidorId = h.id;
  document.getElementById("humidor-form-details").open = true;
  humidorForm.querySelector('[name="name"]').value = h.name || "";
  humidorForm.querySelector('[name="location_note"]').value = h.location_note || "";
  humidorForm.querySelector('[name="mac_address"]').value = h.mac_address || "";
  document.getElementById("humidor-submit-btn").textContent = "Update";
  document.getElementById("humidor-cancel-edit").hidden = false;
  document.getElementById("humidor-form-details").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function cancelEditHumidor() {
  editingHumidorId = null;
  humidorForm.reset();
  document.getElementById("humidor-submit-btn").textContent = "Add";
  document.getElementById("humidor-cancel-edit").hidden = true;
}

// --- Sensor history chart -----------------------------------------------
let humidorChartInstance = null;

function humidorCigarLineHtml(hc) {
  const title = [hc.brand, hc.line].filter(Boolean).join(" ");
  return `
    <button type="button" class="humidor-cigar-line" data-cigar-id="${hc.id}">
      <span class="humidor-cigar-line-title">${esc(title)}${hc.vitola ? `<span class="humidor-cigar-line-sub"> · ${esc(hc.vitola)}</span>` : ""}</span>
      <span class="humidor-cigar-line-qty">${hc.quantity_here}</span>
    </button>`;
}

async function openHumidorDetail(h) {
  modal.hidden = false;
  modalBody.innerHTML = `<p class="modal-loading">Loading…</p>`;

  const [cigarsHere, readings] = await Promise.all([
    apiFetch(`/api/humidors/${h.id}/cigars`),
    apiFetch(`/api/humidors/${h.id}/readings?limit=100`),
  ]);

  const cigarsHtml = cigarsHere.length > 0
    ? `<div class="humidor-cigar-list">${cigarsHere.map(humidorCigarLineHtml).join("")}</div>`
    : `<p class="pr-meta">No cigars assigned to this humidor yet — pick it when adding a purchase.</p>`;

  const chartHtml = readings.length > 0
    ? `<p class="chart-modal-sub">Last ${readings.length} readings</p><div class="chart-wrap"><canvas id="humidor-chart-canvas"></canvas></div>`
    : `<p class="pr-meta">No sensor readings yet.</p>`;

  modalBody.innerHTML = `
    <h3 class="chart-modal-title">${esc(h.name)}</h3>
    <div class="md-section">
      <h4>Cigars stored here</h4>
      ${cigarsHtml}
    </div>
    <div class="md-section">
      <h4>Temperature &amp; humidity history</h4>
      ${chartHtml}
    </div>
  `;

  modalBody.querySelectorAll(".humidor-cigar-line").forEach((btn) => {
    btn.addEventListener("click", () => openCigarModal(Number(btn.dataset.cigarId)));
  });

  if (readings.length === 0) return;

  // API en yeniden en eskiye (DESC) dönüyor -- grafikte soldan sağa kronolojik
  // gitmesi için ters çeviriyoruz.
  const chronological = [...readings].reverse();
  const labels = chronological.map((r) =>
    new Date(r.reading_time).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    })
  );
  const temps = chronological.map((r) => Number(r.temperature_c));
  const humidities = chronological.map((r) => Number(r.humidity_pct));

  if (humidorChartInstance) humidorChartInstance.destroy();
  const ctx = document.getElementById("humidor-chart-canvas").getContext("2d");
  humidorChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Temperature (°C)",
          data: temps,
          borderColor: "#7A4A2E",
          backgroundColor: "#7A4A2E",
          yAxisID: "yTemp",
          tension: 0.3,
          pointRadius: 2,
          borderWidth: 2,
        },
        {
          label: "Humidity (%)",
          data: humidities,
          borderColor: "#4A5D3A",
          backgroundColor: "#4A5D3A",
          yAxisID: "yHum",
          tension: 0.3,
          pointRadius: 2,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          ticks: { color: "#6B5D4F", maxRotation: 0, autoSkipPadding: 16 },
          grid: { color: "#E1D5BE" },
        },
        yTemp: {
          type: "linear",
          position: "left",
          title: { display: true, text: "°C", color: "#7A4A2E" },
          ticks: { color: "#7A4A2E" },
          grid: { color: "#E1D5BE" },
        },
        yHum: {
          type: "linear",
          position: "right",
          title: { display: true, text: "%", color: "#4A5D3A" },
          ticks: { color: "#4A5D3A" },
          grid: { drawOnChartArea: false },
        },
      },
      plugins: {
        legend: { labels: { color: "#2B211A" } },
      },
    },
  });
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
    if (editingHumidorId) {
      await apiFetch(`/api/humidors/${editingHumidorId}`, { method: "PUT", body: JSON.stringify(data) });
      status.textContent = "Updated ✓";
    } else {
      await apiFetch("/api/humidors", { method: "POST", body: JSON.stringify(data) });
      status.textContent = "Added ✓";
    }
    status.className = "form-status ok";
    cancelEditHumidor();
    await loadHumidors();
  } catch (err) {
    status.textContent = err.message; status.className = "form-status err";
  }
});

document.getElementById("humidor-cancel-edit").addEventListener("click", cancelEditHumidor);

// --- Back to top -------------------------------------------------------
const backToTopBtn = document.getElementById("back-to-top");
function updateBackToTopVisibility() {
  backToTopBtn.classList.toggle("visible", window.scrollY > 400);
}
window.addEventListener("scroll", updateBackToTopVisibility, { passive: true });
backToTopBtn.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// --- Startup -----------------------------------------------------------
function initApp() {
  switchView("inventory");
  loadStats().catch((e) => console.error(e));
  loadInventory().catch((e) => console.error(e));
  loadGlossary().catch((e) => console.error(e));
  loadHumidors().catch((e) => console.error(e));
  updateBackToTopVisibility(); // sayfa zaten scroll edilmiş halde açılırsa (geri tuşu vb.)
}

initApp();
