-- Puanlama artık tadım başına değil, puro (cigar) başına TEK bir kayıt --
-- "puanlama tek olmalı, tastinglerle ilişkilendirilmemeli" isteği üzerine.
-- tastings tablosundaki eski puanlama sütunları (draw_score vs.) kasıtlı
-- olarak siliniyor değil, sadece artık kullanılmıyor.
ALTER TABLE cigars ADD COLUMN IF NOT EXISTS draw_score SMALLINT CHECK (draw_score BETWEEN 1 AND 5);
ALTER TABLE cigars ADD COLUMN IF NOT EXISTS burn_score SMALLINT CHECK (burn_score BETWEEN 1 AND 5);
ALTER TABLE cigars ADD COLUMN IF NOT EXISTS construction_score SMALLINT CHECK (construction_score BETWEEN 1 AND 5);
ALTER TABLE cigars ADD COLUMN IF NOT EXISTS finish_score SMALLINT CHECK (finish_score BETWEEN 1 AND 5);
ALTER TABLE cigars ADD COLUMN IF NOT EXISTS overall_score SMALLINT CHECK (overall_score BETWEEN 1 AND 5);
ALTER TABLE cigars ADD COLUMN IF NOT EXISTS strength_experienced TEXT;
ALTER TABLE cigars ADD COLUMN IF NOT EXISTS scoring_notes TEXT;

-- Sertlik seviyesi artık 5 kademeli: mild, mild-medium, medium, medium-full, full.
-- Hem "beklenen" strength hem "deneyimlenen" strength_experienced için geçerli.
ALTER TABLE cigars DROP CONSTRAINT IF EXISTS cigars_strength_check;
ALTER TABLE cigars ADD CONSTRAINT cigars_strength_check
  CHECK (strength IN ('mild','mild-medium','medium','medium-full','full') OR strength IS NULL);

ALTER TABLE cigars DROP CONSTRAINT IF EXISTS cigars_strength_experienced_check;
ALTER TABLE cigars ADD CONSTRAINT cigars_strength_experienced_check
  CHECK (strength_experienced IN ('mild','mild-medium','medium','medium-full','full') OR strength_experienced IS NULL);
