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

describe('state-to-role mapping stays in SemanticChip.kt', () => {
  it('keeps LockedByPlan on Commerce, NotBuilt on Neutral and Available drawing nothing', () => {
    const chip = read(path.join(coreUi, 'SemanticChip.kt'));
    expect(chip).toMatch(/fun FeatureAvailabilityChip\(/);
    expect(chip).toMatch(/FeatureAvailability\.Available\s*->\s*Unit/);
    expect(chip).toMatch(/FeatureAvailability\.LockedByPlan\s*->\s*SemanticChip\(\s*SemanticRole\.Commerce\s*,\s*upgradeLabel\s*,\s*modifier\s*\)/);
    expect(chip).toMatch(/FeatureAvailability\.NotBuilt\s*->\s*SemanticChip\(\s*SemanticRole\.Neutral\s*,\s*unavailableLabel\s*,\s*modifier\s*\)/);
  });

  it('keeps the gate notices\' own surfaces and copy', () => {
    const gate = read(path.join(coreUi, 'FeatureGate.kt'));
    expect(gate).toContain('SemanticRole.Commerce.colors()');
    for (const key of ['gate_locked_by_plan_title', 'gate_locked_by_plan_body', 'gate_not_built_title', 'gate_not_built_body']) {
      expect(gate).toContain(`R.string.${key}`);
    }
    expect(gate).toMatch(/FeatureAvailability\.LockedByPlan\s*->\s*LockedByPlanNotice\(/);
    expect(gate).toMatch(/FeatureAvailability\.NotBuilt\s*->\s*NotBuiltNotice\(/);
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
