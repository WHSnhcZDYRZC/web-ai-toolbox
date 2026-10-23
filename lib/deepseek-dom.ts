/**
 * DeepSeek 页面 DOM 接入层。
 *
 * ⚠️ 集中维护点：DeepSeek 前端改版后，本文件中的选择器与定位逻辑
 * 是唯一需要修改的地方，请勿把 DeepSeek 相关的 selector 散落到其他文件。
 *
 * 定位策略均为多级 fallback：
 * - 输入框：textarea → contenteditable → 发送按钮所在容器内的可编辑元素
 * - 发送按钮：button[type="submit"] → aria-label/title/文本含“发送/Send” → 输入框附近的图标按钮
 * - 思考折叠区：CSS 变量锚定 → 标题文本锚定
 */

/** 聊天输入框候选选择器，按优先级排列 */
const INPUT_SELECTORS = [
  'textarea',
  '[contenteditable="true"]',
] as const;

/** 发送按钮 aria-label / title / 文本中的关键字（忽略大小写） */
const SEND_BUTTON_KEYWORDS = ['发送', 'send'];

/*
 * ── 思考折叠区 ──────────────────────────────────────────────────────────
 *
 * 以下结论来自 2026-10 对真实页面的实测，改版后请重新核对：
 *
 * 1. DeepSeek 的 class 基本都是构建期 hash（`_74c0879`、`c2b72bb8`…），
 *    发版即变，**不可依赖**。只有 `ds-` 前缀的是语义化 class，相对稳定
 *    （ds-think-content、ds-message、ds-toggle-button、ds-collapsible-text 等）。
 *    折叠区容器改用内联 CSS 变量 `--collapsible-area-title-height` 锚定。
 * 2. 展开/折叠 **没有** aria-expanded，class 也不变——两者完全一致。
 *    唯一可靠的差异是思考正文 `.ds-think-content`：
 *    展开时挂载，折叠时直接从 DOM 卸载（不是隐藏）。
 * 3. 标题行恒为容器的第一个子元素，点击它即可切换折叠状态。
 *    实测点击标题文本 span、标题行、标题区均有效。
 * 4. 注意 `ds-collapsible-text` 是**用户提问**的文本，不是思考块标题，别认错。
 */

/** 折叠区容器：靠内联 CSS 变量锚定，避开构建期 hash class */
const COLLAPSIBLE_AREA_SELECTOR = 'div[style*="--collapsible-area-title-height"]';

/** 思考正文节点：挂载即展开 */
const THINK_CONTENT_SELECTOR = '.ds-think-content';

/** 已完成思考的标题文案，如「已思考（用时 25 秒）」；思考进行中是「正在思考」 */
const DONE_THINK_TITLE_RE = /^已思考/;

/*
 * ── HTML 代码块 ──────────────────────────────────────────────────────────
 *
 * 以下结论来自 2026-10 对真实页面的实测：
 *
 * 1. 代码块容器是 `div.md-code-block`（深色主题再叠 `md-code-block-dark`），
 *    属于有语义的 class，比思考块那套 hash class 可靠。
 * 2. 头部 `div.md-code-block-banner-wrap` 里依次是「语言标签 + 复制/下载/(运行)按钮」。
 *    语言标签文本在最前，例如 html 块整体文本是 `html复制下载运行`；
 *    按钮都是 `ds-button`，无 aria-label，只能靠文本识别。
 * 3. 正文在 `pre` 里，**没有 `<code>` 子元素**，而是每行一个 `<span>`；
 *    取全文直接用 `pre.textContent`。
 * 4. 代码块本身完全没有折叠能力：无 aria-expanded、无 max-height 限制，
 *    361 行的 HTML 实测渲染高度 7964px，直接顶满视口。
 *
 * ⚠️ DeepSeek 自带复制/下载/运行（html 块才有「运行」）。本扩展只补它没有的折叠，
 * 不要重复实现那三个按钮，免得两边打架。
 */

/** 代码块容器 */
const CODE_BLOCK_SELECTOR = '.md-code-block';
/** 代码块头部：语言标签与自带按钮所在 */
const CODE_BANNER_SELECTOR = '.md-code-block-banner-wrap';
/** 折叠时打在我们藏起来的 pre 上的标记 */
const FOLD_MARK_ATTR = 'data-tse-folded';

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

/**
 * 判断是否是可编辑输入元素（textarea / input / contenteditable）。
 *
 * content script 靠它区分「用户正在打字的那个框」和别的元素。
 */
export function isEditableInput(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  return (
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLInputElement ||
    el.isContentEditable
  );
}

/** 定位发送按钮；可选传入输入框以启用容器锚定与“附近图标按钮”兜底 */
export function findSendButton(input?: HTMLElement | null): HTMLElement | null {
  // 0. 锚定到输入框自身所在的容器。
  //
  //    实测（2026-10）：DeepSeek 的发送键是「输入框所在容器里的主色按钮」，
  //    正常态为 .ds-button--primary…ds-button--circle（右下角圆形），
  //    编辑态为 .ds-button--primary…ds-button--capsule（文字「发送」）。
  //    两者都能用同一个 .ds-button--primary 命中，且沿输入框向上第 2 层就命中，
  //    两个场景各自指向自己的按钮、不会互相串台。
  //
  //    这一级必须放在最前面：旧的三级 fallback 全是全页面/父容器扫描，
  //    而主输入框的父容器里根本没有可点击元素，导致正常态找不到按钮、
  //    点击发送时压根不拦截触发词。
  if (input) {
    let cur: HTMLElement | null = input;
    for (let d = 0; d < 6 && cur; d++) {
      const btn = cur.querySelector<HTMLElement>('.ds-button--primary');
      if (btn && isVisible(btn)) return btn;
      cur = cur.parentElement;
    }
  }

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

/**
 * 找到所有**已完成**的思考折叠区。
 *
 * 只认「已思考…」的标题，刻意跳过「正在思考」：思考进行中正文在流式增长，
 * 此刻去折叠既会打断用户的实时反馈，也会和 MutationObserver 的高频回调打架。
 * 等它转为「已思考」后再折叠，才是稳定的终态。
 *
 * fallback：主路径用 CSS 变量锚定容器；若 DeepSeek 改名该变量，
 * 退化为按标题文本找到 span，再向上取第一个「自己比标题高不少」的祖先
 * ——高度差是折叠区与普通 span 容器的可靠区别。
 */
export function findThoughtAreas(): HTMLElement[] {
  const areas: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();

  for (const el of document.querySelectorAll<HTMLElement>(COLLAPSIBLE_AREA_SELECTOR)) {
    const row = el.firstElementChild as HTMLElement | null;
    if (row && DONE_THINK_TITLE_RE.test((row.textContent ?? '').trim())) {
      areas.push(el);
      seen.add(el);
    }
  }
  if (areas.length) return areas;

  for (const span of document.querySelectorAll<HTMLElement>('span, div, button')) {
    if (!DONE_THINK_TITLE_RE.test((span.textContent ?? '').trim())) continue;
    let cur = span.parentElement;
    for (let d = 0; d < 8 && cur; d++) {
      if (seen.has(cur)) break;
      // 容器至少要比标题本身高出一截，否则不是折叠区而是标题自己
      if (cur.offsetHeight > span.offsetHeight + 8) {
        areas.push(cur);
        seen.add(cur);
        break;
      }
      cur = cur.parentElement;
    }
  }
  return areas;
}

/**
 * 思考块是否处于展开态。
 * 判据只有一个：正文节点是否挂在 DOM 里（折叠时 DeepSeek 直接卸载它）。
 */
export function isThoughtExpanded(area: HTMLElement): boolean {
  return area.querySelector(THINK_CONTENT_SELECTOR) !== null;
}

/**
 * 折叠一个思考块，返回是否真的折叠了。
 * 点击的是容器第一个子元素（标题行），由 DeepSeek 自己的逻辑去做高度动画。
 * 已经是折叠态时直接返回 false，调用方据此避免重复点击。
 */
export function collapseThought(area: HTMLElement): boolean {
  if (!isThoughtExpanded(area)) return false;
  const row = area.firstElementChild as HTMLElement | null;
  if (!row) return false;
  row.click();
  return true;
}

/**
 * 读出代码块的语言标签，如 `html` / `python` / `cpp`。
 * banner 文本形如「html复制下载运行」，语言在最前面。
 */
export function getCodeLang(block: HTMLElement): string {
  const banner = block.querySelector<HTMLElement>(CODE_BANNER_SELECTOR);
  if (!banner) return '';
  const m = /^\s*([a-zA-Z0-9+#._-]+)/.exec(banner.textContent || '');
  return (m?.[1] ?? '').toLowerCase();
}

/** 正文行数，用于折叠后仍能让用户看出这坨代码有多大 */
export function getCodeLineCount(block: HTMLElement): number {
  const pre = block.querySelector('pre');
  const text = (pre?.textContent || '').trim();
  return text ? text.split('\n').length : 0;
}

/** 找到页面里所有 HTML 代码块 */
export function findHtmlCodeBlocks(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(CODE_BLOCK_SELECTOR)).filter(
    (block) => getCodeLang(block) === 'html',
  );
}

/**
 * 是否处于本扩展的折叠态。
 * 只认打过 FOLD_MARK_ATTR 的 pre，避免误判 DeepSeek 自己隐藏的代码块。
 */
export function isCodeBlockFolded(block: HTMLElement): boolean {
  const pre = block.querySelector('pre');
  return !!pre?.hasAttribute(FOLD_MARK_ATTR);
}

/**
 * 折叠代码块（只留标题行）。返回是否发生了折叠。
 *
 * 直接藏 pre 而不是改 max-height：DeepSeek 对 pre 用的是 `overflow:auto`
 * 且不限高，写内联 display 最不容易和它的样式打架。
 */
export function foldCodeBlock(block: HTMLElement): boolean {
  const pre = block.querySelector<HTMLElement>('pre');
  if (!pre || isCodeBlockFolded(block)) return false;
  pre.setAttribute(FOLD_MARK_ATTR, '');
  pre.style.display = 'none';
  return true;
}

/** 展开代码块，返回是否发生了展开 */
export function unfoldCodeBlock(block: HTMLElement): boolean {
  const pre = block.querySelector<HTMLElement>('pre');
  if (!pre || !isCodeBlockFolded(block)) return false;
  pre.removeAttribute(FOLD_MARK_ATTR);
  pre.style.display = '';
  return true;
}
