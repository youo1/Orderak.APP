---
status: current
generated: false
owner: product
applies_to: [production]
---
# Getting started with Orderak (pre-release)

> **Audience:** Seller-app testers
>
> **Status:** English pre-release guide verified against the repository on
> 2026-07-19. Orderak is not documented here as publicly available on Google
> Play. An approved Arabic user-guide version is required before launch.

Orderak helps a small seller create a public catalog, manage products, receive
customer orders, and track those orders from the Android app.

## Install and sign in

1. Install the approved test build using the release team's instructions.
2. Open Orderak and enter an Egyptian phone number.
3. Complete Firebase SMS verification. Test builds should use Firebase test
   phone numbers unless a production SMS test is explicitly planned.
4. Accept the displayed Terms and Privacy versions and record the separate
   marketing choice.
5. A new seller continues to shop setup. An existing seller restores the store
   allowed by the device plan.

Do not share an OTP or device secret with support or another person.

## Set up the store

The current setup flow collects store details and seller account details,
including:

- store name, business category, country, and city;
- seller name, optional email, birth year, and profile photo where shown.

After registration and sync, the backend assigns an immutable store code and a
public identifier such as `EG-my-store-7KX9MP4R`. The readable slug can be
edited later when available; the backend checks reserved and duplicate values.
Do not claim that the catalog is live until the first sync succeeds and a public
link opens correctly.

## Add and sync products

Open **Products** and use the add action. Enter the fields shown by the editor,
such as name, price, stock, category, description, availability, and image.
Prices are displayed in Egyptian pounds. The system stores them as a whole
number of piasters, so no fractions are lost.

Orderak keeps a local Room database and synchronizes with the backend in the
background (approximately every 15 minutes) and on demand. Changes are not
guaranteed to be visible immediately when the device is offline or a sync fails.
Verify the public page after important updates.

## Share the catalog

Use **Share catalog** on the Dashboard or Products screen. After a successful
registration/sync, the share sheet contains the public store link. Before that,
the app can fall back to sharing catalog text.

Customers can open the public page without installing the Android app. Category
and individual product links are also available after their public codes have
been synchronized.

## Receive and manage orders

A customer can select products on the public catalog and submit an order. The
seller app retrieves new orders during synchronization; push notifications are
not currently implemented, so do not promise an immediate phone notification.

The current seller status flow is:

`New → Confirmed → Paid → Shipped → Done`

An order can be cancelled only while it is New or Confirmed. The customer sees
an order number and payment/contact instructions after submission, but there is
no public live order-status tracking page in the current implementation.

## Payment handling

Orderak does not process customer payments. The public form can record Vodafone
Cash, InstaPay, Fawry, or cash on delivery as the selected method. The seller
must confirm and reconcile payment outside Orderak, then update the order.

Only publish contact or payout details that the seller is comfortable showing
to a customer after order submission. Paid Orderak plans and in-app upgrades are
disabled for the free launch.

## Change language

In **Settings → Language**, choose Arabic, English, French, or the device
setting. The app may recreate the current screen to apply the locale. Public
catalog language is separate: it currently follows the buyer's browser for
Arabic or English and falls back to the seller-authored product text when a
cached translation is unavailable.

## Free-launch limits

The backend's current Free defaults are up to 20 products, 5 categories, and 50
orders per month. Although configuration contains an AI-request limit, the AI
assistant is disabled and no seller screen exposes it. Starter and Professional
upgrade acquisition is also disabled; do not instruct testers to purchase a
plan.

## Account deletion and support

Use **Settings → Request account deletion** while signed in. The public
post-uninstall resource is `https://orderak.app/delete-account`. Request intake
exists, but production fulfillment is a documented release blocker and must be
handled under `docs/runbooks/account-deletion.md` until the workflow is fixed.

For test support, use `support@orderak.app` only if that mailbox has been
provisioned and assigned to a named responder; otherwise use the test channel
provided by the release team.
