/**
 * 多标签页保存冲突：差异计算与逐项合并工具（纯函数，不触碰 IndexedDB）。
 * 对比「我的待保存内容」与「对方已保存内容」，产出可逐项「保留我的 / 采用对方」的差异清单；
 * 所有差异都有选择后才能合并入库（仍有未决项不能入库）。
 */
import type { RoastEvent } from '../types/event';
import { EVENT_TYPE_LABEL } from '../types/event';
import type { RoastProfile, RoastProfileDraft } from '../types/roastprofile';
import { AIRFLOW_LABEL, ROAST_STATE_LABEL } from '../types/roastprofile';
import { formatSeconds } from './curve';

/** 冲突选择：保留我的 / 采用对方 */
export type ConflictChoice = 'mine' | 'theirs';

/** 页面侧的「我的待保存内容」：记录字段草稿 + 期望的完整曲线节点列表 */
export interface MineSnapshot {
  profile: RoastProfileDraft;
  events: RoastEvent[];
}

/** 把完整记录收敛为可编辑草稿（剥离 id / 版本 / 时间戳） */
export function toProfileDraft(profile: RoastProfile): RoastProfileDraft {
  return {
    greenBeanId: profile.greenBeanId,
    machineModel: profile.machineModel,
    chargeG: profile.chargeG,
    chargeTempC: profile.chargeTempC,
    airflow: profile.airflow,
    gasLevel: profile.gasLevel,
    roastedAt: profile.roastedAt,
    state: profile.state,
  };
}

/* ------------------------------ 记录字段差异 ------------------------------ */

/** 参与版本比对的记录字段（含载量与记录状态） */
export const PROFILE_DIFF_FIELDS: Array<{ key: keyof RoastProfileDraft; label: string }> = [
  { key: 'greenBeanId', label: '关联生豆' },
  { key: 'machineModel', label: '机型号' },
  { key: 'chargeG', label: '载量' },
  { key: 'chargeTempC', label: '入豆温' },
  { key: 'airflow', label: '风门' },
  { key: 'gasLevel', label: '火力档' },
  { key: 'roastedAt', label: '烘焙日期' },
  { key: 'state', label: '记录状态' },
];

export interface ProfileFieldDiff {
  key: keyof RoastProfileDraft;
  label: string;
  /** 我的待保存值（展示用） */
  mine: string;
  /** 对方已保存值（展示用） */
  theirs: string;
}

/** 字段值 → 展示文案（生豆 id 经 beanName 转成可读名称） */
export function formatProfileField(
  key: keyof RoastProfileDraft,
  value: RoastProfileDraft[keyof RoastProfileDraft],
  beanName: (greenBeanId: string) => string,
): string {
  switch (key) {
    case 'greenBeanId':
      return beanName(String(value));
    case 'chargeG':
      return `${value} g`;
    case 'chargeTempC':
      return `${value} ℃`;
    case 'airflow':
      return `风门${AIRFLOW_LABEL[value as RoastProfile['airflow']]}`;
    case 'gasLevel':
      return `${value} 档`;
    case 'state':
      return ROAST_STATE_LABEL[value as RoastProfile['state']];
    default:
      return String(value);
  }
}

/** 逐字段比对，只返回双方不一致的项 */
export function diffProfileFields(
  mine: RoastProfileDraft,
  theirs: RoastProfileDraft,
  beanName: (greenBeanId: string) => string,
): ProfileFieldDiff[] {
  return PROFILE_DIFF_FIELDS.filter(({ key }) => mine[key] !== theirs[key]).map(({ key, label }) => ({
    key,
    label,
    mine: formatProfileField(key, mine[key], beanName),
    theirs: formatProfileField(key, theirs[key], beanName),
  }));
}

/* ------------------------------ 曲线节点差异 ------------------------------ */

export type EventDiffItem =
  | { kind: 'changed'; id: string; mine: RoastEvent; theirs: RoastEvent }
  | { kind: 'mine-only'; id: string; mine: RoastEvent }
  | { kind: 'theirs-only'; id: string; theirs: RoastEvent };

/** 节点业务内容是否一致（忽略 id 与时间戳） */
export function sameEventContent(a: RoastEvent, b: RoastEvent): boolean {
  return (
    a.type === b.type &&
    a.atSec === b.atSec &&
    a.beanTempC === b.beanTempC &&
    a.rorPerMin === b.rorPerMin &&
    a.note === b.note
  );
}

/** 节点摘要文案：类型 + 秒点 + 豆温 + RoR + 备注 */
export function describeEvent(event: RoastEvent): string {
  const note = event.note.trim();
  return `${EVENT_TYPE_LABEL[event.type]} @ ${formatSeconds(event.atSec)}（${event.atSec}s）· ${event.beanTempC}℃ · RoR ${event.rorPerMin}℃/min${note ? ` · ${note}` : ''}`;
}

/**
 * 逐节点比对（按 id 对齐，按时间轴顺序输出）：
 * - changed：双方都有但内容不同
 * - mine-only：只有我有（我新增 / 对方已删）
 * - theirs-only：只有对方有（对方新增 / 我已删）
 */
export function diffEvents(mine: RoastEvent[], theirs: RoastEvent[]): EventDiffItem[] {
  const mineById = new Map(mine.map((event) => [event.id, event]));
  const theirsById = new Map(theirs.map((event) => [event.id, event]));
  const orderedIds = [...new Set([...mineById.keys(), ...theirsById.keys()])]
    .map((id) => mineById.get(id) ?? theirsById.get(id))
    .filter((event): event is RoastEvent => event !== undefined)
    .sort((a, b) => a.atSec - b.atSec)
    .map((event) => event.id);

  const diffs: EventDiffItem[] = [];
  for (const id of orderedIds) {
    const mineEvent = mineById.get(id);
    const theirsEvent = theirsById.get(id);
    if (mineEvent && theirsEvent) {
      if (!sameEventContent(mineEvent, theirsEvent)) {
        diffs.push({ kind: 'changed', id, mine: mineEvent, theirs: theirsEvent });
      }
    } else if (mineEvent) {
      diffs.push({ kind: 'mine-only', id, mine: mineEvent });
    } else if (theirsEvent) {
      diffs.push({ kind: 'theirs-only', id, theirs: theirsEvent });
    }
  }
  return diffs;
}

/* ------------------------------ 逐项合并 ------------------------------ */

export const fieldChoiceKey = (key: keyof RoastProfileDraft): string => `field:${key}`;
export const eventChoiceKey = (id: string): string => `event:${id}`;

/** 字段赋值（泛型关联 key 与 value 类型，避免索引写入收窄为 never） */
function assignField<K extends keyof RoastProfileDraft>(
  target: RoastProfileDraft,
  key: K,
  value: RoastProfileDraft[K],
): void {
  target[key] = value;
}

/** 按逐项选择合并记录字段：未选择的字段保留我的（调用方保证所有差异项都已选择） */
export function mergeProfileFields(
  mine: RoastProfileDraft,
  theirs: RoastProfileDraft,
  choices: Record<string, ConflictChoice>,
): RoastProfileDraft {
  const merged = { ...mine };
  for (const { key } of PROFILE_DIFF_FIELDS) {
    if (mine[key] !== theirs[key] && choices[fieldChoiceKey(key)] === 'theirs') {
      assignField(merged, key, theirs[key]);
    }
  }
  return merged;
}

/** 按逐项选择合并曲线节点：输出按时间升序的完整节点列表 */
export function mergeEvents(
  mine: RoastEvent[],
  theirs: RoastEvent[],
  choices: Record<string, ConflictChoice>,
): RoastEvent[] {
  const theirsById = new Map(theirs.map((event) => [event.id, event]));
  const merged: RoastEvent[] = [];
  for (const event of mine) {
    const remote = theirsById.get(event.id);
    if (!remote) {
      // 只有我有：保留我的 = 留下；采用对方 = 放弃该节点
      if (choices[eventChoiceKey(event.id)] !== 'theirs') merged.push(event);
    } else if (!sameEventContent(event, remote)) {
      merged.push(choices[eventChoiceKey(event.id)] === 'theirs' ? remote : event);
    } else {
      merged.push(event);
    }
  }
  const mineIds = new Set(mine.map((event) => event.id));
  for (const event of theirs) {
    // 只有对方有：采用对方 = 留下；保留我的 = 不写入
    if (!mineIds.has(event.id) && choices[eventChoiceKey(event.id)] === 'theirs') {
      merged.push(event);
    }
  }
  return merged.sort((a, b) => a.atSec - b.atSec);
}
