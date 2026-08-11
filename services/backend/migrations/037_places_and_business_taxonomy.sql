-- Orderak D1 — static city-catalogue selection and global business taxonomy v1.
-- Additive and rollback-safe: GeoNames fields/routes and legacy category keys remain.

ALTER TABLE onboarding_sessions ADD COLUMN phone_country_iso TEXT;
ALTER TABLE onboarding_sessions ADD COLUMN city_name TEXT;
ALTER TABLE onboarding_sessions ADD COLUMN city_catalog_id INTEGER;
ALTER TABLE onboarding_sessions ADD COLUMN city_catalog_version TEXT;

ALTER TABLE sellers ADD COLUMN city_catalog_id INTEGER;
ALTER TABLE sellers ADD COLUMN city_catalog_version TEXT;
ALTER TABLE sellers ADD COLUMN business_category_id TEXT;
ALTER TABLE sellers ADD COLUMN business_subcategory_id TEXT;
ALTER TABLE sellers ADD COLUMN business_taxonomy_version INTEGER;

CREATE INDEX idx_onboarding_sessions_phone_country
  ON onboarding_sessions(phone_country_iso, status);
CREATE INDEX idx_sellers_city_catalog
  ON sellers(city_catalog_id) WHERE city_catalog_id IS NOT NULL;

CREATE TABLE business_taxonomy_versions (
  id             INTEGER PRIMARY KEY,
  label          TEXT NOT NULL UNIQUE,
  status         TEXT NOT NULL CHECK (status IN ('draft','active','archived')),
  source_name    TEXT NOT NULL,
  review_method  TEXT NOT NULL,
  published_at   TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE business_categories (
  id          TEXT PRIMARY KEY,
  version_id  INTEGER NOT NULL,
  key         TEXT NOT NULL,
  name_en     TEXT NOT NULL,
  name_ar     TEXT NOT NULL,
  name_fr     TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  UNIQUE(version_id, key),
  FOREIGN KEY (version_id) REFERENCES business_taxonomy_versions(id)
);
CREATE INDEX idx_business_categories_active
  ON business_categories(version_id, active, sort_order);

CREATE TABLE business_subcategories (
  id           TEXT PRIMARY KEY,
  version_id   INTEGER NOT NULL,
  category_id  TEXT NOT NULL,
  key          TEXT NOT NULL,
  name_en      TEXT NOT NULL,
  name_ar      TEXT NOT NULL,
  name_fr      TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  UNIQUE(version_id, category_id, key),
  FOREIGN KEY (version_id) REFERENCES business_taxonomy_versions(id),
  FOREIGN KEY (category_id) REFERENCES business_categories(id)
);
CREATE INDEX idx_business_subcategories_active
  ON business_subcategories(version_id, category_id, active, sort_order);

CREATE VIRTUAL TABLE business_taxonomy_search USING fts5(
  subcategory_id UNINDEXED,
  category_id UNINDEXED,
  name_en,
  name_ar,
  name_fr,
  tokenize='unicode61 remove_diacritics 2'
);

INSERT INTO business_taxonomy_versions(
  id,label,status,source_name,review_method,published_at
) VALUES (
  1,
  'orderak-global-v1',
  'active',
  'Google Business Profile Categories by Lobstr.io [2025 Updated].xlsx',
  'AI-assisted normalization, relevance filtering, translation, and deterministic QA',
  datetime('now')
);

INSERT INTO business_categories(id,version_id,key,name_en,name_ar,name_fr,sort_order) VALUES
  ('retail',1,'retail','Retail & Shopping','التجزئة والتسوق','Commerce de détail',10),
  ('fashion',1,'fashion','Fashion & Lifestyle','الأزياء ونمط الحياة','Mode et art de vivre',20),
  ('food',1,'food','Food & Dining','الطعام والمطاعم','Restauration et alimentation',30),
  ('beauty',1,'beauty','Beauty & Wellness','التجميل والعناية','Beauté et bien-être',40),
  ('health',1,'health','Health & Medical','الصحة والخدمات الطبية','Santé et services médicaux',50),
  ('professional',1,'professional','Professional Services','الخدمات المهنية','Services professionnels',60),
  ('home_services',1,'home_services','Home & Maintenance Services','خدمات المنزل والصيانة','Services à domicile et entretien',70),
  ('automotive',1,'automotive','Automotive & Transportation','السيارات والنقل','Automobile et transport',80),
  ('education',1,'education','Education & Training','التعليم والتدريب','Éducation et formation',90),
  ('hospitality',1,'hospitality','Hospitality & Tourism','الضيافة والسياحة','Hôtellerie et tourisme',100),
  ('real_estate',1,'real_estate','Real Estate & Construction','العقارات والإنشاءات','Immobilier et construction',110),
  ('manufacturing',1,'manufacturing','Manufacturing & Wholesale','التصنيع وتجارة الجملة','Fabrication et commerce de gros',120),
  ('agriculture',1,'agriculture','Agriculture & Natural Resources','الزراعة والموارد الطبيعية','Agriculture et ressources naturelles',130),
  ('arts',1,'arts','Arts, Entertainment & Recreation','الفنون والترفيه والرياضة','Arts, divertissement et loisirs',140),
  ('financial',1,'financial','Financial Services','الخدمات المالية','Services financiers',150),
  ('other_services',1,'other_services','Other Business Services','خدمات أعمال أخرى','Autres services aux entreprises',160);

INSERT INTO business_subcategories(
  id,version_id,category_id,key,name_en,name_ar,name_fr,sort_order
) VALUES
  ('retail_grocery',1,'retail','grocery_store','Grocery Store','متجر بقالة','Épicerie',10),
  ('retail_supermarket',1,'retail','supermarket','Supermarket','سوبر ماركت','Supermarché',20),
  ('retail_convenience',1,'retail','convenience_store','Convenience Store','متجر صغير','Supérette',30),
  ('retail_electronics',1,'retail','electronics_store','Electronics Store','متجر إلكترونيات','Magasin d’électronique',40),
  ('retail_furniture',1,'retail','furniture_store','Furniture Store','متجر أثاث','Magasin de meubles',50),
  ('retail_home_goods',1,'retail','home_goods_store','Home Goods Store','متجر أدوات منزلية','Magasin d’articles ménagers',60),
  ('retail_gifts',1,'retail','gift_shop','Gift Shop','متجر هدايا','Boutique de cadeaux',70),
  ('retail_books',1,'retail','book_store','Book Store','مكتبة بيع كتب','Librairie',80),
  ('retail_pets',1,'retail','pet_store','Pet Store','متجر حيوانات أليفة','Animalerie',90),
  ('retail_jewelry',1,'retail','jewelry_store','Jewelry Store','متجر مجوهرات','Bijouterie',100),

  ('fashion_clothing',1,'fashion','clothing_store','Clothing Store','متجر ملابس','Magasin de vêtements',10),
  ('fashion_womens',1,'fashion','womens_clothing','Women’s Clothing','ملابس نسائية','Vêtements pour femmes',20),
  ('fashion_mens',1,'fashion','mens_clothing','Men’s Clothing','ملابس رجالية','Vêtements pour hommes',30),
  ('fashion_children',1,'fashion','childrens_clothing','Children’s Clothing','ملابس أطفال','Vêtements pour enfants',40),
  ('fashion_shoes',1,'fashion','shoe_store','Shoe Store','متجر أحذية','Magasin de chaussures',50),
  ('fashion_accessories',1,'fashion','fashion_accessories','Fashion Accessories','إكسسوارات أزياء','Accessoires de mode',60),
  ('fashion_sportswear',1,'fashion','sportswear_store','Sportswear Store','متجر ملابس رياضية','Magasin de vêtements de sport',70),
  ('fashion_tailor',1,'fashion','tailor','Tailor','خياط','Tailleur',80),

  ('food_restaurant',1,'food','restaurant','Restaurant','مطعم','Restaurant',10),
  ('food_cafe',1,'food','cafe','Café','مقهى','Café',20),
  ('food_bakery',1,'food','bakery','Bakery','مخبز','Boulangerie',30),
  ('food_fast_food',1,'food','fast_food_restaurant','Fast Food Restaurant','مطعم وجبات سريعة','Restauration rapide',40),
  ('food_catering',1,'food','catering_service','Catering Service','خدمة تموين','Service traiteur',50),
  ('food_delivery',1,'food','food_delivery','Food Delivery','توصيل طعام','Livraison de repas',60),
  ('food_sweets',1,'food','dessert_shop','Dessert & Sweets Shop','متجر حلويات','Pâtisserie et confiserie',70),
  ('food_butcher',1,'food','butcher_shop','Butcher Shop','محل جزارة','Boucherie',80),
  ('food_produce',1,'food','fruit_vegetable_store','Fruit & Vegetable Store','متجر فواكه وخضروات','Magasin de fruits et légumes',90),

  ('beauty_salon',1,'beauty','beauty_salon','Beauty Salon','صالون تجميل','Salon de beauté',10),
  ('beauty_barber',1,'beauty','barber_shop','Barber Shop','صالون حلاقة','Salon de coiffure pour hommes',20),
  ('beauty_cosmetics',1,'beauty','cosmetics_store','Cosmetics Store','متجر مستحضرات تجميل','Magasin de cosmétiques',30),
  ('beauty_spa',1,'beauty','spa','Spa','منتجع صحي','Spa',40),
  ('beauty_nails',1,'beauty','nail_salon','Nail Salon','صالون أظافر','Salon de manucure',50),
  ('beauty_skin',1,'beauty','skin_care','Skin Care','العناية بالبشرة','Soins de la peau',60),
  ('beauty_makeup',1,'beauty','makeup_artist','Makeup Artist','خبير تجميل','Maquilleur',70),

  ('health_pharmacy',1,'health','pharmacy','Pharmacy','صيدلية','Pharmacie',10),
  ('health_clinic',1,'health','medical_clinic','Medical Clinic','عيادة طبية','Clinique médicale',20),
  ('health_dentist',1,'health','dentist','Dentist','طبيب أسنان','Dentiste',30),
  ('health_doctor',1,'health','doctor','Doctor','طبيب','Médecin',40),
  ('health_physio',1,'health','physiotherapy','Physiotherapy Center','مركز علاج طبيعي','Centre de physiothérapie',50),
  ('health_optician',1,'health','optician','Optician','متجر نظارات','Opticien',60),
  ('health_supplies',1,'health','medical_supplies','Medical Supplies','مستلزمات طبية','Fournitures médicales',70),
  ('health_lab',1,'health','medical_laboratory','Medical Laboratory','مختبر تحاليل','Laboratoire médical',80),

  ('professional_accounting',1,'professional','accounting','Accounting Service','خدمات محاسبة','Service de comptabilité',10),
  ('professional_legal',1,'professional','legal_service','Legal Service','خدمات قانونية','Service juridique',20),
  ('professional_marketing',1,'professional','marketing_agency','Marketing Agency','وكالة تسويق','Agence marketing',30),
  ('professional_consulting',1,'professional','business_consulting','Business Consulting','استشارات أعمال','Conseil aux entreprises',40),
  ('professional_it',1,'professional','it_service','IT Service','خدمات تقنية معلومات','Service informatique',50),
  ('professional_photo',1,'professional','photography','Photography Service','خدمات تصوير','Service de photographie',60),
  ('professional_printing',1,'professional','printing_service','Printing Service','خدمات طباعة','Service d’impression',70),
  ('professional_design',1,'professional','graphic_design','Graphic Design','تصميم جرافيك','Conception graphique',80),
  ('professional_translation',1,'professional','translation_service','Translation Service','خدمات ترجمة','Service de traduction',90),

  ('home_electrician',1,'home_services','electrician','Electrician','كهربائي','Électricien',10),
  ('home_plumber',1,'home_services','plumber','Plumber','سباك','Plombier',20),
  ('home_cleaning',1,'home_services','cleaning_service','Cleaning Service','خدمات تنظيف','Service de nettoyage',30),
  ('home_carpentry',1,'home_services','carpenter','Carpenter','نجار','Menuisier',40),
  ('home_appliance',1,'home_services','appliance_repair','Appliance Repair','صيانة أجهزة منزلية','Réparation d’appareils',50),
  ('home_ac',1,'home_services','air_conditioning','Air Conditioning Service','صيانة تكييف','Service de climatisation',60),
  ('home_painting',1,'home_services','painting_service','Painting Service','خدمات دهان','Service de peinture',70),
  ('home_security',1,'home_services','security_systems','Security Systems','أنظمة أمن','Systèmes de sécurité',80),

  ('auto_dealer',1,'automotive','car_dealer','Car Dealer','معرض سيارات','Concessionnaire automobile',10),
  ('auto_repair',1,'automotive','car_repair','Car Repair','صيانة سيارات','Réparation automobile',20),
  ('auto_parts',1,'automotive','auto_parts','Auto Parts Store','متجر قطع غيار','Magasin de pièces automobiles',30),
  ('auto_tires',1,'automotive','tire_shop','Tire Shop','متجر إطارات','Magasin de pneus',40),
  ('auto_wash',1,'automotive','car_wash','Car Wash','غسيل سيارات','Lavage automobile',50),
  ('auto_rental',1,'automotive','car_rental','Car Rental','تأجير سيارات','Location de voitures',60),
  ('auto_transport',1,'automotive','transport_service','Transport Service','خدمات نقل','Service de transport',70),

  ('education_school',1,'education','school','School','مدرسة','École',10),
  ('education_tutoring',1,'education','tutoring','Tutoring Service','دروس خصوصية','Soutien scolaire',20),
  ('education_training',1,'education','training_center','Training Center','مركز تدريب','Centre de formation',30),
  ('education_language',1,'education','language_school','Language School','مدرسة لغات','École de langues',40),
  ('education_daycare',1,'education','daycare','Daycare','حضانة أطفال','Garderie',50),
  ('education_online',1,'education','online_education','Online Education','تعليم عبر الإنترنت','Formation en ligne',60),

  ('hospitality_hotel',1,'hospitality','hotel','Hotel','فندق','Hôtel',10),
  ('hospitality_travel',1,'hospitality','travel_agency','Travel Agency','وكالة سفر','Agence de voyages',20),
  ('hospitality_tours',1,'hospitality','tour_operator','Tour Operator','منظم رحلات','Voyagiste',30),
  ('hospitality_events',1,'hospitality','event_planner','Event Planner','منظم فعاليات','Organisateur d’événements',40),
  ('hospitality_venue',1,'hospitality','event_venue','Event Venue','قاعة مناسبات','Lieu événementiel',50),
  ('hospitality_rental',1,'hospitality','vacation_rental','Vacation Rental','إيجار سياحي','Location de vacances',60),

  ('realestate_agency',1,'real_estate','real_estate_agency','Real Estate Agency','وكالة عقارات','Agence immobilière',10),
  ('realestate_management',1,'real_estate','property_management','Property Management','إدارة عقارات','Gestion immobilière',20),
  ('realestate_construction',1,'real_estate','construction_company','Construction Company','شركة مقاولات','Entreprise de construction',30),
  ('realestate_contractor',1,'real_estate','general_contractor','General Contractor','مقاول عام','Entrepreneur général',40),
  ('realestate_architect',1,'real_estate','architect','Architect','مهندس معماري','Architecte',50),
  ('realestate_interior',1,'real_estate','interior_design','Interior Design','تصميم داخلي','Architecture d’intérieur',60),
  ('realestate_materials',1,'real_estate','building_materials','Building Materials','مواد بناء','Matériaux de construction',70),

  ('manufacturing_factory',1,'manufacturing','factory','Factory','مصنع','Usine',10),
  ('manufacturing_general',1,'manufacturing','manufacturer','Manufacturer','جهة تصنيع','Fabricant',20),
  ('manufacturing_wholesale',1,'manufacturing','wholesaler','Wholesaler','تاجر جملة','Grossiste',30),
  ('manufacturing_packaging',1,'manufacturing','packaging','Packaging Service','خدمات تغليف','Service d’emballage',40),
  ('manufacturing_machinery',1,'manufacturing','industrial_machinery','Industrial Machinery','معدات صناعية','Machines industrielles',50),

  ('agriculture_farm',1,'agriculture','farm','Farm','مزرعة','Ferme',10),
  ('agriculture_supplies',1,'agriculture','agricultural_supplies','Agricultural Supplies','مستلزمات زراعية','Fournitures agricoles',20),
  ('agriculture_nursery',1,'agriculture','plant_nursery','Plant Nursery','مشتل نباتات','Pépinière',30),
  ('agriculture_livestock',1,'agriculture','livestock','Livestock Farm','مزرعة ماشية','Élevage',40),
  ('agriculture_poultry',1,'agriculture','poultry','Poultry Farm','مزرعة دواجن','Ferme avicole',50),
  ('agriculture_fish',1,'agriculture','fishery','Fishery','مزرعة أسماك','Pêcherie',60),

  ('arts_gallery',1,'arts','art_gallery','Art Gallery','معرض فني','Galerie d’art',10),
  ('arts_crafts',1,'arts','arts_crafts','Arts & Crafts','فنون وحرف','Arts et artisanat',20),
  ('arts_entertainment',1,'arts','entertainment_center','Entertainment Center','مركز ترفيه','Centre de divertissement',30),
  ('arts_gaming',1,'arts','gaming_center','Gaming Center','مركز ألعاب','Centre de jeux',40),
  ('arts_sports',1,'arts','sports_club','Sports Club','نادي رياضي','Club de sport',50),
  ('arts_music',1,'arts','music_studio','Music Studio','استوديو موسيقى','Studio de musique',60),

  ('financial_advisor',1,'financial','financial_advisor','Financial Advisor','مستشار مالي','Conseiller financier',10),
  ('financial_insurance',1,'financial','insurance_agency','Insurance Agency','وكالة تأمين','Agence d’assurance',20),
  ('financial_exchange',1,'financial','currency_exchange','Currency Exchange','صرافة','Bureau de change',30),
  ('financial_microfinance',1,'financial','microfinance','Microfinance Service','تمويل متناهي الصغر','Service de microfinance',40),
  ('financial_payments',1,'financial','payment_service','Payment Service','خدمات دفع','Service de paiement',50),

  ('other_laundry',1,'other_services','laundry','Laundry','مغسلة ملابس','Blanchisserie',10),
  ('other_logistics',1,'other_services','logistics','Logistics Service','خدمات لوجستية','Service logistique',20),
  ('other_courier',1,'other_services','courier','Courier Service','خدمة شحن سريع','Service de messagerie',30),
  ('other_telecom',1,'other_services','telecommunications','Telecommunications','اتصالات','Télécommunications',40),
  ('other_repair',1,'other_services','repair_service','Repair Service','مركز صيانة','Service de réparation',50),
  ('other_events',1,'other_services','event_service','Event Service','خدمات مناسبات','Service événementiel',60);

INSERT INTO business_taxonomy_search(
  subcategory_id,category_id,name_en,name_ar,name_fr
)
SELECT id,category_id,name_en,name_ar,name_fr
FROM business_subcategories
WHERE version_id=1 AND active=1;

PRAGMA optimize;
