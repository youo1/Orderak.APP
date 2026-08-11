export type ContrastName = 'standard' | 'medium' | 'high';
export type ThemeMode = 'light' | 'dark';

export interface DesignSystemSource {
  colors: {
    primary: string;
    secondary: string;
    tertiary: string;
    error: string;
    warning: string;
    success: string;
    information: string;
    surfaceTemperature: 'cool' | 'neutral' | 'warm';
    variant: 'tonal-spot' | 'vibrant' | 'expressive' | 'fidelity' | 'content' | 'neutral' | 'monochrome';
    defaultContrast: ContrastName;
  };
  typography: { family: 'cairo' | 'tajawal' | 'noto-arabic'; multiplier: number };
  spacing: { baseUnit: number; density: 'compact' | 'comfortable' | 'spacious' };
  shapes: { preset: 'sharp' | 'balanced' | 'rounded' | 'custom'; baseRadius?: number };
}

export interface RoleOverride { value: string; reason: string }
export type DesignSystemOverrides = Record<string, RoleOverride>;
export interface ValidationMessage { code: string; message: string; path?: string; severity: 'error' | 'warning' }
export interface Validation {
  valid: boolean;
  errors: ValidationMessage[];
  warnings: ValidationMessage[];
  contrast: Array<{ path: string; ratio: number; required: number; valid: boolean }>;
}

export interface Snapshot {
  schemaVersion: 2;
  generatorVersion: string;
  source: DesignSystemSource;
  schemes: Record<ContrastName, Record<ThemeMode, Record<string, string>>>;
  semantic: Record<ContrastName, Record<ThemeMode, Record<string, string>>>;
  typography: { family: string; multiplier: number; roles: Record<string, { sizeRem: number; sizeSp: number; lineHeight: number; weight: number; letterSpacingEm: number }> };
  spacing: { values: number[]; tokens: Record<string, number> };
  shapes: Record<string, number>;
  components: { minimumTouchTargetDp: 48 };
  overrides: DesignSystemOverrides;
  validation: Validation;
  contentHash: string;
}

export interface ActiveRevision {
  id: number;
  name: string | null;
  source: DesignSystemSource;
  overrides: DesignSystemOverrides;
  snapshot: Snapshot;
  validation: Validation;
  contentHash: string;
  generatorVersion: string;
  publishedAt: string | null;
}

export interface RevisionSummary {
  id: number;
  name: string | null;
  schema_version: number;
  generator_version: string;
  content_hash: string;
  created_by: number | null;
  created_at: string;
  published_at: string | null;
  rollback_of_revision_id: number | null;
  is_current: 0 | 1;
}

export interface ThemeGetResponse {
  ok: true;
  activeRevisionId: number;
  active: ActiveRevision;
  defaults: DesignSystemSource;
  approvedFonts: string[];
  capabilities: { generatorVersion: string; maxOverrides: number; maxBodyBytes: number };
  generatorUpgradePreview: { from: string; to: string; snapshot: Snapshot } | null;
}
