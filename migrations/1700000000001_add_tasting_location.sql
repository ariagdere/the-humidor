-- tastings tablosuna "nerede içtim" bilgisini tutan location sütunu ekler.
-- IF NOT EXISTS kullanıyoruz çünkü bu sütun bazı ortamlarda DBeaver üzerinden
-- elle de eklenmiş olabilir -- migration'ın hem CLI'dan hem elle çalıştırılmış
-- bir durumda da güvenle tekrar çalıştırılabilmesi için.
ALTER TABLE tastings ADD COLUMN IF NOT EXISTS location TEXT;
