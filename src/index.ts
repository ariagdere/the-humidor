import "dotenv/config";
import path from "path";
import fs from "fs";
import express from "express";
import cors from "cors";
import { requireApiKey } from "./middleware/auth";
import cigarsRouter from "./routes/cigars";
import glossaryRouter from "./routes/glossary";
import humidorsRouter from "./routes/humidors";
import sensorRouter from "./routes/sensor";
import statsRouter from "./routes/stats";
import extractRouter from "./routes/extract";

const app = express();

app.use(cors());
app.use(express.json());

// app.js'i statik sunmuyoruz — içindeki "__API_KEY__" yer tutucusunu burada,
// sunucu tarafında, Railway'deki gerçek API_KEY değişkeniyle değiştiriyoruz.
// Böylece anahtarın gerçek değeri hiçbir zaman public repoya girmiyor, sadece
// Railway'in Variables sekmesinde duruyor; tarayıcıya sadece işlenmiş sonuç gider.
app.get("/app.js", (_req, res) => {
  const filePath = path.join(__dirname, "..", "public", "app.js");
  const template = fs.readFileSync(filePath, "utf8");
  const content = template.replace('"__API_KEY__"', JSON.stringify(process.env.API_KEY || ""));
  res.type("application/javascript").send(content);
});

// Diğer arayüz dosyaları (index.html, styles.css, icon.svg) — auth'tan önce,
// çünkü tarayıcı bunları indirdikten sonra app.js zaten anahtarı otomatik taşıyor.
app.use(express.static(path.join(__dirname, "..", "public")));

// Basit sağlık kontrolü — Railway'in deploy sonrası kontrolü ve senin
// tarayıcından hızlı "ayakta mı" testi için, kimlik doğrulama gerektirmez.
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use(requireApiKey);

app.use("/api/cigars", cigarsRouter);
app.use("/api/glossary", glossaryRouter);
app.use("/api/humidors", humidorsRouter);
app.use("/api/sensor", sensorRouter);
app.use("/api/stats", statsRouter);
app.use("/api/extract", extractRouter);

// Genel hata yakalayıcı — asyncHandler'dan next(err) ile buraya düşer.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  const message = err instanceof Error ? err.message : "Bilinmeyen hata";
  res.status(500).json({ error: message });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Puro envanteri API ${port} portunda çalışıyor`);
});
