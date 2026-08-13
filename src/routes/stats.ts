import { Router } from "express";
import pool from "../db";
import { asyncHandler } from "../asyncHandler";

const router = Router();

// GET /api/stats — anasayfa dashboard'u için toplu özet.
// Tek tek küçük sorgular yerine burada birleştiriyoruz ki frontend tek
// istekle tüm sayıları alsın.
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const totals = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM cigars) AS total_cigar_types,
        (SELECT COALESCE(SUM(quantity_remaining), 0) FROM cigars_with_stock) AS total_in_stock,
        (SELECT COUNT(*) FROM tastings) AS total_smoked
    `);

    // Puanlama artık puronun kendisinde tek bir alan (0-5), tadımlardan bağımsız.
    const topRated = await pool.query(`
      SELECT id, brand, line, overall_score
      FROM cigars
      WHERE overall_score IS NOT NULL
      ORDER BY overall_score DESC, brand
      LIMIT 5
    `);

    const mostSmoked = await pool.query(`
      SELECT c.id, c.brand, c.line, COUNT(t.id) AS tasting_count
      FROM cigars c
      JOIN tastings t ON t.cigar_id = c.id
      GROUP BY c.id
      ORDER BY tasting_count DESC
      LIMIT 5
    `);

    // "Tekrar alınan" = birden fazla ayrı purchases satırı olan künye —
    // aynı puroyu farklı zaman/yerden tekrar tekrar almışsın demek.
    const mostRepurchased = await pool.query(`
      SELECT c.id, c.brand, c.line, COUNT(p.id) AS purchase_count
      FROM cigars c
      JOIN purchases p ON p.cigar_id = c.id
      GROUP BY c.id
      HAVING COUNT(p.id) > 1
      ORDER BY purchase_count DESC
      LIMIT 5
    `);

    res.json({
      total_cigar_types: Number(totals.rows[0].total_cigar_types),
      total_in_stock: Number(totals.rows[0].total_in_stock),
      total_smoked: Number(totals.rows[0].total_smoked),
      top_rated: topRated.rows,
      most_smoked: mostSmoked.rows,
      most_repurchased: mostRepurchased.rows,
    });
  })
);

export default router;
