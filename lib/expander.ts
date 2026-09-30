import type { TriggerRule } from './types';

export type ExpandResult = {
  output: string;
  replacedCount: number;
  matchedTriggers: string[];
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 触发词展开（纯函数，便于单测）。
 *
 * - 独立词替换：触发词前后不能紧跟字母、数字、下划线、连字符。
 * - 忽略大小写匹配（规则展示时保留用户原始写法）。
 * - 多条规则按触发词长度降序排列，长触发词优先。
 * - 单遍替换，不递归展开：replacement 文本里即使含有触发词也不再处理。
 * - 使用函数 replacer，避免 replacement 中的 `$&`、`$1` 被当成替换模式。
 * - 仅支持现代 Chrome / Edge（使用 RegExp lookbehind）。
 */
export function expandTriggers(input: string, rules: TriggerRule[]): ExpandResult {
  const active = rules
    .filter((r) => r.enabled && r.trigger.trim() && r.replacement)
    .map((r) => ({ ...r, key: r.trigger.trim().toLowerCase() }))
    .sort((a, b) => b.key.length - a.key.length);

  if (!active.length || !input) {
    return { output: input, replacedCount: 0, matchedTriggers: [] };
  }

  const escaped = active.map((r) => escapeRegExp(r.key));
  const re = new RegExp(`(?<![A-Za-z0-9_-])(${escaped.join('|')})(?![A-Za-z0-9_-])`, 'giu');

  let replacedCount = 0;
  const matched = new Set<string>();

  const output = input.replace(re, (raw) => {
    const rule = active.find((r) => r.key === raw.toLowerCase());
    if (!rule) return raw;
    replacedCount += 1;
    matched.add(rule.trigger);
    return rule.replacement;
  });

  return { output, replacedCount, matchedTriggers: [...matched] };
}
