-- Glossary seed, English. This REPLACES the earlier Turkish-language seed
-- (the DELETE makes it safe to run again on an already-seeded database too).
-- Category: wrapper | binder | filler | origin

DELETE FROM glossary_entries;

INSERT INTO glossary_entries (term, category, description) VALUES
-- Wrapper types
('Connecticut Shade', 'wrapper', 'A light-colored, thin-textured leaf grown under shade cloth. Gives creamy, mildly sweet, fairly neutral notes; typically found on mild-to-medium bodied cigars.'),
('Connecticut Broadleaf', 'wrapper', 'A dark, thick, veiny leaf. Delivers earthy, sweet, cocoa- and coffee-forward notes; usually seen on medium-to-full bodied cigars.'),
('Habano', 'wrapper', 'Cuban-seed leaf grown in Ecuador or Nicaragua. Spicy, earthy, and distinctive in character; medium-to-full body.'),
('Maduro', 'wrapper', 'Not a single leaf varietal, but a general term for leaves darkened through extended fermentation/processing. Sweet, cocoa- and coffee-forward notes stand out.'),
('Corojo', 'wrapper', 'A Honduran-origin leaf known for spicy, earthy notes. Usually found on medium-to-full bodied cigars.'),
('Cameroon', 'wrapper', 'An African-origin, thin-textured, relatively rare leaf. Gives mildly sweet, spicy, and lightly nutty notes.'),
('Ecuador Sumatra', 'wrapper', 'A thin, smooth-textured leaf grown in Ecuador. Offers a balanced, mildly sweet, mildly spicy profile.'),
('San Andrés', 'wrapper', 'A dark, thick leaf from Mexico''s San Andrés region. Known for earthy, spicy, and cocoa notes; often used on maduro-style cigars.'),
('Candela', 'wrapper', 'A leaf that keeps its green color through fast-drying (also known as double claro). Grassy, herbal, mildly sweet notes; a rare style.'),
('Criollo', 'wrapper', 'An old Cuban-origin tobacco varietal. Spicy and complex in profile, typically medium body.'),

-- Binder types
('Nicaraguan Binder', 'binder', 'A binder leaf grown in volcanic soil that typically contributes a strong, spicy profile.'),
('Dominican Binder', 'binder', 'A binder leaf that contributes a soft, balanced profile and supports a good burn.'),
('Habano Binder', 'binder', 'A binder leaf that reinforces spicy, earthy notes; preferred in medium-to-full bodied blends.'),

-- Filler types
('Ligero', 'filler', 'Harvested from the top leaves of the plant; the strongest, most intensely flavored filler leaf, contributing significantly to body and strength.'),
('Seco', 'filler', 'Harvested from the middle leaves of the plant; mild-to-medium intensity, balances the overall aroma.'),
('Volado', 'filler', 'Harvested from the lower leaves of the plant; light in aroma but important for improving burn quality in a blend.'),

-- Origin general characteristics
('Cuba', 'origin', 'The classic cigar origin. Known for a long tobacco tradition and generally earthy, spicy, complex profiles.'),
('Dominican Republic', 'origin', 'The world''s largest cigar producer. Generally known for mild-to-medium bodied, creamy, balanced profiles.'),
('Nicaragua', 'origin', 'Known for tobacco grown in volcanic soil; generally gives stronger, spicier, earthier profiles.'),
('Honduras', 'origin', 'Generally produces strong, earthy, spicy tobacco; often favored for full-bodied cigars.'),
('Mexico', 'origin', 'Known especially for the San Andrés region; stands out for dark, earthy, spicy wrapper/filler production.'),
('Ecuador', 'origin', 'Known for growing thin-textured, smooth wrapper leaves (Habano, Sumatra, Connecticut-type) thanks to its cloudy climate.')
ON CONFLICT (term, category) DO NOTHING;
