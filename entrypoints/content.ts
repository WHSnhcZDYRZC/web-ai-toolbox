import { defineContentScript } from '#imports';
import { expandTriggers } from '../lib/expander';
import { applyCodeBlockFold } from '../lib/code-block-fold';
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
  isEditableInput,
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

    /**
     * 最近一次 mousedown 时，焦点所在的可编辑元素。
     *
     * 为什么要单独记：点「发送」按钮时，焦点会在 mousedown 的**默认行为**里
     * 转移到按钮上（DeepSeek 的按钮是 div[tabindex=0]，可获得焦点）。
     * 事件派发顺序是 mousedown → mouseup → click，等到 click 阶段再读
     * document.activeElement 拿到的已经是按钮、不是用户输入的那个框了。
     * 实测：mousedown 时是编辑框，click 时已经是按钮。
     * 所以必须提前一拍把「按下那一刻焦点在哪个框」记下来。
     */
    let focusedInput: HTMLElement | null = null;
    document.addEventListener(
      'mousedown',
      () => {
        const active = document.activeElement;
        focusedInput = isEditableInput(active) ? active : null;
      },
      true,
    );

    // 元素引用缓存：事件监听全部挂在 document 级 capture，天然抗 DOM 重建；
    // 缓存仅用于减少重复查询，MutationObserver 在 DOM 变化时使其失效。
    let cachedInput: HTMLElement | null = null;
    let cachedSendButton: HTMLElement | null = null;
    /** 缓存发送按钮时所依据的输入框锚点，锚点换了（主输入框 ↔ 编辑框）就重新找 */
    let cachedSendButtonAnchor: HTMLElement | null = null;

    const resolveInput = (): HTMLElement | null => {
      if (!cachedInput || !cachedInput.isConnected) cachedInput = findInputElement();
      return cachedInput;
    };

    /**
     * 定位「这一次真正要发送」的输入框。
     *
     * 页面上常态就存在两个可编辑元素：底部主输入框，以及编辑已发消息时
     * DeepSeek 插入的编辑框。单靠缓存会拿错对象——编辑框是新插入的元素，
     * 而缓存里的旧框依然 isConnected，失效条件永远不触发，于是每次都读到
     * 主输入框（通常是空的），replacedCount 恒为 0，拦截直接放行。
     *
     * 改成以焦点为准：符合直觉，也不依赖 DeepSeek 的 class，改版不会失效。
     *   1. 焦点就在某个可编辑元素上（按回车时）→ 用它
     *   2. 否则用 mousedown 时记下的那个（点发送按钮时）→ 用它
     *   3. 都没有才回退到缓存（脚本触发等边缘场景）
     */
    const resolveTargetInput = (): HTMLElement | null => {
      const active = document.activeElement;
      if (isEditableInput(active)) return active;
      if (focusedInput?.isConnected) return focusedInput;
      return resolveInput();
    };

    const resolveSendButton = (): HTMLElement | null => {
      const anchor = resolveTargetInput();
      if (!cachedSendButton || !cachedSendButton.isConnected || cachedSendButtonAnchor !== anchor) {
        cachedSendButton = findSendButton(anchor);
        cachedSendButtonAnchor = anchor;
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

    // 同一个事件循环内的连续 mutation 只处理一次，避免深度思考流式输出时高频空转
    let domWorkScheduled = false;
    const scheduleDomWork = () => {
      if (domWorkScheduled) return;
      domWorkScheduled = true;
      setTimeout(() => {
        domWorkScheduled = false;
        collapseThoughts();
        // 开关关闭时 applyCodeBlockFold 会走清理分支，这里提前跳过省一次遍历
        if (prefs.foldCodeBlocks) applyCodeBlockFold(true);
      }, 0);
    };

    // 首屏已存在的思考块：进页面就折（用户可见的即时效果）
    loadPrefs().then((loaded) => {
      prefs = loaded;
      collapseThoughts();
      applyCodeBlockFold(prefs.foldCodeBlocks);
    });
    // 用户在 popup 里开关切换后立即生效
    onPrefsChanged((next) => {
      prefs = next;
      if (prefs.collapseThoughts) collapseThoughts();
      applyCodeBlockFold(prefs.foldCodeBlocks);
    });

    /** 对当前输入框内容执行一次触发词展开，返回实际替换次数 */
    const expandAndApply = (): number => {
      if (composing) return 0;
      const input = resolveTargetInput();
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
    // 同时顺带处理新生成的思考块与代码块（已处理的会被跳过）
    const observer = new MutationObserver(() => {
      if (cachedInput && !cachedInput.isConnected) cachedInput = null;
      if (cachedSendButton && !cachedSendButton.isConnected) cachedSendButton = null;
      scheduleDomWork();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  },
});
