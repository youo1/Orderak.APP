/**
 * PHASE 0 exit condition, made checkable.
 *
 * Maps every screen contract to the artboards that design it, and asserts that
 * each contract's DECLARED states are all drawn.
 *
 *   node tooling/ux/design-coverage.mjs
 *
 * The canvas lives at the artifact below; artboard names are its file stems.
 *
 * WHAT THIS CAN AND CANNOT TELL YOU
 *   It compares two object literals in this file. That catches a real class of
 *   mistake — a contract gaining a state nobody designed for, an artboard
 *   mapped to a state the contract does not declare — and it caught several.
 *
 *   It cannot tell you a state was drawn, and it cannot tell you a state was
 *   built, because no artboard NAME here is checked against anything outside
 *   this file. It reported the `today` contract fully designed for months while
 *   two of its four states did not exist in the app at all.
 *
 *   `render-coverage.mjs` is the one that answers the question this file looks
 *   like it answers. Read its number, not this one's, for "is it built".
 */
import { CONTRACTS } from "./screen-contracts.mjs";

/**
 * The canvases, one per surface. Artboard names above are their file stems.
 *
 * These are external artifacts: nothing in CI can open them, so a wrong URL here
 * fails silently and a deleted canvas fails not at all. They are a pointer for a
 * human, not evidence — which is the whole reason render-coverage.mjs exists.
 */
export const CANVASES = {
  today:     "https://claude.ai/artifact/9dTQcffReAoJuvsb11bwJf",
  store:     "https://claude.ai/artifact/KrmanUyKpdmMSxpAF9w4JB",
  orders:    "https://claude.ai/artifact/T9nKAZqC67qKmi83Z2CGvX",
  customers: "https://claude.ai/artifact/F9vcRNCudwC2dJstJCr7cp",
  account:   "https://claude.ai/artifact/M6S9zLqWNBUp35GHhuxHBg",
};

/** contract id -> { state: artboard }. "content" is the primary artboard. */
export const DESIGNS = {
  "splash":             { loading: "Splash", error: "Splash" },
  "auth":               { content: "Welcome", loading: "PhoneOtp", error: "PhoneOtp" },
  "shop-setup":         { content: "ShopSetup", loading: "ShopSetup", error: "ShopSetup" },
  "restricted-account": { content: "RestrictedAccount" },
  "main-shell":         { content: "Main" },
  "version-governance": { content: "VersionGovernance" },

  "today":     { loading: "TodayLoading", content: "Main", empty: "TodayEmpty", error: "TodayError" },
  "orders":    { loading: "OrdersLoading", content: "Orders", empty: "OrdersEmpty", error: "OrdersError" },
  "order-details": { loading: "OrdersLoading", content: "OrderDetails", error: "OrdersError" },
  "new-order": { content: "NewOrder", loading: "OrdersLoading", error: "OrdersError" },

  "store":        { loading: "StoreLoading", content: "Store", empty: "StoreEmpty", error: "StoreError" },
  "product-edit": { loading: "StoreLoading", content: "ProductEdit", error: "StoreError" },
  "categories":   { loading: "StoreLoading", content: "Categories", empty: "StoreEmpty", error: "StoreError" },
  "store-info":   { loading: "StoreLoading", content: "StoreInfo", error: "StoreError" },
  "catalog-languages": { loading: "StoreLoading", content: "CatalogLanguages", empty: "StoreEmpty", error: "StoreError" },

  "customers":        { loading: "CustomersLoading", content: "Customers", empty: "CustomersEmpty", error: "CustomersError" },
  "customer-details": { loading: "CustomersLoading", content: "CustomerDetails", error: "CustomersError" },

  "account":         { content: "Account", loading: "AccountLoading" },
  "seller-profile":  { loading: "AccountLoading", content: "SellerProfile", error: "StoreError" },
  "devices":         { loading: "AccountLoading", content: "Devices", error: "StoreError" },
  "support":         { loading: "AccountLoading", content: "Support", empty: "CustomersEmpty", error: "StoreError" },
  "support-ticket":  { loading: "AccountLoading", content: "SupportTicket", error: "StoreError" },
  "announcements":   { loading: "AccountLoading", content: "Announcements", empty: "CustomersEmpty", error: "StoreError" },
  "deletion-status": { loading: "AccountLoading", content: "DeletionStatus", error: "StoreError" },
  "ai-assistant":    { loading: "AccountLoading", content: "AiAssistant", empty: "AiAssistant", error: "StoreError" },

  "subscription": { loading: "AccountLoading", content: "Subscription", error: "StoreError" },
  "plans":        { loading: "AccountLoading", content: "Plans", error: "StoreError" },
  "paywall":      { content: "Paywall" },
};

/* An offline-capable screen must have an offline artboard for at least one of
   its surfaces — the banner pattern is proven once per surface, not per screen. */
const OFFLINE_ARTBOARDS = {
  today: "TodayOffline", orders: "OrdersOffline", store: "StoreOffline",
  customers: null, account: null,
};

const problems = [];
for (const c of CONTRACTS) {
  const d = DESIGNS[c.id];
  if (!d) { problems.push(`${c.id}: no design mapping`); continue; }
  for (const s of c.states) {
    if (!d[s]) problems.push(`${c.id}: declares state "${s}" but no artboard designs it`);
  }
  for (const s of Object.keys(d)) {
    if (!c.states.includes(s)) problems.push(`${c.id}: artboard mapped for "${s}" which the contract does not declare`);
  }
}
for (const id of Object.keys(DESIGNS)) {
  if (!CONTRACTS.some(c => c.id === id)) problems.push(`design mapping for unknown contract: ${id}`);
}

/* offline surfaces: at least one artboard proves the banner over content */
const offlineSurfaces = new Set(CONTRACTS.filter(c => c.offline).map(c => c.surface));
for (const s of offlineSurfaces) {
  if (OFFLINE_ARTBOARDS[s] === undefined) problems.push(`no offline artboard decision for surface ${s}`);
}

if (problems.length) {
  console.error(`FAIL — ${problems.length} problem(s):`);
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}

const distinct = new Set(Object.values(DESIGNS).flatMap(d => Object.values(d)));
const cases = CONTRACTS.reduce((a, c) => a + c.states.length, 0);
console.log(`OK — ${CONTRACTS.length} contracts, every declared state is MAPPED to an artboard name.`);
console.log(`  (a name, in this file. For what is actually rendered: node tooling/ux/render-coverage.mjs)`);
console.log(`  distinct artboards used by contracts: ${distinct.size}`);
console.log(`  offline surfaces with an artboard named: ${[...offlineSurfaces].filter(s => OFFLINE_ARTBOARDS[s]).join(", ")}`);
console.log(`  screenshot cases implied: ${cases} states x 2 themes = ${cases * 2}`);
for (const [surface, url] of Object.entries(CANVASES)) console.log(`  canvas ${surface.padEnd(10)} ${url}`);
