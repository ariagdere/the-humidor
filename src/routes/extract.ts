import { Router } from "express";
import pool from "../db";
import { asyncHandler } from "../asyncHandler";

const router = Router();

const ANTHROPIC_VERSION = "2023-06-01";
const WEB_FETCH_BETA = "web-fetch-2025-09-10";
const MODEL = "claude-sonnet-5";

// Claude bazen "medium to full" gibi birleşik değerler döndürüyor; bizim
// strength sütunumuz artık 5 kademeli: mild, mild-medium, medium, medium-full, full.
function normalizeStrength(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const s = raw.toLowerCase();
  const hasMild = s.includes("mild") || s.includes("light");
  const hasMedium = s.includes("medium");
  const hasFull = s.includes("full") || s.includes("strong");
  if (hasMild && hasMedium) return "mild-medium";
  if (hasMedium && hasFull) return "medium-full";
  if (hasFull) return "full";
  if (hasMedium) return "medium";
  if (hasMild) return "mild";
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

    const prompt = `This link is a cigar product page: ${url}

Use the web_fetch tool to read this page and extract: brand, line, vitola, length_mm (whole number, no decimals), ring_gauge, filler, binder, wrapper, origin, strength, flavor_profile, photo_url.

Known glossary terms — if one matches, use that exact term; otherwise write it as it appears on the page:
- wrapper: ${byCategory.wrapper.join(", ") || "(none yet)"}
- binder: ${byCategory.binder.join(", ") || "(none yet)"}
- filler: ${byCategory.filler.join(", ") || "(none yet)"}
- origin: ${byCategory.origin.join(", ") || "(none yet)"}

For strength, use ONLY one of these five values: mild, mild-medium, medium, medium-full, full.

For anything not on the page (especially flavor_profile and photo_url), use the web_search tool with this product's brand/line/vitola to fill the gap. For photo_url, prefer a roughly SQUARE product photo if one is available — we don't crop or resize it on our end, so an already-square image looks best.

Write all content in English regardless of the source page's language — this includes flavor_profile and confidence_notes.

Keep your reasoning brief: summarize what you found on the page and what you searched for in 2-3 sentences, then go straight to the JSON.

At the END of your reply, with nothing else, give only a JSON object with these fields (use null for anything you couldn't find):
{"brand": "...", "line": "...", "vitola": "...", "length_mm": null, "ring_gauge": null, "filler": "...", "binder": "...", "wrapper": "...", "origin": "...", "strength": "...", "flavor_profile": "...", "photo_url": "...", "confidence_notes": "a short note on what came from the page vs. what you filled in via search"}`;

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
    if (typeof extracted.length_mm === "number") {
      extracted.length_mm = Math.round(extracted.length_mm);
    }

    res.json(extracted);
  })
);

export default router;
