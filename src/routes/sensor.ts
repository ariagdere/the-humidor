import { Router } from "express";
import pool from "../db";
import { asyncHandler } from "../asyncHandler";

const router = Router();

// POST /api/sensor — ESP32/ESPHome gateway'in periyodik olarak çağıracağı uç nokta.
// Gateway hangi humidor'a ait olduğunu MAC adresiyle bildirir, biz humidor_id'ye çeviririz.
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { mac_address, temperature_c, humidity_pct, battery_pct } = req.body;

    if (!mac_address || temperature_c === undefined || humidity_pct === undefined) {
      return res.status(400).json({ error: "mac_address, temperature_c ve humidity_pct zorunlu" });
    }

    const humidor = await pool.query(`SELECT id FROM humidors WHERE UPPER(mac_address) = UPPER($1)`, [mac_address]);
    if (humidor.rows.length === 0) {
      // Bilinmeyen bir MAC geldiğinde sessizce yutmak yerine açıkça hata dönüyoruz —
      // gateway konfigürasyonundaki bir yazım hatasını hemen fark etmek için.
      return res.status(404).json({
        error: `mac_address '${mac_address}' için tanımlı bir humidor yok. Önce POST /api/humidors ile oluştur.`,
      });
    }

    const result = await pool.query(
      `INSERT INTO sensor_readings (humidor_id, temperature_c, humidity_pct, battery_pct)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [humidor.rows[0].id, temperature_c, humidity_pct, battery_pct ?? null]
    );

    res.status(201).json(result.rows[0]);
  })
);

export default router;
