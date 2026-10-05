/**
 * 拼配 slice：维护拼配方案列表、配方成分草稿（生豆/烘焙记录/占比%）与占比合计校验，
 * 并回显参与批次杯测均分；支持方案状态流转「试配 → 定版 → 停用」。
 */
import { createAsyncThunk, createSelector, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Blend, BlendDraft, BlendItem, BlendState } from '../types/blend';
import {
  BLEND_STATE_ORDER,
  createEmptyBlendItem,
  isRatioValid,
  joinFlavors,
  splitFlavors,
  totalRatioPct,
} from '../types/blend';
import { averageScore } from '../types/cupping';
import { createId, listBlends, nowIso, putBlend, removeBlend } from '../utils/db';
import type { RootState } from './store';

export type RatioFlag = 'valid' | 'invalid';

export interface BlendFilters {
  keyword: string;
  states: BlendState[];
  flavors: string[];
  ratio: RatioFlag[];
}

/** 配方草稿（跨页共享：拼配页表单与校验） */
export interface BlendDraftState {
  name: string;
  items: BlendItem[];
  /** 目标风味（多选，提交时以「、」连接为字符串） */
  targetFlavor: string[];
  createdAt: string;
  state: BlendState;
}

interface BlendStateShape {
  blends: Blend[];
  loading: boolean;
  error: string;
  filters: BlendFilters;
  draft: BlendDraftState;
  editingId: string | null;
  notice: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export const emptyBlendDraft = (): BlendDraftState => ({
  name: '',
  items: [createEmptyBlendItem()],
  targetFlavor: [],
  createdAt: today(),
  state: 'trial',
});

export const initialBlendFilters: BlendFilters = {
  keyword: '',
  states: [],
  flavors: [],
  ratio: [],
};

const initialState: BlendStateShape = {
  blends: [],
  loading: false,
  error: '',
  filters: initialBlendFilters,
  draft: emptyBlendDraft(),
  editingId: null,
  notice: '',
};

export const fetchBlends = createAsyncThunk('blends/fetchAll', async () => listBlends());

export const createBlend = createAsyncThunk('blends/create', async (draft: BlendDraftState) => {
  const stamp = nowIso();
  const row: Blend = {
    id: createId('bl'),
    name: draft.name.trim(),
    items: draft.items.map((item) => ({ ...item, ratioPct: Math.round(item.ratioPct * 100) / 100 })),
    targetFlavor: joinFlavors(draft.targetFlavor),
    createdAt: draft.createdAt,
    state: draft.state,
    updatedAt: stamp,
  };
  await putBlend(row);
  return listBlends();
});

export const updateBlend = createAsyncThunk(
  'blends/update',
  async (input: { id: string; draft: BlendDraftState }) => {
    const stamp = nowIso();
    const row: Blend = {
      id: input.id,
      name: input.draft.name.trim(),
      items: input.draft.items.map((item) => ({ ...item, ratioPct: Math.round(item.ratioPct * 100) / 100 })),
      targetFlavor: joinFlavors(input.draft.targetFlavor),
      createdAt: input.draft.createdAt,
      state: input.draft.state,
      updatedAt: stamp,
    };
    await putBlend(row);
    return listBlends();
  },
);

export const deleteBlend = createAsyncThunk('blends/remove', async (id: string) => {
  await removeBlend(id);
  return listBlends();
});

export const advanceBlendState = createAsyncThunk(
  'blends/advanceState',
  async (input: { id: string; state: BlendState }) => {
    const existing = (await listBlends()).find((blend) => blend.id === input.id);
    if (existing) {
      await putBlend({ ...existing, state: input.state, updatedAt: nowIso() });
    }
    return listBlends();
  },
);

/** 导入单个方案 JSON（已通过 parseBlendJson 校验） */
export const importBlendDraft = createAsyncThunk('blends/import', async (draft: BlendDraft) => {
  const stamp = nowIso();
  const row: Blend = { ...draft, id: createId('bl'), updatedAt: stamp };
  await putBlend(row);
  return listBlends();
});

const blendSlice = createSlice({
  name: 'blends',
  initialState,
  reducers: {
    setBlendFilters(state, action: PayloadAction<Partial<BlendFilters>>) {
      state.filters = { ...state.filters, ...action.payload };
    },
    resetBlendFilters(state) {
      state.filters = initialBlendFilters;
    },
    setBlendDraftField(
      state,
      action: PayloadAction<{ field: 'name' | 'createdAt' | 'state' | 'targetFlavor'; value: string | string[] | BlendState }>,
    ) {
      const { field, value } = action.payload;
      switch (field) {
        case 'name':
          state.draft.name = String(value);
          break;
        case 'createdAt':
          state.draft.createdAt = String(value);
          break;
        case 'state':
          state.draft.state = value as BlendState;
          break;
        case 'targetFlavor':
          state.draft.targetFlavor = Array.isArray(value) ? value : splitFlavors(String(value));
          break;
        default:
          break;
      }
    },
    /** 用表单当前值整体覆盖配方草稿（Form.List 变更时同步） */
    setDraftItems(state, action: PayloadAction<BlendItem[]>) {
      state.draft.items = action.payload;
    },
    addDraftItem(state) {
      state.draft.items = [...state.draft.items, createEmptyBlendItem()];
    },
    updateDraftItem(state, action: PayloadAction<{ index: number; patch: Partial<BlendItem> }>) {
      const { index, patch } = action.payload;
      state.draft.items = state.draft.items.map((item, position) =>
        position === index ? { ...item, ...patch } : item,
      );
    },
    removeDraftItem(state, action: PayloadAction<number>) {
      state.draft.items = state.draft.items.filter((_item, position) => position !== action.payload);
    },
    /** 平均分配占比：一键把合计凑到 100% */
    balanceDraftItems(state) {
      const count = state.draft.items.length;
      if (count === 0) return;
      const base = Math.floor((100 / count) * 100) / 100;
      const rest = Math.round((100 - base * count) * 100) / 100;
      state.draft.items = state.draft.items.map((item, index) => ({
        ...item,
        ratioPct: index === 0 ? Math.round((base + rest) * 100) / 100 : base,
      }));
    },
    resetBlendDraft(state) {
      state.draft = emptyBlendDraft();
      state.editingId = null;
    },
    loadBlendDraft(state, action: PayloadAction<Blend>) {
      const blend = action.payload;
      state.draft = {
        name: blend.name,
        items: blend.items.length > 0 ? blend.items.map((item) => ({ ...item })) : [createEmptyBlendItem()],
        targetFlavor: splitFlavors(blend.targetFlavor),
        createdAt: blend.createdAt,
        state: blend.state,
      };
      state.editingId = blend.id;
    },
    clearBlendNotice(state) {
      state.notice = '';
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchBlends.pending, (state) => {
        state.loading = true;
        state.error = '';
      })
      .addCase(fetchBlends.fulfilled, (state, action) => {
        state.loading = false;
        state.blends = action.payload;
      })
      .addCase(fetchBlends.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? '拼配方案读取失败';
      })
      .addCase(createBlend.fulfilled, (state, action) => {
        state.loading = false;
        state.blends = action.payload;
        state.draft = emptyBlendDraft();
        state.notice = '拼配方案已保存';
      })
      .addCase(createBlend.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? '拼配方案保存失败';
      })
      .addCase(updateBlend.fulfilled, (state, action) => {
        state.loading = false;
        state.blends = action.payload;
        state.editingId = null;
        state.notice = '拼配方案已更新';
      })
      .addCase(updateBlend.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? '拼配方案更新失败';
      })
      .addCase(deleteBlend.fulfilled, (state, action) => {
        state.blends = action.payload;
      })
      .addCase(deleteBlend.rejected, (state, action) => {
        state.error = action.error.message ?? '拼配方案删除失败';
      })
      .addCase(advanceBlendState.fulfilled, (state, action) => {
        state.blends = action.payload;
        state.notice = '方案状态已流转';
      })
      .addCase(advanceBlendState.rejected, (state, action) => {
        state.error = action.error.message ?? '方案状态流转失败';
      })
      .addCase(importBlendDraft.fulfilled, (state, action) => {
        state.blends = action.payload;
        state.notice = '方案 JSON 已导入';
      })
      .addCase(importBlendDraft.rejected, (state, action) => {
        state.error = action.error.message ?? '方案 JSON 导入失败';
      });
  },
});

export const {
  setBlendFilters,
  resetBlendFilters,
  setBlendDraftField,
  setDraftItems,
  addDraftItem,
  updateDraftItem,
  removeDraftItem,
  balanceDraftItems,
  resetBlendDraft,
  loadBlendDraft,
  clearBlendNotice,
} = blendSlice.actions;

export const selectBlendState = (state: RootState): BlendStateShape => state.blends;

export const selectBlendDraft = (state: RootState): BlendDraftState => state.blends.draft;

/** 草稿占比合计 */
export const selectDraftRatioTotal = createSelector([selectBlendDraft], (draft) => totalRatioPct(draft.items));

/** 草稿占比是否合规（合计 100%） */
export const selectDraftRatioValid = createSelector([selectBlendDraft], (draft) => isRatioValid(draft.items));

/** 草稿中参与批次（烘焙记录）的杯测均分 */
export const selectDraftAverageScore = createSelector(
  [selectBlendDraft, (state: RootState) => state.cuppings.cuppings],
  (draft, cuppings) => {
    const profileIds = new Set(draft.items.map((item) => item.profileId).filter(Boolean));
    const related = cuppings.filter((cupping) => profileIds.has(cupping.profileId));
    return averageScore(related);
  },
);

export interface BlendRow extends Blend {
  ratioTotal: number;
  ratioValid: boolean;
  averageScore: number;
  cuppingCount: number;
}

/** 拼配列表行：附占比合计、校验结果与参批次杯测均分 */
export const selectBlendRows = createSelector(
  [selectBlendState, (state: RootState) => state.cuppings.cuppings],
  (blendState, cuppings): BlendRow[] =>
    blendState.blends.map((blend) => {
      const profileIds = new Set(blend.items.map((item) => item.profileId).filter(Boolean));
      const related = cuppings.filter((cupping) => profileIds.has(cupping.profileId));
      return {
        ...blend,
        ratioTotal: totalRatioPct(blend.items),
        ratioValid: isRatioValid(blend.items),
        averageScore: averageScore(related),
        cuppingCount: related.length,
      };
    }),
);

/** 关键字 + 状态 + 目标风味 + 占比校验过滤 */
export const selectFilteredBlendRows = createSelector([selectBlendRows, selectBlendState], (rows, blendState) => {
  const { keyword, states, flavors, ratio } = blendState.filters;
  const needle = keyword.trim().toLowerCase();
  return rows.filter((row) => {
    if (needle) {
      const haystack = `${row.name} ${row.targetFlavor}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    if (states.length > 0 && !states.includes(row.state)) return false;
    if (flavors.length > 0 && !splitFlavors(row.targetFlavor).some((flavor) => flavors.includes(flavor))) return false;
    if (ratio.length > 0) {
      const flag: RatioFlag = row.ratioValid ? 'valid' : 'invalid';
      if (!ratio.includes(flag)) return false;
    }
    return true;
  });
});

export const selectBlendFilterOptions = createSelector([selectBlendRows], (rows) => ({
  flavors: Array.from(new Set(rows.flatMap((row) => splitFlavors(row.targetFlavor)))).sort((a, b) =>
    a.localeCompare(b, 'zh-Hans-CN'),
  ),
  states: BLEND_STATE_ORDER,
}));

export const selectBlendStats = createSelector([selectBlendRows], (rows) => ({
  total: rows.length,
  valid: rows.filter((row) => row.ratioValid).length,
  invalid: rows.filter((row) => !row.ratioValid).length,
  finalized: rows.filter((row) => row.state === 'final').length,
  averageScore:
    rows.filter((row) => row.cuppingCount > 0).length > 0
      ? Math.round(
          (rows.filter((row) => row.cuppingCount > 0).reduce((acc, row) => acc + row.averageScore, 0) /
            rows.filter((row) => row.cuppingCount > 0).length) *
            10,
        ) / 10
      : 0,
}));

export default blendSlice.reducer;
