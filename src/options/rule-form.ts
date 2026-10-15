import type { DownloadRule, MatchType } from '../models/config';
import type { RuleDraft, RulePatch } from '../models/messages';
import {
  isConflictAction,
  isValidExtensionFilter,
  isValidMimeFilter,
  prepareRule,
} from '../core/config-validator';
import { isValidDestination } from '../core/path-validator';
import { compileMatcher } from '../core/rule-matcher';

export interface RuleFormValues {
  name: string;
  enabled: boolean;
  type: string;
  pattern: string;
  extensions: string;
  mimeTypes: string;
  destination: string;
  priority: string;
  conflictAction: string;
}
export type RuleFormErrors = Partial<Record<keyof RuleFormValues, string>>;
export const previewMetadata = { id: 'preview', createdAt: 0, updatedAt: 0 };

export function parseRuleForm(
  values: RuleFormValues,
): { ok: true; draft: RuleDraft } | { ok: false; errors: RuleFormErrors } {
  const errors: RuleFormErrors = {};
  const extensions = values.extensions.trim()
    ? values.extensions.split(',').map((item) => item.trim())
    : [];
  const mimeTypes = values.mimeTypes.trim()
    ? values.mimeTypes.split(',').map((item) => item.trim())
    : [];
  if (!values.name.trim()) errors.name = 'Nhập tên rule.';
  try {
    compileMatcher(values.type as MatchType, values.pattern);
  } catch {
    errors.pattern =
      'Pattern không hợp lệ hoặc cú pháp chưa được hỗ trợ. Kiểm tra loại matcher và pattern.';
  }
  if (!extensions.every(isValidExtensionFilter))
    errors.extensions =
      'Dùng suffix hợp lệ, cách nhau bằng dấu phẩy; ví dụ pdf, tar.gz.';
  if (!mimeTypes.every(isValidMimeFilter))
    errors.mimeTypes =
      'Dùng MIME type/subtype chính xác, không wildcard; ví dụ application/pdf.';
  if (!isValidDestination(values.destination))
    errors.destination =
      'Nhập thư mục con hợp lệ của Downloads; không absolute path, traversal hoặc tên thiết bị.';
  const priority = Number(values.priority);
  if (!values.priority.trim() || !Number.isSafeInteger(priority))
    errors.priority = 'Priority phải là số nguyên an toàn.';
  if (values.conflictAction && !isConflictAction(values.conflictAction))
    errors.conflictAction = 'Chọn kế thừa hoặc một conflict action hợp lệ.';
  if (Object.keys(errors).length) return { ok: false, errors };
  const draft: RuleDraft = {
    name: values.name,
    enabled: values.enabled,
    match: {
      type: values.type as MatchType,
      pattern: values.pattern,
      extensions,
      mimeTypes,
    },
    destination: values.destination,
    priority,
    ...(values.conflictAction
      ? {
          conflictAction:
            values.conflictAction as DownloadRule['conflictAction'],
        }
      : {}),
  };
  if (!prepareRule({ ...draft, ...previewMetadata }))
    return { ok: false, errors: { name: 'Rule không hợp lệ.' } };
  return { ok: true, draft };
}

export function createRulePatch(
  original: DownloadRule,
  draft: RuleDraft,
): RulePatch {
  const patch: RulePatch = {};
  if (original.name !== draft.name) patch.name = draft.name;
  if (original.enabled !== draft.enabled) patch.enabled = draft.enabled;
  if (original.destination !== draft.destination)
    patch.destination = draft.destination;
  if (original.priority !== draft.priority) patch.priority = draft.priority;
  if (original.conflictAction !== draft.conflictAction)
    patch.conflictAction = draft.conflictAction ?? null;
  const match: NonNullable<RulePatch['match']> = {};
  if (original.match.type !== draft.match.type) match.type = draft.match.type;
  if (original.match.pattern !== draft.match.pattern)
    match.pattern = draft.match.pattern;
  for (const key of ['extensions', 'mimeTypes'] as const) {
    if (
      JSON.stringify(original.match[key] ?? []) !==
      JSON.stringify(draft.match[key] ?? [])
    )
      match[key] = draft.match[key] ?? [];
  }
  if (Object.keys(match).length) patch.match = match;
  return patch;
}
