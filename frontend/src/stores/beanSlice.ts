/**
 * 生豆 slice：维护生豆列表、筛选条件、选中项与增删改动作。
 * 跨页状态（筛选条件、列表数据）统一放在这里，页面只通过 useSelector / useDispatch 交互。
 */
import { createAsyncThunk, createSelector, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { BeanProcess, GreenBean, GreenBeanDraft } from '../types/greenbean';
import { BEAN_PROCESS_ORDER, stockLevelOf } from '../types/greenbean';
import {
  consumeStockForProfile,
  createId,
  listGreenBeans,
  nowIso,
  putGreenBean,
  removeGreenBean,
  type StockConsumeResult,
} from '../utils/db';
import type { RootState } from './store';

export type StockLevel = 'ok' | 'low' | 'empty';

export interface BeanFilters {
  keyword: string;
  processes: BeanProcess[];
  origins: string[];
  stockLevels: StockLevel[];
}

interface BeanState {
  greenBeans: GreenBean[];
  loading: boolean;
  error: string;
  filters: BeanFilters;
  selectedId: string | null;
  /** 下豆扣减后的余量提醒文案 */
  stockNotice: string;
}

export const initialBeanFilters: BeanFilters = {
  keyword: '',
  processes: [],
  origins: [],
  stockLevels: [],
};

const initialState: BeanState = {
  greenBeans: [],
  loading: false,
  error: '',
  filters: initialBeanFilters,
  selectedId: null,
  stockNotice: '',
};

export const fetchGreenBeans = createAsyncThunk('beans/fetchAll', async () => listGreenBeans());

export const createGreenBean = createAsyncThunk('beans/create', async (draft: GreenBeanDraft) => {
  const stamp = nowIso();
  const row: GreenBean = { ...draft, id: createId('gb'), createdAt: stamp, updatedAt: stamp };
  await putGreenBean(row);
  return listGreenBeans();
});

export const updateGreenBean = createAsyncThunk(
  'beans/update',
  async (input: { id: string; draft: GreenBeanDraft }) => {
    const stamp = nowIso();
    const row: GreenBean = { ...input.draft, id: input.id, createdAt: stamp, updatedAt: stamp };
    const existing = (await listGreenBeans()).find((bean) => bean.id === input.id);
    await putGreenBean({ ...row, createdAt: existing ? existing.createdAt : stamp });
    return listGreenBeans();
  },
);

export const deleteGreenBean = createAsyncThunk('beans/remove', async (id: string) => {
  await removeGreenBean(id);
  return listGreenBeans();
});

export interface ConsumeStockPayload extends StockConsumeResult {
  greenBeans: GreenBean[];
}

/** 烘焙下豆后按载量自动扣减在库重量（级联刷新生豆列表） */
export const consumeStock = createAsyncThunk<ConsumeStockPayload, string>(
  'beans/consumeStock',
  async (profileId: string) => {
    const result = await consumeStockForProfile(profileId);
    const greenBeans = await listGreenBeans();
    return { ...result, greenBeans };
  },
);

const beanSlice = createSlice({
  name: 'beans',
  initialState,
  reducers: {
    setBeanFilters(state, action: PayloadAction<Partial<BeanFilters>>) {
      state.filters = { ...state.filters, ...action.payload };
    },
    resetBeanFilters(state) {
      state.filters = initialBeanFilters;
    },
    setBeanSelectedId(state, action: PayloadAction<string | null>) {
      state.selectedId = action.payload;
    },
    clearStockNotice(state) {
      state.stockNotice = '';
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchGreenBeans.pending, (state) => {
        state.loading = true;
        state.error = '';
      })
      .addCase(fetchGreenBeans.fulfilled, (state, action) => {
        state.loading = false;
        state.greenBeans = action.payload;
      })
      .addCase(fetchGreenBeans.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? '生豆读取失败';
      })
      .addCase(createGreenBean.pending, (state) => {
        state.loading = true;
        state.error = '';
      })
      .addCase(createGreenBean.fulfilled, (state, action) => {
        state.loading = false;
        state.greenBeans = action.payload;
      })
      .addCase(createGreenBean.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? '生豆新建失败';
      })
      .addCase(updateGreenBean.pending, (state) => {
        state.loading = true;
        state.error = '';
      })
      .addCase(updateGreenBean.fulfilled, (state, action) => {
        state.loading = false;
        state.greenBeans = action.payload;
      })
      .addCase(updateGreenBean.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? '生豆更新失败';
      })
      .addCase(deleteGreenBean.pending, (state) => {
        state.loading = true;
        state.error = '';
      })
      .addCase(deleteGreenBean.fulfilled, (state, action) => {
        state.loading = false;
        state.greenBeans = action.payload;
        if (state.selectedId && !action.payload.some((bean) => bean.id === state.selectedId)) {
          state.selectedId = null;
        }
      })
      .addCase(deleteGreenBean.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? '生豆删除失败';
      })
      .addCase(consumeStock.fulfilled, (state, action) => {
        state.greenBeans = action.payload.greenBeans;
        state.stockNotice = action.payload.message;
      })
      .addCase(consumeStock.rejected, (state, action) => {
        state.stockNotice = action.error.message ?? '库存扣减失败';
      });
  },
});

export const { setBeanFilters, resetBeanFilters, setBeanSelectedId, clearStockNotice } = beanSlice.actions;

export const selectBeanState = (state: RootState): BeanState => state.beans;

export const selectBeanFilterOptions = createSelector([selectBeanState], (beanState) => {
  const origins = Array.from(new Set(beanState.greenBeans.map((bean) => bean.origin))).sort((a, b) =>
    a.localeCompare(b, 'zh-Hans-CN'),
  );
  const processes = BEAN_PROCESS_ORDER.filter((process) =>
    beanState.greenBeans.some((bean) => bean.process === process),
  );
  return { origins, processes };
});

/** 关键字 + 处理法 + 产地 + 余量分档过滤（真实过滤列表） */
export const selectFilteredGreenBeans = createSelector([selectBeanState], (beanState) => {
  const { keyword, processes, origins, stockLevels } = beanState.filters;
  const needle = keyword.trim().toLowerCase();
  return beanState.greenBeans.filter((bean) => {
    if (needle) {
      const haystack = `${bean.origin} ${bean.farm}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    if (processes.length > 0 && !processes.includes(bean.process)) return false;
    if (origins.length > 0 && !origins.includes(bean.origin)) return false;
    if (stockLevels.length > 0 && !stockLevels.includes(stockLevelOf(bean.stockKg))) return false;
    return true;
  });
});

export const selectBeanStats = createSelector([selectBeanState], (beanState) => {
  const stockKg = Math.round(beanState.greenBeans.reduce((acc, bean) => acc + bean.stockKg, 0) * 100) / 100;
  return {
    total: beanState.greenBeans.length,
    stockKg,
    lowStock: beanState.greenBeans.filter((bean) => stockLevelOf(bean.stockKg) !== 'ok').length,
    origins: new Set(beanState.greenBeans.map((bean) => bean.origin)).size,
  };
});

export default beanSlice.reducer;
