/**
 * Blend 拼配方案 · 配方明细（生豆 / 烘焙记录 / 占比%）
 * 动作：校验各成分占比合计 100%，并回显参与批次杯测均分。
 */
export interface BlendItem {
  /** 生豆 id */
  greenBeanId: string;
  /** 烘焙记录 id */
  profileId: string;
  /** 占比 % */
  ratioPct: number;
}

export type BlendState = 'trial' | 'final' | 'retired';

export interface Blend {
  id: string;
  /** 方案名 */
  name: string;
  /** 配方明细 */
  items: BlendItem[];
  /** 目标风味（多个用「、」连接） */
  targetFlavor: string;
  /** 创建日期（YYYY-MM-DD） */
  createdAt: string;
  /** 状态：试配 / 定版 / 停用 */
  state: BlendState;
  updatedAt: string;
}

export type BlendDraft = Omit<Blend, 'id' | 'updatedAt'>;

export const BLEND_STATE_LABEL: Record<BlendState, string> = {
  trial: '试配',
  final: '定版',
  retired: '停用',
};

export const BLEND_STATE_COLOR: Record<BlendState, string> = {
  trial: '#c9963c',
  final: '#2f6f4f',
  retired: '#8c8c8c',
};

export const BLEND_STATE_ORDER: BlendState[] = ['trial', 'final', 'retired'];

export const BLEND_STATE_OPTIONS = BLEND_STATE_ORDER.map((value) => ({
  value,
  label: BLEND_STATE_LABEL[value],
}));

/** 状态流转：试配 → 定版 → 停用；停用可回到试配 */
export const BLEND_STATE_FLOW: Record<BlendState, BlendState[]> = {
  trial: ['final', 'retired'],
  final: ['retired', 'trial'],
  retired: ['trial'],
};

export const TARGET_FLAVOR_OPTIONS = [
  '花香',
  '柑橘果酸',
  '莓果',
  '坚果可可',
  '焦糖甜感',
  '酒香发酵',
  '香料',
  '均衡醇厚',
];

export const RATIO_TOLERANCE = 0.01;

/** 占比合计（保留 2 位小数） */
export function totalRatioPct(items: BlendItem[]): number {
  const sum = items.reduce((acc, item) => acc + (Number.isFinite(item.ratioPct) ? item.ratioPct : 0), 0);
  return Math.round(sum * 100) / 100;
}

export function isRatioValid(items: BlendItem[]): boolean {
  if (items.length === 0) return false;
  return Math.abs(totalRatioPct(items) - 100) <= RATIO_TOLERANCE;
}

/** 占比校验文案：供表单校验与表格标签复用 */
export function ratioMessage(items: BlendItem[]): string {
  if (items.length === 0) return '至少需要一项配方成分';
  const total = totalRatioPct(items);
  if (isRatioValid(items)) return `占比合计 100%，校验通过`;
  return total > 100 ? `占比合计 ${total}%，超出 ${Math.round((total - 100) * 100) / 100}%` : `占比合计 ${total}%，还差 ${Math.round((100 - total) * 100) / 100}%`;
}

/** 空白配方行 */
export function createEmptyBlendItem(): BlendItem {
  return { greenBeanId: '', profileId: '', ratioPct: 0 };
}

/** 目标风味字符串 ↔ 多选数组 */
export function splitFlavors(targetFlavor: string): string[] {
  return targetFlavor
    .split('、')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function joinFlavors(flavors: string[]): string {
  return flavors.map((item) => item.trim()).filter(Boolean).join('、');
}
