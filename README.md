# Puro Envanteri — Veritabanı

Bu adım projenin temelini atıyor: Postgres şeması + başlangıç glossary verisi.
ORM yok, düz SQL migration'lar var — `node-pg-migrate` sadece hangi migration'ların
çalıştığını takip ediyor, şemanın kendisi `migrations/*.sql` içinde okunabilir SQL.

Bu şema Railway'deki gerçek Postgres'e karşı değil, yerel bir Postgres'e karşı
uçtan uca test edildi (migration çalıştırıldı, glossary seed edildi, örnek
alım + tadım senaryosu ile envanter düşme mantığı doğrulandı).

## Kurulum

```bash
npm install
cp .env.example .env
# .env içindeki DATABASE_URL'i doldur (Railway Postgres eklediğinde
# Variables sekmesinden kopyalayabilirsin)
```

## Migration çalıştırma

```bash
export DATABASE_URL="postgres://..."   # veya .env'den yükle
npm run migrate:up      # şemayı kurar
npm run seed:glossary   # glossary'yi doldurur (22 başlangıç terimi)
```

Railway'de: proje ayarlarında bir "Deploy" adımı olarak `npm run migrate:up`
komutunu deploy hook'una eklersen her push'ta şema güncel kalır.

## Şema özeti

| Tablo | Ne için |
|---|---|
| `cigars` | Künye/katalog — bir puronun kendisi (marka, filler/binder/wrapper, orijin, sertlik, beklenen tat profili). Fiziksel bir alım değildir. |
| `purchases` | Her alım ayrı satır — aynı `cigars` satırına birden çok `purchases` bağlanabilir (farklı zaman/yer/fiyat). `reference_url` alanı AI ile künye çıkarımında kullanılan linki saklar. |
| `tastings` | Her tadım = bir adet tüketim. Puanlama alanları nullable; sadece `cigar_id` + tarihle de kayıt açılabilir ("değerlendirecek vaktim yok" senaryosu). |
| `glossary_entries` | wrapper / binder / filler / origin kategorilerinde genel referans bilgisi. `cigars` tablosuna katı bir foreign key ile değil, uygulama katmanında `(term, category)` eşleşmesiyle bağlanır — böylece `cigars.wrapper` serbest kalır ama glossary'de karşılığı varsa gösterilebilir. |
| `humidors` | Fiziksel takip noktaları. Her biri (varsa) bir BLE termometrenin `mac_address`'iyle eşleşir. |
| `sensor_readings` | Gateway'den (ESP32/ESPHome) gelen zaman serisi sıcaklık/nem verisi, `humidor_id`'ye bağlı. |

### `cigars_with_stock` view'ı

Envanterden düşme mantığı burada somutlaşıyor:

```sql
quantity_remaining = SUM(purchases.quantity) - COUNT(tastings)
```

Yani bir `tastings` satırı oluşturmak "bir tane içtim" demek, hangi `purchases`
satırından düştüğü hiç önemli değil — tam istenen davranış bu.

## Backend API

Express + TypeScript, `pg` ile doğrudan SQL (ORM yok, veritabanı katmanıyla tutarlı).
Tüm `/api/*` rotaları `x-api-key` başlığıyla korunur (`.env`'deki `API_KEY`), `/health` korumasızdır.

```bash
npm run dev      # tsx watch ile geliştirme (otomatik yeniden başlatma)
npm run build    # TypeScript'i dist/ altına derler
npm start        # derlenmiş çıktıyı çalıştırır (Railway bunu kullanır)
```

Railway'de: Nixpacks `build` script'ini otomatik bulup çalıştırır, ardından `start`'ı
çalıştırma komutu olarak kullanır — ekstra bir ayar gerekmez, sadece `API_KEY` ve
`DATABASE_URL` değişkenlerinin Railway'in Variables sekmesinde tanımlı olduğundan emin ol.

### Uç noktalar

| Rota | Ne işe yarar |
|---|---|
| `GET /health` | Ayakta mı kontrolü, auth gerektirmez |
| `GET /api/cigars` | Künye listesi + kalan adet |
| `GET /api/cigars/:id` | Künye detayı + alım geçmişi + tadım geçmişi |
| `POST /api/cigars` | Yeni künye |
| `PUT /api/cigars/:id` | Kısmi güncelleme |
| `DELETE /api/cigars/:id` | Siler (purchases + tastings cascade ile gider) |
| `POST /api/cigars/:id/purchases` | Yeni alım kaydı |
| `POST /api/cigars/:id/tastings` | Yeni tadım (= envanterden 1 adet düşer) |
| `GET /api/glossary?category=wrapper` | Glossary listesi, kategoriye göre filtrelenebilir |
| `POST /api/glossary` | Yeni terim (varsa günceller) |
| `GET /api/humidors` | Humidor listesi + her birinin son okuması |
| `POST /api/humidors` | Yeni humidor (mac_address cihaz kurulana kadar boş kalabilir) |
| `POST /api/sensor` | Gateway'in çağıracağı uç nokta — `{mac_address, temperature_c, humidity_pct}` |
| `GET /api/humidors/:id/readings?limit=100` | Geçmiş grafiği için okuma listesi |

Tüm rotalar yerelde gerçek bir sunucu ayağa kaldırılıp curl ile uçtan uca test edildi:
künye oluşturma, iki farklı kaynaktan alım, tadım kaydı sonrası `quantity_remaining`'in
doğru hesaplanması, bilinmeyen bir MAC adresine sensör verisi gönderildiğinde anlamlı
404 dönmesi, ve künye silindiğinde bağlı kayıtların cascade ile temizlenmesi doğrulandı.

## Sırada ne var

Bir sonraki adım arayüz: bu API'ye konuşan, soft/aydınlık temalı bir envanter ve
tadım paneli.
