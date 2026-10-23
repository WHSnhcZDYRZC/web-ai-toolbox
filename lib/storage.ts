import {
  DEFAULT_PREFS,
  DEFAULT_SETTINGS,
  MAX_RULES,
  PREF_KEY,
  SETTINGS_KEY,
  type Prefs,
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

/**
 * 把任意存储内容归一化为完整 Prefs。
 *
 * 存储内容视为不可信输入：只有严格的 true 才算开启，缺失/非 boolean 一律 false。
 * 以后新增偏好字段只需在这里补一行，其余三个函数不用动。
 */
function normalizePrefs(raw: unknown): Prefs {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFS };
  const o = raw as Record<string, unknown>;
  return {
    collapseThoughts: o.collapseThoughts === true,
    foldCodeBlocks: o.foldCodeBlocks === true,
  };
}

/** 读取界面偏好 */
export async function loadPrefs(): Promise<Prefs> {
  const res = await chrome.storage.local.get(PREF_KEY);
  return normalizePrefs(res[PREF_KEY]);
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  await chrome.storage.local.set({ [PREF_KEY]: normalizePrefs(prefs) });
}

/** 订阅偏好变化（popup 保存后 content script 热更新），返回取消订阅函数 */
export function onPrefsChanged(callback: (prefs: Prefs) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName !== 'local') return;
    const change = changes[PREF_KEY];
    if (!change) return;
    callback(normalizePrefs(change.newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
