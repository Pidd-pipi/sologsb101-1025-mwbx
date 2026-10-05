/**
 * <ScoreTag> 按杯测总分、RoR 区间与发展率分档渲染不同底色与图标。
 * 被发展率页（/development）与杯测页（/cuppings）以及曲线页消费。
 */
import { Tag } from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  StarFilled,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { cuppingGradeOf } from '../../types/cupping';
import { DEV_BAND_COLOR, DEV_BAND_LABEL, ROR_BAND_COLOR, ROR_BAND_LABEL, rorBandOf, type DevBand } from '../../utils/curve';

export type ScoreTagKind = 'score' | 'ror' | 'dev';

export interface ScoreTagProps {
  /** 杯测总分 0-100 */
  score?: number;
  /** 升温速率 ℃/min */
  ror?: number;
  /** 发展时间占比 % */
  devRatioPct?: number;
  /** 发展率分档（缺节点时为 unknown） */
  devBand?: DevBand;
  /** 标签类型，默认按传入字段自动判断 */
  kind?: ScoreTagKind;
  /** 自定义前缀文案 */
  label?: string;
  /** 是否显示图标 */
  showIcon?: boolean;
}

function resolveKind(props: ScoreTagProps): ScoreTagKind {
  if (props.kind) return props.kind;
  if (typeof props.score === 'number') return 'score';
  if (typeof props.ror === 'number') return 'ror';
  return 'dev';
}

export function ScoreTag({
  score,
  ror,
  devRatioPct,
  devBand = 'unknown',
  kind,
  label,
  showIcon = true,
}: ScoreTagProps) {
  const resolved = resolveKind({ score, ror, devRatioPct, devBand, kind });

  if (resolved === 'score') {
    const value = typeof score === 'number' ? score : 0;
    const grade = cuppingGradeOf(value);
    return (
      <Tag color={grade.color} icon={showIcon ? <StarFilled /> : undefined} title={grade.conclusion}>
        {label ?? '总分'} {value.toFixed(1)} · {grade.label}
      </Tag>
    );
  }

  if (resolved === 'ror') {
    const value = typeof ror === 'number' ? ror : 0;
    const band = rorBandOf(value);
    const icon = band === 'surge' || band === 'fast' ? <ArrowUpOutlined /> : band === 'slow' ? <ArrowDownOutlined /> : <ThunderboltOutlined />;
    return (
      <Tag color={ROR_BAND_COLOR[band]} icon={showIcon ? icon : undefined}>
        {label ?? 'RoR'} {value.toFixed(1)} ℃/min · {ROR_BAND_LABEL[band]}
      </Tag>
    );
  }

  const value = typeof devRatioPct === 'number' ? devRatioPct : 0;
  const icon =
    devBand === 'balanced' ? <CheckCircleOutlined /> : devBand === 'unknown' ? <ThunderboltOutlined /> : <CloseCircleOutlined />;
  return (
    <Tag color={DEV_BAND_COLOR[devBand]} icon={showIcon ? icon : undefined}>
      {label ?? '发展率'} {value.toFixed(1)}% · {DEV_BAND_LABEL[devBand]}
    </Tag>
  );
}

export default ScoreTag;
