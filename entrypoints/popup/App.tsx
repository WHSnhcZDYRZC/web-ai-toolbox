import { useEffect, useMemo, useState } from 'react';
import {
  App as AntdApp,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Upload,
} from 'antd';
import type { UploadProps } from 'antd';
import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  PlusOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { loadSettings, normalizeSettings, saveSettings } from '../../lib/storage';
import {
  MAX_RULES,
  TRIGGER_PATTERN,
  createRule,
  type TriggerRule,
} from '../../lib/types';

type RuleFormValues = {
  trigger: string;
  replacement: string;
  enabled: boolean;
};

const EXPORT_FILE_NAME = 'deepseek-trigger-rules.json';

export default function App() {
  const { message } = AntdApp.useApp();
  const [rules, setRules] = useState<TriggerRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<TriggerRule | null>(null);
  const [form] = Form.useForm<RuleFormValues>();

  useEffect(() => {
    loadSettings()
      .then((settings) => setRules(settings.rules))
      .finally(() => setLoading(false));
  }, []);

  /** 写入 chrome.storage.local；content script 通过 storage.onChanged 热更新 */
  const persist = async (nextRules: TriggerRule[], successText: string) => {
    await saveSettings({ version: 1, rules: nextRules });
    setRules(nextRules);
    message.success(successText);
  };

  const openCreateModal = () => {
    setEditingRule(null);
    form.resetFields();
    form.setFieldsValue({ trigger: '', replacement: '', enabled: true });
    setModalOpen(true);
  };

  const openEditModal = (rule: TriggerRule) => {
    setEditingRule(rule);
    form.setFieldsValue({
      trigger: rule.trigger,
      replacement: rule.replacement,
      enabled: rule.enabled,
    });
    setModalOpen(true);
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
    setModalOpen(false);
  };

  const handleToggle = async (rule: TriggerRule, enabled: boolean) => {
    await persist(
      rules.map((r) => (r.id === rule.id ? { ...r, enabled, updatedAt: Date.now() } : r)),
      enabled ? '规则已启用' : '规则已停用',
    );
  };

  const handleDelete = async (rule: TriggerRule) => {
    await persist(
      rules.filter((r) => r.id !== rule.id),
      '规则已删除',
    );
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

  const columns = useMemo(
    () => [
      {
        title: '触发词',
        dataIndex: 'trigger',
        width: 140,
        render: (value: string) => <Tag color="blue">{value}</Tag>,
      },
      {
        title: '展开文本',
        dataIndex: 'replacement',
        ellipsis: true,
        render: (value: string) => (
          <Tooltip title={value.length > 60 ? value : undefined} placement="topLeft">
            <span className="replacement-cell">{value}</span>
          </Tooltip>
        ),
      },
      {
        title: '启用',
        dataIndex: 'enabled',
        width: 70,
        render: (enabled: boolean, rule: TriggerRule) => (
          <Switch size="small" checked={enabled} onChange={(checked) => handleToggle(rule, checked)} />
        ),
      },
      {
        title: '操作',
        key: 'actions',
        width: 100,
        render: (_: unknown, rule: TriggerRule) => (
          <Space size="small">
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEditModal(rule)} />
            <Popconfirm
              title={`删除触发词 ${rule.trigger}？`}
              okText="删除"
              cancelText="取消"
              onConfirm={() => handleDelete(rule)}
            >
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [rules],
  );

  return (
    <div className="app-container">
      <div className="app-header">
        <img className="app-logo" src="icons/48.png" alt="" />
        <div>
          <div className="app-title">DeepSeek 触发词配置</div>
          <div className="app-subtitle">发送前自动展开触发词，仅作用于 chat.deepseek.com</div>
        </div>
        <span className="app-count">{rules.length} / {MAX_RULES}</span>
      </div>

      <div className="app-body">
        <div className="app-toolbar">
          <Button
            type="primary"
            size="small"
            icon={<PlusOutlined />}
            disabled={reachedLimit}
            onClick={openCreateModal}
          >
            新增规则
          </Button>
          <span className="toolbar-spacer" />
          <Upload accept=".json,application/json" showUploadList={false} beforeUpload={handleImport}>
            <Button size="small" icon={<UploadOutlined />}>导入</Button>
          </Upload>
          <Button size="small" icon={<DownloadOutlined />} disabled={!rules.length} onClick={handleExport}>
            导出
          </Button>
        </div>

        <div className="app-table-card">
          <Table<TriggerRule>
            rowKey="id"
            size="small"
            loading={loading}
            columns={columns}
            dataSource={rules}
            pagination={false}
            locale={{ emptyText: '暂无规则，点击“新增规则”开始配置' }}
          />
        </div>
      </div>

      <div className="app-footer-tip">
        配置仅保存在当前设备，不随账号同步 · 保存后立即生效，无需刷新扩展
      </div>

      <Modal
        title={editingRule ? '编辑规则' : '新增规则'}
        open={modalOpen}
        okText="保存"
        cancelText="取消"
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" initialValues={{ enabled: true }}>
          <Form.Item
            name="trigger"
            label="触发词（仅 ASCII：字母开头，可含字母/数字/下划线/连字符，最长 32 字符）"
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
            label="展开文本（发送前替换触发词的完整内容）"
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
            <Input.TextArea rows={5} placeholder="例如：请用中文总结以下内容：" />
          </Form.Item>
          <Form.Item name="enabled" label="启用该规则" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
