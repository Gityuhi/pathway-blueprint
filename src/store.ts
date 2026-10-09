import type { Node, Edge } from 'reactflow';
import type {
  NodeData,
  DailyLog,
  RoutineTask,
  RoutineFrequency,
  DailyTask,
  BacklogTask,
} from './types';
import { isSupabaseConfigured, requireUserId, supabase } from './lib/supabase';

export interface Roadmap {
  id: string;
  title: string;
  updatedAt: number;
  nodes: Node<NodeData>[];
  edges: Edge[];
}

const STORAGE_KEY = 'pathway-roadmaps';
const DAILY_STORAGE_KEY = 'pathway-daily-logs';
const ROUTINE_STORAGE_KEY = 'pathway-routine-tasks';
const ASSIGNED_ROADMAP_KEY = 'pathway-assigned-roadmap-id';
const BACKLOG_STORAGE_KEY = 'pathway-backlog-tasks';
const TODO_COLLAPSED_BLOCKS_KEY = 'pathway-todo-collapsed-blocks';

/** セッション中のメモリキャッシュ（タブ切替の再取得を防ぐ） */
let dailyLogsCache: DailyLog[] | null = null;
let dailyLogsInflight: Promise<DailyLog[]> | null = null;
let routineTasksCache: RoutineTask[] | null = null;
let backlogTasksCache: BacklogTask[] | null = null;
let userSettingsCache: {
  routineTasks: RoutineTask[];
  assignedRoadmapId: string | null;
  backlogTasks: BacklogTask[];
} | null = null;

const setDailyLogsCache = (logs: DailyLog[]) => {
  dailyLogsCache = logs;
};

const patchDailyLogCache = (log: DailyLog) => {
  const current = dailyLogsCache ?? [];
  const idx = current.findIndex((l) => l.date === log.date);
  if (idx >= 0) {
    const next = [...current];
    next[idx] = log;
    dailyLogsCache = next;
  } else {
    dailyLogsCache = [...current, log].sort((a, b) => b.date.localeCompare(a.date));
  }
};

// --- Helpers ---

export const getLocalDate = (date: Date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

export const createInitialRoadmap = (): Roadmap => {
  return {
    id: generateId(),
    title: '新規ロードマップ',
    updatedAt: Date.now(),
    nodes: [
      {
        id: 'root',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: { title: 'メインテーマ', todos: [], progress: 0 },
        selected: true,
      },
    ],
    edges: [],
  };
};

// --- localStorage backend (env 未設定時の一時復旧用) ---

const localLoadRoadmaps = (): Roadmap[] => {
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) return [];
  try {
    return JSON.parse(data);
  } catch (e) {
    console.error('Failed to parse roadmaps', e);
    return [];
  }
};

const localSaveRoadmaps = (roadmaps: Roadmap[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(roadmaps));
};

const localLoadDailyLogs = (): DailyLog[] => {
  const data = localStorage.getItem(DAILY_STORAGE_KEY);
  if (!data) return [];
  try {
    return JSON.parse(data);
  } catch (e) {
    console.error('Failed to parse daily logs', e);
    return [];
  }
};

const localSaveDailyLogs = (logs: DailyLog[]) => {
  localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(logs));
};

const normalizeRoutineTasks = (tasks: RoutineTask[]): RoutineTask[] =>
  tasks.map((t) => normalizeRoutineTask(t));

const clampInt = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(n)));

export const normalizeRoutineTask = (t: RoutineTask): RoutineTask => {
  const frequency: RoutineFrequency =
    t.frequency ?? (t.enabled === false ? 'off' : 'daily');

  const weekDay =
    typeof t.weekDay === 'number' && Number.isFinite(t.weekDay)
      ? clampInt(t.weekDay, 0, 6)
      : new Date().getDay();

  const monthDay =
    typeof t.monthDay === 'number' && Number.isFinite(t.monthDay)
      ? clampInt(t.monthDay, 1, 31)
      : new Date().getDate();

  const weekDays = Array.isArray(t.weekDays)
    ? [...new Set(
        t.weekDays
          .filter((d): d is number => typeof d === 'number' && Number.isFinite(d))
          .map((d) => clampInt(d, 0, 6))
      )].sort((a, b) => a - b)
    : frequency === 'custom'
      ? [new Date().getDay()]
      : [];

  return {
    id: t.id,
    text: t.text ?? '',
    frequency,
    weekDay,
    monthDay,
    weekDays,
  };
};

/** 指定日にそのルーティンを日次 ToDo へ載せるか */
export const isRoutineActiveOnDate = (
  routine: RoutineTask,
  date: Date = new Date()
): boolean => {
  const r = normalizeRoutineTask(routine);
  switch (r.frequency) {
    case 'off':
      return false;
    case 'daily':
      return true;
    case 'weekly':
      return date.getDay() === (r.weekDay ?? 0);
    case 'monthly': {
      const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      const target = Math.min(r.monthDay ?? 1, daysInMonth);
      return date.getDate() === target;
    }
    case 'custom':
      return (r.weekDays ?? []).includes(date.getDay());
    default:
      return false;
  }
};

const localLoadRoutineTasks = (): RoutineTask[] => {
  const data = localStorage.getItem(ROUTINE_STORAGE_KEY);
  if (!data) return [];
  try {
    return normalizeRoutineTasks(JSON.parse(data) as RoutineTask[]);
  } catch (e) {
    console.error('Failed to parse routine tasks', e);
    return [];
  }
};

const localSaveRoutineTasks = (tasks: RoutineTask[]) => {
  localStorage.setItem(ROUTINE_STORAGE_KEY, JSON.stringify(tasks));
};

const localLoadAssignedRoadmapId = (): string | null =>
  localStorage.getItem(ASSIGNED_ROADMAP_KEY);

const localSaveAssignedRoadmapId = (roadmapId: string | null) => {
  if (roadmapId) localStorage.setItem(ASSIGNED_ROADMAP_KEY, roadmapId);
  else localStorage.removeItem(ASSIGNED_ROADMAP_KEY);
};

const normalizeBacklogPriority = (value: unknown): BacklogTask['priority'] => {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  // 旧数値 priority の互換（大きいほど高）
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 2) return 'high';
    if (value >= 1) return 'medium';
    return 'low';
  }
  return 'medium';
};

const normalizeBacklogTasks = (tasks: BacklogTask[]): BacklogTask[] =>
  tasks.map((t) => ({
    id: t.id,
    text: t.text ?? '',
    completed: Boolean(t.completed),
    priority: normalizeBacklogPriority(t.priority),
    createdAt: t.createdAt || new Date().toISOString(),
    completedAt: t.completedAt ?? null,
  }));

const localLoadBacklogTasks = (): BacklogTask[] => {
  const data = localStorage.getItem(BACKLOG_STORAGE_KEY);
  if (!data) return [];
  try {
    return normalizeBacklogTasks(JSON.parse(data) as BacklogTask[]);
  } catch (e) {
    console.error('Failed to parse backlog tasks', e);
    return [];
  }
};

const localSaveBacklogTasks = (tasks: BacklogTask[]) => {
  localStorage.setItem(BACKLOG_STORAGE_KEY, JSON.stringify(tasks));
};

// --- Roadmaps ---

export const loadRoadmaps = async (): Promise<Roadmap[]> => {
  if (!isSupabaseConfigured) return localLoadRoadmaps();

  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('roadmaps')
    .select('id, title, updated_at, nodes, edges')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('Failed to load roadmaps', error);
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    updatedAt: new Date(row.updated_at as string).getTime(),
    nodes: (row.nodes as Node<NodeData>[]) ?? [],
    edges: (row.edges as Edge[]) ?? [],
  }));
};

export const saveRoadmaps = async (roadmaps: Roadmap[]): Promise<void> => {
  if (!isSupabaseConfigured) {
    localSaveRoadmaps(roadmaps);
    return;
  }

  // upsert のみ。欠けた ID を DELETE しない（不完全配列の競合保存でデータ消失するため）
  if (roadmaps.length === 0) return;

  const userId = await requireUserId();

  const rows = roadmaps.map((r) => ({
    id: r.id,
    user_id: userId,
    title: r.title,
    updated_at: new Date(r.updatedAt).toISOString(),
    nodes: r.nodes,
    edges: r.edges,
  }));

  const { error: upsertError } = await supabase.from('roadmaps').upsert(rows, {
    onConflict: 'id',
  });

  if (upsertError) {
    console.error('Failed to save roadmaps', upsertError);
    throw upsertError;
  }
};

/** 明示削除（UI の削除操作専用） */
export const deleteRoadmap = async (id: string): Promise<void> => {
  if (!isSupabaseConfigured) {
    localSaveRoadmaps(localLoadRoadmaps().filter((r) => r.id !== id));
    return;
  }

  const userId = await requireUserId();
  const { error } = await supabase
    .from('roadmaps')
    .delete()
    .eq('user_id', userId)
    .eq('id', id);

  if (error) {
    console.error('Failed to delete roadmap', error);
    throw error;
  }
};

/**
 * インポートなど「全置換」専用。
 * 渡した配列に無いクラウド行だけ削除してから upsert する。
 */
export const replaceAllRoadmaps = async (roadmaps: Roadmap[]): Promise<void> => {
  if (!isSupabaseConfigured) {
    localSaveRoadmaps(roadmaps);
    return;
  }

  const userId = await requireUserId();

  const { data: existing, error: existingError } = await supabase
    .from('roadmaps')
    .select('id')
    .eq('user_id', userId);

  if (existingError) {
    console.error('Failed to list roadmaps', existingError);
    throw existingError;
  }

  const nextIds = new Set(roadmaps.map((r) => r.id));
  const toDelete = (existing ?? [])
    .map((r) => r.id as string)
    .filter((id) => !nextIds.has(id));

  if (toDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from('roadmaps')
      .delete()
      .eq('user_id', userId)
      .in('id', toDelete);
    if (deleteError) {
      console.error('Failed to delete roadmaps', deleteError);
      throw deleteError;
    }
  }

  await saveRoadmaps(roadmaps);
};

// --- Daily Logs ---

export const loadDailyLogs = async (): Promise<DailyLog[]> => {
  if (dailyLogsCache) return dailyLogsCache;
  if (dailyLogsInflight) return dailyLogsInflight;

  dailyLogsInflight = (async () => {
    if (!isSupabaseConfigured) {
      const logs = localLoadDailyLogs();
      setDailyLogsCache(logs);
      return logs;
    }

    const userId = await requireUserId();
    const { data, error } = await supabase
      .from('daily_logs')
      .select('date, tasks, active_goal_ids, reflection')
      .eq('user_id', userId)
      .order('date', { ascending: false });

    if (error) {
      console.error('Failed to load daily logs', error);
      throw error;
    }

    const logs = (data ?? []).map((row) => ({
      date: row.date as string,
      tasks: (row.tasks as DailyTask[]) ?? [],
      activeGoalIds: (row.active_goal_ids as string[] | null) ?? undefined,
      reflection: (row.reflection as string | null) ?? undefined,
    }));
    setDailyLogsCache(logs);
    return logs;
  })();

  try {
    return await dailyLogsInflight;
  } finally {
    dailyLogsInflight = null;
  }
};

export const saveDailyLogs = async (logs: DailyLog[]): Promise<void> => {
  if (!isSupabaseConfigured) {
    localSaveDailyLogs(logs);
    setDailyLogsCache(logs);
    return;
  }

  // upsert のみ（欠けた日付の DELETE はしない）
  if (logs.length === 0) {
    setDailyLogsCache([]);
    return;
  }

  const userId = await requireUserId();

  const rows = logs.map((l) => ({
    user_id: userId,
    date: l.date,
    tasks: l.tasks,
    active_goal_ids: l.activeGoalIds ?? null,
    reflection: l.reflection ?? null,
  }));

  const { error: upsertError } = await supabase.from('daily_logs').upsert(rows, {
    onConflict: 'user_id,date',
  });

  if (upsertError) {
    console.error('Failed to save daily logs', upsertError);
    throw upsertError;
  }

  setDailyLogsCache(logs);
};

/** 1日分だけ upsert（入力中の保存向け。全件同期しない） */
export const upsertDailyLog = async (log: DailyLog): Promise<void> => {
  if (!isSupabaseConfigured) {
    const logs = dailyLogsCache ?? localLoadDailyLogs();
    const idx = logs.findIndex((l) => l.date === log.date);
    if (idx >= 0) {
      const next = [...logs];
      next[idx] = log;
      localSaveDailyLogs(next);
      setDailyLogsCache(next);
    } else {
      const next = [...logs, log];
      localSaveDailyLogs(next);
      setDailyLogsCache(next);
    }
    return;
  }

  const userId = await requireUserId();
  const { error } = await supabase.from('daily_logs').upsert(
    {
      user_id: userId,
      date: log.date,
      tasks: log.tasks,
      active_goal_ids: log.activeGoalIds ?? null,
      reflection: log.reflection ?? null,
    },
    { onConflict: 'user_id,date' }
  );

  if (error) {
    console.error('Failed to upsert daily log', error);
    throw error;
  }

  patchDailyLogCache(log);
};

export const saveDailyLogReflection = async (
  date: string,
  reflection: string
): Promise<DailyLog[]> => {
  const logs = await loadDailyLogs();
  const idx = logs.findIndex((l) => l.date === date);
  let nextLog: DailyLog;
  let next: DailyLog[];
  if (idx >= 0) {
    nextLog = { ...logs[idx], reflection };
    next = [...logs];
    next[idx] = nextLog;
  } else {
    nextLog = { date, tasks: [], reflection };
    next = [...logs, nextLog];
  }
  await upsertDailyLog(nextLog);
  return next;
};

export const findPreviousDailyLog = (date: string, logs: DailyLog[]): DailyLog | undefined => {
  return [...logs]
    .filter((l) => l.date < date)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
};

export const calcDailyAchievementRate = (tasks: DailyTask[]): number => {
  const countable = tasks.filter((t) => t.text.trim() !== '');
  if (countable.length === 0) return 0;
  const done = countable.filter((t) => t.status === 'done').length;
  return Math.round((done / countable.length) * 100);
};

// --- Routine / Assignment ---

async function loadUserSettings(): Promise<{
  routineTasks: RoutineTask[];
  assignedRoadmapId: string | null;
  backlogTasks: BacklogTask[];
}> {
  if (userSettingsCache) return userSettingsCache;

  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('user_settings')
    .select('routine_tasks, assigned_roadmap_id, backlog_tasks')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('Failed to load user settings', error);
    throw error;
  }

  userSettingsCache = {
    routineTasks: normalizeRoutineTasks((data?.routine_tasks as RoutineTask[]) ?? []),
    assignedRoadmapId: (data?.assigned_roadmap_id as string | null) ?? null,
    backlogTasks: normalizeBacklogTasks((data?.backlog_tasks as BacklogTask[]) ?? []),
  };
  routineTasksCache = userSettingsCache.routineTasks;
  backlogTasksCache = userSettingsCache.backlogTasks;
  return userSettingsCache;
}

async function upsertUserSettings(patch: {
  routineTasks?: RoutineTask[];
  assignedRoadmapId?: string | null;
  backlogTasks?: BacklogTask[];
}): Promise<void> {
  const userId = await requireUserId();
  const current = await loadUserSettings();

  const row = {
    user_id: userId,
    routine_tasks: patch.routineTasks ?? current.routineTasks,
    assigned_roadmap_id:
      patch.assignedRoadmapId !== undefined
        ? patch.assignedRoadmapId
        : current.assignedRoadmapId,
    backlog_tasks: patch.backlogTasks ?? current.backlogTasks,
  };

  const { error } = await supabase.from('user_settings').upsert(row, {
    onConflict: 'user_id',
  });

  if (error) {
    console.error('Failed to save user settings', error);
    throw error;
  }

  userSettingsCache = {
    routineTasks: row.routine_tasks as RoutineTask[],
    assignedRoadmapId: row.assigned_roadmap_id,
    backlogTasks: row.backlog_tasks as BacklogTask[],
  };
  routineTasksCache = userSettingsCache.routineTasks;
  backlogTasksCache = userSettingsCache.backlogTasks;
}

export const loadRoutineTasks = async (): Promise<RoutineTask[]> => {
  if (!isSupabaseConfigured) {
    if (routineTasksCache) return normalizeRoutineTasks(routineTasksCache);
    routineTasksCache = localLoadRoutineTasks();
    return routineTasksCache;
  }
  if (routineTasksCache) return normalizeRoutineTasks(routineTasksCache);
  const settings = await loadUserSettings();
  return normalizeRoutineTasks(settings.routineTasks);
};

export const saveRoutineTasks = async (tasks: RoutineTask[]): Promise<void> => {
  if (!isSupabaseConfigured) {
    localSaveRoutineTasks(tasks);
    routineTasksCache = tasks;
    return;
  }
  await upsertUserSettings({ routineTasks: tasks });
};

export const loadAssignedRoadmapId = async (): Promise<string | null> => {
  if (!isSupabaseConfigured) return localLoadAssignedRoadmapId();
  const settings = await loadUserSettings();
  return settings.assignedRoadmapId;
};

export const saveAssignedRoadmapId = async (roadmapId: string | null): Promise<void> => {
  if (!isSupabaseConfigured) {
    localSaveAssignedRoadmapId(roadmapId);
    return;
  }
  await upsertUserSettings({ assignedRoadmapId: roadmapId });
};

// --- Backlog ---

export const loadBacklogTasks = async (): Promise<BacklogTask[]> => {
  if (!isSupabaseConfigured) {
    if (backlogTasksCache) return normalizeBacklogTasks(backlogTasksCache);
    backlogTasksCache = localLoadBacklogTasks();
    return backlogTasksCache;
  }
  if (backlogTasksCache) return normalizeBacklogTasks(backlogTasksCache);
  const settings = await loadUserSettings();
  return normalizeBacklogTasks(settings.backlogTasks);
};

/** ToDo ブロックの折りたたみ状態（ブロック ID の一覧） */
export const loadTodoCollapsedBlockIds = (): string[] => {
  const data = localStorage.getItem(TODO_COLLAPSED_BLOCKS_KEY);
  if (!data) return [];
  try {
    const parsed = JSON.parse(data) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
};

export const saveTodoCollapsedBlockIds = (ids: string[]): void => {
  localStorage.setItem(TODO_COLLAPSED_BLOCKS_KEY, JSON.stringify([...new Set(ids)]));
};

export const saveBacklogTasks = async (tasks: BacklogTask[]): Promise<void> => {
  const normalized = normalizeBacklogTasks(tasks);
  if (!isSupabaseConfigured) {
    localSaveBacklogTasks(normalized);
    backlogTasksCache = normalized;
    return;
  }
  await upsertUserSettings({ backlogTasks: normalized });
};

/** 日次ログの「その他」未完了を Backlog へ一度だけ移行 */
export const migrateOtherTasksToBacklog = async (
  logs: DailyLog[]
): Promise<BacklogTask[]> => {
  const existing = await loadBacklogTasks();
  const migratedKey = 'pathway-other-to-backlog-migrated';
  if (typeof localStorage !== 'undefined' && localStorage.getItem(migratedKey) === '1') {
    return existing;
  }
  if (existing.length > 0) {
    if (typeof localStorage !== 'undefined') localStorage.setItem(migratedKey, '1');
    return existing;
  }

  const sorted = [...logs].sort((a, b) => b.date.localeCompare(a.date));
  const source = sorted.find((l) => l.tasks.some((t) => t.goalId === 'other' && t.text.trim()));
  if (!source) {
    if (typeof localStorage !== 'undefined') localStorage.setItem(migratedKey, '1');
    return existing;
  }

  const migrated: BacklogTask[] = source.tasks
    .filter((t) => t.goalId === 'other' && t.text.trim() !== '' && t.status !== 'done')
    .map((t) => ({
      id: generateId(),
      text: t.text,
      completed: false,
      priority: 'medium' as const,
      createdAt: new Date().toISOString(),
      completedAt: null,
    }));

  const next = [...existing, ...migrated];
  await saveBacklogTasks(next);
  if (typeof localStorage !== 'undefined') localStorage.setItem(migratedKey, '1');
  return next;
};

// --- Roadmap Import / Export ---

export interface RoadmapExportPayload {
  version: 1;
  exportedAt: string;
  roadmaps: Roadmap[];
}

const isRoadmap = (value: unknown): value is Roadmap => {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.title === 'string' &&
    typeof r.updatedAt === 'number' &&
    Array.isArray(r.nodes) &&
    Array.isArray(r.edges)
  );
};

export const buildRoadmapExport = (roadmaps: Roadmap[]): RoadmapExportPayload => ({
  version: 1,
  exportedAt: new Date().toISOString(),
  roadmaps,
});

export const downloadRoadmapExport = (roadmaps: Roadmap[]) => {
  const payload = buildRoadmapExport(roadmaps);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = getLocalDate();
  a.href = url;
  a.download = `pathway-roadmaps-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

export const parseRoadmapImport = (json: string): Roadmap[] | null => {
  try {
    const data = JSON.parse(json) as unknown;

    if (Array.isArray(data)) {
      if (data.every(isRoadmap)) return data;
      return null;
    }

    if (data && typeof data === 'object') {
      const payload = data as Record<string, unknown>;
      if (Array.isArray(payload.roadmaps) && payload.roadmaps.every(isRoadmap)) {
        return payload.roadmaps;
      }
    }

    return null;
  } catch {
    return null;
  }
};
