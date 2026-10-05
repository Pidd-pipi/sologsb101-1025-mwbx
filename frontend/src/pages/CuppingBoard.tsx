/**
 * /cuppings 杯测评分
 * 消费 Cupping、RoastProfile（并回显生豆产地）；复用 <ScoreTag>、<EmptyPanel>、<FilterBar>、<StatBadge>。
 * 交互：干香/湿香/酸质/甜感/余韵分项录入（0-10）→ 加权总分实时派生 + 分档结论标签、
 *       按总分排序、按分档/产地/烘焙状态筛选（同步 URL query）、新增编辑校验、删除确认、杯测档案导出。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  App as AntdApp,
  Alert,
  Button,
  Card,
  DatePicker,
  Divider,
  Form,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, DownloadOutlined, EditOutlined, ExperimentOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import FilterBar, { type FilterSelectConfig } from '../components/common/FilterBar';
import EmptyPanel from '../components/common/EmptyPanel';
import ScoreTag from '../components/common/ScoreTag';
import StatBadge from '../components/common/StatBadge';
import { useAppDispatch, useAppSelector } from '../stores/store';
import { fetchGreenBeans, selectBeanState } from '../stores/beanSlice';
import { fetchRoastProfiles, selectRoastState } from '../stores/roastSlice';
import {
  createCupping,
  deleteCupping,
  fetchCuppings,
  loadCuppingDraft,
  resetCuppingDraft,
  resetCuppingFilters,
  selectCuppingFilterOptions,
  selectCuppingStats,
  selectCuppingState,
  selectDraftGrade,
  selectDraftTotalScore,
  selectFilteredCuppingRows,
  setCuppingFilters,
  setCuppingSortDesc,
  setDraftField,
  updateCupping,
  type CuppingDraftState,
  type CuppingRow,
} from '../stores/cuppingSlice';
import { CUPPING_FIELDS, type Cupping } from '../types/cupping';
import {
  ROAST_STATE_LABEL,
  ROAST_STATE_OPTIONS,
  type RoastState,
} from '../types/roastprofile';
import { exportCuppingJson } from '../utils/export';

interface CuppingFormValues {
  profileId: string;
  cuppedAt: Dayjs;
  dryAroma: number;
  wetAroma: number;
  acidity: number;
  sweetness: number;
  aftertaste: number;
}

function scoreRule(label: string) {
  return [
    { required: true, message: `请填写${label}得分` },
    {
      validator: (_rule: unknown, value: number) =>
        Number.isFinite(value) && value >= 0 && value <= 10
          ? Promise.resolve()
          : Promise.reject(new Error(`${label}得分应在 0 - 10 之间`)),
    },
  ];
}

export default function CuppingBoard() {
  const dispatch = useAppDispatch();
  const { message, modal } = AntdApp.useApp();
  const [form] = Form.useForm<CuppingFormValues>();

  const cuppingState = useAppSelector(selectCuppingState);
  const rows = useAppSelector(selectFilteredCuppingRows);
  const stats = useAppSelector(selectCuppingStats);
  const filterOptions = useAppSelector(selectCuppingFilterOptions);
  const draftTotal = useAppSelector(selectDraftTotalScore);
  const draftGrade = useAppSelector(selectDraftGrade);
  const beanState = useAppSelector(selectBeanState);
  const roastState = useAppSelector(selectRoastState);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    void dispatch(fetchCuppings());
    void dispatch(fetchRoastProfiles());
    void dispatch(fetchGreenBeans());
  }, [dispatch]);

  const beanMap = useMemo(() => new Map(beanState.greenBeans.map((bean) => [bean.id, bean])), [beanState.greenBeans]);

  const profileOptions = useMemo(
    () =>
      roastState.profiles.map((profile) => {
        const bean = beanMap.get(profile.greenBeanId);
        return {
          value: profile.id,
          label: `${profile.roastedAt} · ${profile.machineModel} · ${bean ? bean.origin : '（生豆已删除）'} · ${ROAST_STATE_LABEL[profile.state]}`,
        };
      }),
    [roastState.profiles, beanMap],
  );

  const selects: FilterSelectConfig[] = [
    {
      key: 'grade',
      label: '分档结论',
      width: 160,
      options: filterOptions.grades.map((grade) => ({ value: grade, label: grade })),
    },
    {
      key: 'origin',
      label: '产地',
      width: 200,
      options: filterOptions.origins.map((origin) => ({ value: origin, label: origin })),
    },
    { key: 'state', label: '烘焙状态', width: 150, options: ROAST_STATE_OPTIONS },
  ];

  const handleFilterChange = (key: string, values: string[]): void => {
    if (key === 'grade') dispatch(setCuppingFilters({ grades: values }));
    if (key === 'origin') dispatch(setCuppingFilters({ origins: values }));
    if (key === 'state') dispatch(setCuppingFilters({ profileStates: values as RoastState[] }));
  };

  const syncDraft = (values: CuppingFormValues): void => {
    (Object.keys(values) as Array<keyof CuppingFormValues>).forEach((key) => {
      const value = values[key];
      if (key === 'cuppedAt') {
        if (value) dispatch(setDraftField({ field: 'cuppedAt', value: (value as Dayjs).format('YYYY-MM-DD') }));
        return;
      }
      if (key === 'profileId') {
        dispatch(setDraftField({ field: 'profileId', value: String(value ?? '') }));
        return;
      }
      dispatch(setDraftField({ field: key, value: Number(value ?? 0) }));
    });
  };

  const openCreate = (): void => {
    setEditingId(null);
    dispatch(resetCuppingDraft());
    const profileId = roastState.profiles[0]?.id ?? '';
    dispatch(setDraftField({ field: 'profileId', value: profileId }));
    form.setFieldsValue({
      profileId,
      cuppedAt: dayjs(),
      dryAroma: 8,
      wetAroma: 8,
      acidity: 8,
      sweetness: 8,
      aftertaste: 8,
    });
    setModalOpen(true);
  };

  const openEdit = (row: CuppingRow): void => {
    setEditingId(row.id);
    dispatch(loadCuppingDraft(row as Cupping));
    form.setFieldsValue({
      profileId: row.profileId,
      cuppedAt: dayjs(row.cuppedAt),
      dryAroma: row.dryAroma,
      wetAroma: row.wetAroma,
      acidity: row.acidity,
      sweetness: row.sweetness,
      aftertaste: row.aftertaste,
    });
    setModalOpen(true);
  };

  const handleSubmit = async (values: CuppingFormValues): Promise<void> => {
    const draft: CuppingDraftState = {
      profileId: values.profileId,
      cuppedAt: values.cuppedAt.format('YYYY-MM-DD'),
      dryAroma: values.dryAroma,
      wetAroma: values.wetAroma,
      acidity: values.acidity,
      sweetness: values.sweetness,
      aftertaste: values.aftertaste,
    };
    try {
      if (editingId) {
        await dispatch(updateCupping({ id: editingId, draft })).unwrap();
        message.success('杯测记录已更新');
      } else {
        await dispatch(createCupping(draft)).unwrap();
        message.success(`杯测记录已保存，加权总分 ${draftTotal.toFixed(1)}（${draftGrade.label}）`);
      }
      setModalOpen(false);
    } catch (error) {
      message.error(`保存失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleDelete = (row: CuppingRow): void => {
    modal.confirm({
      title: `删除杯测记录「${row.origin} · ${row.cuppedAt}」？`,
      content: `加权总分 ${row.totalScore.toFixed(1)}（${row.grade.label}），删除后不可恢复。`,
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      async onOk() {
        await dispatch(deleteCupping(row.id)).unwrap();
        message.success('杯测记录已删除');
      },
    });
  };

  const handleExport = (): void => {
    const filename = exportCuppingJson(rows, roastState.profiles, beanState.greenBeans);
    message.success(`已导出杯测档案：${filename}（${rows.length} 笔）`);
  };

  const columns: ColumnsType<CuppingRow> = [
    {
      title: '烘焙记录 / 产地',
      key: 'profile',
      width: 250,
      render: (_value, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>
            {row.machineModel} · {row.roastedAt}
          </Typography.Text>
          <span className="gb-muted">
            {row.origin} · {row.farm}
          </span>
        </Space>
      ),
    },
    {
      title: '杯测日期',
      dataIndex: 'cuppedAt',
      key: 'cuppedAt',
      width: 120,
      sorter: (a, b) => a.cuppedAt.localeCompare(b.cuppedAt),
      render: (value: string) => <span className="gb-mono">{value}</span>,
    },
    ...CUPPING_FIELDS.map((field) => ({
      title: `${field.label}(${Math.round(field.weight * 100)}%)`,
      dataIndex: field.key,
      key: field.key,
      width: 110,
      sorter: (a: CuppingRow, b: CuppingRow) => a[field.key] - b[field.key],
      render: (value: number) => <span className="gb-mono">{value.toFixed(2)}</span>,
    })),
    {
      title: '加权总分',
      dataIndex: 'totalScore',
      key: 'totalScore',
      width: 210,
      defaultSortOrder: 'descend',
      sorter: (a, b) => a.totalScore - b.totalScore,
      render: (value: number) => <ScoreTag score={value} />,
    },
    {
      title: '分档结论',
      key: 'grade',
      width: 200,
      render: (_value, row) => (
        <Tooltip title={row.grade.conclusion}>
          <Tag color={row.grade.color}>{row.grade.label} · 查看结论</Tag>
        </Tooltip>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      fixed: 'right',
      render: (_value, row) => (
        <Space size={4}>
          <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Button size="small" type="link" danger icon={<DeleteOutlined />} onClick={() => handleDelete(row)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <FilterBar
        keyword={cuppingState.filters.keyword}
        onKeywordChange={(keyword) => dispatch(setCuppingFilters({ keyword }))}
        selects={selects}
        value={{
          grade: cuppingState.filters.grades,
          origin: cuppingState.filters.origins,
          state: cuppingState.filters.profileStates,
        }}
        onChange={handleFilterChange}
        onReset={() => dispatch(resetCuppingFilters())}
        searchPlaceholder="搜索机型 / 产地 / 日期"
        summary={<StatBadge compact label="筛选结果" value={rows.length} suffix={`/ ${stats.total}`} tone="gold" />}
        extra={
          <Space>
            <Segmented
              value={cuppingState.sortDesc ? 'desc' : 'asc'}
              onChange={(value) => dispatch(setCuppingSortDesc(value === 'desc'))}
              options={[
                { label: '总分降序', value: 'desc' },
                { label: '总分升序', value: 'asc' },
              ]}
            />
            <Button icon={<DownloadOutlined />} onClick={handleExport}>
              导出杯测档案
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建杯测
            </Button>
          </Space>
        }
      />

      <Card title="杯测评分与分档结论" styles={{ body: { paddingTop: 12 } }}>
        <div className="gb-stat-row">
          <StatBadge label="杯测笔数" value={stats.total} suffix=" 笔" icon={<ExperimentOutlined />} tone="brown" />
          <StatBadge label="加权均分" value={stats.average} suffix=" 分" tone="green" />
          <StatBadge label="最高分" value={stats.best} suffix=" 分" tone="gold" />
          <StatBadge label="优秀及以上" value={stats.excellent} suffix=" 笔" tone="purple" hint="总分 ≥ 85" />
        </div>
        <Typography.Paragraph className="gb-muted" style={{ marginBottom: 12 }}>
          加权口径：
          {CUPPING_FIELDS.map((field) => `${field.label} ${Math.round(field.weight * 100)}%`).join(' · ')}
          ，总分 = Σ(分项 × 权重) × 10。
        </Typography.Paragraph>

        {rows.length === 0 ? (
          <EmptyPanel
            title={stats.total === 0 ? '还没有杯测记录' : '没有符合筛选条件的杯测记录'}
            description="选择一条烘焙记录，录入干香、湿香、酸质、甜感与余韵，系统会自动算出加权总分与分档结论。"
            actionText="新建杯测"
            onAction={openCreate}
            secondaryText="重置筛选"
            secondaryIcon="none"
            onSecondary={() => dispatch(resetCuppingFilters())}
          />
        ) : (
          <Table
            className="gb-table"
            rowKey="id"
            size="small"
            loading={cuppingState.loading}
            columns={columns}
            dataSource={rows}
            scroll={{ x: 1420 }}
            pagination={{ pageSize: 8, showTotal: (total) => `共 ${total} 笔杯测` }}
          />
        )}
      </Card>

      <Modal
        title={editingId ? '编辑杯测记录' : '新建杯测记录'}
        open={modalOpen}
        width={640}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        okText="保存"
        cancelText="取消"
        confirmLoading={cuppingState.loading}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          onValuesChange={(_changed, values) => syncDraft(values)}
        >
          <Form.Item name="profileId" label="烘焙记录" rules={[{ required: true, message: '请选择烘焙记录' }]}>
            <Select showSearch optionFilterProp="label" placeholder="选择烘焙记录" options={profileOptions} />
          </Form.Item>
          <Form.Item name="cuppedAt" label="杯测日期" rules={[{ required: true, message: '请选择杯测日期' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Divider orientation="left" plain>
            分项评分（0 - 10）
          </Divider>
          <Space size={12} wrap>
            {CUPPING_FIELDS.map((field) => (
              <Form.Item
                key={field.key}
                name={field.key}
                label={`${field.label}（${Math.round(field.weight * 100)}%）`}
                rules={scoreRule(field.label)}
                tooltip={field.hint}
                style={{ width: 168 }}
              >
                <InputNumber min={0} max={10} step={0.25} style={{ width: '100%' }} />
              </Form.Item>
            ))}
          </Space>
          <Alert
            type="info"
            showIcon
            message={
              <Space size={10} wrap>
                <span>实时加权总分：</span>
                <ScoreTag score={draftTotal} />
                <Tag color={draftGrade.color}>{draftGrade.label}</Tag>
                <span className="gb-muted">{draftGrade.conclusion}</span>
              </Space>
            }
          />
        </Form>
      </Modal>
    </Space>
  );
}
