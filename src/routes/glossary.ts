import { Router } from "express";
import pool from "../db";
import { asyncHandler } from "../asyncHandler";

const router = Router();

const VALID_CATEGORIES = ["wrapper", "binder", "filler", "origin"];

// GET /api/glossary?category=wrapper — kategoriye göre filtrelenebilir
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { category } = req.query;

    if (category && !VALID_CATEGORIES.includes(String(category))) {
      return res.status(400).json({ error: `category şunlardan biri olmalı: ${VALID_CATEGORIES.join(", ")}` });
    }

    const result = category
      ? await pool.query(`SELECT * FROM glossary_entries WHERE category = $1 ORDER BY term`, [category])
      : await pool.query(`SELECT * FROM glossary_entries ORDER BY category, term`);

    res.json(result.rows);
  })
);

// POST /api/glossary — yeni terim ekle (aynı term+category varsa günceller)
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { term, category, description } = req.body;

    if (!term || !category || !description) {
      return res.status(400).json({ error: "term, category ve description zorunlu" });
    }
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `category şunlardan biri olmalı: ${VALID_CATEGORIES.join(", ")}` });
    }

    const result = await pool.query(
      `INSERT INTO glossary_entries (term, category, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (term, category) DO UPDATE SET description = EXCLUDED.description
       RETURNING *`,
      [term, category, description]
    );
    res.status(201).json(result.rows[0]);
  })
);

export default router;
