/**
 * 烘焙 slice：维护烘焙记录列表、当前记录的曲线事件与「曲线事件草稿」、
 * 载量模板（机型 / 风门 / 火力档）以及状态流转动作。
 */
import { createAsyncThunk, createSelector, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Airflow, MachineTemplate, MachineTemplateDraft, RoastProfile, RoastProfileDraft, RoastState } from '../types/roastprofile';
import { AIRFLOW_ORDER, ROAST_STATE_LABEL, chargeLevelOf } from '../types/roastprofile';
import type { RoastEvent, RoastEventDraft, RoastEventType } from '../types/event';
import {
  createId,
  listEvents,
  listMachineTemplates,
  listRoastProfiles,
  nowIso,
  putEvent,
  putEvents,
  putMachineTemplate,
  putRoastProfile,
  removeEvent,
  removeMachineTemplate,
  removeRoastProfile,
  updateRoastState,
} from '../utils/db';
import { reassignAtSecByOrder, sortEventsByTime, type DevBand } from '../utils/curve';
import type { RootState } from './store';

export type ChargeLevel = 'sample' | 'standard' | 'full';

export interface RoastFilters {
  keyword: string;
  machineModels: string[];
  states: RoastState[];
  /** /curves：按节点类型过滤时间轴 */
  eventTypes: RoastEventType[];
  /** /development：按发展率分档过滤 */
  devBands: DevBand[];
  /** /development：按是否存在异常提示过滤 */
  anomaly: Array<'hasAnomaly' | 'noAnomaly'>;
}

export interface MachineFilters {
  keyword: string;
  models: string[];
  airflow: Airflow[];
  chargeLevels: ChargeLevel[];
}

interface RoastStateShape {
  profiles: RoastProfile[];
  /** 当前选中烘焙记录的曲线事件（按时间升序） */
  events: RoastEvent[];
  /** 曲线事件草稿：拖拽排序 / 批量提交的临时顺序 */
  draftEvents: RoastEvent[];
  machines: MachineTemplate[];
  currentProfileId: string | null;
  loading: boolean;
  error: string;
  filters: RoastFilters;
  machineFilters: MachineFilters;
  notice: string;
}

export const initialRoastFilters: RoastFilters = {
  keyword: '',
  machineModels: [],
  states: [],
  eventTypes: [],
  devBands: [],
  anomaly: [],
};

export const initialMachineFilters: MachineFilters = {
  keyword: '',
  models: [],
  airflow: [],
  chargeLevels: [],
};

const initialState: RoastStateShape = {
  profiles: [],
  events: [],
  draftEvents: [],
  machines: [],
  currentProfileId: null,
  loading: false,
  error: '',
  filters: initialRoastFilters,
  machineFilters: initialMachineFilters,
  notice: '',
};

/* ------------------------------ 烘焙记录 ------------------------------ */

export const fetchRoastProfiles = createAsyncThunk('roasts/fetchProfiles', async () => listRoastProfiles());

export const createRoastProfile = createAsyncThunk('roasts/createProfile', async (draft: RoastProfileDraft) => {
  const stamp = nowIso();
  const row: RoastProfile = { ...draft, id: createId('rp'), createdAt: stamp, updatedAt: stamp };
  await putRoastProfile(row);
  return listRoastProfiles();
});

export const updateRoastProfile = createAsyncThunk(
  'roasts/updateProfile',
  async (input: { id: string; draft: RoastProfileDraft }) => {
    const profiles = await listRoastProfiles();
    const existing = profiles.find((profile) => profile.id === input.id);
    const stamp = nowIso();
    const row: RoastProfile = {
      ...input.draft,
      id: input.id,
      createdAt: existing ? existing.createdAt : stamp,
      updatedAt: stamp,
    };
    await putRoastProfile(row);
    return listRoastProfiles();
  },
);

export const deleteRoastProfile = createAsyncThunk('roasts/removeProfile', async (id: string) => {
  await removeRoastProfile(id);
  return listRoastProfiles();
});

/** 状态流转：记录中 → 已完成 / 作废（也可从已完成作废、从作废恢复） */
export const advanceRoastState = createAsyncThunk(
  'roasts/advanceState',
  async (input: { id: string; state: RoastState }) => {
    await updateRoastState(input.id, input.state);
    return listRoastProfiles();
  },
);

/* ------------------------------ 曲线事件 ------------------------------ */

export const fetchEvents = createAsyncThunk('roasts/fetchEvents', async (profileId: string) => listEvents(profileId));

export interface EventInput {
  profileId: string;
  draft: RoastEventDraft;
  /** 传入则为编辑 */
  id?: string;
  createdAt?: string;
}

export interface EventSaveResult {
  events: RoastEvent[];
  saved: RoastEvent;
}

export const saveEvent = createAsyncThunk<EventSaveResult, EventInput>(
  'roasts/saveEvent',
  async (input: EventInput) => {
    const stamp = nowIso();
    const row: RoastEvent = {
      ...input.draft,
      id: input.id ?? createId('ev'),
      createdAt: input.createdAt ?? stamp,
      updatedAt: stamp,
    };
    await putEvent(row);
    const events = await listEvents(input.profileId);
    return { events, saved: row };
  },
);

export const deleteEvent = createAsyncThunk(
  'roasts/deleteEvent',
  async (input: { id: string; profileId: string }) => listEvents(input.profileId).then(async (rows) => {
    await removeEvent(input.id);
    return rows.filter((row) => row.id !== input.id);
  }),
);

/**
 * 提交拖拽排序：按当前草稿顺序重排 atSec 并写回 Dexie。
 * 保留原有时间集合，逐个映射到新顺序，保证时间轴顺序与 atSec 升序一致。
 */
export const commitEventOrder = createAsyncThunk<RoastEvent[], void, { state: RootState }>(
  'roasts/commitEventOrder',
  async (_arg, { getState }) => {
    const { draftEvents, currentProfileId } = getState().roasts;
    if (!currentProfileId || draftEvents.length === 0) return [];
    const remapped = reassignAtSecByOrder(draftEvents).map((event) => ({ ...event, updatedAt: nowIso() }));
    await putEvents(remapped);
    return listEvents(currentProfileId);
  },
);

/* ------------------------------ 载量模板 ------------------------------ */

export const fetchMachineTemplates = createAsyncThunk('roasts/fetchMachines', async () => listMachineTemplates());

export const saveMachineTemplate = createAsyncThunk(
  'roasts/saveMachine',
  async (input: { id?: string; draft: MachineTemplateDraft }) => {
    const stamp = nowIso();
    const row: MachineTemplate = {
      ...input.draft,
      id: input.id ?? createId('mt'),
      createdAt: stamp,
      updatedAt: stamp,
    };
    if (input.id) {
      const existing = (await listMachineTemplates()).find((item) => item.id === input.id);
      if (existing) row.createdAt = existing.createdAt;
    }
    await putMachineTemplate(row);
    return listMachineTemplates();
  },
);

export const deleteMachineTemplate = createAsyncThunk('roasts/removeMachine', async (id: string) => {
  await removeMachineTemplate(id);
  return listMachineTemplates();
});

/* -------------------------------- slice -------------------------------- */

const roastSlice = createSlice({
  name: 'roasts',
  initialState,
  reducers: {
    setRoastFilters(state, action: PayloadAction<Partial<RoastFilters>>) {
      state.filters = { ...state.filters, ...action.payload };
    },
    resetRoastFilters(state) {
      state.filters = initialRoastFilters;
    },
    setMachineFilters(state, action: PayloadAction<Partial<MachineFilters>>) {
      state.machineFilters = { ...state.machineFilters, ...action.payload };
    },
    resetMachineFilters(state) {
      state.machineFilters = initialMachineFilters;
    },
    setCurrentProfileId(state, action: PayloadAction<string | null>) {
      state.currentProfileId = action.payload;
      if (action.payload === null) {
        state.events = [];
        state.draftEvents = [];
      }
    },
    setDraftEvents(state, action: PayloadAction<RoastEvent[]>) {
      state.draftEvents = sortEventsByTime(action.payload);
    },
    /** 拖拽排序：把 from 位置的节点移动到 to 位置（HTML5 原生拖拽调用） */
    moveDraftEvent(state, action: PayloadAction<{ from: number; to: number }>) {
      const { from, to } = action.payload;
      if (from === to || from < 0 || to < 0 || from >= state.draftEvents.length || to >= state.draftEvents.length) {
        return;
      }
      const next = [...state.draftEvents];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      state.draftEvents = next;
    },
    /** 上移 / 下移（键盘或按钮的兜底排序方式） */
    shiftDraftEvent(state, action: PayloadAction<{ index: number; offset: number }>) {
      const { index, offset } = action.payload;
      const target = index + offset;
      if (index < 0 || index >= state.draftEvents.length || target < 0 || target >= state.draftEvents.length) return;
      const next = [...state.draftEvents];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      state.draftEvents = next;
    },
    clearRoastNotice(state) {
      state.notice = '';
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchRoastProfiles.pending, (state) => {
        state.loading = true;
        state.error = '';
      })
      .addCase(fetchRoastProfiles.fulfilled, (state, action) => {
        state.loading = false;
        state.profiles = action.payload;
        if (state.currentProfileId && !action.payload.some((profile) => profile.id === state.currentProfileId)) {
          state.currentProfileId = action.payload.length > 0 ? action.payload[0].id : null;
        }
        if (!state.currentProfileId && action.payload.length > 0) {
          state.currentProfileId = action.payload[0].id;
        }
      })
      .addCase(fetchRoastProfiles.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? '烘焙记录读取失败';
      })
      .addCase(createRoastProfile.fulfilled, (state, action) => {
        state.profiles = action.payload;
        const latest = action.payload[0];
        if (latest) state.currentProfileId = latest.id;
      })
      .addCase(createRoastProfile.rejected, (state, action) => {
        state.error = action.error.message ?? '烘焙记录新建失败';
      })
      .addCase(updateRoastProfile.fulfilled, (state, action) => {
        state.profiles = action.payload;
      })
      .addCase(updateRoastProfile.rejected, (state, action) => {
        state.error = action.error.message ?? '烘焙记录更新失败';
      })
      .addCase(deleteRoastProfile.fulfilled, (state, action) => {
        state.profiles = action.payload;
        if (state.currentProfileId && !action.payload.some((profile) => profile.id === state.currentProfileId)) {
          state.currentProfileId = action.payload.length > 0 ? action.payload[0].id : null;
          state.events = [];
          state.draftEvents = [];
        }
      })
      .addCase(deleteRoastProfile.rejected, (state, action) => {
        state.error = action.error.message ?? '烘焙记录删除失败';
      })
      .addCase(advanceRoastState.fulfilled, (state, action) => {
        state.profiles = action.payload;
      })
      .addCase(advanceRoastState.rejected, (state, action) => {
        state.error = action.error.message ?? '状态流转失败';
      })
      .addCase(fetchEvents.fulfilled, (state, action) => {
        state.events = action.payload;
        state.draftEvents = action.payload;
      })
      .addCase(fetchEvents.rejected, (state, action) => {
        state.error = action.error.message ?? '曲线事件读取失败';
      })
      .addCase(saveEvent.fulfilled, (state, action) => {
        state.events = action.payload.events;
        state.draftEvents = action.payload.events;
        state.notice = '曲线节点已保存';
      })
      .addCase(saveEvent.rejected, (state, action) => {
        state.error = action.error.message ?? '曲线节点保存失败';
      })
      .addCase(deleteEvent.fulfilled, (state, action) => {
        state.events = action.payload;
        state.draftEvents = action.payload;
      })
      .addCase(deleteEvent.rejected, (state, action) => {
        state.error = action.error.message ?? '曲线节点删除失败';
      })
      .addCase(commitEventOrder.fulfilled, (state, action) => {
        if (action.payload.length > 0) {
          state.events = action.payload;
          state.draftEvents = action.payload;
          state.notice = '曲线顺序与 atSec 已写回本地库';
        }
      })
      .addCase(commitEventOrder.rejected, (state, action) => {
        state.error = action.error.message ?? '曲线排序写回失败';
      })
      .addCase(fetchMachineTemplates.fulfilled, (state, action) => {
        state.machines = action.payload;
      })
      .addCase(fetchMachineTemplates.rejected, (state, action) => {
        state.error = action.error.message ?? '载量模板读取失败';
      })
      .addCase(saveMachineTemplate.fulfilled, (state, action) => {
        state.machines = action.payload;
        state.notice = '载量模板已保存';
      })
      .addCase(saveMachineTemplate.rejected, (state, action) => {
        state.error = action.error.message ?? '载量模板保存失败';
      })
      .addCase(deleteMachineTemplate.fulfilled, (state, action) => {
        state.machines = action.payload;
      })
      .addCase(deleteMachineTemplate.rejected, (state, action) => {
        state.error = action.error.message ?? '载量模板删除失败';
      });
  },
});

export const {
  setRoastFilters,
  resetRoastFilters,
  setMachineFilters,
  resetMachineFilters,
  setCurrentProfileId,
  setDraftEvents,
  moveDraftEvent,
  shiftDraftEvent,
  clearRoastNotice,
} = roastSlice.actions;

export const selectRoastState = (state: RootState): RoastStateShape => state.roasts;

export const selectCurrentProfile = createSelector([selectRoastState], (roastState) =>
  roastState.profiles.find((profile) => profile.id === roastState.currentProfileId) ?? null,
);

/** 关键字 + 机型 + 状态 + 节点类型过滤 */
export const selectFilteredRoastProfiles = createSelector([selectRoastState], (roastState) => {
  const { keyword, machineModels, states } = roastState.filters;
  const needle = keyword.trim().toLowerCase();
  return roastState.profiles.filter((profile) => {
    if (needle) {
      const haystack = `${profile.machineModel} ${profile.roastedAt} ${ROAST_STATE_LABEL[profile.state]}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    if (machineModels.length > 0 && !machineModels.includes(profile.machineModel)) return false;
    if (states.length > 0 && !states.includes(profile.state)) return false;
    return true;
  });
});

export const selectMachineFilteredProfiles = createSelector([selectRoastState], (roastState) => {
  const { keyword, models, airflow, chargeLevels } = roastState.machineFilters;
  const needle = keyword.trim().toLowerCase();
  return roastState.profiles.filter((profile) => {
    if (needle) {
      const haystack = `${profile.machineModel} ${profile.roastedAt}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    if (models.length > 0 && !models.includes(profile.machineModel)) return false;
    if (airflow.length > 0 && !airflow.includes(profile.airflow)) return false;
    if (chargeLevels.length > 0 && !chargeLevels.includes(chargeLevelOf(profile.chargeG))) return false;
    return true;
  });
});

/** 机型候选：模板机型 + 已用机型 */
export const selectMachineModelOptions = createSelector([selectRoastState], (roastState) => {
  const models = new Set<string>();
  roastState.machines.forEach((machine) => models.add(machine.model));
  roastState.profiles.forEach((profile) => models.add(profile.machineModel));
  return Array.from(models).filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
});

export const selectMachineFilteredTemplates = createSelector([selectRoastState], (roastState) => {
  const { keyword, models, airflow, chargeLevels } = roastState.machineFilters;
  const needle = keyword.trim().toLowerCase();
  return roastState.machines.filter((machine) => {
    if (needle) {
      const haystack = `${machine.model} ${machine.note}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    if (models.length > 0 && !models.includes(machine.model)) return false;
    if (airflow.length > 0 && !airflow.includes(machine.airflow)) return false;
    if (chargeLevels.length > 0 && !chargeLevels.includes(chargeLevelOf(machine.chargeG))) return false;
    return true;
  });
});

export const selectRoastStats = createSelector([selectRoastState], (roastState) => {
  const profiles = roastState.profiles;
  const chargeTotal = profiles.reduce((acc, profile) => acc + profile.chargeG, 0);
  return {
    total: profiles.length,
    recording: profiles.filter((profile) => profile.state === 'recording').length,
    done: profiles.filter((profile) => profile.state === 'done').length,
    voided: profiles.filter((profile) => profile.state === 'void').length,
    averageChargeG: profiles.length > 0 ? Math.round(chargeTotal / profiles.length) : 0,
    models: new Set(profiles.map((profile) => profile.machineModel)).size,
  };
});

export const selectMachineStats = createSelector([selectRoastState], (roastState) => ({
  templates: roastState.machines.length,
  averageChargeG:
    roastState.machines.length > 0
      ? Math.round(roastState.machines.reduce((acc, machine) => acc + machine.chargeG, 0) / roastState.machines.length)
      : 0,
  airflowCoverage: AIRFLOW_ORDER.filter((value) => roastState.machines.some((machine) => machine.airflow === value)).length,
  gasRange:
    roastState.machines.length > 0
      ? `${Math.min(...roastState.machines.map((machine) => machine.gasLevel))} - ${Math.max(
          ...roastState.machines.map((machine) => machine.gasLevel),
        )} 档`
      : '—',
}));

export default roastSlice.reducer;
