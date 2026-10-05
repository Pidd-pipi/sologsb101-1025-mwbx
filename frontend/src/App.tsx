/**
 * 应用外壳：侧边导航（6 个模块）+ 顶部当前模块信息 + 页脚。
 * 首屏在 App 内打开 IndexedDB（空库自动播种演示数据）并并发加载各表。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { App as AntdApp, Badge, Layout, Menu, Space, Spin, Tag, Typography } from 'antd';
import {
  ApiOutlined,
  AreaChartOutlined,
  CoffeeOutlined,
  ExperimentOutlined,
  InboxOutlined,
  SlidersOutlined,
} from '@ant-design/icons';
// 从 ./router/routes 叶子模块取常量（不可从 './router' 取，否则与 router/index.tsx 形成循环依赖）
import { ROUTE_META, ROUTES } from './router/routes';
import { bootstrapData, useAppDispatch, useAppSelector } from './stores/store';
import { selectBeanStats } from './stores/beanSlice';
import { selectRoastStats } from './stores/roastSlice';
import { selectCuppingStats } from './stores/cuppingSlice';
import { selectBlendStats } from './stores/blendSlice';

const { Header, Sider, Content, Footer } = Layout;

const ROUTE_ICONS: Record<string, ReactNode> = {
  [ROUTES.beans]: <InboxOutlined />,
  [ROUTES.machines]: <SlidersOutlined />,
  [ROUTES.curves]: <AreaChartOutlined />,
  [ROUTES.development]: <ApiOutlined />,
  [ROUTES.cuppings]: <ExperimentOutlined />,
  [ROUTES.blends]: <CoffeeOutlined />,
};

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { message } = AntdApp.useApp();
  const [booting, setBooting] = useState(true);

  const beanStats = useAppSelector(selectBeanStats);
  const roastStats = useAppSelector(selectRoastStats);
  const cuppingStats = useAppSelector(selectCuppingStats);
  const blendStats = useAppSelector(selectBlendStats);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await dispatch(bootstrapData()).unwrap();
      } catch (error) {
        if (!cancelled) {
          message.error(`本地数据初始化失败：${error instanceof Error ? error.message : '未知错误'}`);
        }
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dispatch, message]);

  const currentMeta = ROUTE_META.find((item) => location.pathname.startsWith(item.path)) ?? ROUTE_META[0];

  useEffect(() => {
    document.title = `${currentMeta.title} · 咖啡烘焙曲线与杯测档案`;
  }, [currentMeta.title]);

  return (
    <Layout style={{ minHeight: '100vh', background: '#f7f1e8' }}>
      <Sider
        width={238}
        breakpoint="lg"
        collapsedWidth={0}
        style={{ background: '#3a2413', borderRight: '3px solid #a8632c' }}
      >
        <div style={{ padding: '18px 16px 10px' }}>
          <Typography.Title level={5} style={{ color: '#f3dcbd', margin: 0 }}>
            咖啡烘焙曲线与杯测档案
          </Typography.Title>
          <Typography.Text style={{ color: 'rgba(243,220,189,0.62)', fontSize: 12 }}>
            gbroastlog · 烘焙留档与复盘
          </Typography.Text>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[currentMeta.path]}
          style={{ background: 'transparent' }}
          onClick={({ key }) => navigate(key)}
          items={ROUTE_META.map((item) => ({
            key: item.path,
            icon: ROUTE_ICONS[item.path],
            label: item.title,
          }))}
        />
        <div style={{ padding: '12px 16px', color: 'rgba(243,220,189,0.66)', fontSize: 12 }}>
          <Space direction="vertical" size={2}>
            <span>
              <InboxOutlined /> 生豆 {beanStats.total} 批 · 在库 {beanStats.stockKg}kg
            </span>
            <span>
              <AreaChartOutlined /> 烘焙 {roastStats.total} 次 · 记录中 {roastStats.recording}
            </span>
            <span>
              <ExperimentOutlined /> 杯测 {cuppingStats.total} 笔 · 均分 {cuppingStats.average}
            </span>
            <span>
              <CoffeeOutlined /> 拼配 {blendStats.total} 个 · 定版 {blendStats.finalized}
            </span>
          </Space>
        </div>
      </Sider>

      <Layout style={{ background: '#f7f1e8' }}>
        <Header
          style={{
            background: '#fffaf4',
            borderBottom: '1px solid rgba(122,82,48,0.18)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingInline: 20,
            height: 64,
          }}
        >
          <Space size={10} wrap>
            <Typography.Text strong style={{ fontSize: 16 }}>
              {currentMeta.title}
            </Typography.Text>
            <Tag color="#a8632c">{currentMeta.description}</Tag>
          </Space>
          <Space size={14} wrap>
            <Badge count={beanStats.total} showZero color="#7a5230" title="生豆批次数" />
            <Badge count={roastStats.total} showZero color="#a8632c" title="烘焙记录数" />
            <Badge count={cuppingStats.total} showZero color="#2f6f4f" title="杯测记录数" />
            <Badge count={blendStats.total} showZero color="#7a4b8f" title="拼配方案数" />
            {beanStats.lowStock > 0 ? (
              <Tag color="#b3372f">余量提醒 {beanStats.lowStock} 批</Tag>
            ) : (
              <Tag color="#2f6f4f">余量正常</Tag>
            )}
          </Space>
        </Header>

        <Content style={{ padding: 20, minHeight: 320 }}>
          {booting ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
              <Spin tip="正在打开本地烘焙档案库…" size="large">
                <div style={{ width: 220, height: 60 }} />
              </Spin>
            </div>
          ) : (
            <Outlet />
          )}
        </Content>

        <Footer style={{ textAlign: 'center', background: 'transparent', color: 'rgba(74,44,23,0.55)' }}>
          纯前端 SPA · 数据仅保存在本机浏览器 IndexedDB（库名 gbroastlog，结构版本 2）·
          <Link to={ROUTES.beans} style={{ marginLeft: 6 }}>
            返回生豆档案
          </Link>
        </Footer>
      </Layout>
    </Layout>
  );
}
