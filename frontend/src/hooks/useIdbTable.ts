/**
 * useIdbTable(tableName, options)
 * Dexie 表增删改查 + liveQuery 响应式订阅封装，被多个页面与其派生 hooks 消费。
 * 返回 rows / loading / ready / error / refresh / create / update / remove / bulkPut / clear。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { liveQuery, type Table } from 'dexie';
import { db } from '../utils/db';

export type TableName =
  | 'greenBeans'
  | 'roastProfiles'
  | 'events'
  | 'cuppings'
  | 'blends'
  | 'machineTemplates';

export interface UseIdbTableOptions<T> {
  /** 只订阅满足条件的行 */
  filter?: (row: T) => boolean;
  /** 排序字段 */
  sortBy?: keyof T;
  /** 是否倒序 */
  descending?: boolean;
  /** 是否订阅（false 时直接返回空列表） */
  enabled?: boolean;
}

export interface UseIdbTableResult<T> {
  rows: T[];
  loading: boolean;
  /** 首次数据是否已就绪（用于区分「加载中」与「确实为空」） */
  ready: boolean;
  error: string;
  refresh: () => Promise<void>;
  getRow: (id: string) => Promise<T | undefined>;
  create: (row: T) => Promise<void>;
  update: (id: string, patch: Partial<T>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  bulkPut: (rows: T[]) => Promise<void>;
  clear: () => Promise<void>;
}

/** 行是否满足可选过滤条件 */
function applyFilter<T>(rows: T[], filter?: (row: T) => boolean): T[] {
  return filter ? rows.filter(filter) : rows;
}

/** 按可选字段排序 */
function applySort<T>(rows: T[], sortBy?: keyof T, descending = false): T[] {
  if (!sortBy) return rows;
  const sorted = [...rows].sort((left, right) => {
    const a = left[sortBy];
    const b = right[sortBy];
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), 'zh-Hans-CN');
  });
  return descending ? sorted.reverse() : sorted;
}

export function useIdbTable<T extends { id: string }>(
  tableName: TableName,
  options: UseIdbTableOptions<T> = {},
): UseIdbTableResult<T> {
  const { enabled = true, descending = false } = options;

  // 用 ref 保存回调与排序字段，避免每次渲染都重新订阅
  const filterRef = useRef(options.filter);
  const sortByRef = useRef(options.sortBy);
  filterRef.current = options.filter;
  sortByRef.current = options.sortBy;

  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  const table = useCallback((): Table<T, string> => db.table(tableName) as unknown as Table<T, string>, [tableName]);

  const readOnce = useCallback(async (): Promise<T[]> => {
    const all = await table().toArray();
    return applySort(applyFilter(all, filterRef.current), sortByRef.current, descending);
  }, [table, descending]);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const next = await readOnce();
      setRows(next);
      setError('');
      setReady(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '本地表读取失败');
      setReady(true);
    } finally {
      setLoading(false);
    }
  }, [enabled, readOnce]);

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      setLoading(false);
      setReady(true);
      return;
    }
    setLoading(true);
    const subscription = liveQuery(() => readOnce()).subscribe({
      next: (value) => {
        setRows(value);
        setLoading(false);
        setReady(true);
        setError('');
      },
      error: (cause: unknown) => {
        setError(cause instanceof Error ? cause.message : '本地表订阅失败');
        setLoading(false);
        setReady(true);
      },
    });
    return () => subscription.unsubscribe();
  }, [enabled, readOnce]);

  const getRow = useCallback(async (id: string) => table().get(id), [table]);

  const create = useCallback(
    async (row: T) => {
      await table().put(row);
    },
    [table],
  );

  const update = useCallback(
    async (id: string, patch: Partial<T>) => {
      const existing = await table().get(id);
      if (!existing) return;
      await table().put({ ...existing, ...patch });
    },
    [table],
  );

  const remove = useCallback(
    async (id: string) => {
      await table().delete(id);
    },
    [table],
  );

  const bulkPut = useCallback(
    async (nextRows: T[]) => {
      await table().bulkPut(nextRows);
    },
    [table],
  );

  const clear = useCallback(async () => {
    await table().clear();
  }, [table]);

  return { rows, loading, ready, error, refresh, getRow, create, update, remove, bulkPut, clear };
}

export default useIdbTable;
