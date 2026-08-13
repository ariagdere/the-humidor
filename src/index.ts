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
import tastingsRouter from "./routes/tastings";

const app = express();

app.use(cors());
app.use(express.json());

// index.html'i statik sunmuyoruz — içindeki "__API_KEY__" yer tutucusunu burada,
// sunucu tarafında, Railway'deki gerçek API_KEY değişkeniyle değiştiriyoruz.
// Böylece anahtarın gerçek değeri hiçbir zaman public repoya girmiyor, sadece
// Railway'in Variables sekmesinde duruyor. app.js kendisi ise tamamen statik
// kalıyor (aşağıdaki express.static) — index.html ona yüklenmeden önce
// window.__HUMIDOR_API_KEY__'i enjekte ediyor.
app.get("/", (_req, res) => {
  const filePath = path.join(__dirname, "..", "public", "index.html");
  const template = fs.readFileSync(filePath, "utf8");
  const content = template.replace('"__API_KEY__"', JSON.stringify(process.env.API_KEY || ""));
  res.type("text/html").send(content);
});

// Diğer arayüz dosyaları (app.js, styles.css, favicon.svg) — auth'tan önce,
// çünkü tarayıcı bunları indirdikten sonra index.html zaten anahtarı taşıyor.
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
app.use("/api/tastings", tastingsRouter);

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
