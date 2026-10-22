# DeepSeek Trigger Expander

一个只作用于 `https://chat.deepseek.com/` 的浏览器扩展（Chrome / Edge，Manifest V3）：在消息**发送前**，把输入框里的触发词自动展开为你配置的完整文本。例如输入 `hy1` 按 Enter，实际发送的是 `hy1` 映射的长文本。

## 功能

- **发送前替换**：按 Enter 发送、点击发送按钮发送，都会在真正发送前完成替换（不是输入时实时替换）。
- **独立词匹配**：`hy1` 可替换；`hy123`、`xhy1`、`hy1_extra` 不会误伤。忽略大小写匹配。
- **不递归展开**：展开后的文本里即使含有其他触发词，也不再处理。
- **规则管理**：点击工具栏插件图标打开配置页，动态增删、启用/停用，最多 20 条；支持导入 / 导出 JSON。
- **即改即生效**：保存后通过 `chrome.storage.onChanged` 热更新，无需刷新扩展。
- **输入法安全**：中文输入法组合期间（`isComposing`）不做任何替换；不干扰 Shift+Enter 换行。
- **思考内容默认折叠**（可选）：在设置里打开后，DeepSeek 深度思考结束即自动折叠思考过程。实测一条思考可渲染到 5000px 以上，回看历史会话时非常占版面。思考进行中不受影响，随时可手动展开。

## 隐私与权限

- 最小权限：仅 `storage` + `https://chat.deepseek.com/*`，不申请 `<all_urls>`。
- **配置仅保存在当前设备**（`chrome.storage.local`），不随浏览器账号同步；清除扩展数据后规则消失。
- 不收集、不上传任何聊天内容；替换文本只以纯文本写入输入框，不作为 HTML 插入。

## 技术栈

- 扩展框架：WXT（MV3 适配、manifest 生成、打包）
- Content Script：原生 TypeScript / DOM API（7.7 kB，不注入 React/antd 到页面）
- Popup 配置页：React 19 + Ant Design v6
- 测试：Vitest（替换算法为纯函数，11 个单测）

## 构建与安装

```bash
pnpm install
pnpm run build        # 产物在 .output/chrome-mv3
pnpm run zip          # 可选，产出可分发的 zip
pnpm run test         # 运行单元测试
pnpm run typecheck    # TypeScript 类型检查
node scripts/generate-icons.mjs   # 重新生成扩展图标（可选，纯 Node 无依赖）
```

加载扩展：

1. Chrome / Edge 打开 `chrome://extensions`（Edge 为 `edge://extensions`）。
2. 开启右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择本项目的 `.output/chrome-mv3` 目录。

## 使用方法

1. 打开 `https://chat.deepseek.com/`。
2. 点击浏览器工具栏的插件图标，打开配置页。
3. 新增规则，例如触发词 `hy1` → 展开文本 `请用中文总结以下内容：`。
4. 在 DeepSeek 输入框输入 `hy1`，按 Enter 或点击发送按钮——实际发送的是展开后的文本。
5. 输入 `hy123` 或 `xhy1` 不会触发替换；Shift+Enter 仍可正常换行。

## 思考内容折叠

点击 popup 右上角的 ⚙ 打开设置，打开「思考内容默认折叠」开关：

- 开关打开后，**已完成**的思考块（「已思考（用时 N 秒）」）会立即折叠，新产生的思考块也会在完成后自动折叠
- 思考进行中（「正在思考」）不折叠，方便实时查看推理过程
- 该开关单独存放在 `chrome.storage.local` 的 `...:prefs:v1`，与触发词规则互不影响，导出/导入规则 JSON 不包含它

## 维护说明

DeepSeek 前端改版可能导致输入框 / 发送按钮 / 思考折叠区的定位失效。所有 DeepSeek 相关的选择器与 DOM 写入逻辑**集中维护在 `lib/deepseek-dom.ts`**，页面结构变化时只需修改该文件。

### 思考折叠区（2026-10 实测，改版后请重新核对）

- 容器靠内联 CSS 变量 `--collapsible-area-title-height` 锚定。DeepSeek 的 class 基本都是构建期 hash（`_74c0879` 等），**发版即变不可依赖**；只有 `ds-` 前缀的是语义化 class。
- 展开/折叠 **没有** `aria-expanded`，class 也完全不变。唯一可靠差异是正文 `.ds-think-content`——展开时挂载，折叠时**直接从 DOM 卸载**（不是隐藏）。
- 标题行恒为容器的第一个子元素，点击它即可切换。
- `ds-collapsible-text` 是**用户提问**的文本，不是思考块标题，别认错。

发送拦截策略（`entrypoints/content.ts`）：

- **Enter 键**：capture 阶段先替换（native value setter + `input` 事件），再放行让页面自己的逻辑发送。
- **发送按钮点击**：capture 阶段若实际发生了替换，则拦截本次点击、完成替换后程序化重发；重发时替换已完成，自然放行，不会死循环。

## 已知限制

- 仅支持 Chrome / Edge 现代版本（替换算法使用 RegExp lookbehind）。
- DeepSeek 页面为动态 SPA，偶发的 DOM 结构变化需要按上述维护说明跟进修复。
