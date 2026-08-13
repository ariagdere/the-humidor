import { Router } from "express";
import pool from "../db";
import { asyncHandler } from "../asyncHandler";

const router = Router();

const ANTHROPIC_VERSION = "2023-06-01";
const WEB_FETCH_BETA = "web-fetch-2025-09-10";
const MODEL = "claude-sonnet-5";

// Claude bazen "medium-full", "medium to full" gibi birleşik değerler döndürüyor;
// bizim strength sütunumuz sadece mild/medium/full kabul ediyor (bkz. migration).
// Uymayan bir değeri veritabanı hatasıyla kullanıcıya yansıtmak yerine burada
// makul bir varsayıma indirgiyoruz — kullanıcı zaten formu onaylamadan kaydetmiyor.
function normalizeStrength(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const s = raw.toLowerCase();
  if (s.includes("full") && s.includes("medium")) return "medium";
  if (s.includes("full")) return "full";
  if (s.includes("medium")) return "medium";
  if (s.includes("mild") || s.includes("light")) return "mild";
  return null;
}

function extractJson(text: string): Record<string, unknown> | null {
  // Claude çoğu zaman ```json çitleri içinde döndürüyor, bazen düz metin
  // arasında — { ile başlayıp } ile biten en son bloğu yakalıyoruz.
  const cleaned = text.replace(/```json/g, "").replace(/```/g, "");
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

// POST /api/extract — { url } al, Claude'un web_fetch + web_search araçlarıyla
// künye alanlarını çıkarmasını sağla. Sonucu KAYDETMİYORUZ, sadece döndürüyoruz —
// gerçek kayıt kullanıcı formu gözden geçirip normal POST /api/cigars'ı
// çağırdığında oluyor. AI çıkarımı yanlış olabilir, otomatik kaydetmek riskli.
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { url } = req.body;
    if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: "Geçerli bir url (http/https ile başlayan) zorunlu" });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "ANTHROPIC_API_KEY tanımlı değil — Railway Variables'a ekle" });
    }

    // Glossary'deki bilinen terimleri referans olarak veriyoruz ki Claude
    // eşleşen bir terim varsa aynen onu kullansın (tutarlılık için).
    const glossary = await pool.query(`SELECT term, category FROM glossary_entries ORDER BY category, term`);
    const byCategory: Record<string, string[]> = { wrapper: [], binder: [], filler: [], origin: [] };
    for (const row of glossary.rows) {
      (byCategory[row.category] ??= []).push(row.term);
    }

    const prompt = `Şu link bir puro ürün sayfası: ${url}

web_fetch aracıyla bu sayfayı oku ve şu alanları çıkar: brand, line, vitola, length_mm, ring_gauge, filler, binder, wrapper, origin, strength, flavor_profile, photo_url.

Bilinen glossary terimleri (eşleşen varsa aynen bu isimlerle yaz, yoksa sayfada gördüğün gibi yaz):
- wrapper: ${byCategory.wrapper.join(", ") || "(henüz yok)"}
- binder: ${byCategory.binder.join(", ") || "(henüz yok)"}
- filler: ${byCategory.filler.join(", ") || "(henüz yok)"}
- origin: ${byCategory.origin.join(", ") || "(henüz yok)"}

strength alanı için SADECE şu üç değerden birini kullan: mild, medium, full — sayfada "medium to full" gibi birleşik bir ifade görürsen, daha baskın olanına yuvarla.

Sayfada bulamadığın alanlar için (özellikle flavor_profile ve photo_url), bu ürünün marka/seri/vitola bilgisiyle web_search aracını kullanarak tamamla. photo_url için ürünün gerçek fotoğrafına doğrudan giden bir görsel dosyası URL'i bulmaya çalış (sayfa linki değil, doğrudan .jpg/.png gibi bir dosya).

Cevabında uzun bir açıklama yazma — sayfada ne bulduğunu ve web'de neyi aradığını 2-3 cümleyle özetle, sonra doğrudan JSON'a geç.

Cevabının SONUNDA, başka hiçbir şey olmadan, sadece şu alanları içeren bir JSON nesnesi ver (bulamadığın alanlar için null kullan):
{"brand": "...", "line": "...", "vitola": "...", "length_mm": null, "ring_gauge": null, "filler": "...", "binder": "...", "wrapper": "...", "origin": "...", "strength": "...", "flavor_profile": "...", "photo_url": "...", "confidence_notes": "sayfada neyi bulduğun, neyi web'de arayarak tamamladığın hakkında kısa bir not"}`;

    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-beta": WEB_FETCH_BETA,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        tools: [
          { type: "web_search_20250305", name: "web_search", max_uses: 3 },
          { type: "web_fetch_20250910", name: "web_fetch", max_uses: 3 },
        ],
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error("Anthropic API hatası:", apiRes.status, errText);
      return res.status(502).json({ error: `Claude API isteği başarısız oldu (${apiRes.status})` });
    }

    const data = (await apiRes.json()) as { content?: Array<{ type: string; text?: string }> };
    const fullText = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text || "")
      .join("\n");

    const extracted = extractJson(fullText);
    if (!extracted) {
      return res.status(502).json({ error: "Claude'un yanıtından JSON çıkarılamadı", raw: fullText.slice(0, 400) });
    }

    extracted.strength = normalizeStrength(extracted.strength);

    res.json(extracted);
  })
);

export default router;
