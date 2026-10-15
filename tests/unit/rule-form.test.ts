import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseRuleForm,
  createRulePatch,
  type RuleFormValues,
} from '../../src/options/rule-form';
import { rule, configWithRules } from '../fixtures/rules';
import { memoryStorage } from '../fixtures/storage';
import { mutateConfig } from '../../src/storage/config-repository';

const values: RuleFormValues = {
  name: rule.name,
  enabled: true,
  type: 'domain',
  pattern: 'example.com',
  destination: rule.destination,
  priority: '0',
  extensions: '',
  mimeTypes: '',
  conflictAction: '',
};
afterEach(() => vi.unstubAllGlobals());
describe('TEST-DR-P3-02 editor validation uses shared validators', () => {
  it.each([
    ['name', ' '],
    ['pattern', 'https://example.com/'],
    ['extensions', 'pdf,,zip'],
    ['extensions', '../pdf'],
    ['mimeTypes', 'application/*'],
    ['destination', '../escape'],
    ['priority', ''],
    ['priority', '1.5'],
    ['priority', '9007199254740992'],
    ['conflictAction', 'delete'],
  ])('shows a field error for %s=%j', (field, value) => {
    const result = parseRuleForm({ ...values, [field]: value });
    expect(result).toMatchObject({
      ok: false,
      errors: { [field]: expect.any(String) },
    });
  });
  it('keeps name markup as plain data and parses comma lists without changing destination', () => {
    const result = parseRuleForm({
      ...values,
      name: '<img src=x onerror=alert(1)>',
      extensions: '.PDF, tar.gz',
      mimeTypes: 'APPLICATION/PDF, text/plain',
    });
    expect(result).toMatchObject({
      ok: true,
      draft: {
        name: '<img src=x onerror=alert(1)>',
        destination: rule.destination,
        match: {
          extensions: ['.PDF', 'tar.gz'],
          mimeTypes: ['APPLICATION/PDF', 'text/plain'],
        },
      },
    });
  });
  it('rejects unsupported regex and accepts explicit conflict overrides', () => {
    expect(
      parseRuleForm({ ...values, type: 'regex', pattern: '(?=a)' }).ok,
    ).toBe(false);
    expect(
      parseRuleForm({
        ...values,
        conflictAction: 'overwrite',
        priority: '-10',
      }),
    ).toMatchObject({
      ok: true,
      draft: { conflictAction: 'overwrite', priority: -10 },
    });
  });
});

describe('TEST-DR-P3-05 editor sends changed fields only', () => {
  it('does not write untouched empty filters or inherited action', () => {
    const parsed = parseRuleForm(values);
    if (!parsed.ok) throw new Error('Invalid fixture');
    expect(createRulePatch(rule, parsed.draft)).toEqual({});
  });
  it('clears an override explicitly and captures only edited nested filters', () => {
    const original = {
      ...rule,
      conflictAction: 'prompt' as const,
      match: { ...rule.match, extensions: ['pdf'] },
    };
    const parsed = parseRuleForm({
      ...values,
      name: 'Updated',
      enabled: false,
      type: 'prefix',
      pattern: 'https://example.com/',
      priority: '5',
    });
    if (!parsed.ok) throw new Error('Invalid fixture');
    expect(createRulePatch(original, parsed.draft)).toEqual({
      name: 'Updated',
      enabled: false,
      priority: 5,
      conflictAction: null,
      match: {
        type: 'prefix',
        pattern: 'https://example.com/',
        extensions: [],
      },
    });
  });
  it('preserves a concurrent toggle/filter edit when saving a stale editor destination', async () => {
    const latest = {
      ...rule,
      enabled: false,
      match: { ...rule.match, mimeTypes: ['application/pdf'] },
    };
    memoryStorage(configWithRules([latest]));
    const parsed = parseRuleForm({ ...values, destination: 'Edited' });
    if (!parsed.ok) throw new Error('Invalid fixture');
    const patch = createRulePatch(rule, parsed.draft);
    expect(patch).toEqual({ destination: 'Edited' });
    expect(
      (await mutateConfig({ type: 'rule.update', id: rule.id, patch }))
        .rules[0],
    ).toMatchObject({
      ...latest,
      destination: 'Edited',
      updatedAt: expect.any(Number),
    });
  });
});
