#!/usr/bin/env node
// Companion proof for verify-arabic-register.mjs: the guard can fail, and it
// does not fail on Standard Arabic or on the brand.
//
// Usage: node --test tooling/repository/verify-arabic-register.test.mjs

import assert from "node:assert/strict";
import test from "node:test";
import { ALLOWED_PENDING_APPROVAL, colloquialWords, findings } from "./verify-arabic-register.mjs";

test("a colloquial string is a finding, word by word", () => {
  assert.deepEqual(colloquialWords("لسه مفيش أوردرات"), ["لسه", "مفيش", "أوردرات"]);
  assert.ok(colloquialWords("الأوردر ده اتحفظ").includes("الأوردر"));
  assert.ok(colloquialWords("هيتبعت لوحده").includes("هيتبعت"));
});

test("Standard Arabic is not a finding", () => {
  assert.deepEqual(colloquialWords("لا توجد طلبات بعد. أضف أول منتج."), []);
  assert.deepEqual(colloquialWords("تعذّر حفظ بيانات المتجر. غير صالح."), []);
  assert.deepEqual(colloquialWords("اكتب رقم الهاتف كاملًا ثم اضغط حفظ"), []);
});

test("the brand is never a finding, in any spelling", () => {
  assert.deepEqual(colloquialWords("حدّث أوردرك من Google Play"), []);
  assert.deepEqual(colloquialWords("حدّث أوردرَك للمتابعة"), []);
});

test("diacritics do not hide a colloquial word", () => {
  assert.ok(colloquialWords("دُوس هنا").includes("دوس"));
});

test("placeholders are ignored", () => {
  assert.deepEqual(colloquialWords("طلب #%1$d بقيمة %2$s"), []);
});

test("the real tree passes, and every allowance is still needed", () => {
  assert.deepEqual(findings(), []);
  assert.ok(ALLOWED_PENDING_APPROVAL.every((a) => a.reason.length > 20));
});
