-- Fotoğrafları artık dışarıdaki bir linke bağımlı göstermiyoruz -- kaydedilirken
-- (veya profil düzenlenirken) sunucu tarafında indirip burada saklıyoruz.
-- photo_url alanı "orijinal kaynak" referansı olarak kalıyor ama GÖRÜNTÜLEME
-- artık /photos/cigars/:id üzerinden, bu sütunlardan yapılıyor -- dış linkin
-- ölmesi artık gösterdiğimiz görseli etkilemiyor.
ALTER TABLE cigars ADD COLUMN IF NOT EXISTS photo_data BYTEA;
ALTER TABLE cigars ADD COLUMN IF NOT EXISTS photo_mime TEXT;
