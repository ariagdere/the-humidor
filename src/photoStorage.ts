// Bir photo_url'i sunucu tarafında indirip Buffer olarak döndürür. Başarısız
// olursa (404, timeout, resim olmayan içerik, çok büyük dosya) null döner --
// çağıran taraf bunu "fotoğrafsız devam et" olarak yorumluyor, hatayı
// künye kaydetme/güncellemenin başarısız olmasına sebep etmiyoruz.
const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8MB

export async function downloadPhoto(url: string): Promise<{ data: Buffer; mime: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) return null;

    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength === 0 || arrayBuffer.byteLength > MAX_PHOTO_BYTES) return null;

    return { data: Buffer.from(arrayBuffer), mime: contentType.split(";")[0].trim() };
  } catch {
    return null;
  }
}
