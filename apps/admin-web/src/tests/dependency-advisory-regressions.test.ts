// Reads the repo-root advisory files via Vite `?raw` imports: tsconfig.app.json
// types only vite/client, so node:fs/path/url are unavailable here by contract.
import { describe, expect, it } from 'vitest';
import workspaceYaml from '../../../../pnpm-workspace.yaml?raw';
import trivyIgnore from '../../../../.trivyignore?raw';
import lockfile from '../../../../pnpm-lock.yaml?raw';

function collectVersions(text: string, pkgName: string): string[] {
  const escaped = pkgName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![\\w-])${escaped}@(\\d+\\.\\d+\\.\\d+)`, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

function extractIgnoreGhsas(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const startIdx = lines.findIndex((l) => /ignoreGhsas:\s*$/.test(l.trim()));
  if (startIdx === -1) return [];
  const ids: string[] = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s*-\s*(GHSA-[\w-]+)\s*$/);
    if (!m) break;
    ids.push(m[1]);
  }
  return ids;
}

describe('pnpm-workspace.yaml: pre-existing overrides are untouched', () => {
  it('keeps the five overrides unrelated to this task, verbatim', () => {
    expect(workspaceYaml).toContain('lodash@<4.17.24: ">=4.17.24"');
    expect(workspaceYaml).toContain('uuid@<11.1.1: ">=11.1.1"');
    expect(workspaceYaml).toContain('fast-uri@<3.1.6: ">=3.1.7 <4"');
    expect(workspaceYaml).toContain('qs@<6.16.0: ">=6.16.0"');
    expect(workspaceYaml).toContain('js-yaml@<3.15.2: ">=3.15.2 <4"');
  });

  it('keeps both pre-existing ignoreGhsas entries', () => {
    const ids = extractIgnoreGhsas(workspaceYaml);
    expect(ids).toEqual(expect.arrayContaining(['GHSA-qxc2-j82w-r537', 'GHSA-rgj7-g3m4-5g8c']));
  });

  it('keeps minimumReleaseAgeExclude untouched', () => {
    expect(workspaceYaml).toMatch(
      /minimumReleaseAgeExclude:\s*\r?\n\s*-\s*miniflare@5\.20260910\.0-alpha\s*\r?\n\s*-\s*wrangler@4\.131\.0/,
    );
  });

  it('does not add an override for braces, which has no patched release', () => {
    expect(/^\s*braces@\S*:\s*"/m.test(workspaceYaml)).toBe(false);
  });
});

describe('.trivyignore: pre-existing waiver is untouched', () => {
  it('keeps the undici medium-severity waiver verbatim', () => {
    expect(trivyIgnore).toContain('CVE-2026-85024 exp:2026-12-31');
  });
});

describe('pnpm-lock.yaml: braces stays unpatched', () => {
  it('every braces entry resolves to 3.0.3 (no fixed release exists to move to)', () => {
    const versions = collectVersions(lockfile, 'braces');
    expect(versions.length).toBeGreaterThan(0);
    expect(versions.every((v) => v === '3.0.3')).toBe(true);
  });
});
