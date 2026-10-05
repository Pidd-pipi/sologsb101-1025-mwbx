/**
 * 杯测 slice：维护杯测列表、分项草稿与总分派生（加权总分 + 分档结论），并支持总分排序。
 */
import { createAsyncThunk, createSelector, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Cupping, CuppingGrade, CuppingParts } from '../types/cupping';
import {
  CUPPING_FIELDS,
  CUPPING_GRADES,
  averageScore,
  cuppingGradeOf,
  normalizePartScore,
  partsOf,
  weightedTotalScore,
} from '../types/cupping';
import type { RoastState } from '../types/roastprofile';
import { ROAST_STATE_ORDER } from '../types/roastprofile';
import type { GreenBean } from '../types/greenbean';
import type { BeanProcess } from '../types/greenbean';
import { createId, listCuppings, nowIso, putCupping, removeCupping } from '../utils/db';
import type { RootState } from './store';

/** 分项草稿（跨页共享：杯测页表单 + 拼配页均分回显） */
export interface CuppingDraftState {
  profileId: string;
  cuppedAt: string;
  dryAroma: number;
  wetAroma: number;
  acidity: number;
  sweetness: number;
  aftertaste: number;
}

export interface CuppingFilters {
  keyword: string;
  grades: string[];
  origins: string[];
  profileStates: RoastState[];
}

interface CuppingStateShape {
  cuppings: Cupping[];
  loading: boolean;
  error: string;
  filters: CuppingFilters;
  draft: CuppingDraftState;
  editingId: string | null;
  /** true：总分从高到低 */
  sortDesc: boolean;
  notice: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export const emptyCuppingDraft = (): CuppingDraftState => ({
  profileId: '',
  cuppedAt: today(),
  dryAroma: 8,
  wetAroma: 8,
  acidity: 8,
  sweetness: 8,
  aftertaste: 8,
});

export const initialCuppingFilters: CuppingFilters = {
  keyword: '',
  grades: [],
  origins: [],
  profileStates: [],
};

const initialState: CuppingStateShape = {
  cuppings: [],
  loading: false,
  error: '',
  filters: initialCuppingFilters,
  draft: emptyCuppingDraft(),
  editingId: null,
  sortDesc: true,
  notice: '',
};

export const fetchCuppings = createAsyncThunk('cuppings/fetchAll', async () => listCuppings());

export const createCupping = createAsyncThunk('cuppings/create', async (draft: CuppingDraftState) => {
  const stamp = nowIso();
  const row: Cupping = {
    id: createId('cp'),
    profileId: draft.profileId,
    cuppedAt: draft.cuppedAt,
    dryAroma: normalizePartScore(draft.dryAroma),
    wetAroma: normalizePartScore(draft.wetAroma),
    acidity: normalizePartScore(draft.acidity),
    sweetness: normalizePartScore(draft.sweetness),
    aftertaste: normalizePartScore(draft.aftertaste),
    totalScore: weightedTotalScore(draft),
    createdAt: stamp,
    updatedAt: stamp,
  };
  await putCupping(row);
  return listCuppings();
});

export const updateCupping = createAsyncThunk(
  'cuppings/update',
  async (input: { id: string; draft: CuppingDraftState }) => {
    const existing = (await listCuppings()).find((cupping) => cupping.id === input.id);
    const stamp = nowIso();
    const row: Cupping = {
      id: input.id,
      profileId: input.draft.profileId,
      cuppedAt: input.draft.cuppedAt,
      dryAroma: normalizePartScore(input.draft.dryAroma),
      wetAroma: normalizePartScore(input.draft.wetAroma),
      acidity: normalizePartScore(input.draft.acidity),
      sweetness: normalizePartScore(input.draft.sweetness),
      aftertaste: normalizePartScore(input.draft.aftertaste),
      totalScore: weightedTotalScore(input.draft),
      createdAt: existing ? existing.createdAt : stamp,
      updatedAt: stamp,
    };
    await putCupping(row);
    return listCuppings();
  },
);

export const deleteCupping = createAsyncThunk('cuppings/remove', async (id: string) => {
  await removeCupping(id);
  return listCuppings();
});

const cuppingSlice = createSlice({
  name: 'cuppings',
  initialState,
  reducers: {
    setCuppingFilters(state, action: PayloadAction<Partial<CuppingFilters>>) {
      state.filters = { ...state.filters, ...action.payload };
    },
    resetCuppingFilters(state) {
      state.filters = initialCuppingFilters;
    },
    setDraftField(state, action: PayloadAction<{ field: keyof CuppingDraftState; value: string | number }>) {
      const { field, value } = action.payload;
      switch (field) {
        case 'profileId':
          state.draft.profileId = String(value);
          break;
        case 'cuppedAt':
          state.draft.cuppedAt = String(value);
          break;
        case 'dryAroma':
          state.draft.dryAroma = normalizePartScore(Number(value));
          break;
        case 'wetAroma':
          state.draft.wetAroma = normalizePartScore(Number(value));
          break;
        case 'acidity':
          state.draft.acidity = normalizePartScore(Number(value));
          break;
        case 'sweetness':
          state.draft.sweetness = normalizePartScore(Number(value));
          break;
        case 'aftertaste':
          state.draft.aftertaste = normalizePartScore(Number(value));
          break;
        default:
          break;
      }
    },
    resetCuppingDraft(state) {
      state.draft = { ...emptyCuppingDraft(), profileId: state.draft.profileId };
      state.editingId = null;
    },
    loadCuppingDraft(state, action: PayloadAction<Cupping>) {
      const cupping = action.payload;
      state.draft = { ...partsOf(cupping), profileId: cupping.profileId, cuppedAt: cupping.cuppedAt };
      state.editingId = cupping.id;
    },
    setCuppingSortDesc(state, action: PayloadAction<boolean>) {
      state.sortDesc = action.payload;
    },
    clearCuppingNotice(state) {
      state.notice = '';
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchCuppings.pending, (state) => {
        state.loading = true;
        state.error = '';
      })
      .addCase(fetchCuppings.fulfilled, (state, action) => {
        state.loading = false;
        state.cuppings = action.payload;
      })
      .addCase(fetchCuppings.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? '杯测记录读取失败';
      })
      .addCase(createCupping.fulfilled, (state, action) => {
        state.loading = false;
        state.cuppings = action.payload;
        state.draft = emptyCuppingDraft();
        state.notice = '杯测记录已保存';
      })
      .addCase(createCupping.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? '杯测记录保存失败';
      })
      .addCase(updateCupping.fulfilled, (state, action) => {
        state.loading = false;
        state.cuppings = action.payload;
        state.editingId = null;
        state.notice = '杯测记录已更新';
      })
      .addCase(updateCupping.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? '杯测记录更新失败';
      })
      .addCase(deleteCupping.fulfilled, (state, action) => {
        state.cuppings = action.payload;
      })
      .addCase(deleteCupping.rejected, (state, action) => {
        state.error = action.error.message ?? '杯测记录删除失败';
      });
  },
});

export const {
  setCuppingFilters,
  resetCuppingFilters,
  setDraftField,
  resetCuppingDraft,
  loadCuppingDraft,
  setCuppingSortDesc,
  clearCuppingNotice,
} = cuppingSlice.actions;

/** 杯测列表行：回显所属烘焙记录与生豆信息 */
export interface CuppingRow extends Cupping {
  machineModel: string;
  roastedAt: string;
  roastState: RoastState | 'unknown';
  origin: string;
  farm: string;
  process: BeanProcess | 'unknown';
  grade: CuppingGrade;
}

export const selectCuppingState = (state: RootState): CuppingStateShape => state.cuppings;

export const selectCuppingDraft = (state: RootState): CuppingDraftState => state.cuppings.draft;

export const selectDraftParts = createSelector([selectCuppingDraft], (draft): CuppingParts => partsOf(draft));

/** 分项加权总分（实时派生） */
export const selectDraftTotalScore = createSelector([selectDraftParts], (parts) => weightedTotalScore(parts));

/** 分档结论标签（实时派生） */
export const selectDraftGrade = createSelector([selectDraftTotalScore], (score) => cuppingGradeOf(score));

export const selectCuppingRows = createSelector(
  [
    selectCuppingState,
    (state: RootState) => state.roasts.profiles,
    (state: RootState) => state.beans.greenBeans,
  ],
  (cuppingState, profiles, beans): CuppingRow[] => {
    const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
    const beanMap = new Map<string, GreenBean>(beans.map((bean) => [bean.id, bean]));
    return cuppingState.cuppings.map((cupping) => {
      const profile = profileMap.get(cupping.profileId);
      const bean = profile ? beanMap.get(profile.greenBeanId) : undefined;
      return {
        ...cupping,
        machineModel: profile ? profile.machineModel : '（记录已删除）',
        roastedAt: profile ? profile.roastedAt : '—',
        roastState: profile ? profile.state : 'unknown',
        origin: bean ? bean.origin : '（生豆已删除）',
        farm: bean ? bean.farm : '',
        process: bean ? bean.process : 'unknown',
        grade: cuppingGradeOf(cupping.totalScore),
      };
    });
  },
);

/** 关键字 + 分档 + 产地 + 烘焙状态过滤，并按总分排序 */
export const selectFilteredCuppingRows = createSelector(
  [selectCuppingRows, selectCuppingState],
  (rows, cuppingState): CuppingRow[] => {
    const { keyword, grades, origins, profileStates } = cuppingState.filters;
    const needle = keyword.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (needle) {
        const haystack = `${row.machineModel} ${row.origin} ${row.farm} ${row.cuppedAt}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (grades.length > 0 && !grades.includes(row.grade.label)) return false;
      if (origins.length > 0 && !origins.includes(row.origin)) return false;
      if (profileStates.length > 0 && !profileStates.includes(row.roastState as RoastState)) return false;
      return true;
    });
    return [...filtered].sort((a, b) =>
      cuppingState.sortDesc ? b.totalScore - a.totalScore : a.totalScore - b.totalScore,
    );
  },
);

export const selectCuppingFilterOptions = createSelector([selectCuppingRows], (rows) => ({
  origins: Array.from(new Set(rows.map((row) => row.origin))).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
  grades: CUPPING_GRADES.map((grade) => grade.label),
  states: ROAST_STATE_ORDER,
}));

export const selectCuppingStats = createSelector([selectCuppingState], (cuppingState) => {
  const cuppings = cuppingState.cuppings;
  const best = cuppings.reduce<Cupping | null>(
    (acc, cupping) => (acc === null || cupping.totalScore > acc.totalScore ? cupping : acc),
    null,
  );
  return {
    total: cuppings.length,
    average: averageScore(cuppings),
    best: best ? best.totalScore : 0,
    excellent: cuppings.filter((cupping) => cupping.totalScore >= 85).length,
    fields: CUPPING_FIELDS,
  };
});

export default cuppingSlice.reducer;
