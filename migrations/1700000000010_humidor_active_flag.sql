-- Bir humidor'u silmek zorunda kalmadan "pasife alma". Pasif humidor:
--   * ana dashboard'daki sensör satırında görünmez,
--   * yeni puro atamasında (cigar kartındaki Humidor seçicisinde) listelenmez,
--   * AMA silinmez: içindeki puro dağıtımları, geçmiş sensör okumaları ve
--     (cihaz hâlâ veri gönderiyorsa) yeni okumalar olduğu gibi saklanır.
-- Mevcut tüm humidorlar aktif başlar (DEFAULT true), yani bu migration
-- uygulandığında arayüzde hiçbir şey değişmez -- kullanıcı switch'i kendisi kapatır.
ALTER TABLE humidors ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
