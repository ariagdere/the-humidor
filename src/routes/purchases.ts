import { Router } from "express";
import pool from "../db";
import { asyncHandler } from "../asyncHandler";

const router = Router();

const EDITABLE_PURCHASE_FIELDS = ["source", "purchase_date", "quantity", "unit_price", "box_code", "reference_url"];

// PUT /api/purchases/:id — kısmi güncelleme
router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updates = EDITABLE_PURCHASE_FIELDS.filter((field) => field in req.body);

    if (updates.length === 0) {
      return res.status(400).json({ error: "En az bir alan gönderilmeli" });
    }

    const setClause = updates.map((field, i) => `${field} = $${i + 2}`).join(", ");
    const values = updates.map((field) => req.body[field]);

    const result = await pool.query(
      `UPDATE purchases SET ${setClause} WHERE id = $1 RETURNING *`,
      [id, ...values]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Alım bulunamadı" });
    }
    res.json(result.rows[0]);
  })
);

// DELETE /api/purchases/:id
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const result = await pool.query(`DELETE FROM purchases WHERE id = $1 RETURNING id`, [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Alım bulunamadı" });
    }
    res.status(204).send();
  })
);

export default router;
