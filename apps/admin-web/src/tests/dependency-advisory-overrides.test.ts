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

function nearbyTextBefore(text: string, lineIndex: number, before = 25): string {
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

function activeTrivyLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
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

  it('does not override sharp (owner declined: no parent release ships a patched sharp)', () => {
    expect(/^\s*sharp(@\S+)?:\s*"/m.test(workspaceYaml)).toBe(false);
  });

  it('does not override braces (no patched release exists)', () => {
    expect(/^\s*braces(@\S+)?:\s*"/m.test(workspaceYaml)).toBe(false);
  });
});

describe('pnpm-workspace.yaml: braces, sharp and zod waivers', () => {
  it('ignoreGhsas is exactly the two existing ids plus the braces, sharp and zod waivers', () => {
    const ids = extractIgnoreGhsas(workspaceYaml);
    expect(new Set(ids)).toEqual(
      new Set([
        'GHSA-mrhx-c7xc-m3w5',
        'GHSA-qxc2-j82w-r537',
        'GHSA-rgj7-g3m4-5g8c',
        'GHSA-vfj7-8cjw-p6xm',
        'GHSA-wq5f-xc86-pv6w',
      ]),
    );
  });

  it('the GHSA-mrhx-c7xc-m3w5 waiver documents the exact pin, the test-pool reason and 2026-11-05 expiry', () => {
    const idx = findLineIndexContaining(workspaceYaml, /^# GHSA-mrhx-c7xc-m3w5 \(high, CVE-2023-54404\)/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const ctx = workspaceYaml.split(/\r?\n/).slice(idx, idx + 12).join('\n').toLowerCase();
    expect(ctx).toContain('@cloudflare/vitest-pool-workers@0.23.0');
    expect(ctx).toContain('pins exactly');
    expect(ctx).toContain('4.6.6');
    expect(ctx).toContain('never in a worker');
    expect(ctx).toContain('2026-11-05');
  });

  it('the GHSA-vfj7-8cjw-p6xm entry documents CVE, reason and 2026-11-05 expiry', () => {
    const idx = findLineIndexContaining(workspaceYaml, /-\s*GHSA-vfj7-8cjw-p6xm\s*$/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const ctx = nearbyTextBefore(workspaceYaml, idx).toLowerCase();
    expect(ctx).toContain('cve-2026-93687');
    expect(ctx).toContain('@stoplight/prism-cli');
    expect(ctx).toContain('@stoplight/spectral-cli');
    expect(ctx).toContain('no patched release');
    expect(ctx).toContain('2026-11-05');
  });

  it('the GHSA-wq5f-xc86-pv6w entry documents the miniflare/sharp reason and 2026-11-05 expiry', () => {
    const idx = findLineIndexContaining(workspaceYaml, /-\s*GHSA-wq5f-xc86-pv6w\s*$/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const ctx = nearbyTextBefore(workspaceYaml, idx).toLowerCase();
    expect(ctx).toContain('miniflare');
    expect(ctx).toContain('sharp');
    expect(ctx).toContain('0.35.5');
    expect(ctx).toContain('2026-11-05');
  });
});

describe('.trivyignore: braces, sharp and zod waivers', () => {
  it('contains exactly the existing undici waiver plus the braces, sharp and zod waivers', () => {
    expect(new Set(activeTrivyLines(trivyIgnore))).toEqual(
      new Set([
        'CVE-2026-85024 exp:2026-12-31',
        'CVE-2026-93687 exp:2026-11-05',
        'GHSA-wq5f-xc86-pv6w exp:2026-11-05',
        'CVE-2023-54404 exp:2026-11-05',
      ]),
    );
  });

  it('the CVE-2023-54404 entry documents the zod advisory, the test-pool reason and 2026-11-05 expiry', () => {
    const idx = findLineIndexContaining(trivyIgnore, /^CVE-2023-54404 exp:2026-11-05$/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const ctx = nearbyTextBefore(trivyIgnore, idx, 14).toLowerCase();
    expect(ctx).toContain('ghsa-mrhx-c7xc-m3w5');
    expect(ctx).toContain('@cloudflare/vitest-pool-workers@0.23.0');
    expect(ctx).toContain('4.6.6');
    expect(ctx).toContain('2026-11-05');
  });

  it('the CVE-2026-93687 entry documents the reason and 2026-11-05 expiry', () => {
    const idx = findLineIndexContaining(trivyIgnore, /^CVE-2026-93687 exp:2026-11-05$/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const ctx = nearbyTextBefore(trivyIgnore, idx).toLowerCase();
    expect(ctx).toContain('@stoplight/prism-cli');
    expect(ctx).toContain('@stoplight/spectral-cli');
    expect(ctx).toContain('no patched release');
    expect(ctx).toContain('2026-11-05');
  });

  it('the GHSA-wq5f-xc86-pv6w entry documents the miniflare/sharp reason and 2026-11-05 expiry', () => {
    const idx = findLineIndexContaining(trivyIgnore, /^GHSA-wq5f-xc86-pv6w exp:2026-11-05$/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const ctx = nearbyTextBefore(trivyIgnore, idx).toLowerCase();
    expect(ctx).toContain('miniflare');
    expect(ctx).toContain('sharp');
    expect(ctx).toContain('0.35.5');
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

  it('sharp keeps the versions its miniflare parents pin, with no override-forced upgrade', () => {
    // 0.35.2 is the miniflare that @cloudflare/vitest-pool-workers pins exactly;
    // 0.35.5 is the miniflare under wrangler 4.149.0. Both waivers stay while 0.35.2 does.
    const versions = collectVersions(lockfile, 'sharp');
    expect(versions.length).toBeGreaterThan(0);
    expect(new Set(versions)).toEqual(new Set(['0.35.2', '0.35.5']));
  });

  it('braces still resolves to 3.0.3 (no fixed release exists to move to)', () => {
    const versions = collectVersions(lockfile, 'braces');
    expect(versions.length).toBeGreaterThan(0);
    expect(versions.every((v) => v === '3.0.3')).toBe(true);
  });

  it('fast-uri resolves to >=3.1.8 <4 everywhere it appears (GHSA-hrr3-gc8f-f4qj)', () => {
    const versions = collectVersions(lockfile, 'fast-uri');
    expect(versions.length).toBeGreaterThan(0);
    for (const v of versions) {
      expect(gte(v, '3.1.8')).toBe(true);
      expect(lt(v, '4.0.0')).toBe(true);
    }
  });

  it('the only zod below 4.6.6 is the 4.4.3 the waived test pool pins', () => {
    const vulnerable = collectVersions(lockfile, 'zod').filter((v) => lt(v, '4.6.6'));
    expect(vulnerable.length).toBeGreaterThan(0);
    expect(new Set(vulnerable)).toEqual(new Set(['4.4.3']));
  });
});

describe('pnpm-workspace.yaml: the fast-uri floor', () => {
  it('overrides fast-uri to >=3.1.8 <4, citing the advisory that raised it', () => {
    const idx = findLineIndexContaining(workspaceYaml, /fast-uri@<3\.1\.8:\s*">=3\.1\.8 <4"/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const ctx = nearbyTextBefore(workspaceYaml, idx);
    expect(ctx).toContain('GHSA-hrr3-gc8f-f4qj');
  });
});
