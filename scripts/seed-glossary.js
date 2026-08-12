// Glossary seed'ini psql'e ihtiyaç duymadan, doğrudan `pg` paketiyle çalıştırır.
// macOS'ta psql varsayılan olarak kurulu gelmediği için bu script tercih edilir --
// tek bağımlılık zaten package.json'da olan `pg`.
//
// Kullanım: DATABASE_URL ortam değişkeni set edilmiş olmalı.
//   node scripts/seed-glossary.js

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL set edilmemiş. Önce export DATABASE_URL=... çalıştır.");
    process.exit(1);
  }

  const sqlPath = path.join(__dirname, "..", "seeds", "glossary.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const result = await client.query(sql);
    // Çoklu statement'larda pg son sonucu döndürür; INSERT satırı için rowCount kullanılabilir.
    const inserted = Array.isArray(result) ? result[result.length - 1]?.rowCount : result.rowCount;
    console.log(`Glossary seed tamamlandı (${inserted ?? "?"} satır etkilendi, ON CONFLICT DO NOTHING nedeniyle tekrar çalıştırmalarda 0 olabilir).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Seed başarısız:", err.message);
  process.exit(1);
});
