import { Router } from "express";
import pool from "../db";
import { asyncHandler } from "../asyncHandler";

const router = Router();

// GET /api/humidors — her humidor için son okumayı da ekleyerek listele
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(`
      SELECT h.*,
             latest.temperature_c AS latest_temperature_c,
             latest.humidity_pct AS latest_humidity_pct,
             latest.reading_time AS latest_reading_time
      FROM humidors h
      LEFT JOIN LATERAL (
        SELECT temperature_c, humidity_pct, reading_time
        FROM sensor_readings sr
        WHERE sr.humidor_id = h.id
        ORDER BY sr.reading_time DESC
        LIMIT 1
      ) latest ON true
      ORDER BY h.name
    `);
    res.json(result.rows);
  })
);

// POST /api/humidors — yeni humidor tanımla (cihaz henüz kurulmamışsa mac_address boş bırakılabilir)
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { name, mac_address, location_note } = req.body;
    if (!name) {
      return res.status(400).json({ error: "name alanı zorunlu" });
    }

    const result = await pool.query(
      `INSERT INTO humidors (name, mac_address, location_note) VALUES ($1, $2, $3) RETURNING *`,
      [name, mac_address ?? null, location_note ?? null]
    );
    res.status(201).json(result.rows[0]);
  })
);

// PUT /api/humidors/:id — örn. cihaz kurulunca mac_address eklemek için
router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const { name, mac_address, location_note } = req.body;
    const result = await pool.query(
      `UPDATE humidors
       SET name = COALESCE($2, name),
           mac_address = COALESCE($3, mac_address),
           location_note = COALESCE($4, location_note)
       WHERE id = $1
       RETURNING *`,
      [req.params.id, name ?? null, mac_address ?? null, location_note ?? null]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Humidor bulunamadı" });
    }
    res.json(result.rows[0]);
  })
);

// GET /api/humidors/:id/readings?limit=100 — geçmiş grafiği için
router.get(
  "/:id/readings",
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 1000);
    const result = await pool.query(
      `SELECT reading_time, temperature_c, humidity_pct, battery_pct
       FROM sensor_readings
       WHERE humidor_id = $1
       ORDER BY reading_time DESC
       LIMIT $2`,
      [req.params.id, limit]
    );
    res.json(result.rows);
  })
);

export default router;
