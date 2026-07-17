import type { Node, Edge } from 'reactflow';
import type { NodeData, DailyLog, RoutineTask, DailyTask } from './types';

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

// --- Roadmaps ---

export const getLocalDate = (date: Date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const loadRoadmaps = (): Roadmap[] => {
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) return [];
  try {
    return JSON.parse(data);
  } catch (e) {
    console.error('Failed to parse roadmaps', e);
    return [];
  }
};

export const saveRoadmaps = (roadmaps: Roadmap[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(roadmaps));
  } catch (e) {
    console.error('Failed to save roadmaps to localStorage', e);
  }
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

// --- Daily Logs (ToDo) ---

export const loadDailyLogs = (): DailyLog[] => {
  const data = localStorage.getItem(DAILY_STORAGE_KEY);
  if (!data) return [];
  try {
    return JSON.parse(data);
  } catch (e) {
    console.error('Failed to parse daily logs', e);
    return [];
  }
};

export const saveDailyLogs = (logs: DailyLog[]) => {
  localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(logs));
};

/** 指定日より前で最も新しいログ（目標タブ引き継ぎ用） */
export const findPreviousDailyLog = (date: string, logs: DailyLog[]): DailyLog | undefined => {
  return [...logs]
    .filter((l) => l.date < date)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
};

/** 今日の全 Daily Todo 達成率（空文字タスクは分母から除外） */
export const calcDailyAchievementRate = (tasks: DailyTask[]): number => {
  const countable = tasks.filter((t) => t.text.trim() !== '');
  if (countable.length === 0) return 0;
  const done = countable.filter((t) => t.status === 'done').length;
  return Math.round((done / countable.length) * 100);
};

// --- Routine Tasks ---

export const loadRoutineTasks = (): RoutineTask[] => {
  const data = localStorage.getItem(ROUTINE_STORAGE_KEY);
  if (!data) return [];
  try {
    return JSON.parse(data);
  } catch (e) {
    console.error('Failed to parse routine tasks', e);
    return [];
  }
};

export const saveRoutineTasks = (tasks: RoutineTask[]) => {
  localStorage.setItem(ROUTINE_STORAGE_KEY, JSON.stringify(tasks));
};

// --- Roadmap Assignment (single-app, no user) ---

export const loadAssignedRoadmapId = (): string | null => {
  return localStorage.getItem(ASSIGNED_ROADMAP_KEY);
};

export const saveAssignedRoadmapId = (roadmapId: string | null) => {
  if (roadmapId) {
    localStorage.setItem(ASSIGNED_ROADMAP_KEY, roadmapId);
  } else {
    localStorage.removeItem(ASSIGNED_ROADMAP_KEY);
  }
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

/** JSON 文字列からロードマップ配列をパース。形式不正時は null */
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
