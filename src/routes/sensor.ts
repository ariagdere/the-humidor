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

    const humidor = await pool.query(
      `SELECT id, temp_offset_c, humidity_offset_pct FROM humidors WHERE UPPER(mac_address) = UPPER($1)`,
      [mac_address]
    );
    if (humidor.rows.length === 0) {
      // Bilinmeyen bir MAC geldiğinde sessizce yutmak yerine açıkça hata dönüyoruz —
      // gateway konfigürasyonundaki bir yazım hatasını hemen fark etmek için.
      return res.status(404).json({
        error: `mac_address '${mac_address}' için tanımlı bir humidor yok. Önce POST /api/humidors ile oluştur.`,
      });
    }

    // Ham değere kalibrasyon ofsetini ekleyip öyle kaydediyoruz -- bu humidor'un
    // sensörü diğerlerine göre sistematik olarak yüksek/düşük okuyorsa, ofset
    // Edit Humidor formundan ayarlanabilir (bkz. migration notu).
    const h = humidor.rows[0];
    const adjustedTemp = Number(temperature_c) + Number(h.temp_offset_c);
    const adjustedHumidity = Number(humidity_pct) + Number(h.humidity_offset_pct);

    const result = await pool.query(
      `INSERT INTO sensor_readings (humidor_id, temperature_c, humidity_pct, battery_pct)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [h.id, adjustedTemp, adjustedHumidity, battery_pct ?? null]
    );

    res.status(201).json(result.rows[0]);
  })
);

// POST /api/sensor/batch — tek bir HTTPS isteğinde birden fazla sensör okuması.
// ESP32'de her HTTPS isteği (~38KB heap, sertifika doğrulama dahil) gerçek bir
// bellek maliyeti; 4 sensörü ayrı ayrı POST etmek zamanla bellek parçalanmasına
// ve mbedTLS/ECDSA doğrulama sırasında çökmelere sebep oluyordu. Bunun yerine
// gateway hepsini TEK istekte, s1_*/s2_*/s3_*/s4_* önekli düz alanlarla gönderiyor
// -- o an taze verisi olmayan sensörler için ilgili alanlar hiç gönderilmiyor.
router.post(
  "/batch",
  asyncHandler(async (req, res) => {
    const results: Array<{ mac: string; id?: number; error?: string }> = [];

    for (let i = 1; i <= 4; i++) {
      const mac = req.body[`s${i}_mac`];
      const temp = req.body[`s${i}_temp`];
      const hum = req.body[`s${i}_hum`];
      const bat = req.body[`s${i}_bat`];

      if (!mac || temp === undefined || hum === undefined) continue; // bu turda bu sensörden veri yok

      const humidor = await pool.query(
        `SELECT id, temp_offset_c, humidity_offset_pct FROM humidors WHERE UPPER(mac_address) = UPPER($1)`,
        [mac]
      );
      if (humidor.rows.length === 0) {
        results.push({ mac, error: "tanımlı humidor yok" });
        continue;
      }

      const h = humidor.rows[0];
      const adjustedTemp = Number(temp) + Number(h.temp_offset_c);
      const adjustedHumidity = Number(hum) + Number(h.humidity_offset_pct);

      const result = await pool.query(
        `INSERT INTO sensor_readings (humidor_id, temperature_c, humidity_pct, battery_pct)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [h.id, adjustedTemp, adjustedHumidity, bat ?? null]
      );
      results.push({ mac, id: result.rows[0].id });
    }

    res.status(201).json({ inserted: results.filter((r) => r.id).length, results });
  })
);

export default router;
