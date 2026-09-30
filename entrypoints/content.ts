import { defineContentScript } from '#imports';
import { expandTriggers } from '../lib/expander';
import { loadSettings, onSettingsChanged } from '../lib/storage';
import {
  findInputElement,
  findSendButton,
  getInputText,
  setInputText,
} from '../lib/deepseek-dom';
import type { TriggerRule } from '../lib/types';

export default defineContentScript({
  matches: ['https://chat.deepseek.com/*'],
  runAt: 'document_idle',
  main() {
    let rules: TriggerRule[] = [];
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
    const observer = new MutationObserver(() => {
      if (cachedInput && !cachedInput.isConnected) cachedInput = null;
      if (cachedSendButton && !cachedSendButton.isConnected) cachedSendButton = null;
    });
    observer.observe(document.body, { childList: true, subtree: true });
  },
});
