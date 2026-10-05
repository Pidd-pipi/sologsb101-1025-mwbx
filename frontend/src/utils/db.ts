/**
 * IndexedDB 持久化层（Dexie 封装）
 * - 数据库名 gbroastlog，数据结构版本号 DB_VERSION = 3（version(1) 初版 + version(2) 字段迁移 + version(3) 编辑版本号）
 * - 生豆 / 烘焙记录 / 曲线事件 / 杯测 / 拼配方案 分表存储（另有载量模板表）
 * - 首屏自动播种演示数据（父→子→孙三层贯通，幂等）
 * - 整库快照导出导入、级联删除、下豆扣减生豆在库重量
 * - 多标签页乐观并发：烘焙记录带 version，保存前比对，冲突时返回对方快照由页面逐项合并；
 *   下豆（节点 + 状态 + 库存）在同一事务写入，同一锅只会扣一次库存。
 * 纯前端应用：不依赖任何后端或数据库服务。
 */
import Dexie, { type Table } from 'dexie';
import type { GreenBean } from '../types/greenbean';
import { LOW_STOCK_KG } from '../types/greenbean';
import type { MachineTemplate, RoastProfile, RoastProfileDraft, RoastState } from '../types/roastprofile';
import { ROAST_STATE_LABEL } from '../types/roastprofile';
import type { RoastEvent, RoastEventDraft } from '../types/event';
import type { Cupping } from '../types/cupping';
import { weightedTotalScore } from '../types/cupping';
import type { Blend } from '../types/blend';
import { rorPerMinBetween } from './curve';

/** 数据库名（= 项目英文短名） */
export const DB_NAME = 'gbroastlog';

/** 当前数据结构版本号（每次调整字段结构必须 +1 并补迁移） */
export const DB_VERSION = 3;

class RoastLogDatabase extends Dexie {
  greenBeans!: Table<GreenBean, string>;
  roastProfiles!: Table<RoastProfile, string>;
  events!: Table<RoastEvent, string>;
  cuppings!: Table<Cupping, string>;
  blends!: Table<Blend, string>;
  machineTemplates!: Table<MachineTemplate, string>;

  constructor() {
    super(DB_NAME);

    // v1：初版结构（仅业务字段，保留历史数据）
    this.version(1).stores({
      greenBeans: 'id, origin, process, arrivedAt, createdAt',
      roastProfiles: 'id, greenBeanId, machineModel, roastedAt, state',
      events: 'id, profileId, type, atSec',
      cuppings: 'id, profileId, cuppedAt',
      blends: 'id, name, state, createdAt',
    });

    // v2：补齐 createdAt/updatedAt 索引；新增载量模板表；按时间顺序补算历史 RoR 与杯测总分
    this.version(2)
      .stores({
        greenBeans: 'id, origin, process, arrivedAt, createdAt, updatedAt',
        roastProfiles: 'id, greenBeanId, machineModel, roastedAt, state, updatedAt',
        events: 'id, profileId, type, atSec, createdAt, updatedAt',
        cuppings: 'id, profileId, cuppedAt, totalScore, updatedAt',
        blends: 'id, name, state, createdAt, updatedAt',
        machineTemplates: 'id, model, chargeG, gasLevel',
      })
      .upgrade(async (tx) => {
        const stamp = nowIso();

        // 1) 全部表补齐 createdAt / updatedAt（v1 只写了业务字段）
        const tables: Array<Table<Record<string, unknown>, string>> = [
          tx.table('greenBeans'),
          tx.table('roastProfiles'),
          tx.table('events'),
          tx.table('cuppings'),
          tx.table('blends'),
        ];
        for (const table of tables) {
          await table.toCollection().modify((row: Record<string, unknown>) => {
            if (typeof row.createdAt !== 'string' || row.createdAt === '') row.createdAt = stamp;
            if (typeof row.updatedAt !== 'string' || row.updatedAt === '') row.updatedAt = row.createdAt;
          });
        }

        // 2) 生豆：兜底处理法、含水率与在库重量
        await tx.table('greenBeans').toCollection().modify((row: Record<string, unknown>) => {
          if (typeof row.process !== 'string') row.process = 'washed';
          if (typeof row.moisturePct !== 'number') row.moisturePct = 11;
          if (typeof row.stockKg !== 'number' || !Number.isFinite(row.stockKg)) row.stockKg = 0;
        });

        // 3) 烘焙记录：兜底状态、风门与火力档
        await tx.table('roastProfiles').toCollection().modify((row: Record<string, unknown>) => {
          if (typeof row.state !== 'string') row.state = 'recording';
          if (typeof row.airflow !== 'string') row.airflow = 'half';
          if (typeof row.gasLevel !== 'number') row.gasLevel = 3;
        });

        // 4) 曲线事件：按 profileId 分组、按时间升序补算缺失的 RoR，并补齐备注
        const eventRows = (await tx.table('events').toArray()) as Array<Record<string, unknown>>;
        const grouped = new Map<string, Array<Record<string, unknown>>>();
        eventRows.forEach((row) => {
          const profileId = typeof row.profileId === 'string' ? row.profileId : '';
          const list = grouped.get(profileId) ?? [];
          list.push(row);
          grouped.set(profileId, list);
        });
        const migratedEvents: Array<Record<string, unknown>> = [];
        grouped.forEach((list) => {
          list.sort((a, b) => Number(a.atSec ?? 0) - Number(b.atSec ?? 0));
          list.forEach((row, index) => {
            const prev = list[index - 1];
            if ((typeof row.rorPerMin !== 'number' || row.rorPerMin === 0) && prev) {
              row.rorPerMin = rorPerMinBetween(
                Number(prev.atSec ?? 0),
                Number(prev.beanTempC ?? 0),
                Number(row.atSec ?? 0),
                Number(row.beanTempC ?? 0),
              );
            }
            if (typeof row.rorPerMin !== 'number') row.rorPerMin = 0;
            if (typeof row.note !== 'string') row.note = '';
            migratedEvents.push(row);
          });
        });
        if (migratedEvents.length > 0) {
          await tx.table('events').bulkPut(migratedEvents);
        }

        // 5) 杯测：按分项加权补算历史总分
        await tx.table('cuppings').toCollection().modify((row: Record<string, unknown>) => {
          if (typeof row.totalScore !== 'number' || row.totalScore <= 0) {
            row.totalScore = weightedTotalScore({
              dryAroma: Number(row.dryAroma ?? 0),
              wetAroma: Number(row.wetAroma ?? 0),
              acidity: Number(row.acidity ?? 0),
              sweetness: Number(row.sweetness ?? 0),
              aftertaste: Number(row.aftertaste ?? 0),
            });
          }
        });

        // 6) 拼配方案：兜底配方明细与状态
        await tx.table('blends').toCollection().modify((row: Record<string, unknown>) => {
          if (!Array.isArray(row.items)) row.items = [];
          if (typeof row.state !== 'string') row.state = 'trial';
          if (typeof row.targetFlavor !== 'string') row.targetFlavor = '';
        });
      });

    // v3：为烘焙记录补齐编辑版本号（多标签页乐观并发控制）。结构不变，仅回填数据，
    // 历史记录 version 从 1 起，之后照常编辑、照常参与版本比对。
    this.version(DB_VERSION)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table('roastProfiles')
          .toCollection()
          .modify((row: Record<string, unknown>) => {
            if (typeof row.version !== 'number' || !Number.isFinite(row.version) || row.version < 1) {
              row.version = 1;
            }
          });
      });
  }
}

export const db = new RoastLogDatabase();

/* ------------------------------ 通用工具 ------------------------------ */

/** 生成带前缀的主键 id */
export function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 当前时间 ISO 字符串 */
export function nowIso(): string {
  return new Date().toISOString();
}

/** 保留三位小数的重量换算 */
export function roundKg(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/* --------------------------- 生豆 GreenBean --------------------------- */

export async function listGreenBeans(): Promise<GreenBean[]> {
  const rows = await db.greenBeans.toArray();
  return rows.sort((a, b) => b.arrivedAt.localeCompare(a.arrivedAt) || a.origin.localeCompare(b.origin, 'zh-Hans-CN'));
}

export async function getGreenBean(id: string): Promise<GreenBean | undefined> {
  return db.greenBeans.get(id);
}

export async function putGreenBean(row: GreenBean): Promise<void> {
  await db.greenBeans.put(row);
}

/** 删除生豆：级联删除其烘焙记录、曲线事件、杯测，并从拼配配方中摘除相关成分 */
export async function removeGreenBean(id: string): Promise<void> {
  await db.transaction('rw', db.greenBeans, db.roastProfiles, db.events, db.cuppings, db.blends, async () => {
    const profiles = await db.roastProfiles.where('greenBeanId').equals(id).toArray();
    const profileIds = profiles.map((profile) => profile.id);
    if (profileIds.length > 0) {
      await db.events.where('profileId').anyOf(profileIds).delete();
      await db.cuppings.where('profileId').anyOf(profileIds).delete();
      await db.roastProfiles.bulkDelete(profileIds);
    }
    const blends = await db.blends.toArray();
    const stamp = nowIso();
    const affected = blends
      .map((blend) => {
        const items = blend.items.filter((item) => item.greenBeanId !== id && !profileIds.includes(item.profileId));
        return items.length === blend.items.length ? null : { ...blend, items, updatedAt: stamp };
      })
      .filter((blend): blend is Blend => blend !== null);
    if (affected.length > 0) await db.blends.bulkPut(affected);
    await db.greenBeans.delete(id);
  });
}

/* ------------------------ 烘焙记录 RoastProfile ------------------------ */

export async function listRoastProfiles(): Promise<RoastProfile[]> {
  const rows = await db.roastProfiles.toArray();
  return rows.sort((a, b) => b.roastedAt.localeCompare(a.roastedAt));
}

export async function getRoastProfile(id: string): Promise<RoastProfile | undefined> {
  return db.roastProfiles.get(id);
}

export async function putRoastProfile(row: RoastProfile): Promise<void> {
  await db.roastProfiles.put(row);
}

/** 删除烘焙记录：级联删除曲线事件与杯测，并从拼配配方中摘除相关成分 */
export async function removeRoastProfile(id: string): Promise<void> {
  await db.transaction('rw', db.roastProfiles, db.events, db.cuppings, db.blends, async () => {
    await db.events.where('profileId').equals(id).delete();
    await db.cuppings.where('profileId').equals(id).delete();
    const blends = await db.blends.toArray();
    const stamp = nowIso();
    const affected = blends
      .map((blend) => {
        const items = blend.items.filter((item) => item.profileId !== id);
        return items.length === blend.items.length ? null : { ...blend, items, updatedAt: stamp };
      })
      .filter((blend): blend is Blend => blend !== null);
    if (affected.length > 0) await db.blends.bulkPut(affected);
    await db.roastProfiles.delete(id);
  });
}

/** 状态流转：记录中 → 已完成 / 作废（版本 +1；传入 baseVersion 时先比对版本） */
export async function updateRoastState(
  id: string,
  state: RoastState,
  baseVersion?: number,
): Promise<VersionedResult> {
  return db.transaction('rw', db.roastProfiles, db.events, async () => {
    const current = await db.roastProfiles.get(id);
    if (!current) return { ok: false, reason: 'missing', message: '烘焙记录不存在（可能已被其他标签页删除）' };
    if (baseVersion !== undefined && current.version !== baseVersion) {
      const remote = await readRoastSnapshot(id);
      return { ok: false, reason: 'conflict', remote: remote ?? { profile: current, events: [] } };
    }
    const next: RoastProfile = { ...current, state, version: current.version + 1, updatedAt: nowIso() };
    await db.roastProfiles.put(next);
    const snapshot = await readRoastSnapshot(id);
    return { ok: true, profile: next, events: snapshot?.events ?? [] };
  });
}

/* --------------------------- 曲线事件 RoastEvent --------------------------- */

export async function listEvents(profileId?: string): Promise<RoastEvent[]> {
  const rows = profileId
    ? await db.events.where('profileId').equals(profileId).toArray()
    : await db.events.toArray();
  return rows.sort((a, b) => a.atSec - b.atSec);
}

export async function listAllEvents(): Promise<RoastEvent[]> {
  return db.events.toArray();
}

export async function putEvent(row: RoastEvent): Promise<void> {
  await db.events.put(row);
}

export async function putEvents(rows: RoastEvent[]): Promise<void> {
  await db.events.bulkPut(rows);
}

export async function removeEvent(id: string): Promise<void> {
  await db.events.delete(id);
}

/* --------------------- 多标签页并发：版本化写入 --------------------- */

/** 对方（数据库）当前快照：版本冲突时交给页面逐项比对合并 */
export interface RoastRemoteSnapshot {
  profile: RoastProfile;
  events: RoastEvent[];
}

/**
 * 版本化写入结果：
 * - ok：写入成功，返回最新记录与曲线节点（version 已 +1）
 * - conflict：保存前比对版本不一致，附对方快照，调用方必须逐项合并后才能再次入库
 * - missing / error：记录不存在或业务校验失败，未写入任何内容
 */
export type VersionedResult<Extra extends object = object> =
  | ({ ok: true; profile: RoastProfile; events: RoastEvent[] } & Extra)
  | { ok: false; reason: 'conflict'; remote: RoastRemoteSnapshot }
  | { ok: false; reason: 'missing' | 'error'; message: string };

/** 读取记录 + 曲线节点快照（须在 roastProfiles / events 事务内调用） */
async function readRoastSnapshot(profileId: string): Promise<RoastRemoteSnapshot | null> {
  const profile = await db.roastProfiles.get(profileId);
  if (!profile) return null;
  const events = await db.events.where('profileId').equals(profileId).toArray();
  events.sort((a, b) => a.atSec - b.atSec);
  return { profile, events };
}

/** 版本比对：不一致时返回对方快照（冲突）；记录不存在返回 null */
async function conflictIfStale(
  profileId: string,
  baseVersion: number,
): Promise<{ current: RoastProfile } | { conflict: RoastRemoteSnapshot } | null> {
  const current = await db.roastProfiles.get(profileId);
  if (!current) return null;
  if (current.version !== baseVersion) {
    const remote = await readRoastSnapshot(profileId);
    return { conflict: remote ?? { profile: current, events: [] } };
  }
  return { current };
}

const MISSING_PROFILE: { ok: false; reason: 'missing'; message: string } = {
  ok: false,
  reason: 'missing',
  message: '烘焙记录不存在（可能已被其他标签页删除）',
};

/** 保存烘焙记录字段（载量 / 状态 / 机型等）：保存前比对版本，冲突返回对方快照 */
export async function saveProfileFieldsVersioned(input: {
  id: string;
  draft: RoastProfileDraft;
  baseVersion: number;
}): Promise<VersionedResult> {
  return db.transaction('rw', db.roastProfiles, db.events, async () => {
    const check = await conflictIfStale(input.id, input.baseVersion);
    if (!check) return MISSING_PROFILE;
    if ('conflict' in check) return { ok: false, reason: 'conflict', remote: check.conflict };
    const next: RoastProfile = {
      ...check.current,
      ...input.draft,
      version: check.current.version + 1,
      updatedAt: nowIso(),
    };
    await db.roastProfiles.put(next);
    const snapshot = await readRoastSnapshot(input.id);
    return { ok: true, profile: next, events: snapshot?.events ?? [] };
  });
}

/** 保存单个曲线节点（新增 / 编辑）：同事务把记录版本 +1 */
export async function saveEventVersioned(input: {
  profileId: string;
  draft: RoastEventDraft;
  id: string;
  createdAt?: string;
  baseVersion: number;
}): Promise<VersionedResult<{ saved: RoastEvent }>> {
  return db.transaction('rw', db.roastProfiles, db.events, async () => {
    const check = await conflictIfStale(input.profileId, input.baseVersion);
    if (!check) return MISSING_PROFILE;
    if ('conflict' in check) return { ok: false, reason: 'conflict', remote: check.conflict };
    const stamp = nowIso();
    const row: RoastEvent = {
      ...input.draft,
      id: input.id,
      createdAt: input.createdAt ?? stamp,
      updatedAt: stamp,
    };
    await db.events.put(row);
    const next: RoastProfile = { ...check.current, version: check.current.version + 1, updatedAt: stamp };
    await db.roastProfiles.put(next);
    const snapshot = await readRoastSnapshot(input.profileId);
    return { ok: true, profile: next, events: snapshot?.events ?? [], saved: row };
  });
}

/** 删除曲线节点：同事务把记录版本 +1 */
export async function deleteEventVersioned(input: {
  profileId: string;
  eventId: string;
  baseVersion: number;
}): Promise<VersionedResult> {
  return db.transaction('rw', db.roastProfiles, db.events, async () => {
    const check = await conflictIfStale(input.profileId, input.baseVersion);
    if (!check) return MISSING_PROFILE;
    if ('conflict' in check) return { ok: false, reason: 'conflict', remote: check.conflict };
    await db.events.delete(input.eventId);
    const next: RoastProfile = { ...check.current, version: check.current.version + 1, updatedAt: nowIso() };
    await db.roastProfiles.put(next);
    const snapshot = await readRoastSnapshot(input.profileId);
    return { ok: true, profile: next, events: snapshot?.events ?? [] };
  });
}

/** 拖拽排序写回：整批节点按新顺序落库，同事务把记录版本 +1 */
export async function commitEventOrderVersioned(input: {
  profileId: string;
  events: RoastEvent[];
  baseVersion: number;
}): Promise<VersionedResult> {
  return db.transaction('rw', db.roastProfiles, db.events, async () => {
    const check = await conflictIfStale(input.profileId, input.baseVersion);
    if (!check) return MISSING_PROFILE;
    if ('conflict' in check) return { ok: false, reason: 'conflict', remote: check.conflict };
    const stamp = nowIso();
    const existing = await db.events.where('profileId').equals(input.profileId).toArray();
    const createdById = new Map(existing.map((event) => [event.id, event.createdAt]));
    const rows = input.events.map((event) => ({
      ...event,
      profileId: input.profileId,
      createdAt: createdById.get(event.id) ?? event.createdAt ?? stamp,
      updatedAt: stamp,
    }));
    if (rows.length > 0) await db.events.bulkPut(rows);
    const next: RoastProfile = { ...check.current, version: check.current.version + 1, updatedAt: stamp };
    await db.roastProfiles.put(next);
    const snapshot = await readRoastSnapshot(input.profileId);
    return { ok: true, profile: next, events: snapshot?.events ?? [] };
  });
}

/**
 * 冲突合并入库：以页面逐项合并后的「记录字段 + 完整节点列表」为准落库。
 * - 再次比对版本（对方可能又保存了），不一致返回最新快照让页面重新合并；
 * - 远端多出的节点删除、合并列表中的节点写入，与记录字段同一事务提交；
 * - 合并结果把状态推进为「已完成」时，同事务按载量扣减生豆库存（只扣一次）；
 *   余量不足则整体不写入。
 */
export async function applyRoastMerge(input: {
  profileId: string;
  draft: RoastProfileDraft;
  events: RoastEvent[];
  baseVersion: number;
}): Promise<VersionedResult<{ stockMessage: string }>> {
  return db.transaction('rw', db.roastProfiles, db.events, db.greenBeans, async () => {
    const check = await conflictIfStale(input.profileId, input.baseVersion);
    if (!check) return { ...MISSING_PROFILE };
    if ('conflict' in check) return { ok: false, reason: 'conflict', remote: check.conflict };

    // 先校验库存（只校验不写入），避免事务内部分落库
    const needDeduct = check.current.state !== 'done' && input.draft.state === 'done';
    let bean: GreenBean | undefined;
    let deductedKg = 0;
    if (needDeduct) {
      bean = await db.greenBeans.get(input.draft.greenBeanId);
      if (!bean) {
        return { ok: false, reason: 'error', message: '合并后状态为「已完成」，但关联生豆不存在，无法扣减库存，未写入任何修改' };
      }
      deductedKg = roundKg(input.draft.chargeG / 1000);
      if (bean.stockKg + 1e-6 < deductedKg) {
        return {
          ok: false,
          reason: 'error',
          message: `生豆余量不足：在库 ${bean.stockKg}kg < 载量 ${deductedKg}kg，未写入任何修改`,
        };
      }
    }

    const stamp = nowIso();
    // 1) 曲线节点：以合并列表为准，远端多出的删除
    const remoteEvents = await db.events.where('profileId').equals(input.profileId).toArray();
    const createdById = new Map(remoteEvents.map((event) => [event.id, event.createdAt]));
    const mergedIds = new Set(input.events.map((event) => event.id));
    const obsoleteIds = remoteEvents.filter((event) => !mergedIds.has(event.id)).map((event) => event.id);
    if (obsoleteIds.length > 0) await db.events.bulkDelete(obsoleteIds);
    const rows = input.events.map((event) => ({
      ...event,
      profileId: input.profileId,
      createdAt: createdById.get(event.id) ?? event.createdAt ?? stamp,
      updatedAt: stamp,
    }));
    if (rows.length > 0) await db.events.bulkPut(rows);

    // 2) 库存扣减（与状态、节点同事务）
    let stockMessage = '';
    if (needDeduct && bean) {
      const remainingKg = roundKg(bean.stockKg - deductedKg);
      await db.greenBeans.put({ ...bean, stockKg: remainingKg, updatedAt: stamp });
      stockMessage = `已按载量扣减 ${deductedKg}kg，${bean.farm || bean.origin} 余量 ${remainingKg}kg${
        remainingKg < LOW_STOCK_KG ? '（余量偏低，请及时补货）' : ''
      }`;
    }

    // 3) 记录字段与版本
    const next: RoastProfile = {
      ...check.current,
      ...input.draft,
      version: check.current.version + 1,
      updatedAt: stamp,
    };
    await db.roastProfiles.put(next);
    const snapshot = await readRoastSnapshot(input.profileId);
    return { ok: true, profile: next, events: snapshot?.events ?? [], stockMessage };
  });
}

/* ----------------------------- 杯测 Cupping ----------------------------- */

export async function listCuppings(): Promise<Cupping[]> {
  const rows = await db.cuppings.toArray();
  return rows.sort((a, b) => b.cuppedAt.localeCompare(a.cuppedAt));
}

export async function putCupping(row: Cupping): Promise<void> {
  await db.cuppings.put(row);
}

export async function removeCupping(id: string): Promise<void> {
  await db.cuppings.delete(id);
}

/* ------------------------------ 拼配 Blend ------------------------------ */

export async function listBlends(): Promise<Blend[]> {
  const rows = await db.blends.toArray();
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function putBlend(row: Blend): Promise<void> {
  await db.blends.put(row);
}

export async function removeBlend(id: string): Promise<void> {
  await db.blends.delete(id);
}

/* -------------------------- 载量模板 MachineTemplate -------------------------- */

export async function listMachineTemplates(): Promise<MachineTemplate[]> {
  const rows = await db.machineTemplates.toArray();
  return rows.sort((a, b) => a.model.localeCompare(b.model, 'zh-Hans-CN') || a.chargeG - b.chargeG);
}

export async function putMachineTemplate(row: MachineTemplate): Promise<void> {
  await db.machineTemplates.put(row);
}

export async function removeMachineTemplate(id: string): Promise<void> {
  await db.machineTemplates.delete(id);
}

/* --------------------------- 下豆扣减在库重量 --------------------------- */

export interface StockConsumeResult {
  ok: boolean;
  /** 是否因版本冲突被拒绝（对方标签页已保存新版本，未写入任何内容） */
  conflict: boolean;
  message: string;
  /** 本次扣减重量（kg） */
  deductedKg: number;
  /** 扣减后余量（kg） */
  remainingKg: number;
  /** 余量是否低于警戒线 */
  warning: boolean;
  bean?: GreenBean;
  profile?: RoastProfile;
  /** 写入成功后的曲线节点（含本次下豆节点） */
  events?: RoastEvent[];
  /** 版本冲突时对方（数据库）的记录与节点快照，供页面逐项合并 */
  remote?: RoastRemoteSnapshot;
}

/** 下豆节点（与状态、库存在同一事务写入） */
export interface DropEventInput {
  draft: RoastEventDraft;
  id: string;
  createdAt?: string;
}

/**
 * 烘焙下豆：下豆节点 + 记录状态「已完成」+ 生豆库存扣减，三者在同一事务写入（要么一起成功，要么都不写）。
 * - 只有「记录中」的记录允许扣减：同一锅在两个标签页同时下豆时，后到的事务看到状态已推进，
 *   直接拒绝，生豆库存只扣一次；
 * - 传入 baseVersion 时先比对编辑版本，不一致返回对方快照（conflict），由页面逐项合并后再入库；
 * - 余量不足直接拒绝，不落任何数据。
 */
export async function consumeStockForProfile(
  profileId: string,
  options: { baseVersion?: number; dropEvent?: DropEventInput } = {},
): Promise<StockConsumeResult> {
  return db.transaction('rw', db.greenBeans, db.roastProfiles, db.events, async () => {
    const reject = (message: string, extra: Partial<StockConsumeResult> = {}): StockConsumeResult => ({
      ok: false,
      conflict: false,
      message,
      deductedKg: 0,
      remainingKg: 0,
      warning: false,
      ...extra,
    });

    const profile = await db.roastProfiles.get(profileId);
    if (!profile) return reject('烘焙记录不存在');
    const bean = await db.greenBeans.get(profile.greenBeanId);
    if (!bean) return reject('该烘焙记录关联的生豆已不存在');
    if (profile.state !== 'recording') {
      return reject(`该记录当前为「${ROAST_STATE_LABEL[profile.state]}」，无需重复扣减`, {
        remainingKg: bean.stockKg,
        warning: bean.stockKg < LOW_STOCK_KG,
        bean,
        profile,
      });
    }
    if (options.baseVersion !== undefined && profile.version !== options.baseVersion) {
      const remote = await readRoastSnapshot(profileId);
      return reject(`该记录刚被其他标签页保存（对方版本 v${profile.version}），请核对差异后再下豆`, {
        conflict: true,
        remainingKg: bean.stockKg,
        warning: bean.stockKg < LOW_STOCK_KG,
        bean,
        profile,
        remote: remote ?? { profile, events: [] },
      });
    }
    const deductedKg = roundKg(profile.chargeG / 1000);
    if (bean.stockKg + 1e-6 < deductedKg) {
      return reject(`生豆余量不足：在库 ${bean.stockKg}kg < 本次载量 ${deductedKg}kg，请先补货或下调载量`, {
        remainingKg: bean.stockKg,
        warning: true,
        bean,
        profile,
      });
    }
    const stamp = nowIso();
    // 1) 下豆节点（同事务）
    if (options.dropEvent) {
      const row: RoastEvent = {
        ...options.dropEvent.draft,
        id: options.dropEvent.id,
        createdAt: options.dropEvent.createdAt ?? stamp,
        updatedAt: stamp,
      };
      await db.events.put(row);
    }
    // 2) 库存扣减 + 3) 状态推进与版本 +1（同事务，任一失败整体回滚）
    const remainingKg = roundKg(bean.stockKg - deductedKg);
    const nextBean: GreenBean = { ...bean, stockKg: remainingKg, updatedAt: stamp };
    const nextProfile: RoastProfile = { ...profile, state: 'done', version: profile.version + 1, updatedAt: stamp };
    await db.greenBeans.put(nextBean);
    await db.roastProfiles.put(nextProfile);
    const events = (await db.events.where('profileId').equals(profileId).toArray()).sort(
      (a, b) => a.atSec - b.atSec,
    );
    const warning = remainingKg < LOW_STOCK_KG;
    return {
      ok: true,
      conflict: false,
      message: `已按载量扣减 ${deductedKg}kg，${bean.farm || bean.origin} 余量 ${remainingKg}kg${
        warning ? '（余量偏低，请及时补货）' : ''
      }`,
      deductedKg,
      remainingKg,
      warning,
      bean: nextBean,
      profile: nextProfile,
      events,
    };
  });
}

/* ----------------------------- 整库导入导出 ----------------------------- */

export interface DatabaseSnapshot {
  name: string;
  schemaVersion: number;
  exportedAt: string;
  greenBeans: GreenBean[];
  roastProfiles: RoastProfile[];
  events: RoastEvent[];
  cuppings: Cupping[];
  blends: Blend[];
  machineTemplates: MachineTemplate[];
}

/** 结构校验：判断任意对象是否为可导入的快照 */
export function isDatabaseSnapshot(value: unknown): value is DatabaseSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const keys: Array<keyof DatabaseSnapshot> = [
    'greenBeans',
    'roastProfiles',
    'events',
    'cuppings',
    'blends',
  ];
  return keys.every((key) => Array.isArray(candidate[key]));
}

export async function exportSnapshot(): Promise<DatabaseSnapshot> {
  const [greenBeans, roastProfiles, events, cuppings, blends, machineTemplates] = await Promise.all([
    db.greenBeans.toArray(),
    db.roastProfiles.toArray(),
    db.events.toArray(),
    db.cuppings.toArray(),
    db.blends.toArray(),
    db.machineTemplates.toArray(),
  ]);
  return {
    name: DB_NAME,
    schemaVersion: DB_VERSION,
    exportedAt: nowIso(),
    greenBeans,
    roastProfiles,
    events,
    cuppings,
    blends,
    machineTemplates,
  };
}

/** 用快照覆盖整库（导入档案） */
export async function importSnapshot(snapshot: DatabaseSnapshot): Promise<void> {
  if (!isDatabaseSnapshot(snapshot)) {
    throw new Error('档案结构不合法：缺少 greenBeans / roastProfiles / events / cuppings / blends 数组字段');
  }
  await db.transaction(
    'rw',
    [db.greenBeans, db.roastProfiles, db.events, db.cuppings, db.blends, db.machineTemplates],
    async () => {
      await Promise.all([
        db.greenBeans.clear(),
        db.roastProfiles.clear(),
        db.events.clear(),
        db.cuppings.clear(),
        db.blends.clear(),
        db.machineTemplates.clear(),
      ]);
      await db.greenBeans.bulkPut(snapshot.greenBeans);
      // 旧档案可能缺少编辑版本号：导入时兜底为 1，保证历史记录仍可编辑、可参与版本比对
      await db.roastProfiles.bulkPut(
        snapshot.roastProfiles.map((profile) => ({
          ...profile,
          version:
            typeof profile.version === 'number' && Number.isFinite(profile.version) && profile.version >= 1
              ? Math.floor(profile.version)
              : 1,
        })),
      );
      await db.events.bulkPut(snapshot.events);
      await db.cuppings.bulkPut(snapshot.cuppings);
      await db.blends.bulkPut(snapshot.blends);
      await db.machineTemplates.bulkPut(snapshot.machineTemplates ?? []);
    },
  );
}

/** 清空全部表 */
export async function clearAllTables(): Promise<void> {
  await db.transaction(
    'rw',
    [db.greenBeans, db.roastProfiles, db.events, db.cuppings, db.blends, db.machineTemplates],
    async () => {
      await Promise.all([
        db.greenBeans.clear(),
        db.roastProfiles.clear(),
        db.events.clear(),
        db.cuppings.clear(),
        db.blends.clear(),
        db.machineTemplates.clear(),
      ]);
    },
  );
}

/** 重置为演示数据 */
export async function resetDatabase(): Promise<void> {
  await clearAllTables();
  await seedDatabase();
}

/** 各表行数统计 */
export async function countAll(): Promise<Record<string, number>> {
  const [greenBeans, roastProfiles, events, cuppings, blends, machineTemplates] = await Promise.all([
    db.greenBeans.count(),
    db.roastProfiles.count(),
    db.events.count(),
    db.cuppings.count(),
    db.blends.count(),
    db.machineTemplates.count(),
  ]);
  return { greenBeans, roastProfiles, events, cuppings, blends, machineTemplates };
}

/* ------------------------------ 首屏初始化 ------------------------------ */

/** 打开数据库：空库时自动播种演示数据，保证每个页面开箱即有内容 */
export async function initDatabase(): Promise<void> {
  await db.open();
  if ((await db.greenBeans.count()) === 0) {
    await seedDatabase();
  }
}

/**
 * 播种演示数据（幂等：固定 id + bulkPut）。
 * 层次：生豆 → 烘焙记录 → 曲线事件 / 杯测 → 拼配方案（→ 表示父引用子）。
 */
export async function seedDatabase(): Promise<void> {
  const existing = await db.greenBeans.count();
  if (existing > 0) return;

  const stamp = nowIso();
  const day = (offset: number): string => {
    const base = new Date('2025-01-10T08:00:00.000Z');
    base.setUTCDate(base.getUTCDate() + offset);
    return base.toISOString().slice(0, 10);
  };

  const greenBeans: GreenBean[] = [
    {
      id: 'gb-guji-washed',
      origin: '埃塞俄比亚 古吉',
      farm: '乌拉嘎水洗站',
      process: 'washed',
      altitudeM: 2050,
      moisturePct: 10.8,
      stockKg: 12.5,
      arrivedAt: day(-52),
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: 'gb-huila-honey',
      origin: '哥伦比亚 惠兰',
      farm: '圣安东尼奥庄园',
      process: 'honey',
      altitudeM: 1750,
      moisturePct: 11.2,
      stockKg: 1.4,
      arrivedAt: day(-38),
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: 'gb-cerrado-natural',
      origin: '巴西 喜拉多',
      farm: '圣伊莎贝尔庄园',
      process: 'natural',
      altitudeM: 1150,
      moisturePct: 11.6,
      stockKg: 20,
      arrivedAt: day(-22),
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: 'gb-nyeri-washed',
      origin: '肯尼亚 涅里',
      farm: '加图吉处理厂',
      process: 'washed',
      altitudeM: 1850,
      moisturePct: 10.4,
      stockKg: 6.4,
      arrivedAt: day(-10),
      createdAt: stamp,
      updatedAt: stamp,
    },
  ];

  const roastProfiles: RoastProfile[] = [
    {
      id: 'rp-guji-500',
      greenBeanId: 'gb-guji-washed',
      machineModel: 'HB-M6',
      chargeG: 500,
      chargeTempC: 198,
      airflow: 'half',
      gasLevel: 4,
      roastedAt: day(2),
      state: 'done',
      version: 1,
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: 'rp-huila-800',
      greenBeanId: 'gb-huila-honey',
      machineModel: 'Giesen W6A',
      chargeG: 800,
      chargeTempC: 205,
      airflow: 'open',
      gasLevel: 5,
      roastedAt: day(6),
      state: 'recording',
      version: 1,
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: 'rp-cerrado-1200',
      greenBeanId: 'gb-cerrado-natural',
      machineModel: 'Probat P12',
      chargeG: 1200,
      chargeTempC: 195,
      airflow: 'half',
      gasLevel: 6,
      roastedAt: day(10),
      state: 'done',
      version: 1,
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: 'rp-nyeri-400',
      greenBeanId: 'gb-nyeri-washed',
      machineModel: 'Mill City 500g',
      chargeG: 400,
      chargeTempC: 200,
      airflow: 'closed',
      gasLevel: 3,
      roastedAt: day(12),
      state: 'void',
      version: 1,
      createdAt: stamp,
      updatedAt: stamp,
    },
  ];

  const eventSeed: Array<[string, string, RoastEvent['type'], number, number, string]> = [
    ['ev-guji-1', 'rp-guji-500', 'turning', 95, 118.2, '回温点，火力保持 4 档'],
    ['ev-guji-2', 'rp-guji-500', 'dryEnd', 288, 152.6, '脱水结束转黄，风门调半开'],
    ['ev-guji-3', 'rp-guji-500', 'firstCrack', 462, 196.4, '一爆密集，火力回调至 3 档'],
    ['ev-guji-4', 'rp-guji-500', 'secondCrack', 640, 214.2, '二爆初起，准备下豆'],
    ['ev-guji-5', 'rp-guji-500', 'drop', 700, 219.5, '下豆冷却，发展率 34%'],
    ['ev-huila-1', 'rp-huila-800', 'turning', 102, 121, '回温偏晚，火力 5 档'],
    ['ev-huila-2', 'rp-huila-800', 'dryEnd', 305, 149.8, '蜜处理脱水稍慢'],
    ['ev-huila-3', 'rp-huila-800', 'firstCrack', 496, 193.5, '一爆清晰，待补录二爆与下豆'],
    ['ev-cerrado-1', 'rp-cerrado-1200', 'turning', 110, 116.4, '满锅载量，回温 110 秒'],
    ['ev-cerrado-2', 'rp-cerrado-1200', 'dryEnd', 330, 150.2, '脱水结束，火力维持 6 档'],
    ['ev-cerrado-3', 'rp-cerrado-1200', 'firstCrack', 540, 194.8, '一爆均匀'],
    ['ev-cerrado-4', 'rp-cerrado-1200', 'secondCrack', 720, 212.6, '二爆，风门半开'],
    ['ev-cerrado-5', 'rp-cerrado-1200', 'drop', 780, 217.2, '下豆，发展率 30.8%'],
    ['ev-nyeri-1', 'rp-nyeri-400', 'turning', 118, 114.5, '风门关，回温慢'],
    ['ev-nyeri-2', 'rp-nyeri-400', 'dryEnd', 372, 131.8, '脱水期过长、RoR 偏低，判定作废重烘'],
  ];

  const events: RoastEvent[] = eventSeed.map(([id, profileId, type, atSec, beanTempC, note]) => ({
    id,
    profileId,
    type,
    atSec,
    beanTempC,
    rorPerMin: 0,
    note,
    createdAt: stamp,
    updatedAt: stamp,
  }));
  // 按时间顺序补算 RoR（播种后就带上真实速率，页面直接可用）
  const grouped = new Map<string, RoastEvent[]>();
  events.forEach((event) => {
    const list = grouped.get(event.profileId) ?? [];
    list.push(event);
    grouped.set(event.profileId, list);
  });
  grouped.forEach((list) => {
    list.sort((a, b) => a.atSec - b.atSec);
    list.forEach((event, index) => {
      const prev = list[index - 1];
      event.rorPerMin = prev
        ? rorPerMinBetween(prev.atSec, prev.beanTempC, event.atSec, event.beanTempC)
        : 0;
    });
  });

  const buildCupping = (
    id: string,
    profileId: string,
    cuppedAt: string,
    dryAroma: number,
    wetAroma: number,
    acidity: number,
    sweetness: number,
    aftertaste: number,
  ): Cupping => ({
    id,
    profileId,
    cuppedAt,
    dryAroma,
    wetAroma,
    acidity,
    sweetness,
    aftertaste,
    totalScore: weightedTotalScore({ dryAroma, wetAroma, acidity, sweetness, aftertaste }),
    createdAt: stamp,
    updatedAt: stamp,
  });

  const cuppings: Cupping[] = [
    buildCupping('cp-guji-01', 'rp-guji-500', day(4), 8.5, 8.8, 8.6, 8.9, 8.4),
    buildCupping('cp-cerrado-01', 'rp-cerrado-1200', day(12), 8.2, 8.4, 7.8, 8.8, 8.6),
    buildCupping('cp-huila-01', 'rp-huila-800', day(9), 7.9, 8.1, 7.4, 8.2, 7.8),
  ];

  const blends: Blend[] = [
    {
      id: 'bl-house-01',
      name: '晨光拼配 House Blend',
      items: [
        { greenBeanId: 'gb-guji-washed', profileId: 'rp-guji-500', ratioPct: 40 },
        { greenBeanId: 'gb-cerrado-natural', profileId: 'rp-cerrado-1200', ratioPct: 45 },
        { greenBeanId: 'gb-huila-honey', profileId: 'rp-huila-800', ratioPct: 15 },
      ],
      targetFlavor: '柑橘果酸、坚果可可',
      createdAt: day(15),
      state: 'final',
      updatedAt: stamp,
    },
    {
      id: 'bl-espresso-02',
      name: '深烘意式 Espresso Base',
      items: [
        { greenBeanId: 'gb-cerrado-natural', profileId: 'rp-cerrado-1200', ratioPct: 70 },
        { greenBeanId: 'gb-nyeri-washed', profileId: 'rp-nyeri-400', ratioPct: 30 },
      ],
      targetFlavor: '坚果可可、焦糖甜感',
      createdAt: day(23),
      state: 'trial',
      updatedAt: stamp,
    },
    {
      id: 'bl-draft-03',
      name: '实验批次（占比待调平）',
      items: [
        { greenBeanId: 'gb-guji-washed', profileId: 'rp-guji-500', ratioPct: 50 },
        { greenBeanId: 'gb-huila-honey', profileId: 'rp-huila-800', ratioPct: 30 },
      ],
      targetFlavor: '花香、莓果',
      createdAt: day(27),
      state: 'trial',
      updatedAt: stamp,
    },
  ];

  const machineTemplates: MachineTemplate[] = [
    {
      id: 'mt-hb-m6',
      model: 'HB-M6',
      airflow: 'half',
      gasLevel: 4,
      chargeG: 500,
      note: '常规出品载量',
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: 'mt-giesen-w6a',
      model: 'Giesen W6A',
      airflow: 'open',
      gasLevel: 5,
      chargeG: 800,
      note: '满锅载量，适合日晒豆',
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: 'mt-probat-p12',
      model: 'Probat P12',
      airflow: 'half',
      gasLevel: 6,
      chargeG: 1200,
      note: '批量生产档',
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: 'mt-millcity-500',
      model: 'Mill City 500g',
      airflow: 'closed',
      gasLevel: 3,
      chargeG: 400,
      note: '样品烘焙，风门关',
      createdAt: stamp,
      updatedAt: stamp,
    },
  ];

  await db.transaction(
    'rw',
    [db.greenBeans, db.roastProfiles, db.events, db.cuppings, db.blends, db.machineTemplates],
    async () => {
      await db.greenBeans.bulkPut(greenBeans);
      await db.roastProfiles.bulkPut(roastProfiles);
      await db.events.bulkPut(events);
      await db.cuppings.bulkPut(cuppings);
      await db.blends.bulkPut(blends);
      await db.machineTemplates.bulkPut(machineTemplates);
    },
  );
}
