/**
 * /curves 烘焙曲线关键点录入
 * 消费 Event、RoastProfile、GreenBean；复用 <FilterBar>、<StatBadge>、<EmptyPanel>、<ScoreTag>、<ConflictResolver>。
 * 交互：曲线节点增删改、HTML5 原生拖拽排序（写回 atSec）、缺关键节点补录提示、
 *       烘焙记录新建/编辑与状态流转、下豆原子写入（节点+状态+库存同事务）、曲线档案 JSON 导出。
 * 跨标签页并发：保存前比对乐观锁版本号，冲突时弹出 <ConflictResolver> 逐项裁决
 *       （曲线节点 / 载量 / 记录状态等差异逐项采用或保留），未决项不允许入库。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  App as AntdApp,
  AutoComplete,
  Button,
  Card,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  HolderOutlined,
  PlusOutlined,
  StepForwardOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import FilterBar, { type FilterSelectConfig } from '../components/common/FilterBar';
import EmptyPanel from '../components/common/EmptyPanel';
import ScoreTag from '../components/common/ScoreTag';
import StatBadge from '../components/common/StatBadge';
import ConflictResolver, { type ConflictChoice, type ConflictItem } from '../components/common/ConflictResolver';
import { useRoastCurve } from '../hooks/useRoastCurve';
import { useAppDispatch, useAppSelector } from '../stores/store';
import { fetchGreenBeans, selectBeanState } from '../stores/beanSlice';
import {
  commitEventOrder,
  createRoastProfile,
  deleteEvent,
  deleteRoastProfile,
  fetchEvents,
  fetchMachineTemplates,
  fetchRoastProfiles,
  isRoastConflict,
  moveDraftEvent,
  resetRoastFilters,
  saveDropAndConsume,
  saveEvent,
  selectCurrentProfile,
  selectFilteredRoastProfiles,
  selectMachineModelOptions,
  selectRoastState,
  setCurrentProfileId,
  setRoastFilters,
  shiftDraftEvent,
  updateRoastProfile,
  type EventInput,
} from '../stores/roastSlice';
import { fetchCuppings } from '../stores/cuppingSlice';
import { fetchBlends } from '../stores/blendSlice';
import {
  AIRFLOW_COLOR,
  AIRFLOW_LABEL,
  AIRFLOW_OPTIONS,
  GAS_LEVEL_OPTIONS,
  MACHINE_MODEL_OPTIONS,
  ROAST_STATE_COLOR,
  ROAST_STATE_LABEL,
  ROAST_STATE_OPTIONS,
  type Airflow,
  type RoastProfile,
  type RoastProfileDraft,
  type RoastState,
} from '../types/roastprofile';
import { BEAN_PROCESS_LABEL } from '../types/greenbean';
import {
  EVENT_TYPE_COLOR,
  EVENT_TYPE_LABEL,
  EVENT_TYPE_OPTIONS,
  type RoastEvent,
  type RoastEventDraft,
  type RoastEventType,
} from '../types/event';
import { formatSeconds, suggestRorPerMin, suggestEventTime, suggestTempC } from '../utils/curve';
import { exportRoastCurveJson } from '../utils/export';

interface ProfileFormValues {
  greenBeanId: string;
  machineModel: string;
  chargeG: number;
  chargeTempC: number;
  airflow: Airflow;
  gasLevel: number;
  roastedAt: Dayjs;
  state: RoastState;
}

interface EventFormValues {
  type: RoastEventType;
  atSec: number;
  beanTempC: number;
  rorPerMin: number;
  note: string;
}

/** 把已保存事件转换成草稿（可带覆盖字段） */
function toDraft(event: RoastEvent, patch: Partial<RoastEventDraft> = {}): RoastEventDraft {
  return {
    profileId: event.profileId,
    type: event.type,
    atSec: event.atSec,
    beanTempC: event.beanTempC,
    rorPerMin: event.rorPerMin,
    note: event.note,
    ...patch,
  };
}

/** 把烘焙记录转换成可编辑草稿 */
function profileToDraft(profile: RoastProfile): RoastProfileDraft {
  return {
    greenBeanId: profile.greenBeanId,
    machineModel: profile.machineModel,
    chargeG: profile.chargeG,
    chargeTempC: profile.chargeTempC,
    airflow: profile.airflow,
    gasLevel: profile.gasLevel,
    roastedAt: profile.roastedAt,
    state: profile.state,
  };
}

/** 烘焙记录冲突待裁决：记录我的草稿与库内当前值，mode 区分普通保存 / 下豆原子写入 */
interface ProfileConflictState {
  id: string;
  draft: RoastProfileDraft;
  current: RoastProfile;
  mode: 'update' | 'drop';
  /** drop 模式下需要一并重试的下豆节点 */
  eventInput?: EventInput;
}

/** 曲线节点冲突待裁决 */
interface EventConflictState {
  input: EventInput;
  current: RoastEvent;
  /** 来自下豆原子流程时携带：裁决后重试原子写入而不是普通保存 */
  dropContext?: { profileDraft?: RoastProfileDraft; expectedProfileVersion: number };
}

export default function CurveEntry() {
  const dispatch = useAppDispatch();
  const { message, modal } = AntdApp.useApp();
  const [profileForm] = Form.useForm<ProfileFormValues>();
  const [eventForm] = Form.useForm<EventFormValues>();

  const roastState = useAppSelector(selectRoastState);
  const beanState = useAppSelector(selectBeanState);
  const currentProfile = useAppSelector(selectCurrentProfile);
  const filteredProfiles = useAppSelector(selectFilteredRoastProfiles);
  const modelOptions = useAppSelector(selectMachineModelOptions);

  const curve = useRoastCurve(roastState.currentProfileId);

  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  /** 编辑中的记录版本号（乐观锁：保存时据此比对） */
  const [editingProfileVersion, setEditingProfileVersion] = useState(1);
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<RoastEvent | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const [quickEdit, setQuickEdit] = useState<{ id: string; atSec: number; beanTempC: number } | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  /** 并发冲突待裁决：烘焙记录 / 曲线节点 / 时间轴排序 */
  const [profileConflict, setProfileConflict] = useState<ProfileConflictState | null>(null);
  const [eventConflict, setEventConflict] = useState<EventConflictState | null>(null);
  const [orderConflict, setOrderConflict] = useState<RoastEvent[] | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    void dispatch(fetchRoastProfiles());
    void dispatch(fetchMachineTemplates());
  }, [dispatch]);

  // 当前烘焙记录变化时加载它的曲线事件
  useEffect(() => {
    if (roastState.currentProfileId) {
      void dispatch(fetchEvents(roastState.currentProfileId));
    }
  }, [dispatch, roastState.currentProfileId]);

  const beanMap = useMemo(() => new Map(beanState.greenBeans.map((bean) => [bean.id, bean])), [beanState.greenBeans]);

  /** 烘焙记录差异项：双方不一致的字段逐项列出（载量、记录状态等） */
  const buildProfileItems = (mine: RoastProfileDraft, theirs: RoastProfile, includeState: boolean): ConflictItem[] => {
    const beanName = (id: string): string => {
      const bean = beanMap.get(id);
      return bean ? `${bean.origin} · ${bean.farm}` : '（生豆已删除）';
    };
    const items: ConflictItem[] = [];
    if (mine.greenBeanId !== theirs.greenBeanId) {
      items.push({ key: 'greenBeanId', label: '生豆', mine: beanName(mine.greenBeanId), theirs: beanName(theirs.greenBeanId) });
    }
    if (mine.machineModel !== theirs.machineModel) {
      items.push({ key: 'machineModel', label: '机型号', mine: mine.machineModel, theirs: theirs.machineModel });
    }
    if (mine.chargeG !== theirs.chargeG) {
      items.push({ key: 'chargeG', label: '载量', mine: `${mine.chargeG} g`, theirs: `${theirs.chargeG} g` });
    }
    if (mine.chargeTempC !== theirs.chargeTempC) {
      items.push({ key: 'chargeTempC', label: '入豆温', mine: `${mine.chargeTempC} ℃`, theirs: `${theirs.chargeTempC} ℃` });
    }
    if (mine.airflow !== theirs.airflow) {
      items.push({ key: 'airflow', label: '风门', mine: AIRFLOW_LABEL[mine.airflow], theirs: AIRFLOW_LABEL[theirs.airflow] });
    }
    if (mine.gasLevel !== theirs.gasLevel) {
      items.push({ key: 'gasLevel', label: '火力档', mine: `${mine.gasLevel} 档`, theirs: `${theirs.gasLevel} 档` });
    }
    if (mine.roastedAt !== theirs.roastedAt) {
      items.push({ key: 'roastedAt', label: '烘焙日期', mine: mine.roastedAt, theirs: theirs.roastedAt });
    }
    if (includeState && mine.state !== theirs.state) {
      items.push({
        key: 'state',
        label: '记录状态',
        mine: ROAST_STATE_LABEL[mine.state],
        theirs: ROAST_STATE_LABEL[theirs.state],
      });
    }
    return items;
  };

  /** 曲线节点差异项：类型 / 秒点 / 豆温 / RoR / 备注逐项列出 */
  const buildEventItems = (mine: RoastEventDraft, theirs: RoastEvent): ConflictItem[] => {
    const items: ConflictItem[] = [];
    if (mine.type !== theirs.type) {
      items.push({ key: 'type', label: '节点类型', mine: EVENT_TYPE_LABEL[mine.type], theirs: EVENT_TYPE_LABEL[theirs.type] });
    }
    if (mine.atSec !== theirs.atSec) {
      items.push({
        key: 'atSec',
        label: '秒点',
        mine: `${formatSeconds(mine.atSec)}（${mine.atSec}s）`,
        theirs: `${formatSeconds(theirs.atSec)}（${theirs.atSec}s）`,
      });
    }
    if (mine.beanTempC !== theirs.beanTempC) {
      items.push({ key: 'beanTempC', label: '豆温', mine: `${mine.beanTempC} ℃`, theirs: `${theirs.beanTempC} ℃` });
    }
    if (mine.rorPerMin !== theirs.rorPerMin) {
      items.push({ key: 'rorPerMin', label: 'RoR', mine: `${mine.rorPerMin} ℃/min`, theirs: `${theirs.rorPerMin} ℃/min` });
    }
    if (mine.note !== theirs.note) {
      items.push({ key: 'note', label: '备注', mine: mine.note || '—', theirs: theirs.note || '—' });
    }
    return items;
  };

  /** 按裁决合并：选「保留对方」的字段取库内当前值，其余保留我的修改 */
  const mergeByChoices = <T extends object>(mine: T, theirs: T, choices: Record<string, ConflictChoice>): T => {
    const merged: T = { ...mine };
    Object.entries(choices).forEach(([key, choice]) => {
      if (choice === 'theirs') {
        (merged as Record<string, unknown>)[key] = (theirs as Record<string, unknown>)[key];
      }
    });
    return merged;
  };

  /** 事件类型筛选：真实过滤时间轴展示的行 */
  const visibleEvents = useMemo(() => {
    const types = roastState.filters.eventTypes;
    if (types.length === 0) return roastState.draftEvents;
    return roastState.draftEvents.filter((event) => types.includes(event.type));
  }, [roastState.draftEvents, roastState.filters.eventTypes]);

  const typeFilterActive = roastState.filters.eventTypes.length > 0;

  const selects: FilterSelectConfig[] = [
    { key: 'state', label: '记录状态', options: ROAST_STATE_OPTIONS },
    {
      key: 'model',
      label: '机型',
      width: 170,
      options: (modelOptions.length > 0 ? modelOptions : MACHINE_MODEL_OPTIONS).map((model) => ({
        value: model,
        label: model,
      })),
    },
    { key: 'type', label: '节点类型', width: 180, options: EVENT_TYPE_OPTIONS },
  ];

  const handleFilterChange = (key: string, values: string[]): void => {
    if (key === 'state') dispatch(setRoastFilters({ states: values as RoastState[] }));
    if (key === 'model') dispatch(setRoastFilters({ machineModels: values }));
    if (key === 'type') dispatch(setRoastFilters({ eventTypes: values as RoastEventType[] }));
  };

  /* ------------------------------ 烘焙记录 ------------------------------ */

  const openCreateProfile = (): void => {
    setEditingProfileId(null);
    setTemplateId(null);
    profileForm.resetFields();
    profileForm.setFieldsValue({
      greenBeanId: beanState.greenBeans[0]?.id ?? '',
      machineModel: modelOptions[0] ?? MACHINE_MODEL_OPTIONS[0],
      chargeG: 500,
      chargeTempC: 198,
      airflow: 'half',
      gasLevel: 4,
      roastedAt: dayjs(),
      state: 'recording',
    });
    setProfileDrawerOpen(true);
  };

  const openEditProfile = (profile: RoastProfile): void => {
    setEditingProfileId(profile.id);
    setEditingProfileVersion(profile.version);
    setTemplateId(null);
    profileForm.setFieldsValue({
      greenBeanId: profile.greenBeanId,
      machineModel: profile.machineModel,
      chargeG: profile.chargeG,
      chargeTempC: profile.chargeTempC,
      airflow: profile.airflow,
      gasLevel: profile.gasLevel,
      roastedAt: dayjs(profile.roastedAt),
      state: profile.state,
    });
    setProfileDrawerOpen(true);
  };

  const applyTemplate = (id: string): void => {
    const template = roastState.machines.find((item) => item.id === id);
    if (!template) return;
    setTemplateId(id);
    profileForm.setFieldsValue({
      machineModel: template.model,
      airflow: template.airflow,
      gasLevel: template.gasLevel,
      chargeG: template.chargeG,
    });
    message.success(`已套用模板：${template.model} · ${template.chargeG}g`);
  };

  /**
   * 带版本守卫的记录更新：保存前比对版本号；冲突时若有实质差异则弹窗逐项裁决，
   * 若双方内容一致（仅版本号被推进）则直接以最新版本重试。
   * 返回 true 表示已入库；false 表示存在待裁决冲突（弹窗已打开）。
   */
  const attemptProfileUpdate = async (id: string, draft: RoastProfileDraft, expectedVersion: number): Promise<boolean> => {
    try {
      await dispatch(updateRoastProfile({ id, draft, expectedVersion })).unwrap();
      return true;
    } catch (error) {
      if (isRoastConflict(error) && error.kind === 'profile' && error.currentProfile) {
        const current = error.currentProfile;
        if (buildProfileItems(draft, current, true).length === 0) {
          return attemptProfileUpdate(id, draft, current.version);
        }
        setProfileConflict({ id, draft, current, mode: 'update' });
        return false;
      }
      throw error;
    }
  };

  const handleProfileSubmit = async (values: ProfileFormValues): Promise<void> => {
    const draft: RoastProfileDraft = {
      greenBeanId: values.greenBeanId,
      machineModel: values.machineModel.trim(),
      chargeG: Math.round(values.chargeG),
      chargeTempC: Math.round(values.chargeTempC),
      airflow: values.airflow,
      gasLevel: values.gasLevel,
      roastedAt: values.roastedAt.format('YYYY-MM-DD'),
      state: values.state,
    };
    try {
      if (editingProfileId) {
        const saved = await attemptProfileUpdate(editingProfileId, draft, editingProfileVersion);
        if (!saved) return; // 冲突待裁决，抽屉保持打开
        message.success('烘焙记录已更新');
      } else {
        await dispatch(createRoastProfile(draft)).unwrap();
        message.success('烘焙记录已创建，可以开始录入曲线节点');
      }
      setProfileDrawerOpen(false);
    } catch (error) {
      message.error(`保存失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  /** 记录冲突裁决完成：合并后按库内最新版本重试（普通保存 / 下豆原子写入） */
  const handleProfileConflictResolve = async (choices: Record<string, ConflictChoice>): Promise<void> => {
    if (!profileConflict) return;
    setResolving(true);
    try {
      const merged = mergeByChoices(profileConflict.draft, profileToDraft(profileConflict.current), choices);
      if (profileConflict.mode === 'update') {
        const saved = await attemptProfileUpdate(profileConflict.id, merged, profileConflict.current.version);
        if (!saved) return; // 再次冲突，弹窗内容已刷新为最新差异
        message.success('已按逐项裁决合并入库');
        setProfileConflict(null);
        setProfileDrawerOpen(false);
      } else if (profileConflict.eventInput) {
        await runDropAndConsume(profileConflict.eventInput, merged, profileConflict.current.version);
      }
    } catch (error) {
      message.error(`合并失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setResolving(false);
    }
  };

  const handleDeleteProfile = (profile: RoastProfile): void => {
    modal.confirm({
      title: `删除烘焙记录「${profile.machineModel} · ${profile.roastedAt}」？`,
      content: '将级联删除该记录的曲线节点与杯测记录，并从拼配配方中摘除该成分。',
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      async onOk() {
        await dispatch(deleteRoastProfile(profile.id)).unwrap();
        await Promise.all([dispatch(fetchCuppings()).unwrap(), dispatch(fetchBlends()).unwrap()]);
        message.success('烘焙记录已删除');
      },
    });
  };

  /* ------------------------------ 曲线节点 ------------------------------ */

  const openCreateEvent = (preset?: { type?: RoastEventType; atSec?: number; beanTempC?: number }): void => {
    if (!currentProfile) {
      message.warning('请先选择或新建一条烘焙记录');
      return;
    }
    setEditingEvent(null);
    const type = preset?.type ?? 'turning';
    const atSec = preset?.atSec ?? suggestEventTime(curve.events, type);
    const beanTempC = preset?.beanTempC ?? suggestTempC(curve.events, type);
    eventForm.setFieldsValue({
      type,
      atSec,
      beanTempC,
      rorPerMin: suggestRorPerMin(curve.events, atSec, beanTempC),
      note: '',
    });
    setEventModalOpen(true);
  };

  const openEditEvent = (event: RoastEvent): void => {
    setEditingEvent(event);
    eventForm.setFieldsValue({
      type: event.type,
      atSec: event.atSec,
      beanTempC: event.beanTempC,
      rorPerMin: event.rorPerMin,
      note: event.note,
    });
    setEventModalOpen(true);
  };

  /**
   * 带版本守卫的节点保存：冲突时若有实质差异则弹窗逐项裁决，
   * 内容一致（仅版本号被推进）则直接以最新版本重试。
   */
  const attemptEventSave = async (input: EventInput): Promise<boolean> => {
    try {
      await dispatch(saveEvent(input)).unwrap();
      return true;
    } catch (error) {
      if (isRoastConflict(error) && error.kind === 'event' && error.currentEvent) {
        const current = error.currentEvent;
        if (buildEventItems(input.draft, current).length === 0) {
          return attemptEventSave({ ...input, expectedVersion: current.version });
        }
        setEventConflict({ input, current });
        return false;
      }
      throw error;
    }
  };

  /** 普通保存节点（不入库扣减） */
  const runSaveEvent = async (input: EventInput): Promise<void> => {
    try {
      const saved = await attemptEventSave(input);
      if (!saved) return; // 冲突待裁决
      message.success(input.id ? '曲线节点已更新' : '曲线节点已新增');
      setEventModalOpen(false);
      setEditingEvent(null);
    } catch (error) {
      message.error(`保存失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  /**
   * 下豆原子写入：同一事务内保存下豆节点 + 记录置为已完成 + 按载量扣减库存。
   * 两个标签页同时下豆时，后进入的事务会被拒绝，库存只扣一次。
   * 返回 true 表示流程已完结（成功或业务拒绝）；false 表示有待裁决冲突（弹窗已打开）。
   */
  const runDropAndConsume = async (
    input: EventInput,
    profileDraft?: RoastProfileDraft,
    expectedProfileVersion?: number,
  ): Promise<boolean> => {
    if (!currentProfile) return true;
    const profileVersion = expectedProfileVersion ?? currentProfile.version;
    try {
      const payload = await dispatch(
        saveDropAndConsume({
          profileId: currentProfile.id,
          expectedProfileVersion: profileVersion,
          profileDraft,
          eventInput: input,
        }),
      ).unwrap();
      await dispatch(fetchGreenBeans()).unwrap();
      if (payload.result.ok) {
        message.success(payload.result.message);
        setEventModalOpen(false);
        setEditingEvent(null);
        setProfileConflict(null);
      } else {
        message.warning(payload.result.message);
      }
      return true;
    } catch (error) {
      if (isRoastConflict(error)) {
        if (error.kind === 'profile' && error.currentProfile) {
          // 记录版本冲突：我的侧 = 当前看到的记录字段（下豆会把它置为已完成）
          const mine: RoastProfileDraft = { ...(profileDraft ?? profileToDraft(currentProfile)), state: 'done' };
          const current = error.currentProfile;
          if (buildProfileItems(mine, current, false).length === 0) {
            return runDropAndConsume(input, profileDraft, current.version);
          }
          setProfileConflict({ id: currentProfile.id, draft: mine, current, mode: 'drop', eventInput: input });
          return false;
        }
        if (error.kind === 'event' && error.currentEvent) {
          const current = error.currentEvent;
          if (buildEventItems(input.draft, current).length === 0) {
            return runDropAndConsume({ ...input, expectedVersion: current.version }, profileDraft, profileVersion);
          }
          setEventConflict({
            input,
            current,
            dropContext: { profileDraft, expectedProfileVersion: profileVersion },
          });
          return false;
        }
      }
      message.error(`下豆失败：${error instanceof Error ? error.message : '未知错误'}`);
      return true;
    }
  };

  const handleEventSubmit = async (values: EventFormValues): Promise<void> => {
    if (!currentProfile) return;
    const draft: RoastEventDraft = {
      profileId: currentProfile.id,
      type: values.type,
      atSec: Math.round(values.atSec),
      beanTempC: Math.round(values.beanTempC * 10) / 10,
      rorPerMin: Math.round(values.rorPerMin * 10) / 10,
      note: values.note?.trim() ?? '',
    };
    const input: EventInput = {
      profileId: currentProfile.id,
      draft,
      id: editingEvent?.id,
      createdAt: editingEvent?.createdAt,
      expectedVersion: editingEvent?.version,
    };
    // 记录中 + 下豆节点：先确认是否同事务扣减库存并完成记录（状态、节点、库存一起写入）
    if (draft.type === 'drop' && currentProfile.state === 'recording') {
      const bean = beanMap.get(currentProfile.greenBeanId);
      const kg = Math.round((currentProfile.chargeG / 1000) * 1000) / 1000;
      modal.confirm({
        title: '保存下豆节点',
        content: bean
          ? `「下豆并扣减完成」会在同一事务中保存节点、从「${bean.origin} · ${bean.farm}」（在库 ${bean.stockKg}kg）扣减 ${kg}kg 并把记录置为「已完成」；「仅保存节点」则稍后再到机型页扣减。`
          : '未找到关联生豆，「下豆并完成」仅保存节点并把记录置为「已完成」；「仅保存节点」则只保存节点。',
        okText: '下豆并扣减完成',
        cancelText: '仅保存节点',
        onOk: () => runDropAndConsume(input),
        onCancel: () => runSaveEvent(input),
      });
      return;
    }
    await runSaveEvent(input);
  };

  /** 节点冲突裁决完成：合并后按库内最新版本重试（普通保存 / 下豆原子写入） */
  const handleEventConflictResolve = async (choices: Record<string, ConflictChoice>): Promise<void> => {
    if (!eventConflict) return;
    setResolving(true);
    try {
      const merged = mergeByChoices(eventConflict.input.draft, toDraft(eventConflict.current), choices);
      const nextInput: EventInput = {
        ...eventConflict.input,
        draft: merged,
        expectedVersion: eventConflict.current.version,
      };
      if (eventConflict.dropContext) {
        const done = await runDropAndConsume(
          nextInput,
          eventConflict.dropContext.profileDraft,
          eventConflict.dropContext.expectedProfileVersion,
        );
        if (done) setEventConflict(null);
      } else {
        const saved = await attemptEventSave(nextInput);
        if (!saved) return; // 再次冲突，弹窗内容已刷新
        message.success('已按逐项裁决合并入库');
        setEventConflict(null);
        setEventModalOpen(false);
        setEditingEvent(null);
      }
    } catch (error) {
      message.error(`合并失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setResolving(false);
    }
  };

  const handleDeleteEvent = (event: RoastEvent): void => {
    modal.confirm({
      title: `删除节点「${EVENT_TYPE_LABEL[event.type]} @ ${formatSeconds(event.atSec)}」？`,
      content: '删除后曲线的发展率与分段 RoR 会立即重算。',
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      async onOk() {
        await dispatch(deleteEvent({ id: event.id, profileId: event.profileId })).unwrap();
        message.success('曲线节点已删除');
      },
    });
  };

  /** 把草稿顺序（atSec 已重排）写回 Dexie；版本冲突时弹窗裁决 */
  const persistOrder = async (): Promise<void> => {
    try {
      await dispatch(commitEventOrder()).unwrap();
      message.success('时间轴顺序已写回本地库，atSec 已按新顺序重排');
    } catch (error) {
      if (isRoastConflict(error) && error.kind === 'eventOrder' && error.currentEvents) {
        setOrderConflict(error.currentEvents);
        return;
      }
      message.error(`写回失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  /** 排序冲突裁决：采用我的排序（强制写回）或保留对方（重新拉取库内时间轴） */
  const handleOrderConflictResolve = async (choices: Record<string, ConflictChoice>): Promise<void> => {
    if (!orderConflict || !roastState.currentProfileId) return;
    setResolving(true);
    try {
      if (choices.order === 'mine') {
        await dispatch(commitEventOrder({ force: true })).unwrap();
        message.success('已采用我的排序写回本地库（对方修改的节点字段已保留）');
      } else {
        await dispatch(fetchEvents(roastState.currentProfileId)).unwrap();
        message.success('已保留对方的时间轴顺序');
      }
      setOrderConflict(null);
    } catch (error) {
      message.error(`合并失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setResolving(false);
    }
  };

  const handleDrop = (targetIndex: number): void => {
    const from = dragIndexRef.current;
    if (from === null || from === targetIndex) {
      setDraggingIndex(null);
      setDragOverIndex(null);
      return;
    }
    dispatch(moveDraftEvent({ from, to: targetIndex }));
    setDraggingIndex(null);
    setDragOverIndex(null);
    dragIndexRef.current = null;
    void persistOrder();
  };

  const handleShift = (index: number, offset: number): void => {
    dispatch(shiftDraftEvent({ index, offset }));
    void persistOrder();
  };

  const handleQuickSave = async (event: RoastEvent): Promise<void> => {
    if (!quickEdit) return;
    const others = curve.events.filter((item) => item.id !== event.id);
    try {
      const saved = await attemptEventSave({
        profileId: event.profileId,
        id: event.id,
        createdAt: event.createdAt,
        expectedVersion: event.version,
        draft: toDraft(event, {
          atSec: Math.round(quickEdit.atSec),
          beanTempC: Math.round(quickEdit.beanTempC * 10) / 10,
          rorPerMin: suggestRorPerMin(others, Math.round(quickEdit.atSec), quickEdit.beanTempC),
        }),
      });
      if (!saved) return; // 冲突待裁决
      message.success('秒点与豆温已更新');
      setQuickEdit(null);
    } catch (error) {
      message.error(`保存失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleExport = (): void => {
    if (!currentProfile) {
      message.warning('请先选择一条烘焙记录');
      return;
    }
    const filename = exportRoastCurveJson(
      currentProfile,
      beanMap.get(currentProfile.greenBeanId),
      curve.events,
      curve,
    );
    message.success(`已导出曲线档案：${filename}`);
  };

  const profileOptions = filteredProfiles.map((profile) => {
    const bean = beanMap.get(profile.greenBeanId);
    return {
      value: profile.id,
      label: `${profile.roastedAt} · ${profile.machineModel} · ${bean ? bean.origin : '（生豆已删除）'} · ${profile.chargeG}g`,
    };
  });

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <FilterBar
        keyword={roastState.filters.keyword}
        onKeywordChange={(keyword) => dispatch(setRoastFilters({ keyword }))}
        selects={selects}
        value={{
          state: roastState.filters.states,
          model: roastState.filters.machineModels,
          type: roastState.filters.eventTypes,
        }}
        onChange={handleFilterChange}
        onReset={() => dispatch(resetRoastFilters())}
        searchPlaceholder="搜索机型 / 日期 / 状态"
        summary={<StatBadge compact label="烘焙记录" value={profileOptions.length} suffix={`/ ${roastState.profiles.length}`} tone="gold" />}
        extra={
          <Space>
            <Button icon={<DownloadOutlined />} onClick={handleExport}>
              导出曲线
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateProfile}>
              新建烘焙记录
            </Button>
          </Space>
        }
      />

      <Card
        title="选择烘焙记录"
        styles={{ body: { paddingTop: 12 } }}
        extra={<span className="gb-muted">曲线节点挂在烘焙记录下，可在右侧编辑机型与状态</span>}
      >
        <Space wrap size={12} align="center">
          <Select
            showSearch
            optionFilterProp="label"
            style={{ minWidth: 380 }}
            placeholder="选择要录入曲线的烘焙记录"
            value={roastState.currentProfileId ?? undefined}
            options={profileOptions}
            onChange={(value: string) => dispatch(setCurrentProfileId(value))}
          />
          {currentProfile ? (
            <>
              <Tag color={ROAST_STATE_COLOR[currentProfile.state]}>{ROAST_STATE_LABEL[currentProfile.state]}</Tag>
              <Tag color={AIRFLOW_COLOR[currentProfile.airflow]}>风门{AIRFLOW_LABEL[currentProfile.airflow]}</Tag>
              <Tag color="#a8632c">火力 {currentProfile.gasLevel} 档</Tag>
              <Tag>载量 {currentProfile.chargeG}g</Tag>
              <Tag>入豆 {currentProfile.chargeTempC}℃</Tag>
              <Button size="small" icon={<EditOutlined />} onClick={() => openEditProfile(currentProfile)}>
                编辑记录
              </Button>
              <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteProfile(currentProfile)}>
                删除记录
              </Button>
            </>
          ) : (
            <Typography.Text type="secondary">暂无可选记录</Typography.Text>
          )}
        </Space>
      </Card>

      {!currentProfile ? (
        <Card>
          <EmptyPanel
            title="还没有烘焙记录"
            description="先新建一条烘焙记录（生豆 + 机型 + 载量 + 入豆温），再逐点录入回温、脱水结束、一爆、二爆、下豆。"
            actionText="新建烘焙记录"
            onAction={openCreateProfile}
          />
        </Card>
      ) : (
        <>
          <Card title="曲线概览" styles={{ body: { paddingTop: 12 } }}>
            <div className="gb-stat-row">
              <StatBadge label="已录节点" value={curve.events.length} suffix=" / 5" tone="brown" />
              <StatBadge label="总烘焙时间" value={curve.totalReadable} tone="blue" hint="入豆 0 秒 → 下豆" />
              <StatBadge label="发展时间" value={curve.devReadable} tone="gold" hint="一爆 → 下豆" />
              <StatBadge label="平均 RoR" value={curve.averageRor} suffix=" ℃/min" tone="green" />
              <StatBadge label="峰值 RoR" value={curve.peakRor} suffix=" ℃/min" tone={curve.peakRor > 16 ? 'red' : 'default'} />
              <StatBadge
                label="缺关键节点"
                value={curve.missingTypes.length}
                suffix=" 个"
                tone={curve.missingTypes.length > 0 ? 'red' : 'green'}
              />
            </div>
            <Space wrap size={10}>
              <ScoreTag devRatioPct={curve.devRatioPct} devBand={curve.devBand} />
              <ScoreTag ror={curve.averageRor} label="平均 RoR" />
              <Tag color={curve.complete ? '#2f6f4f' : '#d48806'}>
                {curve.complete ? '关键节点齐全' : `关键节点缺 ${curve.missingTypes.length} 个`}
              </Tag>
            </Space>
          </Card>

          {curve.missingTypes.length > 0 ? (
            <Alert
              type="warning"
              showIcon
              message="缺少关键节点，请补录"
              description={
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  <span>
                    缺少：{curve.missingTypes.map((type) => EVENT_TYPE_LABEL[type]).join('、')}。点击下方按钮会带上建议秒点与豆温。
                  </span>
                  <Space wrap size={8}>
                    {curve.suggestions.map((suggestion) => (
                      <Button
                        key={suggestion.type}
                        size="small"
                        type="primary"
                        ghost
                        icon={<StepForwardOutlined />}
                        onClick={() =>
                          openCreateEvent({
                            type: suggestion.type,
                            atSec: suggestion.atSec,
                            beanTempC: suggestion.beanTempC,
                          })
                        }
                      >
                        {suggestion.text}
                      </Button>
                    ))}
                  </Space>
                </Space>
              }
            />
          ) : null}

          {curve.anomalyNotes.length > 0 ? (
            <Alert
              type="info"
              showIcon
              message="曲线提示"
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {curve.anomalyNotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              }
            />
          ) : null}

          <Card
            title="曲线时间轴（拖拽排序会重排 atSec 并写回本地库）"
            styles={{ body: { paddingTop: 12 } }}
            extra={
              <Space>
                {typeFilterActive ? <Tag color="#d48806">已按节点类型过滤，排序功能暂时关闭</Tag> : null}
                <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreateEvent()}>
                  新增节点
                </Button>
              </Space>
            }
          >
            {visibleEvents.length === 0 ? (
              <EmptyPanel
                title={curve.events.length === 0 ? '这条记录还没有曲线节点' : '没有符合节点类型筛选的节点'}
                description="按时间轴依次录入回温 → 脱水结束 → 一爆 → 二爆 → 下豆，系统会自动补算 RoR。"
                actionText="新增节点"
                onAction={() => openCreateEvent()}
                size="small"
              />
            ) : (
              <div className="gb-timeline">
                {visibleEvents.map((event, index) => {
                  const isDragging = draggingIndex === index;
                  const isDropTarget = dragOverIndex === index && draggingIndex !== index;
                  return (
                    <div
                      key={event.id}
                      className={`gb-timeline-row${isDragging ? ' is-dragging' : ''}${isDropTarget ? ' is-drop-target' : ''}`}
                      draggable={!typeFilterActive}
                      onDragStart={(dragEvent) => {
                        if (typeFilterActive) return;
                        dragIndexRef.current = index;
                        setDraggingIndex(index);
                        dragEvent.dataTransfer.effectAllowed = 'move';
                        dragEvent.dataTransfer.setData('text/plain', String(index));
                      }}
                      onDragOver={(dragEvent) => {
                        if (typeFilterActive) return;
                        dragEvent.preventDefault();
                        dragEvent.dataTransfer.dropEffect = 'move';
                        setDragOverIndex(index);
                      }}
                      onDrop={(dragEvent) => {
                        if (typeFilterActive) return;
                        dragEvent.preventDefault();
                        const from = dragIndexRef.current ?? Number(dragEvent.dataTransfer.getData('text/plain'));
                        dragIndexRef.current = from;
                        handleDrop(index);
                      }}
                      onDragEnd={() => {
                        setDraggingIndex(null);
                        setDragOverIndex(null);
                        dragIndexRef.current = null;
                      }}
                    >
                      <Tooltip title={typeFilterActive ? '清除节点类型筛选后可拖拽排序' : '按住拖拽调整时间轴顺序'}>
                        <span className="gb-drag-handle">
                          <HolderOutlined />
                        </span>
                      </Tooltip>
                      <span className="gb-timeline-index">{index + 1}</span>
                      <Tag color={EVENT_TYPE_COLOR[event.type]} style={{ minWidth: 78, textAlign: 'center' }}>
                        {EVENT_TYPE_LABEL[event.type]}
                      </Tag>

                      {quickEdit && quickEdit.id === event.id ? (
                        <Space size={6} wrap>
                          <InputNumber
                            size="small"
                            min={0}
                            max={1800}
                            addonAfter="秒"
                            value={quickEdit.atSec}
                            onChange={(value) =>
                              setQuickEdit({ ...quickEdit, atSec: Number(value ?? 0) })
                            }
                          />
                          <InputNumber
                            size="small"
                            min={60}
                            max={260}
                            step={0.1}
                            addonAfter="℃"
                            value={quickEdit.beanTempC}
                            onChange={(value) =>
                              setQuickEdit({ ...quickEdit, beanTempC: Number(value ?? 0) })
                            }
                          />
                          <Button size="small" type="primary" onClick={() => void handleQuickSave(event)}>
                            保存
                          </Button>
                          <Button size="small" onClick={() => setQuickEdit(null)}>
                            取消
                          </Button>
                        </Space>
                      ) : (
                        <Space size={10} wrap>
                          <span className="gb-mono">{formatSeconds(event.atSec)}（{event.atSec}s）</span>
                          <Tag color="#7a5230">{event.beanTempC} ℃</Tag>
                          <ScoreTag ror={event.rorPerMin} showIcon={false} />
                        </Space>
                      )}

                      <span className="gb-muted" style={{ flex: 1, minWidth: 120 }}>
                        {event.note || '—'}
                      </span>

                      <Space size={2}>
                        <Tooltip title="修改秒点 / 豆温">
                          <Button
                            size="small"
                            type="text"
                            icon={<EditOutlined />}
                            onClick={() =>
                              setQuickEdit({ id: event.id, atSec: event.atSec, beanTempC: event.beanTempC })
                            }
                          />
                        </Tooltip>
                        <Tooltip title="上移">
                          <Button
                            size="small"
                            type="text"
                            icon={<ArrowUpOutlined />}
                            disabled={typeFilterActive || index === 0}
                            onClick={() => handleShift(index, -1)}
                          />
                        </Tooltip>
                        <Tooltip title="下移">
                          <Button
                            size="small"
                            type="text"
                            icon={<ArrowDownOutlined />}
                            disabled={typeFilterActive || index === visibleEvents.length - 1}
                            onClick={() => handleShift(index, 1)}
                          />
                        </Tooltip>
                        <Tooltip title="编辑节点">
                          <Button size="small" type="text" onClick={() => openEditEvent(event)}>
                            详情
                          </Button>
                        </Tooltip>
                        <Tooltip title="删除节点">
                          <Button
                            size="small"
                            type="text"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => handleDeleteEvent(event)}
                          />
                        </Tooltip>
                      </Space>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      )}

      <Drawer
        title={editingProfileId ? '编辑烘焙记录' : '新建烘焙记录'}
        width={560}
        open={profileDrawerOpen}
        onClose={() => setProfileDrawerOpen(false)}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={() => setProfileDrawerOpen(false)}>取消</Button>
            <Button type="primary" loading={roastState.loading} onClick={() => profileForm.submit()}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={profileForm} layout="vertical" onFinish={handleProfileSubmit}>
          <Form.Item label="套用载量模板">
            <Select
              allowClear
              placeholder="选择机型模板快速填充风门 / 火力 / 载量"
              value={templateId ?? undefined}
              options={roastState.machines.map((template) => ({
                value: template.id,
                label: `${template.model} · 风门${AIRFLOW_LABEL[template.airflow]} · ${template.gasLevel} 档 · ${template.chargeG}g`,
              }))}
              onChange={(value: string | undefined) => {
                if (value) applyTemplate(value);
                else setTemplateId(null);
              }}
            />
          </Form.Item>
          <Form.Item name="greenBeanId" label="生豆" rules={[{ required: true, message: '请选择生豆' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择生豆批次"
              options={beanState.greenBeans.map((bean) => ({
                value: bean.id,
                label: `${bean.origin} · ${bean.farm}（在库 ${bean.stockKg}kg · ${BEAN_PROCESS_LABEL[bean.process]}）`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="machineModel"
            label="机型号"
            rules={[
              { required: true, message: '请填写机型号' },
              { min: 2, message: '机型号至少 2 个字符' },
            ]}
          >
            <AutoComplete
              options={(modelOptions.length > 0 ? modelOptions : MACHINE_MODEL_OPTIONS).map((model) => ({ value: model }))}
              filterOption={(input, option) => String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
            />
          </Form.Item>
          <Form.Item
            name="chargeG"
            label="载量（克）"
            dependencies={['greenBeanId']}
            rules={[
              { required: true, message: '请填写载量' },
              {
                validator: (_rule, value: number) =>
                  Number.isFinite(value) && value >= 50 && value <= 3000
                    ? Promise.resolve()
                    : Promise.reject(new Error('载量应在 50 - 3000 克之间')),
              },
            ]}
          >
            <InputNumber min={50} max={3000} step={50} style={{ width: '100%' }} addonAfter="g" />
          </Form.Item>
          <Form.Item
            name="chargeTempC"
            label="入豆温（℃）"
            rules={[
              { required: true, message: '请填写入豆温' },
              {
                validator: (_rule, value: number) =>
                  Number.isFinite(value) && value >= 150 && value <= 260
                    ? Promise.resolve()
                    : Promise.reject(new Error('入豆温应在 150 - 260℃ 之间')),
              },
            ]}
          >
            <InputNumber min={150} max={260} step={1} style={{ width: '100%' }} addonAfter="℃" />
          </Form.Item>
          <Form.Item name="airflow" label="风门" rules={[{ required: true, message: '请选择风门档位' }]}>
            <Select options={AIRFLOW_OPTIONS} />
          </Form.Item>
          <Form.Item name="gasLevel" label="火力档" rules={[{ required: true, message: '请选择火力档位' }]}>
            <Select options={GAS_LEVEL_OPTIONS} />
          </Form.Item>
          <Form.Item name="roastedAt" label="烘焙日期" rules={[{ required: true, message: '请选择烘焙日期' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="state" label="状态" rules={[{ required: true, message: '请选择状态' }]}>
            <Select options={ROAST_STATE_OPTIONS} />
          </Form.Item>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            提示：标记为「已完成」时会按载量扣减对应生豆的在库重量。
          </Typography.Text>
        </Form>
      </Drawer>

      <Modal
        title={editingEvent ? `编辑节点 · ${EVENT_TYPE_LABEL[editingEvent.type]}` : '新增曲线节点'}
        open={eventModalOpen}
        onCancel={() => {
          setEventModalOpen(false);
          setEditingEvent(null);
        }}
        onOk={() => eventForm.submit()}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={eventForm} layout="vertical" onFinish={handleEventSubmit}>
          <Form.Item name="type" label="节点类型" rules={[{ required: true, message: '请选择节点类型' }]}>
            <Select
              options={EVENT_TYPE_OPTIONS}
              onChange={(type: RoastEventType) => {
                const atSec = suggestEventTime(curve.events, type);
                const beanTempC = suggestTempC(curve.events, type);
                eventForm.setFieldsValue({
                  atSec,
                  beanTempC,
                  rorPerMin: suggestRorPerMin(curve.events, atSec, beanTempC),
                });
              }}
            />
          </Form.Item>
          <Form.Item
            name="atSec"
            label="时间（秒，以入豆为 0 秒）"
            rules={[
              { required: true, message: '请填写时间秒点' },
              {
                validator: (_rule, value: number) =>
                  Number.isFinite(value) && value >= 0 && value <= 1800
                    ? Promise.resolve()
                    : Promise.reject(new Error('秒点应在 0 - 1800 秒之间')),
              },
            ]}
          >
            <InputNumber min={0} max={1800} step={1} style={{ width: '100%' }} addonAfter="s" />
          </Form.Item>
          <Form.Item
            name="beanTempC"
            label="豆温（℃）"
            rules={[
              { required: true, message: '请填写豆温' },
              {
                validator: (_rule, value: number) =>
                  Number.isFinite(value) && value >= 60 && value <= 260
                    ? Promise.resolve()
                    : Promise.reject(new Error('豆温应在 60 - 260℃ 之间')),
              },
            ]}
          >
            <InputNumber min={60} max={260} step={0.1} style={{ width: '100%' }} addonAfter="℃" />
          </Form.Item>
          <Form.Item
            name="rorPerMin"
            label="升温速率 RoR（℃/min）"
            extra="留空或点「按前节点估算」可用前一个节点自动推算"
            rules={[{ required: true, message: '请填写 RoR' }]}
          >
            <InputNumber min={-20} max={40} step={0.1} style={{ width: '100%' }} addonAfter="℃/min" />
          </Form.Item>
          <Form.Item name="note" label="备注" rules={[{ max: 60, message: '不超过 60 个字符' }]}>
            <Input.TextArea rows={2} placeholder="如：一爆密集，火力回调至 3 档" />
          </Form.Item>
          <Button
            size="small"
            onClick={() => {
              const atSec = Number(eventForm.getFieldValue('atSec') ?? 0);
              const beanTempC = Number(eventForm.getFieldValue('beanTempC') ?? 0);
              const others = editingEvent ? curve.events.filter((item) => item.id !== editingEvent.id) : curve.events;
              eventForm.setFieldsValue({ rorPerMin: suggestRorPerMin(others, atSec, beanTempC) });
            }}
          >
            按前节点估算 RoR
          </Button>
        </Form>
      </Modal>

      {/* 烘焙记录冲突：逐项裁决载量 / 记录状态等差异，未决不能入库 */}
      <ConflictResolver
        open={profileConflict !== null}
        title="烘焙记录保存冲突"
        description={
          profileConflict?.mode === 'drop'
            ? '另一标签页修改了这条记录。请逐项裁决差异；合并后将在同一事务中保留下豆节点、置为「已完成」并扣减库存。'
            : '另一标签页修改了这条记录。请逐项比对载量、记录状态等差异并选择采用哪一方的值，全部裁决后才会合并入库。'
        }
        items={
          profileConflict
            ? buildProfileItems(profileConflict.draft, profileConflict.current, profileConflict.mode === 'update')
            : []
        }
        confirmLoading={resolving}
        onResolve={(choices) => void handleProfileConflictResolve(choices)}
        onCancel={() => {
          setProfileConflict(null);
          void dispatch(fetchRoastProfiles());
          message.info('已放弃本次修改，列表已刷新为最新内容');
        }}
      />

      {/* 曲线节点冲突：逐项裁决类型 / 秒点 / 豆温 / RoR / 备注 */}
      <ConflictResolver
        open={eventConflict !== null}
        title="曲线节点保存冲突"
        description="另一标签页修改了同一个曲线节点。请逐项比对差异并选择采用哪一方的值，全部裁决后才会合并入库。"
        items={eventConflict ? buildEventItems(eventConflict.input.draft, eventConflict.current) : []}
        confirmLoading={resolving}
        onResolve={(choices) => void handleEventConflictResolve(choices)}
        onCancel={() => {
          setEventConflict(null);
          if (roastState.currentProfileId) void dispatch(fetchEvents(roastState.currentProfileId));
          message.info('已放弃本次修改，曲线已刷新为最新内容');
        }}
      />

      {/* 时间轴排序冲突：整条时间轴二选一 */}
      <ConflictResolver
        open={orderConflict !== null}
        title="曲线排序写回冲突"
        description="另一标签页修改了这条曲线的节点。请选择采用我的排序写回（对方改过的节点字段会保留），或放弃排序、保留对方的时间轴。"
        items={
          orderConflict
            ? [
                {
                  key: 'order',
                  label: '时间轴顺序',
                  mine:
                    roastState.draftEvents
                      .map((event) => `${EVENT_TYPE_LABEL[event.type]} ${formatSeconds(event.atSec)}`)
                      .join(' → ') || '（空）',
                  theirs:
                    orderConflict
                      .map((event) => `${EVENT_TYPE_LABEL[event.type]} ${formatSeconds(event.atSec)}`)
                      .join(' → ') || '（空）',
                },
              ]
            : []
        }
        confirmLoading={resolving}
        onResolve={(choices) => void handleOrderConflictResolve(choices)}
        onCancel={() => {
          setOrderConflict(null);
          if (roastState.currentProfileId) void dispatch(fetchEvents(roastState.currentProfileId));
          message.info('已放弃本次排序，曲线已刷新为最新内容');
        }}
      />
    </Space>
  );
}
