import express, { Router } from "express";
import pool from "../db";
import { asyncHandler } from "../asyncHandler";
import { downloadPhoto } from "../photoStorage";
import { ANTHROPIC_VERSION, MODEL, PAIRING_INSTRUCTIONS, PAIRING_JSON_FIELDS, extractJson } from "./extract";

const router = Router();

// photo_data potansiyel olarak megabaytlarca binary veri -- JSON yanıtlarında
// hiç yer almamalı. Onun yerine frontend /photos/cigars/:id'den <img> ile
// çekiyor; burada sadece "var mı yok mu" bilgisini (has_photo) taşıyoruz.
function stripPhotoData<T extends Record<string, unknown>>(row: T): Omit<T, "photo_data" | "photo_mime"> & { has_photo: boolean } {
  const { photo_data, photo_mime, ...rest } = row as Record<string, unknown>;
  return { ...rest, has_photo: photo_data !== null && photo_data !== undefined } as Omit<T, "photo_data" | "photo_mime"> & { has_photo: boolean };
}

// GET /api/cigars — künye listesi + kalan adet + puan (liste görünümü için)
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(`
      SELECT c.id, c.brand, c.line, c.vitola, c.length_mm, c.ring_gauge, c.filler, c.binder,
             c.wrapper, c.origin, c.strength, c.flavor_profile, c.photo_url, c.notes,
             c.created_at, c.updated_at, c.draw_score, c.burn_score, c.construction_score,
             c.finish_score, c.overall_score, c.strength_experienced, c.scoring_notes, c.duration_minutes,
             c.pairing_whiskey, c.pairing_brandy, c.pairing_coffee, c.pairing_drink,
             c.is_favorite,
             (c.photo_data IS NOT NULL) AS has_photo,
             s.total_bought, s.total_smoked, s.quantity_remaining
      FROM cigars c
      JOIN cigars_with_stock s ON s.id = c.id
      ORDER BY c.is_favorite DESC, c.brand, c.line NULLS LAST, c.vitola
    `);
    res.json(result.rows);
  })
);

// GET /api/cigars/:id — künye detayı + alım geçmişi + tadım geçmişi
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Önceki sürüm 2 ayrı round-trip yapıyordu (cigar+stock, sonra paralel
    // purchases+tastings). Railway'e her round-trip gerçek network gecikmesi
    // ekliyor — json_agg ile üçünü TEK sorguda, tek round-trip'te çekiyoruz.
    const result = await pool.query(
      `SELECT c.id, c.brand, c.line, c.vitola, c.length_mm, c.ring_gauge, c.filler, c.binder,
              c.wrapper, c.origin, c.strength, c.flavor_profile, c.photo_url, c.notes,
              c.created_at, c.updated_at, c.draw_score, c.burn_score, c.construction_score,
              c.finish_score, c.overall_score, c.strength_experienced, c.scoring_notes, c.duration_minutes,
              c.pairing_whiskey, c.pairing_brandy, c.pairing_coffee, c.pairing_drink,
              c.is_favorite,
              (c.photo_data IS NOT NULL) AS has_photo,
              s.total_bought, s.total_smoked, s.quantity_remaining,
        COALESCE(
          (SELECT json_agg(p.* ORDER BY p.purchase_date DESC NULLS LAST, p.id DESC)
           FROM purchases p WHERE p.cigar_id = c.id),
          '[]'
        ) AS purchases,
        COALESCE(
          (SELECT json_agg(t.* ORDER BY t.tasting_date DESC, t.id DESC)
           FROM tastings t WHERE t.cigar_id = c.id),
          '[]'
        ) AS tastings,
        COALESCE(
          (SELECT json_agg(json_build_object('humidor_id', a.humidor_id, 'humidor_name', h.name, 'quantity', a.quantity) ORDER BY h.name)
           FROM cigar_humidor_allocations a JOIN humidors h ON h.id = a.humidor_id
           WHERE a.cigar_id = c.id),
          '[]'
        ) AS humidor_allocations
       FROM cigars c
       JOIN cigars_with_stock s ON s.id = c.id
       WHERE c.id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Puro bulunamadı" });
    }

    res.json(result.rows[0]);
  })
);

// POST /api/cigars — yeni künye oluştur
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const {
      brand,
      line,
      vitola,
      length_mm,
      ring_gauge,
      filler,
      binder,
      wrapper,
      origin,
      strength,
      flavor_profile,
      photo_url,
      notes,
      pairing_whiskey,
      pairing_brandy,
      pairing_coffee,
      pairing_drink,
    } = req.body;

    if (!brand || typeof brand !== "string") {
      return res.status(400).json({ error: "brand alanı zorunlu" });
    }

    // photo_url verildiyse, dış linke bağımlı kalmamak için görseli hemen
    // indirip kendi tarafımızda saklıyoruz. İndirme başarısız olursa (link
    // ölü, resim değil, çok büyük) sessizce fotoğrafsız devam ediyoruz --
    // bu künye kaydını başarısız kılacak bir sebep değil.
    const downloaded = photo_url ? await downloadPhoto(photo_url) : null;

    const result = await pool.query(
      `INSERT INTO cigars
        (brand, line, vitola, length_mm, ring_gauge, filler, binder, wrapper, origin, strength, flavor_profile, photo_url, notes, photo_data, photo_mime, pairing_whiskey, pairing_brandy, pairing_coffee, pairing_drink)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [
        brand,
        line ?? null,
        vitola ?? null,
        length_mm ?? null,
        ring_gauge ?? null,
        filler ?? null,
        binder ?? null,
        wrapper ?? null,
        origin ?? null,
        strength ?? null,
        flavor_profile ?? null,
        photo_url ?? null,
        notes ?? null,
        downloaded?.data ?? null,
        downloaded?.mime ?? null,
        pairing_whiskey ?? null,
        pairing_brandy ?? null,
        pairing_coffee ?? null,
        pairing_drink ?? null,
      ]
    );
    res.status(201).json(stripPhotoData(result.rows[0]));
  })
);

// PUT /api/cigars/:id — kısmi güncelleme (sadece gönderilen alanlar değişir)
const EDITABLE_CIGAR_FIELDS = [
  "brand",
  "line",
  "vitola",
  "length_mm",
  "ring_gauge",
  "filler",
  "binder",
  "wrapper",
  "origin",
  "strength",
  "flavor_profile",
  "photo_url",
  "notes",
  "draw_score",
  "burn_score",
  "construction_score",
  "finish_score",
  "overall_score",
  "strength_experienced",
  "scoring_notes",
  "duration_minutes",
  "pairing_whiskey",
  "pairing_brandy",
  "pairing_coffee",
  "pairing_drink",
  "is_favorite",
];

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updates = EDITABLE_CIGAR_FIELDS.filter((field) => field in req.body);

    if (updates.length === 0) {
      return res.status(400).json({ error: "Güncellenecek en az bir alan gönderilmeli" });
    }

    // photo_url değiştiyse (ve boş değilse) görseli yeniden indirip
    // photo_data/photo_mime'ı da aynı güncellemede taşıyoruz.
    let photoUpdate: { data: Buffer | null; mime: string | null } | null = null;
    if ("photo_url" in req.body && req.body.photo_url) {
      const downloaded = await downloadPhoto(req.body.photo_url);
      photoUpdate = { data: downloaded?.data ?? null, mime: downloaded?.mime ?? null };
    }

    const allFields = photoUpdate ? [...updates, "photo_data", "photo_mime"] : updates;
    const setClause = allFields.map((field, i) => `${field} = $${i + 2}`).join(", ");
    const values = allFields.map((field) => {
      if (field === "photo_data") return photoUpdate!.data;
      if (field === "photo_mime") return photoUpdate!.mime;
      return req.body[field];
    });

    const result = await pool.query(
      `UPDATE cigars SET ${setClause}, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, ...values]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Puro bulunamadı" });
    }
    res.json(stripPhotoData(result.rows[0]));
  })
);

// PUT /api/cigars/:id/photo — kullanıcının kendi seçtiği dosyayı yükler.
// photo_url'den otomatik indirme başarısız olduğunda (link ölü, site engelliyor,
// resim değil) manuel bir yedek yol. TEK satırlık UPDATE olduğu için her
// yükleme öncekinin YERİNE geçiyor — URL değiştiğinde olan davranışın aynısı,
// storage'da eski fotoğraflardan artık kalmıyor. photo_url alanına dokunmuyoruz,
// o hâlâ "orijinal kaynak" referansı olarak durabilir.
router.put(
  "/:id/photo",
  express.raw({ type: "image/*", limit: "8mb" }),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "Fotoğraf verisi boş veya Content-Type image/* değil" });
    }

    const mime = (req.get("content-type") || "image/jpeg").split(";")[0].trim();

    const result = await pool.query(
      `UPDATE cigars SET photo_data = $2, photo_mime = $3, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, req.body, mime]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Puro bulunamadı" });
    }
    res.json(stripPhotoData(result.rows[0]));
  })
);

// DELETE /api/cigars/:id — cascade ile purchases ve tastings de silinir
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const result = await pool.query(`DELETE FROM cigars WHERE id = $1 RETURNING id`, [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Puro bulunamadı" });
    }
    res.status(204).send();
  })
);

// GET /api/cigars/:id/purchases
router.get(
  "/:id/purchases",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT * FROM purchases WHERE cigar_id = $1 ORDER BY purchase_date DESC NULLS LAST, id DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  })
);

// POST /api/cigars/:id/purchases — yeni alım kaydı (aynı puronun N'inci alımı olabilir)
router.post(
  "/:id/purchases",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { source, purchase_date, quantity, unit_price, box_code, reference_url } = req.body;

    if (!quantity || Number(quantity) <= 0) {
      return res.status(400).json({ error: "quantity zorunlu ve 0'dan büyük olmalı" });
    }

    const cigarExists = await pool.query(`SELECT id FROM cigars WHERE id = $1`, [id]);
    if (cigarExists.rows.length === 0) {
      return res.status(404).json({ error: "Puro bulunamadı" });
    }

    const result = await pool.query(
      `INSERT INTO purchases (cigar_id, source, purchase_date, quantity, unit_price, box_code, reference_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [id, source ?? null, purchase_date ?? null, quantity, unit_price ?? null, box_code ?? null, reference_url ?? null]
    );
    res.status(201).json(result.rows[0]);
  })
);

// GET /api/cigars/:id/tastings
router.get(
  "/:id/tastings",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT * FROM tastings WHERE cigar_id = $1 ORDER BY tasting_date DESC, id DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  })
);

// POST /api/cigars/:id/tastings — yeni tadım kaydı = envanterden 1 adet düşer.
// Kasıtlı olarak sade: sadece tarih + mekan. Puanlama artık tadım başına değil,
// puronun kendisinde tek bir kayıt (bkz. PUT /api/cigars/:id).
router.post(
  "/:id/tastings",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { tasting_date, location, humidor_id } = req.body;

    const cigarExists = await pool.query(`SELECT id FROM cigars WHERE id = $1`, [id]);
    if (cigarExists.rows.length === 0) {
      return res.status(404).json({ error: "Puro bulunamadı" });
    }

    const result = await pool.query(
      `INSERT INTO tastings (cigar_id, tasting_date, location, humidor_id)
       VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4)
       RETURNING *`,
      [id, tasting_date ?? null, location ?? null, humidor_id ?? null]
    );

    // Belirli bir humidor'dan içildiyse, o humidor'un dağıtımından 1 düşüyoruz.
    // ÖNEMLİ: cigar_humidor_allocations.quantity üzerinde CHECK (quantity > 0)
    // kısıtı var -- doğrudan "SET quantity = quantity - 1" ile 1'den 0'a UPDATE
    // etmeye çalışmak bu kısıtı ihlal edip hata fırlatıyordu (satır hiç 0 değerle
    // var olamıyor, UPDATE sırasında bile). Önce mevcut miktarı okuyup, 1 veya
    // altındaysa satırı direkt siliyoruz, fazlaysa güvenle 1 azaltıyoruz.
    if (humidor_id) {
      const alloc = await pool.query(
        `SELECT quantity FROM cigar_humidor_allocations WHERE cigar_id = $1 AND humidor_id = $2`,
        [id, humidor_id]
      );
      if (alloc.rows.length > 0) {
        if (Number(alloc.rows[0].quantity) <= 1) {
          await pool.query(
            `DELETE FROM cigar_humidor_allocations WHERE cigar_id = $1 AND humidor_id = $2`,
            [id, humidor_id]
          );
        } else {
          await pool.query(
            `UPDATE cigar_humidor_allocations SET quantity = quantity - 1, updated_at = now()
             WHERE cigar_id = $1 AND humidor_id = $2`,
            [id, humidor_id]
          );
        }
      }
    }

    res.status(201).json(result.rows[0]);
  })
);

// PUT /api/cigars/:id/allocations/:humidorId — bu puronun şu humidordaki adedini
// belirle (satır yoksa oluşturur, varsa üzerine yazar). 0 veya daha az gönderilirse
// satırı tamamen siler -- "satır var = adet > 0" değişmezi hep korunur.
router.put(
  "/:id/allocations/:humidorId",
  asyncHandler(async (req, res) => {
    const { id, humidorId } = req.params;
    const quantity = Number(req.body.quantity);

    if (!Number.isFinite(quantity)) {
      return res.status(400).json({ error: "quantity zorunlu ve sayı olmalı" });
    }

    if (quantity <= 0) {
      await pool.query(`DELETE FROM cigar_humidor_allocations WHERE cigar_id = $1 AND humidor_id = $2`, [id, humidorId]);
      return res.json({ cigar_id: Number(id), humidor_id: Number(humidorId), quantity: 0, removed: true });
    }

    // Elde kalan stoktan fazlasını dağıtamazsın. Bu humidor'un ESKİ değeri hariç
    // diğer tüm humidorlardaki toplam + yeni değer, elimizdeki genel kalan adedi
    // (cigars_with_stock) geçmemeli.
    const stockResult = await pool.query(`SELECT quantity_remaining FROM cigars_with_stock WHERE id = $1`, [id]);
    if (stockResult.rows.length === 0) {
      return res.status(404).json({ error: "Puro bulunamadı" });
    }
    const remaining = Number(stockResult.rows[0].quantity_remaining);

    const otherAllocations = await pool.query(
      `SELECT COALESCE(SUM(quantity), 0) AS total FROM cigar_humidor_allocations WHERE cigar_id = $1 AND humidor_id != $2`,
      [id, humidorId]
    );
    const maxAllowed = remaining - Number(otherAllocations.rows[0].total);

    if (quantity > maxAllowed) {
      return res.status(400).json({
        error: maxAllowed > 0
          ? `En fazla ${maxAllowed} adet dağıtılabilir (toplam ${remaining} kalan, diğer humidorlara zaten ${remaining - maxAllowed} atanmış).`
          : `Elindeki tüm ${remaining} adet zaten başka humidorlara atanmış.`,
      });
    }

    const result = await pool.query(
      `INSERT INTO cigar_humidor_allocations (cigar_id, humidor_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (cigar_id, humidor_id) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()
       RETURNING *`,
      [id, humidorId, quantity]
    );
    res.json(result.rows[0]);
  })
);

// DELETE /api/cigars/:id/allocations/:humidorId — bu humidor'daki atamayı tamamen
// kaldırır, adet tekrar "boşta" sayılır.
router.delete(
  "/:id/allocations/:humidorId",
  asyncHandler(async (req, res) => {
    const { id, humidorId } = req.params;
    await pool.query(`DELETE FROM cigar_humidor_allocations WHERE cigar_id = $1 AND humidor_id = $2`, [id, humidorId]);
    res.status(204).send();
  })
);

// POST /api/cigars/:id/pairings/generate — mevcut (zaten kayıtlı) bir puronun
// profiline göre 4 pairing önerisini üretip kaydeder. Web ekstraksiyonundan
// FARKLI OLARAK burada URL/web_fetch yok -- sadece elimizdeki profil bilgisiyle
// (brand/line/wrapper/strength/flavor_profile) Claude'a soruyoruz. Hem yeni
// eklenip pairing'i olmayan purolar hem de geriye dönük backfill için kullanılır.
router.post(
  "/:id/pairings/generate",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "ANTHROPIC_API_KEY tanımlı değil — Railway Variables'a ekle" });
    }

    const cigarResult = await pool.query(
      `SELECT brand, line, vitola, wrapper, origin, strength, flavor_profile FROM cigars WHERE id = $1`,
      [id]
    );
    if (cigarResult.rows.length === 0) {
      return res.status(404).json({ error: "Puro bulunamadı" });
    }
    const c = cigarResult.rows[0];
    const title = [c.brand, c.line].filter(Boolean).join(" ");

    const prompt = `Cigar profile:
- Name: ${title || "(unknown)"}
- Vitola: ${c.vitola || "(unknown)"}
- Wrapper: ${c.wrapper || "(unknown)"}
- Origin: ${c.origin || "(unknown)"}
- Strength: ${c.strength || "(unknown)"}
- Flavor profile: ${c.flavor_profile || "(unknown)"}

${PAIRING_INSTRUCTIONS}

Reply with ONLY a JSON object, nothing else:
{${PAIRING_JSON_FIELDS}}`;

    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error("Anthropic API hatası:", apiRes.status, errText);
      return res.status(502).json({ error: `Claude API isteği başarısız oldu (${apiRes.status})` });
    }

    const data = (await apiRes.json()) as { content?: Array<{ type: string; text?: string }> };
    const fullText = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text || "")
      .join("\n");

    const pairings = extractJson(fullText);
    if (!pairings) {
      return res.status(502).json({ error: "Claude'un yanıtından JSON çıkarılamadı", raw: fullText.slice(0, 400) });
    }

    const result = await pool.query(
      `UPDATE cigars
       SET pairing_whiskey = $2, pairing_brandy = $3, pairing_coffee = $4, pairing_drink = $5, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        pairings.pairing_whiskey ?? null,
        pairings.pairing_brandy ?? null,
        pairings.pairing_coffee ?? null,
        pairings.pairing_drink ?? null,
      ]
    );

    res.json(stripPhotoData(result.rows[0]));
  })
);

export default router;
