// ============================================================================
// The Humidor — frontend mantığı. Build adımı yok, doğrudan tarayıcıda çalışır.
// ============================================================================

// Bu satır sunucu tarafında (src/index.ts) Railway'deki gerçek API_KEY ile
// değiştiriliyor — gerçek değer hiçbir zaman bu dosyanın kendisinde,
// dolayısıyla public repoda, düz metin olarak durmuyor.
const API_KEY = "__API_KEY__";
let glossaryCache = [];

// --- API yardımcı fonksiyonu -----------------------------------------------
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
    let msg = `İstek başarısız (${res.status})`;
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

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" });
}

function fmtMoney(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";
}

// --- Sekmeler ----------------------------------------------------------------
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
    { title: "Top rated", items: stats.top_rated, metric: (i) => `${i.avg_score}/100` },
    { title: "En çok içilen", items: stats.most_smoked, metric: (i) => `${i.tasting_count} tadım` },
    { title: "En çok tekrar alınan", items: stats.most_repurchased, metric: (i) => `${i.purchase_count} alım` },
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
        : `<p class="dash-empty">Henüz veri yok</p>`}
    </div>
  `).join("");

  container.querySelectorAll("[data-cigar-id]").forEach((el) =>
    el.addEventListener("click", () => openCigarModal(Number(el.dataset.cigarId)))
  );
}

// --- Envanter ------------------------------------------------------------
async function loadEnvanter() {
  const grid = document.getElementById("envanter-grid");
  const empty = document.getElementById("envanter-empty");
  const count = document.getElementById("envanter-count");
  grid.innerHTML = `<p class="loading">Yükleniyor…</p>`;

  const cigars = await apiFetch("/api/cigars");
  grid.innerHTML = "";

  if (cigars.length === 0) {
    empty.hidden = false;
    count.textContent = "";
    return;
  }
  empty.hidden = true;
  count.textContent = `${cigars.length} künye`;

  for (const c of cigars) {
    const remaining = Number(c.quantity_remaining ?? 0);
    const card = document.createElement("button");
    card.type = "button";
    card.className = "cigar-card";
    card.addEventListener("click", () => openCigarModal(c.id));

    const tags = [c.wrapper, c.origin].filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
    const strengthTag = c.strength
      ? `<span class="tag strength-${esc(c.strength)}">${esc(c.strength)}</span>`
      : "";

    card.innerHTML = `
      <div class="cigar-seal ${remaining === 0 ? "zero" : ""}">
        <span class="n">${remaining}</span>
        <span class="lbl">kalan</span>
      </div>
      <div class="cigar-brand">${esc(c.brand)}</div>
      <div class="cigar-line">${esc([c.line, c.vitola].filter(Boolean).join(" · ")) || "&nbsp;"}</div>
      <div class="cigar-tags">${strengthTag}${tags}</div>
    `;
    grid.appendChild(card);
  }
}

// --- Puro detay modalı -----------------------------------------------------
const modal = document.getElementById("modal");
const modalBody = document.getElementById("modal-body");
document.getElementById("modal-close").addEventListener("click", closeModal);
modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) closeModal(); });

function closeModal() {
  modal.hidden = true;
  modalBody.innerHTML = "";
}

async function openCigarModal(id) {
  modal.hidden = false;
  modalBody.innerHTML = `<p class="modal-loading">Yükleniyor…</p>`;
  const c = await apiFetch(`/api/cigars/${id}`);
  renderCigarModal(c);
}

function renderCigarModal(c) {
  const remaining = Number(c.quantity_remaining ?? 0);

  const facts = [
    ["Filler", c.filler], ["Binder", c.binder], ["Wrapper", c.wrapper], ["Orijin", c.origin],
    ["Uzunluk", c.length_mm ? `${c.length_mm} mm` : null], ["Ring gauge", c.ring_gauge],
  ].filter(([, v]) => v);

  const purchasesHtml = c.purchases.length
    ? c.purchases.map((p) => `
        <div class="purchase-row">
          <div>
            <div class="pr-source">${esc(p.source || "Kaynak belirtilmemiş")}</div>
            <div class="pr-meta">${fmtDate(p.purchase_date)} · ${p.quantity} adet</div>
          </div>
          <div class="pr-price">${fmtMoney(p.unit_price) || ""}</div>
        </div>`).join("")
    : `<p class="pr-meta">Henüz alım kaydı yok.</p>`;

  const tastingsHtml = c.tastings.length
    ? c.tastings.map((t) => `
        <div class="tasting-row">
          <div>
            <div class="pr-source">${fmtDate(t.tasting_date)}${t.overall_score ? ` · ${t.overall_score}/100` : ""}</div>
            ${t.notes ? `<div class="pr-meta">${esc(t.notes)}</div>` : ""}
          </div>
        </div>`).join("")
    : `<p class="pr-meta">Henüz tadım kaydı yok.</p>`;

  modalBody.innerHTML = `
    <h3 class="md-title">${esc(c.brand)}</h3>
    <p class="md-sub">${esc([c.line, c.vitola].filter(Boolean).join(" · ")) || "&nbsp;"}</p>
    <p class="md-stock">${remaining} adet kaldı &nbsp;·&nbsp; ${c.total_bought} alınan, ${c.total_smoked} içilen</p>

    ${facts.length ? `<div class="md-facts">${facts.map(([l, v]) => `<div><span class="md-fact-label">${l}:</span> ${esc(v)}</div>`).join("")}</div>` : ""}
    ${c.flavor_profile ? `<p class="md-fact-label" style="margin-top:8px">Beklenen profil: <span style="color:var(--ink)">${esc(c.flavor_profile)}</span></p>` : ""}

    <div class="md-section">
      <h4>Alımlar</h4>
      ${purchasesHtml}
      <details style="margin-top:12px">
        <summary class="detail-toggle" style="cursor:pointer">+ Alım ekle</summary>
        <form id="purchase-form" class="ledger-form" style="margin-top:12px">
          <div class="field-row">
            <label class="field"><span>Kaynak</span><input name="source" placeholder="sarayasigara.com" /></label>
            <label class="field field-sm"><span>Tarih</span><input name="purchase_date" type="date" /></label>
          </div>
          <div class="field-row">
            <label class="field field-sm"><span>Adet *</span><input name="quantity" type="number" min="1" required /></label>
            <label class="field field-sm"><span>Birim fiyat</span><input name="unit_price" type="number" min="0" step="0.01" /></label>
            <label class="field"><span>Kutu kodu</span><input name="box_code" /></label>
          </div>
          <label class="field"><span>Referans linki</span><input name="reference_url" type="url" placeholder="https://…" /></label>
          <div class="form-actions">
            <button type="submit" class="btn-primary">Kaydet</button>
            <span class="form-status" data-status-for="purchase"></span>
          </div>
        </form>
      </details>
    </div>

    <div class="md-section">
      <h4>Tadımlar</h4>
      ${tastingsHtml}
      <form id="tasting-form" class="ledger-form" style="margin-top:14px">
        <div class="quick-log">
          <input name="tasting_date" type="date" value="${new Date().toISOString().slice(0,10)}" />
          <button type="submit" class="btn-primary">İçtim, kaydet</button>
          <span class="form-status" data-status-for="tasting"></span>
        </div>
        <button type="button" class="detail-toggle" id="tasting-detail-toggle">Detaylı puanla</button>
        <div id="tasting-detail" hidden>
          <div class="score-grid">
            <label class="field"><span>Çekiş (1-5)</span><input name="draw_score" type="number" min="1" max="5" /></label>
            <label class="field"><span>Yanma (1-5)</span><input name="burn_score" type="number" min="1" max="5" /></label>
            <label class="field"><span>Kül (1-5)</span><input name="ash_score" type="number" min="1" max="5" /></label>
            <label class="field"><span>Konstrüksiyon (1-5)</span><input name="construction_score" type="number" min="1" max="5" /></label>
            <label class="field"><span>Bitiş (1-5)</span><input name="finish_score" type="number" min="1" max="5" /></label>
            <label class="field"><span>Genel puan (1-100)</span><input name="overall_score" type="number" min="1" max="100" /></label>
            <label class="field"><span>Hissedilen güç</span>
              <select name="strength_experienced"><option value="">—</option><option value="mild">Mild</option><option value="medium">Medium</option><option value="full">Full</option></select>
            </label>
            <label class="field"><span>Süre (dk)</span><input name="duration_minutes" type="number" min="0" /></label>
          </div>
          <label class="field"><span>Aroma notları</span><textarea name="flavor_notes" rows="2"></textarea></label>
          <label class="field"><span>Eşlik eden içecek</span><input name="pairing" /></label>
          <label class="field"><span>Notlar</span><textarea name="notes" rows="2"></textarea></label>
        </div>
      </form>
    </div>
  `;

  wireModalForms(c.id);
}

function wireModalForms(cigarId) {
  const purchaseForm = document.getElementById("purchase-form");
  purchaseForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = purchaseForm.querySelector('[data-status-for="purchase"]');
    const data = Object.fromEntries(new FormData(purchaseForm));
    Object.keys(data).forEach((k) => { if (data[k] === "") delete data[k]; });
    if (!data.quantity) return;
    try {
      await apiFetch(`/api/cigars/${cigarId}/purchases`, { method: "POST", body: JSON.stringify(data) });
      status.textContent = "Eklendi ✓"; status.className = "form-status ok";
      const fresh = await apiFetch(`/api/cigars/${cigarId}`);
      renderCigarModal(fresh);
      loadEnvanter(); loadStats();
    } catch (err) {
      status.textContent = err.message; status.className = "form-status err";
    }
  });

  const tastingDetailToggle = document.getElementById("tasting-detail-toggle");
  const tastingDetail = document.getElementById("tasting-detail");
  tastingDetailToggle.addEventListener("click", () => {
    tastingDetail.hidden = !tastingDetail.hidden;
    tastingDetailToggle.textContent = tastingDetail.hidden ? "Detaylı puanla" : "Detayı gizle";
  });

  const tastingForm = document.getElementById("tasting-form");
  tastingForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = tastingForm.querySelector('[data-status-for="tasting"]');
    const data = Object.fromEntries(new FormData(tastingForm));
    Object.keys(data).forEach((k) => { if (data[k] === "") delete data[k]; });
    try {
      await apiFetch(`/api/cigars/${cigarId}/tastings`, { method: "POST", body: JSON.stringify(data) });
      status.textContent = "Kaydedildi ✓"; status.className = "form-status ok";
      const fresh = await apiFetch(`/api/cigars/${cigarId}`);
      renderCigarModal(fresh);
      loadEnvanter(); loadStats();
    } catch (err) {
      status.textContent = err.message; status.className = "form-status err";
    }
  });
}

// --- Yeni künye formu --------------------------------------------------------
const cigarForm = document.getElementById("cigar-form");
cigarForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = document.getElementById("cigar-form-status");
  const data = Object.fromEntries(new FormData(cigarForm));
  Object.keys(data).forEach((k) => { if (data[k] === "") delete data[k]; });
  try {
    const created = await apiFetch("/api/cigars", { method: "POST", body: JSON.stringify(data) });
    status.textContent = "Künye kaydedildi ✓";
    status.className = "form-status ok";
    cigarForm.reset();
    await loadEnvanter(); loadStats();
    switchView("envanter");
    openCigarModal(created.id);
  } catch (err) {
    status.textContent = err.message;
    status.className = "form-status err";
  }
});

// --- Glossary ------------------------------------------------------------
const CAT_LABELS = { wrapper: "Wrapper", binder: "Binder", filler: "Filler", origin: "Orijin" };

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
    status.textContent = "Eklendi ✓"; status.className = "form-status ok";
    glossaryForm.reset();
    await loadGlossary();
  } catch (err) {
    status.textContent = err.message; status.className = "form-status err";
  }
});

// --- Sensörler / Humidorlar ------------------------------------------------
async function loadHumidors() {
  const grid = document.getElementById("humidor-grid");
  const empty = document.getElementById("humidor-empty");
  grid.innerHTML = `<p class="loading">Yükleniyor…</p>`;

  const humidors = await apiFetch("/api/humidors");
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
             <div><span class="humidor-reading-num">${Number(h.latest_temperature_c)}°</span><div class="humidor-reading-lbl">sıcaklık</div></div>
             <div><span class="humidor-reading-num">%${Number(h.latest_humidity_pct)}</span><div class="humidor-reading-lbl">nem</div></div>
           </div>`
        : `<p class="humidor-waiting">${h.mac_address ? "Veri bekleniyor…" : "MAC adresi tanımlanmadı, cihaz kurulunca veri akmaya başlayacak"}</p>`}
      ${h.mac_address ? `<div class="humidor-mac">${esc(h.mac_address)}</div>` : ""}
    `;
    grid.appendChild(card);
  }
}

const humidorForm = document.getElementById("humidor-form");
humidorForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = document.getElementById("humidor-form-status");
  const data = Object.fromEntries(new FormData(humidorForm));
  Object.keys(data).forEach((k) => { if (data[k] === "") delete data[k]; });
  try {
    await apiFetch("/api/humidors", { method: "POST", body: JSON.stringify(data) });
    status.textContent = "Eklendi ✓"; status.className = "form-status ok";
    humidorForm.reset();
    await loadHumidors();
  } catch (err) {
    status.textContent = err.message; status.className = "form-status err";
  }
});

// --- Başlangıç -----------------------------------------------------------
function initApp() {
  switchView("envanter");
  loadStats().catch((e) => console.error(e));
  loadEnvanter().catch((e) => console.error(e));
  loadGlossary().catch((e) => console.error(e));
  loadHumidors().catch((e) => console.error(e));
}

initApp();
