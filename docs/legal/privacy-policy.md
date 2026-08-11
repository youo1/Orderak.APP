# Orderak — Privacy Policy

**Last updated:** 29 July 2026
**Applies to:** the Orderak Android app, the public store pages and website at `orderak.app`, and the Orderak API at `api.orderak.app` (together, the "Platform").

> Operator details and retention choices confirmed by the owner on 13 July 2026;
> authentication and onboarding disclosures updated at the owner's direction on
> 26, 28, and 29 July 2026.
> Independent legal review by a lawyer qualified in Egypt remains recommended
> before a public launch.

---

## 1. Who is responsible for your data

The Platform is operated by **Ayman Mohamed Abdellatif**, an individual legally
based in the Arab Republic of Egypt and trading under the name “Orderak”
("Orderak", "we", "us"), contactable at **support@orderak.app**.

Two situations to distinguish:

- **Sellers** (merchants using the Orderak app): Orderak decides how and why your data is processed — we are the **controller** of your data.
- **Buyers** (customers ordering through a seller's store page): your order data is collected **for the seller**. The seller is responsible for how they use it; Orderak processes it on the seller's behalf to run the store and deliver the order to the seller's app.

## 2. What data we collect

### From Sellers

| Data | Examples | Why |
| --- | --- | --- |
| Account | Full name, year of birth, mobile phone number, one-time SMS verification, and optional private email | Sign-in, private account identity/profile, invoices, and account notices. Year of birth and private email are not published on your store; the private email is not an account-recovery method in this version |
| Passkeys | Credential public key, internal credential identifier, counter, authenticator metadata, backup state, label, and use/revocation timestamps | Optional passwordless sign-in and account security. Orderak never receives your fingerprint, face image, or biometric template |
| Store profile | Store name, category, city/country, store link (slug), description, address, logo and cover images | Creating and displaying your public store |
| Contact & payout details | WhatsApp number, InstaPay address, Vodafone Cash number, email, website | Shown on your store page so buyers can contact and pay **you** — Orderak never holds the funds |
| Catalog | Products, prices, stock, product images | Your catalog in the app and on your public store |
| Orders & customers | Orders received, buyer contact details, order history | Order management inside your app |
| Billing | Subscription plan, payment events, coupons, referral/affiliate activity | Managing your plan and its limits |
| Support & email | Messages you send to support, transactional emails | Helping you and notifying you |
| Technical | Device identifiers used to secure your session, IP address, request logs | Security, fraud prevention, debugging |

### From Buyers

When you place an order on a store page we collect, **on behalf of that seller**: your **name, phone number, the items ordered, your chosen payment method, and any note you add** (which may include a delivery address). We do not require a Buyer account and do not collect Buyer payment credentials — payment happens directly between you and the seller.

### From all visitors

Standard technical logs (IP address, user agent, pages requested) needed to serve pages, keep the Platform secure, and prevent abuse. The public website does not use advertising or analytics cookies. This policy must be updated before analytics or advertising cookies are introduced.

## 3. What we use data for

- Providing the Platform: accounts, store pages, catalog sync, order relay, notifications.
- Verifying your identity at sign-in (SMS one-time codes or an optional Passkey).
- Verifying an optional private email for invoices and account notices. Email is
  not used to recover the account in this version.
- Maintaining the private account profile, including the required year of
  birth. Birth year is not included in public store/contact data, transactional
  email variables, or telemetry.
- Managing subscriptions, plan limits, coupons, and referrals.
- Sending transactional messages (e.g. sign-in codes, service or billing notices) and responding to support requests.
- Security: preventing fraud, abuse, and unauthorized access; keeping audit logs.
- Improving the Platform (aggregate, non-identifying usage patterns).
- Complying with legal obligations.

We do **not** sell personal data, and we do not use Buyer contact details for our own marketing.

## 4. AI assistant

If an AI assistant is made available to you and you use it, the messages you type are sent through our backend to an AI provider (currently **DeepSeek**) to generate the answer. Do not include personal data about your customers in AI chats unless necessary. AI conversations are used to provide the answer, not to build advertising profiles.

## 5. Who we share data with

We share data only with service providers who process it for us, under their own contractual and legal obligations:

| Provider | Purpose | Data involved |
| --- | --- | --- |
| **Cloudflare** (Workers, D1, R2, KV) | Hosting the backend, database, images, and sessions | All Platform data |
| **Google Firebase** | Phone-number sign-in (sending and checking SMS codes) | Seller phone numbers |
| **Your Android credential provider** | Creating, storing, synchronizing where enabled, and presenting an optional Passkey | The provider retains the private credential; Orderak receives only the public-key response and credential metadata, never biometric data |
| **GeoNames** | City suggestion data imported into Orderak | No seller data is sent to GeoNames; city results are provided under CC BY attribution |
| **DeepSeek** | AI assistant responses (only when you use the assistant) | Content of your AI chat messages |
| **Cloudflare Email Service and Email Routing** | Transactional and support email | Email addresses and message content |

We may also disclose data if required by law or a binding order of a competent authority, or as part of a business transfer (in which case this policy continues to apply).

**Sellers see Buyer data:** if you place an order, the seller receives your name, phone number, note, and order details — that is the point of the order. The seller is responsible for using it lawfully.

**Public by design:** a seller's store name, catalog, and the contact/payment details the seller chooses to add (e.g. WhatsApp, InstaPay) are published on their public store page, which anyone with the link can view and search engines may index.

## 6. Where data is stored

The Platform runs on Cloudflare's global network, so data may be stored and processed in data centers **outside Egypt** (including in Europe and the United States). We rely on our providers' safeguards and contractual commitments for these transfers, and apply the safeguards required by applicable law, including the PDPL's rules on cross-border transfer.

## 7. How long we keep data

- **Seller account data**: for as long as the account exists, then deleted or anonymized within **90 days** of a verified account-deletion request, except where we must keep records longer (e.g. billing records for tax/accounting purposes).
- **Onboarding and security tokens**: onboarding access expires after 30 minutes
  of inactivity and no later than 24 hours; Passkey challenges after 5 minutes;
  recent-authentication proofs after 10 minutes; and email verification links
  after 24 hours. We keep only hashes of these bearer tokens/challenges and
  remove expired records on a short operational cleanup schedule.
- **Passkeys**: retained until you revoke them or delete the account; revoked
  entries are also removed on account deletion.
- **Orders**: kept while the seller's account is active, since they are the seller's business records.
- **Technical logs**: deleted or de-identified automatically after no more than **30 days**, unless specific records must be isolated for an active security investigation or legal obligation.

## 8. Your rights

Under the PDPL (and similar laws elsewhere) you have the right to:

- **access** the personal data we hold about you and get a copy;
- **correct** inaccurate data;
- **delete** your data (see account deletion below);
- **object to or restrict** certain processing;
- **withdraw consent** where processing is based on consent;
- **complain** to the competent data protection authority (in Egypt, the Personal Data Protection Centre).

To exercise any of these, contact **support@orderak.app** from the phone number or email linked to your account. We answer within the time required by law.

**Buyers:** because sellers control their customer data, requests about an order you placed can be sent either to the seller or to us — if you contact us, we will delete or correct the data in our systems and notify the seller where required.

### Account deletion (Sellers)

In the app, open **Settings → Request account deletion**. This opens the public
request resource at **https://orderak.app/delete-account**, which is also
available after uninstalling the app. You may alternatively email
**support@orderak.app**. We verify control of the account's phone number before
fulfilment. A verified request is completed within 90 days and removes or
anonymizes the store page, catalog, Passkeys, private account profile, other
account credentials, and associated personal
data, except records retained for a stated legal, accounting, fraud-prevention,
or dispute-resolution obligation. Cancelling a paid subscription does not by
itself delete the account, and account deletion does not automatically settle
amounts already due.

## 9. Security

Data is encrypted in transit (HTTPS everywhere). Backend access is restricted
and authenticated; admin access uses role-based permissions with two-factor
authentication. App sessions are protected by a per-device secret. Optional
Passkeys require local user verification through your credential provider;
Orderak validates a public-key signature and does not collect biometric data.
No system is perfectly secure — if a breach affects your data, we will notify
you and the authorities as required by law.

## 10. Children

The Platform is a business tool and is not directed at children. Sellers must be at least 18. We do not knowingly collect children's data; if you believe a child has provided us personal data, contact us and we will delete it.

## 11. Changes to this policy

We may update this policy. For material changes we will give notice in the app or on the website before the changes take effect, and update the date at the top. The Arabic and English versions are published together. Both communicate the same policy; where an interpretation must prevail under Egyptian law, the Arabic version prevails.

### Static city suggestions

During store setup, Orderak uses the country inferred from the verified phone
number to search a pinned copy of the public Countries States Cities Database
stored in Orderak's isolated city database. Search text and result lists are
transient and are not retained. After selection, we keep the source city ID,
dataset version, and city name with the store. Manual city entry is available.
The source database is provided under ODbL-1.0 and is attributed in the app.

**Contact:** support@orderak.app
