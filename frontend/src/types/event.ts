/**
 * Event 曲线事件 · 回温 / 脱水结束 / 一爆 / 二爆 / 下豆
 * 动作：按时间升序排列，缺关键节点时提示补录。
 * 说明：为避免与 DOM 的全局 Event 类型冲突，主体接口命名 RoastEvent，并导出别名 Event。
 */
export type RoastEventType = 'turning' | 'dryEnd' | 'firstCrack' | 'secondCrack' | 'drop';

export interface RoastEvent {
  id: string;
  /** 关联烘焙记录 */
  profileId: string;
  /** 节点类型 */
  type: RoastEventType;
  /** 时间（秒，以入豆为 0 秒） */
  atSec: number;
  /** 豆温（℃） */
  beanTempC: number;
  /** 升温速率（℃/min） */
  rorPerMin: number;
  /** 备注 */
  note: string;
  createdAt: string;
  updatedAt: string;
}

/** 数据模型别名：Event 曲线事件 */
export type Event = RoastEvent;

export type RoastEventDraft = Omit<RoastEvent, 'id' | 'createdAt' | 'updatedAt'>;

export const EVENT_TYPE_LABEL: Record<RoastEventType, string> = {
  turning: '回温',
  dryEnd: '脱水结束',
  firstCrack: '一爆',
  secondCrack: '二爆',
  drop: '下豆',
};

export const EVENT_TYPE_COLOR: Record<RoastEventType, string> = {
  turning: '#3b7ea1',
  dryEnd: '#7a9e5b',
  firstCrack: '#c9963c',
  secondCrack: '#a8632c',
  drop: '#b3372f',
};

/** 时间轴上的标准顺序 */
export const EVENT_TYPE_ORDER: RoastEventType[] = ['turning', 'dryEnd', 'firstCrack', 'secondCrack', 'drop'];

export const EVENT_TYPE_OPTIONS = EVENT_TYPE_ORDER.map((value) => ({
  value,
  label: EVENT_TYPE_LABEL[value],
}));

/** 必须补录的关键节点（缺一即在曲线页提示补录） */
export const REQUIRED_EVENT_TYPES: RoastEventType[] = [...EVENT_TYPE_ORDER];

export function isKeyEventType(type: RoastEventType): boolean {
  return REQUIRED_EVENT_TYPES.includes(type);
}

/** 节点在标准时间轴上的序号，用于「补录建议时间」与顺序校验 */
export function eventTypeIndex(type: RoastEventType): number {
  return EVENT_TYPE_ORDER.indexOf(type);
}
