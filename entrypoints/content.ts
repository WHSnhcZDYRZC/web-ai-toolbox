import { defineContentScript } from '#imports';
import { expandTriggers } from '../lib/expander';
import {
  loadPrefs,
  loadSettings,
  onPrefsChanged,
  onSettingsChanged,
} from '../lib/storage';
import {
  collapseThought,
  findInputElement,
  findSendButton,
  findThoughtAreas,
  getInputText,
  isThoughtExpanded,
  setInputText,
} from '../lib/deepseek-dom';
import { DEFAULT_PREFS, type Prefs, type TriggerRule } from '../lib/types';

export default defineContentScript({
  matches: ['https://chat.deepseek.com/*'],
  runAt: 'document_idle',
  main() {
    let rules: TriggerRule[] = [];
    let prefs: Prefs = { ...DEFAULT_PREFS };
    let composing = false;

    // 元素引用缓存：事件监听全部挂在 document 级 capture，天然抗 DOM 重建；
    // 缓存仅用于减少重复查询，MutationObserver 在 DOM 变化时使其失效。
    let cachedInput: HTMLElement | null = null;
    let cachedSendButton: HTMLElement | null = null;

    const resolveInput = (): HTMLElement | null => {
      if (!cachedInput || !cachedInput.isConnected) cachedInput = findInputElement();
      return cachedInput;
    };
    const resolveSendButton = (): HTMLElement | null => {
      if (!cachedSendButton || !cachedSendButton.isConnected) {
        cachedSendButton = findSendButton(resolveInput());
      }
      return cachedSendButton;
    };

    loadSettings().then((settings) => {
      rules = settings.rules;
    });
    onSettingsChanged((settings) => {
      rules = settings.rules;
    });

    /**
     * 已由本扩展折叠过的 DOM 节点。
     *
     * 折叠是异步的：点完标题后 DeepSeek 要等下一次 React 渲染才会卸载正文，
     * 在这之前 isThoughtExpanded() 仍然为 true。而点击本身又会触发 observer，
     * 于是下一轮回调会对同一个节点再点一次——用户刚展开的内容会被立刻折回去，
     * 反复横跳。标记并跳过即可。
     */
    const selfCollapsed = new WeakSet<HTMLElement>();

    /**
     * 折叠所有「已完成」的思考块。
     *
     * 只在开关打开时动作。已折过的节点由 selfCollapsed 跳过，
     * 因此在首屏 / 偏好变更 / observer 多处触发都安全。
     */
    const collapseThoughts = () => {
      if (!prefs.collapseThoughts) return;
      let folded = 0;
      for (const area of findThoughtAreas()) {
        if (selfCollapsed.has(area)) continue;
        if (!collapseThought(area)) continue;
        selfCollapsed.add(area);
        folded += 1;
        // 点击若没生效（节点被重渲染掉、或切换过快），撤销标记交给下一轮重试
        setTimeout(() => {
          if (isThoughtExpanded(area)) selfCollapsed.delete(area);
        }, 120);
      }
      if (folded) console.debug('[deepseek-trigger-expander] 已折叠思考内容:', folded, '条');
    };

    // 同一个事件循环内的连续 mutation 只折叠一次，避免深度思考流式输出时高频空转
    let collapseScheduled = false;
    const scheduleCollapse = () => {
      if (collapseScheduled || !prefs.collapseThoughts) return;
      collapseScheduled = true;
      setTimeout(() => {
        collapseScheduled = false;
        collapseThoughts();
      }, 0);
    };

    // 首屏已存在的思考块：进页面就折（用户可见的即时效果）
    loadPrefs().then((loaded) => {
      prefs = loaded;
      collapseThoughts();
    });
    // 用户在 popup 里开关切换后立即生效
    onPrefsChanged((next) => {
      prefs = next;
      if (prefs.collapseThoughts) collapseThoughts();
    });

    /** 对当前输入框内容执行一次触发词展开，返回实际替换次数 */
    const expandAndApply = (): number => {
      if (composing) return 0;
      const input = resolveInput();
      if (!input) return 0;
      const text = getInputText(input);
      if (!text) return 0;
      const { output, replacedCount, matchedTriggers } = expandTriggers(text, rules);
      if (replacedCount === 0) return 0;
      setInputText(input, output);
      console.debug('[deepseek-trigger-expander] 已展开触发词:', matchedTriggers);
      return replacedCount;
    };

    // 输入法组合状态：组合期间不做任何替换
    document.addEventListener('compositionstart', () => { composing = true; }, true);
    document.addEventListener('compositionend', () => { composing = false; }, true);

    // Enter 发送：capture 阶段先替换，再放行让页面自己的 handler 发送
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing || composing) return;
        expandAndApply();
      },
      true,
    );

    // 发送按钮点击：capture 阶段判断目标是否在发送按钮内。
    // 若发生替换则拦截本次点击，完成替换后程序化重发；
    // 重发时替换已完成（replacedCount === 0），自然放行，不会死循环。
    document.addEventListener(
      'click',
      (event) => {
        const target = event.target as Element | null;
        if (!target) return;
        const sendButton = resolveSendButton();
        if (!sendButton || !sendButton.contains(target)) return;
        if (expandAndApply() === 0) return;
        event.preventDefault();
        event.stopPropagation();
        // 延迟到下一拍重发，给页面框架处理 input 事件、更新内部状态的时间
        setTimeout(() => sendButton.click(), 0);
      },
      true,
    );

    // SPA 路由变化 / 输入框重建：使缓存失效，下次事件时重查元素引用
    // 同时顺带处理新生成的思考块（已折叠的会被 collapseThought 跳过）
    const observer = new MutationObserver(() => {
      if (cachedInput && !cachedInput.isConnected) cachedInput = null;
      if (cachedSendButton && !cachedSendButton.isConnected) cachedSendButton = null;
      scheduleCollapse();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  },
});
