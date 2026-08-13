import { Router } from "express";
import pool from "../db";
import { asyncHandler } from "../asyncHandler";
import { downloadPhoto } from "../photoStorage";

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
             c.finish_score, c.overall_score, c.strength_experienced, c.scoring_notes,
             (c.photo_data IS NOT NULL) AS has_photo,
             s.total_bought, s.total_smoked, s.quantity_remaining
      FROM cigars c
      JOIN cigars_with_stock s ON s.id = c.id
      ORDER BY c.brand, c.line NULLS LAST, c.vitola
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
              c.finish_score, c.overall_score, c.strength_experienced, c.scoring_notes,
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
        ) AS tastings
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
        (brand, line, vitola, length_mm, ring_gauge, filler, binder, wrapper, origin, strength, flavor_profile, photo_url, notes, photo_data, photo_mime)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
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
    const { tasting_date, location } = req.body;

    const cigarExists = await pool.query(`SELECT id FROM cigars WHERE id = $1`, [id]);
    if (cigarExists.rows.length === 0) {
      return res.status(404).json({ error: "Puro bulunamadı" });
    }

    const result = await pool.query(
      `INSERT INTO tastings (cigar_id, tasting_date, location)
       VALUES ($1, COALESCE($2, CURRENT_DATE), $3)
       RETURNING *`,
      [id, tasting_date ?? null, location ?? null]
    );
    res.status(201).json(result.rows[0]);
  })
);

export default router;
