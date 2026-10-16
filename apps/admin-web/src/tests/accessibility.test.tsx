/**
 * The admin accessibility gate.
 *
 * This suite runs in Vitest Browser Mode (headless Playwright Chromium), not
 * jsdom, because two of the three WCAG checks it enforces are facts about a
 * painted layout: `color-contrast` needs real computed colours against real
 * surfaces, and `target-size` needs real boxes. It imports `src/index.css` so
 * Vite processes the application stylesheet and the generated token and admin
 * imports it pulls in — there is no test-only stylesheet and the theme is never
 * mocked.
 *
 * Every exported component from `src/shared/ui` is rendered in each supported
 * state (default, disabled, invalid/error, open, selected/checked) and every
 * clean fixture is checked in light mode, with `.orderak-dark`, under the
 * `prefers-color-scheme: dark` media emulation, and in RTL Arabic. Three proof
 * tests then inject a single defect each and prove the corresponding axe rule is
 * reported, so a green run cannot mean "the rules stopped running".
 *
 * The repository primitive guard rejects the literal class-name tokens
 * `button`, `field`, `panel` and `modal` anywhere in admin source, so the
 * scratch fixtures below size their elements with inline styles instead.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axe from 'axe-core';
import { cdp } from 'vitest/browser';
import type { ReactNode } from 'react';
import type { ActionConfig } from '@/app/config/actions';
import '../index.css';

import { ActionDialog } from '@/shared/ui/ActionDialog';
import { DataTable, StatusBadge } from '@/shared/ui/DataTable';
import { DetailPanel, ErrorState, LoadingState, PageHeader } from '@/shared/ui/Page';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { askConfirm, ConfirmHost } from '@/shared/ui/confirm';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Slider } from '@/shared/ui/slider';
import { Switch } from '@/shared/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { NativeSelect, Textarea } from '@/shared/ui/textarea';
import { ApiError } from '@/shared/api/client';

// `ActionDialog` reaches the owner step-up through `useStepUp`. The real hook
// would need an authenticated session; the dialog's accessibility does not depend
// on one, so the step-up is stubbed to an available owner and nothing else is
// mocked.
vi.mock('@/shared/api/step-up', () => ({
  STEP_UP_UNAVAILABLE: 'Step-up unavailable.',
  useStepUp: () => ({ available: true, authorize: async () => 'authorization-id' }),
}));

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'] as const;

// axe-core's declarations keep the callback overloads before the promise
// overload, so `ReturnType<typeof axe.run>` collapses to `void`; name the
// result types from the module namespace instead. The options object is passed
// inline so `type: 'tag'` is contextually typed by the `axe.run(context,
// options): Promise<T>` overload, and the call is always made without a
// callback and annotated with the result type.
type AxeResults = axe.AxeResults;
type AxeResult = axe.Result;
type AxeNode = axe.NodeResult;

interface Mode {
  name: string;
  dir: 'ltr' | 'rtl';
  lang: string;
  rootClass?: string;
  colorScheme: 'light' | 'dark';
}

const MODES: Mode[] = [
  { name: 'light', dir: 'ltr', lang: 'en', colorScheme: 'light' },
  { name: '.orderak-dark', dir: 'ltr', lang: 'en', rootClass: 'orderak-dark', colorScheme: 'light' },
  { name: 'prefers-color-scheme: dark', dir: 'ltr', lang: 'en', colorScheme: 'dark' },
  { name: 'RTL Arabic', dir: 'rtl', lang: 'ar', colorScheme: 'light' },
];

type EmulationSession = { send: (method: string, params?: Record<string, unknown>) => Promise<unknown> };

let emulation: EmulationSession | null = null;

async function emulationSession(): Promise<EmulationSession> {
  if (!emulation) emulation = (await cdp()) as unknown as EmulationSession;
  return emulation;
}

/** Emulate `prefers-color-scheme`; `null` clears the override entirely. */
async function setEmulatedColorScheme(value: 'light' | 'dark' | null): Promise<void> {
  const session = await emulationSession();
  await session.send('Emulation.setEmulatedMedia', {
    media: '',
    features: value === null ? [] : [{ name: 'prefers-color-scheme', value }],
  });
}

/**
 * The one narrowly scoped per-node exception in this gate.
 *
 * Radix Select calls the `aria-hidden` package's `hideOthers` while its popup is
 * open, which stamps `aria-hidden="true"` on every sibling of the portal —
 * including the trigger. The trigger is a focusable `role="combobox"` by design,
 * but focus has moved into the listbox for as long as the popup is open, so
 * axe's `aria-hidden-focus` rule (its `focusable-disabled` check) reports that
 * the trigger is focusable inside an `aria-hidden` region. That is a known
 * Radix/axe interaction rather than evidence the control is unreachable: the
 * trigger is not tabbable while the popup owns focus.
 *
 * The exception names the rule and is scoped to the exact node: the finding is
 * dropped only when every focusable element it names is an open select combobox
 * (`role="combobox"` with `aria-expanded="true"` and an `aria-controls` link to
 * the listbox). Any other focusable content hidden with `aria-hidden` keeps its
 * finding and still fails the suite.
 */
function isOpenSelectCombobox(html: string): boolean {
  return /role="combobox"/.test(html) && /aria-expanded="true"/.test(html) && /aria-controls=/.test(html);
}

function withoutRadixSelectException(result: AxeResult): AxeResult | null {
  if (result.id !== 'aria-hidden-focus') return result;
  const nodes = result.nodes.filter((node: AxeNode) => {
    const related = [...node.all, ...node.any, ...node.none].flatMap(check => check.relatedNodes ?? []);
    // A finding that does not name a concrete control is not this exception; keep it.
    if (!related.length) return true;
    return !related.every(relatedNode => isOpenSelectCombobox(relatedNode.html));
  });
  if (!nodes.length) return null;
  if (nodes.length === result.nodes.length) return result;
  return { ...result, nodes };
}

function blockingIssues(results: AxeResults): AxeResult[] {
  return [
    ...results.violations,
    ...results.incomplete.filter((result: AxeResult) => result.id === 'color-contrast' || result.id === 'target-size'),
  ]
    .map(withoutRadixSelectException)
    .filter((result): result is AxeResult => result !== null);
}

function formatIssues(issues: AxeResult[]): string {
  return issues.map((issue: AxeResult) => `${issue.id} (${issue.impact}): ${issue.help} :: ${issue.nodes.map((node: AxeNode) => node.target.join(' ')).join(', ')}`).join('\n');
}

/** Let fonts load, floating-ui place portals, and two frames paint. */
async function settle(): Promise<void> {
  try {
    await document.fonts.ready;
  } catch {
    /* Font loading is best effort; layout still settles on the next frame. */
  }
  await new Promise<void>(resolve => setTimeout(resolve, 50));
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

async function applyMode(mode: Mode): Promise<void> {
  const root = document.documentElement;
  root.classList.toggle('orderak-dark', mode.rootClass === 'orderak-dark');
  root.setAttribute('dir', mode.dir);
  root.setAttribute('lang', mode.lang);
  await setEmulatedColorScheme(mode.colorScheme);
}

async function runAxe(): Promise<AxeResults> {
  const results: axe.AxeResults = await axe.run(document.body, {
    runOnly: { type: 'tag', values: [...WCAG_TAGS] },
  });
  return results;
}

interface CheckOptions {
  /** Puts the fixture into the state under test after it renders (clicks, typed input), in every mode. */
  prepare?: () => Promise<void>;
  /** A selector that must match before axe runs, so a state that failed to render cannot pass vacuously. */
  rendered?: string;
}

async function checkEveryMode(label: string, fixture: () => ReactNode, options: CheckOptions = {}): Promise<void> {
  for (const mode of MODES) {
    await applyMode(mode);
    cleanup();
    // Page-like padding. Real pages never paint a component hard against the
    // viewport edge, and some fixtures (the badge especially) resolve their
    // background against the surface beneath them: with no padding the text's
    // client rect can reach past the body edge and axe reports the contrast as
    // an incomplete result instead of reading the real background. The padding
    // gives every fixture the same ordinary inset a section has in the app.
    render(<div style={{ padding: 24 }}>{fixture()}</div>);
    await settle();
    if (options.prepare) {
      await options.prepare();
      await settle();
    }
    if (options.rendered) {
      expect(document.querySelector(options.rendered), `${label} [${mode.name}]: ${options.rendered} did not render`).not.toBeNull();
    }
    const results = await runAxe();
    const issues = blockingIssues(results);
    expect(issues, `${label} [${mode.name}]\n${formatIssues(issues)}`).toEqual([]);
    cleanup();
  }
}

beforeAll(() => {
  document.title = 'Orderak admin accessibility suite';
  document.documentElement.setAttribute('lang', 'en');
  document.documentElement.setAttribute('dir', 'ltr');
});

afterEach(async () => {
  cleanup();
  const root = document.documentElement;
  root.classList.remove('orderak-dark');
  root.setAttribute('dir', 'ltr');
  root.setAttribute('lang', 'en');
  await setEmulatedColorScheme(null);
});

// ---- Clean fixtures -------------------------------------------------------

// The kit is checked one component or small state group at a time rather than
// as one combined page. In a single tall fixture an inline element can end up
// adjacent to a block box closely enough that axe reports `color-contrast` as
// an incomplete `elmPartiallyObscured` result for text that is legible on its
// own. Keeping each group small means nothing sits over anything else; open
// overlays already get a fixture of their own below.

describe('admin kit accessibility', () => {
  it('has no blocking axe findings for the page header and page states', async () => {
    await checkEveryMode('page header and page states', () => (
      <main>
        <PageHeader
          title="Stores"
          description="Manage every store on the platform."
          actions={<Button>New store</Button>}
        />
        <LoadingState />
        <ErrorState error={new Error('Network request failed')} retry={() => undefined} />
        <ErrorState error={new ApiError(403, 'forbidden', 'Forbidden')} retry={() => undefined} />
      </main>
    ));
  }, 120_000);

  it('has no blocking axe findings for the alert', async () => {
    await checkEveryMode('alert', () => (
      <main>
        <Alert>
          <AlertTitle>Heads up</AlertTitle>
          <AlertDescription>This is an inline alert.</AlertDescription>
        </Alert>
      </main>
    ));
  }, 120_000);

  it('has no blocking axe findings for the badge', async () => {
    await checkEveryMode('badge', () => (
      <main>
        <Badge>Active</Badge>
      </main>
    ));
  }, 120_000);

  it('has no blocking axe findings for the button variants and sizes', async () => {
    await checkEveryMode('buttons', () => (
      <main>
        <Button>Save</Button>
        <Button variant="outline">Cancel</Button>
        <Button variant="destructive">Delete</Button>
        <Button variant="ghost">Ghost</Button>
        <Button size="sm">Small</Button>
        <Button size="lg">Large</Button>
        <Button disabled>Disabled</Button>
      </main>
    ));
  }, 120_000);

  it('has no blocking axe findings for the form controls', async () => {
    await checkEveryMode('form controls', () => (
      <main>
        <Label htmlFor="kit-name">Name</Label>
        <Input id="kit-name" defaultValue="North Market" />
        <Input aria-label="Disabled input" disabled defaultValue="Locked" />
        <Input aria-label="Invalid input" aria-invalid="true" defaultValue="Bad value" />
        <Field label="Email address" hint="We never share it.">
          <Input type="email" defaultValue="owner@example.com" />
        </Field>
        <Textarea aria-label="Notes" defaultValue="Some notes" />
        <Textarea aria-label="Disabled notes" disabled defaultValue="Locked" />
        <Textarea aria-label="Invalid notes" aria-invalid="true" defaultValue="Bad value" />
        <NativeSelect aria-label="Role" defaultValue="owner">
          <option value="owner">Owner</option>
          <option value="staff">Staff</option>
        </NativeSelect>
        <NativeSelect aria-label="Disabled role" disabled defaultValue="owner">
          <option value="owner">Owner</option>
        </NativeSelect>
        <NativeSelect aria-label="Invalid role" aria-invalid="true" defaultValue="owner">
          <option value="owner">Owner</option>
        </NativeSelect>
      </main>
    ));
  }, 120_000);

  it('has no blocking axe findings for the switches', async () => {
    await checkEveryMode('switches', () => (
      <main>
        <Switch aria-label="Enable alerts" />
        <Switch aria-label="Checked switch" defaultChecked />
        <Switch aria-label="Disabled switch" disabled />
      </main>
    ));
  }, 120_000);

  it('has no blocking axe findings for the tabs', async () => {
    await checkEveryMode('tabs', () => (
      <main>
        <Tabs defaultValue="general">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
          </TabsList>
          <TabsContent value="general">General settings</TabsContent>
          <TabsContent value="advanced">Advanced settings</TabsContent>
        </Tabs>
      </main>
    ));
  }, 120_000);

  it('has no blocking axe findings for the card', async () => {
    await checkEveryMode('card', () => (
      <main>
        <Card>
          <CardHeader>
            <CardTitle>Current plan</CardTitle>
            <CardDescription>Your billing plan</CardDescription>
          </CardHeader>
          <CardContent>Plan body text</CardContent>
        </Card>
      </main>
    ));
  }, 120_000);

  it('has no blocking axe findings for the status badges', async () => {
    await checkEveryMode('status badges', () => (
      <main>
        <StatusBadge value="active" />
        <StatusBadge value="critical" />
        <StatusBadge value="pending" />
        <StatusBadge value="something-neutral" />
      </main>
    ));
  }, 120_000);

  it('has no blocking axe findings for the data table', async () => {
    await checkEveryMode('data table', () => (
      <main>
        <DataTable
          rows={[
            { id: 1, store_name: 'North Market', status: 'active' },
            { id: 2, store_name: 'South Market', status: 'critical' },
          ]}
          preferred={['store_name', 'status']}
          onSelect={() => undefined}
        />
      </main>
    ));
  }, 120_000);

  it('has no blocking axe findings for the empty data table', async () => {
    await checkEveryMode('data table empty', () => (
      <main>
        <DataTable rows={[]} preferred={['store_name', 'status']} onSelect={() => undefined} />
      </main>
    ), { rendered: '.empty-state' });
  }, 120_000);

  it('has no blocking axe findings for the slider in default and disabled states', async () => {
    await checkEveryMode('slider', () => (
      <main>
        <Slider aria-label="Opacity" defaultValue={[40]} />
        <Slider aria-label="Disabled opacity" defaultValue={[70]} disabled />
      </main>
    ));
  }, 120_000);

  it('has no blocking axe findings for the open dialog', async () => {
    await checkEveryMode('dialog', () => (
      <Dialog open onOpenChange={() => undefined}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete store</DialogTitle>
            <DialogDescription>This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline">Cancel</Button>
            <Button variant="destructive">Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ));
  }, 120_000);

  it('has no blocking axe findings for the open confirm dialog', async () => {
    // The host is remounted in every mode and reads the pending confirmation when
    // it mounts; `rendered` proves each mode audited an open alertdialog.
    askConfirm('Delete this record?', () => undefined);
    await checkEveryMode('confirm', () => <ConfirmHost />, { rendered: '[role="alertdialog"]' });
  }, 120_000);

  it('has no blocking axe findings for the closed select, enabled and disabled', async () => {
    await checkEveryMode('select closed', () => (
      <main>
        <Select defaultValue="active">
          <SelectTrigger aria-label="Store status">
            <SelectValue placeholder="Choose status" />
          </SelectTrigger>
          <SelectContent aria-label="Store status options">
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
          </SelectContent>
        </Select>
        <Select disabled>
          <SelectTrigger aria-label="Disabled store status">
            <SelectValue placeholder="Unavailable" />
          </SelectTrigger>
        </Select>
      </main>
    ), { rendered: '[role="combobox"]:not([disabled])' });
  }, 120_000);

  it('has no blocking axe findings for the open select', async () => {
    await checkEveryMode('select', () => (
      <main>
        <Select open onOpenChange={() => undefined} defaultValue="active">
          <SelectTrigger aria-label="Store status">
            <SelectValue placeholder="Choose status" />
          </SelectTrigger>
          <SelectContent aria-label="Store status options">
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
          </SelectContent>
        </Select>
      </main>
    ));
  }, 120_000);

  it('has no blocking axe findings for the open action dialog', async () => {
    const config: ActionConfig = {
      label: 'Update store',
      endpoint: '/api/admin/v1/stores',
      method: 'PATCH',
      permission: 'stores:manage',
      description: 'Update the selected store record.',
      fields: [
        { name: 'store_name', label: 'Store name', type: 'text', required: true, defaultValue: 'North Market' },
        { name: 'branch_count', label: 'Branch count', type: 'number', defaultValue: 3 },
        { name: 'notes', label: 'Notes', type: 'textarea', defaultValue: 'Steady growth' },
        { name: 'region', label: 'Region', type: 'select', options: ['North', 'South'], defaultValue: 'North' },
        { name: 'launch_at', label: 'Launch at', type: 'datetime', defaultValue: '2026-01-01T10:00' },
        { name: 'active', label: 'Active', type: 'checkbox', defaultValue: true },
      ],
    };
    await checkEveryMode('action dialog', () => (
      <QueryClientProvider client={new QueryClient()}>
        <ActionDialog config={config} resourceKey="stores" close={() => undefined} />
      </QueryClientProvider>
    ), { rendered: '[role="dialog"]' });

    // Invalid: a required field is empty, so the submit button is disabled.
    const invalid: ActionConfig = {
      ...config,
      fields: config.fields.map(field => field.name === 'store_name' ? { ...field, defaultValue: '' } : field),
    };
    await checkEveryMode('action dialog invalid', () => (
      <QueryClientProvider client={new QueryClient()}>
        <ActionDialog config={invalid} resourceKey="stores" close={() => undefined} />
      </QueryClientProvider>
    ), { rendered: '[role="dialog"] button:disabled' });

    // Failed request: the API answers 500 and the dialog shows the error text.
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(async () => new Response(
      JSON.stringify({ code: 'internal', detail: 'The store could not be updated.' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    ));
    try {
      await checkEveryMode('action dialog error', () => (
        <QueryClientProvider client={new QueryClient()}>
          <ActionDialog config={config} resourceKey="stores" close={() => undefined} />
        </QueryClientProvider>
      ), {
        prepare: async () => {
          const submit = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
            .find(button => button.textContent === config.label);
          submit?.click();
          for (let i = 0; i < 40 && !document.querySelector('[role="dialog"] .error-text'); i += 1) {
            await new Promise<void>(resolve => setTimeout(resolve, 25));
          }
        },
        rendered: '[role="dialog"] .error-text',
      });
    } finally {
      fetchSpy.mockRestore();
    }
  }, 240_000);

  it('has no blocking axe findings for a populated detail panel', async () => {
    await checkEveryMode('detail panel populated', () => (
      <DetailPanel
        title="North Market"
        row={{ store_name: 'North Market', status: 'active', metadata: { city: 'Cairo' }, notes: 'Steady growth' }}
        onClose={() => undefined}
        actions={<Button variant="outline">Edit</Button>}
      />
    ));
  }, 120_000);

  it('has no blocking axe findings for an empty detail panel', async () => {
    await checkEveryMode('detail panel empty', () => (
      <DetailPanel title="Empty record" row={{}} onClose={() => undefined} />
    ));
  }, 120_000);
});

// ---- Proof tests ----------------------------------------------------------

describe('the axe gate detects injected defects', () => {
  it('reports an unnamed control as button-name', async () => {
    render(<button type="button" />);
    await settle();
    const results = await runAxe();
    // The gate's own filter must fail on it: an incomplete result the gate lets through is not detection.
    const issues = blockingIssues(results);
    expect(issues.some(result => result.id === 'button-name'), formatIssues(issues)).toBe(true);
  });

  it('reports two 16x16 CSS-pixel targets with no spacing as target-size', async () => {
    render(
      <div style={{ display: 'flex', gap: 0 }}>
        <button type="button" aria-label="Tiny target one" style={{ width: 16, height: 16, padding: 0, border: 0 }} />
        <button type="button" aria-label="Tiny target two" style={{ width: 16, height: 16, padding: 0, border: 0 }} />
      </div>,
    );
    await settle();
    const results = await runAxe();
    // The gate's own filter must fail on it: an incomplete result the gate lets through is not detection.
    const issues = blockingIssues(results);
    expect(issues.some(result => result.id === 'target-size'), formatIssues(issues)).toBe(true);
  });

  it('reports body text below 4.5:1 contrast as color-contrast', async () => {
    render(<p style={{ color: '#a8a8a8', backgroundColor: '#ffffff', margin: 0 }}>Low contrast body text</p>);
    await settle();
    const results = await runAxe();
    // The gate's own filter must fail on it: an incomplete result the gate lets through is not detection.
    const issues = blockingIssues(results);
    expect(issues.some(result => result.id === 'color-contrast'), formatIssues(issues)).toBe(true);
  });
});
