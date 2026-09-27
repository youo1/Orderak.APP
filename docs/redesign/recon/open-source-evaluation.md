# Open-Source Evaluation — Orderak Redesign Recon

**Date:** 2026-09-26
**Scope:** open-source tools, libraries, frameworks and design systems that could replace custom code or accelerate a full redesign of the Orderak admin panel, design system, Android client, backend and ops stack.
**Author:** research agent (recon pass, no repository modifications except this file)

---

> **Citations and the fix rounds.** Every `file:line` in this report was taken in
> a read-only pass, before any change was made. The fixes that followed edited
> those same files, so line numbers have shifted and some rows now describe code
> that has moved or gone. Treat the **Verification pass** section below as the
> authoritative record of what was still true when it was acted on, and the
> source itself as the truth about where anything is now. The file paths remain
> correct throughout.

## 0. How to read this document

### 0.1 Verdict definitions

| Verdict | Meaning |
|---|---|
| **ADOPT** | Clear net win for Orderak at current scale. Start using it in the redesign. |
| **EVALUATE** | Plausible win, but depends on a decision Orderak has not made yet (scale, designer workflow, OS roadmap). Run a time-boxed spike. |
| **AVOID** | Actively harmful here — duplicate design system, Cloudflare-incompatible architecture, license trap, or abandoned. |

### 0.2 License markers

- Plain license name = permissive and unambiguous for a commercial closed-source Egyptian product (MIT, Apache-2.0, BSD-3-Clause, ISC, MPL-2.0 as a *tool*, SIL OFL-1.1 for fonts).
- **`°`** = I could not open the raw `LICENSE` file in this session (direct HTTP from the sandbox was blocked — `curl` exit 35 / TLS failure). The license is attributed to the project's own license page or repository, and **must be confirmed at `<repo>/LICENSE` before adoption**. Nothing in this document is a legal opinion.
- 🔴 = copyleft or source-available license that materially matters for a closed-source commercial product.
- 🟠 = permissive core with a paid/enterprise tier — check that the feature you need is in the free tier.

### 0.3 Known limitations of this pass

- No network fetches of `LICENSE` files, GitHub release APIs, or npm registries were possible from the sandbox. All version numbers below were surfaced through web search results and are cited; treat exact "latest version" as *best known at 2026-09-26*, not authoritative.
- Activity claims are based on public signals (release pages, changelogs, issue traffic). Where I could not confirm archival/deprecation, I say so explicitly rather than guessing.

---

## 1. Where Orderak already stands (measured, not assumed)

This matters because roughly half the "candidates" in a generic OSS survey are things Orderak either already runs or has deliberately rejected.

**`apps/admin-web/package.json`** (read in this pass):

- React `19.2.8`, Vite `8.2.2`, TypeScript `~6.0.2`, Tailwind CSS `4.3.3`
- Radix primitives: `@radix-ui/react-dialog 1.1.23`, `select 2.3.7`, `slider 1.4.7`, `switch 1.3.7`, `tabs 1.1.21`
- `@tanstack/react-query 5.102.3`, `react-router-dom 7.18.2`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`
- `@material/material-color-utilities 0.3.0` (the runtime theme engine), `@sentry/react ^10.71.0`
- No form library, no table library, no chart library, no component system — components are hand-rolled
- Deploys via `wrangler deploy --config wrangler.edge.jsonc` → Cloudflare Workers Static Assets

**`services/backend/package.json`** (read in this pass):

- `hono ^4.13.7`, `@hono/zod-openapi ^1.6.1`, `zod ^4.4.3`
- `@sentry/cloudflare ^10.71.0`, `jose`, `@simplewebauthn/server`, `libphonenumber-js ^1.13.11`, `postal-mime`
- `@material/material-color-utilities 0.3.0`, `fontkit` (font subsetting), `@fontsource-variable/cairo`, `@fontsource-variable/noto-sans-arabic`, `@fontsource/tajawal`
- No ORM: raw D1 SQL, with bespoke guards (`verify:d1-bounds`, `verify:migrations`, `verify:drift`)

**`apps/seller-android/gradle/libs.versions.toml`** (read in this pass):

- Compose BOM `2026.08.00`, `androidx.compose.material3` + `material3-window-size-class`, `navigation-compose`, Coil 3, Hilt
- `com.android.compose.screenshot` (Compose Preview Screenshot Testing) `0.0.1-alpha16` + `screenshot-validation-api`
- `app/build.gradle.kts` actively asserts `dynamicColorEnabled = false` — the custom token pipeline deliberately overrides Android 12+ dynamic color

**Governance already in place:** `openapi:check`, `openapi:bundle`, `verify:dto-parity`, `verify:contract-guards`, `verify:error-codes`, `verify:doc-links`, `verify:built-site`, `verify:deployment-map`, `verify:d1-bounds`, markdownlint-cli2, Playwright e2e, vitest, oxlint, `.schemathesis/`, MkDocs Material in `strict: true`.

**Practical consequence:** Orderak is *not* looking for a framework to build an admin panel from scratch. It already has a working, bespoke, well-governed one. The real opportunity is **component reuse, token unification, and deleting duplicated glue**, not wholesale replacement.

---

## 2. Category 1 — Admin panel foundations

### 2.1 Comparison table

| Candidate | URL | License | Activity / latest seen | Replaces in Orderak | Integration risk | Verdict |
|---|---|---|---|---|---|---|
| **shadcn/ui** | [ui.shadcn.com](https://ui.shadcn.com) · [repo](https://github.com/shadcn-ui/ui) | MIT | Active; 2026 direction is private registries + Base UI support ([write-up](https://www.codewithseb.com/blog/shadcn-registry-private-design-system-guide)) | Hand-rolled component library (buttons, dialogs, tables, forms, command palette, toasts) | **Low** — repo already has Radix + Tailwind 4 + cva + clsx + tailwind-merge | **ADOPT** |
| **TanStack Table** | [tanstack.com/table](https://tanstack.com/table) · [repo](https://github.com/TanStack/table) | MIT | Very active; **V9 announced** ([blog](https://tanstack.com/blog/announcing-tanstack-table-v9)) | Hand-rolled admin list/table state (sort/filter/page/select) | Low (headless, no CSS opinion) | **ADOPT** (v8 now, v9 after it settles) |
| **react-hook-form + zod** | [react-hook-form.com](https://react-hook-form.com) · [repo](https://github.com/react-hook-form/react-hook-form) | MIT | Very active | Bespoke form state/validation in admin-web | Low — Zod 4 already a backend dep | **ADOPT** |
| **refine** | [refine.dev](https://refine.dev) · [repo](https://github.com/refinedev/refine) | MIT ([LICENSE](https://app.unpkg.com/@refinedev/core@5.0.5/files/LICENSE)) | Active (`@refinedev/core@5.0.8`) | Admin scaffolding: resources, CRUD, RBAC hooks, audit log, devtools | **Medium** — introduces a second router/data-layer abstraction over react-router 7 + TanStack Query | **EVALUATE** |
| **React Admin** | [marmelab.com/react-admin](https://marmelab.com/react-admin/) · [repo](https://github.com/marmelab/react-admin) | MIT ([LICENSE.md](https://app.unpkg.com/react-admin@5.14.6/files/LICENSE.md)) | Active (v5.15.0 tag) | Whole admin app shell | **High** — MUI/Emotion-based; would fight the tokenized design system and Tailwind 4 | **AVOID** |
| **AdminJS** | [adminjs.co](https://adminjs.co) · [repo](https://github.com/SoftwareBrothers/adminjs) | MIT° | Declining interest; schema-introspection model tied to Node ORMs ([LF insights](https://insights.linuxfoundation.org/project/softwarebrothers-adminjs)) | Auto-generated CRUD admin | **High** — requires Node server + an ORM it can introspect; Orderak has neither | **AVOID** |
| **Directus** | [directus.io](https://directus.io) · [repo](https://github.com/directus/directus) | 🔴 BSL 1.1 historically, **changed again in v12** ([license change post](https://directus.com/resources/directus-v12-license-change), [BSL overview](https://directus.io/bsl)) | v12.0.0 released 2026-06-10; **v12 adds active license enforcement** ([report](https://devbytes.co.in/news/directus-v12-introduces-active-license-enforcement)) | Admin + content + data layer | **High** — license risk + needs Node + its own DB; violates Workers-only | **AVOID** |
| **Appsmith** | [appsmith.com](https://www.appsmith.com) · [repo](https://github.com/appsmithorg/appsmith) | Apache-2.0° | Active commercial OSS | Internal tool builder | **High** — self-host needs Node + MongoDB; not static | **AVOID** |
| **ToolJet** | [tooljet.com](https://www.tooljet.com) · [repo](https://github.com/ToolJet/ToolJet) | 🔴 AGPL-3.0° ([repo note](https://github.com/code/app-tooljet-agpl)) | Active | Internal tool builder | **High** — AGPL + Node + Postgres | **AVOID** |
| **Baserow** | [baserow.io](https://baserow.io) · [repo](https://github.com/baserow/baserow) | 🟠 MIT core ([OSS release post](https://baserow.io/blog/open-source-release-of-baserow)) + paid premium | Active | Database/Airtable-style backend | **High** — Postgres + Python service; duplicate data authority | **AVOID** |
| **NocoDB** | [nocodb.com](https://nocodb.com) · [repo](https://github.com/nocodb/nocodb) | 🔴 **changed to non-free** ([license doc](https://nocodb.com/docs/self-hosting/license), [awesome-selfhosted issue](https://github.com/awesome-selfhosted/awesome-selfhosted-data/issues/1935)) | Active | Spreadsheet-database hybrid | **High** — license change + Node + DB | **AVOID** |
| **Payload CMS** | [payloadcms.com](https://payloadcms.com) · [repo](https://github.com/payloadcms/payload) | MIT ([LICENSE.md](https://raw.githubusercontent.com/payloadcms/payload/refs/heads/main/LICENSE.md)) | Active (v3.x) | Content model + admin | **Medium-High** — v3 runs inside Next.js → needs a Node-ish runtime; Orderak has no CMS need | **AVOID** |
| **Mantine** | [mantine.dev](https://mantine.dev) · [repo](https://github.com/mantinedev/mantine) | MIT | Active — **v9.0.0** ([changelog](https://mantine.dev/changelog/9-0-0/)) | Full component + theming system | **High** — replaces the design system with Mantine's own theme object | **AVOID** |
| **Ant Design** | [ant.design](https://ant.design) · [repo](https://github.com/ant-design/ant-design) | MIT° | Active | Enterprise-dense admin components | **High** — second token system, heavy, distinctive look | **AVOID** |
| **MUI** | [mui.com](https://mui.com) · [repo](https://github.com/mui/material-ui) | 🟠 MIT core + MUI X Pro/Premium paid; **v9 released** ([blog](https://mui.com/blog/introducing-mui-v9/)) | Active | Component system + data grid | **High** — Emotion runtime CSS + own theming; conflicts with Tailwind 4 | **AVOID** |
| **Base UI** | [base-ui.com](https://base-ui.com) · [repo](https://github.com/mui/base-ui) | MIT | Active, 1.x era — "From the creators of Radix, Floating UI, and Material UI" ([repo](https://github.com/mui/base-ui)) | Radix primitives (long-term successor) | Medium — newer, smaller ecosystem | **EVALUATE** |
| **Radix UI** | [radix-ui.com](https://www.radix-ui.com) · [repo](https://github.com/radix-ui/primitives) | MIT | Stable / slowing as team focus shifts to Base UI | Already adopted (5 primitives) | n/a | **KEEP**, monitor |
| **Park UI** | [park-ui.com](https://park-ui.com) | MIT° | Active | Component library | **High** — built on Panda CSS, not Tailwind | **AVOID** |
| **Recharts** (+ shadcn charts) | [recharts.org](https://recharts.org) · [repo](https://github.com/recharts/recharts) | MIT | Active (v3 line) | No chart code exists yet | Low | **ADOPT** |
| **Apache ECharts** | [echarts.apache.org](https://echarts.apache.org/en/download.html) · [repo](https://github.com/apache/echarts) | Apache-2.0 | Active | Heavy analytics dashboards | Medium (canvas, imperative API) | **EVALUATE** |
| **Tremor** | [repo](https://github.com/tremorlabs/tremor) | MIT° | ⚠ **Acquired by Vercel** ([announcement](https://vercel.com/blog/vercel-acquires-tremor)) | Dashboard blocks | Medium — roadmap ownership changed | **AVOID** (use Recharts directly) |
| **visx** | [repo](https://github.com/airbnb/visx) | MIT° | Low-cadence Airbnb project | Low-level chart primitives | Medium | **EVALUATE** |
| **AG Grid Community** | [ag-grid.com](https://www.ag-grid.com) · [repo](https://github.com/ag-grid/ag-grid) | 🟠 MIT Community (`ag-grid-community@34.1.0`) + paid Enterprise | Very active | High-row-count admin grids | **Medium-High** — its Theming API is a parallel token system; enterprise features are paid | **EVALUATE** |
| **TanStack Query** | [tanstack.com/query](https://tanstack.com/query) | MIT | Very active (`5.102.3` in repo) | Already adopted | n/a | **KEEP** |

### 2.2 The decisive insight for this category

`apps/admin-web/package.json` already contains **every ingredient of the shadcn/ui stack except the components**: Radix primitives, Tailwind 4, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`. That is not a coincidence — it is the shadcn/ui dependency footprint.

So the highest-value move is not "choose an admin framework". It is:

1. Add shadcn/ui components **as source files** (they are copy-in, not a dependency) for the boring 70%: dialog, sheet, dropdown, popover, tooltip, table, form, toast, command palette, calendar, tabs, badge, skeleton.
2. Add **TanStack Table** for the admin list surfaces that need sort/filter/column-visibility/pagination.
3. Add **react-hook-form + `@hookform/resolvers` + Zod 4** so admin forms validate against the *same Zod schemas the backend already uses*.
4. Add **Recharts** (or shadcn's Recharts-based chart wrapper) for the admin dashboard.

That combination replaces hand-rolled code without introducing a second design language, a second token system, a Node runtime, or a copyleft license.

### 2.3 Why the "full admin framework" candidates all fail here

refine, React Admin, Directus, AdminJS, Payload and the low-code builders (Appsmith/ToolJet/Baserow/NocoDB) all share the same two disqualifiers for Orderak:

- **Architecture:** every one of them wants a Node server process and/or its own database. Orderak's governance explicitly says the Cloudflare Worker is data authority (`ADR-007`, `contracts/`, `verify:deployment-map`). Standing up a parallel Node + Postgres stack next to D1 creates a second source of truth for merchant, order and entitlement data — the single most expensive mistake available in this redesign.
- **Design system:** Orderak's differentiator is a *runtime, backend-generated* tokenized theme (color seeds, scheme variants, contrast levels) rendered identically on Android and web via `@material/material-color-utilities`. MUI, Ant Design, Mantine and AG Grid each ship their own theme model. Adopting one means maintaining two theme sources and reconciling them forever.

**Be skeptical of "just use refine":** refine is genuinely good and MIT-licensed. But Orderak's admin already has routing (react-router 7), data fetching (TanStack Query 5), and handwritten CRUD. refine's value is in greenfield projects where you would otherwise write that plumbing. Here it would be a migration *and* an abstraction layer — directly against the repository rule "keep code beginner-friendly and avoid unnecessary abstraction".

**Where building it yourself genuinely wins:** the low-code builder category, entirely. A status page, an internal ops dashboard, or a 3-table CRUD screen on top of an existing OpenAPI + D1 is a few hundred lines for Orderak. Self-hosting Appsmith/ToolJet to avoid writing 300 lines is a net loss (extra runtime, extra DB, extra attack surface, extra license review).

---

## 3. Category 2 — Design tokens and cross-platform design systems

### 3.1 Comparison table

| Candidate | URL | License | Activity / latest seen | Replaces in Orderak | Integration risk | Verdict |
|---|---|---|---|---|---|---|
| **Style Dictionary** | [styledictionary.com](https://styledictionary.com) · [repo](https://github.com/style-dictionary/style-dictionary) | Apache-2.0 | Active; **v5** era; project moved from `amzn/` to its own org; **has a built-in Jetpack Compose format** ([commit](https://github.com/amzn/style-dictionary/commit/8a53858dc35f4b4565abe9a6500c78814e3e6eae)) | The *structural* half of the bespoke token pipeline (spacing, radius, type scale, motion, elevation) → Compose + Android XML + CSS vars + Tailwind theme | **Medium** — new build step; must not duplicate the runtime theme engine | **ADOPT** |
| **`@material/material-color-utilities`** | [repo](https://github.com/material-foundation/material-color-utilities) | Apache-2.0 | Stable, used on both sides already (`0.3.0`) | Dynamic color seeds → tonal palettes → schemes | n/a | **KEEP** (single source of truth for color) |
| **Material Theme Builder** | [Figma plugin](https://www.figma.com/community/plugin/1034969338659738588/material-theme-builder) · [source](https://github.com/material-foundation/material-theme-builder) | Apache-2.0 | Active | Designer-facing scheme generation / preview | Low — it is a designer tool, not a code path | **EVALUATE** |
| **Radix Colors** | [radix-ui.com/colors](https://www.radix-ui.com/colors) · [repo](https://github.com/radix-ui/colors) | MIT | Stable | Accessible 12-step scales for **admin/static** surfaces + dark mode | **Medium** — introduces a *second* color model alongside MCU-generated schemes | **EVALUATE** |
| **Terrazzo** | [terrazzo.app](https://terrazzo.app/docs/reference/about/) | MIT° | Active but small | DTCG token transform (Style Dictionary alternative) | Medium — no built-in Compose target; you write the plugin | **EVALUATE** |
| **Tokens Studio** | [tokens.studio](https://tokens.studio) · [Pro licence](https://docs.tokens.studio/get-started/pro-licence) | 🔴 proprietary plugin; **Pro features paid** | Active | Figma↔code token sync | Medium — paid tier, vendor dependency, Figma Variables now overlap | **EVALUATE** |
| **Penpot** | [penpot.app](https://penpot.app) · [repo](https://github.com/penpot/penpot) | MPL-2.0° (file-level copyleft; **safe as a tool**) | Active (3.x) | Figma (per-seat cost) | High *organisationally*, low technically | **EVALUATE** |
| **Open Props** | [open-props.style](https://open-props.style) · [repo](https://github.com/argyleink/open-props) | MIT ([LICENSE](https://app.unpkg.com/open-props@1.7.16/files/LICENSE)) | Stable | Shadow/easing/typography primitives | Medium — opinionated palette conflicts with brand theme | **EVALUATE** (reference only) |
| **shadcn/ui theming** | [ui.shadcn.com/docs/theming](https://ui.shadcn.com/docs/theming) | MIT | Active | The **web half of the shared token contract** | Low | **ADOPT** |

### 3.2 The real target architecture

Orderak's current pipeline is unusual and valuable: the backend owns a "Theme Builder" that emits color seeds, scheme variants and contrast levels, and both clients render from it at runtime using `material-color-utilities`. Nothing off-the-shelf does *that*. Style Dictionary is a **build-time** tool and will not replace it.

The correct split, and the single most important recommendation in this section:

| Token class | Source of truth | Emitted to |
|---|---|---|
| **Dynamic color** (seeds, scheme variants, contrast levels) | Existing backend Theme Builder + `material-color-utilities` (runtime) | Compose `ColorScheme` at runtime; CSS custom properties at runtime |
| **Static/structural tokens** (spacing, radius, type scale, line heights, motion durations, elevation, breakpoints, z-index) | **New DTCG token file(s)** → Style Dictionary | `compose/object` Kotlin, `android/resources` XML, CSS custom properties, Tailwind `@theme`, and a JSON artifact the Theme Builder can validate against |

This gives one *contract* (a DTCG JSON file plus a generated artifact checked in CI) covering both platforms, while preserving runtime theming. It also slots cleanly into the existing governance style: add a `design-system:tokens:check` guard next to `design-system:check` and `verify:dto-parity`.

**Can shadcn/ui theming be driven by the same tokens?** Yes. shadcn/ui themes are plain CSS custom properties on `:root`/`.dark` (today typically `oklch` values: `--background`, `--foreground`, `--primary`, `--card`, `--border`, `--ring`, `--radius`, etc.). The Theme Builder can emit exactly that variable set from the same MCU-derived scheme it already computes for Android. The practical rule: **make the web theme contract a generated artifact of the backend theme payload — never a hand-edited CSS file.**

### 3.3 Concrete traps

- **Radix Colors vs MCU tonal palettes.** Radix Colors' 12-step model is superb for contrast correctness, but it is not the Material 3 tonal-palette model. If admin uses Radix Colors while Android uses MCU schemes, a merchant's brand seed will look materially different in the admin panel than in the app. If you adopt it, adopt it *only* for neutral/semantic admin chrome (borders, surfaces, danger/warning) and keep brand color on MCU everywhere.
- **Open Props is a design opinion, not a token system.** Its palette would compete with the brand theme. Use it as a *reference* for shadows/easings and copy the values you like into the token file.
- **Tokens Studio's useful features are paid** ([Pro licence](https://docs.tokens.studio/get-started/pro-licence)), and Figma Variables now natively cover much of what it did. For a small team without a dedicated design-ops person, adding a paid proprietary plugin plus a sync pipeline is process overhead, not acceleration.
- **Penpot is a cost/infrastructure lever, not a code lever.** `MPL-2.0` is file-level copyleft: modifying Penpot's own files obliges you to publish *those files*, not your application. Self-hosting removes Figma seat costs, which matters for a small Egyptian team. But `AGENTS.md` names Figma for app screens and Canva for marketing — that is an organisational change with designer-retraining cost, so schedule it as a separate decision.
- **Do not let Style Dictionary become a second theme engine.** If both Style Dictionary output and the runtime Theme Builder can produce a `ColorScheme`, you have created a drift bug generator. Enforce: SD never emits *color roles*; MCU always does.

---

## 4. Category 3 — Android / Compose UI kits and accelerators

### 4.1 Comparison table

| Candidate | URL | License | Activity / latest seen | Replaces in Orderak | Integration risk | Verdict |
|---|---|---|---|---|---|---|
| **Material 3 Expressive** (in `androidx.compose.material3`) | [docs](https://developer.android.com/jetpack/androidx/releases/compose-material3) | Apache-2.0 | Shipping; `Material3ExpressiveApi` present in the current BOM line | Bespoke motion/shape/typography and some component behaviour | Low — already inside Compose BOM `2026.08.00` | **ADOPT (selectively)** |
| **MaterialKolor** | [repo](https://github.com/jordond/MaterialKolor) | Apache-2.0 | Active (**5.0.0** release line seen) | Custom Compose-side scheme assembly from backend seeds | Low-Medium | **ADOPT** |
| **compose-material3-adaptive** | [docs](https://developer.android.com/jetpack/androidx/releases/compose-material3-adaptive) | Apache-2.0 | Active (1.0.x line) | Bespoke adaptive layout + custom navigation host scaffolding | Low | **ADOPT** |
| **Compose Preview Screenshot Testing** | [docs](https://developer.android.com/studio/preview/compose-screenshot-testing) | Apache-2.0 (AGP plugin) | **Already adopted** at `0.0.1-alpha16`; docs state AGP 9.0+ | Existing screenshot-test governance | Medium — alpha, AGP-coupled | **KEEP** (pin + escape hatch) |
| **Roborazzi** | [repo](https://github.com/takahirom/roborazzi) | Apache-2.0 | Very active (1.7x line seen) | JVM screenshot verification without emulator; backup for the alpha AGP plugin | Low | **ADOPT** (as insurance + richer CI matrix) |
| **Paparazzi** | [repo](https://github.com/cashapp/paparazzi) | Apache-2.0 | Maintained, slower cadence | JVM screenshot testing | Medium — overlaps Roborazzi | **EVALUATE** |
| **Showkase** | [repo](https://github.com/airbnb/Showkase) | Apache-2.0° | ⚠ **Declining** — open issues on `compileSdk` deprecations ([#346](https://github.com/airbnb/Showkase/issues/346)); no archival notice confirmed in this pass | In-repo component browser | High — annotation processor with stale toolchain support | **AVOID** |
| **Navigation 3** | [docs](https://developer.android.com/guide/navigation/navigation-3) | Apache-2.0 | Pre-1.0 in 2026, moving fast | The custom navigation graph | High — API churn; but it is the strategic successor | **EVALUATE** |
| **Compose Multiplatform** | [JetBrains](https://www.jetbrains.com/lp/compose-multiplatform/) · [repo](https://github.com/JetBrains/compose-multiplatform) | Apache-2.0 | Active, stable for iOS | Future iOS/desktop clients sharing the component library | High now, cheap if the component module stays Android-free | **EVALUATE** (architecture decision) |
| **Vico** (charts) | [repo](https://github.com/patrykandpatrick/vico) | MIT° | Active | In-app charts (if the seller app ever needs them) | Low | **EVALUATE** |
| **`material-color-utilities`** | [repo](https://github.com/material-foundation/material-color-utilities) | Apache-2.0 | Stable | Color science | n/a | **KEEP** |
| **Material adaptive / WindowSizeClass** | [docs](https://developer.android.com/develop/ui/compose/layouts/adaptive) | Apache-2.0 | Active | Manual size-class handling | Low | **KEEP/ADOPT** |

### 4.2 What each one would actually replace

The bespoke pipeline has three distinct pieces; conflating them leads to buying the wrong tool:

1. **Color science** (seeds → tonal palettes → schemes with variants and contrast levels).
   → Keep `material-color-utilities` as the single implementation. **MaterialKolor is not a replacement for the backend Theme Builder**; it is the canonical *Compose-side* way to turn a seed+spec into a `ColorScheme`, which is exactly what the current custom code does. Adopting it deletes custom scheme-assembly code and gives you previews, golden fixtures and a well-tested spec implementation for free. Crucially, the *backend* remains authoritative — the app should still consume the server's theme payload, with MaterialKolor used for local previews, screenshot fixtures and offline fallbacks.

2. **Structural design tokens** (spacing, radius, type, motion).
   → Style Dictionary output (Section 3), **not** a Compose library. No Compose "design system library" fixes a missing token contract.

3. **Component library and navigation.**
   → `compose-material3-adaptive` for scaffolds/size classes; **Material 3 Expressive** for motion/shape components you would otherwise hand-build (shape morphing, button groups, FAB menus, loading indicators). Both are already inside Compose BOM `2026.08.00`, so the marginal cost is design review, not a dependency.
   → Navigation 3 is the interesting strategic bet for the "custom navigation graph", but it is pre-1.0 in 2026. Do not couple the redesign to it.

### 4.3 Screenshot-testing risk you should notice now

Orderak depends on `com.android.compose.screenshot` at **`0.0.1-alpha16`** — an alpha artifact coupled to AGP versions. This is a single point of failure for the entire "screenshot tests" governance pillar. **Roborazzi is the cheap insurance:** it runs on the JVM (Robolectric), needs no emulator, is on a much faster release cadence, and can verify the same Compose previews. Keep the AGP plugin as the primary gate if it is working, but prove Roborazzi can reproduce at least the design-system and RTL screenshot baselines before the redesign lands. Also worth knowing: the AGP plugin documentation states a **minimum of AGP 9.0**, which constrains your AGP upgrade path.

**Avoid Showkase.** An annotation-processor component browser that was already lagging on `compileSdk` deprecations is a liability in a redesign, and Android Studio's built-in Compose Preview Gallery plus `@Preview` parameters cover the same need. (I could not confirm an official archival notice — treat it as unmaintained-declining rather than formally dead, and do not build a redesign workflow on it.)

**Be skeptical of "KMP design system" as an accelerator.** Moving the custom Compose component library into a Kotlin Multiplatform module *now* is only cheap if the library has no Android-only dependencies. `AGENTS.md` lists iOS and desktop as reserved future clients, so the decision is real — but do it as an explicit architecture spike, not as part of a visual redesign. If you do it, Compose Multiplatform is Apache-2.0 and the Compose code itself is the same, so the risk is in dependency hygiene, not licensing.

---

## 5. Category 4 — Backend / API platform

### 5.1 Comparison table

| Candidate | URL | License | Activity / latest seen | Replaces in Orderak | Cloudflare compatibility | Verdict |
|---|---|---|---|---|---|---|
| **Hono** | [hono.dev](https://hono.dev) · [repo](https://github.com/honojs/hono) | MIT | Very active (v4.13.x; repo pins `^4.13.7`) | Already adopted | Native | **KEEP** |
| **`@hono/zod-openapi`** | [repo](https://github.com/honojs/middleware) | MIT | Active (`^1.6.1`) | Already adopted (OpenAPI-first contract glue) | Native | **KEEP** |
| **Chanfana** | [chanfana.com](https://chanfana.com) · [repo](https://github.com/cloudflare/chanfana) | MIT° | Active, Cloudflare-oriented, itty-router based | Alternative to `@hono/zod-openapi` | Native | **AVOID** (migration churn) |
| **itty-router** | [repo](https://github.com/kwhitley/itty-router) | MIT° | Active | Router | Native | **AVOID** (fragmentation) |
| **openapi-typescript** | [openapi-ts.dev](https://openapi-ts.dev/introduction) · [repo](https://github.com/openapi-ts/openapi-typescript) | MIT | Active (7.10.x seen) | Hand-maintained `@orderak/contracts-typescript` types + `verify:dto-parity` detective guard | Native (build-time only) | **ADOPT** |
| **orval** | [orval.dev](https://orval.dev) · [repo](https://github.com/orval-labs/orval) | MIT | Active | Hand-written admin-web API client; can emit TanStack Query hooks + MSW mocks | Native (build-time) | **EVALUATE** |
| **Hey API (`@hey-api/openapi-ts`)** | [heyapi.dev](https://heyapi.dev) · [repo](https://github.com/hey-api/openapi-ts) | MIT | Active | Same as orval, plugin-based | Native (build-time) | **EVALUATE** |
| **Scalar API Reference** | [scalar.com](https://scalar.com) · [repo](https://github.com/scalar/scalar) | MIT° for the core packages (verify per package; the hosted platform is commercial) | Very active | `docs/reference/api.md` as the interactive reference; bespoke API docs UI | **Fully static** — ships as JS/CSS, works on Workers Static Assets | **ADOPT** |
| **Redoc** | [repo](https://github.com/Redocly/redoc) | MIT° | Maintenance mode; Redocly's newer products are commercial | API reference rendering | Static | **AVOID** (use Scalar) |
| **Redocly CLI** | [repo](https://github.com/Redocly/redocly-cli) | MIT° | Active | OpenAPI lint/bundle in CI | Static/Node build step only | **EVALUATE** |
| **Spectral** | [repo](https://github.com/stoplightio/spectral) | Apache-2.0 | Active (the durable part of Stoplight) | OpenAPI style rules / contract linting | Build-time only | **ADOPT** |
| **Stoplight Studio / Platform** | [stoplight.io](https://stoplight.io) | Commercial (Studio discontinued/absorbed) | Declining | API design portal | n/a | **AVOID** |
| **oasdiff** | [repo](https://github.com/Tufin/oasdiff) | Apache-2.0 | Active | Manual breaking-change review for the versioned API contract | Build-time only | **ADOPT** |
| **Schemathesis** | [schemathesis.readthedocs.io](https://schemathesis.readthedocs.io) · [PyPI 4.x](https://pypi.org/project/schemathesis/4.0.23/) | MIT | Active (4.x) | Already present (`.schemathesis/`) — property-based contract testing | Runs against any HTTP endpoint | **KEEP** |
| **Zod** | [zod.dev](https://zod.dev) | MIT | Very active (`^4.4.3`) | Already adopted | Native | **KEEP** |
| **Valibot** | [valibot.dev](https://valibot.dev) | MIT | Active | Zod (bundle-size motivated) | Native | **AVOID** (migration cost ≫ benefit here) |
| **ArkType** | [arktype.io](https://arktype.io) | MIT° | Active | Zod | Native | **AVOID** (same) |
| **Drizzle ORM + drizzle-kit** | [orm.drizzle.team](https://orm.drizzle.team) · [repo](https://github.com/drizzle-team/drizzle-orm) | Apache-2.0 | Very active; first-class D1 dialect | Hand-written D1 SQL + hand-managed migrations + part of `verify:d1-bounds` | Native (D1 dialect) | **EVALUATE** (strong, but a project) |
| **Kysely** | [kysely.dev](https://kysely.dev) · [repo](https://github.com/kysely-org/kysely) | MIT | Active | Query building over D1 | Community D1 dialect (`kysely-d1`) | **EVALUATE** |
| **Prisma** | [prisma.io](https://www.prisma.io) | Apache-2.0 | Active | ORM | ⚠ Not Workers-first; heavier runtime/bundle | **AVOID** |
| **Prism (mock server)** | [repo](https://github.com/stoplightio/prism) | Apache-2.0 | Active | `mock:seller-v1` (already present) | Node dev-time tool | **KEEP** |

### 5.2 The high-value picks here

**openapi-typescript — the single best "delete custom code" win in the backend category.**
Orderak already has `verify:dto-parity`, `verify:error-codes` and `openapi:check`. Those guards exist because the OpenAPI contract and the TypeScript types can drift. Generating `@orderak/contracts-typescript` from the bundled OpenAPI turns a *detective* control into a *generative* one: drift becomes impossible rather than detected. That is strictly stronger governance for less code, and it aligns with `ADR-010 — Schema-First API Contract`.

**Scalar — replace hand-maintained API documentation with a static, interactive reference.**
`docs/reference/api.md` is a hand-written prose mirror of the API, which is exactly the artifact most prone to rot. Scalar renders the bundled OpenAPI into a searchable, try-it-out reference that can be embedded in the admin panel or the docs site and shipped as static assets through Wrangler. It is fully static — no Node server, no Workers incompatibility. **Verify the license of the specific package you import** (the `scalar/scalar` repo contains multiple packages and the hosted platform is commercial).

**Pick exactly one code generator.** openapi-typescript, orval and Hey API all solve "generate a typed client from OpenAPI". Running two is worse than running none. Recommended: **openapi-typescript for types** (minimal, and it replaces an existing hand-written artifact) and revisit orval only if you want generated TanStack Query hooks plus MSW handlers for Playwright.

**Add oasdiff and Spectral to CI.** Orderak's promise is "versioned contracts". oasdiff detects breaking changes between two OpenAPI revisions mechanically; Spectral enforces style/consistency rules. Both are build-time only, both are permissive licenses, and both convert a review conversation into a failing check — consistent with the existing `verify:*` culture.

### 5.3 Drizzle ORM — the honest assessment

Drizzle is Apache-2.0, has a genuine Cloudflare D1 dialect, and its migration tooling would replace hand-managed SQL migrations and *part* of the `verify:d1-bounds` guard (parameter-limit awareness). That is a real reduction in custom code.

But be clear-eyed about the trade:

- It is an ORM abstraction. The repository rule says "keep code beginner-friendly and avoid unnecessary abstraction". Raw D1 SQL with typed helpers *is* beginner-friendly; Drizzle's query builder is a new skill for the team.
- Adopting it means rewriting every query and migration. That is a **dedicated migration project**, not a side effect of a redesign. Bundling it into a UI redesign doubles the blast radius on the data authority of the whole platform — the worst place to have an incident.
- D1's constraints (no interactive transactions, batch API semantics, parameter limits) remain yours to reason about either way.

**Verdict: EVALUATE with a time box, then decide as its own ADR.** And be skeptical of the ORM hype: for a schema-first, contract-governed, single-database product at Egyptian SMB scale, hand-written SQL plus generated types is a defensible engineering choice. Do not adopt Drizzle *because the redesign is happening*.

**Valibot / ArkType: avoid.** Both are good libraries; both would mean migrating an entire `@hono/zod-openapi` + Zod 4 backend — including the OpenAPI generation path — to save bundle bytes that are not the bottleneck. This is a textbook case of a technically true claim (smaller/faster) that is a bad engineering decision here.

**Kysely: the middle option.** If the team wants types without an ORM's opinions, a query builder is a smaller conceptual leap than Drizzle — but its D1 support is community-maintained, which is weaker than Drizzle's first-party path. Only worth it if Drizzle is rejected on the "abstraction" rule.

---

## 6. Category 5 — Ops, observability and internal tools

### 6.1 Comparison table

| Candidate | URL | License | Activity / latest seen | Replaces in Orderak | Workers/Cloudflare fit | Verdict |
|---|---|---|---|---|---|---|
| **Sentry (SDKs)** | [sentry.io](https://sentry.io) · [repo](https://github.com/getsentry/sentry-javascript) | MIT (SDKs) | Very active (`@sentry/cloudflare ^10.71.0` in repo) | Already adopted | Native Workers SDK | **KEEP** |
| **Sentry (self-hosted server)** | [open.sentry.io/licensing](https://open.sentry.io/licensing/) | 🔴 **Functional Source License (FSL-1.1-Apache-2.0)** — source-available, not OSI-approved ([intro post](https://blog.sentry.io/introducing-the-functional-source-license-freedom-without-free-riding/), [SPDX request](https://github.com/spdx/license-list-XML/issues/2459), [2-year conversion clarification](https://github.com/getsentry/fsl.software/issues/41)) | Active | n/a | Would need your own infra | **AVOID self-hosting** |
| **GlitchTip** | [glitchtip.com](https://glitchtip.com) · [repo](https://gitlab.com/glitchtip/glitchtip-backend) | MIT° | Active (4.x helm chart seen) | Sentry-compatible error tracking, self-hostable | Needs a server, but **Sentry-SDK compatible** so no client rewrite | **EVALUATE** |
| **Cloudflare Workers Observability + OTel export** | [docs](https://developers.cloudflare.com/workers/observability/) · [OTel export](https://developers.cloudflare.com/workers/observability/exporting-opentelemetry-data/) | Proprietary (Cloudflare platform) | Active, GA | Bespoke logging/metrics plumbing | Native | **ADOPT** (platform, not OSS) |
| **Cloudflare Analytics Engine** | [docs](https://developers.cloudflare.com/analytics/analytics-engine/) · [pricing](https://developers.cloudflare.com/analytics/analytics-engine/pricing/) | Proprietary | Active | Ad-hoc D1 queries for high-cardinality metrics | Native, SQL API | **ADOPT** (platform) |
| **OpenFeature** | [openfeature.dev](https://openfeature.dev) | Apache-2.0 (CNCF) | Active — spec v0.9.0, mid-2026 update ([blog](https://openfeature.dev/blog/openfeature-mid-2026-update/)) | Bespoke flag access interface | Vendor-neutral SDK; Workers-compatible providers exist | **ADOPT** (as an interface) |
| **Flagsmith** | [flagsmith.com](https://www.flagsmith.com/open-source) | BSD-3-Clause° core + commercial | Active | Feature-flag service | Needs a server for the full stack | **AVOID** (extra infra) |
| **Unleash** | [getunleash.io](https://www.getunleash.io) | 🟠 Apache-2.0 core ([license misconceptions post](https://www.getunleash.io/blog/common-misconceptions-about-unleash)) + enterprise-only features | Active | Feature flags | Node + Postgres | **AVOID** |
| **GrowthBook** | [growthbook.io](https://www.growthbook.io) · [repo](https://github.com/growthbook/growthbook) | 🟠 MIT core + commercial `ee/` | Active | Flags + A/B testing | Node + Mongo/Postgres | **AVOID** |
| **Flipt** | [flipt.io](https://flipt.io) · [repo](https://github.com/flipt-io/flipt) | 🔴 GPL-3.0 v1 → **v2 relicensed to Fair Core License (FCL)** ([issue #3855](https://github.com/flipt-io/flipt/issues/3855), [licensing docs](https://docs.flipt.io/v2/configuration/licensing)) | Active | Feature flags | Needs a server | **AVOID** |
| **Grafana** | [grafana.com](https://grafana.com) · [licensing](https://grafana.com/licensing/) | 🔴 **AGPL-3.0** since the 2021 relicense | Active; Cloud free tier exists | Internal dashboards | Not Workers-native; needs a metrics pipeline | **EVALUATE** (internal only) |
| **PostHog** | [posthog.com](https://posthog.com) · [repo](https://github.com/PostHog/posthog) | 🟠 MIT core + proprietary `ee/`; **self-hosted OSS deployment de-emphasised** ([disclaimer](https://preview.posthog.com/docs/self-host/open-source/disclaimer), [hobby compose](https://github.com/PostHog/posthog/blob/723d2a3f/docker-compose.hobby.yml)) | Active | Product analytics | Self-host historically heavy | **EVALUATE (Cloud, not self-host)** |
| **Umami** | [umami.is](https://umami.is) · [repo](https://github.com/umami-software/umami) | MIT° | Active | Web analytics, cookie-less | Self-host (Node + Postgres) | **EVALUATE** |
| **Plausible** | [plausible.io](https://plausible.io) | 🔴 AGPL-3.0° | Active | Web analytics | Self-host | **EVALUATE** |
| **Matomo** | [matomo.org](https://matomo.org) | 🔴 GPL-3.0° | Active | Web analytics | Self-host, heavy | **AVOID** |
| **OpenStatus** | [openstatus.dev](https://www.openstatus.dev) · [repo](https://github.com/openstatusHQ/openstatus) | 🔴 AGPL-3.0° (self-host docs exist: [guide](https://www.openstatus.dev/docs/guides/self-host-status-page-only)) | Active | Status page + uptime monitoring | Self-host needs infra | **EVALUATE** |
| **Beszel** | [beszel.dev](https://beszel.dev) · [repo](https://github.com/henrygd/beszel) | MIT° | Active (0.18.x) | Server monitoring | Monitors **servers** — Orderak is serverless | **AVOID** (unless a VPS exists) |
| **Cloudflare Queues + DLQ** | [docs](https://developers.cloudflare.com/queues/) | Proprietary | Active, already used | Queue monitoring/DLQ | Native; already have a DLQ runbook | **KEEP** |

### 6.2 The licensing trap everyone misses: Sentry

This is the most important license finding in the ops category.

- **The Sentry SDKs are MIT.** `@sentry/react` and `@sentry/cloudflare` (both already in Orderak) are permissively licensed client libraries. Using Sentry's SaaS or the SDKs in a closed-source commercial app is fine.
- **The Sentry *server* is not open source in the OSI sense.** Sentry relicensed its self-hosted product under the **Functional Source License (FSL-1.1-Apache-2.0)** — a *source-available* license that forbids competing use and converts to Apache-2.0/MIT after two years. It is not GPL-style copyleft, so it will not "infect" your code, but it is also not MIT/Apache, and vendors that sweep for "open source" dependencies will flag it.

**Practical rule for Orderak:** keep using the Sentry SDKs. Do **not** stand up self-hosted Sentry as part of this project. It needs infrastructure Orderak deliberately does not have (no servers — Cloudflare only), and it adds a source-available component to a commercial product for no benefit over the SaaS tier at your scale. If Egypt data-residency or on-premise ever becomes a requirement, **GlitchTip (MIT, Sentry-SDK compatible)** is the migration target that does not require rewriting instrumentation.

### 6.3 Feature flags — build on what you have, standardize the interface

Orderak already has gated feature flags backed by D1/Workers. Every open-source flag platform in this table (Unleash, GrowthBook, Flagsmith, Flipt) requires you to run a Node/Java server and a database — which means a second data authority and a second thing to keep alive, in exchange for a UI you could build in the admin panel in a week.

The one thing worth taking from this category is **OpenFeature** (Apache-2.0, CNCF): adopt its provider *interface* in the Worker so flag access is not hard-wired to your D1 implementation. That is a small, standards-based refactor that preserves the option to move to a hosted or self-hosted provider later, and it costs almost nothing now.

**Also note the license churn in this space**, because it is a pattern, not an accident:

- **Flipt** moved from GPL-3.0 (v1) to the **Fair Core License** (v2) — a source-available license, requiring a contributor relicense ([issue](https://github.com/flipt-io/flipt/issues/3855)).
- **GrowthBook** and **Unleash** keep commercial features behind `ee/` or enterprise tiers.
- **NocoDB** moved from open source to non-free outright.
- **Directus** changed license again at v12 and added **active license enforcement**.

Any of these could be a fine *service* to pay for; none is a safe thing to *embed* in a commercial product without a license review.

### 6.4 What to do instead of standing up dashboards

Use the platform you already pay for:

- **Workers Observability** for logs, metrics and traces, with **OpenTelemetry export** ([docs](https://developers.cloudflare.com/workers/observability/exporting-opentelemetry-data/)) to a collector if you ever need one. Hono middleware plus `@sentry/cloudflare` already covers errors.
- **Analytics Engine** for the high-cardinality, SQL-queryable counters that would otherwise become expensive D1 queries (sync outcomes, queue depth, billing verification results, per-governorate order volume). This is a better fit than standing up Grafana, whose AGPL-3.0 license is also a non-starter if you ever embed a dashboard in the product rather than using it internally.
- **Cloudflare Queues' native metrics + the existing DLQ runbook** instead of a bespoke queue dashboard.
- **Build the status page yourself.** A static status page on Workers Static Assets reading a D1/KV table is a few hundred lines. OpenStatus is AGPL-3.0 and requires infrastructure; for a small team the build-vs-buy math is close, and building it removes a license dependency from a *customer-facing* surface.

**A caution on Grafana:** Grafana has been AGPL-3.0 since 2021 ([licensing](https://grafana.com/licensing/)). Using it internally as a dashboard is normally fine. Embedding it in a commercial product, or exposing a modified Grafana over the network to customers, is where AGPL obligations bite. Treat "Grafana" as an internal-only tool forever, or not at all.

**Caution on Baselime:** I saw reporting that Cloudflare acquired Baselime and folded it into Workers Observability, but I could **not** verify this from an authoritative page in this session. Verify before relying on Baselime either way — and note that relying on any single-vendor observability product acquired by your own platform vendor is a concentration risk worth naming in the risk register.

---

## 7. Category 6 — Anything else notable for an Egyptian SMB commerce app in 2026

### 7.1 Documentation site — MkDocs Material is in transition

| Item | URL | License | Status |
|---|---|---|---|
| **MkDocs Material** | [squidfunk.github.io/mkdocs-material](https://squidfunk.github.io/mkdocs-material/) · [repo](https://github.com/squidfunk/mkdocs-material) | MIT | Still shipping (`9.7.7`, changelog entry dated 2026-07-17) but the maintainer has announced a successor |
| **Zensical** | [zensical.org](https://zensical.org) · [upcoming changes](https://zensical.org/upcoming-changes/) | Unverified in this pass | Successor project by the MkDocs Material author ([announcement post](https://raw.githubusercontent.com/squidfunk/mkdocs-material/master/docs/blog/posts/zensical.md), dated 2025-11-05) |

**Verdict: EVALUATE / do not migrate now.** Orderak's docs are not just markdown — they are load-bearing: `strict: true`, `verify:doc-links`, `verify:built-site`, markdownlint across `**/*.md`, plus a `site/` build artifact that gets verified. A docs-generator migration would touch all four guards. Track Zensical, and treat "docs generator" as its own ADR with its own guard-update work, not as part of the visual redesign.

### 7.2 Arabic fonts — all permissive, with one real trap

Everything below is **SIL Open Font License 1.1**, which is safe for embedding in a commercial closed-source app (including APK/AAB bundling and web font serving). Orderak already ships Cairo, Tajawal and Noto Sans Arabic via `@fontsource` packages.

| Font | URL | License | Note for Orderak |
|---|---|---|---|
| **Cairo** | [Google Fonts](https://fonts.google.com/specimen/Cairo) | OFL-1.1 ([LICENSE via fontsource](https://cdn.jsdelivr.net/npm/@fontsource/cairo@5.2.7/LICENSE)) | Already adopted (variable) — strong UI Arabic + Latin |
| **Tajawal** | [Google Fonts](https://fonts.google.com/specimen/Tajawal) · [repo](https://github.com/googlefonts/tajawal) | OFL-1.1 | Already adopted |
| **Noto Sans Arabic** | [Google Fonts](https://fonts.google.com/noto/specimen/Noto+Sans+Arabic) | OFL-1.1 | Already adopted (variable) — best glyph coverage fallback |
| **IBM Plex Sans Arabic** | [IBM Plex](https://raw.githubusercontent.com/IBM/plex/v6.0.0/README.md) | OFL-1.1 | **Recommended addition** for admin panel: a sober Latin+Arabic superfamily that reads well at dense, small UI sizes |
| **Noto Kufi Arabic** | [Google Fonts](https://fonts.google.com/noto/specimen/Noto+Kufi+Arabic) | OFL-1.1 | Good for headings/brand; weak for long body text |
| **Rubik** | [Google Fonts](https://fonts.google.com/specimen/Rubik) | OFL-1.1 | Includes Arabic; friendly, high-x-height option |
| **Almarai** | [Google Fonts](https://fonts.google.com/specimen/Almarai) | OFL-1.1 | Clean Egyptian-market-friendly UI alternative |
| **Readex Pro** | [Google Fonts](https://fonts.google.com/specimen/Readex+Pro) | OFL-1.1 | Designed for Arabic+Latin reading comfort |
| **Amiri** | [Google Fonts](https://fonts.google.com/specimen/Amiri) | OFL-1.1 | Naskh — use for legal/long-form Arabic, not UI |

**The trap:** the OFL requires that the license text travel with the font, and it protects **Reserved Font Names** — if you distribute a *modified* font (including some subsetting/repacking that changes the font's internal name records), you may be obliged to rename it. Orderak has a **`fontkit`-based subsetting pipeline** on the backend (`fontkit` in `services/backend/package.json`, plus `design-system:generate`). **Confirm with the pipeline's output whether the subset fonts preserve the original name table and that the OFL text is bundled.** Getting this wrong is a quiet compliance bug that only surfaces in an app-store or legal review. Get it checked once, then encode it as a guard.

### 7.3 Arabic/RTL localization

| Item | URL | License | Verdict |
|---|---|---|---|
| **CLDR / ICU data** | [cldr.unicode.org](https://cldr.unicode.org) | Unicode License v3 (permissive) | **ADOPT** — the authority for Arabic plural rules, date/number/currency formatting |
| **JavaScript `Intl`** | Built in | n/a | **ADOPT** — no library needed for formatting in admin-web |
| **react-intl / FormatJS** | [formatjs.io](https://formatjs.io) | MIT° | **EVALUATE** — ICU MessageFormat for admin-web if you want message extraction + pseudo-localization |
| **i18next** | [i18next.com](https://www.i18next.com) | MIT° | **EVALUATE** — alternative; pick one, not both |
| **Radix `DirectionProvider`** | [radix-ui.com](https://www.radix-ui.com/primitives/docs/utilities/direction-provider) | MIT | **ADOPT** — RTL support for the primitives already in use |

**The concrete RTL/logic traps that will bite the redesign:**

1. **Tailwind physical vs logical properties.** `ml-*`/`pl-*`/`left-*`/`text-left` are *physical*. For an Arabic-first product you want `ms-*`/`me-*`/`ps-*`/`pe-*`/`start-*`/`end-*`/`text-start`. Mixed usage produces a UI that looks correct in LTR and broken in RTL. Worth a lint rule.
2. **Arabic plural categories.** CLDR defines six (zero, one, two, few, many, other). Any hand-rolled `count === 1 ? singular : plural` is wrong in Arabic. Use ICU MessageFormat (or a CLDR plural-rules implementation) for anything user-visible with a count — orders, items, days.
3. **Digit representation.** `ar-EG` may render Arabic-Indic digits (٠١٢٣) depending on the formatting path. Egyptian merchants commonly expect Western digits for prices. Decide explicitly (`nu-latn`) rather than inheriting a default, and test it — this interacts with `ADR-002/ADR-009` (integer piasters, minor units with explicit currency).
4. **Currency display.** EGP with 2 minor units; keep integer-piaster arithmetic server-side and format only at the edge. `Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP' })` is sufficient — **do not adopt a money library** (`dinero.js`/`currency.js`, both MIT°) since Orderak's integer-minor-units model is already more correct than float-based helpers.
5. **Mirroring is not just layout direction.** Icons with directional meaning (arrows, back chevrons, progress, pagination) must be mirrored; brand marks and clock faces must not be. Compose handles most of this via `LocalLayoutDirection` when assets are declared auto-mirrored — verify per icon.

### 7.4 Geo, country and currency data — the ODbL trap

| Dataset | URL | License | Note |
|---|---|---|---|
| **dr5hn/countries-states-cities-database** | [repo](https://github.com/dr5hn/countries-states-cities-database) · [FAQ](https://countrystatecity.org/faq) | 🔴 **ODbL-1.0°** | The most complete country/state/city dataset. Orderak appears to already import it (`geo:build-import` → `scripts/import-csc-cities.mjs`) |
| **GeoNames** | [geonames.org](https://www.geonames.org/services.html) | CC BY 4.0 (attribution required; commercial OK) | Orderak has a rollback path (`geo:build-geonames-rollback` → `import-geonames.mjs`) |
| **mledoze/countries** | [repo](https://github.com/mledoze/countries) | ODbL° | Country metadata: ISO codes, currencies, languages, native names, translations |
| **ISO 3166-1 code lists** | [iso.org](https://www.iso.org/iso-3166-country-codes.html) | 🔴 Paid, redistribution restricted | The official list is **not** freely redistributable. Use permissive mirrors (CLDR, `i18n-iso-countries` MIT) and never claim "official ISO 3166 data" |
| **CLDR territory/currency data** | [cldr.unicode.org](https://cldr.unicode.org) | Unicode License v3 | Best license-clean source for territory names + currencies in Arabic |
| **CAPMAS (Egyptian statistics)** | [censusinfo.capmas.gov.eg](https://www.censusinfo.capmas.gov.eg) | Government data — check terms | Authoritative Egyptian governorate/markaz/shiyakha data; not an OSS-licensed dataset, verify terms before bundling |

**The ODbL trap, stated plainly:** ODbL-1.0 is a **share-alike license for databases**. If Orderak *distributes a derivative database* — for example, ships the city list as an asset inside the Android APK, or publishes a modified CSC dataset — then obligations attach: attribution, and making the derivative database available under ODbL. Serving the data from your own backend as part of a user interface is the more permissive "Produced Work" case.

**Actionable recommendation:** keep geo data **server-side only**, behind the API, which the existing `geo:build-import` script already does. Do **not** ship raw CSC/GeoNames files as app assets, and do **not** publish a derived list. Add an attribution line in the app's about/legal screen and in `docs/legal/`, and record the dataset + license in `docs/governance/registers/third-party-and-permission-register.md` (which already exists). This is a genuine, concrete compliance risk that a redesign could accidentally introduce by "optimizing" geo lookups into a bundled local database for offline performance — flag it as a redesign constraint.

### 7.5 AI provider plumbing

| Item | URL | License | Verdict |
|---|---|---|---|
| **Cloudflare AI Gateway (DeepSeek provider)** | [provider docs](https://developers.cloudflare.com/ai-gateway/usage/providers/index.md) · [DeepSeek changelog](https://developers.cloudflare.com/changelog/post/2025-01-07-aig-provider-deepseek/) | Proprietary (Cloudflare) | **ADOPT** — caching, retries, rate limiting, observability in front of DeepSeek without new infra |
| **Vercel AI SDK** | [ai-sdk.dev](https://ai-sdk.dev) · [Cloudflare AI Gateway provider](https://ai-sdk.dev/providers/community-providers/cloudflare-ai-gateway) | Apache-2.0° | **EVALUATE** — see below |
| **Cloudflare Agents SDK** | [repo](https://github.com/cloudflare/agents) | MIT° | **AVOID for now** — no agentic product requirement; hype-driven adoption |

**On the AI SDK:** `AGENTS.md` says "start with one provider first, then add routing for others". For one provider, a thin `fetch` wrapper around DeepSeek is genuinely the better choice — it is transparent, debuggable and has no version churn. The AI SDK earns its place when the *second* provider arrives and you need streaming + tool-calling + routing across providers on Workers. Adopt it at that trigger point, not before. **Be skeptical of adopting it now**: AI SDK has had breaking major versions, and it would sit between you and a provider you already call successfully.

### 7.6 Play Billing, passkeys and SMS OTP — compliance notes, not OSS

- **Google Play Billing:** keep the Billing Library current against Play's deprecation deadlines, and note the **external offers / alternative billing APIs** ([docs](https://developer.android.com/google/play/billing/external)). Egypt-specific payment-method availability is documented by Google ([supported payment methods](https://support.google.com/googleplay/answer/2651410?hl=en&co=GENIE.CountryCode%3DEG)) — relevant to conversion, and to whether alternative billing is even worth pursuing. There is no open-source substitute for Play Billing in a Play-distributed app.
- **Passkeys:** Orderak already uses `@simplewebauthn/server` (permissive) with Firebase Phone Auth. Google's guidance is to migrate users to passkeys via **Credential Manager** ([best-practices post](https://developer.android.com/blog/posts/best-practices-for-migrating-users-to-passkeys-with-credential-manager)). This is an Android-side migration pattern, not a library swap — and it interacts with `docs/contracts/auth-phase1-contract.md`, which is a protected safety contract requiring explicit approval to change. **Do not touch auth semantics as part of a redesign.**
- **SMS OTP cost/resilience:** Firebase Phone Auth is the incumbent and there is no credible open-source replacement. Worth knowing for planning: Egyptian local SMS aggregators are typically far cheaper per message than global aggregators, and SMS deliverability in Egypt is a recurring operational risk worth a documented fallback. That is a commercial/ops decision outside the OSS scope of this document but inside the redesign's blast radius.
- **Background work:** Android continues to tighten background execution. Orderak's WorkManager sync is the correct primitive; the risk in a redesign is adding foreground services for things that do not need them ([background work changes](https://developer.android.com/develop/background-work/services/fgs/changes)).

---

## 8. Recommended stack

Shortlist of eight. Each line states the exact reason it earns a place, and what it deletes.

| # | Pick | License | What it deletes / why it earns the slot |
|---|---|---|---|
| 1 | **shadcn/ui** ([repo](https://github.com/shadcn-ui/ui)) | MIT | The admin-web dependency list is already the shadcn/ui stack minus the components (Radix + Tailwind 4 + cva + clsx + tailwind-merge). Copying in components removes the largest block of hand-rolled UI code with **zero** new runtime dependencies and no second design language. |
| 2 | **TanStack Table** ([repo](https://github.com/TanStack/table)) | MIT | Headless table state (sorting, filtering, pagination, row selection, column visibility) is exactly the code that gets re-written badly in every admin panel. Headless → no CSS, no theming opinion, no conflict with the token pipeline. Pairs with the TanStack Query already in use. |
| 3 | **react-hook-form + `@hookform/resolvers` + Zod 4** ([repo](https://github.com/react-hook-form/react-hook-form)) | MIT | Deletes bespoke admin form state and lets admin forms validate against the **same Zod schemas the backend already defines** — one validation source, two consumers. |
| 4 | **Style Dictionary v5** ([repo](https://github.com/style-dictionary/style-dictionary)) | Apache-2.0 | The only mature tool with a **built-in Jetpack Compose format** *and* CSS/Android XML/Tailwind outputs. This is what actually delivers "one token source → Compose theme code + web CSS", and it makes the token contract a versioned, CI-checked artifact instead of tribal knowledge. |
| 5 | **MaterialKolor** ([repo](https://github.com/jordond/MaterialKolor)) | Apache-2.0 | The canonical Compose-side implementation of "seed + scheme variant + contrast level → `ColorScheme`" — precisely the semantics of the backend Theme Builder. Deletes custom scheme-assembly code and gives previews/golden fixtures for free. Use it *downstream* of the server payload, never as an authority. |
| 6 | **Scalar API Reference** ([repo](https://github.com/scalar/scalar)) | MIT° (verify per package) | Replaces the hand-maintained `docs/reference/api.md` prose mirror with a static, searchable, try-it-out reference generated from the OpenAPI you already bundle. Fully static → deploys to Workers Static Assets with no server. |
| 7 | **openapi-typescript** ([repo](https://github.com/openapi-ts/openapi-typescript)) | MIT | Converts `verify:dto-parity` from a *detective* control into a *generative* one: `@orderak/contracts-typescript` becomes derived from the bundled OpenAPI, so contract/type drift cannot occur. Directly reinforces `ADR-010`. |
| 8 | **Roborazzi** ([repo](https://github.com/takahirom/roborazzi)) | Apache-2.0 | Insurance for the one hard dependency in the quality pillar: the AGP Compose screenshot plugin is at `0.0.1-alpha16` and requires AGP 9.0+. Roborazzi reproduces screenshot verification on the JVM without emulators, on a much faster release cadence. Cheap now, catastrophic to lack later. |

**Adjacent keepers (already adopted — do not churn):** Hono + `@hono/zod-openapi` + Zod 4, `@material/material-color-utilities`, TanStack Query, Radix primitives, Cloudflare Queues/DO/D1, Sentry SDKs, MkDocs Material, `com.android.compose.screenshot`, Schemathesis, Vitest/Playwright/oxlint.

**Adjacent adds worth ~a day each, outside the eight:** `compose-material3-adaptive` + Material 3 Expressive (already in the BOM), `Spectral` + `oasdiff` in CI, `OpenFeature` as the flag interface, Cloudflare Analytics Engine for metrics, IBM Plex Sans Arabic for admin.

---

## 9. Rejected with reasons

| Rejected | Why — specifically for Orderak |
|---|---|
| **React Admin** | MIT, but MUI/Emotion-based. Adopting it installs a second design system beside the runtime tokenized one, and the protected look-and-feel would have to be re-implemented inside MUI's theme model. Enterprise extras are a separate paid product. |
| **refine** | Good and MIT, but it is a framework over the routing and data fetching Orderak already has (react-router 7 + TanStack Query 5). Adoption cost is a migration plus a permanent abstraction; the repository rule prefers less abstraction for beginners. Reconsider only for a genuinely new, large surface. |
| **AdminJS** | MIT but declining, and its value proposition is schema introspection over Node ORMs Orderak does not use. Requires a Node server. |
| **Directus v12** | License changed *again* at v12 (2026-06-10) with **active license enforcement** — a source-available/commercial posture, not a safe embed for a closed-source product. Also requires Node + its own database. |
| **Appsmith / ToolJet / Baserow / NocoDB** | All require their own Node/Python/Java service **and** their own database, creating a second data authority beside D1 — the highest-cost mistake available here. ToolJet is AGPL-3.0; NocoDB moved to a **non-free license**; Baserow is MIT-core-plus-paid. They are genuinely useful tools; they are the wrong architecture for this product. |
| **Payload CMS** | MIT, but v3 runs inside Next.js (Node-ish runtime) and Orderak has no CMS requirement — content is admin-authored and documentation lives in MkDocs. |
| **MUI / Ant Design / Mantine** | Each ships its own token/theme model. The differentiator of this product is a *backend-generated, cross-platform* theme; adding a component library that owns theming means maintaining two theme sources forever. Mantine reached v9 and MUI reached v9 — both are healthy, and both are still wrong for this project. |
| **Park UI** | Built on **Panda CSS**, which conflicts directly with the Tailwind 4 pipeline in admin-web. |
| **AG Grid** | Community edition is genuinely MIT, but the features that justify AG Grid (integrated charts, advanced grouping, server-side row model) are **paid Enterprise**, and its Theming API is a parallel token system. Revisit only with a proven need for very large grids — TanStack Table + virtualization covers typical SMB admin volume. |
| **Tremor** | **Acquired by Vercel.** Even though it is open source, ownership change means roadmap uncertainty for a component set you would then own. Recharts (which Tremor wraps conceptually) is the lower-risk direct dependency. |
| **Redoc / Stoplight platform** | Redoc is in maintenance and Redocly's newer products are commercial; Stoplight Studio was discontinued/absorbed and only **Spectral** (Apache-2.0) remains strategically valuable. Use Scalar for rendering, Spectral for linting. |
| **Valibot / ArkType** | Both fine libraries, both would require migrating the entire Zod 4 + `@hono/zod-openapi` OpenAPI generation path. Bundle-size gains do not justify it on Workers at this scale. |
| **Prisma** | Not Workers-first; heavier runtime and bundle than D1-native approaches. |
| **Drizzle ORM (as part of the redesign)** | Apache-2.0 and technically a strong fit for D1 — but adopting an ORM is a full data-layer rewrite, and bundling it with a UI redesign multiplies incident risk on the platform's data authority. **Evaluate as its own ADR with its own timeline.** Raw typed SQL is a legitimate answer here; do not adopt an ORM for its own sake. |
| **Flipt / Unleash / GrowthBook / Flagsmith (self-hosted)** | Each needs a server and a database to replace a flag system Orderak already runs on D1/Workers. Flipt v2 is now **Fair Core License** (source-available); GrowthBook and Unleash gate features behind commercial tiers. Adopt **OpenFeature** as an interface instead. |
| **Grafana, as a product component** | AGPL-3.0 since 2021. Fine as an internal dashboard; a red flag if ever embedded in or exposed by the product. Prefer Cloudflare-native observability, whose data you already have. |
| **PostHog self-hosted** | Core is MIT with a proprietary `ee/`, and PostHog has de-emphasised the open-source self-hosted deployment in favour of Cloud. Choose deliberately, and resolve the PII/data-classification question first (`docs/architecture/data-classification.md` exists for this). |
| **Matomo** | GPL-3.0 and operationally heavy for the value delivered. |
| **Beszel** | MIT and pleasant, but it monitors *servers*. Orderak is serverless by design. |
| **OpenStatus** | AGPL-3.0 for a customer-facing status page, when a static status page on Workers Static Assets is a few hundred lines. Build it. |
| **Self-hosted Sentry** | The server is **FSL-1.1-Apache-2.0** (source-available, not OSI-approved) and requires infrastructure Orderak deliberately does not run. Keep the MIT SDKs; use GlitchTip (MIT) if on-premise ever becomes mandatory. |
| **Showkase** | Declining maintenance (open issues on `compileSdk` deprecations), annotation-processor-based, and superseded by Android Studio's Compose Preview tooling. Avoid in a redesign. |
| **Paparazzi** | Mature but overlaps Roborazzi; keeping both JVM screenshot tools is redundant. Choose Roborazzi. |
| **Navigation 3 (for now)** | The right long-term direction for the custom navigation graph, but pre-1.0 in 2026. Do not couple a redesign to a pre-release API; spike it separately. |
| **Compose Multiplatform (for now)** | Apache-2.0 and strategically appealing given reserved iOS/desktop clients, but "make the component library KMP-ready" is an architecture decision with dependency-hygiene work, not a redesign accelerator. Separate spike. |
| **Open Props** | An opinionated palette that would compete with the brand theme generated from merchant seeds. Mine it for shadow/easing values, do not adopt it as a source of truth. |
| **Tokens Studio (Pro)** | Proprietary with the useful features behind a paid tier, and Figma Variables now cover much of the ground. Process overhead without a dedicated design-ops person. |
| **Chanfana / itty-router** | MIT and Cloudflare-native, but switching off `@hono/zod-openapi` is pure churn with no capability gain. |
| **Cloudflare Agents SDK** | MIT and interesting, but there is no agentic product requirement. Adopting it because it is new is exactly the hype trap to avoid. |
| **Vercel AI SDK (right now)** | Apache-2.0 and the right answer for multi-provider routing — which is not yet the problem. For one provider (DeepSeek), a transparent `fetch` wrapper is better. Adopt at the second provider. |
| **Money libraries (`dinero.js`, `currency.js`)** | Orderak's integer-piaster / minor-units-with-explicit-currency model (`ADR-002`, `ADR-009`) is already more correct than float-based helpers. Format at the edge with `Intl`. Building it yourself genuinely wins. |
| **ISO 3166 official lists** | Paid and redistribution-restricted. Use CLDR/permissive mirrors; never assert "official ISO 3166 data" in shipped artifacts. |

---

## 10. License traps and architecture traps — the short list

### 10.1 🔴 Copyleft / source-available (read before adopting)

| Project | License status | Why it matters here |
|---|---|---|
| **Sentry server (self-hosted)** | FSL-1.1-Apache-2.0 — source-available, **not OSI-approved** | SDKs are MIT (safe). Do not self-host the server in a commercial closed-source product. |
| **Flipt v2** | Fair Core License (was GPL-3.0 in v1) | Source-available; also needs a server. |
| **NocoDB** | Moved to **non-free** | License changed after adoption by the community — a reason to avoid depending on it. |
| **Directus v12** | License changed again + **active license enforcement** | Not a safe embed. |
| **ToolJet** | AGPL-3.0 | Network-copyleft: modifying and serving it to users triggers source obligations. Requires Node + Postgres regardless. |
| **Grafana** | AGPL-3.0 (since 2021) | Internal dashboard use only. Never embedded in the product. |
| **OpenStatus** | AGPL-3.0° | Customer-facing surface; build a static status page instead. |
| **Plausible** | AGPL-3.0° | If self-hosting analytics. Umami (MIT) avoids the question. |
| **Matomo** | GPL-3.0° | Avoid. |
| **dr5hn countries-states-cities-database** | **ODbL-1.0°** — share-alike for *databases* | Do not bundle as an app asset or publish a derivative. Keep server-side; attribute. |
| **mledoze/countries** | ODbL° | Same share-alike caveat for the database. |
| **ISO 3166 code lists** | Paid, redistribution restricted | Use CLDR or permissive mirrors. |
| **Tokens Studio** | Proprietary; Pro features paid | Not a license *trap*, but a paid proprietary dependency in the toolchain. |
| **Penpot** | MPL-2.0° | File-level copyleft only — **safe for commercial closed-source use** as a design tool. Listed here for completeness, not as a risk. |
| **SIL OFL-1.1 fonts** (Cairo, Tajawal, Noto, IBM Plex, Rubik, Almarai, Readex Pro, Amiri) | Permissive for embedding | **But**: Reserved Font Names + license bundling. Audit the existing `fontkit` subsetting pipeline. |

### 10.2 Cloudflare Workers incompatibility checklist

These are the candidates that **cannot** run in Orderak's architecture without adding a Node server and/or a second database. Every one of them was rejected primarily on this basis:

- **Directus, Payload CMS, AdminJS, Appsmith, ToolJet, Baserow, NocoDB** — all require a Node (or Python/Java) service process and their own database.
- **Unleash, GrowthBook, Flagsmith, Flipt** — all require a server + database for the full feature set.
- **PostHog self-hosted, Matomo, Plausible, Umami, OpenStatus, Grafana, Beszel** — all require infrastructure to self-host.
- **Prisma** — not Workers-first (heavier runtime/bundle than D1-native access).

Everything that **is** Workers-compatible and fully static in the recommendation set — shadcn/ui, TanStack Table, react-hook-form, Style Dictionary (build-time), Scalar, openapi-typescript (build-time), Roborazzi (JVM), MaterialKolor (Android), Recharts — ships no server requirement at all. That is the concrete test to apply to any new candidate: **"does this deploy as static assets or build-time output, or does it need a process I do not have?"**

### 10.3 Traps that are not about libraries

1. **A second data authority.** The most expensive failure mode in this redesign is accidentally introducing a second database (via Directus/Appsmith/Baserow/NocoDB) beside D1.
2. **A second theme authority.** Adopting MUI/AntD/Mantine/AG Grid and *also* keeping the runtime Theme Builder means reconciling two theme models forever. One authority: the backend Theme Builder, for color; Style Dictionary, for structure.
3. **Bundling geo data for offline speed.** Converting the server-side geo lookup into a shipped asset is a *performance* win and an **ODbL compliance** problem. Do not.
4. **Letting the redesign touch the auth contract.** `docs/contracts/auth-phase1-contract.md` is a protected, versioned safety contract requiring explicit approval; nothing in this document proposes changing it. Likewise, do not let a token/design-system change alter `docs/architecture/localization-architecture.md` invariants (default locale, supported locale set, language splits, screenshot baselines) — those are guarded by `verifyLocalizationContract`, and a redesign is exactly when they get broken by accident.
5. **Coordinating governance guards with any adoption.** Adding Style Dictionary, openapi-typescript, or a docs-generator change means updating `verify:built-site`, `verify:doc-links`, `verify:dto-parity` and the design-system guards in the same change — the repository's own rules require the docs to move with the architecture.

---

## 11. Open questions to resolve before the redesign starts

1. **Exact license confirmation** for every item marked `°` — mechanically, by checking each `<repo>/LICENSE`. Several verdicts above are gated on this.
2. **Font pipeline audit** — does the `fontkit` subsetting output preserve font name tables, and is the OFL text bundled with the app and web bundles?
3. **Geo licensing decision** — is any CSC/GeoNames-derived data currently bundled *inside* the Android app or the web bundle, or is it exclusively server-side? Record the answer and the attribution plan in the third-party register.
4. **Designer workflow** — Figma Variables + manual export, or a Tokens Studio / Penpot change? This determines whether the token pipeline is code-only or code+design-tooling.
5. **Single code-generation choice** — openapi-typescript vs orval vs Hey API. Settle it once; running two is worse than running none.
6. **Drizzle decision as its own ADR** — yes/no, with a timeline, kept out of the redesign's critical path.
7. **Roborazzi proof-of-concept against existing screenshot baselines** — before the redesign multiplies the number of visual surfaces.
8. **Zensical tracking** — a named owner and a review date, so the docs transition does not surprise the `verify:built-site` guard.
