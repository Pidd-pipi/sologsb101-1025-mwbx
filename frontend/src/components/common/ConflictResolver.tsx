/**
 * ConflictResolver 并发冲突逐项裁决弹窗
 * 跨标签页同时编辑同一烘焙记录 / 曲线节点、保存时版本不一致（乐观锁冲突）时使用：
 * 把「我的修改」与「对方（本地库当前值）」的差异逐项列出，每一项都必须选择
 * 「采用我的」或「保留对方」；仍有未决项时确认按钮保持禁用，不允许入库。
 * 被曲线页（/curves）与机型页（/machines）消费。
 */
import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Radio, Space, Tag, Typography } from 'antd';

export type ConflictChoice = 'mine' | 'theirs';

export interface ConflictItem {
  /** 字段键（与合并时的字段名对应） */
  key: string;
  /** 展示名，如「载量」「记录状态」「曲线节点 · 一爆」 */
  label: string;
  /** 我的修改（展示文本） */
  mine: string;
  /** 对方 / 本地库当前值（展示文本） */
  theirs: string;
}

export interface ConflictResolverProps {
  open: boolean;
  title: string;
  description?: string;
  items: ConflictItem[];
  /** 确认合并中的 loading */
  confirmLoading?: boolean;
  /** 全部项裁决完成后回调（choices 覆盖每一个 item.key） */
  onResolve: (choices: Record<string, ConflictChoice>) => void;
  /** 放弃本次修改（不写入任何内容） */
  onCancel: () => void;
}

export default function ConflictResolver({
  open,
  title,
  description,
  items,
  confirmLoading = false,
  onResolve,
  onCancel,
}: ConflictResolverProps) {
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>({});

  // 每次打开时清空上一轮选择，强制逐项重新裁决
  useEffect(() => {
    if (open) setChoices({});
  }, [open]);

  const pendingCount = useMemo(() => items.filter((item) => !choices[item.key]).length, [items, choices]);

  return (
    <Modal
      open={open}
      title={title}
      width={620}
      okText={pendingCount > 0 ? `还有 ${pendingCount} 项未裁决` : '按裁决合并入库'}
      cancelText="放弃本次修改"
      okButtonProps={{ disabled: pendingCount > 0, danger: pendingCount === 0 }}
      confirmLoading={confirmLoading}
      maskClosable={false}
      onOk={() => onResolve(choices)}
      onCancel={onCancel}
    >
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <Alert
          type="warning"
          showIcon
          message="检测到另一标签页先保存了同一内容，直接写入会覆盖对方的修改。"
          description={
            description ??
            '请逐项比对下方差异并选择采用哪一方的值；全部裁决完成后才会合并入库（版本号随之推进），否则本次修改不会写入。'
          }
        />
        {items.map((item) => (
          <div
            key={item.key}
            style={{
              border: '1px solid rgba(122,82,48,0.2)',
              borderRadius: 8,
              padding: '10px 12px',
              background: choices[item.key] ? '#fffaf4' : '#fff',
            }}
          >
            <Space size={8} align="center" style={{ marginBottom: 6 }}>
              <Tag color="#a8632c">{item.label}</Tag>
              {!choices[item.key] ? <Typography.Text type="danger">未裁决</Typography.Text> : null}
            </Space>
            <Radio.Group
              style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
              value={choices[item.key]}
              onChange={(event) =>
                setChoices((prev) => ({ ...prev, [item.key]: event.target.value as ConflictChoice }))
              }
            >
              <Radio value="mine">
                <Typography.Text strong>采用我的：</Typography.Text>
                {item.mine}
              </Radio>
              <Radio value="theirs">
                <Typography.Text strong>保留对方：</Typography.Text>
                {item.theirs}
              </Radio>
            </Radio.Group>
          </div>
        ))}
      </Space>
    </Modal>
  );
}
