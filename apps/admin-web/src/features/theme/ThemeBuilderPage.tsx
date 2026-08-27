import { Hct, argbFromHex, hexFromArgb } from '@material/material-color-utilities';
import { AlertTriangle, Check, History, RotateCcw, Save, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api } from '@/shared/api/client';
import { useAuth } from '@/features/auth/auth-context';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Slider } from '@/shared/ui/slider';
import { Switch } from '@/shared/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import type { ActiveRevision, ContrastName, DesignSystemSource, RevisionSummary, Snapshot, ThemeGetResponse, ThemeMode } from './types';
import { RECOVERY_DAYS_MS, clone, deepEqual, patchChanged, recoveryIsCurrent, recoveryKey } from './theme-utils';

const COLOR_SEEDS = ['primary', 'secondary', 'tertiary', 'error', 'warning', 'success', 'information'] as const;
const PRESETS: Record<string, number> = { Compact: 0.94, Standard: 1, Large: 1.08 };

interface Recovery { expiresAt: number; original: DesignSystemSource; source: DesignSystemSource }
interface ConflictState { original: ActiveRevision; current: ActiveRevision; localSource: DesignSystemSource }

function humanize(value: string) { return value.replace(/[A-Z]/g, letter => ` ${letter.toLowerCase()}`).replace(/^./, letter => letter.toUpperCase()); }

function HctControls({ value, onChange }: { value: string; onChange(value: string): void }) {
  const hct = useMemo(() => Hct.fromInt(argbFromHex(value)), [value]);
  const update = (field: 'hue' | 'chroma' | 'tone', next: number) => {
    const changed = Hct.from(hct.hue, hct.chroma, hct.tone);
    changed[field] = next;
    onChange(hexFromArgb(changed.toInt()).toUpperCase());
  };
  return <div className="hct-grid">
    {([
      ['Hue', 'hue', hct.hue, 0, 360],
      ['Chroma', 'chroma', hct.chroma, 0, 150],
      ['Tone', 'tone', hct.tone, 0, 100],
    ] as const).map(([label, field, current, min, max]) => <label key={field}>
      <span>{label} <output>{Math.round(current)}</output></span>
      <Slider min={min} max={max} step={1} value={[current]} onValueChange={values => update(field, values[0])} aria-label={`${label} for ${value}`} />
    </label>)}
  </div>;
}

function SeedEditor({ name, value, expert, onChange }: { name: typeof COLOR_SEEDS[number]; value: string; expert: boolean; onChange(value: string): void }) {
  if (['error', 'warning', 'success', 'information'].includes(name) && !expert) return null;
  return <Card className="seed-card">
    <CardHeader><CardTitle>{humanize(name)}</CardTitle><CardDescription>{value}</CardDescription></CardHeader>
    <CardContent>
      <div className="color-input-row">
        <input aria-label={`${name} color picker`} type="color" value={value} onChange={event => onChange(event.target.value.toUpperCase())} />
        <Input aria-label={`${name} hex value`} value={value} maxLength={7} pattern="#[0-9A-Fa-f]{6}" onChange={event => /^#[0-9A-Fa-f]{0,6}$/.test(event.target.value) && onChange(event.target.value.toUpperCase())} />
      </div>
      {/^#[0-9A-F]{6}$/.test(value) && <HctControls value={value} onChange={onChange} />}
    </CardContent>
  </Card>;
}

function PreviewFrame({ snapshot }: { snapshot: Snapshot | null }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== ref.current?.contentWindow) return;
      if (event.data?.type === 'orderak-theme-preview-ready') setReady(true);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
  useEffect(() => {
    if (!ready || !snapshot || !ref.current?.contentWindow) return;
    const payload = { type: 'orderak-theme-preview', schemaVersion: 2, snapshot };
    if (new Blob([JSON.stringify(payload)]).size <= 128 * 1024) ref.current.contentWindow.postMessage(payload, window.location.origin);
  }, [ready, snapshot]);
  return <iframe ref={ref} title="Isolated design system preview" className="theme-preview-frame" src="/theme-preview?schema=2" sandbox="allow-scripts allow-same-origin" />;
}

function GeneratorUpgradeDiff({ active, regenerated }: { active: Snapshot; regenerated: Snapshot }) {
  const rows = useMemo(() => {
    const before = {
      schemes: active.schemes,
      semantic: active.semantic,
      typography: active.typography,
      spacing: active.spacing,
      shapes: active.shapes,
      components: active.components,
    };
    const after = {
      schemes: regenerated.schemes,
      semantic: regenerated.semantic,
      typography: regenerated.typography,
      spacing: regenerated.spacing,
      shapes: regenerated.shapes,
      components: regenerated.components,
    };
    const changes: Array<{ path: string; before: unknown; after: unknown }> = [];
    const visit = (left: unknown, right: unknown, path: string) => {
      if (Object.is(left, right)) return;
      if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
        const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
        keys.forEach(key => visit((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], path ? `${path}.${key}` : key));
        return;
      }
      if (JSON.stringify(left) !== JSON.stringify(right)) changes.push({ path, before: left, after: right });
    };
    visit(before, after, '');
    return changes;
  }, [active, regenerated]);

  return <details className="generator-diff">
    <summary>Review {rows.length} generated token {rows.length === 1 ? 'change' : 'changes'}</summary>
    {rows.length === 0
      ? <p>The pinned generator version changed, but this source produces the same token values.</p>
      : <div className="generator-diff-table" role="table" aria-label="Generator upgrade token differences">
          <div className="generator-diff-header" role="row"><strong>Token</strong><strong>Active snapshot</strong><strong>Regenerated</strong></div>
          {rows.slice(0, 100).map(row => <div className="generator-diff-row" role="row" key={row.path}>
            <code>{row.path}</code><span>{JSON.stringify(row.before)}</span><span>{JSON.stringify(row.after)}</span>
          </div>)}
          {rows.length > 100 && <p>Showing the first 100 changes. Publication still validates the complete regenerated snapshot.</p>}
        </div>}
  </details>;
}

export default function ThemeBuilderPage() {
  const auth = useAuth();
  const [payload, setPayload] = useState<ThemeGetResponse | null>(null);
  const [original, setOriginal] = useState<ActiveRevision | null>(null);
  const [source, setSource] = useState<DesignSystemSource | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [expert, setExpert] = useState(false);
  const [previewMode, setPreviewMode] = useState<ThemeMode>('light');
  const [previewContrast, setPreviewContrast] = useState<ContrastName>('standard');
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [message, setMessage] = useState('');
  const [applyOpen, setApplyOpen] = useState(false);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const dirty = Boolean(original && source && !deepEqual(original.source, source));
  const canApply = auth.can('theme:manage');

  const load = useCallback(async () => {
    const result = await api<ThemeGetResponse>('/api/admin/v1/theme');
    setPayload(result);
    setOriginal(result.active);
    setSource(clone(result.active.source));
    setSnapshot(result.active.snapshot);
    const saved = localStorage.getItem(recoveryKey(auth.admin!.id, result.active.id));
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Recovery;
        if (recoveryIsCurrent(parsed.expiresAt)) setRecovery(parsed);
        else localStorage.removeItem(recoveryKey(auth.admin!.id, result.active.id));
      } catch { localStorage.removeItem(recoveryKey(auth.admin!.id, result.active.id)); }
    }
  }, [auth.admin]);

  useEffect(() => { load().catch(error => setMessage(error instanceof Error ? error.message : 'Unable to load design system')).finally(() => setLoading(false)); }, [load]);
  useEffect(() => {
    if (!source || !original || !dirty) return;
    const timer = window.setTimeout(() => localStorage.setItem(recoveryKey(auth.admin!.id, original.id), JSON.stringify({
      expiresAt: Date.now() + RECOVERY_DAYS_MS, original: original.source, source,
    } satisfies Recovery)), 350);
    return () => window.clearTimeout(timer);
  }, [source, original, dirty, auth.admin]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  useEffect(() => {
    if (!source || !original) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setPreviewing(true);
      api<{ snapshot: Snapshot }>('/api/admin/v1/theme/preview', {
        method: 'POST', body: JSON.stringify({ source }), signal: controller.signal,
      }).then(result => setSnapshot(result.snapshot)).catch(error => {
        if (error instanceof ApiError && error.status === 422 && typeof error.details === 'object') {
          const candidate = (error.details as { snapshot?: Snapshot }).snapshot;
          if (candidate) setSnapshot(candidate);
        } else if ((error as Error).name !== 'AbortError') setMessage((error as Error).message);
      }).finally(() => setPreviewing(false));
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [source, original]);

  const changeSource = <K extends keyof DesignSystemSource>(section: K, next: Partial<DesignSystemSource[K]>) => {
    setSource(current => current ? { ...current, [section]: { ...current[section], ...next } } : current);
  };
  const reset = () => { if (payload) setSource(clone(payload.defaults)); };
  const applyCurrent = async () => {
    if (!original || !source) return;
    try {
      const result = await api<{ active: ActiveRevision }>('/api/admin/v1/theme', {
        method: 'PUT', body: JSON.stringify({ baseRevisionId: original.id, source }),
      });
      localStorage.removeItem(recoveryKey(auth.admin!.id, original.id));
      setPayload(current => current ? { ...current, activeRevisionId: result.active.id, active: result.active } : current);
      setOriginal(result.active); setSource(clone(result.active.source)); setSnapshot(result.active.snapshot);
      setApplyOpen(false); setMessage(`Revision ${result.active.id} is now current.`);
      applySnapshotToAdmin(result.active.snapshot);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const current = (await api<ThemeGetResponse>('/api/admin/v1/theme')).active;
        setConflict({ original, current, localSource: source });
        setApplyOpen(false);
      } else setMessage(error instanceof Error ? error.message : 'Unable to apply this configuration');
    }
  };
  const rebase = () => {
    if (!conflict) return;
    setSource(patchChanged(conflict.original.source, conflict.current.source, conflict.localSource));
    setOriginal(conflict.current); setConflict(null); setMessage('Local changes rebased. Review the new preview before publishing.');
  };

  if (loading || !source || !original) return <div className="page"><p>Loading design system…</p></div>;
  const typePreset = Object.entries(PRESETS).find(([, value]) => value === source.typography.multiplier)?.[0] ?? 'Custom';
  const roles = snapshot?.schemes[previewContrast][previewMode] ?? {};

  return <div className="page theme-builder-page">
    <div className="page-header">
      <div><p className="eyebrow">DESIGN SYSTEM</p><h1>Theme Builder</h1><p>Generate accessible Android and web tokens from protected brand primitives.</p></div>
      <div className="page-actions">
        <Badge>Revision {original.id}</Badge>
        <Button variant="outline" onClick={reset}><RotateCcw className="size-4" /> Reset to defaults</Button>
        <Button disabled={!canApply || !dirty || !snapshot?.validation.valid || previewing} onClick={() => setApplyOpen(true)}><Save className="size-4" /> Apply as current</Button>
      </div>
    </div>
    {message && <Alert><AlertTitle>Status</AlertTitle><AlertDescription>{message}</AlertDescription></Alert>}
    {payload?.generatorUpgradePreview && <Alert className="upgrade-alert"><AlertTriangle className="size-4" /><AlertTitle>Generator upgrade requires review</AlertTitle><AlertDescription>{payload.generatorUpgradePreview.from} → {payload.generatorUpgradePreview.to}. The active source has been regenerated for comparison; publication is never automatic.</AlertDescription><GeneratorUpgradeDiff active={original.snapshot} regenerated={payload.generatorUpgradePreview.snapshot} /></Alert>}
    {recovery && <Alert><AlertTitle>Unsaved edits found</AlertTitle><AlertDescription>Edits from this revision are available for seven days.</AlertDescription><div className="alert-actions"><Button size="sm" onClick={() => { setSource(recovery.source); setRecovery(null); }}>Restore edits</Button><Button size="sm" variant="outline" onClick={() => { localStorage.removeItem(recoveryKey(auth.admin!.id, original.id)); setRecovery(null); }}>Discard</Button></div></Alert>}
    <div className="theme-builder-layout">
      <main>
        <Tabs defaultValue="colors">
          <TabsList>
            <TabsTrigger value="colors">Colors</TabsTrigger><TabsTrigger value="typography">Typography</TabsTrigger>
            <TabsTrigger value="spacing">Spacing &amp; shapes</TabsTrigger><TabsTrigger value="roles">Generated roles</TabsTrigger>
            <TabsTrigger value="history">Revision history</TabsTrigger>
          </TabsList>
          <TabsContent value="colors">
            <Card><CardHeader><CardTitle>Generation controls</CardTitle><CardDescription>Hex is persisted. HCT is a synchronized editing view.</CardDescription></CardHeader><CardContent className="builder-control-grid">
              <FieldSelect label="Scheme variant" value={source.colors.variant} options={['tonal-spot','vibrant','expressive','fidelity','content','neutral','monochrome']} onChange={value => changeSource('colors', { variant: value as DesignSystemSource['colors']['variant'] })} />
              <FieldSelect label="Surface temperature" value={source.colors.surfaceTemperature} options={['cool','neutral','warm']} onChange={value => changeSource('colors', { surfaceTemperature: value as DesignSystemSource['colors']['surfaceTemperature'] })} />
              <FieldSelect label="Published contrast" value={source.colors.defaultContrast} options={['standard','medium','high']} onChange={value => changeSource('colors', { defaultContrast: value as ContrastName })} />
              <div className="switch-field"><div><Label>Expert semantic seeds</Label><p>Unlock error, warning, success and information seeds.</p></div><Switch checked={expert} onCheckedChange={setExpert} aria-label="Expert semantic seed controls" /></div>
            </CardContent></Card>
            <div className="seed-grid">{COLOR_SEEDS.map(name => <SeedEditor key={name} name={name} value={source.colors[name]} expert={expert} onChange={value => changeSource('colors', { [name]: value })} />)}</div>
          </TabsContent>
          <TabsContent value="typography">
            <Card><CardHeader><CardTitle>Typography</CardTitle><CardDescription>The preset and multiplier are one value. OS/browser scaling is applied afterward.</CardDescription></CardHeader><CardContent className="builder-control-grid">
              <FieldSelect label="Approved family" value={source.typography.family} options={['cairo','tajawal','noto-arabic']} onChange={value => changeSource('typography', { family: value as DesignSystemSource['typography']['family'] })} />
              <FieldSelect label="Scale preset" value={typePreset} options={['Compact','Standard','Large','Custom']} onChange={value => value !== 'Custom' && changeSource('typography', { multiplier: PRESETS[value] })} />
              <div><Label htmlFor="type-multiplier">Custom multiplier: {source.typography.multiplier.toFixed(2)}</Label><Slider id="type-multiplier" min={0.9} max={1.15} step={0.01} value={[source.typography.multiplier]} onValueChange={values => changeSource('typography', { multiplier: values[0] })} /></div>
            </CardContent></Card>
            <Card className="token-table-card"><CardHeader><CardTitle>15 generated roles</CardTitle></CardHeader><CardContent><TokenTable entries={snapshot?.typography.roles ?? {}} /></CardContent></Card>
          </TabsContent>
          <TabsContent value="spacing">
            <Card><CardHeader><CardTitle>Spacing and density</CardTitle><CardDescription>Spacing changes padding and gaps, never the fixed 48dp touch target.</CardDescription></CardHeader><CardContent className="builder-control-grid">
              <div><Label htmlFor="base-spacing">Base unit: {source.spacing.baseUnit}</Label><Slider id="base-spacing" min={2} max={8} step={0.5} value={[source.spacing.baseUnit]} onValueChange={values => changeSource('spacing', { baseUnit: values[0] })} /></div>
              <FieldSelect label="Density" value={source.spacing.density} options={['compact','comfortable','spacious']} onChange={value => changeSource('spacing', { density: value as DesignSystemSource['spacing']['density'] })} />
              <FieldSelect label="Shape preset" value={source.shapes.preset} options={['sharp','balanced','rounded','custom']} onChange={value => changeSource('shapes', { preset: value as DesignSystemSource['shapes']['preset'] })} />
              {source.shapes.preset === 'custom' && <div><Label>Base radius: {source.shapes.baseRadius ?? 12}dp</Label><Slider min={0} max={24} step={0.5} value={[source.shapes.baseRadius ?? 12]} onValueChange={values => changeSource('shapes', { baseRadius: values[0] })} /></div>}
            </CardContent></Card>
            <div className="summary-grid"><Card><CardHeader><CardTitle>Spacing</CardTitle></CardHeader><CardContent>{snapshot?.spacing.values.join(' · ')} px/dp</CardContent></Card><Card><CardHeader><CardTitle>Shapes</CardTitle></CardHeader><CardContent>{Object.entries(snapshot?.shapes ?? {}).map(([key, value]) => <Badge key={key}>{key}: {value}px</Badge>)}</CardContent></Card><Card><CardHeader><CardTitle>Component constraint</CardTitle></CardHeader><CardContent>minimumTouchTarget = <strong>48dp</strong></CardContent></Card></div>
          </TabsContent>
          <TabsContent value="roles">
            <Card><CardHeader><div className="role-heading"><div><CardTitle>Generated roles</CardTitle><CardDescription>Derived from the primitives above. Every pair is contrast-validated at generation, which is why roles are not individually editable.</CardDescription></div></div></CardHeader><CardContent>
              <div className="mode-controls"><FieldSelect label="Mode" value={previewMode} options={['light','dark']} onChange={value => setPreviewMode(value as ThemeMode)} /><FieldSelect label="Contrast" value={previewContrast} options={['standard','medium','high']} onChange={value => setPreviewContrast(value as ContrastName)} /></div>
              <div className="role-grid">{Object.entries(roles).map(([role, value]) => <RoleEditor key={role} role={role} value={value} />)}</div>
            </CardContent></Card>
          </TabsContent>
          <TabsContent value="history"><RevisionHistory active={original} dirty={dirty} canManage={auth.can('theme:manage')} canDelete={auth.can('theme:rollback')} onActivated={load} /></TabsContent>
        </Tabs>
        {snapshot && <ValidationPanel snapshot={snapshot} />}
      </main>
      <aside className="theme-preview-panel">
        <Card><CardHeader><CardTitle>Live isolated preview</CardTitle><CardDescription>{previewing ? 'Validating…' : `${previewMode} · ${previewContrast}`}</CardDescription></CardHeader><CardContent><PreviewFrame snapshot={snapshot} /></CardContent></Card>
      </aside>
    </div>
    <Dialog open={applyOpen} onOpenChange={setApplyOpen}><DialogContent><DialogHeader><DialogTitle>Apply this configuration as current?</DialogTitle><DialogDescription>A new unnamed technical checkpoint becomes current immediately. Android applies it on its next foreground transition.</DialogDescription></DialogHeader>
      <div className="publish-summary"><p><strong>Primitive changes:</strong> {sourceDiffCount(original.source, source)}</p><p><strong>Warnings:</strong> {snapshot?.validation.warnings.length ?? 0}</p><p><strong>Affected:</strong> admin, landing, catalogs, public and legal pages. The Android app is themed from code and is not affected.</p></div>
      <DialogFooter><Button variant="outline" onClick={() => setApplyOpen(false)}>Cancel</Button><Button onClick={applyCurrent}>Apply as current</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={Boolean(conflict)} onOpenChange={open => !open && setConflict(null)}><DialogContent><DialogHeader><DialogTitle>Revision conflict</DialogTitle><DialogDescription>Another administrator published first. Force overwrite is not available.</DialogDescription></DialogHeader>
      {conflict && <div className="three-way-diff"><DiffBlock title={`Original base #${conflict.original.id}`} value={conflict.original.source} /><DiffBlock title={`New active #${conflict.current.id}`} value={conflict.current.source} /><DiffBlock title="Your local changes" value={conflict.localSource} /></div>}
      <DialogFooter><Button variant="outline" onClick={() => { if (conflict) { setOriginal(conflict.current); setSource(clone(conflict.current.source)); } setConflict(null); }}>Discard local changes</Button><Button onClick={rebase}>Rebase my changes</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}

function FieldSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange(value: string): void }) {
  return <div className="field-stack"><Label>{label}</Label><Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label}><SelectValue /></SelectTrigger><SelectContent>{options.map(option => <SelectItem key={option} value={option}>{humanize(option)}</SelectItem>)}</SelectContent></Select></div>;
}
function RoleEditor({ role, value }: { role: string; value: string }) {
  return <div className="role-token"><span className="role-swatch" style={{ background: value }} /><div><strong>{humanize(role)}</strong><code>{value}</code></div>
  </div>;
}
function ValidationPanel({ snapshot }: { snapshot: Snapshot }) {
  const validation = snapshot.validation;
  return <Card className="validation-card"><CardHeader><CardTitle>{validation.valid ? <><Check className="size-5" /> Validation passed</> : <><ShieldAlert className="size-5" /> Publication blocked</>}</CardTitle><CardDescription>{validation.contrast.filter(check => check.valid).length}/{validation.contrast.length} required contrast pairs pass.</CardDescription></CardHeader><CardContent>
    {[...validation.errors, ...validation.warnings].map((item, index) => <Alert key={`${item.code}-${index}`} className={item.severity === 'error' ? 'validation-error' : 'validation-warning'}><AlertTitle>{item.code}</AlertTitle><AlertDescription>{item.path && <code>{item.path}</code>} {item.message}</AlertDescription></Alert>)}
  </CardContent></Card>;
}
function TokenTable({ entries }: { entries: Record<string, unknown> }) { return <div className="token-table">{Object.entries(entries).map(([name, value]) => <div key={name}><strong>{humanize(name)}</strong><code>{JSON.stringify(value)}</code></div>)}</div>; }
function DiffBlock({ title, value }: { title: string; value: unknown }) { return <div><strong>{title}</strong><pre>{JSON.stringify(value, null, 2)}</pre></div>; }
function sourceDiffCount(original: DesignSystemSource, current: DesignSystemSource) {
  const walk = (a: unknown, b: unknown): number => typeof a !== 'object' || !a || typeof b !== 'object' || !b
    ? Number(!deepEqual(a, b))
    : Object.keys(b as object).reduce((sum, key) => sum + walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]), 0);
  return walk(original, current);
}
function applySnapshotToAdmin(snapshot: Snapshot) {
  const root = document.documentElement;
  for (const [role, value] of Object.entries(snapshot.schemes.standard.light)) root.style.setProperty(`--md-sys-color-${role.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, value);
  window.dispatchEvent(new CustomEvent('orderak:theme-published', { detail: { hash: snapshot.contentHash } }));
}
interface NameDialogState { id: number; currentName: string | null }
interface DeleteDialogState { id: number; name: string | null }

function RevisionHistory({
  active,
  dirty,
  canManage,
  canDelete,
  onActivated,
}: {
  active: ActiveRevision;
  dirty: boolean;
  canManage: boolean;
  canDelete: boolean;
  onActivated(): Promise<void>;
}) {
  const [saved, setSaved] = useState<RevisionSummary[]>([]);
  const [checkpoints, setCheckpoints] = useState<RevisionSummary[]>([]);
  const [savedNext, setSavedNext] = useState<number | null>(null);
  const [checkpointNext, setCheckpointNext] = useState<number | null>(null);
  const [currentName, setCurrentName] = useState(active.name);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const [nameValue, setNameValue] = useState('');
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [busy, setBusy] = useState(false);

  const fetchPage = useCallback(async (kind: 'saved' | 'checkpoint', before?: number) => {
    const params = new URLSearchParams({ kind, limit: kind === 'checkpoint' ? '10' : '20' });
    if (before) params.set('beforeRevisionId', String(before));
    return api<{ revisions: RevisionSummary[]; nextBeforeRevisionId: number | null }>(`/api/admin/v1/theme/revisions?${params}`);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [savedPage, checkpointPage] = await Promise.all([fetchPage('saved'), fetchPage('checkpoint')]);
      setSaved(savedPage.revisions.filter(item => item.id !== active.id));
      setCheckpoints(checkpointPage.revisions);
      setSavedNext(savedPage.nextBeforeRevisionId);
      setCheckpointNext(checkpointPage.nextBeforeRevisionId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to load revision history.');
    } finally {
      setLoading(false);
    }
  }, [active.id, fetchPage]);

  useEffect(() => { setCurrentName(active.name); }, [active.id, active.name]);
  useEffect(() => { void reload(); }, [reload]);

  const loadOlder = async (kind: 'saved' | 'checkpoint') => {
    const before = kind === 'saved' ? savedNext : checkpointNext;
    if (!before) return;
    setLoading(true);
    try {
      const page = await fetchPage(kind, before);
      if (kind === 'saved') {
        setSaved(items => [...items, ...page.revisions.filter(item => item.id !== active.id)]);
        setSavedNext(page.nextBeforeRevisionId);
      } else {
        setCheckpoints(items => [...items, ...page.revisions]);
        setCheckpointNext(page.nextBeforeRevisionId);
      }
    } finally {
      setLoading(false);
    }
  };

  const openNameDialog = (revision: NameDialogState) => {
    setNameDialog(revision);
    setNameValue(revision.currentName ?? '');
  };

  const saveName = async () => {
    if (!nameDialog) return;
    setBusy(true);
    try {
      const result = await api<{ revision: { id: number; name: string } }>(`/api/admin/v1/theme/revisions/${nameDialog.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: nameValue }),
      });
      if (nameDialog.id === active.id) setCurrentName(result.revision.name);
      setNameDialog(null);
      setStatus(`Revision ${nameDialog.id} saved as “${result.revision.name}”.`);
      await reload();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to save this version name.');
    } finally {
      setBusy(false);
    }
  };

  const activate = async (id: number) => {
    if (dirty) {
      setStatus('Apply or reset your editor changes before making a historical configuration current.');
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ activeRevisionId: number }>(`/api/admin/v1/theme/revisions/${id}/activate`, {
        method: 'POST',
        body: JSON.stringify({ baseRevisionId: active.id }),
      });
      setStatus(`Revision ${result.activeRevisionId} is now current.`);
      await onActivated();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setStatus('The current revision changed in another session. History has been refreshed; please try again.');
        await onActivated();
      } else {
        setStatus(error instanceof Error ? error.message : 'Unable to make this configuration current.');
      }
    } finally {
      setBusy(false);
    }
  };

  const deleteRevision = async () => {
    if (!deleteDialog) return;
    setBusy(true);
    try {
      await api(`/api/admin/v1/theme/revisions/${deleteDialog.id}`, { method: 'DELETE' });
      setStatus(`Revision ${deleteDialog.id} was permanently deleted.`);
      setDeleteDialog(null);
      setDeleteConfirmation('');
      await reload();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to delete this revision.');
    } finally {
      setBusy(false);
    }
  };

  const currentSummary: RevisionSummary = {
    id: active.id,
    name: currentName,
    schema_version: active.snapshot.schemaVersion,
    generator_version: active.generatorVersion,
    content_hash: active.contentHash,
    created_by: null,
    created_at: active.publishedAt ?? '',
    published_at: active.publishedAt,
    rollback_of_revision_id: null,
    is_current: 1,
  };
  const expectedDeleteConfirmation = deleteDialog?.name ?? String(deleteDialog?.id ?? '');

  return <>
    <Card>
      <CardHeader>
        <CardTitle><History className="size-5" /> Revision history</CardTitle>
        <CardDescription>Applying a configuration creates a higher immutable checkpoint. Names are optional metadata and can be changed later.</CardDescription>
      </CardHeader>
      <CardContent className="history-groups">
        {status && <Alert><AlertTitle>Revision status</AlertTitle><AlertDescription>{status}</AlertDescription></Alert>}
        <HistoryGroup title="Current configuration">
          <RevisionRow item={currentSummary} current canManage={canManage} canDelete={false} busy={busy} onName={openNameDialog} onActivate={activate} onDelete={() => undefined} />
        </HistoryGroup>
        <HistoryGroup title="Saved configurations">
          {saved.length === 0 && <p className="muted">No named configurations yet. Use Save version on any checkpoint.</p>}
          {saved.map(item => <RevisionRow key={item.id} item={item} canManage={canManage} canDelete={canDelete} busy={busy} onName={openNameDialog} onActivate={activate} onDelete={item => { setDeleteDialog(item); setDeleteConfirmation(''); }} />)}
          {savedNext && <Button size="sm" variant="outline" disabled={loading} onClick={() => void loadOlder('saved')}>Load older saved configurations</Button>}
        </HistoryGroup>
        <HistoryGroup title="Recent checkpoints">
          {checkpoints.length === 0 && <p className="muted">No inactive unnamed checkpoints.</p>}
          {checkpoints.map(item => <RevisionRow key={item.id} item={item} canManage={canManage} canDelete={canDelete} busy={busy} onName={openNameDialog} onActivate={activate} onDelete={item => { setDeleteDialog(item); setDeleteConfirmation(''); }} />)}
          {checkpointNext && <Button size="sm" variant="outline" disabled={loading} onClick={() => void loadOlder('checkpoint')}>Load older</Button>}
        </HistoryGroup>
        {loading && <p className="muted">Loading revision history…</p>}
      </CardContent>
    </Card>
    <Dialog open={Boolean(nameDialog)} onOpenChange={open => !open && setNameDialog(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{nameDialog?.currentName ? 'Rename configuration' : 'Save version'}</DialogTitle>
          <DialogDescription>Name revision {nameDialog?.id}. The generated configuration and content hash remain unchanged.</DialogDescription>
        </DialogHeader>
        <div className="field-stack">
          <Label htmlFor="revision-name">Configuration name</Label>
          <Input id="revision-name" autoFocus value={nameValue} minLength={1} maxLength={80} onChange={event => setNameValue(event.target.value)} />
          <small>{[...nameValue.trim()].length}/80 characters. Names must be unique.</small>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setNameDialog(null)}>Cancel</Button><Button disabled={busy || [...nameValue.trim()].length < 1 || [...nameValue.trim()].length > 80} onClick={() => void saveName()}>Save name</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(deleteDialog)} onOpenChange={open => !open && setDeleteDialog(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete revision {deleteDialog?.id} permanently?</DialogTitle>
          <DialogDescription>This removes its recovery configuration. Its old hashed CSS URL may return 404 when no other revision uses the same content hash.</DialogDescription>
        </DialogHeader>
        <Alert className="validation-error"><AlertTitle>This cannot be undone</AlertTitle><AlertDescription>Type <strong>{expectedDeleteConfirmation}</strong> to confirm.</AlertDescription></Alert>
        <Input aria-label="Permanent deletion confirmation" value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.target.value)} />
        <DialogFooter><Button variant="outline" onClick={() => setDeleteDialog(null)}>Cancel</Button><Button variant="destructive" disabled={busy || deleteConfirmation.trim() !== expectedDeleteConfirmation} onClick={() => void deleteRevision()}>Delete permanently</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

function HistoryGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="history-group"><h3>{title}</h3>{children}</section>;
}

function RevisionRow({
  item,
  current = false,
  canManage,
  canDelete,
  busy,
  onName,
  onActivate,
  onDelete,
}: {
  item: RevisionSummary;
  current?: boolean;
  canManage: boolean;
  canDelete: boolean;
  busy: boolean;
  onName(item: NameDialogState): void;
  onActivate(id: number): void;
  onDelete(item: DeleteDialogState): void;
}) {
  return <div className="history-row">
    <div className="history-row-summary">
      <strong>{item.name ?? `Revision ${item.id}`}</strong>
      <span>Revision {item.id} · {item.generator_version} · {item.published_at ? new Date(item.published_at).toLocaleString() : 'No publication date'}</span>
    </div>
    <div className="history-row-actions">
      {current && <Badge>Current</Badge>}
      {canManage && <Button size="sm" variant="outline" disabled={busy} onClick={() => onName({ id: item.id, currentName: item.name })}>{item.name ? 'Rename' : 'Save version'}</Button>}
      {!current && canManage && <Button size="sm" disabled={busy} onClick={() => onActivate(item.id)}>Make current</Button>}
      {!current && canDelete && <Button size="sm" variant="destructive" disabled={busy} onClick={() => onDelete({ id: item.id, name: item.name })}>Delete permanently</Button>}
    </div>
  </div>;
}
