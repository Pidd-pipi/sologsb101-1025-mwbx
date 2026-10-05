/**
 * Redux Toolkit store：汇总 4 个 slice，导出 RootState / AppDispatch 与类型化 hooks。
 * 首屏 bootstrapData 负责打开本地库（空库自动播种）并并发拉取全部表数据。
 */
import { configureStore, createAsyncThunk } from '@reduxjs/toolkit';
import { useDispatch, useSelector, type TypedUseSelectorHook } from 'react-redux';
import beanReducer, { fetchGreenBeans } from './beanSlice';
import roastReducer, { fetchMachineTemplates, fetchRoastProfiles } from './roastSlice';
import cuppingReducer, { fetchCuppings } from './cuppingSlice';
import blendReducer, { fetchBlends } from './blendSlice';
import { initDatabase } from '../utils/db';

export const store = configureStore({
  reducer: {
    beans: beanReducer,
    roasts: roastReducer,
    cuppings: cuppingReducer,
    blends: blendReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

/** 首屏初始化：打开 IndexedDB（空库播种演示数据）→ 并发加载各表 */
export const bootstrapData = createAsyncThunk('app/bootstrap', async (_arg: void, { dispatch }) => {
  await initDatabase();
  await Promise.all([
    dispatch(fetchGreenBeans()),
    dispatch(fetchRoastProfiles()),
    dispatch(fetchMachineTemplates()),
    dispatch(fetchCuppings()),
    dispatch(fetchBlends()),
  ]);
});

export default store;
