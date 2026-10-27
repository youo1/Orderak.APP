#!/usr/bin/env node
// ============================================================
// Arabic register guard (decision D-15, plan item R11).
//
// Every Arabic string a seller or a buyer reads is Modern Standard Arabic. This
// guard fails on a word from the glossary's colloquial column in:
//   - apps/seller-android/app/src/main/res/values-ar/strings.xml
//   - services/backend/src/platform/localization/messages/ar.ts
//
// The brand is written أوردرك and is never a finding. Strings that the
// authentication contract protects (the consent line and the SMS disclosure)
// are listed in ALLOWED_PENDING_APPROVAL with the reason; they change with that
// contract's owner approval, not before. An entry that no longer needs the
// allowance fails too, so the list can only shrink.
//
// Usage: node tooling/repository/verify-arabic-register.mjs
// ============================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const stripMarks = (s) => s.normalize("NFC").replace(/[ً-ٰٟۖ-ۭـ]/g, "");

/**
 * The colloquial column of the glossary: whole words, compared without diacritics. Words that are
 * also ordinary Standard Arabic (the imperatives اكتب, اختر, ارجع, امسح, جرّب, and غير) are not here.
 */
export const COLLOQUIAL = new Set(
  [
    "لسه", "لسة", "مفيش", "دوس", "شوف", "عشان", "علشان", "دلوقتي", "دلوقت", "كده", "ده", "دي", "دا",
    "إيه", "ايه", "بتاع", "بتاعك", "بتاعة", "اللي", "ازاي", "إزاي", "حاجة", "برضه", "برضو", "ضيف",
    "انت", "تاني", "موبايل", "عايز", "عايزة", "مش", "اتحفظ", "اتبعت", "اتغير", "اتمسح", "اتأكد",
    "اتسجل", "اتحرك", "اتزامنت", "ماقدرناش", "مقدرناش", "ماتبعتش", "ماترفعتش", "ماتبعتتش",
    "مارضاش", "هيظهر", "هتظهر", "هنبعت", "هتقدر", "هيتم", "هيتبعت", "هتتغير", "هيتغير", "هيتمسح",
    "هيمسح", "هتفضل", "هيفضل", "هيوصل", "هتتحدث", "هيتنفذ", "هنبلغك", "هتتمس", "هيتسجل",
    "كلم", "اعمل", "استنى", "ابعت", "اختار", "شيل", "خليها", "خلي",
  ].map(stripMarks),
);

const BRAND = "أوردرك";

/**
 * Strings that stay as they are until the authentication contract's owner approves new wording.
 * Exact keys in values-ar; the reason is the contract, not convenience.
 */
export const ALLOWED_PENDING_APPROVAL = [
  { key: "auth_marketing_opt_in", reason: "the marketing consent line is consent evidence under the authentication contract" },
  { key: "auth_phone_reason", reason: "the disclosure shown before an SMS code is sent belongs to the authentication contract" },
];

function tokens(value) {
  return stripMarks(value)
    .replace(/%\d*\$?[sd]/g, " ")
    .split(/[^ء-ي]+/u)
    .filter(Boolean);
}

/** The colloquial words in one string, brand excluded. */
export function colloquialWords(value) {
  const found = [];
  for (const raw of tokens(value)) {
    const word = raw.replace(/^(و|ف|ب|ل|ال)(?=.{3,})/u, (m) => (raw === BRAND ? "" : m));
    if (raw === BRAND) continue;
    if (/^(ال)?أوردر(?!ك)/u.test(raw)) {
      found.push(raw);
      continue;
    }
    for (const candidate of new Set([raw, word])) {
      if (COLLOQUIAL.has(candidate)) found.push(raw);
    }
  }
  return [...new Set(found)];
}

function readStrings(file) {
  const text = readFileSync(path.join(root, file), "utf8");
  const rows = [];
  if (file.endsWith(".xml")) {
    for (const m of text.matchAll(/<string name="([^"]+)"[^>]*>([^<]*)<\/string>/g)) rows.push([m[1], m[2]]);
    for (const block of text.matchAll(/<plurals name="([^"]+)">([\s\S]*?)<\/plurals>/g)) {
      for (const item of block[2].matchAll(/<item[^>]*>([^<]*)<\/item>/g)) rows.push([block[1], item[1]]);
    }
  } else {
    for (const m of text.matchAll(/^\s*"([^"]+)":\s*"((?:[^"\\]|\\.)*)"/gm)) rows.push([m[1], m[2]]);
  }
  return rows;
}

export function findings() {
  const out = [];
  const allowedUsed = new Set();
  for (const file of [
    "apps/seller-android/app/src/main/res/values-ar/strings.xml",
    "services/backend/src/platform/localization/messages/ar.ts",
  ]) {
    for (const [key, value] of readStrings(file)) {
      const words = colloquialWords(value);
      if (words.length === 0) continue;
      const allowance = ALLOWED_PENDING_APPROVAL.find((a) => file.endsWith("strings.xml") && key === a.key);
      if (allowance) {
        allowedUsed.add(allowance.key);
        continue;
      }
      out.push(`${file}: ${key} uses ${words.join(", ")}`);
    }
  }
  for (const a of ALLOWED_PENDING_APPROVAL) {
    if (!allowedUsed.has(a.key)) out.push(`ALLOWED_PENDING_APPROVAL "${a.key}" no longer needs its allowance (remove it)`);
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = findings();
  if (problems.length > 0) {
    console.error(`${problems.length} Arabic register problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log("Arabic register verified: values-ar and the backend dictionary use Modern Standard Arabic.");
}
