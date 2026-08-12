-- Glossary başlangıç verisi. Bu liste geniş tutulmak üzere tasarlandı;
-- yeni terim eklemek için aynı formatta INSERT ... ON CONFLICT satırı yeter.
-- Kategori: wrapper | binder | filler | origin

INSERT INTO glossary_entries (term, category, description) VALUES
-- Wrapper (dış yaprak) tipleri
('Connecticut Shade', 'wrapper', 'Gölgede yetiştirilen açık renkli, ince dokulu yaprak. Kremsi, hafif tatlımsı ve nispeten nötr notalar verir; genelde hafif-orta gövdeli purolarda kullanılır.'),
('Connecticut Broadleaf', 'wrapper', 'Koyu kahverengiye yakın, kalın ve damarlı bir yaprak. Toprağımsı, tatlı, kakao ve kahve ağırlıklı notalar verir; genelde orta-tam gövdeli purolarda görülür.'),
('Habano', 'wrapper', 'Küba tohumundan Ekvador veya Nikaragua''da yetiştirilen yaprak. Baharatlı, topraklı ve belirgin bir karaktere sahiptir; orta-tam gövde.'),
('Maduro', 'wrapper', 'Tek bir yaprak türü değil, uzatılmış fermantasyon/işlem süreciyle koyulaştırılmış yaprakları tanımlayan genel bir terimdir. Tatlı, kakao ve kahve ağırlıklı notalar öne çıkar.'),
('Corojo', 'wrapper', 'Honduras kökenli, baharatlı ve topraklı notalarıyla bilinen bir yaprak türü. Genelde orta-tam gövdeli purolarda kullanılır.'),
('Cameroon', 'wrapper', 'Afrika kökenli, ince dokulu ve nispeten nadir bulunan bir yaprak. Hafif tatlı, baharatlı ve hafif kuruyemiş notaları verir.'),
('Ecuador Sumatra', 'wrapper', 'Ekvador''da yetiştirilen, ince ve düzgün dokulu bir yaprak. Dengeli, hafif tatlı ve hafif baharatlı notalar sunar.'),
('San Andrés', 'wrapper', 'Meksika''nın San Andrés bölgesinden, koyu renkli ve kalın bir yaprak. Toprağımsı, baharatlı ve kakao notalarıyla bilinir; sıklıkla maduro tarzı purolarda kullanılır.'),
('Candela', 'wrapper', 'Hızlı kurutma ile yeşil rengi korunan bir yaprak (double claro olarak da bilinir). Çim, otsu ve hafif tatlı notalar verir; nadir görülen bir stildir.'),
('Criollo', 'wrapper', 'Küba kökenli eski bir tütün varyetesi. Baharatlı ve kompleks bir profile sahiptir, genelde orta gövde.'),

-- Binder (bağlayıcı yaprak) tipleri
('Nikaragua Binder', 'binder', 'Genelde güçlü ve baharatlı bir profil katan, volkanik topraklarda yetişen bağlayıcı yaprak.'),
('Dominik Binder', 'binder', 'Yumuşak ve dengeli bir profil katan, yanma performansını destekleyen bağlayıcı yaprak.'),
('Habano Binder', 'binder', 'Baharatlı ve topraklı notaları güçlendiren, orta-tam gövdeli karışımlarda tercih edilen bağlayıcı yaprak.'),

-- Filler (dolgu) tipleri
('Ligero', 'filler', 'Bitkinin üst yapraklarından elde edilir; en güçlü ve en yoğun aromalı dolgu yaprağıdır, gövdeye ve güce katkısı büyüktür.'),
('Seco', 'filler', 'Bitkinin orta yapraklarından elde edilir; hafif-orta yoğunlukta, aroma dengesini sağlayan dolgu yaprağıdır.'),
('Volado', 'filler', 'Bitkinin alt yapraklarından elde edilir; aroması hafiftir ama yanma performansını iyileştirdiği için karışımlarda önemlidir.'),

-- Origin (menşei) genel özellikleri
('Küba', 'origin', 'Klasik puro kökeni. Genelde toprağımsı, baharatlı ve kompleks profillere sahip, köklü bir tütün geleneği ile bilinir.'),
('Dominik Cumhuriyeti', 'origin', 'Dünyanın en büyük puro üreticisi. Genelde yumuşak-orta gövdeli, kremsi ve dengeli profillerle bilinir.'),
('Nikaragua', 'origin', 'Volkanik topraklarda yetişen tütünleriyle bilinir; genelde daha güçlü, baharatlı ve topraklı profiller verir.'),
('Honduras', 'origin', 'Genelde güçlü, topraklı ve baharatlı profillere sahip tütün üretir; tam gövdeli purolarda sık tercih edilir.'),
('Meksika', 'origin', 'Özellikle San Andrés bölgesiyle bilinir; koyu, topraklı ve baharatlı wrapper/filler üretimiyle öne çıkar.'),
('Ekvador', 'origin', 'Bulutlu iklimi sayesinde ince dokulu, düzgün wrapper yaprakları (Habano, Sumatra, Connecticut tipi) yetiştirmesiyle tanınır.')
ON CONFLICT (term, category) DO NOTHING;
