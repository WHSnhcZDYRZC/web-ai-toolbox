export const MAX_RULES = 20;

export const SETTINGS_KEY = 'deepseek-trigger-expander:settings:v1';

/**
 * 界面偏好单独用一个 key，不塞进 SettingsV1。
 *
 * 原因：normalizeSettings() 只认 {version, rules}，schema 外的字段会被直接丢弃；
 * 要把开关并进去就得给 SettingsV1 升版本，进而要处理老数据迁移和导入文件的兼容。
 * 偏好和规则数据解耦，导入导出规则 JSON 也不受影响。
 */
export const PREF_KEY = 'deepseek-trigger-expander:prefs:v1';

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

export type Prefs = {
  /**
   * DeepSeek 深度思考产出的内容默认折叠。
   * 实测一条思考可渲染到 5000px 以上，回看历史会话时非常占版面。
   */
  collapseThoughts: boolean;
};

export const DEFAULT_PREFS: Prefs = { collapseThoughts: false };

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
