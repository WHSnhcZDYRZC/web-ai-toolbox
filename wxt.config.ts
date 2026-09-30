import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'DeepSeek Trigger Expander',
    description: '在 DeepSeek 聊天发送前，将触发词自动展开为完整文本',
    version: '0.1.0',
    permissions: ['storage'],
    host_permissions: ['https://chat.deepseek.com/*'],
    icons: {
      16: 'icons/16.png',
      32: 'icons/32.png',
      48: 'icons/48.png',
      128: 'icons/128.png',
    },
    action: {
      default_title: 'DeepSeek 触发词配置',
      default_icon: {
        16: 'icons/16.png',
        32: 'icons/32.png',
        48: 'icons/48.png',
        128: 'icons/128.png',
      },
    },
  },
});
