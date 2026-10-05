/**
 * 多标签页保存冲突的逐项合并弹窗。
 * 列出「我的待保存」与「对方已保存」在记录字段（载量 / 记录状态等）与曲线节点上的全部差异，
 * 每项可「保留我的」或「采用对方」；仍有未决项时确认按钮禁用，不能入库。
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Modal, Radio, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { MergeCellsOutlined } from '@ant-design/icons';
import { EVENT_TYPE_COLOR } from '../../types/event';
import type { RoastRemoteSnapshot } from '../../utils/db';
import {
  describeEvent,
  diffEvents,
  diffProfileFields,
  eventChoiceKey,
  fieldChoiceKey,
  mergeEvents,
  mergeProfileFields,
  toProfileDraft,
  type ConflictChoice,
  type EventDiffItem,
  type MineSnapshot,
  type ProfileFieldDiff,
} from '../../utils/conflict';

interface RoastConflictModalProps {
  open: boolean;
  /** 我的待保存内容（记录字段草稿 + 期望的完整节点列表） */
  mine: MineSnapshot;
  /** 对方（数据库）当前快照 */
  remote: RoastRemoteSnapshot;
  /** 生豆 id → 可读名称 */
  beanName: (greenBeanId: string) => string;
  /** 合并入库中（确认按钮 loading） */
  resolving: boolean;
  /** 放弃本次修改（页面会同步为对方版本） */
  onCancel: () => void;
  /** 全部差异已逐项选择后的合并入库回调 */
  onResolve: (merged: MineSnapshot) => void;
}

const CHOICE_OPTIONS: Array<{ label: string; value: ConflictChoice }> = [
  { label: '保留我的', value: 'mine' },
  { label: '采用对方', value: 'theirs' },
];

const EVENT_DIFF_KIND_LABEL: Record<EventDiffItem['kind'], string> = {
  changed: '双方内容不同',
  'mine-only': '仅我有（我新增 / 对方已删）',
  'theirs-only': '仅对方有（对方新增 / 我已删）',
};

export default function RoastConflictModal({
  open,
  mine,
  remote,
  beanName,
  resolving,
  onCancel,
  onResolve,
}: RoastConflictModalProps) {
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>({});

  // 对方版本变化（含冲突解决期间对方再次保存）时清空已选项，要求重新逐项核对
  useEffect(() => {
    setChoices({});
  }, [remote.profile.version, remote.profile.updatedAt]);

  const remoteDraft = useMemo(() => toProfileDraft(remote.profile), [remote.profile]);
  const fieldDiffs = useMemo(
    () => diffProfileFields(mine.profile, remoteDraft, beanName),
    [mine.profile, remoteDraft, beanName],
  );
  const eventDiffs = useMemo(() => diffEvents(mine.events, remote.events), [mine.events, remote.events]);

  const unresolved =
    fieldDiffs.filter((diff) => !choices[fieldChoiceKey(diff.key)]).length +
    eventDiffs.filter((diff) => !choices[eventChoiceKey(diff.id)]).length;

  const pick = (key: string, choice: ConflictChoice): void => {
    setChoices((prev) => ({ ...prev, [key]: choice }));
  };

  const handleConfirm = (): void => {
    if (unresolved > 0) return;
    onResolve({
      profile: mergeProfileFields(mine.profile, remoteDraft, choices),
      events: mergeEvents(mine.events, remote.events, choices),
    });
  };

  const fieldColumns: ColumnsType<ProfileFieldDiff> = [
    { title: '字段', dataIndex: 'label', key: 'label', width: 90 },
    {
      title: '我的待保存',
      dataIndex: 'mine',
      key: 'mine',
      render: (value: string) => <Typography.Text strong>{value}</Typography.Text>,
    },
    { title: '对方已保存', dataIndex: 'theirs', key: 'theirs' },
    {
      title: '采用哪一边',
      key: 'choice',
      width: 200,
      render: (_value, diff) => (
        <Radio.Group
          size="small"
          optionType="button"
          options={CHOICE_OPTIONS}
          value={choices[fieldChoiceKey(diff.key)]}
          onChange={(event) => pick(fieldChoiceKey(diff.key), event.target.value as ConflictChoice)}
        />
      ),
    },
  ];

  const renderEventDiff = (diff: EventDiffItem): ReactNode => {
    const mineEvent = diff.kind === 'theirs-only' ? null : diff.mine;
    const theirsEvent = diff.kind === 'mine-only' ? null : diff.theirs;
    const anchor = mineEvent ?? theirsEvent;
    if (!anchor) return null;
    return (
      <div key={diff.id} className="gb-conflict-row">
        <Space size={8} wrap>
          <Tag color={EVENT_TYPE_COLOR[anchor.type]}>{EVENT_DIFF_KIND_LABEL[diff.kind]}</Tag>
          <Radio.Group
            size="small"
            optionType="button"
            options={CHOICE_OPTIONS}
            value={choices[eventChoiceKey(diff.id)]}
            onChange={(event) => pick(eventChoiceKey(diff.id), event.target.value as ConflictChoice)}
          />
        </Space>
        <div className="gb-conflict-compare">
          <div>
            <span className="gb-muted">我的：</span>
            {mineEvent ? describeEvent(mineEvent) : '（不保留该节点）'}
          </div>
          <div>
            <span className="gb-muted">对方：</span>
            {theirsEvent ? describeEvent(theirsEvent) : '（不保留该节点）'}
          </div>
        </div>
      </div>
    );
  };

  return (
    <Modal
      title={
        <Space size={8}>
          <MergeCellsOutlined />
          <span>检测到保存冲突：另一个标签页已保存新版本</span>
        </Space>
      }
      open={open}
      width={760}
      okText={unresolved > 0 ? `还有 ${unresolved} 项未决` : '合并入库'}
      okButtonProps={{ disabled: unresolved > 0, type: 'primary' }}
      cancelText="放弃我的修改"
      confirmLoading={resolving}
      maskClosable={false}
      keyboard={false}
      onOk={handleConfirm}
      onCancel={onCancel}
      destroyOnClose
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert
          type="warning"
          showIcon
          message={`对方已保存到版本 v${remote.profile.version}（${remote.profile.updatedAt}），你的修改尚未入库。`}
          description="请逐项核对下方差异并选择采用哪一边；全部差异都有结论后才能合并入库，取消则放弃你的本次修改并同步为对方版本。"
        />

        {fieldDiffs.length > 0 ? (
          <>
            <Typography.Text strong>记录字段差异（载量 / 记录状态等）</Typography.Text>
            <Table
              className="gb-table"
              rowKey={(diff) => diff.key}
              size="small"
              columns={fieldColumns}
              dataSource={fieldDiffs}
              pagination={false}
            />
          </>
        ) : null}

        {eventDiffs.length > 0 ? (
          <>
            <Typography.Text strong>曲线节点差异（{eventDiffs.length} 项）</Typography.Text>
            <div>{eventDiffs.map(renderEventDiff)}</div>
          </>
        ) : null}

        {fieldDiffs.length === 0 && eventDiffs.length === 0 ? (
          <Typography.Text type="secondary">双方内容一致，可直接合并入库。</Typography.Text>
        ) : (
          <Typography.Text type={unresolved > 0 ? 'danger' : 'secondary'}>
            {unresolved > 0 ? `还有 ${unresolved} 项未选择，全部选择后才能入库。` : '全部差异已逐项确认，可以合并入库。'}
          </Typography.Text>
        )}
      </Space>
    </Modal>
  );
}
