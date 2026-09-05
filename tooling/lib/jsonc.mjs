/**
 * Orderak — JSONC reading, shared.
 *
 * WHY THIS EXISTS
 *   Wrangler configuration is JSONC: it carries the comments that explain why a
 *   flag is closed, and those comments are the most valuable part of the file.
 *   JSON.parse cannot read it, so every tool that needs a deployment fact has to
 *   strip comments first.
 *
 *   verify-deployment-map.mjs grew that stripper. When the evidence verifier
 *   needed the same facts, copying it would have produced two parsers that agree
 *   until one of them is fixed. One parser, two callers.
 *
 * WHAT IT IS NOT
 *   Not a JSON5 parser. It handles line comments, block comments and strings —
 *   which is what Wrangler emits — and deliberately nothing else, so that a file
 *   using some further extension fails loudly at JSON.parse rather than being
 *   silently half-understood.
 */
import { readFileSync } from "node:fs";

/** Remove // and comments from JSONC, preserving string contents and line count. */
export function stripJsonComments(source) {
  let output = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (current === "\n") { lineComment = false; output += current; }
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") { blockComment = false; index += 1; }
      else if (current === "\n") output += current;
      continue;
    }
    if (inString) {
      output += current;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === '"') inString = false;
      continue;
    }
    if (current === '"') { inString = true; output += current; continue; }
    if (current === "/" && next === "/") { lineComment = true; index += 1; continue; }
    if (current === "/" && next === "*") { blockComment = true; index += 1; continue; }
    output += current;
  }
  return output;
}

/** Read and parse a JSONC file at an absolute path. */
export function loadJsonc(absolutePath) {
  return JSON.parse(stripJsonComments(readFileSync(absolutePath, "utf8")));
}
