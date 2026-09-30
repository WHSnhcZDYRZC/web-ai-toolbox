import {
  DEFAULT_SETTINGS,
  MAX_RULES,
  SETTINGS_KEY,
  type SettingsV1,
  type TriggerRule,
} from './types';

function isRule(raw: unknown): raw is TriggerRule {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.trigger === 'string' &&
    typeof r.replacement === 'string' &&
    typeof r.enabled === 'boolean' &&
    typeof r.createdAt === 'number' &&
    typeof r.updatedAt === 'number'
  );
}

/** 校验并归一化外部数据（存储、导入文件），非法时返回 null */
export function normalizeSettings(raw: unknown): SettingsV1 | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1 || !Array.isArray(obj.rules)) return null;
  const rules = obj.rules.filter(isRule).slice(0, MAX_RULES);
  return { version: 1, rules };
}

export async function loadSettings(): Promise<SettingsV1> {
  const res = await chrome.storage.local.get(SETTINGS_KEY);
  const normalized = normalizeSettings(res[SETTINGS_KEY]);
  return normalized ?? { ...DEFAULT_SETTINGS, rules: [] };
}

export async function saveSettings(settings: SettingsV1): Promise<void> {
  const rules = settings.rules.slice(0, MAX_RULES);
  await chrome.storage.local.set({ [SETTINGS_KEY]: { version: 1, rules } });
}

/**
 * 订阅设置变化（popup 保存后 content script 热更新）。
 * 返回取消订阅函数。
 */
export function onSettingsChanged(callback: (settings: SettingsV1) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName !== 'local') return;
    const change = changes[SETTINGS_KEY];
    if (!change) return;
    callback(normalizeSettings(change.newValue) ?? { version: 1, rules: [] });
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
