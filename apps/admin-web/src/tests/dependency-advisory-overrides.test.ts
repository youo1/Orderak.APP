// Reads the repo-root advisory files via Vite `?raw` imports: tsconfig.app.json
// types only vite/client, so node:fs/path/url are unavailable here by contract.
import { describe, expect, it } from 'vitest';
import workspaceYaml from '../../../../pnpm-workspace.yaml?raw';
import trivyIgnore from '../../../../.trivyignore?raw';
import lockfile from '../../../../pnpm-lock.yaml?raw';

function parseVer(v: string): [number, number, number] {
  const [maj, min, pat] = v.split('.').map(Number);
  return [maj, min, pat];
}

function gte(v: string, bound: string): boolean {
  const [va, vb, vc] = parseVer(v);
  const [ba, bb, bc] = parseVer(bound);
  if (va !== ba) return va > ba;
  if (vb !== bb) return vb > bb;
  return vc >= bc;
}

function lt(v: string, bound: string): boolean {
  const [va, vb, vc] = parseVer(v);
  const [ba, bb, bc] = parseVer(bound);
  if (va !== ba) return va < ba;
  if (vb !== bb) return vb < bb;
  return vc < bc;
}

function collectVersions(text: string, pkgName: string): string[] {
  const escaped = pkgName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![\\w-])${escaped}@(\\d+\\.\\d+\\.\\d+)`, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

function findLineIndexContaining(text: string, re: RegExp): number {
  const lines = text.split(/\r?\n/);
  return lines.findIndex((l) => re.test(l));
}

function nearbyTextBefore(text: string, lineIndex: number, before = 20): string {
  const lines = text.split(/\r?\n/);
  return lines.slice(Math.max(0, lineIndex - before), lineIndex + 1).join('\n');
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

describe('pnpm-workspace.yaml: new bounded overrides', () => {
  it('overrides undici to >=7.29.1 <8, citing both advisories', () => {
    const idx = findLineIndexContaining(workspaceYaml, /undici(@\S+)?:\s*">=7\.29\.1 <8"/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const ctx = nearbyTextBefore(workspaceYaml, idx);
    expect(ctx).toContain('GHSA-rfgv-xxqx-mfg5');
    expect(ctx).toContain('GHSA-w293-vg96-wgc3');
  });

  it('overrides brace-expansion 1.x to >=1.1.20 <2, citing both advisories', () => {
    const idx = findLineIndexContaining(workspaceYaml, /brace-expansion@1(\.\S+)?:\s*">=1\.1\.20 <2"/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const ctx = nearbyTextBefore(workspaceYaml, idx);
    expect(ctx).toContain('GHSA-qhr7-859c-m2p7');
    expect(ctx).toContain('GHSA-6j4f-fj2g-mc7p');
  });

  it('overrides brace-expansion 5.x to >=5.0.11 <6, citing both advisories', () => {
    const idx = findLineIndexContaining(workspaceYaml, /brace-expansion@5(\.\S+)?:\s*">=5\.0\.11 <6"/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const ctx = nearbyTextBefore(workspaceYaml, idx);
    expect(ctx).toContain('GHSA-qhr7-859c-m2p7');
    expect(ctx).toContain('GHSA-6j4f-fj2g-mc7p');
  });

  it('overrides source-map-js to >=1.2.2 <2, citing its advisory', () => {
    const idx = findLineIndexContaining(workspaceYaml, /source-map-js(@\S+)?:\s*">=1\.2\.2 <2"/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const ctx = nearbyTextBefore(workspaceYaml, idx);
    expect(ctx).toContain('GHSA-68fv-2mgg-jv7q');
  });

  it('overrides sharp to >=0.35.5 <0.36 (upper bound preserved), citing its advisory', () => {
    const idx = findLineIndexContaining(workspaceYaml, /sharp(@\S+)?:\s*">=0\.35\.5 <0\.36"/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const ctx = nearbyTextBefore(workspaceYaml, idx);
    expect(ctx).toContain('GHSA-wq5f-xc86-pv6w');
  });
});

describe('pnpm-workspace.yaml: braces waiver', () => {
  it('ignoreGhsas is exactly the two existing ids plus GHSA-vfj7-8cjw-p6xm', () => {
    const ids = extractIgnoreGhsas(workspaceYaml);
    expect(new Set(ids)).toEqual(
      new Set(['GHSA-qxc2-j82w-r537', 'GHSA-rgj7-g3m4-5g8c', 'GHSA-vfj7-8cjw-p6xm']),
    );
  });

  it('the GHSA-vfj7-8cjw-p6xm entry documents CVE, reason and 2026-11-05 expiry', () => {
    const idx = findLineIndexContaining(workspaceYaml, /-\s*GHSA-vfj7-8cjw-p6xm\s*$/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const ctx = nearbyTextBefore(workspaceYaml, idx, 25).toLowerCase();
    expect(ctx).toContain('cve-2026-93687');
    expect(ctx).toContain('@stoplight/prism-cli');
    expect(ctx).toContain('@stoplight/spectral-cli');
    expect(ctx).toContain('no patched release');
    expect(ctx).toContain('2026-11-05');
  });
});

describe('.trivyignore: braces waiver', () => {
  it('contains exactly the existing undici waiver and the new CVE-2026-93687 waiver', () => {
    const active = trivyIgnore
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
    expect(new Set(active)).toEqual(
      new Set(['CVE-2026-85024 exp:2026-12-31', 'CVE-2026-93687 exp:2026-11-05']),
    );
  });

  it('the CVE-2026-93687 entry documents the reason and 2026-11-05 expiry', () => {
    const idx = findLineIndexContaining(trivyIgnore, /^CVE-2026-93687 exp:2026-11-05$/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const ctx = nearbyTextBefore(trivyIgnore, idx, 25).toLowerCase();
    expect(ctx).toContain('@stoplight/prism-cli');
    expect(ctx).toContain('@stoplight/spectral-cli');
    expect(ctx).toContain('no patched release');
    expect(ctx).toContain('2026-11-05');
  });
});

describe('pnpm-lock.yaml: resolved versions land inside the overridden ranges', () => {
  it('undici resolves to >=7.29.1 <8 everywhere it appears', () => {
    const versions = collectVersions(lockfile, 'undici');
    expect(versions.length).toBeGreaterThan(0);
    for (const v of versions) {
      expect(gte(v, '7.29.1')).toBe(true);
      expect(lt(v, '8.0.0')).toBe(true);
    }
  });

  it('brace-expansion 1.x resolves to >=1.1.20 <2 and 5.x resolves to >=5.0.11 <6', () => {
    const versions = collectVersions(lockfile, 'brace-expansion');
    const major1 = versions.filter((v) => v.startsWith('1.'));
    const major5 = versions.filter((v) => v.startsWith('5.'));
    expect(major1.length).toBeGreaterThan(0);
    expect(major5.length).toBeGreaterThan(0);
    for (const v of major1) {
      expect(gte(v, '1.1.20')).toBe(true);
      expect(lt(v, '2.0.0')).toBe(true);
    }
    for (const v of major5) {
      expect(gte(v, '5.0.11')).toBe(true);
      expect(lt(v, '6.0.0')).toBe(true);
    }
  });

  it('source-map-js resolves to >=1.2.2 <2 everywhere it appears', () => {
    const versions = collectVersions(lockfile, 'source-map-js');
    expect(versions.length).toBeGreaterThan(0);
    for (const v of versions) {
      expect(gte(v, '1.2.2')).toBe(true);
      expect(lt(v, '2.0.0')).toBe(true);
    }
  });

  it('sharp resolves to >=0.35.5 <0.36 everywhere it appears', () => {
    const versions = collectVersions(lockfile, 'sharp');
    expect(versions.length).toBeGreaterThan(0);
    for (const v of versions) {
      expect(gte(v, '0.35.5')).toBe(true);
      expect(lt(v, '0.36.0')).toBe(true);
    }
  });
});
