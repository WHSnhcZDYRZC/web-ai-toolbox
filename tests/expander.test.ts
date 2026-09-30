import { describe, expect, it } from 'vitest';
import { expandTriggers } from '../lib/expander';
import type { TriggerRule } from '../lib/types';

let seq = 0;
function rule(partial: Partial<TriggerRule> & { trigger: string; replacement: string }): TriggerRule {
  seq += 1;
  const now = Date.now();
  return {
    id: `test-rule-${seq}`,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

describe('expandTriggers', () => {
  it('独立词可替换', () => {
    const { output, replacedCount, matchedTriggers } = expandTriggers('hy1', [
      rule({ trigger: 'hy1', replacement: '请用中文总结以下内容：' }),
    ]);
    expect(output).toBe('请用中文总结以下内容：');
    expect(replacedCount).toBe(1);
    expect(matchedTriggers).toEqual(['hy1']);
  });

  it('中文语境中的独立词可替换', () => {
    const { output } = expandTriggers('你好 hy1 请处理', [
      rule({ trigger: 'hy1', replacement: '展开文本' }),
    ]);
    expect(output).toBe('你好 展开文本 请处理');
  });

  it('hy123 / xhy1 / hy1_extra 不误伤', () => {
    const rules = [rule({ trigger: 'hy1', replacement: 'X' })];
    expect(expandTriggers('hy123', rules).output).toBe('hy123');
    expect(expandTriggers('xhy1', rules).output).toBe('xhy1');
    expect(expandTriggers('hy1_extra', rules).output).toBe('hy1_extra');
  });

  it('多规则时长触发词优先', () => {
    const rules = [
      rule({ trigger: 'send', replacement: 'SHORT' }),
      rule({ trigger: 'send-now', replacement: 'LONG' }),
    ];
    const { output, matchedTriggers } = expandTriggers('请 send-now 然后 send', rules);
    expect(output).toBe('请 LONG 然后 SHORT');
    expect(matchedTriggers).toContain('send-now');
    expect(matchedTriggers).toContain('send');
  });

  it('replacement 含 $& 时不被当作替换模式', () => {
    const { output } = expandTriggers('hy1', [
      rule({ trigger: 'hy1', replacement: '价格是 $& 与 $1' }),
    ]);
    expect(output).toBe('价格是 $& 与 $1');
  });

  it('replacement 含换行与 emoji 时结果正确', () => {
    const replacement = '第一行 🚀\n第二行 ✅';
    const { output } = expandTriggers('a hy1 b', [rule({ trigger: 'hy1', replacement })]);
    expect(output).toBe(`a ${replacement} b`);
  });

  it('停用的规则不替换', () => {
    const { output, replacedCount } = expandTriggers('hy1', [
      rule({ trigger: 'hy1', replacement: 'X', enabled: false }),
    ]);
    expect(output).toBe('hy1');
    expect(replacedCount).toBe(0);
  });

  it('replacement 为空的规则不替换', () => {
    const { output, replacedCount } = expandTriggers('hy1', [
      rule({ trigger: 'hy1', replacement: '' }),
    ]);
    expect(output).toBe('hy1');
    expect(replacedCount).toBe(0);
  });

  it('忽略大小写匹配，matchedTriggers 保留用户原始写法', () => {
    const rules = [rule({ trigger: 'Hy1', replacement: 'X' })];
    const { output, matchedTriggers } = expandTriggers('HY1 和 hy1', rules);
    expect(output).toBe('X 和 X');
    expect(matchedTriggers).toEqual(['Hy1']);
  });

  it('不递归展开：展开结果中的触发词不再处理', () => {
    const rules = [
      rule({ trigger: 'hy1', replacement: '包含 hy2 的文本' }),
      rule({ trigger: 'hy2', replacement: '不应出现' }),
    ];
    const { output, replacedCount } = expandTriggers('hy1', rules);
    expect(output).toBe('包含 hy2 的文本');
    expect(replacedCount).toBe(1);
  });

  it('无规则或空输入时原样返回', () => {
    expect(expandTriggers('hy1', []).output).toBe('hy1');
    expect(expandTriggers('', [rule({ trigger: 'hy1', replacement: 'X' })]).output).toBe('');
  });
});
