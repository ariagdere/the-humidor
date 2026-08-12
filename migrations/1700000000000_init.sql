-- Puro envanteri: ilk şema
-- Bu dosya node-pg-migrate tarafından çalıştırılır (bkz. README).

-- ---------------------------------------------------------------------------
-- glossary_entries: wrapper / binder / filler / origin gibi kategorilerin
-- genel özelliklerini tutan referans tablo. cigars tablosundaki alanlarla
-- katı bir foreign key ile değil, uygulama katmanında (term, category)
-- eşleşmesiyle bağlanır -- böylece cigars.wrapper serbestçe girilebilir,
-- glossary'de karşılığı varsa not olarak gösterilir.
-- ---------------------------------------------------------------------------
CREATE TABLE glossary_entries (
    id          SERIAL PRIMARY KEY,
    term        TEXT NOT NULL,
    category    TEXT NOT NULL CHECK (category IN ('wrapper', 'binder', 'filler', 'origin')),
    description TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (term, category)
);

-- ---------------------------------------------------------------------------
-- cigars: künye / katalog kaydı. Fiziksel bir alım değil, "bu puro nedir"
-- bilgisini tutar. Aynı cigar'ın birden çok purchases satırı olabilir.
-- ---------------------------------------------------------------------------
CREATE TABLE cigars (
    id              SERIAL PRIMARY KEY,
    brand           TEXT NOT NULL,
    line            TEXT,
    vitola          TEXT,
    length_mm       INTEGER,
    ring_gauge      INTEGER,
    filler          TEXT,
    binder          TEXT,
    wrapper         TEXT,
    origin          TEXT,
    strength        TEXT CHECK (strength IN ('mild', 'medium', 'full') OR strength IS NULL),
    flavor_profile  TEXT,
    photo_url       TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cigars_wrapper ON cigars (wrapper);
CREATE INDEX idx_cigars_origin ON cigars (origin);
CREATE INDEX idx_cigars_brand ON cigars (brand);

-- ---------------------------------------------------------------------------
-- purchases: her alım kaydı ayrı bir satır. Aynı cigar'ı farklı zamanlarda
-- farklı yerlerden almış olabilirsin, hepsi burada birikir.
-- ---------------------------------------------------------------------------
CREATE TABLE purchases (
    id             SERIAL PRIMARY KEY,
    cigar_id       INTEGER NOT NULL REFERENCES cigars(id) ON DELETE CASCADE,
    source         TEXT,
    purchase_date  DATE,
    quantity       INTEGER NOT NULL CHECK (quantity > 0),
    unit_price     NUMERIC(10, 2),
    box_code       TEXT,
    reference_url  TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_purchases_cigar_id ON purchases (cigar_id);

-- ---------------------------------------------------------------------------
-- tastings: her tadım = bir puronun tüketilmesi. Envanterden düşme burada
-- gerçekleşir (hangi purchase'dan düştüğü önemli değil, bkz. views aşağıda).
-- Puanlama alanları kasıtlı olarak nullable: "değerlendirecek vaktim yok,
-- sadece içtiğimi not düşeyim" senaryosu için sadece cigar_id + tarih yeterli.
-- ---------------------------------------------------------------------------
CREATE TABLE tastings (
    id                    SERIAL PRIMARY KEY,
    cigar_id              INTEGER NOT NULL REFERENCES cigars(id) ON DELETE CASCADE,
    tasting_date          DATE NOT NULL DEFAULT CURRENT_DATE,
    draw_score            SMALLINT CHECK (draw_score BETWEEN 1 AND 5),
    burn_score            SMALLINT CHECK (burn_score BETWEEN 1 AND 5),
    ash_score              SMALLINT CHECK (ash_score BETWEEN 1 AND 5),
    construction_score    SMALLINT CHECK (construction_score BETWEEN 1 AND 5),
    strength_experienced  TEXT CHECK (strength_experienced IN ('mild', 'medium', 'full') OR strength_experienced IS NULL),
    flavor_notes          TEXT,
    finish_score          SMALLINT CHECK (finish_score BETWEEN 1 AND 5),
    overall_score         SMALLINT CHECK (overall_score BETWEEN 1 AND 100),
    duration_minutes      INTEGER,
    pairing               TEXT,
    notes                 TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tastings_cigar_id ON tastings (cigar_id);
CREATE INDEX idx_tastings_date ON tastings (tasting_date);

-- ---------------------------------------------------------------------------
-- humidors: fiziksel takip noktaları. Her birinin (varsa) tek bir BLE
-- termometresi var, mac_address ile eşleşiyor.
-- ---------------------------------------------------------------------------
CREATE TABLE humidors (
    id             SERIAL PRIMARY KEY,
    name           TEXT NOT NULL,
    mac_address    TEXT UNIQUE,
    location_note  TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- sensor_readings: BLE gateway'den (ESP32/ESPHome) gelen zaman serisi veri.
-- ---------------------------------------------------------------------------
CREATE TABLE sensor_readings (
    id             BIGSERIAL PRIMARY KEY,
    humidor_id     INTEGER NOT NULL REFERENCES humidors(id) ON DELETE CASCADE,
    reading_time   TIMESTAMPTZ NOT NULL DEFAULT now(),
    temperature_c  NUMERIC(4, 1) NOT NULL,
    humidity_pct   NUMERIC(4, 1) NOT NULL,
    battery_pct    SMALLINT
);

-- En sık sorgu: "şu humidorun son N okuması" -- ikili indeks zaman sıralı taramayı hızlandırır.
CREATE INDEX idx_sensor_readings_humidor_time ON sensor_readings (humidor_id, reading_time DESC);

-- ---------------------------------------------------------------------------
-- view: cigars_with_stock -- her cigar için elde kalan adet.
-- "envanterden düşerken hangi purchase'dan düşeceğim önemli değil" kuralını
-- burada somutlaştırıyoruz: toplam alınan - toplam tadım = kalan.
-- ---------------------------------------------------------------------------
CREATE VIEW cigars_with_stock AS
SELECT
    c.id,
    c.brand,
    c.line,
    c.vitola,
    COALESCE(p.total_bought, 0) AS total_bought,
    COALESCE(t.total_smoked, 0) AS total_smoked,
    COALESCE(p.total_bought, 0) - COALESCE(t.total_smoked, 0) AS quantity_remaining
FROM cigars c
LEFT JOIN (
    SELECT cigar_id, SUM(quantity) AS total_bought
    FROM purchases
    GROUP BY cigar_id
) p ON p.cigar_id = c.id
LEFT JOIN (
    SELECT cigar_id, COUNT(*) AS total_smoked
    FROM tastings
    GROUP BY cigar_id
) t ON t.cigar_id = c.id;
