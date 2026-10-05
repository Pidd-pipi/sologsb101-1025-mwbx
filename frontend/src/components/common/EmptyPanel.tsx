/**
 * <EmptyPanel> 空数据引导 + 主行动按钮（新建）+ 可选次按钮。
 * 被全部列表页消费（生豆、机型、曲线、杯测、拼配）。
 */
import type { ReactNode } from 'react';
import { Button, Empty, Space, Typography } from 'antd';
import { ImportOutlined, PlusOutlined } from '@ant-design/icons';

export interface EmptyPanelProps {
  /** 标题，例如「还没有生豆档案」 */
  title: string;
  /** 说明文案 */
  description?: ReactNode;
  /** 主行动按钮文案 */
  actionText?: string;
  onAction?: () => void;
  /** 次行动按钮文案（如「导入档案」） */
  secondaryText?: string;
  onSecondary?: () => void;
  /** 次按钮图标类型 */
  secondaryIcon?: 'import' | 'none';
  /** 附加内容 */
  extra?: ReactNode;
  /** 尺寸 */
  size?: 'small' | 'default';
}

export function EmptyPanel({
  title,
  description,
  actionText,
  onAction,
  secondaryText,
  onSecondary,
  secondaryIcon = 'import',
  extra,
  size = 'default',
}: EmptyPanelProps) {
  return (
    <div
      className="gb-empty-panel"
      style={{
        padding: size === 'small' ? '20px 12px' : '44px 24px',
        textAlign: 'center',
        background: '#fffaf4',
        border: '1px dashed rgba(122, 82, 48, 0.35)',
        borderRadius: 10,
      }}
    >
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        imageStyle={{ height: size === 'small' ? 40 : 60 }}
        description={
          <Space direction="vertical" size={4}>
            <Typography.Text strong style={{ fontSize: 16 }}>
              {title}
            </Typography.Text>
            {description ? (
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                {description}
              </Typography.Text>
            ) : null}
          </Space>
        }
      >
        {actionText || secondaryText ? (
          <Space wrap>
            {actionText && onAction ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={onAction}>
                {actionText}
              </Button>
            ) : null}
            {secondaryText && onSecondary ? (
              <Button icon={secondaryIcon === 'import' ? <ImportOutlined /> : undefined} onClick={onSecondary}>
                {secondaryText}
              </Button>
            ) : null}
          </Space>
        ) : null}
      </Empty>
      {extra ? <div style={{ marginTop: 12 }}>{extra}</div> : null}
    </div>
  );
}

export default EmptyPanel;
