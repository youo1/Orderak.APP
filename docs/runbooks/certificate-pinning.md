---
status: current
generated: false
owner: security
last_verified: 2026-09-12
applies_to: [production, staging]
---
# Certificate pinning runbook

> **Status:** Pin set computed from the live chains on 2026-09-12 and shipped in
> `apps/seller-android/app/src/main/res/xml/network_security_config.xml`.
>
> **Expires:** 2027-06-30. After that date Android ignores the pin set.

The seller app pins the TLS chain for `orderak.app` and its subdomains. This
runbook covers why, what breaks, and how to renew — because a pin set with no
renewal process is how an app bricks itself.

## Why the app pins at all

The seller credential is a long-lived device secret sent as `x-orderak-secret`
on every request, with no expiry and no rotation. One successful interception
yields indefinite account access. Pinning is the control that matches that
threat; nothing else in the transport does.

## What is pinned, and what is not

| Certificate | Pinned | Why |
| --- | --- | --- |
| Leaf `CN=orderak.app` | No | Rotates roughly every 90 days — pinning it means four outages a year |
| Intermediate `GTS WE1` | No | Cloudflare replaces intermediates without notice |
| **GTS Root R4** | **Yes** | Terminates the live chain for both `orderak.app` and `staging.orderak.app` |
| **GTS Root R1** | **Yes** | Backup pin, as RFC 7469 requires, so one rotation cannot lock everyone out |

## The risk, stated plainly

`orderak.app` is fronted by Cloudflare, and **Cloudflare chooses the CA**. It
uses Google Trust Services today and can move to Let's Encrypt or DigiCert
without telling anyone. If that happens while a pinned build is in the field,
every request from every installed app fails, and the only remedy is a Play
release — which users on low-end devices in Egypt may not take promptly.

Two things contain that risk, and both matter:

1. **`expiration="2027-06-30"`.** After that date Android ignores the pin set
   and falls back to normal CA validation. The failure mode is "pinning stops
   protecting", never "the app stops working". **Do not remove this attribute.**
2. **The drift check below**, which is what turns "someone should look at this"
   into a CI failure while there is still time to ship a release.

## Verify the current chain

```bash
echo | openssl s_client -connect orderak.app:443 -servername orderak.app -showcerts 2>/dev/null \
  | awk '/BEGIN CERT/,/END CERT/' \
  | csplit -z -f cert- -b '%02d.pem' - '/BEGIN CERT/' '{*}'

for f in cert-*.pem; do
  openssl x509 -in "$f" -noout -subject
  openssl x509 -in "$f" -pubkey -noout \
    | openssl pkey -pubin -outform der \
    | openssl dgst -sha256 -binary \
    | openssl enc -base64
done
```

Expected on 2026-09-12:

```text
subject=CN=orderak.app
subject=C=US, O=Google Trust Services, CN=WE1
  kIdp6NNEd8wsugYyyIYFsi1ylMCED3hZbSR8ZFsa/A4=
subject=C=US, O=Google Trust Services LLC, CN=GTS Root R4
  mEflZT5enoR1FuXLgYYGqnVEoZvmf9c2bVBpiOjYQ0c=
```

Repeat for `staging.orderak.app` and `api.orderak.app`. All three must terminate
at a root that is in the pin set.

## Renewal

Renew **well before** the expiration date, not after — a release takes time to
reach installed devices.

1. Run the verification above for every pinned host.
2. Confirm the chain still terminates at GTS Root R4 or R1. **If it does not,
   stop** — see "If Cloudflare changes CA" below.
3. Move `expiration` in `network_security_config.xml` forward (12 months is a
   reasonable step) and update `last_verified` here.
4. Ship a release. Verify on a physical device against production, not an
   emulator against staging.

## If Cloudflare changes CA

This is the emergency case.

1. **Do not ship a build pinned to the new CA alone.** Installed apps are pinned
   to the old one; a build that pins only the new root cannot help them and a
   build that pins only the old root stops working.
2. Ship a release whose pin set contains **both** the old and new roots. Devices
   on either chain keep working.
3. Once telemetry shows adoption, a later release may drop the old root.
4. If a pinned build is already failing in the field, the fastest mitigation is
   to ask Cloudflare to restore the previous CA while the release propagates.

## Related

- `apps/seller-android/app/src/main/res/xml/network_security_config.xml` — the
  pin set and the reasoning, kept next to the values.
- `tooling/repository/verify-certificate-pins.mjs` — the guard, in two parts:
  - **`.github/workflows/android-ci.yml`** runs it offline on every pull request
    and fails when the expiration has passed or is within 90 days, or when fewer
    than two pins are declared.
  - **`.github/workflows/infra-drift.yml`** runs it with `--live`, which connects
    to each pinned host and fails when no certificate in the presented chain
    matches the pin set — the Cloudflare-changed-CA case.

  The split is deliberate. The offline check belongs in the merge path because it
  is deterministic; the live check does not, because a check a developer can make
  pass by re-running it stops being a check. The live check never treats a
  connection failure as a pass: "could not reach the host" and "the host changed
  CA" must not produce the same green tick.
- [`secret-rotation.md`](secret-rotation.md) — the sibling process for Worker
  secrets.
