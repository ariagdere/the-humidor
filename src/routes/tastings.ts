import { Router } from "express";
import pool from "../db";
import { asyncHandler } from "../asyncHandler";

const router = Router();

const EDITABLE_TASTING_FIELDS = [
  "tasting_date",
  "location",
  "draw_score",
  "burn_score",
  "ash_score",
  "construction_score",
  "strength_experienced",
  "flavor_notes",
  "finish_score",
  "overall_score",
  "duration_minutes",
  "pairing",
  "notes",
];

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

// DELETE /api/tastings/:id
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const result = await pool.query(`DELETE FROM tastings WHERE id = $1 RETURNING id`, [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Tadım bulunamadı" });
    }
    res.status(204).send();
  })
);

export default router;
