/**
 * 路由常量与导航元信息（叶子模块，不依赖任何组件）。
 *
 * 单独抽出的原因：App.tsx 需要 ROUTES / ROUTE_META 渲染侧边导航与 document.title，
 * 而 router/index.tsx 又需要 import App 作为布局根元素。若常量直接放在 router/index.tsx，
 * 会形成 `App.tsx ⇄ router/index.tsx` 的循环依赖，模块求值顺序变化时
 * （生产构建尤其明显）会在 App.tsx 顶层 `ROUTE_ICONS` 里访问尚未初始化的 ROUTES，
 * 抛出 "Cannot access 'ROUTES' before initialization" 导致整页白屏。
 */

export const ROUTES = {
  beans: '/beans',
  machines: '/machines',
  curves: '/curves',
  development: '/development',
  cuppings: '/cuppings',
  blends: '/blends',
} as const;

export interface RouteMeta {
  path: string;
  title: string;
  description: string;
}

/** 导航标题与说明（App 侧边栏与 document.title 共用） */
export const ROUTE_META: RouteMeta[] = [
  { path: ROUTES.beans, title: '生豆档案', description: '产地/处理法/在库重量与到货天数' },
  { path: ROUTES.machines, title: '机型与载量', description: '机型、风门火力档与常用载量模板' },
  { path: ROUTES.curves, title: '烘焙曲线', description: '关键节点录入、时间轴排序与缺节点补录' },
  { path: ROUTES.development, title: '发展率与 RoR', description: '发展时间占比、分段升温速率与异常提示' },
  { path: ROUTES.cuppings, title: '杯测评分', description: '分项加权总分、分档结论与总分排序' },
  { path: ROUTES.blends, title: '拼配方案', description: '占比 100% 校验、杯测均分回显与 JSON 导入导出' },
];
