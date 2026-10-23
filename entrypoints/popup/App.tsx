import { useEffect, useRef, useState } from 'react';
import {
  App as AntdApp,
  Button,
  Drawer,
  Form,
  Input,
  Popconfirm,
  Space,
  Spin,
  Switch,
  Upload,
} from 'antd';
import type { UploadProps } from 'antd';
import {
  DeleteOutlined,
  DownloadOutlined,
  PlusOutlined,
  SearchOutlined,
  SettingOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { loadPrefs, loadSettings, normalizeSettings, savePrefs, saveSettings } from '../../lib/storage';
import {
  DEFAULT_PREFS,
  MAX_RULES,
  TRIGGER_PATTERN,
  createRule,
  type Prefs,
  type TriggerRule,
} from '../../lib/types';

type RuleFormValues = {
  trigger: string;
  replacement: string;
  enabled: boolean;
};

const EXPORT_FILE_NAME = 'deepseek-trigger-rules.json';

/** 开关开启/关闭时的提示语，与设置面板里的说明一一对应 */
const PREF_LABELS: Record<keyof Prefs, (on: boolean) => string> = {
  collapseThoughts: (on) => (on ? '思考内容将默认折叠' : '思考内容恢复默认展开'),
  foldCodeBlocks: (on) => (on ? 'HTML 代码块将默认折叠' : 'HTML 代码块恢复默认展开'),
};

type RuleCardProps = {
  rule: TriggerRule;
  expanded: boolean;
  onToggleExpand: (id: string) => void;
  onEdit: (rule: TriggerRule) => void;
  onToggleEnabled: (rule: TriggerRule, enabled: boolean) => void;
};

function RuleCard({ rule, expanded, onToggleExpand, onEdit, onToggleEnabled }: RuleCardProps) {
  const textRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  // 检测单行截断是否真实发生，只有溢出的卡片才显示“展开更多”
  useEffect(() => {
    const el = textRef.current;
    if (el) setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, [rule.replacement, expanded]);

  return (
    <div
      className={`rule-card${rule.enabled ? '' : ' is-disabled'}`}
      onClick={() => onEdit(rule)}
    >
      <div className="rule-main">
        <div className="rule-trigger">{rule.trigger}</div>
        <div ref={textRef} className={`rule-replacement${expanded ? ' is-expanded' : ''}`}>
          {rule.replacement}
        </div>
        {(overflowing || expanded) && (
          <button
            type="button"
            className="rule-expand-btn"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(rule.id);
            }}
          >
            {expanded ? '收起' : '展开更多'}
          </button>
        )}
      </div>
      <div className="rule-side" onClick={(e) => e.stopPropagation()}>
        <Switch
          size="small"
          checked={rule.enabled}
          onChange={(checked) => onToggleEnabled(rule, checked)}
        />
      </div>
    </div>
  );
}

export default function App() {
  const { message } = AntdApp.useApp();
  const [rules, setRules] = useState<TriggerRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<TriggerRule | null>(null);
  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());
  const [prefs, setPrefs] = useState<Prefs>({ ...DEFAULT_PREFS });
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [form] = Form.useForm<RuleFormValues>();

  useEffect(() => {
    loadSettings()
      .then((settings) => setRules(settings.rules))
      .catch(() => message.error('读取配置失败'))
      .finally(() => setLoading(false));
    loadPrefs()
      .then(setPrefs)
      .catch(() => message.error('读取设置失败'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
 * 偏好写入独立的 storage key，content script 通过 onPrefsChanged 热更新。
 * key 是 Prefs 的字段名，新增开关时不用再写一个新函数。
 */
  const handleTogglePref = async (key: keyof Prefs, checked: boolean) => {
    const next: Prefs = { ...prefs, [key]: checked };
    await savePrefs(next);
    setPrefs(next);
    message.success(PREF_LABELS[key](checked));
  };

  /** 写入 chrome.storage.local；content script 通过 storage.onChanged 热更新 */
  const persist = async (nextRules: TriggerRule[], successText: string) => {
    await saveSettings({ version: 1, rules: nextRules });
    setRules(nextRules);
    message.success(successText);
  };

  const openCreateDrawer = () => {
    setEditingRule(null);
    form.resetFields();
    form.setFieldsValue({ trigger: '', replacement: '', enabled: true });
    setDrawerOpen(true);
  };

  const openEditDrawer = (rule: TriggerRule) => {
    setEditingRule(rule);
    form.setFieldsValue({
      trigger: rule.trigger,
      replacement: rule.replacement,
      enabled: rule.enabled,
    });
    setDrawerOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    const trigger = values.trigger.trim();
    const now = Date.now();
    if (editingRule) {
      const next = rules.map((r) =>
        r.id === editingRule.id
          ? { ...r, trigger, replacement: values.replacement, enabled: values.enabled, updatedAt: now }
          : r,
      );
      await persist(next, '规则已更新');
    } else {
      await persist(
        [...rules, createRule({ trigger, replacement: values.replacement, enabled: values.enabled })],
        '规则已新增',
      );
    }
    setDrawerOpen(false);
  };

  const handleToggle = async (rule: TriggerRule, enabled: boolean) => {
    await persist(
      rules.map((r) => (r.id === rule.id ? { ...r, enabled, updatedAt: Date.now() } : r)),
      enabled ? `已启用 ${rule.trigger}` : `已停用 ${rule.trigger}`,
    );
  };

  const handleDelete = async (rule: TriggerRule) => {
    await persist(
      rules.filter((r) => r.id !== rule.id),
      '规则已删除',
    );
    setDrawerOpen(false);
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleExport = () => {
    const data = { version: 1 as const, rules };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = EXPORT_FILE_NAME;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport: UploadProps['beforeUpload'] = async (file) => {
    try {
      const raw: unknown = JSON.parse(await file.text());
      const parsed = normalizeSettings(raw);
      if (!parsed) {
        message.error('导入失败：文件格式不正确');
        return false;
      }
      const seen = new Set<string>();
      const imported: TriggerRule[] = [];
      let skipped = 0;
      for (const rule of parsed.rules) {
        const trigger = rule.trigger.trim();
        const key = trigger.toLowerCase();
        if (!TRIGGER_PATTERN.test(trigger) || !rule.replacement.trim() || seen.has(key)) {
          skipped += 1;
          continue;
        }
        if (imported.length >= MAX_RULES) {
          skipped += 1;
          continue;
        }
        seen.add(key);
        imported.push(createRule({ trigger, replacement: rule.replacement, enabled: rule.enabled }));
      }
      await persist(imported, `已导入 ${imported.length} 条规则${skipped ? `，跳过 ${skipped} 条无效/重复规则` : ''}`);
    } catch {
      message.error('导入失败：无法解析 JSON 文件');
    }
    return false;
  };

  const reachedLimit = rules.length >= MAX_RULES;

  /** 搜索：同时匹配触发词和展开文本，忽略大小写 */
  const query = search.trim().toLowerCase();
  const filteredRules = query
    ? rules.filter(
        (r) =>
          r.trigger.toLowerCase().includes(query) ||
          r.replacement.toLowerCase().includes(query),
      )
    : rules;

  return (
    <div className="app">
      <header className="app-header">
        <img className="app-logo" src="icons/48.png" alt="" />
        <div className="app-header-text">
          <div className="app-title">触发词配置</div>
          <div className="app-subtitle">DeepSeek 发送前自动展开</div>
        </div>
        <span className="app-count">
          {query ? `${filteredRules.length} 条匹配` : `${rules.length} / ${MAX_RULES}`}
        </span>
        <button
          type="button"
          className="app-settings-btn"
          aria-label="设置"
          title="设置"
          onClick={() => setPrefsOpen(true)}
        >
          <SettingOutlined />
        </button>
      </header>

      <div className="app-search">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索触发词或展开文本"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <main className="app-list">
        {loading ? (
          <div className="list-loading"><Spin /></div>
        ) : rules.length === 0 ? (
          <div className="list-empty">
            <img className="list-empty-logo" src="icons/128.png" alt="" />
            <div className="list-empty-title">还没有触发词规则</div>
            <div className="list-empty-desc">
              例如：输入 hy1，发送时自动展开为完整提示词
            </div>
          </div>
        ) : filteredRules.length === 0 ? (
          <div className="list-empty">
            <div className="list-empty-title">没有匹配的规则</div>
            <div className="list-empty-desc">换个关键词试试，支持搜索触发词和展开文本</div>
          </div>
        ) : (
          filteredRules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              expanded={expandedIds.has(rule.id)}
              onToggleExpand={toggleExpand}
              onEdit={openEditDrawer}
              onToggleEnabled={handleToggle}
            />
          ))
        )}
      </main>

      <footer className="app-footer">
        <Button
          type="primary"
          block
          size="large"
          icon={<PlusOutlined />}
          disabled={reachedLimit}
          onClick={openCreateDrawer}
        >
          {reachedLimit ? `已达 ${MAX_RULES} 条上限` : '新增规则'}
        </Button>
        <div className="app-footer-row">
          <Upload accept=".json,application/json" showUploadList={false} beforeUpload={handleImport}>
            <Button type="text" size="small" icon={<UploadOutlined />}>导入</Button>
          </Upload>
          <Button
            type="text"
            size="small"
            icon={<DownloadOutlined />}
            disabled={!rules.length}
            onClick={handleExport}
          >
            导出
          </Button>
          <span className="app-tip">仅保存当前设备 · 保存即生效</span>
        </div>
      </footer>

      <Drawer
        title={editingRule ? '编辑规则' : '新增规则'}
        placement="bottom"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        height={420}
        destroyOnHidden
        footer={
          <div className="drawer-footer">
            {editingRule ? (
              <Popconfirm
                title={`删除触发词 ${editingRule.trigger}？`}
                okText="删除"
                cancelText="取消"
                onConfirm={() => handleDelete(editingRule)}
              >
                <Button type="text" danger icon={<DeleteOutlined />}>
                  删除
                </Button>
              </Popconfirm>
            ) : (
              <span />
            )}
            <Space>
              <Button onClick={() => setDrawerOpen(false)}>取消</Button>
              <Button type="primary" onClick={handleSubmit}>保存</Button>
            </Space>
          </div>
        }
      >
        <Form form={form} layout="vertical" initialValues={{ enabled: true }}>
          <Form.Item
            name="trigger"
            label="触发词"
            extra="仅 ASCII：字母开头，可含字母 / 数字 / 下划线 / 连字符，最长 32 字符"
            rules={[
              { required: true, whitespace: true, message: '请输入触发词' },
              {
                pattern: TRIGGER_PATTERN,
                message: '触发词格式非法：字母开头，仅含字母/数字/下划线/连字符，最长 32 字符',
              },
              {
                validator: (_, value: string) => {
                  const key = (value ?? '').trim().toLowerCase();
                  const duplicated = rules.some(
                    (r) => r.trigger.trim().toLowerCase() === key && r.id !== editingRule?.id,
                  );
                  return duplicated ? Promise.reject(new Error('触发词已存在（忽略大小写）')) : Promise.resolve();
                },
              },
            ]}
          >
            <Input placeholder="例如 hy1" maxLength={32} allowClear />
          </Form.Item>
          <Form.Item
            name="replacement"
            label="展开文本"
            extra="发送前会用这段文本替换触发词，支持换行"
            rules={[
              { required: true, message: '请输入展开文本' },
              {
                validator: (_, value: string) =>
                  (value ?? '').trim()
                    ? Promise.resolve()
                    : Promise.reject(new Error('展开文本不能为空白')),
              },
            ]}
          >
            <Input.TextArea rows={4} placeholder="例如：请用中文总结以下内容：" />
          </Form.Item>
          <Form.Item name="enabled" label="启用该规则" valuePropName="checked" style={{ marginBottom: 0 }}>
            <Switch />
          </Form.Item>
        </Form>
      </Drawer>

      <Drawer
        title="设置"
        placement="bottom"
        open={prefsOpen}
        onClose={() => setPrefsOpen(false)}
        height={330}
        destroyOnHidden
      >
        <div className="pref-item">
          <div className="pref-text">
            <div className="pref-title">思考内容默认折叠</div>
            <div className="pref-desc">
              DeepSeek 深度思考结束后自动折叠思考过程。思考进行中不受影响，展开后再次进入页面会重新折叠。
            </div>
          </div>
          <Switch
            checked={prefs.collapseThoughts}
            onChange={(c) => handleTogglePref('collapseThoughts', c)}
          />
        </div>
        <div className="pref-item">
          <div className="pref-text">
            <div className="pref-title">HTML 代码块默认折叠</div>
            <div className="pref-desc">
              在代码块标题行加入「展开（N 行）」按钮，长代码默认折起。关闭后移除按钮并还原。DeepSeek 自带的复制、下载、运行不受影响。
            </div>
          </div>
          <Switch
            checked={prefs.foldCodeBlocks}
            onChange={(c) => handleTogglePref('foldCodeBlocks', c)}
          />
        </div>
      </Drawer>
    </div>
  );
}
