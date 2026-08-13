import { Router } from "express";
import pool from "./db";
import { asyncHandler } from "./asyncHandler";

const router = Router();

// GET /photos/cigars/:id — kimlik doğrulaması YOK, kasıtlı olarak. <img src="...">
// tarayıcıdan özel header (x-api-key) gönderemez, o yüzden bu rota /api/*
// grubunun dışında ve requireApiKey middleware'inden önce mount ediliyor.
// Risk düşük: en kötü ihtimalle biri bir puronun fotoğrafını görür.
router.get(
  "/cigars/:id",
  asyncHandler(async (req, res) => {
    const result = await pool.query(`SELECT photo_data, photo_mime FROM cigars WHERE id = $1`, [req.params.id]);
    if (result.rows.length === 0 || !result.rows[0].photo_data) {
      return res.status(404).send();
    }
    const { photo_data, photo_mime } = result.rows[0];
    res.set("Content-Type", photo_mime || "image/jpeg");
    res.set("Cache-Control", "public, max-age=604800"); // değişmeyecek, 1 hafta cache
    res.send(photo_data);
  })
);

export default router;
