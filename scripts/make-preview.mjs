// 生成带 chrome.storage 桩的 popup 预览页，用于无头截图（临时文件，用完即删）
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('.output/chrome-mv3/popup.html', 'utf8');

const sampleRules = process.argv.includes('--empty') ? [] : [
  { id: '1', trigger: 'hy1', replacement: '请用中文总结以下内容，分三点列出要点，每点不超过五十字', enabled: true, createdAt: 0, updatedAt: 0 },
  { id: '2', trigger: 'hy2', replacement: '扮演资深前端架构师，Review 以下代码并给出改进建议：\n一、运行效率\n二、代码可读性', enabled: true, createdAt: 0, updatedAt: 0 },
  { id: '3', trigger: 'translate', replacement: '翻译成英文，保持专业术语准确', enabled: false, createdAt: 0, updatedAt: 0 },
  { id: '4', trigger: 'prompt-a', replacement: '这是一条比较长的展开文本示例，用来验证两行省略的显示效果是否正常，超出部分应该被截断并显示为省略号结尾', enabled: true, createdAt: 0, updatedAt: 0 },
];

const stub = `<script>
window.chrome = { storage: { local: {
  get: () => Promise.resolve({ 'deepseek-trigger-expander:settings:v1': ${JSON.stringify({ version: 1, rules: sampleRules })} }),
  set: () => Promise.resolve(),
}, onChanged: { addListener: () => {}, removeListener: () => {} } } };
</script>`;

writeFileSync('.output/chrome-mv3/preview.html', html.replace('<script', stub + '<script'));
console.log('preview.html written');
