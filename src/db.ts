import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("error", (err) => {
  console.error("Beklenmeyen veritabanı havuzu hatası:", err);
});

export default pool;
