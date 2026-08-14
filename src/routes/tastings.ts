import { Router } from "express";
import pool from "../db";
import { asyncHandler } from "../asyncHandler";

const router = Router();

const EDITABLE_TASTING_FIELDS = ["tasting_date", "location", "humidor_id"];

// PUT /api/tastings/:id — kısmi güncelleme (sadece gönderilen alanlar değişir)
router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updates = EDITABLE_TASTING_FIELDS.filter((field) => field in req.body);

    if (updates.length === 0) {
      return res.status(400).json({ error: "En az bir alan gönderilmeli" });
    }

    const setClause = updates.map((field, i) => `${field} = $${i + 2}`).join(", ");
    const values = updates.map((field) => req.body[field]);

    const result = await pool.query(
      `UPDATE tastings SET ${setClause} WHERE id = $1 RETURNING *`,
      [id, ...values]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Tadım bulunamadı" });
    }
    res.json(result.rows[0]);
  })
);

// DELETE /api/tastings/:id — silindiğinde, eğer belirli bir humidordan
// içildiği işaretliyse o humidor'un dağıtımına 1 geri ekliyoruz (tersine çevirme).
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await pool.query(`SELECT cigar_id, humidor_id FROM tastings WHERE id = $1`, [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Tadım bulunamadı" });
    }

    const result = await pool.query(`DELETE FROM tastings WHERE id = $1 RETURNING id`, [req.params.id]);

    const { cigar_id, humidor_id } = existing.rows[0];
    if (humidor_id) {
      await pool.query(
        `INSERT INTO cigar_humidor_allocations (cigar_id, humidor_id, quantity)
         VALUES ($1, $2, 1)
         ON CONFLICT (cigar_id, humidor_id) DO UPDATE SET quantity = cigar_humidor_allocations.quantity + 1, updated_at = now()`,
        [cigar_id, humidor_id]
      );
    }

    res.status(204).send();
  })
);

export default router;
