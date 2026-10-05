/**
 * /machines 烘焙机与载量配置
 * 消费 RoastProfile、GreenBean（以及曲线事件用于节点数统计）；复用 <FilterBar>、<EmptyPanel>、<StatBadge>。
 * 交互：机型/风门/火力档/常用载量模板维护（useIdbTable 实时订阅）、烘焙记录状态流转
 *       （记录中 → 已完成 / 作废，可恢复）、下豆按载量扣减生豆在库重量、级联删除、余量提醒。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  App as AntdApp,
  AutoComplete,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  FireOutlined,
  PlusOutlined,
  ReloadOutlined,
  SlidersOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import FilterBar, { type FilterSelectConfig } from '../components/common/FilterBar';
import EmptyPanel from '../components/common/EmptyPanel';
import StatBadge from '../components/common/StatBadge';
import { useIdbTable } from '../hooks/useIdbTable';
import { useAppDispatch, useAppSelector } from '../stores/store';
import { consumeStock, selectBeanState } from '../stores/beanSlice';
import {
  advanceRoastState,
  deleteRoastProfile,
  fetchMachineTemplates,
  fetchRoastProfiles,
  resetMachineFilters,
  saveMachineTemplate,
  selectMachineFilteredProfiles,
  selectMachineFilteredTemplates,
  selectMachineModelOptions,
  selectMachineStats,
  selectRoastState,
  setMachineFilters,
} from '../stores/roastSlice';
import { fetchCuppings } from '../stores/cuppingSlice';
import { fetchBlends } from '../stores/blendSlice';
import {
  AIRFLOW_COLOR,
  AIRFLOW_LABEL,
  AIRFLOW_OPTIONS,
  CHARGE_LEVEL_LABEL,
  GAS_LEVEL_OPTIONS,
  MACHINE_MODEL_OPTIONS,
  ROAST_STATE_COLOR,
  ROAST_STATE_FLOW,
  ROAST_STATE_LABEL,
  ROAST_STATE_OPTIONS,
  chargeLevelOf,
  type Airflow,
  type MachineTemplate,
  type MachineTemplateDraft,
  type RoastProfile,
  type RoastState,
} from '../types/roastprofile';
import type { RoastEvent } from '../types/event';
import { LOW_STOCK_KG } from '../types/greenbean';

const CHARGE_LEVEL_OPTIONS = (['sample', 'standard', 'full'] as const).map((value) => ({
  value,
  label: `${CHARGE_LEVEL_LABEL[value]}`,
}));

export default function MachineConfig() {
  const dispatch = useAppDispatch();
  const { message, modal } = AntdApp.useApp();
  const [form] = Form.useForm<MachineTemplateDraft>();

  const roastState = useAppSelector(selectRoastState);
  const beanState = useAppSelector(selectBeanState);
  const modelOptions = useAppSelector(selectMachineModelOptions);
  const filteredProfiles = useAppSelector(selectMachineFilteredProfiles);
  const filteredTemplates = useAppSelector(selectMachineFilteredTemplates);
  const machineStats = useAppSelector(selectMachineStats);

  /** 载量模板：liveQuery 实时订阅（真实读写 Dexie） */
  const templatesTable = useIdbTable<MachineTemplate>('machineTemplates', { sortBy: 'chargeG' });
  /** 曲线事件：用于统计每条烘焙记录的节点数 */
  const eventsTable = useIdbTable<RoastEvent>('events');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    void dispatch(fetchRoastProfiles());
    void dispatch(fetchMachineTemplates());
  }, [dispatch]);

  const beanMap = useMemo(
    () => new Map(beanState.greenBeans.map((bean) => [bean.id, bean])),
    [beanState.greenBeans],
  );

  const eventCount = useMemo(() => {
    const counter = new Map<string, number>();
    eventsTable.rows.forEach((event) => {
      counter.set(event.profileId, (counter.get(event.profileId) ?? 0) + 1);
    });
    return counter;
  }, [eventsTable.rows]);

  const selects: FilterSelectConfig[] = [
    {
      key: 'model',
      label: '机型',
      width: 180,
      options: (modelOptions.length > 0 ? modelOptions : MACHINE_MODEL_OPTIONS).map((model) => ({
        value: model,
        label: model,
      })),
    },
    { key: 'airflow', label: '风门', options: AIRFLOW_OPTIONS },
    { key: 'charge', label: '载量档', options: CHARGE_LEVEL_OPTIONS },
  ];

  const handleFilterChange = (key: string, values: string[]): void => {
    if (key === 'model') dispatch(setMachineFilters({ models: values }));
    if (key === 'airflow') dispatch(setMachineFilters({ airflow: values as Airflow[] }));
    if (key === 'charge') dispatch(setMachineFilters({ chargeLevels: values as Array<'sample' | 'standard' | 'full'> }));
  };

  const openCreate = (): void => {
    setEditingId(null);
    form.resetFields();
    form.setFieldsValue({
      model: modelOptions[0] ?? MACHINE_MODEL_OPTIONS[0],
      airflow: 'half',
      gasLevel: 4,
      chargeG: 500,
      note: '',
    });
    setModalOpen(true);
  };

  const openEdit = (template: MachineTemplate): void => {
    setEditingId(template.id);
    form.setFieldsValue({
      model: template.model,
      airflow: template.airflow,
      gasLevel: template.gasLevel,
      chargeG: template.chargeG,
      note: template.note,
    });
    setModalOpen(true);
  };

  const handleSubmit = async (values: MachineTemplateDraft): Promise<void> => {
    try {
      await dispatch(
        saveMachineTemplate({
          id: editingId ?? undefined,
          draft: { ...values, model: values.model.trim(), note: values.note?.trim() ?? '' },
        }),
      ).unwrap();
      message.success(editingId ? '载量模板已更新' : '载量模板已创建');
      setModalOpen(false);
    } catch (error) {
      message.error(`保存失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleDeleteTemplate = (template: MachineTemplate): void => {
    modal.confirm({
      title: `删除载量模板「${template.model} · ${template.chargeG}g」？`,
      content: '模板只影响新建烘焙记录时的默认值，已存在的烘焙记录不受影响。',
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      async onOk() {
        await templatesTable.remove(template.id);
        await dispatch(fetchMachineTemplates());
        message.success('载量模板已删除');
      },
    });
  };

  const handleAdvanceState = async (profile: RoastProfile, next: RoastState): Promise<void> => {
    if (next === 'done') {
      const bean = beanMap.get(profile.greenBeanId);
      const kg = Math.round((profile.chargeG / 1000) * 1000) / 1000;
      modal.confirm({
        title: `标记「已完成」并按载量扣减库存？`,
        content: bean
          ? `将从「${bean.origin} · ${bean.farm}」（在库 ${bean.stockKg}kg）扣减 ${kg}kg${
              bean.stockKg < kg ? '，但当前余量不足，扣减会被拒绝' : ''
            }。`
          : '未找到关联生豆，将仅更新记录状态。',
        okText: '扣减并完成',
        cancelText: '取消',
        async onOk() {
          const result = await dispatch(consumeStock(profile.id)).unwrap();
          await Promise.all([dispatch(fetchRoastProfiles()).unwrap(), dispatch(fetchMachineTemplates()).unwrap()]);
          if (result.ok) {
            message.success(result.message);
          } else {
            message.warning(result.message);
          }
        },
      });
      return;
    }
    try {
      await dispatch(advanceRoastState({ id: profile.id, state: next })).unwrap();
      message.success(`记录状态已更新为「${ROAST_STATE_LABEL[next]}」`);
    } catch (error) {
      message.error(`状态流转失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleDeleteProfile = (profile: RoastProfile): void => {
    const bean = beanMap.get(profile.greenBeanId);
    modal.confirm({
      title: `删除烘焙记录「${profile.machineModel} · ${profile.roastedAt}」？`,
      content: `将级联删除该记录的 ${eventCount.get(profile.id) ?? 0} 个曲线节点与杯测记录，并从拼配配方中摘除该成分${
        bean ? `（关联生豆：${bean.origin}）` : ''
      }。`,
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      async onOk() {
        await dispatch(deleteRoastProfile(profile.id)).unwrap();
        await Promise.all([
          dispatch(fetchCuppings()).unwrap(),
          dispatch(fetchBlends()).unwrap(),
        ]);
        message.success('烘焙记录及其关联数据已删除');
      },
    });
  };

  const templateColumns: ColumnsType<MachineTemplate> = [
    {
      title: '机型号',
      dataIndex: 'model',
      key: 'model',
      width: 180,
      render: (value: string) => <Typography.Text strong>{value}</Typography.Text>,
    },
    {
      title: '风门档',
      dataIndex: 'airflow',
      key: 'airflow',
      width: 100,
      render: (value: Airflow) => <Tag color={AIRFLOW_COLOR[value]}>{AIRFLOW_LABEL[value]}</Tag>,
    },
    {
      title: '火力档',
      dataIndex: 'gasLevel',
      key: 'gasLevel',
      width: 100,
      sorter: (a, b) => a.gasLevel - b.gasLevel,
      render: (value: number) => (
        <Tag color="#a8632c" icon={<FireOutlined />}>
          {value} 档
        </Tag>
      ),
    },
    {
      title: '常用载量',
      dataIndex: 'chargeG',
      key: 'chargeG',
      width: 170,
      sorter: (a, b) => a.chargeG - b.chargeG,
      render: (value: number) => (
        <Space size={6}>
          <span className="gb-mono">{value} g</span>
          <Tag>{CHARGE_LEVEL_LABEL[chargeLevelOf(value)]}</Tag>
        </Space>
      ),
    },
    {
      title: '备注',
      dataIndex: 'note',
      key: 'note',
      render: (value: string) => <span className="gb-muted">{value || '—'}</span>,
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      render: (_value, record) => (
        <Space size={4}>
          <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Button size="small" type="link" danger icon={<DeleteOutlined />} onClick={() => handleDeleteTemplate(record)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const profileColumns: ColumnsType<RoastProfile> = [
    {
      title: '机型 / 生豆',
      key: 'machine',
      width: 240,
      render: (_value, record) => {
        const bean = beanMap.get(record.greenBeanId);
        return (
          <Space direction="vertical" size={0}>
            <Typography.Text strong>{record.machineModel}</Typography.Text>
            <span className="gb-muted">{bean ? `${bean.origin} · ${bean.farm}` : '（生豆已删除）'}</span>
          </Space>
        );
      },
    },
    {
      title: '载量 / 入豆温',
      key: 'charge',
      width: 160,
      sorter: (a, b) => a.chargeG - b.chargeG,
      render: (_value, record) => (
        <Space direction="vertical" size={0}>
          <span className="gb-mono">{record.chargeG} g</span>
          <span className="gb-muted">入豆 {record.chargeTempC}℃ · {CHARGE_LEVEL_LABEL[chargeLevelOf(record.chargeG)]}</span>
        </Space>
      ),
    },
    {
      title: '风门 / 火力',
      key: 'airflow',
      width: 130,
      render: (_value, record) => (
        <Space size={6}>
          <Tag color={AIRFLOW_COLOR[record.airflow]}>风门{AIRFLOW_LABEL[record.airflow]}</Tag>
          <Tag color="#a8632c">{record.gasLevel} 档</Tag>
        </Space>
      ),
    },
    {
      title: '烘焙日期',
      dataIndex: 'roastedAt',
      key: 'roastedAt',
      width: 130,
      sorter: (a, b) => a.roastedAt.localeCompare(b.roastedAt),
      render: (value: string) => (
        <Space direction="vertical" size={0}>
          <span className="gb-mono">{value}</span>
          <span className="gb-muted">{dayjs().diff(dayjs(value), 'day')} 天前</span>
        </Space>
      ),
    },
    {
      title: '曲线节点',
      key: 'events',
      width: 100,
      render: (_value, record) => {
        const count = eventCount.get(record.id) ?? 0;
        return <Tag color={count >= 5 ? '#2f6f4f' : count > 0 ? '#d48806' : '#8c8c8c'}>{count} / 5</Tag>;
      },
    },
    {
      title: '状态',
      dataIndex: 'state',
      key: 'state',
      width: 100,
      render: (value: RoastState) => <Tag color={ROAST_STATE_COLOR[value]}>{ROAST_STATE_LABEL[value]}</Tag>,
    },
    {
      title: '状态流转 / 操作',
      key: 'action',
      width: 260,
      fixed: 'right',
      render: (_value, record) => (
        <Space size={4} wrap>
          {ROAST_STATE_FLOW[record.state].map((next) => (
            <Button
              key={next}
              size="small"
              type={next === 'done' ? 'primary' : 'default'}
              danger={next === 'void'}
              icon={next === 'done' ? <DownOutlined /> : next === 'recording' ? <ReloadOutlined /> : <ThunderboltOutlined />}
              onClick={() => handleAdvanceState(record, next)}
            >
              {next === 'done' ? '完成并扣减' : next === 'void' ? '作废' : '恢复记录中'}
            </Button>
          ))}
          <Button size="small" type="link" danger icon={<DeleteOutlined />} onClick={() => handleDeleteProfile(record)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <FilterBar
        keyword={roastState.machineFilters.keyword}
        onKeywordChange={(keyword) => dispatch(setMachineFilters({ keyword }))}
        selects={selects}
        value={{
          model: roastState.machineFilters.models,
          airflow: roastState.machineFilters.airflow,
          charge: roastState.machineFilters.chargeLevels,
        }}
        onChange={handleFilterChange}
        onReset={() => dispatch(resetMachineFilters())}
        searchPlaceholder="搜索机型 / 备注"
        summary={
          <StatBadge
            compact
            label="模板 / 记录"
            value={`${filteredTemplates.length} / ${filteredProfiles.length}`}
            tone="gold"
          />
        }
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建载量模板
          </Button>
        }
      />

      <Card title="机型、风门火力档与载量模板" styles={{ body: { paddingTop: 12 } }}>
        <div className="gb-stat-row">
          <StatBadge label="载量模板" value={machineStats.templates} suffix=" 个" icon={<SlidersOutlined />} tone="brown" />
          <StatBadge label="模板平均载量" value={machineStats.averageChargeG} suffix=" g" tone="gold" />
          <StatBadge label="风门档位覆盖" value={`${machineStats.airflowCoverage} / 3`} tone="blue" />
          <StatBadge label="火力档位范围" value={machineStats.gasRange} tone="red" icon={<FireOutlined />} />
          <StatBadge label="烘焙记录" value={roastState.profiles.length} suffix=" 次" tone="green" />
          <StatBadge label="记录中" value={roastState.profiles.filter((item) => item.state === 'recording').length} suffix=" 次" tone="gold" />
        </div>

        {templatesTable.error ? <Typography.Paragraph type="danger">{templatesTable.error}</Typography.Paragraph> : null}

        {filteredTemplates.length === 0 ? (
          <EmptyPanel
            title={templatesTable.rows.length === 0 ? '还没有载量模板' : '没有符合筛选条件的模板'}
            description="把常用机型 + 风门 + 火力档 + 载量存成模板，新建烘焙记录时可直接套用。"
            actionText="新建载量模板"
            onAction={openCreate}
            secondaryText="重置筛选"
            secondaryIcon="none"
            onSecondary={() => dispatch(resetMachineFilters())}
            size="small"
          />
        ) : (
          <Table
            className="gb-table"
            rowKey="id"
            size="small"
            loading={templatesTable.loading}
            columns={templateColumns}
            dataSource={filteredTemplates}
            pagination={false}
          />
        )}

        <div style={{ marginTop: 14 }}>
          <Typography.Text strong>档位参考：</Typography.Text>
          <Space wrap size={[8, 8]} style={{ marginLeft: 8 }}>
            {AIRFLOW_OPTIONS.map((option) => (
              <Tag key={option.value} color={AIRFLOW_COLOR[option.value as Airflow]}>
                风门 {option.label}
              </Tag>
            ))}
            {GAS_LEVEL_OPTIONS.map((option) => (
              <Tag key={option.value} color="#a8632c">
                火力 {option.label}
              </Tag>
            ))}
          </Space>
        </div>
      </Card>

      <Card
        title="烘焙记录状态总览"
        extra={<span className="gb-muted">记录中 → 已完成 / 作废；标记完成时会按载量扣减生豆在库重量</span>}
        styles={{ body: { paddingTop: 12 } }}
      >
        <div className="gb-stat-row">
          <StatBadge label="记录总数" value={roastState.profiles.length} suffix=" 次" tone="brown" />
          <StatBadge label="记录中" value={roastState.profiles.filter((item) => item.state === 'recording').length} tone="gold" />
          <StatBadge label="已完成" value={roastState.profiles.filter((item) => item.state === 'done').length} tone="green" />
          <StatBadge label="作废" value={roastState.profiles.filter((item) => item.state === 'void').length} tone="red" />
          <StatBadge
            label="平均载量"
            value={
              roastState.profiles.length > 0
                ? Math.round(roastState.profiles.reduce((acc, item) => acc + item.chargeG, 0) / roastState.profiles.length)
                : 0
            }
            suffix=" g"
            tone="blue"
          />
          <StatBadge
            label="低余量生豆"
            value={beanState.greenBeans.filter((bean) => bean.stockKg < LOW_STOCK_KG).length}
            suffix=" 批"
            tone="red"
          />
        </div>

        {beanState.stockNotice ? (
          <Typography.Paragraph type="warning" style={{ marginBottom: 12 }}>
            {beanState.stockNotice}
          </Typography.Paragraph>
        ) : null}

        {filteredProfiles.length === 0 ? (
          <EmptyPanel
            title={roastState.profiles.length === 0 ? '还没有烘焙记录' : '没有符合筛选条件的烘焙记录'}
            description="烘焙记录在「烘焙曲线」页新建，这里负责机型配置、状态流转与库存扣减。"
            secondaryText="重置筛选"
            secondaryIcon="none"
            onSecondary={() => dispatch(resetMachineFilters())}
            size="small"
          />
        ) : (
          <Table
            className="gb-table"
            rowKey="id"
            size="small"
            loading={roastState.loading}
            columns={profileColumns}
            dataSource={filteredProfiles}
            scroll={{ x: 1180 }}
            pagination={{ pageSize: 6, showTotal: (total) => `共 ${total} 条烘焙记录` }}
          />
        )}
      </Card>

      <Modal
        title={editingId ? '编辑载量模板' : '新建载量模板'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        okText="保存"
        cancelText="取消"
        confirmLoading={roastState.loading}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="model"
            label="机型号"
            rules={[
              { required: true, message: '请填写或选择机型号' },
              { min: 2, message: '机型号至少 2 个字符' },
            ]}
          >
            <AutoComplete
              options={MACHINE_MODEL_OPTIONS.map((model) => ({ value: model }))}
              placeholder="如：HB-M6"
              filterOption={(input, option) => String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
            />
          </Form.Item>
          <Form.Item name="airflow" label="默认风门" rules={[{ required: true, message: '请选择风门档位' }]}>
            <Select options={AIRFLOW_OPTIONS} />
          </Form.Item>
          <Form.Item name="gasLevel" label="默认火力档" rules={[{ required: true, message: '请选择火力档位' }]}>
            <Select options={GAS_LEVEL_OPTIONS} />
          </Form.Item>
          <Form.Item
            name="chargeG"
            label="常用载量（克）"
            rules={[
              { required: true, message: '请填写常用载量' },
              {
                validator: (_rule, value: number) =>
                  Number.isFinite(value) && value >= 50 && value <= 3000
                    ? Promise.resolve()
                    : Promise.reject(new Error('载量应在 50 - 3000 克之间')),
              },
            ]}
          >
            <InputNumber min={50} max={3000} step={50} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="note" label="备注" rules={[{ max: 40, message: '不超过 40 个字符' }]}>
            <Input placeholder="如：满锅载量 / 样品烘焙" />
          </Form.Item>
        </Form>
      </Modal>

      <Card size="small" title="状态流转规则" styles={{ body: { paddingTop: 10 } }}>
        <Space direction="vertical" size={4}>
          {ROAST_STATE_OPTIONS.map((option) => (
            <span key={option.value} className="gb-muted">
              「{option.label}」→ 可流转到：
              {ROAST_STATE_FLOW[option.value as RoastState].map((next) => ROAST_STATE_LABEL[next]).join(' / ') || '（终态）'}
            </span>
          ))}
          <span className="gb-muted">标记「已完成」时会按该记录的载量自动扣减对应生豆的在库重量，并给出余量提醒。</span>
        </Space>
      </Card>
    </Space>
  );
}
