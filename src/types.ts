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
  collapsed?: boolean;
  /** UI only — not persisted */
  hasChildren?: boolean;
  childCount?: number;
  onToggleCollapse?: (nodeId: string) => void;
}

// --- Today's ToDo Types ---

export type DailyTaskStatus = 'todo' | 'doing' | 'done';

export interface DailyTask {
  id: string;
  text: string;
  status: DailyTaskStatus;
  indentLevel: number;
  /** null = ルーティンタブ, 'other' = その他タブ, それ以外 = ロードマップ目標 */
  goalId?: string | null;
}

export interface RoutineTask {
  id: string;
  text: string;
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
}

export interface DailyReport {
  date: string; // YYYY-MM-DD
  content: string;
}
