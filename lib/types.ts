export const MAX_RULES = 20;

export const SETTINGS_KEY = 'deepseek-trigger-expander:settings:v1';

/** 触发词仅允许 ASCII：字母开头，后接字母/数字/下划线/连字符，最长 32 字符 */
export const TRIGGER_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

export type TriggerRule = {
  id: string;
  /** 触发词，例如 hy1、prompt-a；展示时保留用户原始写法，匹配时忽略大小写 */
  trigger: string;
  /** 展开后的完整文本 */
  replacement: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};

export type SettingsV1 = {
  version: 1;
  /** 最多 MAX_RULES 条 */
  rules: TriggerRule[];
};

export const DEFAULT_SETTINGS: SettingsV1 = { version: 1, rules: [] };

export function createRule(partial?: Partial<Omit<TriggerRule, 'id' | 'createdAt' | 'updatedAt'>>): TriggerRule {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    trigger: partial?.trigger ?? '',
    replacement: partial?.replacement ?? '',
    enabled: partial?.enabled ?? true,
    createdAt: now,
    updatedAt: now,
  };
}
