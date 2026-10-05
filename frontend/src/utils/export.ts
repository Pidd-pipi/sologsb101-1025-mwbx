/**
 * 导出 / 校验工具：烘焙与杯测档案 JSON 导出、拼配方案 JSON 导入导出与结构校验。
 * 全部在浏览器本地完成（Blob + URL.createObjectURL + a.download），不经过任何服务端。
 */
import type { GreenBean } from '../types/greenbean';
import { BEAN_PROCESS_LABEL } from '../types/greenbean';
import type { RoastProfile } from '../types/roastprofile';
import { AIRFLOW_LABEL, ROAST_STATE_LABEL } from '../types/roastprofile';
import type { RoastEvent } from '../types/event';
import { EVENT_TYPE_LABEL } from '../types/event';
import type { Cupping } from '../types/cupping';
import { RATIO_TOLERANCE, isRatioValid, totalRatioPct, type Blend, type BlendDraft, type BlendState } from '../types/blend';
import { BLEND_STATE_ORDER } from '../types/blend';
import type { CurveSummary } from './curve';
import { formatSeconds } from './curve';
import { isDatabaseSnapshot, type DatabaseSnapshot } from './db';

/** 触发浏览器下载 */
function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/** 文件名时间戳片段 */
export function stampSuffix(): string {
  const date = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/** 安全取值：把 unknown 收窄成普通对象 */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/* ------------------------------ 档案导出 ------------------------------ */

/** 导出整库档案 JSON（生豆 / 烘焙记录 / 曲线事件 / 杯测 / 拼配 / 载量模板） */
export function exportArchiveJson(snapshot: DatabaseSnapshot): string {
  const filename = `gbroastlog-archive-${stampSuffix()}.json`;
  downloadText(filename, JSON.stringify(snapshot, null, 2), 'application/json;charset=utf-8');
  return filename;
}

export interface RoastCurveExportPayload {
  kind: 'roast-curve';
  exportedAt: string;
  greenBean: GreenBean | null;
  profile: RoastProfile;
  summary: {
    complete: boolean;
    missingTypes: string[];
    totalSec: number;
    totalReadable: string;
    devSec: number;
    devRatioPct: number;
    devBand: string;
    averageRor: number;
    peakRor: number;
    anomalyNotes: string[];
  };
  events: RoastEvent[];
}

/** 导出单次烘焙的曲线档案 JSON */
export function exportRoastCurveJson(
  profile: RoastProfile,
  greenBean: GreenBean | undefined,
  events: RoastEvent[],
  summary: CurveSummary,
): string {
  const payload: RoastCurveExportPayload = {
    kind: 'roast-curve',
    exportedAt: new Date().toISOString(),
    greenBean: greenBean ?? null,
    profile,
    summary: {
      complete: summary.complete,
      missingTypes: summary.missingTypes.map((type) => EVENT_TYPE_LABEL[type]),
      totalSec: summary.totalSec,
      totalReadable: formatSeconds(summary.totalSec),
      devSec: summary.devSec,
      devRatioPct: summary.devRatioPct,
      devBand: summary.devBand,
      averageRor: summary.averageRor,
      peakRor: summary.peakRor,
      anomalyNotes: summary.anomalyNotes,
    },
    events,
  };
  const filename = `烘焙曲线-${profile.machineModel}-${profile.roastedAt}-${stampSuffix()}.json`;
  downloadText(filename, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
  return filename;
}

export interface CuppingExportPayload {
  kind: 'cupping-archive';
  exportedAt: string;
  cuppings: Array<Cupping & { machineModel: string; origin: string; state: string }>;
}

/** 导出杯测档案 JSON（附带机型与产地便于复盘） */
export function exportCuppingJson(cuppings: Cupping[], profiles: RoastProfile[], beans: GreenBean[]): string {
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const beanMap = new Map(beans.map((bean) => [bean.id, bean]));
  const payload: CuppingExportPayload = {
    kind: 'cupping-archive',
    exportedAt: new Date().toISOString(),
    cuppings: cuppings.map((cupping) => {
      const profile = profileMap.get(cupping.profileId);
      const bean = profile ? beanMap.get(profile.greenBeanId) : undefined;
      return {
        ...cupping,
        machineModel: profile ? profile.machineModel : '（记录已删除）',
        origin: bean ? bean.origin : '（生豆已删除）',
        state: profile ? ROAST_STATE_LABEL[profile.state] : '未知',
      };
    }),
  };
  const filename = `杯测档案-${stampSuffix()}.json`;
  downloadText(filename, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
  return filename;
}

/** 导出单个拼配方案 JSON（含成分名称与参批次杯测均分） */
export function exportBlendPlanJson(
  blend: Blend,
  beans: GreenBean[],
  profiles: RoastProfile[],
  cuppings: Cupping[],
): string {
  const beanMap = new Map(beans.map((bean) => [bean.id, bean]));
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const payload = {
    kind: 'blend-plan',
    exportedAt: new Date().toISOString(),
    blend,
    items: blend.items.map((item) => {
      const bean = beanMap.get(item.greenBeanId);
      const profile = profileMap.get(item.profileId);
      const related = cuppings.filter((cupping) => cupping.profileId === item.profileId);
      return {
        ...item,
        origin: bean ? bean.origin : '（生豆已删除）',
        farm: bean ? bean.farm : '',
        process: bean ? BEAN_PROCESS_LABEL[bean.process] : '',
        machineModel: profile ? profile.machineModel : '（记录已删除）',
        roastedAt: profile ? profile.roastedAt : '',
        roastState: profile ? ROAST_STATE_LABEL[profile.state] : '',
        cuppingScores: related.map((cupping) => cupping.totalScore),
      };
    }),
    ratioTotal: totalRatioPct(blend.items),
    ratioValid: isRatioValid(blend.items),
  };
  const filename = `拼配方案-${blend.name}-${stampSuffix()}.json`;
  downloadText(filename, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
  return filename;
}

/* ------------------------------ 结构校验 ------------------------------ */

/** 解析并校验整库档案（校验失败抛错） */
export function parseArchiveJson(text: string): DatabaseSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('JSON 解析失败：文件内容不是合法 JSON');
  }
  if (!isDatabaseSnapshot(raw)) {
    throw new Error('档案结构不合法：缺少 greenBeans / roastProfiles / events / cuppings / blends 数组字段');
  }
  if (raw.name !== 'gbroastlog') {
    throw new Error(`档案来源不匹配：期望 gbroastlog 档案，实际为「${raw.name}」`);
  }
  return raw;
}

function pickState(value: unknown): BlendState {
  return typeof value === 'string' && (BLEND_STATE_ORDER as string[]).includes(value)
    ? (value as BlendState)
    : 'trial';
}

function pickDate(value: unknown): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

/**
 * 解析并校验单个拼配方案 JSON（校验失败抛错）。
 * 兼容两种形态：直接是方案对象，或 { blend: {...}, items: [...] } 导出包裹。
 */
export function parseBlendJson(text: string): BlendDraft {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('JSON 解析失败：文件内容不是合法 JSON');
  }
  const root = asRecord(raw);
  if (!root) throw new Error('JSON 结构不合法：根节点必须是对象');
  const wrapped = asRecord(root.blend) ?? root;

  const name = typeof wrapped.name === 'string' ? wrapped.name.trim() : '';
  if (!name) throw new Error('方案校验失败：缺少 name（方案名）');

  const rawItems = wrapped.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error('方案校验失败：items 必须是非空数组');
  }
  const items = rawItems.map((entry, index) => {
    const record = asRecord(entry);
    if (!record) throw new Error(`方案校验失败：第 ${index + 1} 项不是对象`);
    const greenBeanId = typeof record.greenBeanId === 'string' ? record.greenBeanId : '';
    const profileId = typeof record.profileId === 'string' ? record.profileId : '';
    const ratioPct = Number(record.ratioPct);
    if (!greenBeanId) throw new Error(`方案校验失败：第 ${index + 1} 项缺少 greenBeanId`);
    if (!profileId) throw new Error(`方案校验失败：第 ${index + 1} 项缺少 profileId`);
    if (!Number.isFinite(ratioPct) || ratioPct < 0 || ratioPct > 100) {
      throw new Error(`方案校验失败：第 ${index + 1} 项 ratioPct 必须在 0-100 之间`);
    }
    return { greenBeanId, profileId, ratioPct: Math.round(ratioPct * 100) / 100 };
  });

  const total = totalRatioPct(items);
  if (Math.abs(total - 100) > RATIO_TOLERANCE) {
    throw new Error(`方案校验失败：成分占比合计 ${total}%，必须等于 100%`);
  }

  const targetFlavor = typeof wrapped.targetFlavor === 'string' ? wrapped.targetFlavor.trim() : '';
  return {
    name,
    items,
    targetFlavor,
    createdAt: pickDate(wrapped.createdAt),
    state: pickState(wrapped.state),
  };
}

/** 校验文案：把异常统一转成中文提示 */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误';
}

/** 读取本地文件文本（用于导入按钮） */
export async function readFileAsText(file: File): Promise<string> {
  return file.text();
}

/** 展示用：风门 + 火力档摘要 */
export function describeMachine(profile: Pick<RoastProfile, 'machineModel' | 'airflow' | 'gasLevel'>): string {
  return `${profile.machineModel} · 风门${AIRFLOW_LABEL[profile.airflow]} · ${profile.gasLevel} 档`;
}
