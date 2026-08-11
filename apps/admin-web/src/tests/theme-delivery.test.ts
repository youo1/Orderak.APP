import { describe, expect, it } from 'vitest';
import shellHtml from '../../index.html?raw';
import previewHtml from '../../theme-preview.html?raw';
import pageHeaders from '../../public/_headers?raw';

describe('design-system delivery shell', () => {
  it('loads the stable theme stylesheet before the application module', () => {
    const stylesheet = shellHtml.indexOf('href="/theme.css"');
    const application = shellHtml.indexOf('src="/src/app/main.tsx"');
    expect(stylesheet).toBeGreaterThan(-1);
    expect(application).toBeGreaterThan(stylesheet);
  });

  it('keeps the isolated preview offline and script-only', () => {
    expect(previewHtml).toContain("connect-src 'none'");
    expect(previewHtml).toContain("frame-ancestors 'self'");
    expect(previewHtml).not.toContain('/api/v1/');
    expect(pageHeaders).toContain('/theme-preview*');
    expect(pageHeaders).toContain('Cache-Control: no-store');
    expect(pageHeaders).toContain("frame-ancestors 'self'");
    expect(pageHeaders).toContain('X-Frame-Options: SAMEORIGIN');
  });
});
