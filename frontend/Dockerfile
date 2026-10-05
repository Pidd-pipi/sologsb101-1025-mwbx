# ---------- 构建阶段：node:20-alpine 安装依赖并执行 TypeScript 类型检查 + 生产构建 ----------
FROM node:20-alpine AS builder

WORKDIR /app

# 先只拷贝依赖清单，利用 Docker 层缓存加速重复构建
COPY package.json package-lock.json ./
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

# 再拷贝源码与构建配置
COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src

# npm run build = tsc --noEmit && vite build（零错误、类型检查通过）
RUN npm run build

# ---------- 运行阶段：nginx:alpine 托管静态产物 ----------
FROM nginx:alpine AS runner

# 自定义 nginx 配置：SPA fallback + gzip
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 仅拷贝构建产物，容器保持无状态、不挂载任何命名卷
# 权限归一化说明：COPY 会原样保留宿主权限位，若 public/favicon.svg 是 0600，
# nginx worker（uid=101 nginx）读不到就会返回 403，因此下一步必须紧跟 chmod。
COPY --from=builder /app/dist /usr/share/nginx/html
RUN chmod -R a+rX /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
