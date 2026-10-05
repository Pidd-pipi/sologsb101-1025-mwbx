/**
 * /beans 生豆在库与产地档案
 * 消费 GreenBean、RoastProfile；复用 <FilterBar>、<EmptyPanel>、<StatBadge>。
 * 交互：新建/编辑抽屉表单（含校验）、删除确认 + 级联删除、按处理法/产地/余量筛选（同步 URL query）、
 *       到货天数与现有重量回显、余量提醒、档案 JSON 导出。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  App as AntdApp,
  Button,
  Card,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CoffeeOutlined,
  DeleteOutlined,
  EditOutlined,
  ExportOutlined,
  PlusOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import FilterBar, { type FilterSelectConfig } from '../components/common/FilterBar';
import EmptyPanel from '../components/common/EmptyPanel';
import StatBadge from '../components/common/StatBadge';
import { useAppDispatch, useAppSelector } from '../stores/store';
import {
  createGreenBean,
  deleteGreenBean,
  fetchGreenBeans,
  resetBeanFilters,
  selectBeanFilterOptions,
  selectBeanState,
  selectBeanStats,
  selectFilteredGreenBeans,
  setBeanFilters,
  updateGreenBean,
} from '../stores/beanSlice';
import { fetchRoastProfiles, selectRoastState } from '../stores/roastSlice';
import { fetchCuppings } from '../stores/cuppingSlice';
import { fetchBlends } from '../stores/blendSlice';
import {
  BEAN_PROCESS_COLOR,
  BEAN_PROCESS_LABEL,
  BEAN_PROCESS_OPTIONS,
  LOW_STOCK_KG,
  ORIGIN_OPTIONS,
  STOCK_LEVEL_COLOR,
  STOCK_LEVEL_LABEL,
  stockLevelOf,
  type BeanProcess,
  type GreenBean,
  type GreenBeanDraft,
} from '../types/greenbean';
import { exportArchiveJson } from '../utils/export';
import { exportSnapshot } from '../utils/db';

interface BeanFormValues {
  origin: string;
  farm: string;
  process: BeanProcess;
  altitudeM: number;
  moisturePct: number;
  stockKg: number;
  arrivedAt: Dayjs;
}

const DEFAULT_ARRIVED_AT = dayjs().format('YYYY-MM-DD');

export default function BeanList() {
  const dispatch = useAppDispatch();
  const { message, modal } = AntdApp.useApp();
  const [form] = Form.useForm<BeanFormValues>();

  const beanState = useAppSelector(selectBeanState);
  const rows = useAppSelector(selectFilteredGreenBeans);
  const stats = useAppSelector(selectBeanStats);
  const filterOptions = useAppSelector(selectBeanFilterOptions);
  const roastState = useAppSelector(selectRoastState);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    void dispatch(fetchGreenBeans());
    void dispatch(fetchRoastProfiles());
  }, [dispatch]);

  const profileCount = useMemo(() => {
    const counter = new Map<string, number>();
    roastState.profiles.forEach((profile) => {
      counter.set(profile.greenBeanId, (counter.get(profile.greenBeanId) ?? 0) + 1);
    });
    return counter;
  }, [roastState.profiles]);

  const recentRoastedAt = useMemo(() => {
    const latest = new Map<string, string>();
    roastState.profiles.forEach((profile) => {
      const current = latest.get(profile.greenBeanId);
      if (!current || profile.roastedAt > current) latest.set(profile.greenBeanId, profile.roastedAt);
    });
    return latest;
  }, [roastState.profiles]);

  const selects: FilterSelectConfig[] = [
    { key: 'process', label: '处理法', options: BEAN_PROCESS_OPTIONS },
    {
      key: 'origin',
      label: '产地',
      width: 200,
      options: (filterOptions.origins.length > 0 ? filterOptions.origins : ORIGIN_OPTIONS).map((origin) => ({
        value: origin,
        label: origin,
      })),
    },
    {
      key: 'stock',
      label: '余量',
      width: 150,
      options: [
        { value: 'ok', label: '余量充足' },
        { value: 'low', label: `余量偏低（<${LOW_STOCK_KG}kg）` },
        { value: 'empty', label: '已耗尽' },
      ],
    },
  ];

  /** 把 FilterBar 回传的 key 映射到 slice 的筛选字段 */
  const handleFilterChange = (key: string, values: string[]): void => {
    if (key === 'process') dispatch(setBeanFilters({ processes: values as BeanProcess[] }));
    if (key === 'origin') dispatch(setBeanFilters({ origins: values }));
    if (key === 'stock') dispatch(setBeanFilters({ stockLevels: values as Array<'ok' | 'low' | 'empty'> }));
  };

  const openCreate = (): void => {
    setEditingId(null);
    form.resetFields();
    form.setFieldsValue({
      origin: ORIGIN_OPTIONS[0],
      farm: '',
      process: 'washed',
      altitudeM: 1800,
      moisturePct: 11,
      stockKg: 5,
      arrivedAt: dayjs(DEFAULT_ARRIVED_AT),
    });
    setDrawerOpen(true);
  };

  const openEdit = (bean: GreenBean): void => {
    setEditingId(bean.id);
    form.setFieldsValue({
      origin: bean.origin,
      farm: bean.farm,
      process: bean.process,
      altitudeM: bean.altitudeM,
      moisturePct: bean.moisturePct,
      stockKg: bean.stockKg,
      arrivedAt: dayjs(bean.arrivedAt),
    });
    setDrawerOpen(true);
  };

  const handleSubmit = async (values: BeanFormValues): Promise<void> => {
    const draft: GreenBeanDraft = {
      origin: values.origin.trim(),
      farm: values.farm.trim(),
      process: values.process,
      altitudeM: Math.round(values.altitudeM),
      moisturePct: Math.round(values.moisturePct * 10) / 10,
      stockKg: Math.round(values.stockKg * 100) / 100,
      arrivedAt: values.arrivedAt.format('YYYY-MM-DD'),
    };
    try {
      if (editingId) {
        await dispatch(updateGreenBean({ id: editingId, draft })).unwrap();
        message.success('生豆档案已更新');
      } else {
        await dispatch(createGreenBean(draft)).unwrap();
        message.success('生豆档案已创建');
      }
      setDrawerOpen(false);
    } catch (error) {
      message.error(`保存失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleDelete = (bean: GreenBean): void => {
    const relatedProfiles = profileCount.get(bean.id) ?? 0;
    modal.confirm({
      title: `删除生豆「${bean.origin} · ${bean.farm}」？`,
      content:
        relatedProfiles > 0
          ? `将级联删除该生豆关联的 ${relatedProfiles} 条烘焙记录及其曲线事件、杯测记录，并从拼配配方中摘除相关成分。`
          : '该生豆暂无关联烘焙记录，删除后不可恢复。',
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      async onOk() {
        try {
          await dispatch(deleteGreenBean(bean.id)).unwrap();
          await Promise.all([
            dispatch(fetchRoastProfiles()).unwrap(),
            dispatch(fetchCuppings()).unwrap(),
            dispatch(fetchBlends()).unwrap(),
          ]);
          message.success('生豆及其关联数据已删除');
        } catch (error) {
          message.error(`删除失败：${error instanceof Error ? error.message : '未知错误'}`);
        }
      },
    });
  };

  const handleExport = async (): Promise<void> => {
    try {
      const snapshot = await exportSnapshot();
      const filename = exportArchiveJson(snapshot);
      message.success(`已导出完整档案：${filename}`);
    } catch (error) {
      message.error(`导出失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const columns: ColumnsType<GreenBean> = [
    {
      title: '产地 / 庄园',
      dataIndex: 'origin',
      key: 'origin',
      width: 240,
      render: (_value, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{record.origin}</Typography.Text>
          <span className="gb-muted">{record.farm}</span>
        </Space>
      ),
    },
    {
      title: '处理法',
      dataIndex: 'process',
      key: 'process',
      width: 96,
      filters: BEAN_PROCESS_OPTIONS.map((option) => ({ text: option.label, value: option.value })),
      onFilter: (value, record) => record.process === value,
      render: (value: BeanProcess) => <Tag color={BEAN_PROCESS_COLOR[value]}>{BEAN_PROCESS_LABEL[value]}</Tag>,
    },
    {
      title: '海拔',
      dataIndex: 'altitudeM',
      key: 'altitudeM',
      width: 96,
      sorter: (a, b) => a.altitudeM - b.altitudeM,
      render: (value: number) => <span className="gb-mono">{value} m</span>,
    },
    {
      title: '含水率',
      dataIndex: 'moisturePct',
      key: 'moisturePct',
      width: 96,
      sorter: (a, b) => a.moisturePct - b.moisturePct,
      render: (value: number) => <span className="gb-mono">{value}%</span>,
    },
    {
      title: '在库重量',
      dataIndex: 'stockKg',
      key: 'stockKg',
      width: 150,
      sorter: (a, b) => a.stockKg - b.stockKg,
      render: (_value, record) => {
        const level = stockLevelOf(record.stockKg);
        return (
          <Space size={6}>
            <Tag color={STOCK_LEVEL_COLOR[level]} icon={level === 'ok' ? <CoffeeOutlined /> : <WarningOutlined />}>
              {record.stockKg} kg
            </Tag>
            <span className="gb-muted">{STOCK_LEVEL_LABEL[level]}</span>
          </Space>
        );
      },
    },
    {
      title: '到货 / 到货天数',
      dataIndex: 'arrivedAt',
      key: 'arrivedAt',
      width: 168,
      sorter: (a, b) => a.arrivedAt.localeCompare(b.arrivedAt),
      render: (_value, record) => {
        const days = dayjs().diff(dayjs(record.arrivedAt), 'day');
        return (
          <Space direction="vertical" size={0}>
            <span className="gb-mono">{record.arrivedAt}</span>
            <span className="gb-muted">到货 {days} 天</span>
          </Space>
        );
      },
    },
    {
      title: '烘焙记录',
      key: 'profiles',
      width: 150,
      render: (_value, record) => {
        const count = profileCount.get(record.id) ?? 0;
        const latest = recentRoastedAt.get(record.id);
        return count > 0 ? (
          <Space direction="vertical" size={0}>
            <Tag color="#a8632c">{count} 次</Tag>
            <span className="gb-muted">最近 {latest}</span>
          </Space>
        ) : (
          <span className="gb-muted">暂无烘焙</span>
        );
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      fixed: 'right',
      render: (_value, record) => (
        <Space size={4}>
          <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Button size="small" type="link" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <FilterBar
        keyword={beanState.filters.keyword}
        onKeywordChange={(keyword) => dispatch(setBeanFilters({ keyword }))}
        selects={selects}
        value={{
          process: beanState.filters.processes,
          origin: beanState.filters.origins,
          stock: beanState.filters.stockLevels,
        }}
        onChange={handleFilterChange}
        onReset={() => dispatch(resetBeanFilters())}
        searchPlaceholder="搜索产地 / 庄园"
        summary={
          <StatBadge compact label="筛选结果" value={rows.length} suffix={`/ ${stats.total}`} tone="gold" />
        }
        extra={
          <Space>
            <Button icon={<ExportOutlined />} onClick={handleExport}>
              导出档案
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建生豆
            </Button>
          </Space>
        }
      />

      <Card
        title="生豆在库与产地档案"
        extra={<span className="gb-muted">下豆后按载量自动扣减在库重量，低于 {LOW_STOCK_KG}kg 会给出余量提醒</span>}
        styles={{ body: { paddingTop: 12 } }}
      >
        <div className="gb-stat-row">
          <StatBadge label="生豆批次" value={stats.total} suffix=" 批" icon={<CoffeeOutlined />} tone="brown" />
          <StatBadge label="在库总重" value={stats.stockKg} suffix=" kg" tone="green" />
          <StatBadge
            label="余量提醒"
            value={stats.lowStock}
            suffix=" 批"
            tone={stats.lowStock > 0 ? 'red' : 'green'}
            icon={<WarningOutlined />}
            hint={`余量低于 ${LOW_STOCK_KG}kg 的生豆批次数`}
          />
          <StatBadge label="产地数" value={stats.origins} suffix=" 个" tone="blue" />
        </div>

        {beanState.stockNotice ? (
          <Typography.Paragraph type="warning" style={{ marginBottom: 12 }}>
            {beanState.stockNotice}
          </Typography.Paragraph>
        ) : null}

        {rows.length === 0 ? (
          <EmptyPanel
            title={stats.total === 0 ? '还没有生豆档案' : '没有符合筛选条件的生豆'}
            description={
              stats.total === 0
                ? '先登记一个生豆批次的产地、处理法与在库重量，后续烘焙记录与杯测都挂在它下面。'
                : '试试放宽处理法、产地或余量筛选条件。'
            }
            actionText="新建生豆"
            onAction={openCreate}
            secondaryText="重置筛选"
            secondaryIcon="none"
            onSecondary={() => dispatch(resetBeanFilters())}
          />
        ) : (
          <Table
            className="gb-table"
            rowKey="id"
            size="small"
            loading={beanState.loading}
            columns={columns}
            dataSource={rows}
            scroll={{ x: 1180 }}
            pagination={{ pageSize: 8, showSizeChanger: true, showTotal: (total) => `共 ${total} 批生豆` }}
          />
        )}
      </Card>

      <Drawer
        title={editingId ? '编辑生豆档案' : '新建生豆档案'}
        width={520}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>取消</Button>
            <Button type="primary" loading={beanState.loading} onClick={() => form.submit()}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit} requiredMark>
          <Form.Item
            name="origin"
            label="产地"
            rules={[
              { required: true, message: '请填写产地' },
              { min: 2, message: '产地至少 2 个字符' },
            ]}
          >
            <Select
              showSearch
              placeholder="选择或搜索产地"
              options={ORIGIN_OPTIONS.map((origin) => ({ value: origin, label: origin }))}
            />
          </Form.Item>
          <Form.Item
            name="farm"
            label="庄园 / 处理厂"
            rules={[
              { required: true, message: '请填写庄园或处理厂' },
              { max: 40, message: '不超过 40 个字符' },
            ]}
          >
            <Input placeholder="如：乌拉嘎水洗站" />
          </Form.Item>
          <Form.Item name="process" label="处理法" rules={[{ required: true, message: '请选择处理法' }]}>
            <Select options={BEAN_PROCESS_OPTIONS} />
          </Form.Item>
          <Form.Item
            name="altitudeM"
            label="海拔（米）"
            rules={[
              { required: true, message: '请填写海拔' },
              {
                validator: (_rule, value: number) =>
                  Number.isFinite(value) && value >= 300 && value <= 2600
                    ? Promise.resolve()
                    : Promise.reject(new Error('海拔建议在 300 - 2600 米之间')),
              },
            ]}
          >
            <InputNumber min={300} max={2600} step={50} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="moisturePct"
            label="含水率（%）"
            rules={[
              { required: true, message: '请填写含水率' },
              {
                validator: (_rule, value: number) =>
                  Number.isFinite(value) && value >= 8 && value <= 14
                    ? Promise.resolve()
                    : Promise.reject(new Error('含水率应在 8% - 14% 之间')),
              },
            ]}
          >
            <InputNumber min={8} max={14} step={0.1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="stockKg"
            label="在库重量（kg）"
            extra={`低于 ${LOW_STOCK_KG}kg 时列表会给出补货提醒`}
            rules={[
              { required: true, message: '请填写在库重量' },
              {
                validator: (_rule, value: number) =>
                  Number.isFinite(value) && value >= 0 && value <= 500
                    ? Promise.resolve()
                    : Promise.reject(new Error('在库重量应在 0 - 500kg 之间')),
              },
            ]}
          >
            <InputNumber min={0} max={500} step={0.1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="arrivedAt" label="到货日期" rules={[{ required: true, message: '请选择到货日期' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Tooltip title="产地、庄园与处理法会同步展示在曲线页与杯测页">
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              提示：烘焙下豆时系统会按载量自动扣减这里登记的在库重量。
            </Typography.Text>
          </Tooltip>
        </Form>
      </Drawer>
    </Space>
  );
}
