/**
 * <FilterBar> 关键字 + 多个下拉多选过滤器，并把筛选条件同步到 URL query。
 * 被生豆页（/beans）、曲线页（/curves）、拼配页（/blends）等全部列表页消费。
 * 同步规则：q=关键字，其余每个下拉用配置里的 key 作为参数名（多值以逗号连接）。
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Button, Card, Input, Select, Space, Typography } from 'antd';
import { FilterOutlined, ReloadOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';

export interface FilterSelectOption {
  value: string;
  label: string;
}

export interface FilterSelectConfig {
  /** URL query 参数名，同时作为 onChange 的回传 key */
  key: string;
  label: string;
  options: FilterSelectOption[];
  placeholder?: string;
  /** 下拉最小宽度 */
  width?: number;
}

export interface FilterBarProps {
  keyword: string;
  onKeywordChange: (keyword: string) => void;
  /** 下拉多选配置（至少 2 个） */
  selects?: FilterSelectConfig[];
  /** 当前选中的下拉值 */
  value?: Record<string, string[]>;
  onChange?: (key: string, values: string[]) => void;
  onReset?: () => void;
  searchPlaceholder?: string;
  /** 右侧附加操作区 */
  extra?: ReactNode;
  /** 标题右侧的统计说明 */
  summary?: ReactNode;
  /** 是否同步 URL query（默认 true） */
  urlSync?: boolean;
}

export function FilterBar({
  keyword,
  onKeywordChange,
  selects = [],
  value: valueProp,
  onChange,
  onReset,
  searchPlaceholder = '搜索关键字…',
  extra,
  summary,
  urlSync = true,
}: FilterBarProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const hydratedRef = useRef(false);
  const lastSignatureRef = useRef<string | null>(null);
  const value = useMemo(() => valueProp ?? {}, [valueProp]);

  // URL → 筛选条件：仅首帧水合一次，保证刷新页面后筛选不丢
  useEffect(() => {
    if (!urlSync || hydratedRef.current) return;
    hydratedRef.current = true;
    const keywordParam = searchParams.get('q');
    if (keywordParam) onKeywordChange(keywordParam);
    selects.forEach((select) => {
      const raw = searchParams.get(select.key);
      if (raw) {
        onChange?.(
          select.key,
          raw
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        );
      }
    });
    // 只在首帧执行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 筛选条件 → URL：跳过首帧，避免在水合前把参数清空
  useEffect(() => {
    if (!urlSync) return;
    const signature = JSON.stringify({ keyword: keyword.trim(), value });
    if (lastSignatureRef.current === null) {
      lastSignatureRef.current = signature;
      return;
    }
    if (lastSignatureRef.current === signature) return;
    lastSignatureRef.current = signature;
    const params = new URLSearchParams();
    if (keyword.trim()) params.set('q', keyword.trim());
    Object.entries(value).forEach(([key, list]) => {
      if (list.length > 0) params.set(key, list.join(','));
    });
    setSearchParams(params, { replace: true });
  }, [keyword, value, setSearchParams, urlSync]);

  const activeCount = useMemo(() => {
    const selectCount = Object.values(value).filter((list) => list.length > 0).length;
    return selectCount + (keyword.trim() ? 1 : 0);
  }, [value, keyword]);

  return (
    <Card
      className="gb-filter-bar"
      size="small"
      styles={{ body: { padding: '12px 14px' } }}
      style={{ borderColor: 'rgba(122, 82, 48, 0.2)' }}
    >
      <Space wrap size={[12, 10]} align="center" style={{ width: '100%' }}>
        <Space size={6} align="center">
          <FilterOutlined style={{ color: '#a8632c' }} />
          <Typography.Text strong style={{ color: '#4a2c17' }}>
            筛选
          </Typography.Text>
        </Space>
        <Input
          allowClear
          value={keyword}
          onChange={(event) => onKeywordChange(event.target.value)}
          placeholder={searchPlaceholder}
          style={{ width: 220 }}
        />
        {selects.map((select) => (
          <Space key={select.key} size={4} align="center">
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {select.label}
            </Typography.Text>
            <Select
              mode="multiple"
              allowClear
              maxTagCount="responsive"
              value={value[select.key] ?? []}
              options={select.options}
              placeholder={select.placeholder ?? `全部${select.label}`}
              style={{ minWidth: select.width ?? 168 }}
              onChange={(next: string[]) => onChange?.(select.key, next)}
            />
          </Space>
        ))}
        <Button
          icon={<ReloadOutlined />}
          onClick={() => {
            lastSignatureRef.current = null;
            onReset?.();
            if (urlSync) setSearchParams(new URLSearchParams(), { replace: true });
          }}
        >
          重置
        </Button>
        {activeCount > 0 ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            已启用 {activeCount} 个筛选条件
          </Typography.Text>
        ) : null}
        <div style={{ flex: 1 }} />
        {summary}
        {extra}
      </Space>
    </Card>
  );
}

export default FilterBar;
