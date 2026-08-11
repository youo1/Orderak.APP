import { describe, expect, it } from 'vitest';
import { sections } from '@/app/config/sections';

describe('admin route registry', () => {
  it('has unique ids and paths with explicit backend RBAC permissions', () => {
    expect(new Set(sections.map(section => section.id)).size).toBe(sections.length);
    expect(new Set(sections.map(section => section.path)).size).toBe(sections.length);
    expect(sections.every(section => section.permission.includes(':'))).toBe(true);
  });

  it('covers every canonical control-plane domain', () => {
    for (const id of ['stores', 'buyers', 'privacy', 'support', 'deletions', 'subscriptions', 'plans', 'coupons', 'affiliate', 'ads', 'exports', 'flags', 'versions', 'capabilities', 'runtime', 'announcements', 'translations', 'emails', 'email-events', 'inbox', 'macros', 'content', 'jobs', 'audit', 'errors', 'security', 'admins', 'settings', 'theme', 'roadmap', 'tasks', 'releases', 'bugs', 'manifests', 'prompts', 'docs', 'design', 'locales', 'tags']) {
      expect(sections.some(section => section.id === id)).toBe(true);
    }
  });
});
