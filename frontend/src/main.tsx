/**
 * 入口：Redux <Provider> + antd ConfigProvider(zh_CN) + AntdApp + RouterProvider。
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import 'antd/dist/reset.css';
import './styles/main.css';
import { appRoutes } from './router';
import { store } from './stores/store';

/** 咖啡烘焙主题：暖棕底 + 焦糖主色 */
const theme = {
  token: {
    colorPrimary: '#a8632c',
    colorInfo: '#3b7ea1',
    colorSuccess: '#2f6f4f',
    colorWarning: '#d48806',
    colorError: '#b3372f',
    colorTextBase: '#3a2413',
    borderRadius: 8,
    fontFamily:
      '"PingFang SC", "Hiragino Sans GB", "Source Han Sans SC", "Microsoft YaHei", system-ui, sans-serif',
  },
  components: {
    Layout: { headerBg: '#fffaf4', siderBg: '#3a2413' },
    Card: { headerBg: '#fdf3e7' },
    Table: { headerBg: '#f6ebdd' },
  },
};

const container = document.getElementById('root');
if (!container) {
  throw new Error('未找到 #root 挂载节点');
}

/** 路由由 src/router/index.tsx 提供，App 负责整体布局与外层导航 */
const router = createBrowserRouter(appRoutes);

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <Provider store={store}>
      <ConfigProvider locale={zhCN} theme={theme}>
        <AntdApp>
          <RouterProvider router={router} />
        </AntdApp>
      </ConfigProvider>
    </Provider>
  </React.StrictMode>,
);
