import { useState } from 'react';
import { PageHeader } from '@/shared/ui/Page';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { askConfirm } from '@/shared/ui/confirm';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { STEP_UP_UNAVAILABLE, useStepUp } from '@/shared/api/step-up';

/**
 * The design system, drawn from itself.
 *
 * WHY THIS PAGE EXISTS
 *   The panel had a generated token set, a documentation page describing it, and
 *   a verification guard holding it to account — and no way to look at it. The
 *   numbers were all checkable and none of them was visible, so "does this read
 *   well?" could only be answered by finding a screen that happened to use a
 *   role and squinting at it.
 *
 * WHY EVERYTHING HERE REFERS TO A TOKEN
 *   Not one value on this page is written by hand: the swatches name colour
 *   roles, the spacing bars take their width from the spacing scale, and the
 *   type specimen uses the `.ork-*` role classes. That is the point — publish a
 *   new design-system revision and this page changes with it, which is the only
 *   way to see what a revision actually does before shipping it to sellers.
 *
 * The nine components below are the ones that carry every screen in the console.
 * When the two design systems in this app are consolidated into one, this page
 * is where the result gets judged.
 */

const TYPE_ROLES = [
  'display-large', 'display-medium', 'display-small',
  'headline-large', 'headline-medium', 'headline-small',
  'title-large', 'title-medium', 'title-small',
  'body-large', 'body-medium', 'body-small',
  'label-large', 'label-medium', 'label-small',
];

const SPACING_STEPS = ['space0', 'space1', 'space2', 'space3', 'space4', 'space6', 'space8', 'space10', 'space12', 'space16'];

const SHAPES = ['extra-small', 'small', 'medium', 'large', 'extra-large', 'full'];

const COLOUR_ROLES = [
  ['primary', 'brand, primary action'],
  ['surface', 'cards, inputs'],
  ['canvas', 'page background'],
  ['ink', 'body text'],
  ['muted', 'secondary text'],
  ['line', 'borders'],
  ['success', 'paid, delivered'],
  ['warning', 'needs the seller'],
  ['danger', 'refused, destructive'],
  ['accent', 'decorative fill'],
];

const STATUSES = ['positive', 'negative', 'warning', 'neutral'];

export default function DesignSystemPage() {
  const stepUp = useStepUp();
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <PageHeader
        title="Design system"
        description="Every token the panel draws from, and the components that use them. Nothing on this page is a hand-written value."
        actions={
          <Button variant="outline" onClick={() => { setConfirming(true); askConfirm('Rehearse the confirmation dialog every destructive action now uses?', () => setConfirming(false), 'Rehearsed'); }}>
            Try a confirmation
          </Button>
        }
      />

      <section className="resource-group">
        <div className="section-heading"><h2>Type roles</h2><span>15</span></div>
        <p className="muted">One family, fifteen roles, weights 400 and 500 only. Latin text a user must read is never below 12px.</p>
        <Card>
          <CardContent className="pt-5">
            {TYPE_ROLES.map(role => (
              <div key={role} className={`ork-${role}`}>
                {role} — الطلبات الجديدة 1234
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="resource-group">
        <div className="section-heading"><h2>Spacing scale</h2><span>10 steps</span></div>
        <p className="muted">A 4dp base with deliberate gaps. There is no 5, 7, 9 or 11 — a value off this scale is a mistake, and the only exception is measured from something else and named for it.</p>
        <Card>
          <CardContent className="pt-5">
            {SPACING_STEPS.map(step => (
              <div key={step} style={{ display: 'flex', alignItems: 'center' }}>
                <code className="ork-numeric" style={{ minWidth: '5rem' }}>{step}</code>
                <span style={{ height: 'var(--orderak-space3)', width: `var(--orderak-${step})`, background: 'var(--orderak-primary)' }} />
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="resource-group">
        <div className="section-heading"><h2>Shape</h2><span>6</span></div>
        <p className="muted">Controls at small, inner groups at medium, cards at large, modals at extra-large, pills at full. The pill is a proportion of its own height, not a number.</p>
        <Card>
          <CardContent className="pt-5" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--orderak-space4)' }}>
            {SHAPES.map(shape => (
              <div key={shape} style={{ display: 'grid', placeItems: 'center', height: 'var(--orderak-space12)', width: 'var(--orderak-space16)', border: '1px solid var(--orderak-line)', borderRadius: `var(--orderak-shape-${shape})` }}>
                <span className="ork-label-small">{shape}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="resource-group">
        <div className="section-heading"><h2>Colour roles</h2><span>one meaning per role</span></div>
        <p className="muted">Brand colour never signals status, and colour is never the only signal — every semantic container carries an outline and an icon.</p>
        <Card>
          <CardContent className="pt-5">
            {COLOUR_ROLES.map(([role, meaning]) => (
              <div key={role} style={{ display: 'flex', alignItems: 'center', gap: 'var(--orderak-space3)' }}>
                <span style={{ height: 'var(--orderak-space8)', width: 'var(--orderak-space8)', border: '1px solid var(--orderak-line)', borderRadius: 'var(--orderak-shape-small)', background: `var(--orderak-${role})` }} />
                <code className="ork-numeric" style={{ minWidth: '8rem' }}>--orderak-{role}</code>
                <span className="muted">{meaning}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="resource-group">
        <div className="section-heading"><h2>Components</h2><span>the nine that carry every screen</span></div>
        <div className="dashboard-grid">
          <Card>
            <CardHeader>
              <CardTitle>Buttons</CardTitle>
              <CardDescription>One primary action per view.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="button-row">
                <Button>Primary</Button>
                <Button variant="outline">Secondary</Button>
                <Button variant="destructive">Destructive</Button>
                <Button variant="outline" disabled>Disabled</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Fields</CardTitle>
              <CardDescription>Label above, requirement marked, error below.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="form-grid">
                <Field label="Store name *"><Input defaultValue="متجر النور" /></Field>
                <Field label="Note (optional)"><Input placeholder="Anything the operator should know" /></Field>
                <label className="checkbox-field"><input type="checkbox" defaultChecked /><span><strong>Accepting orders</strong></span></label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>Colour plus a word, never colour alone.</CardDescription>
            </CardHeader>
            <CardContent>
              <div style={{ display: 'flex', gap: 'var(--orderak-space2)', flexWrap: 'wrap' }}>
                {STATUSES.map(status => <span key={status} className={`status ${status}`}>{status}</span>)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Metrics</CardTitle>
              <CardDescription>Tabular figures, so a column does not shift.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="metric-card static">
                <div className="metric-icon">EGP</div>
                <div><span>Today</span><strong className="ork-numeric">4,812.00</strong><small>12 orders</small></div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="resource-group">
        <div className="section-heading"><h2>States</h2><span>every screen has all four</span></div>
        <div className="dashboard-grid">
          <div className="state-card"><div className="ork-spinner" /><p>Loading current data…</p></div>
          <div className="state-card"><h2>Nothing here yet</h2><p>Empty states carry the next step, not sympathy.</p></div>
          <div className="state-card error"><h2>Could not load this section</h2><p>Every failure names the remedy and reassures about the data.</p><Button variant="outline">Try again</Button></div>
          <div className="state-card"><h2>You do not have access to this section</h2><p>A refusal is not a failure, and offers nothing to press.</p></div>
        </div>
      </section>

      <section className="resource-group">
        <div className="section-heading"><h2>Audited actions</h2><span>one owner-only rule</span></div>
        <Card>
          <CardContent className="pt-5">
            {stepUp.available
              ? <p className="muted">Your session can mint an owner-only step-up, so destructive actions here will ask for a password and a fresh TOTP code.</p>
              : <p className="error-text">{STEP_UP_UNAVAILABLE}</p>}
            {confirming && <p className="muted">The confirmation dialog is open — it is drawn by one host in the shell, not by this page.</p>}
          </CardContent>
        </Card>
      </section>
    </>
  );
}
