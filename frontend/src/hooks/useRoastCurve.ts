/**
 * useRoastCurve(profileId)
 * 派生某次烘焙的关键节点、发展时间占比与分段 RoR 序列，并给出缺节点补录建议。
 * 被曲线页（/curves）与发展率页（/development）消费；底层用 useIdbTable 订阅 events 表。
 */
import { useCallback, useMemo } from 'react';
import type { RoastEvent, RoastEventType } from '../types/event';
import { EVENT_TYPE_LABEL } from '../types/event';
import { computeCurve, formatSeconds, suggestEventTime, suggestTempC, type CurveSummary } from '../utils/curve';
import { useIdbTable } from './useIdbTable';

export interface MissingNodeSuggestion {
  type: RoastEventType;
  label: string;
  /** 建议秒点 */
  atSec: number;
  /** 建议豆温 */
  beanTempC: number;
  /** 展示文案 */
  text: string;
}

export interface UseRoastCurveResult extends CurveSummary {
  /** 当前烘焙记录的曲线事件（按时间升序） */
  events: RoastEvent[];
  loading: boolean;
  ready: boolean;
  error: string;
  refresh: () => Promise<void>;
  hasEvent: (type: RoastEventType) => boolean;
  /** 缺关键节点时的补录建议 */
  suggestions: MissingNodeSuggestion[];
  /** 总烘焙时间 mm:ss */
  totalReadable: string;
  /** 发展时间 mm:ss */
  devReadable: string;
}

export function useRoastCurve(profileId: string | null | undefined): UseRoastCurveResult {
  const { rows, loading, ready, error, refresh } = useIdbTable<RoastEvent>('events', {
    enabled: Boolean(profileId),
    sortBy: 'atSec',
  });

  const events = useMemo(
    () => (profileId ? rows.filter((row) => row.profileId === profileId) : []),
    [rows, profileId],
  );

  const summary = useMemo(() => computeCurve(events), [events]);

  const suggestions = useMemo<MissingNodeSuggestion[]>(
    () =>
      summary.missingTypes.map((type) => {
        const atSec = suggestEventTime(events, type);
        return {
          type,
          label: EVENT_TYPE_LABEL[type],
          atSec,
          beanTempC: suggestTempC(events, type),
          text: `补录「${EVENT_TYPE_LABEL[type]}」，建议 ${formatSeconds(atSec)} / ${suggestTempC(events, type)}℃`,
        };
      }),
    [summary.missingTypes, events],
  );

  const hasEvent = useCallback((type: RoastEventType) => events.some((event) => event.type === type), [events]);

  return {
    ...summary,
    events,
    loading,
    ready,
    error,
    refresh,
    hasEvent,
    suggestions,
    totalReadable: formatSeconds(summary.totalSec),
    devReadable: formatSeconds(summary.devSec),
  };
}

export default useRoastCurve;
