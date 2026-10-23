import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const coreUi = path.join(repositoryRoot, 'apps', 'seller-android', 'app', 'src', 'main', 'java', 'app', 'orderak', 'seller', 'core', 'ui');
const adminUi = path.join(repositoryRoot, 'apps', 'admin-web', 'src', 'shared', 'ui');

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

// Since R1a-1b the gate's state-to-surface mapping lives in GateNotice.
describe('the gate\'s state-to-surface mapping stays in GateNotice', () => {
  const kit = read(path.join(coreUi, 'FeedbackComponents.kt'));
  const notice = kit.slice(kit.indexOf('fun GateNotice('));

  it('keeps Available drawing nothing, LockedByPlan on Commerce and NotBuilt on the neutral surface', () => {
    expect(notice).toMatch(/FeatureAvailability\.Available\s*->\s*Unit/);
    expect(notice).toContain('SemanticRole.Commerce.colors()');
    expect(notice).toMatch(/FeatureAvailability\.NotBuilt\s*->\s*Surface\([\s\S]*?MaterialTheme\.colorScheme\.surfaceVariant/);
  });

  it('keeps the gate notices\' own copy', () => {
    for (const key of ['gate_locked_by_plan_title', 'gate_locked_by_plan_body', 'gate_not_built_title', 'gate_not_built_body']) {
      expect(notice).toContain(`R.string.${key}`);
    }
  });

  it('keeps FeatureGate drawing the feature when available and GateNotice otherwise', () => {
    const gate = read(path.join(coreUi, 'FeatureGate.kt'));
    expect(gate).toMatch(/FeatureAvailability\.Available\s*->\s*content\(\)/);
    expect(gate).toMatch(/->\s*GateNotice\(/);
  });
});

describe('admin kit keeps every used export', () => {
  it('keeps the card exports', () => {
    const card = read(path.join(adminUi, 'card.tsx'));
    for (const name of ['Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardContent']) {
      expect(card, name).toMatch(new RegExp(`export const ${name}\\b`));
    }
  });

  it('keeps the dialog exports and the built-in close button', () => {
    const dialog = read(path.join(adminUi, 'dialog.tsx'));
    for (const name of ['Dialog', 'DialogContent', 'DialogHeader', 'DialogTitle', 'DialogDescription', 'DialogFooter']) {
      expect(dialog, name).toMatch(new RegExp(`export const ${name}\\b`));
    }
    expect(dialog).toContain('aria-label="Close dialog"');
  });
});
