/**
 * 曲线计算工具：时间秒与温升插值、发展率与发展时间占比、分段 RoR 与分档取值。
 * 被 useRoastCurve（曲线页、发展率页）与 Dexie 结构迁移共同消费。
 */
import type { RoastEvent, RoastEventType } from '../types/event';
import { EVENT_TYPE_LABEL, EVENT_TYPE_ORDER, REQUIRED_EVENT_TYPES } from '../types/event';

/* ------------------------------ RoR 分档 ------------------------------ */

export type RorBand = 'slow' | 'steady' | 'ideal' | 'fast' | 'surge';

export const ROR_BAND_LABEL: Record<RorBand, string> = {
  slow: '过缓',
  steady: '偏缓',
  ideal: '理想',
  fast: '偏快',
  surge: '过快',
};

export const ROR_BAND_COLOR: Record<RorBand, string> = {
  slow: '#3b7ea1',
  steady: '#7a9e5b',
  ideal: '#2f6f4f',
  fast: '#d48806',
  surge: '#b3372f',
};

export const ROR_BAND_RANGE: Record<RorBand, string> = {
  slow: '< 5 ℃/min',
  steady: '5 - 8 ℃/min',
  ideal: '8 - 12 ℃/min',
  fast: '12 - 16 ℃/min',
  surge: '> 16 ℃/min',
};

/** 升温速率分档：脱水期以 8-12 ℃/min 为理想区间 */
export function rorBandOf(ror: number): RorBand {
  if (!Number.isFinite(ror) || ror < 5) return 'slow';
  if (ror < 8) return 'steady';
  if (ror <= 12) return 'ideal';
  if (ror <= 16) return 'fast';
  return 'surge';
}

/* --------------------------- 发展时间占比分档 --------------------------- */

export type DevBand = 'short' | 'balanced' | 'long' | 'unknown';

export const DEV_BAND_LABEL: Record<DevBand, string> = {
  short: '发展不足',
  balanced: '发展合理',
  long: '发展偏长',
  unknown: '待补录',
};

export const DEV_BAND_COLOR: Record<DevBand, string> = {
  short: '#d48806',
  balanced: '#2f6f4f',
  long: '#b3372f',
  unknown: '#8c8c8c',
};

/** 发展时间占比分档：15% - 25% 为常见合理区间 */
export function devRatioBandOf(devRatioPct: number, hasNodes: boolean): DevBand {
  if (!hasNodes) return 'unknown';
  if (devRatioPct < 15) return 'short';
  if (devRatioPct > 25) return 'long';
  return 'balanced';
}

/* ------------------------------- 基础计算 ------------------------------- */

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 按时间升序排列（不修改入参） */
export function sortEventsByTime(events: RoastEvent[]): RoastEvent[] {
  return [...events].sort((a, b) => a.atSec - b.atSec);
}

/** 两节点之间的升温速率（℃/min），异常情况返回 0 */
export function rorPerMinBetween(fromSec: number, fromTempC: number, toSec: number, toTempC: number): number {
  const seconds = toSec - fromSec;
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return round1((toTempC - fromTempC) / (seconds / 60));
}

/** 连续两节点之间的 RoR */
export function segmentRorOf(prev: RoastEvent, next: RoastEvent): number {
  return rorPerMinBetween(prev.atSec, prev.beanTempC, next.atSec, next.beanTempC);
}

/** 时间秒 → mm:ss */
export function formatSeconds(atSec: number): string {
  const safe = Math.max(0, Math.round(atSec));
  const minute = Math.floor(safe / 60);
  const second = safe % 60;
  return `${minute}:${String(second).padStart(2, '0')}`;
}

/** 任意秒点的豆温插值：两点线性插值，区间外取端点值 */
export function interpolateTempC(events: RoastEvent[], atSec: number): number {
  const sorted = sortEventsByTime(events);
  if (sorted.length === 0) return 0;
  if (atSec <= sorted[0].atSec) return sorted[0].beanTempC;
  const last = sorted[sorted.length - 1];
  if (atSec >= last.atSec) return last.beanTempC;
  for (let index = 1; index < sorted.length; index += 1) {
    const prev = sorted[index - 1];
    const next = sorted[index];
    if (atSec <= next.atSec) {
      const span = next.atSec - prev.atSec;
      if (span <= 0) return next.beanTempC;
      const ratio = (atSec - prev.atSec) / span;
      return round1(prev.beanTempC + (next.beanTempC - prev.beanTempC) * ratio);
    }
  }
  return last.beanTempC;
}

/** 取某类节点的秒点，不存在返回 null */
export function eventSecOf(events: RoastEvent[], type: RoastEventType): number | null {
  const found = events.find((event) => event.type === type);
  return found ? found.atSec : null;
}

/* ------------------------------- 分段 RoR ------------------------------- */

export interface SegmentRor {
  fromType: RoastEventType;
  toType: RoastEventType;
  fromLabel: string;
  toLabel: string;
  startSec: number;
  endSec: number;
  seconds: number;
  fromTempC: number;
  toTempC: number;
  deltaTempC: number;
  rorPerMin: number;
  band: RorBand;
}

/** 分段 RoR 序列（相邻关键节点） */
export function segmentRorSeries(events: RoastEvent[]): SegmentRor[] {
  const sorted = sortEventsByTime(events);
  const segments: SegmentRor[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const prev = sorted[index - 1];
    const next = sorted[index];
    const seconds = next.atSec - prev.atSec;
    const rorPerMin = segmentRorOf(prev, next);
    segments.push({
      fromType: prev.type,
      toType: next.type,
      fromLabel: EVENT_TYPE_LABEL[prev.type],
      toLabel: EVENT_TYPE_LABEL[next.type],
      startSec: prev.atSec,
      endSec: next.atSec,
      seconds,
      fromTempC: prev.beanTempC,
      toTempC: next.beanTempC,
      deltaTempC: round1(next.beanTempC - prev.beanTempC),
      rorPerMin,
      band: rorBandOf(rorPerMin),
    });
  }
  return segments;
}

/* ------------------------------ 缺节点检测 ------------------------------ */

/** 缺少的关键节点类型 */
export function missingKeyEventTypes(events: RoastEvent[]): RoastEventType[] {
  const present = new Set(events.map((event) => event.type));
  return REQUIRED_EVENT_TYPES.filter((type) => !present.has(type));
}

/* ------------------------------ 曲线概览 ------------------------------ */

export interface KeyNode {
  type: RoastEventType;
  label: string;
  atSec: number;
  beanTempC: number;
  rorPerMin: number;
  note: string;
}

export interface CurveSummary {
  /** 关键节点（按时间升序） */
  keyNodes: KeyNode[];
  /** 缺少的关键节点 */
  missingTypes: RoastEventType[];
  /** 关键节点是否齐全 */
  complete: boolean;
  /** 分段 RoR */
  segments: SegmentRor[];
  /** 总烘焙时间（秒，入豆 0 秒 → 下豆） */
  totalSec: number;
  /** 脱水结束秒点 */
  dryEndSec: number | null;
  /** 一爆秒点 */
  firstCrackSec: number | null;
  /** 下豆秒点 */
  dropSec: number | null;
  /** 脱水期占比 % */
  dryRatioPct: number;
  /** 发展时间（秒，一爆 → 下豆） */
  devSec: number;
  /** 发展时间占比 % */
  devRatioPct: number;
  /** 发展率分档 */
  devBand: DevBand;
  /** 全程平均 RoR */
  averageRor: number;
  /** 峰值 RoR */
  peakRor: number;
  /** 异常提示 */
  anomalyNotes: string[];
}

/** 汇总一次烘焙的曲线指标与异常提示 */
export function computeCurve(input: RoastEvent[]): CurveSummary {
  const sorted = sortEventsByTime(input);
  const missingTypes = missingKeyEventTypes(sorted);
  const segments = segmentRorSeries(sorted);
  const dryEndSec = eventSecOf(sorted, 'dryEnd');
  const firstCrackSec = eventSecOf(sorted, 'firstCrack');
  const drop = eventSecOf(sorted, 'drop');
  const lastSec = sorted.length > 0 ? sorted[sorted.length - 1].atSec : 0;
  const totalSec = drop ?? lastSec;
  const devSec = firstCrackSec !== null && drop !== null && drop > firstCrackSec ? drop - firstCrackSec : 0;
  const devRatioPct = totalSec > 0 && devSec > 0 ? round1((devSec / totalSec) * 100) : 0;
  const hasDevNodes = firstCrackSec !== null && drop !== null;
  const dryRatioPct = dryEndSec !== null && totalSec > 0 ? round1((dryEndSec / totalSec) * 100) : 0;
  const averageRor =
    sorted.length >= 2 && lastSec > sorted[0].atSec
      ? rorPerMinBetween(sorted[0].atSec, sorted[0].beanTempC, lastSec, sorted[sorted.length - 1].beanTempC)
      : 0;
  const peakRor = segments.reduce((acc, segment) => Math.max(acc, segment.rorPerMin), 0);

  const anomalyNotes: string[] = [];
  if (sorted.length === 0) {
    anomalyNotes.push('尚未录入任何曲线事件，先在 /curves 补录回温、脱水结束、一爆、二爆、下豆节点。');
  }
  if (missingTypes.length > 0) {
    anomalyNotes.push(`缺少关键节点：${missingTypes.map((type) => EVENT_TYPE_LABEL[type]).join('、')}，请在曲线页补录。`);
  }
  if (drop === null && sorted.length > 0) {
    anomalyNotes.push('尚未记录下豆节点，总烘焙时间与发展率暂时无法核算。');
  }
  if (firstCrackSec === null && sorted.length > 0) {
    anomalyNotes.push('尚未记录一爆节点，发展时间占比无法核算。');
  }
  if (hasDevNodes && devRatioPct > 0) {
    if (devRatioPct < 15) anomalyNotes.push(`发展时间占比 ${devRatioPct}%，低于 15%，易出现青草与涩感，建议延长发展期。`);
    if (devRatioPct > 25) anomalyNotes.push(`发展时间占比 ${devRatioPct}%，高于 25%，甜感可能被磨平，建议提前下豆。`);
  }
  if (dryEndSec !== null && totalSec > 0 && dryRatioPct > 55) {
    anomalyNotes.push(`脱水期占比 ${dryRatioPct}%，高于 55%，建议提高入豆温或加大初期火力。`);
  }
  const duplicated = EVENT_TYPE_ORDER.filter(
    (type) => sorted.filter((event) => event.type === type).length > 1,
  );
  if (duplicated.length > 0) {
    anomalyNotes.push(`存在重复节点：${duplicated.map((type) => EVENT_TYPE_LABEL[type]).join('、')}，请确认时间轴顺序。`);
  }
  segments.forEach((segment) => {
    if (segment.rorPerMin > 25) {
      anomalyNotes.push(`${segment.fromLabel}→${segment.toLabel} 段 RoR ${segment.rorPerMin} ℃/min 过高，易焦糊与烟熏。`);
    }
    if (segment.rorPerMin > 0 && segment.rorPerMin < 4 && segment.toType === 'firstCrack') {
      anomalyNotes.push(`${segment.fromLabel}→${segment.toLabel} 段 RoR ${segment.rorPerMin} ℃/min 偏低，烘焙趋于停滞（烤焙风险）。`);
    }
  });
  if (firstCrackSec !== null) {
    const afterCrack = segments.filter((segment) => segment.startSec >= firstCrackSec);
    for (let index = 1; index < afterCrack.length; index += 1) {
      if (afterCrack[index].rorPerMin > afterCrack[index - 1].rorPerMin * 1.25 && afterCrack[index].rorPerMin > 6) {
        anomalyNotes.push(
          `一爆后升温反弹（${afterCrack[index - 1].rorPerMin} → ${afterCrack[index].rorPerMin} ℃/min），注意回调火力与加大排风。`,
        );
      }
    }
  }
  if (totalSec > 0 && totalSec < 360) {
    anomalyNotes.push(`总烘焙时间 ${formatSeconds(totalSec)} 偏短（< 6:00），建议放慢脱水期。`);
  }

  return {
    keyNodes: sorted.map((event) => ({
      type: event.type,
      label: EVENT_TYPE_LABEL[event.type],
      atSec: event.atSec,
      beanTempC: event.beanTempC,
      rorPerMin: event.rorPerMin,
      note: event.note,
    })),
    missingTypes,
    complete: missingTypes.length === 0 && sorted.length > 0,
    segments,
    totalSec,
    dryEndSec,
    firstCrackSec,
    dropSec: drop,
    dryRatioPct,
    devSec,
    devRatioPct,
    devBand: devRatioBandOf(devRatioPct, hasDevNodes),
    averageRor,
    peakRor,
    anomalyNotes,
  };
}

/* ------------------------------ 录入辅助 ------------------------------ */

/** 各节点的经验时间模板（秒） */
const EVENT_TIME_PRESET: Record<RoastEventType, number> = {
  turning: 90,
  dryEnd: 300,
  firstCrack: 480,
  secondCrack: 660,
  drop: 720,
};

/** 补录建议秒点：已有下豆时间时按比例缩放经验模板 */
export function suggestEventTime(events: RoastEvent[], type: RoastEventType): number {
  const existing = events.find((event) => event.type === type);
  if (existing) return existing.atSec;
  const sorted = sortEventsByTime(events);
  const drop = sorted.find((event) => event.type === 'drop');
  const scale = drop ? drop.atSec / EVENT_TIME_PRESET.drop : 1;
  const safeScale = Number.isFinite(scale) && scale > 0.4 && scale < 2.5 ? scale : 1;
  return Math.max(30, Math.round(EVENT_TIME_PRESET[type] * safeScale));
}

/** 依据前一节点推算建议 RoR */
export function suggestRorPerMin(events: RoastEvent[], atSec: number, beanTempC: number): number {
  const previous = sortEventsByTime(events)
    .filter((event) => event.atSec < atSec)
    .pop();
  if (!previous) return 0;
  return rorPerMinBetween(previous.atSec, previous.beanTempC, atSec, beanTempC);
}

/** 依据标准顺序推算建议豆温（用于补录表单的默认值） */
export function suggestTempC(events: RoastEvent[], type: RoastEventType): number {
  const atSec = suggestEventTime(events, type);
  const interpolated = interpolateTempC(events, atSec);
  if (interpolated > 0) return interpolated;
  const fallback: Record<RoastEventType, number> = {
    turning: 118,
    dryEnd: 150,
    firstCrack: 196,
    secondCrack: 212,
    drop: 218,
  };
  return fallback[type];
}

/**
 * 拖拽排序后重排 atSec：保留原有时间集合，按新顺序逐个映射。
 * 这样时间轴顺序与 atSec 升序始终一致，可直接写回 Dexie。
 */
export function reassignAtSecByOrder(ordered: RoastEvent[]): RoastEvent[] {
  const times = ordered.map((event) => event.atSec).sort((a, b) => a - b);
  return ordered.map((event, index) => ({ ...event, atSec: times[index] }));
}
