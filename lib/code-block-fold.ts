/**
 * HTML 代码块的折叠工具条。
 *
 * DeepSeek 自带复制/下载/运行，本模块只补它没有的「折叠/展开」——
 * 一段几百行的 HTML 会把页面顶出 8000px，不折的话完全没法继续往下看。
 *
 * 按钮是本扩展自己注入的 DOM，不在 React 虚拟树里。DeepSeek 重渲染时
 * 可能把它一并清掉，所以每次调 refreshHtmlCodeBlocks() 都会检查并补回。
 */

import {
  findHtmlCodeBlocks,
  foldCodeBlock,
  getCodeLineCount,
  isCodeBlockFolded,
  unfoldCodeBlock,
} from './deepseek-dom';

const BTN_CLASS = 'tse-fold-btn';
const STYLE_ID = 'tse-code-fold-style';
const BANNER_SELECTOR = '.md-code-block-banner-wrap';

/** 已经由本扩展处理过的代码块，避免重复注入和重复折叠 */
const processed = new WeakSet<HTMLElement>();

/**
 * 按钮样式。用 currentColor 描边，这样深色/浅色主题下都能自适应，
 * 不用去猜 DeepSeek 的具体主题变量。
 */
function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.${BTN_CLASS} {
  height: 24px;
  padding: 0 10px;
  margin-left: 8px;
  border: 1px solid currentColor;
  border-radius: 12px;
  background: transparent;
  color: inherit;
  opacity: 0.65;
  font-size: 12px;
  font-family: inherit;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
  transition: opacity 0.15s;
}
.${BTN_CLASS}:hover { opacity: 1; }
`;
  (document.head || document.documentElement).appendChild(style);
}

/** 折叠时带上行数，让用户不展开也知道这坨代码有多大 */
function syncLabel(block: HTMLElement, btn: HTMLButtonElement): void {
  if (isCodeBlockFolded(block)) {
    const lines = getCodeLineCount(block);
    btn.textContent = lines > 0 ? `展开（${lines} 行）` : '展开';
    btn.title = '展开代码';
  } else {
    btn.textContent = '折叠';
    btn.title = '折叠代码';
  }
}

function toggle(block: HTMLElement, btn: HTMLButtonElement): void {
  if (isCodeBlockFolded(block)) {
    unfoldCodeBlock(block);
  } else {
    foldCodeBlock(block);
  }
  syncLabel(block, btn);
}

/**
 * 找到与 DeepSeek 自带按钮并排的那一层容器。
 *
 * banner-wrap 本身是 block，真正并排的是它里面那层满宽 flex：
 *   banner-wrap > <flex, space-between> > [语言标签] [复制/下载/运行]
 * 按钮若挂在 banner-wrap 上，因为内层已占满整行，只能掉到下一行去，
 * 视觉上会跟 DeepSeek 的消息操作栏混在一起。所以要插到同一层。
 *
 * 用「第一个纯语言名的 span」反推该层：它的祖父元素就是那个 flex 容器。
 * 整条路径都不依赖构建期 hash class。
 */
function findButtonHost(banner: HTMLElement): HTMLElement | null {
  for (const span of banner.querySelectorAll('span')) {
    const t = (span.textContent || '').trim();
    if (/^[a-zA-Z0-9+#._-]{1,12}$/.test(t)) {
      return (span.parentElement?.parentElement as HTMLElement) || null;
    }
  }
  return null;
}

/** 把按钮挂进代码块头部；DeepSeek 把它删了就重新挂一个 */
function ensureButton(block: HTMLElement): HTMLButtonElement | null {
  const existing = block.querySelector<HTMLButtonElement>(`.${BTN_CLASS}`);
  if (existing) return existing;

  const banner = block.querySelector<HTMLElement>(BANNER_SELECTOR);
  if (!banner) return null;

  // header 还没渲染出语言标签就等下一轮，别硬塞
  const host = findButtonHost(banner);
  if (!host) return null;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = BTN_CLASS;
  // 别让点击冒到 DeepSeek 自己的按钮逻辑上
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggle(block, btn);
  });
  host.appendChild(btn);
  return btn;
}

function processBlock(block: HTMLElement): void {
  if (processed.has(block)) return;
  processed.add(block);

  const btn = ensureButton(block);
  if (!btn) {
    // 头部还没渲染出来，别记进 processed，等下一轮再来
    processed.delete(block);
    return;
  }
  // 新出现的 HTML 代码块一律默认折叠
  foldCodeBlock(block);
  syncLabel(block, btn);
}

/** 首屏处理：在进页面时把已存在的 HTML 代码块折好 */
export function setupHtmlCodeBlocks(): void {
  ensureStyles();
  for (const block of findHtmlCodeBlocks()) processBlock(block);
}

/**
 * 供 MutationObserver 调用：补回被 React 冲掉的按钮，并折叠新出现的代码块。
 * 内部按节点去重，重复调用很便宜。
 */
export function refreshHtmlCodeBlocks(): void {
  ensureStyles();
  for (const block of findHtmlCodeBlocks()) processBlock(block);
}