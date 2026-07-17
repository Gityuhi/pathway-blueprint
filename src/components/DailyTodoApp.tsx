import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  CheckCircle2,
  Calendar,
  Settings,
  Plus,
  Trash2,
  ArrowLeft,
  GripVertical,
  Copy,
  Check,
  Square,
  CheckSquare,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import MobileDrawer from './MobileDrawer';
import MobileMenuButton from './MobileMenuButton';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  loadDailyLogs,
  saveDailyLogs,
  loadRoutineTasks,
  saveRoutineTasks,
  getLocalDate,
  generateId,
  findPreviousDailyLog,
  calcDailyAchievementRate,
  loadAssignedRoadmapId,
  type Roadmap,
} from '../store';
import type { DailyLog, DailyTask, DailyTaskStatus, RoutineTask } from '../types';

const ROUTINE_TAB = 'routine' as const;
/** 例外タスク用の固定タブ（ロードマップ目標とは別） */
const OTHER_TAB = 'other' as const;

const SWIPE_THRESHOLD = 56;
const MAX_SWIPE_DX = 72;
const LONG_PRESS_DELAY_MS = 320;

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

function useTaskIndentPx() {
  const [indentPx, setIndentPx] = useState(40);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const update = () => setIndentPx(mq.matches ? 40 : 16);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  return indentPx;
}

interface UpcomingDeadlineNode {
  title: string;
  status: 'yellow' | 'red';
  remainingDays: number;
  deadline: string;
}

function calcRemainingDays(deadline: string): number {
  const [y, m, d] = deadline.split('-').map(Number);
  if (!y || !m || !d) return NaN;
  const deadlineDate = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round(
    (deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
}

interface DailyTodoAppProps {
  upcomingDeadlineNodes: UpcomingDeadlineNode[];
  roadmaps: Roadmap[];
  assignedRoadmapId: string | null;
}

interface GoalOption {
  id: string;
  title: string;
  depth: number;
}

interface SortableTaskItemProps {
  task: DailyTask;
  index: number;
  visibleTasks: DailyTask[];
  isSelected: boolean;
  isMobile: boolean;
  toggleSelection: (id: string, shiftKey: boolean, index: number) => void;
  toggleStatus: (index: number) => void;
  updateText: (index: number, text: string) => void;
  changeIndent: (index: number, delta: -1 | 1) => void;
  handleKeyDown: (e: React.KeyboardEvent, index: number) => void;
  handlePaste: (e: React.ClipboardEvent, index: number) => void;
  inputRef: (el: HTMLInputElement | null) => void;
  isComposingRef: React.MutableRefObject<boolean>;
}

/** この行より下に、指定 depth の縦線を延長すべき後続タスクがあるか */
function shouldContinueVerticalAtDepth(
  depth: number,
  index: number,
  tasks: DailyTask[]
): boolean {
  for (let j = index + 1; j < tasks.length; j++) {
    if (tasks[j].indentLevel >= depth) return true;
    if (tasks[j].indentLevel < depth) return false;
  }
  return false;
}

function TaskTreeGuides({
  indentLevel,
  index,
  visibleTasks,
  indentPx,
}: {
  indentLevel: number;
  index: number;
  visibleTasks: DailyTask[];
  indentPx: number;
}) {
  if (indentLevel <= 0) return null;

  const lineColor = 'bg-black';
  /** 行の py-1 と一致させ、隣接行の縦線がつながる */
  const rowPad = '0.25rem';

  return (
    <>
      {Array.from({ length: indentLevel }, (_, i) => i + 1).map((depth) => {
        const columnLeft = (depth - 0.5) * indentPx;
        const isConnectorDepth = depth === indentLevel;
        const continuesBelow = shouldContinueVerticalAtDepth(depth, index, visibleTasks);

        if (!isConnectorDepth) {
          const centerMobile = 'calc(0.375rem + 1rem + 0.25rem)';
          const centerDesktop = 'calc(0.25rem + 1.25rem + 0.25rem)';

          if (continuesBelow) {
            return (
              <span
                key={depth}
                className={clsx('absolute w-px pointer-events-none', lineColor)}
                style={{
                  left: columnLeft,
                  top: `calc(-1 * ${rowPad})`,
                  bottom: `calc(-1 * ${rowPad})`,
                }}
                aria-hidden="true"
              />
            );
          }

          return (
            <React.Fragment key={depth}>
              <span
                className={clsx('absolute w-px pointer-events-none md:hidden', lineColor)}
                style={{
                  left: columnLeft,
                  top: `calc(-1 * ${rowPad})`,
                  height: centerMobile,
                }}
                aria-hidden="true"
              />
              <span
                className={clsx('absolute w-px pointer-events-none hidden md:block', lineColor)}
                style={{
                  left: columnLeft,
                  top: `calc(-1 * ${rowPad})`,
                  height: centerDesktop,
                }}
                aria-hidden="true"
              />
            </React.Fragment>
          );
        }

        const centerMobile = 'calc(0.375rem + 1rem)';
        const centerDesktop = 'calc(0.25rem + 1.25rem)';

        return (
          <React.Fragment key={depth}>
            {/* 上からステータス円の中心まで */}
            <span
              className={clsx('absolute w-px pointer-events-none md:hidden', lineColor)}
              style={{
                left: columnLeft,
                top: `calc(-1 * ${rowPad})`,
                height: `calc(${centerMobile} + ${rowPad})`,
              }}
              aria-hidden="true"
            />
            <span
              className={clsx('absolute w-px pointer-events-none hidden md:block', lineColor)}
              style={{
                left: columnLeft,
                top: `calc(-1 * ${rowPad})`,
                height: `calc(${centerDesktop} + ${rowPad})`,
              }}
              aria-hidden="true"
            />
            {/* 横線: 縦線からステータス円の左端手前まで */}
            <span
              className={clsx(
                'absolute h-px pointer-events-none -translate-y-1/2 md:hidden',
                lineColor
              )}
              style={{ left: columnLeft, width: indentPx / 2, top: centerMobile }}
              aria-hidden="true"
            />
            <span
              className={clsx(
                'absolute h-px pointer-events-none -translate-y-1/2 hidden md:block',
                lineColor
              )}
              style={{ left: columnLeft, width: indentPx / 2, top: centerDesktop }}
              aria-hidden="true"
            />
            {/* 最下層は L 字: 下方向の縦線は出さない */}
            {continuesBelow && (
              <>
                <span
                  className={clsx('absolute w-px pointer-events-none md:hidden', lineColor)}
                  style={{
                    left: columnLeft,
                    top: centerMobile,
                    bottom: `calc(-1 * ${rowPad})`,
                  }}
                  aria-hidden="true"
                />
                <span
                  className={clsx('absolute w-px pointer-events-none hidden md:block', lineColor)}
                  style={{
                    left: columnLeft,
                    top: centerDesktop,
                    bottom: `calc(-1 * ${rowPad})`,
                  }}
                  aria-hidden="true"
                />
              </>
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}

function SortableTaskItem({
  task,
  index,
  visibleTasks,
  isSelected,
  isMobile,
  toggleSelection,
  toggleStatus,
  updateText,
  changeIndent,
  handleKeyDown,
  handlePaste,
  inputRef,
  isComposingRef,
}: SortableTaskItemProps) {
  const indentPx = useTaskIndentPx();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipeLockedRef = useRef<'horizontal' | 'vertical' | null>(null);
  const swipeDxRef = useRef(0);
  const isDraggingRef = useRef(false);
  const [swipeDx, setSwipeDx] = useState(0);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  isDraggingRef.current = isDragging;

  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      rowRef.current = node;
      setNodeRef(node);
    },
    [setNodeRef]
  );

  const changeIndentRef = useRef(changeIndent);
  changeIndentRef.current = changeIndent;
  const indexRef = useRef(index);
  indexRef.current = index;

  // 横スワイプで階層変更（縦スクロール・長押しドラッグと競合しないよう方向ロック）
  useEffect(() => {
    const el = rowRef.current;
    if (!el || !isMobile) return;

    const resetSwipe = () => {
      touchStartRef.current = null;
      swipeLockedRef.current = null;
      swipeDxRef.current = 0;
      setSwipeDx(0);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
      swipeLockedRef.current = null;
      swipeDxRef.current = 0;
      setSwipeDx(0);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!touchStartRef.current || e.touches.length !== 1 || isDraggingRef.current) {
        return;
      }

      const dx = e.touches[0].clientX - touchStartRef.current.x;
      const dy = e.touches[0].clientY - touchStartRef.current.y;

      if (!swipeLockedRef.current) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        swipeLockedRef.current =
          Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
      }

      if (swipeLockedRef.current === 'horizontal') {
        e.preventDefault();
        const clamped = Math.max(-MAX_SWIPE_DX, Math.min(MAX_SWIPE_DX, dx));
        swipeDxRef.current = clamped;
        setSwipeDx(clamped);
      }
    };

    const onTouchEnd = () => {
      if (!isDraggingRef.current && swipeLockedRef.current === 'horizontal') {
        const dx = swipeDxRef.current;
        if (dx >= SWIPE_THRESHOLD) changeIndentRef.current(indexRef.current, 1);
        else if (dx <= -SWIPE_THRESHOLD) changeIndentRef.current(indexRef.current, -1);
      }
      resetSwipe();
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [isMobile]);

  useEffect(() => {
    if (isDragging) {
      swipeDxRef.current = 0;
      setSwipeDx(0);
      swipeLockedRef.current = null;
      touchStartRef.current = null;
    }
  }, [isDragging]);

  const dragListeners = isMobile ? listeners : undefined;
  const handleListeners = !isMobile ? listeners : undefined;

  const style: React.CSSProperties = {
    transform: isDragging
      ? CSS.Transform.toString(transform)
      : swipeDx !== 0
        ? `translate3d(${swipeDx}px, 0, 0)`
        : CSS.Transform.toString(transform),
    transition: isDragging || swipeDx !== 0 ? undefined : transition,
    zIndex: isDragging ? 10 : 0,
    opacity: isDragging ? 0.5 : 1,
    touchAction: isMobile ? 'pan-y' : undefined,
  };

  return (
    <div
      ref={setRefs}
      style={style}
      className={clsx(
        'flex items-start gap-2 group relative py-1 px-2 rounded-xl transition-colors overflow-visible',
        isDragging && 'bg-blue-50 shadow-sm',
        isSelected && !isDragging && 'bg-blue-50/50',
        !isDragging && swipeDx > 12 && 'bg-blue-50/80',
        !isDragging && swipeDx < -12 && 'bg-amber-50/80'
      )}
      {...attributes}
      {...(dragListeners ?? {})}
    >
      {/* PC: ドラッグハンドル */}
      <div
        {...(handleListeners ?? {})}
        className="hidden md:block mt-4 p-1 text-gray-300 hover:text-gray-600 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
      >
        <GripVertical size={20} />
      </div>

      {/* PC: 選択用チェックボックス */}
      <button
        type="button"
        onClick={(e) => toggleSelection(task.id, e.shiftKey, index)}
        onPointerDown={(e) => e.stopPropagation()}
        className={clsx(
          'hidden md:block mt-4 p-1 transition-opacity flex-shrink-0',
          isSelected
            ? 'text-blue-500 opacity-100'
            : 'text-gray-200 opacity-0 group-hover:opacity-100 hover:text-gray-400'
        )}
      >
        {isSelected ? <CheckSquare size={20} /> : <Square size={20} />}
      </button>

      <div
        className="flex-1 flex items-start gap-2 md:gap-5 min-w-0 relative self-stretch"
        style={{ paddingLeft: `${task.indentLevel * indentPx}px` }}
      >
        <TaskTreeGuides
          indentLevel={task.indentLevel}
          index={index}
          visibleTasks={visibleTasks}
          indentPx={indentPx}
        />
        <button
          type="button"
          onClick={() => toggleStatus(index)}
          onPointerDown={(e) => e.stopPropagation()}
          className={clsx(
            'flex-shrink-0 rounded-full border-[3px] flex items-center justify-center transition-all duration-200',
            'w-8 h-8 mt-1.5 md:w-10 md:h-10 md:mt-1',
            task.status === 'todo' && 'border-gray-300 bg-white hover:border-gray-400',
            task.status === 'doing' && 'border-blue-500 bg-blue-50 text-blue-500',
            task.status === 'done' && 'border-green-500 bg-green-500 text-white'
          )}
        >
          {task.status === 'doing' && <div className="w-3 h-3 md:w-4 md:h-4 bg-blue-500 rounded-full" />}
          {task.status === 'done' && <CheckCircle2 size={20} strokeWidth={3} className="md:hidden" />}
          {task.status === 'done' && <CheckCircle2 size={24} strokeWidth={3} className="hidden md:block" />}
        </button>
        <input
          ref={inputRef}
          value={task.text}
          onChange={(e) => updateText(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, index)}
          onPaste={(e) => handlePaste(e, index)}
          onPointerDown={(e) => {
            // モバイル: 長押しドラッグを行全体で受けたいので伝播させる
            // PC: ハンドル以外からのドラッグ開始を防ぐ
            if (!isMobile) e.stopPropagation();
          }}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
          }}
          placeholder="Write a task..."
          className={clsx(
            'flex-1 min-w-0 bg-transparent border-none outline-none py-1 font-medium placeholder-gray-300 transition-all leading-relaxed',
            'text-xl md:text-3xl',
            task.status === 'done' &&
              'text-gray-300 line-through decoration-gray-300 decoration-2',
            task.status !== 'done' && 'text-gray-800'
          )}
        />
        <div className="mt-3 md:mt-4 opacity-0 group-hover:opacity-100 text-xs text-gray-300 font-mono transition-opacity hidden md:block">
          {task.status.toUpperCase()}
        </div>
      </div>
    </div>
  );
}

function buildGoalTree(roadmap: Roadmap | undefined): GoalOption[] {
  if (!roadmap) return [];

  const childrenMap = new Map<string, string[]>();
  roadmap.nodes.forEach((n) => childrenMap.set(n.id, []));
  roadmap.edges.forEach((e) => {
    childrenMap.get(e.source)?.push(e.target);
  });

  let rootId = 'root';
  if (!roadmap.nodes.find((n) => n.id === 'root')) {
    const targets = new Set(roadmap.edges.map((e) => e.target));
    const found = roadmap.nodes.find((n) => !targets.has(n.id));
    if (found) rootId = found.id;
  }

  const result: GoalOption[] = [];
  const visit = (id: string, depth: number) => {
    const node = roadmap.nodes.find((n) => n.id === id);
    if (!node) return;
    result.push({
      id: node.id,
      title: node.data.title || '無題のノード',
      depth,
    });
    (childrenMap.get(id) || []).forEach((childId) => visit(childId, depth + 1));
  };

  visit(rootId, 0);

  // Orphan nodes not reachable from root
  const visited = new Set(result.map((g) => g.id));
  roadmap.nodes.forEach((n) => {
    if (!visited.has(n.id)) {
      result.push({
        id: n.id,
        title: n.data.title || '無題のノード',
        depth: 0,
      });
    }
  });

  return result;
}

/** 新規日の目標タブ: 前日分を引き継ぐ（ロードマップ目標のみ） */
function resolveInitialGoalIds(previousLog: DailyLog | undefined): string[] {
  return (previousLog?.activeGoalIds ?? []).filter(
    (id) => id !== OTHER_TAB && id !== ROUTINE_TAB
  );
}

function isRoutineTask(task: DailyTask) {
  return task.goalId == null;
}

function isOtherTask(task: DailyTask) {
  return task.goalId === OTHER_TAB;
}

function emptyTask(goalId: string | null): DailyTask {
  return {
    id: generateId(),
    text: '',
    status: 'todo',
    indentLevel: 0,
    goalId,
  };
}

export default function DailyTodoApp({
  upcomingDeadlineNodes,
  roadmaps,
  assignedRoadmapId,
}: DailyTodoAppProps) {
  const [view, setView] = useState<'journal' | 'routine'>('journal');
  const [logs, setLogs] = useState<DailyLog[]>(() => loadDailyLogs());
  const [selectedDate, setSelectedDate] = useState<string>(getLocalDate());
  const [routineTasks, setRoutineTasks] = useState<RoutineTask[]>(() => loadRoutineTasks());
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);

  const [allTasks, setAllTasks] = useState<DailyTask[]>([]);
  const [activeGoalIds, setActiveGoalIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string>(ROUTINE_TAB);
  const [goalPickerOpen, setGoalPickerOpen] = useState(false);
  const [pendingGoalIds, setPendingGoalIds] = useState<Set<string>>(new Set());
  const [journalDrawerOpen, setJournalDrawerOpen] = useState(false);
  const isMobile = useIsMobile();

  const assignedRoadmap = useMemo(
    () => roadmaps.find((r) => r.id === (assignedRoadmapId ?? loadAssignedRoadmapId() ?? '')) ?? null,
    [roadmaps, assignedRoadmapId]
  );

  const goalOptions = useMemo(() => buildGoalTree(assignedRoadmap ?? undefined), [assignedRoadmap]);

  const goalTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    goalOptions.forEach((g) => map.set(g.id, g.title));
    // Also include titles from any roadmap node for carried-over goals
    roadmaps.forEach((rm) => {
      rm.nodes.forEach((n) => {
        if (!map.has(n.id)) map.set(n.id, n.data.title || '無題のノード');
      });
    });
    return map;
  }, [goalOptions, roadmaps]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: isMobile
        ? { delay: LONG_PRESS_DELAY_MS, tolerance: 8 }
        : { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const persistLog = useCallback(
    (date: string, tasks: DailyTask[], goalIds: string[]) => {
      const otherLogs = loadDailyLogs().filter((l) => l.date !== date);
      const nextLog: DailyLog = {
        date,
        tasks,
        activeGoalIds: goalIds,
      };
      const updatedLogs = [...otherLogs, nextLog].sort((a, b) => b.date.localeCompare(a.date));
      saveDailyLogs(updatedLogs);
      setLogs(updatedLogs);
      setAllTasks(tasks);
      setActiveGoalIds(goalIds);
    },
    []
  );

  // Load / create snapshot for selected date
  useEffect(() => {
    const currentLogs = loadDailyLogs();
    const log = currentLogs.find((l) => l.date === selectedDate);

    if (log) {
      let goalIds = (log.activeGoalIds ?? []).filter(
        (id) => id !== OTHER_TAB && id !== ROUTINE_TAB
      );
      let tasks = log.tasks;

      // 「その他」タブ用プレースホルダがなければ追加
      if (!tasks.some((t) => isOtherTask(t))) {
        tasks = [...tasks, emptyTask(OTHER_TAB)];
        persistLog(selectedDate, tasks, goalIds);
        setActiveTab(ROUTINE_TAB);
        setSelectedTaskIds(new Set());
        setLastSelectedIndex(null);
        return;
      }

      setAllTasks(tasks);
      setActiveGoalIds(goalIds);
      setActiveTab(ROUTINE_TAB);
    } else if (selectedDate === getLocalDate()) {
      const routines = loadRoutineTasks();
      const prev = findPreviousDailyLog(selectedDate, currentLogs);
      const carriedGoals = resolveInitialGoalIds(prev);

      const routineList: DailyTask[] =
        routines.length > 0
          ? routines.map((r) => ({
              id: generateId(),
              text: r.text,
              status: 'todo' as DailyTaskStatus,
              indentLevel: 0,
              goalId: null,
            }))
          : [emptyTask(null)];

      const goalPlaceholderTasks = carriedGoals.map((gid) => emptyTask(gid));
      const initialTasks = [
        ...routineList,
        emptyTask(OTHER_TAB),
        ...goalPlaceholderTasks,
      ];

      persistLog(selectedDate, initialTasks, carriedGoals);
      setActiveTab(ROUTINE_TAB);
    } else {
      setAllTasks([emptyTask(null), emptyTask(OTHER_TAB)]);
      setActiveGoalIds([]);
      setActiveTab(ROUTINE_TAB);
    }

    setSelectedTaskIds(new Set());
    setLastSelectedIndex(null);
  }, [selectedDate, persistLog]);

  useEffect(() => {
    const timer = setInterval(() => {
      const todayStr = getLocalDate();
      const currentLogs = loadDailyLogs();
      if (!currentLogs.find((l) => l.date === todayStr)) {
        setLogs(currentLogs);
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        if (selectedDate === getLocalDate(yesterday)) {
          setSelectedDate(todayStr);
        }
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [selectedDate]);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const isComposingRef = useRef(false);

  const visibleTasks = useMemo(() => {
    if (activeTab === ROUTINE_TAB) {
      return allTasks.filter(isRoutineTask);
    }
    if (activeTab === OTHER_TAB) {
      return allTasks.filter(isOtherTask);
    }
    return allTasks.filter((t) => t.goalId === activeTab);
  }, [allTasks, activeTab]);

  const achievementRate = useMemo(
    () => calcDailyAchievementRate(allTasks),
    [allTasks]
  );

  const updateVisibleAndSave = useCallback(
    (newVisible: DailyTask[]) => {
      let nextAll: DailyTask[];
      if (activeTab === ROUTINE_TAB) {
        const others = allTasks.filter((t) => !isRoutineTask(t));
        nextAll = [...newVisible, ...others];
      } else if (activeTab === OTHER_TAB) {
        const others = allTasks.filter((t) => !isOtherTask(t));
        nextAll = [...others, ...newVisible];
      } else {
        const others = allTasks.filter((t) => t.goalId !== activeTab);
        nextAll = [...others, ...newVisible];
      }
      persistLog(selectedDate, nextAll, activeGoalIds);
    },
    [activeTab, allTasks, activeGoalIds, selectedDate, persistLog]
  );

  const toggleSelection = (id: string, shiftKey: boolean, index: number) => {
    const newSelected = new Set(selectedTaskIds);
    if (shiftKey && lastSelectedIndex !== null) {
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      for (let i = start; i <= end; i++) {
        newSelected.add(visibleTasks[i].id);
      }
    } else {
      if (newSelected.has(id)) newSelected.delete(id);
      else newSelected.add(id);
      setLastSelectedIndex(index);
    }
    setSelectedTaskIds(newSelected);
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (isComposingRef.current) return;
    const goalId = activeTab === ROUTINE_TAB ? null : activeTab;

    if (e.key === 'Enter') {
      e.preventDefault();
      if (visibleTasks[index].text.trim() === '' && index === visibleTasks.length - 1) return;
      const newTask: DailyTask = {
        id: generateId(),
        text: '',
        status: 'todo',
        indentLevel: visibleTasks[index].indentLevel,
        goalId,
      };
      const newVisible = [...visibleTasks];
      newVisible.splice(index + 1, 0, newTask);
      updateVisibleAndSave(newVisible);
      setTimeout(() => inputRefs.current[index + 1]?.focus(), 0);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const newLevel = e.shiftKey
        ? Math.max(0, visibleTasks[index].indentLevel - 1)
        : Math.min(5, visibleTasks[index].indentLevel + 1);
      const newVisible = [...visibleTasks];
      newVisible[index] = { ...newVisible[index], indentLevel: newLevel };
      updateVisibleAndSave(newVisible);
    } else if (e.key === 'Backspace') {
      if (visibleTasks[index].text === '' && visibleTasks.length > 1) {
        e.preventDefault();
        const newVisible = visibleTasks.filter((_, i) => i !== index);
        updateVisibleAndSave(newVisible);
        setTimeout(() => inputRefs.current[Math.max(0, index - 1)]?.focus(), 0);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (index > 0) inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (index < visibleTasks.length - 1) inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent, index: number) => {
    const pasteData = e.clipboardData.getData('text');
    const lines = pasteData.split(/\r?\n/).filter((line) => line.trim() !== '' || line === '');
    if (lines.length <= 1) return;

    e.preventDefault();
    const goalId = activeTab === ROUTINE_TAB ? null : activeTab;
    const newVisible = [...visibleTasks];
    const tasksToInsert: DailyTask[] = lines.map((line) => {
      const indentMatch = line.match(/^(\s+)/);
      const indentStr = indentMatch ? indentMatch[1] : '';
      let level = 0;
      if (indentStr.includes('\t')) {
        level = (indentStr.match(/\t/g) || []).length;
      } else {
        level = Math.floor(indentStr.length / 2);
      }
      return {
        id: generateId(),
        text: line.trim(),
        status: 'todo' as DailyTaskStatus,
        indentLevel: Math.min(5, level),
        goalId,
      };
    });

    if (visibleTasks[index].text.trim() === '') {
      newVisible.splice(index, 1, ...tasksToInsert);
    } else {
      newVisible.splice(index + 1, 0, ...tasksToInsert);
    }
    updateVisibleAndSave(newVisible);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = visibleTasks.findIndex((t) => t.id === active.id);
    const newIndex = visibleTasks.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    updateVisibleAndSave(arrayMove(visibleTasks, oldIndex, newIndex));
  };

  const toggleStatus = (index: number) => {
    const current = visibleTasks[index].status;
    const next = current === 'todo' ? 'doing' : current === 'doing' ? 'done' : 'todo';
    const newVisible = [...visibleTasks];
    newVisible[index] = { ...newVisible[index], status: next };
    updateVisibleAndSave(newVisible);
  };

  const updateText = (index: number, text: string) => {
    const newVisible = [...visibleTasks];
    newVisible[index] = { ...newVisible[index], text };
    updateVisibleAndSave(newVisible);
  };

  const changeIndent = useCallback(
    (index: number, delta: -1 | 1) => {
      const current = visibleTasks[index];
      if (!current) return;
      const previousIndent = visibleTasks[index - 1]?.indentLevel ?? -1;
      const maxIndent = delta > 0 ? Math.min(5, previousIndent + 1) : 5;
      const newLevel = Math.min(maxIndent, Math.max(0, current.indentLevel + delta));
      if (newLevel === current.indentLevel) return;
      const newVisible = [...visibleTasks];
      newVisible[index] = { ...newVisible[index], indentLevel: newLevel };
      updateVisibleAndSave(newVisible);
    },
    [visibleTasks, updateVisibleAndSave]
  );

  const copyToClipboard = () => {
    const tasksToCopy =
      selectedTaskIds.size > 0
        ? visibleTasks.filter((t) => selectedTaskIds.has(t.id))
        : visibleTasks;
    const text = tasksToCopy
      .map((task) => `${'\t'.repeat(task.indentLevel)}${task.text}`)
      .join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2000);
    });
  };

  const ensureVisibleHasTask = (tabId: string, tasks: DailyTask[], goalIds: string[]) => {
    const filtered =
      tabId === ROUTINE_TAB
        ? tasks.filter(isRoutineTask)
        : tabId === OTHER_TAB
          ? tasks.filter(isOtherTask)
          : tasks.filter((t) => t.goalId === tabId);
    if (filtered.length > 0) return;
    const gid = tabId === ROUTINE_TAB ? null : tabId;
    persistLog(selectedDate, [...tasks, emptyTask(gid)], goalIds);
  };

  const handleSelectTab = (tabId: string) => {
    setActiveTab(tabId);
    setSelectedTaskIds(new Set());
    setLastSelectedIndex(null);
    ensureVisibleHasTask(tabId, allTasks, activeGoalIds);
  };

  const handleRemoveGoalTab = (goalId: string) => {
    const nextGoals = activeGoalIds.filter((id) => id !== goalId);
    const nextTasks = allTasks.filter((t) => t.goalId !== goalId);
    persistLog(
      selectedDate,
      nextTasks.length > 0 ? nextTasks : [emptyTask(null), emptyTask(OTHER_TAB)],
      nextGoals
    );
    if (activeTab === goalId) setActiveTab(ROUTINE_TAB);
  };

  const openGoalPicker = () => {
    setPendingGoalIds(new Set());
    setGoalPickerOpen(true);
  };

  const confirmAddGoals = () => {
    const toAdd = [...pendingGoalIds].filter((id) => !activeGoalIds.includes(id));
    if (toAdd.length === 0) {
      setGoalPickerOpen(false);
      return;
    }
    const nextGoals = [...activeGoalIds, ...toAdd];
    const placeholders = toAdd.map((gid) => emptyTask(gid));
    persistLog(selectedDate, [...allTasks, ...placeholders], nextGoals);
    setActiveTab(toAdd[0]);
    setGoalPickerOpen(false);
  };

  const addRoutine = () => {
    const newRoutines = [...routineTasks, { id: generateId(), text: '' }];
    setRoutineTasks(newRoutines);
    saveRoutineTasks(newRoutines);
  };

  const updateRoutine = (id: string, text: string) => {
    const newRoutines = routineTasks.map((r) => (r.id === id ? { ...r, text } : r));
    setRoutineTasks(newRoutines);
    saveRoutineTasks(newRoutines);
  };

  const deleteRoutine = (id: string) => {
    const newRoutines = routineTasks.filter((r) => r.id !== id);
    setRoutineTasks(newRoutines);
    saveRoutineTasks(newRoutines);
  };

  const sortedLogs = [...logs].sort((a, b) => b.date.localeCompare(a.date));
  let displayLogs = sortedLogs;
  if (!displayLogs.find((l) => l.date === selectedDate)) {
    displayLogs = [{ date: selectedDate, tasks: [] }, ...sortedLogs];
    displayLogs.sort((a, b) => b.date.localeCompare(a.date));
  }

  const selectableGoals = goalOptions.filter((g) => !activeGoalIds.includes(g.id));

  const handleSelectDate = (date: string) => {
    setView('journal');
    setSelectedDate(date);
    setJournalDrawerOpen(false);
  };

  const journalSidebar = (
    <>
      <div className="p-4 border-b border-gray-200 font-bold text-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar size={18} />
          Journal
        </div>
        <button
          onClick={() => setView(view === 'journal' ? 'routine' : 'journal')}
          className={clsx(
            'p-1.5 rounded-md transition-colors',
            view === 'routine' ? 'bg-blue-100 text-blue-600' : 'text-gray-400 hover:bg-gray-200'
          )}
          title="Routine Settings"
        >
          <Settings size={18} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {displayLogs.map((log) => (
          <button
            key={log.date}
            onClick={() => handleSelectDate(log.date)}
            className={clsx(
              'w-full text-left px-4 py-3 rounded-lg text-sm mb-1 transition-colors',
              view === 'journal' && selectedDate === log.date
                ? 'bg-blue-50 text-blue-700 font-medium'
                : 'text-gray-600 hover:bg-gray-100'
            )}
          >
            {new Date(log.date).toLocaleDateString('ja-JP', {
              weekday: 'short',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            })}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <div className="flex h-full w-full bg-white min-h-0">
      <div className="hidden md:flex w-64 bg-gray-50 border-r border-gray-200 flex-col flex-shrink-0">
        {journalSidebar}
      </div>

      <MobileDrawer open={journalDrawerOpen} onClose={() => setJournalDrawerOpen(false)}>
        <div className="flex flex-col h-full bg-gray-50">{journalSidebar}</div>
      </MobileDrawer>

      <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden">
        {view === 'journal' ? (
          <>
            <div className="md:hidden flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 bg-white flex-shrink-0 safe-top">
              <MobileMenuButton
                onClick={() => setJournalDrawerOpen(true)}
                label="日付一覧を開く"
              />
              <span className="text-sm font-semibold text-gray-700 truncate flex-1 min-w-0">
                {new Date(selectedDate).toLocaleDateString('ja-JP', {
                  month: 'short',
                  day: 'numeric',
                  weekday: 'short',
                })}
              </span>
              <div className="text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-1 rounded-full tabular-nums flex-shrink-0">
                {achievementRate}%
              </div>
            </div>

            <div className="hidden md:grid px-8 pt-8 pb-4 border-b border-gray-100 grid-cols-[minmax(0,1.2fr)_auto_minmax(0,1fr)] items-start gap-4">
              {/* 期限警告（横並び・目標タブに被らないようヘッダー内に収める） */}
              <div className="min-w-0 flex flex-row flex-wrap gap-2 items-start self-center">
                {upcomingDeadlineNodes.length > 0 && (() => {
                  const redNodes = upcomingDeadlineNodes.filter((n) => n.status === 'red');
                  const yellowNodes = upcomingDeadlineNodes.filter((n) => n.status === 'yellow');
                  return (
                    <>
                      {redNodes.length > 0 && (
                        <div className="p-2.5 rounded-lg bg-red-50 border border-red-100 max-w-[280px] max-h-[120px] overflow-y-auto">
                          <h3 className="text-xs font-semibold text-red-700 mb-1.5">
                            1ヶ月以内
                          </h3>
                          <ul className="text-xs space-y-1">
                            {redNodes.map((node, index) => {
                              const days =
                                typeof node.remainingDays === 'number' &&
                                Number.isFinite(node.remainingDays)
                                  ? node.remainingDays
                                  : calcRemainingDays(node.deadline);
                              return (
                                <li
                                  key={`red-${node.deadline}-${index}`}
                                  className="text-red-700 font-medium break-words leading-snug"
                                >
                                  <span>• {node.title}</span>
                                  {Number.isFinite(days) && (
                                    <span className="ml-1 text-red-500 font-normal tabular-nums whitespace-nowrap">
                                      {`（残${days}日）`}
                                    </span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                      {yellowNodes.length > 0 && (
                        <div className="p-2.5 rounded-lg bg-yellow-50 border border-yellow-100 max-w-[280px] max-h-[120px] overflow-y-auto">
                          <h3 className="text-xs font-semibold text-yellow-800 mb-1.5">
                            2ヶ月以内
                          </h3>
                          <ul className="text-xs space-y-1">
                            {yellowNodes.map((node, index) => {
                              const days =
                                typeof node.remainingDays === 'number' &&
                                Number.isFinite(node.remainingDays)
                                  ? node.remainingDays
                                  : calcRemainingDays(node.deadline);
                              return (
                                <li
                                  key={`yellow-${node.deadline}-${index}`}
                                  className="text-yellow-800 font-medium break-words leading-snug"
                                >
                                  <span>• {node.title}</span>
                                  {Number.isFinite(days) && (
                                    <span className="ml-1 text-yellow-700 font-normal tabular-nums whitespace-nowrap">
                                      {`（残${days}日）`}
                                    </span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              <div className="text-center shrink-0 px-2">
                <h1 className="text-5xl font-bold text-gray-800 tracking-tight">
                  {new Date(selectedDate).toLocaleDateString('ja-JP', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </h1>
                <p className="text-lg text-gray-400 mt-2 font-medium">Today&apos;s Focus</p>
                <div className="mt-3 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-50 text-blue-700 text-sm font-semibold">
                  今日の達成率
                  <span className="text-lg tabular-nums">{achievementRate}%</span>
                </div>
              </div>

              <div className="flex items-start justify-end gap-2 self-center">
                {selectedTaskIds.size > 0 && (
                  <button
                    onClick={() => {
                      setSelectedTaskIds(new Set());
                      setLastSelectedIndex(null);
                    }}
                    className="p-3 rounded-xl bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-all"
                    title="Clear selection"
                  >
                    <span className="text-sm font-medium">Clear ({selectedTaskIds.size})</span>
                  </button>
                )}
                <button
                  onClick={copyToClipboard}
                  className={clsx(
                    'p-3 rounded-xl transition-all duration-200 flex items-center gap-2',
                    copyStatus === 'copied'
                      ? 'bg-green-50 text-green-600'
                      : 'bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600'
                  )}
                  title={
                    selectedTaskIds.size > 0
                      ? 'Copy selected with structure'
                      : 'Copy all with structure'
                  }
                >
                  {copyStatus === 'copied' ? <Check size={20} /> : <Copy size={20} />}
                  <span className="text-sm font-medium">
                    {copyStatus === 'copied'
                      ? 'Copied!'
                      : selectedTaskIds.size > 0
                        ? 'Copy Selected'
                        : 'Copy All'}
                  </span>
                </button>
              </div>
            </div>

            {(upcomingDeadlineNodes.length > 0 || selectedTaskIds.size > 0) && (
              <div className="md:hidden px-4 py-3 border-b border-gray-100 space-y-2 flex-shrink-0">
                {upcomingDeadlineNodes.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {upcomingDeadlineNodes.filter((n) => n.status === 'red').length > 0 && (
                      <div className="p-2 rounded-lg bg-red-50 border border-red-100 text-xs text-red-700 max-w-full">
                        <span className="font-semibold">1ヶ月以内: </span>
                        {upcomingDeadlineNodes
                          .filter((n) => n.status === 'red')
                          .map((n) => n.title)
                          .join('、')}
                      </div>
                    )}
                    {upcomingDeadlineNodes.filter((n) => n.status === 'yellow').length > 0 && (
                      <div className="p-2 rounded-lg bg-yellow-50 border border-yellow-100 text-xs text-yellow-800 max-w-full">
                        <span className="font-semibold">2ヶ月以内: </span>
                        {upcomingDeadlineNodes
                          .filter((n) => n.status === 'yellow')
                          .map((n) => n.title)
                          .join('、')}
                      </div>
                    )}
                  </div>
                )}
                {selectedTaskIds.size > 0 && (
                  <button
                    onClick={() => {
                      setSelectedTaskIds(new Set());
                      setLastSelectedIndex(null);
                    }}
                    className="text-xs text-gray-500 px-2 py-1"
                  >
                    選択解除 ({selectedTaskIds.size})
                  </button>
                )}
              </div>
            )}

            {/* Goal tabs */}
            <div className="px-3 md:px-10 pt-3 md:pt-4 flex items-center gap-1 border-b border-gray-100 overflow-x-auto flex-shrink-0">
              <button
                onClick={() => handleSelectTab(ROUTINE_TAB)}
                className={clsx(
                  'px-3 md:px-4 py-2 md:py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors whitespace-nowrap',
                  activeTab === ROUTINE_TAB
                    ? 'border-blue-600 text-blue-700 bg-blue-50/50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                )}
              >
                ルーティン
              </button>

              <button
                onClick={() => handleSelectTab(OTHER_TAB)}
                className={clsx(
                  'px-3 md:px-4 py-2 md:py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors whitespace-nowrap',
                  activeTab === OTHER_TAB
                    ? 'border-blue-600 text-blue-700 bg-blue-50/50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                )}
              >
                その他
              </button>

              {activeGoalIds.map((goalId) => (
                <div
                  key={goalId}
                  className={clsx(
                    'group relative flex items-center gap-1 px-3 md:px-4 py-2 md:py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors whitespace-nowrap',
                    activeTab === goalId
                      ? 'border-blue-600 text-blue-700 bg-blue-50/50'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  )}
                >
                  <button onClick={() => handleSelectTab(goalId)} className="max-w-[160px] truncate">
                    {goalTitleMap.get(goalId) || '目標'}
                  </button>
                  <button
                    type="button"
                    title="タブを削除"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveGoalTab(goalId);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-all"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}

              <button
                onClick={openGoalPicker}
                title="目標を追加"
                className="ml-auto mb-1 p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                <Plus size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 md:p-10 pt-4 md:pt-8 flex flex-col items-center min-h-0">
              {visibleTasks.length === 0 ? (
                <div className="text-gray-400 py-20">タスクがありません</div>
              ) : (
                <div className="max-w-6xl w-full pb-8 md:pb-32 overflow-visible">
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext
                      items={visibleTasks.map((t) => t.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {visibleTasks.map((task, index) => (
                        <SortableTaskItem
                          key={task.id}
                          task={task}
                          index={index}
                          visibleTasks={visibleTasks}
                          isSelected={selectedTaskIds.has(task.id)}
                          isMobile={isMobile}
                          toggleSelection={toggleSelection}
                          toggleStatus={toggleStatus}
                          updateText={updateText}
                          changeIndent={changeIndent}
                          handleKeyDown={handleKeyDown}
                          handlePaste={handlePaste}
                          inputRef={(el) => {
                            inputRefs.current[index] = el;
                          }}
                          isComposingRef={isComposingRef}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden min-h-0">
            <div className="p-4 md:p-10 pb-4 md:pb-6 border-b border-gray-200 bg-white">
              <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setView('journal')}
                    className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500"
                  >
                    <ArrowLeft size={24} />
                  </button>
                  <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-800">Routine Tasks</h1>
                    <p className="text-sm md:text-base text-gray-500">毎日自動的に追加されるタスクを設定します</p>
                  </div>
                </div>
                <button
                  onClick={addRoutine}
                  className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium"
                >
                  <Plus size={20} />
                  追加
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 md:p-10">
              <div className="max-w-3xl mx-auto space-y-4">
                {routineTasks.length === 0 ? (
                  <div className="text-center py-20 bg-white rounded-2xl border-2 border-dashed border-gray-200">
                    <p className="text-gray-400">
                      ルーティンタスクがありません。「追加」ボタンから作成してください。
                    </p>
                  </div>
                ) : (
                  routineTasks.map((routine) => (
                    <div
                      key={routine.id}
                      className="flex items-center gap-4 bg-white p-4 rounded-xl shadow-sm border border-gray-100 group"
                    >
                      <div className="w-2 h-10 bg-blue-400 rounded-full" />
                      <input
                        value={routine.text}
                        onChange={(e) => updateRoutine(routine.id, e.target.value)}
                        placeholder="例: 朝の読書、スクワット20回..."
                        className="flex-1 text-xl font-medium outline-none border-none placeholder-gray-300"
                      />
                      <button
                        onClick={() => deleteRoutine(routine.id)}
                        className="p-2 text-gray-300 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={20} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {goalPickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => setGoalPickerOpen(false)}
          role="presentation"
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-800">目標を追加</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {assignedRoadmap
                    ? `「${assignedRoadmap.title}」のノードから選択`
                    : 'ロードマップがアサインされていません'}
                </p>
              </div>
              <button
                onClick={() => setGoalPickerOpen(false)}
                className="p-2 hover:bg-gray-100 rounded-full"
              >
                <X size={18} className="text-gray-500" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {!assignedRoadmap ? (
                <p className="text-center text-gray-400 py-10 text-sm">
                  サイドバーの「ロードマップアサイン」からロードマップを選んでください。
                </p>
              ) : selectableGoals.length === 0 ? (
                <p className="text-center text-gray-400 py-10 text-sm">
                  追加できる目標がありません。
                </p>
              ) : (
                <ul className="space-y-1">
                  {selectableGoals.map((goal) => {
                    const checked = pendingGoalIds.has(goal.id);
                    return (
                      <li key={goal.id}>
                        <button
                          type="button"
                          onClick={() => {
                            const next = new Set(pendingGoalIds);
                            if (checked) next.delete(goal.id);
                            else next.add(goal.id);
                            setPendingGoalIds(next);
                          }}
                          className={clsx(
                            'w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-3 transition-colors',
                            checked ? 'bg-blue-50 text-blue-800' : 'hover:bg-gray-50 text-gray-700'
                          )}
                          style={{ paddingLeft: `${12 + goal.depth * 16}px` }}
                        >
                          <span
                            className={clsx(
                              'w-5 h-5 rounded border flex items-center justify-center flex-shrink-0',
                              checked
                                ? 'bg-blue-600 border-blue-600 text-white'
                                : 'border-gray-300 bg-white'
                            )}
                          >
                            {checked && <Check size={14} />}
                          </span>
                          <span className="truncate font-medium">{goal.title}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="p-4 border-t border-gray-100 flex justify-end gap-2">
              <button
                onClick={() => setGoalPickerOpen(false)}
                className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100"
              >
                キャンセル
              </button>
              <button
                onClick={confirmAddGoals}
                disabled={pendingGoalIds.size === 0}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
              >
                追加 ({pendingGoalIds.size})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
