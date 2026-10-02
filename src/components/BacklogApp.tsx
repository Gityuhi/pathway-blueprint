import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, CheckCircle2, Circle, Inbox } from 'lucide-react';
import clsx from 'clsx';
import {
  generateId,
  getLocalDate,
  loadBacklogTasks,
  loadDailyLogs,
  migrateOtherTasksToBacklog,
  saveBacklogTasks,
} from '../store';
import type { BacklogPriority, BacklogTask } from '../types';

const TEXT_SAVE_DEBOUNCE_MS = 500;

type BacklogTab = 'backlog' | 'completed';

const PRIORITY_RANK: Record<BacklogPriority, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const PRIORITY_OPTIONS: { value: BacklogPriority; label: string }[] = [
  { value: 'high', label: 'high' },
  { value: 'medium', label: 'medium' },
  { value: 'low', label: 'low' },
];

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  return isMobile;
}

/** 高 → 中 → 低。同優先度は作成が古いものから上 */
function sortBacklogTasks(tasks: BacklogTask[]): BacklogTask[] {
  return [...tasks].sort((a, b) => {
    const rankDiff = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
    if (rankDiff !== 0) return rankDiff;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

function prioritySelectClass(priority: BacklogPriority, completed: boolean): string {
  if (completed) {
    return 'border-gray-200 bg-gray-50 text-gray-500';
  }
  if (priority === 'high') {
    return 'border-red-200 bg-red-50 text-red-700';
  }
  if (priority === 'low') {
    return 'border-gray-200 bg-gray-50 text-gray-600';
  }
  return 'border-blue-200 bg-blue-50 text-blue-700';
}

export default function BacklogApp() {
  const [tasks, setTasks] = useState<BacklogTask[]>([]);
  const [tab, setTab] = useState<BacklogTab>('backlog');
  const [draft, setDraft] = useState('');
  const [booting, setBooting] = useState(true);
  const isMobile = useIsMobile();
  const tasksRef = useRef<BacklogTask[]>([]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [loaded, logs] = await Promise.all([loadBacklogTasks(), loadDailyLogs()]);
        if (cancelled) return;
        const migrated = await migrateOtherTasksToBacklog(logs);
        if (cancelled) return;
        setTasks(migrated.length > 0 ? migrated : loaded);
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const persist = useCallback(async (next: BacklogTask[]) => {
    tasksRef.current = next;
    setTasks(next);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void saveBacklogTasks(next).catch((e) => console.error(e));
    }, TEXT_SAVE_DEBOUNCE_MS);
  }, []);

  const persistNow = useCallback(async (next: BacklogTask[]) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    tasksRef.current = next;
    setTasks(next);
    await saveBacklogTasks(next);
  }, []);

  const visibleTasks = useMemo(() => {
    const filtered =
      tab === 'backlog'
        ? tasks.filter((t) => !t.completed)
        : tasks.filter((t) => t.completed);
    return sortBacklogTasks(filtered);
  }, [tasks, tab]);

  const backlogCount = useMemo(
    () => tasks.filter((t) => !t.completed && t.text.trim() !== '').length,
    [tasks]
  );
  const completedCount = useMemo(
    () => tasks.filter((t) => t.completed).length,
    [tasks]
  );

  const addTask = () => {
    const text = draft.trim();
    if (!text) return;
    const next: BacklogTask = {
      id: generateId(),
      text,
      completed: false,
      priority: 'medium',
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    void persistNow([next, ...tasksRef.current]);
    setDraft('');
    setTab('backlog');
  };

  const updateText = (id: string, text: string) => {
    const next = tasksRef.current.map((t) => (t.id === id ? { ...t, text } : t));
    void persist(next);
  };

  const setPriority = (id: string, priority: BacklogPriority) => {
    const next = tasksRef.current.map((t) => (t.id === id ? { ...t, priority } : t));
    void persistNow(next);
  };

  const toggleComplete = (id: string) => {
    const next = tasksRef.current.map((t) => {
      if (t.id !== id) return t;
      const completed = !t.completed;
      return {
        ...t,
        completed,
        completedAt: completed ? new Date().toISOString() : null,
      };
    });
    void persistNow(next);
  };

  const deleteTask = (id: string) => {
    const next = tasksRef.current.filter((t) => t.id !== id);
    void persistNow(next);
  };

  if (booting) {
    return (
      <div className="flex flex-1 items-center justify-center text-gray-400 bg-white">
        読み込み中…
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col h-full min-h-0 bg-white overflow-hidden">
      <div className="flex-shrink-0 border-b border-gray-100 px-4 md:px-10 pt-4 md:pt-8 pb-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-3 mb-1">
            <Inbox className="text-blue-600 flex-shrink-0" size={isMobile ? 22 : 28} />
            <h1 className="text-2xl md:text-4xl font-bold text-gray-800 tracking-tight">
              Backlog
            </h1>
          </div>
          <p className="text-sm md:text-base text-gray-500 mb-5">
            日付に縛られず残しておきたいタスク。優先度の高い順に並びます。
          </p>

          <div className="flex gap-2 mb-5">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTask();
                }
              }}
              placeholder="新しいタスクを追加..."
              className={clsx(
                'flex-1 min-w-0 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5',
                'outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20',
                'placeholder-gray-300 font-medium',
                isMobile ? 'text-base' : 'text-lg'
              )}
            />
            <button
              type="button"
              onClick={addTask}
              disabled={!draft.trim()}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            >
              <Plus size={18} />
              追加
            </button>
          </div>

          <div className="flex items-center gap-1 border-b border-gray-100 -mb-4">
            <button
              type="button"
              onClick={() => setTab('backlog')}
              className={clsx(
                'px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors inline-flex items-center gap-2',
                tab === 'backlog'
                  ? 'border-blue-600 text-blue-700 bg-blue-50/50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              )}
            >
              Backlog
              {backlogCount > 0 && (
                <span className="min-w-[1.25rem] h-5 px-1 rounded-full border border-current text-[11px] font-semibold tabular-nums inline-flex items-center justify-center">
                  {backlogCount > 99 ? '99+' : backlogCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setTab('completed')}
              className={clsx(
                'px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors inline-flex items-center gap-2',
                tab === 'completed'
                  ? 'border-blue-600 text-blue-700 bg-blue-50/50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              )}
            >
              Completed
              {completedCount > 0 && (
                <span className="min-w-[1.25rem] h-5 px-1 rounded-full border border-current text-[11px] font-semibold tabular-nums inline-flex items-center justify-center">
                  {completedCount > 99 ? '99+' : completedCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-10 pt-6 min-h-0">
        <div className="max-w-3xl mx-auto space-y-2 pb-24">
          {visibleTasks.length === 0 ? (
            <div className="text-center py-20 text-gray-400">
              {tab === 'backlog'
                ? 'Backlog にタスクはありません'
                : '完了したタスクはまだありません'}
            </div>
          ) : (
            visibleTasks.map((task) => (
              <div
                key={task.id}
                className={clsx(
                  'flex items-start gap-2 md:gap-3 p-3 md:p-4 rounded-xl border bg-white group transition-colors',
                  task.completed
                    ? 'border-gray-100 opacity-80'
                    : 'border-gray-100 hover:border-blue-100'
                )}
              >
                <button
                  type="button"
                  onClick={() => toggleComplete(task.id)}
                  className={clsx(
                    'flex-shrink-0 mt-0.5 rounded-full transition-colors',
                    task.completed
                      ? 'text-green-500'
                      : 'text-gray-300 hover:text-blue-500'
                  )}
                  aria-label={task.completed ? '未完了に戻す' : '完了にする'}
                >
                  {task.completed ? (
                    <CheckCircle2 size={isMobile ? 24 : 28} strokeWidth={2} />
                  ) : (
                    <Circle size={isMobile ? 24 : 28} strokeWidth={2} />
                  )}
                </button>

                <div className="flex-1 min-w-0">
                  <textarea
                    value={task.text}
                    rows={1}
                    onChange={(e) => {
                      updateText(task.id, e.target.value);
                      const el = e.target;
                      el.style.height = 'auto';
                      el.style.height = `${el.scrollHeight}px`;
                    }}
                    onBlur={() => {
                      if (saveTimerRef.current) {
                        clearTimeout(saveTimerRef.current);
                        saveTimerRef.current = null;
                      }
                      void saveBacklogTasks(tasksRef.current);
                    }}
                    ref={(el) => {
                      if (el) {
                        el.style.height = 'auto';
                        el.style.height = `${el.scrollHeight}px`;
                      }
                    }}
                    className={clsx(
                      'w-full bg-transparent border-none outline-none resize-none overflow-hidden',
                      'break-words whitespace-pre-wrap leading-relaxed font-medium',
                      isMobile ? 'text-base' : 'text-lg',
                      task.completed
                        ? 'text-gray-400 line-through decoration-gray-300'
                        : 'text-gray-800'
                    )}
                  />
                  {task.completed && task.completedAt && (
                    <p className="text-[11px] text-gray-400 mt-1 tabular-nums">
                      完了: {getLocalDate(new Date(task.completedAt))}
                    </p>
                  )}
                </div>

                <select
                  value={task.priority}
                  onChange={(e) => setPriority(task.id, e.target.value as BacklogPriority)}
                  aria-label="優先度"
                  className={clsx(
                    'flex-shrink-0 mt-0.5 w-[4.25rem] px-2 py-1.5 rounded-lg border text-xs font-semibold',
                    'focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500',
                    prioritySelectClass(task.priority, task.completed)
                  )}
                >
                  {PRIORITY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => deleteTask(task.id)}
                  className="p-2 text-gray-300 hover:text-red-500 transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100"
                  aria-label="削除"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
