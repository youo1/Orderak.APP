import type { Snapshot } from '../types';
import './preview.css';

const root = document.querySelector<HTMLDivElement>('#preview-root')!;
const MAX_MESSAGE_BYTES = 128 * 1024;
const parentOrigin = window.location.origin;

function cssName(role: string) {
  return role.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
}

function apply(snapshot: Snapshot) {
  const mode = (document.documentElement.dataset.mode || 'light') as 'light' | 'dark';
  const contrast = (document.documentElement.dataset.contrast || 'standard') as 'standard' | 'medium' | 'high';
  const colors = { ...snapshot.schemes[contrast][mode], ...snapshot.semantic[contrast][mode] };
  for (const [role, value] of Object.entries(colors)) document.documentElement.style.setProperty(`--md-${cssName(role)}`, value);
  document.documentElement.style.setProperty('--preview-font', snapshot.typography.family === 'cairo' ? 'Cairo, sans-serif' : `${snapshot.typography.family}, sans-serif`);
  document.documentElement.style.setProperty('--shape-sm', `${snapshot.shapes.small}px`);
  document.documentElement.style.setProperty('--shape-md', `${snapshot.shapes.medium}px`);
  document.documentElement.style.setProperty('--gap', `${snapshot.spacing.tokens.space4}px`);
  document.documentElement.style.setProperty('--touch', `${snapshot.components.minimumTouchTargetDp}px`);
  render(snapshot);
}

function render(snapshot: Snapshot) {
  root.innerHTML = `
    <header><div class="logo">O</div><div><strong>Orderak</strong><span>Admin sample</span></div><nav><button>Dashboard</button><button>Orders</button></nav></header>
    <main>
      <section class="preview-toolbar">
        <label>Mode <select id="mode"><option>light</option><option>dark</option></select></label>
        <label>Contrast <select id="contrast"><option>standard</option><option>medium</option><option>high</option></select></label>
        <label>Locale <select id="locale"><option value="en">English LTR</option><option value="ar">Arabic RTL</option><option value="fr">French LTR</option></select></label>
      </section>
      <section class="hero"><span class="chip">Published design system</span><h1>Run your store with confidence</h1><p>Buttons, forms, status colors, typography, spacing and shapes update together.</p><div class="actions"><button class="primary">Create order</button><button class="secondary">View catalog</button></div></section>
      <section class="grid">
        <article><h2>Recent orders</h2><table><thead><tr><th>Customer</th><th>Status</th><th>Total</th></tr></thead><tbody><tr><td>Mariam</td><td><span class="success">Paid</span></td><td>EGP 480</td></tr><tr><td>Omar</td><td><span class="warning">Pending</span></td><td>EGP 220</td></tr></tbody></table></article>
        <article><h2>New product</h2><label>Name<input value="Classic cotton shirt"></label><label>Category<select><option>Fashion</option></select></label><label class="switch-line"><input type="checkbox" checked> Available in catalog</label><button class="primary">Save product</button></article>
      </section>
      <section class="status-grid"><div class="info">Information state</div><div class="success">Success state</div><div class="warning">Warning state</div><div class="error">Error state</div></section>
      <dialog id="sample-dialog"><h2>Publish revision?</h2><p>This portal stays inside the isolated preview document.</p><button class="primary" id="close-dialog">Confirm</button></dialog>
      <button id="open-dialog" class="floating">Open dialog</button>
      <footer>${snapshot.typography.family} · ${snapshot.spacing.values.join('/')} · 48dp targets</footer>
    </main>`;
  const mode = root.querySelector<HTMLSelectElement>('#mode')!;
  const contrast = root.querySelector<HTMLSelectElement>('#contrast')!;
  mode.value = document.documentElement.dataset.mode || 'light';
  contrast.value = document.documentElement.dataset.contrast || 'standard';
  mode.onchange = () => { document.documentElement.dataset.mode = mode.value; apply(snapshot); };
  contrast.onchange = () => { document.documentElement.dataset.contrast = contrast.value; apply(snapshot); };
  root.querySelector<HTMLSelectElement>('#locale')!.onchange = event => {
    const lang = (event.target as HTMLSelectElement).value;
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  };
  const dialog = root.querySelector<HTMLDialogElement>('#sample-dialog')!;
  root.querySelector<HTMLButtonElement>('#open-dialog')!.onclick = () => dialog.showModal();
  root.querySelector<HTMLButtonElement>('#close-dialog')!.onclick = () => dialog.close();
}

window.addEventListener('message', event => {
  if (event.origin !== parentOrigin || event.source !== window.parent) return;
  if (event.data?.type !== 'orderak-theme-preview' || event.data?.schemaVersion !== 2) return;
  if (new Blob([JSON.stringify(event.data)]).size > MAX_MESSAGE_BYTES) return;
  const snapshot = event.data.snapshot as Snapshot;
  if (snapshot?.schemaVersion !== 2 || !snapshot.validation) return;
  apply(snapshot);
});

window.parent.postMessage({ type: 'orderak-theme-preview-ready' }, parentOrigin);
