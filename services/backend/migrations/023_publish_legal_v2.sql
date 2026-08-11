-- Generated from docs/legal by scripts/generate-legal-migration.mjs.
-- Publishes owner-confirmed bilingual legal content as the next version.
UPDATE content_page_versions SET status='archived' WHERE slug='terms' AND lang='en' AND status='published';
INSERT INTO content_page_versions(slug,lang,version,title,body_html,notes,status,published_at)
SELECT 'terms','en',COALESCE(MAX(version),0)+1,'Orderak — Terms of Service','<h2>1. Who we are</h2>
<p>The Platform is operated by <strong>Ayman Mohamed Abdellatif</strong>, an individual legally based in the Arab Republic of Egypt, trading under the name “Orderak” (&quot;Orderak&quot;, &quot;we&quot;, &quot;us&quot;). You can contact us at <strong>support@orderak.app</strong>.</p>
<h2>2. Definitions</h2>
<ul>
<li><strong>Seller</strong> — a merchant who creates an account in the Orderak app to run an online store.</li>
<li><strong>Buyer</strong> — anyone who visits a Seller''s public store page or places an order through it.</li>
<li><strong>Store</strong> — the catalog, store page, and related content a Seller publishes through the Platform.</li>
<li><strong>You</strong> — a Seller or a Buyer, as the context requires.</li>
</ul>
<h2>3. Acceptance of these Terms</h2>
<p>By creating a Seller account, using the app, or placing an order through a store page, you agree to these Terms and to our <a href="https://orderak.app/privacy">Privacy Policy</a>. If you do not agree, do not use the Platform.</p>
<h2>4. Eligibility</h2>
<ul>
<li>You must be at least <strong>18 years old</strong> (or the age of legal majority in your country) and legally capable of entering into contracts.</li>
<li>Sellers must use the Platform for genuine commercial activity and must hold any licences or registrations their business requires under applicable law (including, in Egypt, applicable commercial registration and tax obligations).</li>
</ul>
<h2>5. Accounts and security</h2>
<ul>
<li>Seller accounts are created by verifying a mobile phone number via a one-time SMS code.</li>
<li>You are responsible for keeping your phone number, SIM, and device secure. Anything done through your account is treated as done by you.</li>
<li>Notify us immediately at <strong>support@orderak.app</strong> if you believe your account has been compromised.</li>
<li>One person or business per account. You may not sell, transfer, or share your account.</li>
</ul>
<h2>6. Orderak''s role — we are a software platform, not a party to sales</h2>
<ul>
<li>Orderak provides software: store pages, catalog management, order tracking, and related tools.</li>
<li><strong>Every sale is a contract directly between the Buyer and the Seller.</strong> Orderak is not the seller of any product, is not a party to the transaction, and does not act as agent for either side.</li>
<li><strong>Orderak does not process, hold, or transfer payments between Buyers and Sellers.</strong> Payment methods shown on store pages (such as cash on delivery, InstaPay, Vodafone Cash, or Fawry) are settled directly between the Buyer and the Seller. Any payment details displayed (e.g. a Seller''s InstaPay address or wallet number) are provided by the Seller.</li>
<li>Product descriptions, prices, availability, delivery, warranties, returns, and refunds are the sole responsibility of the Seller. Disputes about an order must be resolved between the Buyer and the Seller. We may, but are not obliged to, assist in resolving disputes.</li>
</ul>
<h2>7. Seller obligations</h2>
<p>As a Seller you agree to:</p>
<ol>
<li>Provide accurate, current information about yourself, your store, and your products, and keep it updated.</li>
<li>Sell only products you are legally allowed to sell, and comply with all applicable laws, including consumer-protection, e-commerce, and tax laws in the countries where you sell (in Egypt this includes the Consumer Protection Law No. 181 of 2018).</li>
<li>Honour the orders, prices, and terms you display to Buyers, and handle returns and refunds as required by applicable law.</li>
<li>Not list prohibited items, including: illegal goods; weapons; drugs and controlled substances; counterfeit or trademark-infringing goods; stolen goods; adult content; tobacco or alcohol where restricted; medicines requiring a licence you do not hold; or anything that infringes third-party rights.</li>
<li>Use Buyer data received through the Platform only to fulfil orders and as permitted by law, and protect it appropriately (see Section 12).</li>
</ol>
<h2>8. Buyer terms</h2>
<ul>
<li>Placing an order through a store page is an offer to buy from that Seller on the terms the Seller displays.</li>
<li>Provide accurate contact details; the Seller will use them to confirm and fulfil the order.</li>
<li>Orderak does not guarantee that any Seller will accept, fulfil, or deliver an order.</li>
</ul>
<h2>9. Plans, fees, and billing</h2>
<ul>
<li>Parts of the Platform are free; other features require a paid subscription plan. Current plans, limits (such as maximum products), and prices are shown in the app.</li>
<li>Plan limits are enforced automatically. We may change plans or pricing; changes apply from your next billing period after reasonable notice in the app.</li>
<li>Coupons, referral rewards, and affiliate credits are promotional, have no cash value, and may be modified or withdrawn if abused.</li>
<li>Stores on the free plan may display advertising placed by Orderak.</li>
<li>Fees paid are non-refundable except where required by law.</li>
</ul>
<h2>10. Content and intellectual property</h2>
<ul>
<li><strong>Your content stays yours.</strong> Sellers retain all rights in the content they upload (product photos, descriptions, store names, logos).</li>
<li>You grant Orderak a worldwide, non-exclusive, royalty-free licence to host, store, reproduce, adapt (e.g. resize images), and display that content for the purpose of operating and promoting the Platform, for as long as it remains on the Platform.</li>
<li>You confirm you have the rights to everything you upload.</li>
<li>The Platform itself — software, design, branding, and the Orderak name and logo — belongs to Orderak. These Terms give you no rights in it other than normal use.</li>
<li>We may remove content or unpublish a store that we reasonably believe violates these Terms or the law.</li>
</ul>
<h2>11. Acceptable use</h2>
<p>You must not:</p>
<ul>
<li>use the Platform for fraud, money laundering, or any unlawful purpose;</li>
<li>misrepresent your identity, your business, or your products;</li>
<li>upload malware, scrape the Platform, probe or overload our infrastructure, or attempt to access other users'' data or accounts;</li>
<li>send spam or unsolicited marketing through data obtained via the Platform;</li>
<li>circumvent plan limits, fees, or referral rules.</li>
</ul>
<h2>12. Data protection</h2>
<p>Our handling of personal data is described in the <a href="https://orderak.app/privacy">Privacy Policy</a>. In addition:</p>
<ul>
<li>For the personal data of their Buyers (names, phone numbers, order details), <strong>Sellers act as independent controllers</strong>. Sellers must handle Buyer data lawfully — in Egypt, in line with the Personal Data Protection Law No. 151 of 2020 — and must not use it for purposes unrelated to the order without the Buyer''s consent.</li>
<li>Orderak processes Buyer data on the Seller''s behalf to operate the store, relay orders, and provide the service.</li>
</ul>
<h2>13. AI features</h2>
<p>The app may include an AI assistant. AI-generated content can be inaccurate or incomplete; it is provided for convenience only and is not business, legal, or financial advice. You are responsible for anything you publish or decide based on it.</p>
<h2>14. Availability and changes to the Platform</h2>
<p>The Platform is provided on a commercially reasonable basis, but we do not guarantee uninterrupted or error-free operation. We may add, change, or discontinue features. If we discontinue the Platform entirely, we will give Sellers reasonable advance notice so they can export their data.</p>
<h2>15. Suspension and termination</h2>
<ul>
<li>You may stop using the Platform and delete your account at any time (see the Privacy Policy for what happens to your data).</li>
<li>We may suspend or terminate an account, or unpublish a store, with immediate effect if we reasonably believe these Terms or the law have been violated, or where required by a competent authority. Where practical, we will notify you and give you a chance to remedy the issue first.</li>
<li>Paid amounts for the current period are not refunded on termination for breach.</li>
</ul>
<h2>16. Disclaimers</h2>
<p>To the maximum extent permitted by law, the Platform is provided <strong>&quot;as is&quot; and &quot;as available&quot;</strong>, without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, and non-infringement. Orderak does not warrant the quality, safety, legality, or delivery of any product sold by a Seller.</p>
<h2>17. Limitation of liability</h2>
<p>To the maximum extent permitted by law:</p>
<ul>
<li>Orderak is not liable for indirect, incidental, special, or consequential damages, or for loss of profits, revenue, data, or goodwill.</li>
<li>Orderak is not liable for the acts or omissions of Sellers or Buyers, including non-delivery, defective products, or payment disputes.</li>
<li>Orderak''s total liability to you for all claims arising from the Platform is limited to the greater of (a) the subscription fees you paid to Orderak in the 12 months before the claim, and (b) EGP 1,000.</li>
</ul>
<p>Nothing in these Terms excludes liability that cannot be excluded under applicable law (including liability for fraud or intentional misconduct).</p>
<h2>18. Indemnity</h2>
<p>Sellers agree to indemnify Orderak against claims, losses, and reasonable costs arising from their store, their products, their content, their use of Buyer data, or their breach of these Terms or applicable law.</p>
<h2>19. Changes to these Terms</h2>
<p>We may update these Terms. For material changes we will give notice in the app or on the website at least <strong>14 days</strong> before they take effect. Continuing to use the Platform after that date means you accept the new Terms; if you do not accept them, stop using the Platform and delete your account.</p>
<h2>20. Governing law and disputes</h2>
<p>These Terms are governed by the laws of the <strong>Arab Republic of Egypt</strong>. Disputes that cannot be resolved amicably are subject to the jurisdiction of the competent courts of Egypt — without prejudice to mandatory consumer-protection rules that give you rights or a forum in your country of residence.</p>
<h2>21. General</h2>
<ul>
<li>If any provision is found invalid, the rest remains in effect.</li>
<li>These Terms (with the Privacy Policy) are the entire agreement between you and Orderak regarding the Platform.</li>
<li>We may assign these Terms as part of a business transfer; you may not assign them.</li>
<li>The Arabic and English versions of these Terms are published together. Both</li>
<p>communicate the same rules; where an interpretation must prevail under Egyptian law, the Arabic version prevails.</p>
</ul>
<p><strong>Contact:</strong> support@orderak.app</p>','Owner details confirmed 2026-07-13; independent Egyptian legal review recommended','published',datetime('now')
FROM content_page_versions WHERE slug='terms' AND lang='en';
UPDATE content_page_versions SET status='archived' WHERE slug='terms' AND lang='ar' AND status='published';
INSERT INTO content_page_versions(slug,lang,version,title,body_html,notes,status,published_at)
SELECT 'terms','ar',COALESCE(MAX(version),0)+1,'أوردرك — شروط الاستخدام','<p><strong>آخر تحديث:</strong> 13 يوليو 2026 <strong>النطاق:</strong> تطبيق أوردرك لأندرويد، وصفحات المتاجر العامة على <code>orderak.app</code>، وواجهة <code>api.orderak.app</code>.</p>
<h2>1. من نحن</h2>
<p>يشغّل المنصة <strong>أيمن محمد عبد اللطيف</strong>، بصفته فردًا مقيمًا قانونًا في جمهورية مصر العربية ويعمل تحت الاسم التجاري «أوردرك». للتواصل: <strong>support@orderak.app</strong>.</p>
<h2>2. قبول الشروط والأهلية</h2>
<p>بإنشاء حساب بائع أو استخدام المنصة أو تقديم طلب شراء، فإنك توافق على هذه الشروط وعلى <a href="https://orderak.app/privacy">سياسة الخصوصية</a>. يجب أن يكون البائع بعمر 18 عامًا على الأقل، وأهلًا للتعاقد، وأن يستوفي التراخيص والتسجيلات والالتزامات الضريبية التي يفرضها نشاطه.</p>
<h2>3. الحساب والأمان</h2>
<p>يتم إنشاء حساب البائع بعد التحقق من رقم الهاتف برمز SMS لمرة واحدة. تتحمل مسؤولية حماية الهاتف والشريحة والجهاز، وإبلاغنا فورًا عند الاشتباه في اختراق الحساب. لا يجوز بيع الحساب أو نقله أو مشاركته.</p>
<h2>4. دور أوردرك</h2>
<p>أوردرك مزوّد برمجيات لإدارة المتجر والكتالوج والطلبات، وليس بائعًا ولا طرفًا في عقود البيع بين البائع والمشتري. لا تحتفظ أوردرك بأموال المشترين ولا تنقلها؛ تتم وسائل الدفع المعروضة مثل الدفع عند الاستلام أو إنستاباي أو فودافون كاش مباشرة بين البائع والمشتري. يتحمل البائع وحده مسؤولية المنتج والسعر والتوافر والتوصيل والضمان والاسترجاع ورد الأموال.</p>
<h2>5. التزامات البائع والمشتري</h2>
<p>يلتزم البائع بتقديم معلومات صحيحة، وبيع السلع المسموح بها قانونًا، واحترام قوانين حماية المستهلك والتجارة الإلكترونية والضرائب، وحماية بيانات المشترين. ويُحظر بيع السلع غير القانونية أو المقلدة أو المسروقة أو الأسلحة أو المخدرات أو أي محتوى ينتهك حقوق الغير. يلتزم المشتري بتقديم بيانات اتصال صحيحة، ولا تضمن أوردرك قبول البائع للطلب أو تنفيذه.</p>
<h2>6. الخطط والرسوم</h2>
<p>قد تتضمن المنصة خططًا مجانية ومدفوعة وحدود استخدام وإعلانات في الخطة المجانية. تُعرض الأسعار والحدود داخل التطبيق. قد تتغير الأسعار من دورة الفوترة التالية بعد إشعار معقول. لا تُرد الرسوم إلا إذا أوجب القانون ذلك. القسائم والمكافآت الترويجية ليست نقدًا ويمكن تعليقها عند إساءة الاستخدام.</p>
<h2>7. المحتوى والملكية الفكرية</h2>
<p>يظل محتوى البائع ملكًا له. يمنح البائع أوردرك ترخيصًا عالميًا غير حصري ومجانيًا لاستضافة المحتوى ومعالجته وعرضه بالقدر اللازم لتشغيل المنصة والترويج لها. يضمن البائع امتلاكه الحقوق اللازمة. البرمجيات والتصميم والعلامة والشعار الخاصة بالمنصة مملوكة لأوردرك، ويجوز إزالة أي محتوى مخالف.</p>
<h2>8. الاستخدام المقبول والذكاء الاصطناعي</h2>
<p>يُحظر الاحتيال وغسل الأموال وانتحال الهوية والرسائل المزعجة والبرمجيات الضارة والكشط والاختراق وتجاوز حدود الخطط. قد تكون مخرجات المساعد الذكي غير دقيقة؛ وهي ليست نصيحة قانونية أو مالية أو تجارية، ويتحمل المستخدم مسؤولية قراراته.</p>
<h2>9. البيانات والخصوصية</h2>
<p>توضح <a href="https://orderak.app/privacy">سياسة الخصوصية</a> معالجة البيانات. البائع مسؤول مستقل عن بيانات عملائه، ويجب ألا يستخدمها إلا لتنفيذ الطلب أو على أساس قانوني آخر صالح. تعالج أوردرك بيانات الطلبات لتشغيل الخدمة نيابة عن البائع.</p>
<h2>10. التوافر والتعليق والإنهاء</h2>
<p>تُقدم المنصة «كما هي» وبحسب التوافر، دون ضمان استمرارية كاملة. قد نغيّر ميزات أو نوقفها مع إشعار معقول عند الإنهاء الكلي. يجوز للمستخدم طلب حذف حسابه، ويجوز لأوردرك تعليق الحساب أو إنهاؤه عند مخالفة الشروط أو القانون، مع إخطار وفرصة للتصحيح حيثما كان ذلك عمليًا.</p>
<h2>11. المسؤولية والتعويض</h2>
<p>إلى أقصى حد يسمح به القانون، لا تتحمل أوردرك الأضرار غير المباشرة أو خسارة الأرباح أو البيانات، ولا أفعال البائعين أو المشترين. يقتصر إجمالي مسؤوليتها على الأكبر من رسوم الاشتراك المدفوعة خلال الاثني عشر شهرًا السابقة أو 1,000 جنيه مصري. لا يسري هذا الحد على المسؤولية التي لا يجوز استبعادها قانونًا. ويعوض البائع أوردرك عن المطالبات الناتجة عن متجره أو منتجاته أو محتواه أو مخالفته للقانون.</p>
<h2>12. تعديل الشروط والقانون الحاكم</h2>
<p>نعطي إشعارًا قبل 14 يومًا على الأقل بالتغييرات الجوهرية. تخضع الشروط لقوانين جمهورية مصر العربية واختصاص محاكمها المختصة، مع عدم الإخلال بحقوق المستهلك الإلزامية. إذا بطل بند بقيت باقي البنود نافذة. تصدر النسختان العربية والإنجليزية معًا؛ وعند لزوم ترجيح تفسير وفق القانون المصري تسود العربية.</p>
<p><strong>التواصل:</strong> support@orderak.app</p>','Owner details confirmed 2026-07-13; independent Egyptian legal review recommended','published',datetime('now')
FROM content_page_versions WHERE slug='terms' AND lang='ar';
UPDATE content_page_versions SET status='archived' WHERE slug='privacy' AND lang='en' AND status='published';
INSERT INTO content_page_versions(slug,lang,version,title,body_html,notes,status,published_at)
SELECT 'privacy','en',COALESCE(MAX(version),0)+1,'Orderak — Privacy Policy','<h2>1. Who is responsible for your data</h2>
<p>The Platform is operated by <strong>Ayman Mohamed Abdellatif</strong>, an individual legally based in the Arab Republic of Egypt and trading under the name “Orderak” (&quot;Orderak&quot;, &quot;we&quot;, &quot;us&quot;), contactable at <strong>support@orderak.app</strong>.</p>
<p>Two situations to distinguish:</p>
<ul>
<li><strong>Sellers</strong> (merchants using the Orderak app): Orderak decides how and why your data is processed — we are the <strong>controller</strong> of your data.</li>
<li><strong>Buyers</strong> (customers ordering through a seller''s store page): your order data is collected <strong>for the seller</strong>. The seller is responsible for how they use it; Orderak processes it on the seller''s behalf to run the store and deliver the order to the seller''s app.</li>
</ul>
<h2>2. What data we collect</h2>
<h3>From Sellers</h3>
<p> Data  —  Examples  —  Why   Account  —  Mobile phone number, one-time SMS verification  —  Sign-in and account identity   Store profile  —  Store name, category, city/country, store link (slug), description, address, logo and cover images  —  Creating and displaying your public store   Contact &amp; payout details  —  WhatsApp number, InstaPay address, Vodafone Cash number, email, website  —  Shown on your store page so buyers can contact and pay <strong>you</strong> — Orderak never holds the funds   Catalog  —  Products, prices, stock, product images  —  Your catalog in the app and on your public store   Orders &amp; customers  —  Orders received, buyer contact details, order history  —  Order management inside your app   Billing  —  Subscription plan, payment events, coupons, referral/affiliate activity  —  Managing your plan and its limits   Support &amp; email  —  Messages you send to support, transactional emails  —  Helping you and notifying you   Technical  —  Device identifiers used to secure your session, IP address, request logs  —  Security, fraud prevention, debugging </p>
<h3>From Buyers</h3>
<p>When you place an order on a store page we collect, <strong>on behalf of that seller</strong>: your <strong>name, phone number, the items ordered, your chosen payment method, and any note you add</strong> (which may include a delivery address). We do not require a Buyer account and do not collect Buyer payment credentials — payment happens directly between you and the seller.</p>
<h3>From all visitors</h3>
<p>Standard technical logs (IP address, user agent, pages requested) needed to serve pages, keep the Platform secure, and prevent abuse. The public website does not use advertising or analytics cookies. This policy must be updated before analytics or advertising cookies are introduced.</p>
<h2>3. What we use data for</h2>
<ul>
<li>Providing the Platform: accounts, store pages, catalog sync, order relay, notifications.</li>
<li>Verifying your identity at sign-in (SMS one-time codes).</li>
<li>Managing subscriptions, plan limits, coupons, and referrals.</li>
<li>Sending transactional messages (e.g. sign-in codes, service or billing notices) and responding to support requests.</li>
<li>Security: preventing fraud, abuse, and unauthorized access; keeping audit logs.</li>
<li>Improving the Platform (aggregate, non-identifying usage patterns).</li>
<li>Complying with legal obligations.</li>
</ul>
<p>We do <strong>not</strong> sell personal data, and we do not use Buyer contact details for our own marketing.</p>
<h2>4. AI assistant</h2>
<p>If an AI assistant is made available to you and you use it, the messages you type are sent through our backend to an AI provider (currently <strong>DeepSeek</strong>) to generate the answer. Do not include personal data about your customers in AI chats unless necessary. AI conversations are used to provide the answer, not to build advertising profiles.</p>
<h2>5. Who we share data with</h2>
<p>We share data only with service providers who process it for us, under their own contractual and legal obligations:</p>
<p> Provider  —  Purpose  —  Data involved   <strong>Cloudflare</strong> (Workers, D1, R2, KV)  —  Hosting the backend, database, images, and sessions  —  All Platform data   <strong>Google Firebase</strong>  —  Phone-number sign-in (sending and checking SMS codes)  —  Seller phone numbers   <strong>DeepSeek</strong>  —  AI assistant responses (only when you use the assistant)  —  Content of your AI chat messages   <strong>Cloudflare Email Service and Email Routing</strong>  —  Transactional and support email  —  Email addresses and message content </p>
<p>We may also disclose data if required by law or a binding order of a competent authority, or as part of a business transfer (in which case this policy continues to apply).</p>
<p><strong>Sellers see Buyer data:</strong> if you place an order, the seller receives your name, phone number, note, and order details — that is the point of the order. The seller is responsible for using it lawfully.</p>
<p><strong>Public by design:</strong> a seller''s store name, catalog, and the contact/payment details the seller chooses to add (e.g. WhatsApp, InstaPay) are published on their public store page, which anyone with the link can view and search engines may index.</p>
<h2>6. Where data is stored</h2>
<p>The Platform runs on Cloudflare''s global network, so data may be stored and processed in data centers <strong>outside Egypt</strong> (including in Europe and the United States). We rely on our providers'' safeguards and contractual commitments for these transfers, and apply the safeguards required by applicable law, including the PDPL''s rules on cross-border transfer.</p>
<h2>7. How long we keep data</h2>
<ul>
<li><strong>Seller account data</strong>: for as long as the account exists, then deleted or anonymized within <strong>90 days</strong> of a verified account-deletion request, except where we must keep records longer (e.g. billing records for tax/accounting purposes).</li>
<li><strong>Orders</strong>: kept while the seller''s account is active, since they are the seller''s business records.</li>
<li><strong>Technical logs</strong>: deleted or de-identified automatically after no more than <strong>30 days</strong>, unless specific records must be isolated for an active security investigation or legal obligation.</li>
</ul>
<h2>8. Your rights</h2>
<p>Under the PDPL (and similar laws elsewhere) you have the right to:</p>
<ul>
<li><strong>access</strong> the personal data we hold about you and get a copy;</li>
<li><strong>correct</strong> inaccurate data;</li>
<li><strong>delete</strong> your data (see account deletion below);</li>
<li><strong>object to or restrict</strong> certain processing;</li>
<li><strong>withdraw consent</strong> where processing is based on consent;</li>
<li><strong>complain</strong> to the competent data protection authority (in Egypt, the Personal Data Protection Centre).</li>
</ul>
<p>To exercise any of these, contact <strong>support@orderak.app</strong> from the phone number or email linked to your account. We answer within the time required by law.</p>
<p><strong>Buyers:</strong> because sellers control their customer data, requests about an order you placed can be sent either to the seller or to us — if you contact us, we will delete or correct the data in our systems and notify the seller where required.</p>
<h3>Account deletion (Sellers)</h3>
<p>In the app, open <strong>Settings → Request account deletion</strong>. This opens the public request resource at <strong>https://orderak.app/delete-account</strong>, which is also available after uninstalling the app. You may alternatively email <strong>support@orderak.app</strong>. We verify control of the account''s phone number before fulfilment. A verified request is completed within 90 days and removes or anonymizes the store page, catalog, account credentials, and associated personal data, except records retained for a stated legal, accounting, fraud-prevention, or dispute-resolution obligation. Cancelling a paid subscription does not by itself delete the account, and account deletion does not automatically settle amounts already due.</p>
<h2>9. Security</h2>
<p>Data is encrypted in transit (HTTPS everywhere). Backend access is restricted and authenticated; admin access uses role-based permissions with two-factor authentication. App sessions are protected by a per-device secret. No system is perfectly secure — if a breach affects your data, we will notify you and the authorities as required by law.</p>
<h2>10. Children</h2>
<p>The Platform is a business tool and is not directed at children. Sellers must be at least 18. We do not knowingly collect children''s data; if you believe a child has provided us personal data, contact us and we will delete it.</p>
<h2>11. Changes to this policy</h2>
<p>We may update this policy. For material changes we will give notice in the app or on the website before the changes take effect, and update the date at the top. The Arabic and English versions are published together. Both communicate the same policy; where an interpretation must prevail under Egyptian law, the Arabic version prevails.</p>
<p><strong>Contact:</strong> support@orderak.app</p>','Owner details confirmed 2026-07-13; independent Egyptian legal review recommended','published',datetime('now')
FROM content_page_versions WHERE slug='privacy' AND lang='en';
UPDATE content_page_versions SET status='archived' WHERE slug='privacy' AND lang='ar' AND status='published';
INSERT INTO content_page_versions(slug,lang,version,title,body_html,notes,status,published_at)
SELECT 'privacy','ar',COALESCE(MAX(version),0)+1,'أوردرك — سياسة الخصوصية','<p><strong>آخر تحديث:</strong> 13 يوليو 2026 <strong>النطاق:</strong> تطبيق أوردرك، وموقع وصفحات المتاجر على <code>orderak.app</code>، وواجهة <code>api.orderak.app</code>.</p>
<h2>1. المسؤول عن البيانات</h2>
<p>يشغّل المنصة <strong>أيمن محمد عبد اللطيف</strong>، بصفته فردًا مقيمًا قانونًا في جمهورية مصر العربية ويعمل تحت اسم «أوردرك». للتواصل: <strong>support@orderak.app</strong>. تكون أوردرك متحكمًا في بيانات البائع، بينما يكون البائع متحكمًا في بيانات عملائه وتعالجها أوردرك نيابة عنه لتشغيل المتجر وتنفيذ الطلبات.</p>
<h2>2. البيانات التي نجمعها</h2>
<ul>
<li><strong>البائع:</strong> رقم الهاتف والتحقق بالـSMS، وبيانات المتجر والاتصال والدفع التي</li>
<p>يختار نشرها، والكتالوج والصور والمخزون والطلبات والعملاء والخطة والفوترة ورسائل الدعم.</p>
<li><strong>المشتري:</strong> الاسم ورقم الهاتف والمنتجات وطريقة الدفع والملاحظات أو عنوان</li>
<p>التوصيل الذي يقدمه، دون إنشاء حساب ودون جمع بيانات بطاقته أو حسابه المالي.</p>
<li><strong>تقنيًا:</strong> معرّفات الجهاز اللازمة لحماية الجلسة، وعنوان IP، ووكيل المستخدم،</li>
<p>ومسارات الطلبات وسجلات الأخطاء والأمان.</p>
</ul>
<p>لا نبيع البيانات الشخصية، ولا نستخدم بيانات المشترين للتسويق الخاص بأوردرك. لا يستخدم الموقع العام حاليًا ملفات تعريف ارتباط إعلانية أو تحليلية.</p>
<h2>3. أغراض المعالجة</h2>
<p>نستخدم البيانات لإنشاء الحساب والمتجر، والتحقق من الهوية، ومزامنة الكتالوج، ونقل الطلبات، وإدارة الخطط والفوترة، وإرسال الرسائل التشغيلية، وتقديم الدعم، ومكافحة الاحتيال وإساءة الاستخدام، وتحسين الخدمة بصورة مجمعة، والامتثال للالتزامات القانونية.</p>
<h2>4. الذكاء الاصطناعي</h2>
<p>عند استخدام المساعد الذكي، تُرسل الرسالة عبر خوادمنا إلى مزود الذكاء الاصطناعي الحالي <strong>DeepSeek</strong> لإنتاج الرد. لا تُدخل بيانات عملائك إلا عند الضرورة، ولا تُستخدم المحادثة لإنشاء ملف إعلاني.</p>
<h2>5. المشاركون في المعالجة</h2>
<ul>
<li><strong>Cloudflare</strong> للاستضافة وWorkers وD1 وR2 وKV والبريد الإلكتروني.</li>
<li><strong>Google Firebase</strong> للتحقق برقم الهاتف وإرسال وفحص رموز SMS.</li>
<li><strong>DeepSeek</strong> لمحتوى الرسائل عند استخدام المساعد فقط.</li>
<li>البائع الذي يتلقى بيانات المشتري اللازمة للطلب.</li>
</ul>
<p>قد نفصح عن بيانات إذا أوجب القانون أو أمر ملزم ذلك. بيانات المتجر والاتصال والدفع التي يختار البائع نشرها تكون عامة وقد تفهرسها محركات البحث.</p>
<h2>6. مكان المعالجة</h2>
<p>تعمل المنصة على شبكة Cloudflare العالمية، وقد تُعالج البيانات خارج مصر، بما في ذلك أوروبا والولايات المتحدة، مع الاعتماد على ضمانات المزودين والضمانات التي يتطلبها قانون حماية البيانات الشخصية المصري رقم 151 لسنة 2020.</p>
<h2>7. مدد الاحتفاظ</h2>
<ul>
<li>تُحفظ بيانات حساب البائع أثناء وجود الحساب، ثم تُحذف أو تُجهّل خلال مدة لا</li>
<p>تتجاوز <strong>90 يومًا</strong> من طلب حذف تم التحقق منه، إلا ما يلزم الاحتفاظ به للمحاسبة أو القانون أو منع الاحتيال أو نزاع قائم.</p>
<li>تُحفظ الطلبات أثناء نشاط الحساب بوصفها سجلات أعمال للبائع.</li>
<li>تُحذف السجلات التقنية التي قد تحتوي بيانات شخصية أو تُزال هويتها تلقائيًا</li>
<p>بعد مدة لا تتجاوز <strong>30 يومًا</strong>، إلا سجلًا معزولًا لتحقيق أمني نشط أو التزام قانوني محدد.</p>
</ul>
<h2>8. حقوقك وحذف الحساب</h2>
<p>لك الحق في الوصول والتصحيح والحذف والاعتراض أو التقييد وسحب الموافقة وتقديم شكوى إلى الجهة المختصة. تواصل عبر <strong>support@orderak.app</strong>.</p>
<p>لطلب حذف حساب بائع، افتح <strong>الإعدادات ← طلب حذف الحساب</strong> داخل التطبيق، أو زر <strong>https://orderak.app/delete-account</strong> بعد إزالة التطبيق، أو راسل الدعم. نتحقق من السيطرة على رقم الهاتف قبل التنفيذ. يشمل الحذف الحساب وصفحة المتجر والكتالوج وبيانات الاعتماد والبيانات الشخصية المرتبطة، مع الاستثناءات القانونية الموضحة أعلاه. إلغاء الاشتراك وحده لا يحذف الحساب ولا يسقط المبالغ المستحقة.</p>
<h2>9. الأمان والأطفال</h2>
<p>نستخدم HTTPS، وصلاحيات إدارية قائمة على الأدوار، وتحققًا ثنائيًا للإدارة، وبيانات اعتماد منفصلة للأجهزة. لا يوجد نظام آمن بالكامل، وسنخطر المتأثرين والجهات المختصة عند وجوب ذلك. المنصة أداة أعمال وليست موجهة للأطفال، ويجب أن يكون البائع بعمر 18 عامًا على الأقل.</p>
<h2>10. التغييرات واللغة</h2>
<p>نخطر المستخدمين بالتغييرات الجوهرية ونحدّث تاريخ السياسة. تصدر النسختان العربية والإنجليزية معًا؛ وعند لزوم ترجيح تفسير وفق القانون المصري تسود العربية.</p>
<p><strong>التواصل:</strong> support@orderak.app</p>','Owner details confirmed 2026-07-13; independent Egyptian legal review recommended','published',datetime('now')
FROM content_page_versions WHERE slug='privacy' AND lang='ar';
