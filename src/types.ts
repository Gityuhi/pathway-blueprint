export interface Todo {
  id: string;
  text: string;
  completed: boolean;
}

export interface NodeData {
  title: string;
  todos: Todo[];
  progress: number;
  /** ノードごとの自由メモ */
  memo?: string;
  deadline?: string;
  /** @deprecated 互換用。collapsedLeft/Right を優先 */
  collapsed?: boolean;
  /** 左側の子を折りたたみ */
  collapsedLeft?: boolean;
  /** 右側の子を折りたたみ */
  collapsedRight?: boolean;
  /** UI only — not persisted */
  hasChildren?: boolean;
  hasLeftChildren?: boolean;
  hasRightChildren?: boolean;
  childCount?: number;
  leftChildCount?: number;
  rightChildCount?: number;
  onToggleCollapse?: (nodeId: string, side: 'left' | 'right') => void;
  /** UI only — ドラッグ中のドロップ候補 */
  isDropTarget?: boolean;
  /** UI only — ドラッグ中のノード */
  isDragging?: boolean;
  /** UI only — サブツリーが左向き */
  growsLeft?: boolean;
}

// --- Today's ToDo Types ---

export type DailyTaskStatus = 'todo' | 'doing' | 'done';

export interface DailyTask {
  id: string;
  text: string;
  status: DailyTaskStatus;
  indentLevel: number;
  /** null = ルーティン, 'other' = 旧その他（互換用）, それ以外 = ロードマップ目標 */
  goalId?: string | null;
}

/** 日付に紐づかない持ち越しタスク（Backlog） */
export type BacklogPriority = 'high' | 'medium' | 'low';

export interface BacklogTask {
  id: string;
  text: string;
  completed: boolean;
  /** 高 / 中 / 低 */
  priority: BacklogPriority;
  createdAt: string;
  completedAt?: string | null;
}

export type RoutineFrequency = 'daily' | 'weekly' | 'monthly' | 'custom' | 'off';

export interface RoutineTask {
  id: string;
  text: string;
  /**
   * 繰り返し頻度。
   * daily=毎日 / weekly=毎週（weekDay） / monthly=毎月（monthDay） /
   * custom=指定曜日（weekDays） / off=無効
   */
  frequency: RoutineFrequency;
  /** 毎週: 0=日 … 6=土（Date#getDay と同じ） */
  weekDay?: number;
  /** 毎月: 1–31 */
  monthDay?: number;
  /** カスタマイズ: 曜日配列（0=日 … 6=土） */
  weekDays?: number[];
  /** @deprecated frequency を優先。互換用 */
  enabled?: boolean;
}

/**
 * 1日分のスナップショット。
 * その日に割り当てた目標・作成した todo・status を保持する。
 */
export interface DailyLog {
  date: string; // YYYY-MM-DD
  tasks: DailyTask[];
  /** その日の目標タブ（ロードマップノード ID）。ルーティン以外 */
  activeGoalIds?: string[];
  /** カレンダーログの振り返り（Markdown） */
  reflection?: string;
}

