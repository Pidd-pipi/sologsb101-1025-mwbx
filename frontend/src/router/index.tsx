/**
 * 路由表：/beans、/machines、/curves、/development、/cuppings、/blends
 * 页面按路由懒加载（构建时自动分包）；/ 与未知路径都重定向到第一个模块路径 /beans。
 */
import { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';
import { Skeleton } from 'antd';
import App from '../App';
import { ROUTES, ROUTE_META, type RouteMeta } from './routes';

// 路由常量定义在 ./routes 叶子模块并在此转发，避免 App.tsx ⇄ router/index.tsx 循环依赖
// （循环依赖会让 App.tsx 顶层 ROUTE_ICONS 访问到尚未初始化的 ROUTES，直接白屏）
export { ROUTES, ROUTE_META };
export type { RouteMeta };

const BeanList = lazy(() => import('../pages/BeanList'));
const MachineConfig = lazy(() => import('../pages/MachineConfig'));
const CurveEntry = lazy(() => import('../pages/CurveEntry'));
const DevelopmentBoard = lazy(() => import('../pages/DevelopmentBoard'));
const CuppingBoard = lazy(() => import('../pages/CuppingBoard'));
const BlendPlan = lazy(() => import('../pages/BlendPlan'));

/** 懒加载页面占位 */
function RouteFallback() {
  return <Skeleton active paragraph={{ rows: 6 }} style={{ background: '#fffaf4', padding: 16, borderRadius: 10 }} />;
}

/** 包裹懒加载页面，避免整页被 Suspense 卸载 */
function withSuspense(node: ReactNode): ReactNode {
  return <Suspense fallback={<RouteFallback />}>{node}</Suspense>;
}

export const appRoutes: RouteObject[] = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Navigate to={ROUTES.beans} replace /> },
      { path: 'beans', element: withSuspense(<BeanList />) },
      { path: 'machines', element: withSuspense(<MachineConfig />) },
      { path: 'curves', element: withSuspense(<CurveEntry />) },
      { path: 'development', element: withSuspense(<DevelopmentBoard />) },
      { path: 'cuppings', element: withSuspense(<CuppingBoard />) },
      { path: 'blends', element: withSuspense(<BlendPlan />) },
      { path: '*', element: <Navigate to={ROUTES.beans} replace /> },
    ],
  },
];

export default appRoutes;
