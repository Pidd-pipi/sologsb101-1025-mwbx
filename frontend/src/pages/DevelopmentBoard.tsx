/**
 * /development 发展率与 RoR 计算
 * 消费 Event、RoastProfile；复用 <ScoreTag>、<FilterBar>、<StatBadge>、<EmptyPanel>。
 * 交互：按节点计算发展时间占比与各段升温速率、给出异常提示（缺节点 / 发展不足或过长 / RoR 过高或停滞 /
 *       一爆后升温反弹 / 脱水期过长），支持按状态、机型、发展率分档、异常提示筛选，并可导出曲线档案。
 */
import { useEffect, useMemo } from 'react';
import {
  App as AntdApp,
  Button,
  Card,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { AreaChartOutlined, DownloadOutlined, ExperimentOutlined, WarningOutlined } from '@ant-design/icons';
import FilterBar, { type FilterSelectConfig } from '../components/common/FilterBar';
import EmptyPanel from '../components/common/EmptyPanel';
import ScoreTag from '../components/common/ScoreTag';
import StatBadge from '../components/common/StatBadge';
import { useIdbTable } from '../hooks/useIdbTable';
import { useRoastCurve } from '../hooks/useRoastCurve';
import { useAppDispatch, useAppSelector } from '../stores/store';
import { selectBeanState } from '../stores/beanSlice';
import {
  fetchRoastProfiles,
  resetRoastFilters,
  selectCurrentProfile,
  selectMachineModelOptions,
  selectRoastState,
  setCurrentProfileId,
  setRoastFilters,
} from '../stores/roastSlice';
import {
  MACHINE_MODEL_OPTIONS,
  ROAST_STATE_COLOR,
  ROAST_STATE_LABEL,
  ROAST_STATE_OPTIONS,
  type RoastProfile,
  type RoastState,
} from '../types/roastprofile';
import { EVENT_TYPE_LABEL, type RoastEvent } from '../types/event';
import {
  DEV_BAND_COLOR,
  DEV_BAND_LABEL,
  computeCurve,
  formatSeconds,
  type CurveSummary,
  type DevBand,
} from '../utils/curve';
import { exportRoastCurveJson } from '../utils/export';

interface DevelopmentRow {
  profile: RoastProfile;
  summary: CurveSummary;
  beanLabel: string;
}

export default function DevelopmentBoard() {
  const dispatch = useAppDispatch();
  const { message } = AntdApp.useApp();

  const roastState = useAppSelector(selectRoastState);
  const beanState = useAppSelector(selectBeanState);
  const modelOptions = useAppSelector(selectMachineModelOptions);
  const currentProfile = useAppSelector(selectCurrentProfile);

  const eventsTable = useIdbTable<RoastEvent>('events');
  const curve = useRoastCurve(roastState.currentProfileId);

  useEffect(() => {
    void dispatch(fetchRoastProfiles());
  }, [dispatch]);

  const beanMap = useMemo(() => new Map(beanState.greenBeans.map((bean) => [bean.id, bean])), [beanState.greenBeans]);

  const eventsByProfile = useMemo(() => {
    const grouped = new Map<string, RoastEvent[]>();
    eventsTable.rows.forEach((event) => {
      const list = grouped.get(event.profileId) ?? [];
      list.push(event);
      grouped.set(event.profileId, list);
    });
    return grouped;
  }, [eventsTable.rows]);

  const rows = useMemo<DevelopmentRow[]>(
    () =>
      roastState.profiles.map((profile) => {
        const bean = beanMap.get(profile.greenBeanId);
        return {
          profile,
          summary: computeCurve(eventsByProfile.get(profile.id) ?? []),
          beanLabel: bean ? `${bean.origin} · ${bean.farm}` : '（生豆已删除）',
        };
      }),
    [roastState.profiles, beanMap, eventsByProfile],
  );

  const filteredRows = useMemo(() => {
    const { keyword, states, machineModels, devBands, anomaly: anomalyFilter } = roastState.filters;
    const needle = keyword.trim().toLowerCase();
    return rows.filter((row) => {
      if (needle) {
        const haystack = `${row.profile.machineModel} ${row.profile.roastedAt} ${row.beanLabel}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (states.length > 0 && !states.includes(row.profile.state)) return false;
      if (machineModels.length > 0 && !machineModels.includes(row.profile.machineModel)) return false;
      if (devBands.length > 0 && !devBands.includes(row.summary.devBand)) return false;
      if (anomalyFilter.length > 0) {
        const flag = row.summary.anomalyNotes.length > 0 ? 'hasAnomaly' : 'noAnomaly';
        if (!anomalyFilter.includes(flag)) return false;
      }
      return true;
    });
  }, [rows, roastState.filters]);

  const selects: FilterSelectConfig[] = [
    { key: 'state', label: '记录状态', options: ROAST_STATE_OPTIONS },
    {
      key: 'model',
      label: '机型',
      width: 170,
      options: (modelOptions.length > 0 ? modelOptions : MACHINE_MODEL_OPTIONS).map((model) => ({
        value: model,
        label: model,
      })),
    },
    {
      key: 'devBand',
      label: '发展率分档',
      width: 160,
      options: (['short', 'balanced', 'long', 'unknown'] as const).map((band) => ({
        value: band,
        label: DEV_BAND_LABEL[band],
      })),
    },
    {
      key: 'anomaly',
      label: '异常提示',
      width: 150,
      options: [
        { value: 'hasAnomaly', label: '有异常提示' },
        { value: 'noAnomaly', label: '无异常提示' },
      ],
    },
  ];

  const handleFilterChange = (key: string, values: string[]): void => {
    if (key === 'state') {
      dispatch(setRoastFilters({ states: values as RoastState[] }));
      return;
    }
    if (key === 'model') {
      dispatch(setRoastFilters({ machineModels: values }));
      return;
    }
    if (key === 'devBand') {
      dispatch(setRoastFilters({ devBands: values as DevBand[] }));
      return;
    }
    if (key === 'anomaly') {
      dispatch(setRoastFilters({ anomaly: values as Array<'hasAnomaly' | 'noAnomaly'> }));
    }
  };

  const handleReset = (): void => {
    dispatch(resetRoastFilters());
  };

  const handleExport = (profile: RoastProfile, summary: CurveSummary, eventList: RoastEvent[]): void => {
    const filename = exportRoastCurveJson(profile, beanMap.get(profile.greenBeanId), eventList, summary);
    message.success(`已导出曲线档案：${filename}`);
  };

  const columns: ColumnsType<DevelopmentRow> = [
    {
      title: '烘焙记录',
      key: 'profile',
      width: 250,
      render: (_value, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>
            {row.profile.machineModel} · {row.profile.roastedAt}
          </Typography.Text>
          <span className="gb-muted">{row.beanLabel}</span>
        </Space>
      ),
    },
    {
      title: '节点',
      key: 'nodes',
      width: 90,
      sorter: (a, b) => a.summary.keyNodes.length - b.summary.keyNodes.length,
      render: (_value, row) => (
        <Tag color={row.summary.complete ? '#2f6f4f' : '#d48806'}>
          {row.summary.keyNodes.length} / 5
        </Tag>
      ),
    },
    {
      title: '总时间',
      key: 'total',
      width: 100,
      sorter: (a, b) => a.summary.totalSec - b.summary.totalSec,
      render: (_value, row) => <span className="gb-mono">{formatSeconds(row.summary.totalSec)}</span>,
    },
    {
      title: '脱水期占比',
      key: 'dry',
      width: 120,
      sorter: (a, b) => a.summary.dryRatioPct - b.summary.dryRatioPct,
      render: (_value, row) =>
        row.summary.dryEndSec === null ? (
          <span className="gb-muted">待补录</span>
        ) : (
          <Tag color={row.summary.dryRatioPct > 55 ? '#d48806' : '#3b7ea1'}>{row.summary.dryRatioPct}%</Tag>
        ),
    },
    {
      title: '发展时间 / 占比',
      key: 'dev',
      width: 220,
      sorter: (a, b) => a.summary.devRatioPct - b.summary.devRatioPct,
      render: (_value, row) => (
        <Space size={6} wrap>
          <span className="gb-mono">{formatSeconds(row.summary.devSec)}</span>
          <ScoreTag devRatioPct={row.summary.devRatioPct} devBand={row.summary.devBand} label="发展率" />
        </Space>
      ),
    },
    {
      title: '平均 / 峰值 RoR',
      key: 'ror',
      width: 230,
      sorter: (a, b) => a.summary.averageRor - b.summary.averageRor,
      render: (_value, row) => (
        <Space size={4} wrap>
          <ScoreTag ror={row.summary.averageRor} label="均" showIcon={false} />
          <Tooltip title="峰值 RoR 出现在分段中最陡的一段">
            <span>
              <ScoreTag ror={row.summary.peakRor} label="峰" showIcon={false} />
            </span>
          </Tooltip>
        </Space>
      ),
    },
    {
      title: '异常',
      key: 'anomaly',
      width: 100,
      sorter: (a, b) => a.summary.anomalyNotes.length - b.summary.anomalyNotes.length,
      render: (_value, row) =>
        row.summary.anomalyNotes.length > 0 ? (
          <Tooltip title={row.summary.anomalyNotes.join('；')}>
            <Tag color="#b3372f" icon={<WarningOutlined />}>
              {row.summary.anomalyNotes.length} 条
            </Tag>
          </Tooltip>
        ) : (
          <Tag color="#2f6f4f">正常</Tag>
        ),
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      fixed: 'right',
      render: (_value, row) => (
        <Space size={4}>
          <Button size="small" type="link" onClick={() => dispatch(setCurrentProfileId(row.profile.id))}>
            展开分析
          </Button>
          <Button
            size="small"
            type="link"
            icon={<DownloadOutlined />}
            onClick={() =>
              handleExport(row.profile, row.summary, eventsByProfile.get(row.profile.id) ?? [])
            }
          >
            导出
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <FilterBar
        keyword={roastState.filters.keyword}
        onKeywordChange={(keyword) => dispatch(setRoastFilters({ keyword }))}
        selects={selects}
        value={{
          state: roastState.filters.states,
          model: roastState.filters.machineModels,
          devBand: roastState.filters.devBands,
          anomaly: roastState.filters.anomaly,
        }}
        onChange={handleFilterChange}
        onReset={handleReset}
        searchPlaceholder="搜索机型 / 日期 / 生豆"
        summary={<StatBadge compact label="记录" value={filteredRows.length} suffix={`/ ${rows.length}`} tone="gold" />}
      />

      <Card title="发展率与分段 RoR 总览" styles={{ body: { paddingTop: 12 } }}>
        <div className="gb-stat-row">
          <StatBadge label="烘焙记录" value={rows.length} suffix=" 次" icon={<AreaChartOutlined />} tone="brown" />
          <StatBadge
            label="关键节点齐全"
            value={rows.filter((row) => row.summary.complete).length}
            suffix=" 次"
            tone="green"
          />
          <StatBadge
            label="发展不足"
            value={rows.filter((row) => row.summary.devBand === 'short').length}
            suffix=" 次"
            tone="gold"
          />
          <StatBadge
            label="发展偏长"
            value={rows.filter((row) => row.summary.devBand === 'long').length}
            suffix=" 次"
            tone="red"
          />
          <StatBadge
            label="异常提示"
            value={rows.reduce((acc, row) => acc + row.summary.anomalyNotes.length, 0)}
            suffix=" 条"
            tone="red"
            icon={<WarningOutlined />}
          />
        </div>

        {filteredRows.length === 0 ? (
          <EmptyPanel
            title={rows.length === 0 ? '还没有烘焙记录可分析' : '没有符合筛选条件的烘焙记录'}
            description="先到「烘焙曲线」页录入回温 / 脱水结束 / 一爆 / 二爆 / 下豆节点，这里会自动算出发展率与分段 RoR。"
            secondaryText="重置筛选"
            secondaryIcon="none"
            onSecondary={handleReset}
          />
        ) : (
          <Table
            className="gb-table"
            rowKey={(row) => row.profile.id}
            size="small"
            loading={roastState.loading || eventsTable.loading}
            columns={columns}
            dataSource={filteredRows}
            scroll={{ x: 1280 }}
            pagination={{ pageSize: 6, showTotal: (total) => `共 ${total} 条记录` }}
            rowClassName={(row) => (row.profile.id === roastState.currentProfileId ? 'ant-table-row-selected' : '')}
          />
        )}
      </Card>

      {currentProfile ? (
        <Card
          title={`分段分析 · ${currentProfile.machineModel} · ${currentProfile.roastedAt}`}
          extra={
            <Space wrap size={8}>
              <Tag color={ROAST_STATE_COLOR[currentProfile.state]}>{ROAST_STATE_LABEL[currentProfile.state]}</Tag>
              <ScoreTag devRatioPct={curve.devRatioPct} devBand={curve.devBand} />
              <Tag color={DEV_BAND_COLOR[curve.devBand]}>{DEV_BAND_LABEL[curve.devBand]}结论</Tag>
              <Button
                size="small"
                icon={<DownloadOutlined />}
                onClick={() => handleExport(currentProfile, curve, curve.events)}
              >
                导出曲线
              </Button>
            </Space>
          }
          styles={{ body: { paddingTop: 12 } }}
        >
          {curve.events.length === 0 ? (
            <EmptyPanel
              title="这条记录还没有曲线节点"
              description="到「烘焙曲线」页补录节点后即可看到发展率与分段 RoR。"
              size="small"
            />
          ) : (
            <>
              <div className="gb-stat-row">
                <StatBadge label="总烘焙时间" value={curve.totalReadable} tone="blue" />
                <StatBadge label="脱水期占比" value={curve.dryRatioPct} suffix="%" tone="brown" />
                <StatBadge label="发展时间" value={curve.devReadable} tone="gold" />
                <StatBadge label="发展时间占比" value={curve.devRatioPct} suffix="%" tone={curve.devBand === 'balanced' ? 'green' : 'red'} />
                <StatBadge label="平均 RoR" value={curve.averageRor} suffix=" ℃/min" tone="green" />
                <StatBadge label="峰值 RoR" value={curve.peakRor} suffix=" ℃/min" tone={curve.peakRor > 16 ? 'red' : 'default'} />
                <StatBadge label="已录节点" value={curve.events.length} suffix=" / 5" tone="purple" />
              </div>

              <Typography.Title level={5} style={{ marginTop: 4 }}>
                关键节点
              </Typography.Title>
              <Table
                className="gb-table"
                rowKey={(row) => row.type}
                size="small"
                pagination={false}
                dataSource={curve.keyNodes}
                columns={[
                  {
                    title: '节点',
                    dataIndex: 'label',
                    width: 110,
                    render: (value: string) => <Tag color="#7a5230">{value}</Tag>,
                  },
                  {
                    title: '时间',
                    dataIndex: 'atSec',
                    width: 140,
                    render: (value: number) => <span className="gb-mono">{formatSeconds(value)}（{value}s）</span>,
                  },
                  {
                    title: '豆温',
                    dataIndex: 'beanTempC',
                    width: 100,
                    render: (value: number) => <span className="gb-mono">{value} ℃</span>,
                  },
                  {
                    title: '节点 RoR',
                    dataIndex: 'rorPerMin',
                    width: 220,
                    render: (value: number) => <ScoreTag ror={value} showIcon={false} />,
                  },
                  {
                    title: '备注',
                    dataIndex: 'note',
                    render: (value: string) => <span className="gb-muted">{value || '—'}</span>,
                  },
                ]}
                expandable={{ defaultExpandAllRows: true }}
              />

              <Typography.Title level={5} style={{ marginTop: 16 }}>
                分段 RoR（相邻节点）
              </Typography.Title>
              {curve.segments.length === 0 ? (
                <Typography.Text type="secondary">至少需要两个节点才能计算分段 RoR。</Typography.Text>
              ) : (
                <Table
                  className="gb-table"
                  rowKey={(row) => `${row.fromType}-${row.toType}`}
                  size="small"
                  pagination={false}
                  dataSource={curve.segments}
                  columns={[
                    {
                      title: '区间',
                      key: 'range',
                      width: 180,
                      render: (_value, row) => (
                        <span>
                          {EVENT_TYPE_LABEL[row.fromType]} → {EVENT_TYPE_LABEL[row.toType]}
                        </span>
                      ),
                    },
                    {
                      title: '时长',
                      key: 'seconds',
                      width: 150,
                      render: (_value, row) => (
                        <span className="gb-mono">
                          {formatSeconds(row.startSec)} - {formatSeconds(row.endSec)}（{row.seconds}s）
                        </span>
                      ),
                    },
                    {
                      title: '温升',
                      dataIndex: 'deltaTempC',
                      width: 120,
                      render: (value: number) => <span className="gb-mono">{value > 0 ? `+${value}` : value} ℃</span>,
                    },
                    {
                      title: 'RoR',
                      dataIndex: 'rorPerMin',
                      width: 240,
                      render: (value: number) => <ScoreTag ror={value} />,
                    },
                  ]}
                />
              )}

              <Typography.Title level={5} style={{ marginTop: 16 }}>
                异常提示
              </Typography.Title>
              {curve.anomalyNotes.length === 0 ? (
                <Tag color="#2f6f4f" icon={<ExperimentOutlined />}>
                  曲线指标正常，无异常提示
                </Tag>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {curve.anomalyNotes.map((note) => (
                    <li key={note} style={{ color: '#8c4a23' }}>
                      {note}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Card>
      ) : null}
    </Space>
  );
}
