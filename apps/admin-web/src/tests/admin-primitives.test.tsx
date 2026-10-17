// B5: the admin kit's missing primitives (Checkbox, Tooltip, Toast) and the
// two system-dark defects found while drawing the approved design.
//
// Every test in this file imports from a module that does not exist on
// today's code (shared/ui/checkbox.tsx, shared/ui/tooltip.tsx,
// shared/ui/toast.tsx), so the whole file is expected to fail before the
// change lands.
//
// Two contracts the design spec leaves open are pinned here rather than left
// to the implementer to guess twice:
//   - Tooltip: `<Tooltip label="...">{child control}</Tooltip>` — `label` is
//     the visible/tooltip text, `children` is the one control it wraps.
//   - Toast: `shared/ui/toast.tsx` exports `ToastProvider` (mounts the one
//     persistent live region) and a `useToast()` hook returning `{ enqueue }`,
//     called as `enqueue({ message, detail? })`.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Checkbox } from '@/shared/ui/checkbox';
import { Tooltip } from '@/shared/ui/tooltip';
import { ToastProvider, useToast } from '@/shared/ui/toast';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const adminSrc = path.join(repositoryRoot, 'apps', 'admin-web', 'src');

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ---- No raw checkbox left in console UI -----------------------------------

function sourceFiles(directory: string, out: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(tsx|ts)$/.test(entry)) out.push(full);
  }
  return out;
}

const CHECKBOX_PRIMITIVE = path.join(adminSrc, 'shared', 'ui', 'checkbox.tsx');
const PREVIEW_FILE = path.join(adminSrc, 'features', 'theme', 'preview', 'preview.ts');

describe('no raw checkbox remains in console UI', () => {
  it('finds <input type="checkbox"> only in the checkbox primitive, never elsewhere (the isolated storefront preview is excluded by design)', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(adminSrc)) {
      if (file === CHECKBOX_PRIMITIVE || file === PREVIEW_FILE) continue;
      const relative = path.relative(repositoryRoot, file).replace(/\\/g, '/');
      if (/\/tests\//.test(relative) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(relative)) continue;
      const text = readFileSync(file, 'utf8');
      if (/<input[^>]*\btype=["']checkbox["']/.test(text)) offenders.push(relative);
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

// ---- System dark (decision D-06): the two defects found while drawing -----

describe('system dark mode fixes', () => {
  const css = readFileSync(path.join(adminSrc, 'index.css'), 'utf8');

  function rules(text: string): Array<{ selector: string; body: string }> {
    const found: Array<{ selector: string; body: string }> = [];
    for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      found.push({ selector: match[1].trim(), body: match[2] });
    }
    return found;
  }

  function bodyOf(exactSelector: string): string {
    return rules(css)
      .filter((rule) => rule.selector === exactSelector)
      .map((rule) => rule.body)
      .join('\n');
  }

  it('declares color-scheme on :root and pins .orderak-dark to the dark scheme', () => {
    expect(bodyOf(':root'), css).toMatch(/color-scheme\s*:\s*light\s+dark/);
    expect(bodyOf('.orderak-dark'), css).toMatch(/color-scheme\s*:\s*dark\b/);
  });

  it('gives disabled pagination buttons a visible muted colour, reduced opacity and a not-allowed cursor', () => {
    const paginationButtonRules = rules(css).filter((rule) => /\.pagination\s+button\b/.test(rule.selector));
    const everyBody = paginationButtonRules.map((rule) => rule.body).join('\n');
    expect(everyBody, css).toMatch(/color\s*:\s*var\(--muted\)/);

    const disabledRules = paginationButtonRules.filter((rule) => /:disabled|\[disabled\]/.test(rule.selector));
    const disabledBody = disabledRules.map((rule) => rule.body).join('\n');
    expect(disabledBody, css).toMatch(/opacity\s*:\s*\.?38\b/);
    expect(disabledBody, css).toMatch(/cursor\s*:\s*not-allowed/);
  });
});

// ---- Checkbox ---------------------------------------------------------------

describe('Checkbox', () => {
  it('is a native, labelled checkbox whose whole label toggles onCheckedChange', () => {
    const onCheckedChange = vi.fn();
    render(
      <Checkbox
        checked={false}
        onCheckedChange={onCheckedChange}
        label="Active administrator"
        hint="Can sign in with their role. Turning this off ends their sessions."
      />,
    );
    const input = screen.getByRole('checkbox', { name: 'Active administrator' });
    expect(input).not.toBeChecked();
    expect(screen.getByText(/turning this off ends their sessions/i)).toBeTruthy();

    fireEvent.click(screen.getByText('Active administrator'));
    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});

// ---- Tooltip -----------------------------------------------------------------

describe('Tooltip', () => {
  it('opens immediately on keyboard focus and closes on Escape, repeating the control\'s own aria-label', async () => {
    render(
      <Tooltip label="Previous page">
        <button aria-label="Previous page" />
      </Tooltip>,
    );
    const control = screen.getByRole('button', { name: 'Previous page' });
    expect(screen.queryByText('Previous page')).toBeNull();

    fireEvent.focus(control);
    expect(await screen.findByText('Previous page')).toBeTruthy();

    fireEvent.keyDown(control, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Previous page')).toBeNull());
  });

  it('opens on pointer hover after a short delay and closes on pointer leave', () => {
    vi.useFakeTimers();
    render(
      <Tooltip label="Next page">
        <button aria-label="Next page" />
      </Tooltip>,
    );
    const control = screen.getByRole('button', { name: 'Next page' });
    expect(screen.queryByText('Next page')).toBeNull();

    fireEvent.mouseEnter(control);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText('Next page')).toBeTruthy();

    fireEvent.mouseLeave(control);
    expect(screen.queryByText('Next page')).toBeNull();
  });
});

// ---- Toast --------------------------------------------------------------------

function ToastHarness({ toasts }: { toasts: Array<{ message: string; detail?: string }> }) {
  const { enqueue } = useToast();
  return <button onClick={() => toasts.forEach((toast) => enqueue(toast))}>Fire</button>;
}

describe('Toast', () => {
  it('always mounts one polite status region, and announces an enqueued message with a working Dismiss', async () => {
    render(
      <ToastProvider>
        <ToastHarness toasts={[{ message: 'Runtime configuration saved.' }]} />
      </ToastProvider>,
    );
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(within(region).queryByText('Runtime configuration saved.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Fire' }));
    expect(await within(region).findByText('Runtime configuration saved.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(within(region).queryByText('Runtime configuration saved.')).toBeNull());
  });

  it('shows at most three toasts, newest at the bottom', () => {
    render(
      <ToastProvider>
        <ToastHarness
          toasts={[{ message: 'Toast 1' }, { message: 'Toast 2' }, { message: 'Toast 3' }, { message: 'Toast 4' }]}
        />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fire' }));
    const region = screen.getByRole('status');
    const texts = within(region).getAllByText(/^Toast \d$/).map((node) => node.textContent);
    expect(texts).toEqual(['Toast 2', 'Toast 3', 'Toast 4']);
  });

  it('auto-dismisses after five seconds, pausing the timer while hovered', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <ToastHarness toasts={[{ message: 'Deletion request verified.' }]} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fire' }));
    const region = screen.getByRole('status');
    expect(within(region).getByText('Deletion request verified.')).toBeTruthy();

    act(() => { vi.advanceTimersByTime(4000); });
    expect(within(region).getByText('Deletion request verified.')).toBeTruthy();

    fireEvent.mouseEnter(within(region).getByText('Deletion request verified.'));
    act(() => { vi.advanceTimersByTime(3000); }); // simulated 7s total, hovered since 4s
    expect(within(region).getByText('Deletion request verified.')).toBeTruthy();

    fireEvent.mouseLeave(within(region).getByText('Deletion request verified.'));
    act(() => { vi.advanceTimersByTime(5000); });
    expect(within(region).queryByText('Deletion request verified.')).toBeNull();
  });
});
