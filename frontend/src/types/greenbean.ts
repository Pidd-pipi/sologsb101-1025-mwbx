/**
 * GreenBean 生豆 · 产地与在库档案
 * 动作：烘焙下豆后按载量自动扣减「在库重量 stockKg」并给出余量提醒。
 */
export type BeanProcess = 'washed' | 'natural' | 'honey' | 'anaerobic';

export interface GreenBean {
  id: string;
  /** 产地（国家/产区） */
  origin: string;
  /** 庄园 / 处理厂 */
  farm: string;
  /** 处理法：水洗 / 日晒 / 蜜处理 / 厌氧 */
  process: BeanProcess;
  /** 海拔（米） */
  altitudeM: number;
  /** 含水率（%） */
  moisturePct: number;
  /** 在库重量（kg） */
  stockKg: number;
  /** 到货日期（YYYY-MM-DD） */
  arrivedAt: string;
  createdAt: string;
  updatedAt: string;
}

/** 新建/编辑生豆时的表单草稿 */
export type GreenBeanDraft = Omit<GreenBean, 'id' | 'createdAt' | 'updatedAt'>;

export const BEAN_PROCESS_LABEL: Record<BeanProcess, string> = {
  washed: '水洗',
  natural: '日晒',
  honey: '蜜处理',
  anaerobic: '厌氧',
};

export const BEAN_PROCESS_COLOR: Record<BeanProcess, string> = {
  washed: '#3b7ea1',
  natural: '#c9963c',
  honey: '#a8632c',
  anaerobic: '#7a4b8f',
};

export const BEAN_PROCESS_ORDER: BeanProcess[] = ['washed', 'natural', 'honey', 'anaerobic'];

export const BEAN_PROCESS_OPTIONS = BEAN_PROCESS_ORDER.map((value) => ({
  value,
  label: BEAN_PROCESS_LABEL[value],
}));

/** 常用产地候选（FilterBar 与表单下拉复用） */
export const ORIGIN_OPTIONS = [
  '埃塞俄比亚 耶加雪菲',
  '埃塞俄比亚 古吉',
  '哥伦比亚 惠兰',
  '肯尼亚 涅里',
  '巴西 喜拉多',
  '危地马拉 安提瓜',
  '哥斯达黎加 塔拉珠',
  '云南 保山',
  '印尼 曼特宁',
];

/** 在库余量警戒线（kg）：低于此值页面给出补货提醒 */
export const LOW_STOCK_KG = 2;

/** 余量分档，供标签与提醒复用 */
export function stockLevelOf(stockKg: number): 'empty' | 'low' | 'ok' {
  if (stockKg <= 0) return 'empty';
  if (stockKg < LOW_STOCK_KG) return 'low';
  return 'ok';
}

export const STOCK_LEVEL_LABEL: Record<'empty' | 'low' | 'ok', string> = {
  empty: '已耗尽',
  low: '余量偏低',
  ok: '余量充足',
};

export const STOCK_LEVEL_COLOR: Record<'empty' | 'low' | 'ok', string> = {
  empty: '#b3372f',
  low: '#d48806',
  ok: '#2f6f4f',
};
