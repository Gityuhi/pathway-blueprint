import type { Node, Edge } from 'reactflow';
import type { NodeData, DailyLog, RoutineTask, DailyTask } from './types';
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

const localLoadRoutineTasks = (): RoutineTask[] => {
  const data = localStorage.getItem(ROUTINE_STORAGE_KEY);
  if (!data) return [];
  try {
    return JSON.parse(data);
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

  if (roadmaps.length === 0) return;

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

// --- Daily Logs ---

export const loadDailyLogs = async (): Promise<DailyLog[]> => {
  if (!isSupabaseConfigured) return localLoadDailyLogs();

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

  return (data ?? []).map((row) => ({
    date: row.date as string,
    tasks: (row.tasks as DailyTask[]) ?? [],
    activeGoalIds: (row.active_goal_ids as string[] | null) ?? undefined,
    reflection: (row.reflection as string | null) ?? undefined,
  }));
};

export const saveDailyLogs = async (logs: DailyLog[]): Promise<void> => {
  if (!isSupabaseConfigured) {
    localSaveDailyLogs(logs);
    return;
  }

  const userId = await requireUserId();

  const { data: existing, error: existingError } = await supabase
    .from('daily_logs')
    .select('date')
    .eq('user_id', userId);

  if (existingError) {
    console.error('Failed to list daily logs', existingError);
    throw existingError;
  }

  const nextDates = new Set(logs.map((l) => l.date));
  const toDelete = (existing ?? [])
    .map((r) => r.date as string)
    .filter((date) => !nextDates.has(date));

  if (toDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from('daily_logs')
      .delete()
      .eq('user_id', userId)
      .in('date', toDelete);
    if (deleteError) {
      console.error('Failed to delete daily logs', deleteError);
      throw deleteError;
    }
  }

  if (logs.length === 0) return;

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
};

export const saveDailyLogReflection = async (
  date: string,
  reflection: string
): Promise<DailyLog[]> => {
  const logs = await loadDailyLogs();
  const idx = logs.findIndex((l) => l.date === date);
  let next: DailyLog[];
  if (idx >= 0) {
    next = [...logs];
    next[idx] = { ...next[idx], reflection };
  } else {
    next = [...logs, { date, tasks: [], reflection }];
  }
  await saveDailyLogs(next);
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
}> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('user_settings')
    .select('routine_tasks, assigned_roadmap_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('Failed to load user settings', error);
    throw error;
  }

  return {
    routineTasks: (data?.routine_tasks as RoutineTask[]) ?? [],
    assignedRoadmapId: (data?.assigned_roadmap_id as string | null) ?? null,
  };
}

async function upsertUserSettings(patch: {
  routineTasks?: RoutineTask[];
  assignedRoadmapId?: string | null;
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
  };

  const { error } = await supabase.from('user_settings').upsert(row, {
    onConflict: 'user_id',
  });

  if (error) {
    console.error('Failed to save user settings', error);
    throw error;
  }
}

export const loadRoutineTasks = async (): Promise<RoutineTask[]> => {
  if (!isSupabaseConfigured) return localLoadRoutineTasks();
  const settings = await loadUserSettings();
  return settings.routineTasks;
};

export const saveRoutineTasks = async (tasks: RoutineTask[]): Promise<void> => {
  if (!isSupabaseConfigured) {
    localSaveRoutineTasks(tasks);
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
