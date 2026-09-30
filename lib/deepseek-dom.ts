/**
 * DeepSeek 页面 DOM 接入层。
 *
 * ⚠️ 集中维护点：DeepSeek 前端改版后，本文件中的选择器与定位逻辑
 * 是唯一需要修改的地方，请勿把 DeepSeek 相关的 selector 散落到其他文件。
 *
 * 定位策略均为多级 fallback：
 * - 输入框：textarea → contenteditable → 发送按钮所在容器内的可编辑元素
 * - 发送按钮：button[type="submit"] → aria-label/title/文本含“发送/Send” → 输入框附近的图标按钮
 */

/** 聊天输入框候选选择器，按优先级排列 */
const INPUT_SELECTORS = [
  'textarea',
  '[contenteditable="true"]',
] as const;

/** 发送按钮 aria-label / title / 文本中的关键字（忽略大小写） */
const SEND_BUTTON_KEYWORDS = ['发送', 'send'];

function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function firstVisible(selector: string, root: ParentNode = document): HTMLElement | null {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
    if (isVisible(el)) return el;
  }
  return null;
}

/** 定位聊天输入框，返回 textarea 或 contenteditable 元素 */
export function findInputElement(): HTMLElement | null {
  for (const selector of INPUT_SELECTORS) {
    const el = firstVisible(selector);
    if (el) return el;
  }
  // fallback：在发送按钮所在的表单/容器内找可编辑元素
  const sendButton = findSendButton();
  if (sendButton) {
    const container = sendButton.closest('form, [class*="chat"], [class*="editor"], main') ?? sendButton.parentElement;
    if (container) {
      for (const selector of INPUT_SELECTORS) {
        const el = firstVisible(selector, container);
        if (el) return el;
      }
    }
  }
  return null;
}

function isSendButtonByText(el: HTMLElement): boolean {
  const text = [el.getAttribute('aria-label'), el.getAttribute('title'), el.textContent]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return SEND_BUTTON_KEYWORDS.some((kw) => text.includes(kw));
}

/** 定位发送按钮；可选传入输入框以启用“附近图标按钮”兜底 */
export function findSendButton(input?: HTMLElement | null): HTMLElement | null {
  // 1. button[type="submit"]
  const submit = firstVisible('button[type="submit"]');
  if (submit) return submit;

  // 2. aria-label / title / 文本含“发送 / Send”
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'))) {
    if (isVisible(el) && isSendButtonByText(el)) return el;
  }

  // 3. 输入框附近的图标按钮（无文本、含 svg/img 的按钮）
  const anchor = input ?? findInputElement();
  if (anchor) {
    const container = anchor.closest('form, [class*="chat"], [class*="editor"], main') ?? anchor.parentElement;
    if (container) {
      for (const el of Array.from(container.querySelectorAll<HTMLElement>('button, [role="button"]'))) {
        if (!isVisible(el)) continue;
        const hasIcon = !!el.querySelector('svg, img');
        const noText = !(el.textContent ?? '').trim();
        if (hasIcon && noText) return el;
      }
    }
  }
  return null;
}

/** 读取输入框当前文本（textarea 读 value，contenteditable 读 innerText） */
export function getInputText(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    return el.value;
  }
  return el.innerText ?? '';
}

/**
 * 以纯文本方式把 text 写入输入框，并触发页面框架能感知的事件。
 * 绝不以 HTML 形式插入（防 XSS）。
 */
export function setInputText(el: HTMLElement, text: string): void {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    // 使用 native value setter，绕过 React 等框架对 value 的包装
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    descriptor?.set?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  // contenteditable：优先 Selection/Range 全选后 execCommand('insertText')，
  // 让页面框架（如 ProseMirror/Lexical）正常感知输入
  el.focus();
  const selection = window.getSelection();
  if (selection) {
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, text);
    } catch {
      inserted = false;
    }
    if (inserted) return;
  }

  // 兜底：直接写 textContent 再 dispatch input
  el.textContent = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
