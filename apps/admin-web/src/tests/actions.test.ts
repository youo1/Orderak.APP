import { describe, expect, it } from 'vitest';
import { actions } from '@/app/config/actions';

describe('design asset action form', () => {
  it('defaults to the design library and keeps figma selectable as a legacy option', () => {
    const typeField = actions.design.fields.find(field => field.name === 'type');
    expect(typeField?.options).toEqual(['design-library', 'canva', 'exported', 'figma']);
    expect(typeField?.defaultValue).toBe('design-library');
  });
});
