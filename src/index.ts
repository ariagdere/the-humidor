import "dotenv/config";
import express from "express";
import cors from "cors";
import { requireApiKey } from "./middleware/auth";
import cigarsRouter from "./routes/cigars";
import glossaryRouter from "./routes/glossary";
import humidorsRouter from "./routes/humidors";
import sensorRouter from "./routes/sensor";

const app = express();

app.use(cors());
app.use(express.json());

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
