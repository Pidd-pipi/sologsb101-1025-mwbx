/**
 * <StatBadge> 徽标 + 标签，用于在库重量、发展率、均分等派生值的概览展示。
 * 被机型页（/machines）、曲线页（/curves）、拼配页（/blends）等复用。
 */
import type { ReactNode } from 'react';
import { Tooltip } from 'antd';

export type StatTone = 'default' | 'gold' | 'green' | 'red' | 'blue' | 'brown' | 'purple';

export interface StatBadgeProps {
  /** 指标名 */
  label: string;
  /** 指标值 */
  value: ReactNode;
  /** 单位/后缀 */
  suffix?: string;
  /** 色调 */
  tone?: StatTone;
  /** 图标 */
  icon?: ReactNode;
  /** 悬浮说明 */
  hint?: string;
  /** 是否使用紧凑样式 */
  compact?: boolean;
}

const TONE_COLOR: Record<StatTone, string> = {
  default: '#4a2c17',
  gold: '#a8632c',
  green: '#2f6f4f',
  red: '#b3372f',
  blue: '#3b7ea1',
  brown: '#7a5230',
  purple: '#7a4b8f',
};

const TONE_BG: Record<StatTone, string> = {
  default: 'rgba(74, 44, 23, 0.06)',
  gold: 'rgba(168, 99, 44, 0.12)',
  green: 'rgba(47, 111, 79, 0.12)',
  red: 'rgba(179, 55, 47, 0.12)',
  blue: 'rgba(59, 126, 161, 0.12)',
  brown: 'rgba(122, 82, 48, 0.12)',
  purple: 'rgba(122, 75, 143, 0.12)',
};

export function StatBadge({ label, value, suffix, tone = 'default', icon, hint, compact = false }: StatBadgeProps) {
  const color = TONE_COLOR[tone];
  const content = (
    <div
      className="gb-stat-badge"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: compact ? '4px 10px' : '8px 14px',
        borderRadius: 10,
        border: `1px solid ${color}33`,
        background: TONE_BG[tone],
        minWidth: compact ? 0 : 118,
      }}
    >
      {icon ? <span style={{ color, fontSize: compact ? 13 : 16 }}>{icon}</span> : null}
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
        <span style={{ fontSize: 11, color: 'rgba(74,44,23,0.62)' }}>{label}</span>
        <span style={{ fontSize: compact ? 14 : 18, fontWeight: 600, color }}>
          {value}
          {suffix ? <span style={{ fontSize: 12, marginLeft: 2, fontWeight: 400 }}>{suffix}</span> : null}
        </span>
      </span>
    </div>
  );
  return hint ? <Tooltip title={hint}>{content}</Tooltip> : content;
}

export default StatBadge;
