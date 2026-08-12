import { Request, Response, NextFunction } from "express";

// Tek kullanıcılı hobi projesi için basit paylaşılan anahtar kontrolü.
// Frontend ve ESPHome gateway aynı anahtarı x-api-key başlığında gönderir.
export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  if (!process.env.API_KEY) {
    // Geliştirme kolaylığı: anahtar tanımlı değilse engelleme, ama açıkça uyar.
    console.warn("UYARI: API_KEY tanımlı değil — istekler kimlik kontrolünden geçirilmiyor.");
    return next();
  }

  const provided = req.header("x-api-key");
  if (provided !== process.env.API_KEY) {
    return res.status(401).json({ error: "Geçersiz veya eksik x-api-key başlığı" });
  }

  next();
}
