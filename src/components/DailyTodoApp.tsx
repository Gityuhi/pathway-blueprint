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
  ChevronDown,
  ChevronRight,
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
  upsertDailyLog,
  loadRoutineTasks,
  saveRoutineTasks,
  getLocalDate,
  generateId,
  findPreviousDailyLog,
  calcDailyAchievementRate,
  migrateOtherTasksToBacklog,
  isRoutineActiveOnDate,
  type Roadmap,
} from '../store';
import type {
  DailyLog,
  DailyTask,
  DailyTaskStatus,
  RoutineTask,
  RoutineFrequency,
} from '../types';

const ROUTINE_TAB = 'routine' as const;
/** 今日限りの例外タスク（最下部固定・繰り越しなし） */
const SPOT_TAB = 'spot' as const;
/** 旧「その他」タブ（履歴互換用。新規作成はしない） */
const OTHER_TAB = 'other' as const;

type BlockId = typeof ROUTINE_TAB | typeof SPOT_TAB | string;

const FIXED_BLOCK_IDS = new Set<string>([ROUTINE_TAB, SPOT_TAB, OTHER_TAB]);

const SWIPE_THRESHOLD = 56;
const MAX_SWIPE_DX = 72;
const LONG_PRESS_DELAY_MS = 320;
/** テキスト入力のクラウド保存デバウンス */
const TEXT_SAVE_DEBOUNCE_MS = 500;

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
  onTextBlur: () => void;
  inputRef: (el: HTMLInputElement | HTMLTextAreaElement | null) => void;
  isComposingRef: React.MutableRefObject<boolean>;
}

/** 直下の小タスク（indent がちょうど +1）を返す */
function getDirectChildren(tasks: DailyTask[], parentIndex: number): DailyTask[] {
  const parentLevel = tasks[parentIndex]?.indentLevel ?? 0;
  const children: DailyTask[] = [];
  for (let j = parentIndex + 1; j < tasks.length; j++) {
    if (tasks[j].indentLevel <= parentLevel) break;
    if (tasks[j].indentLevel === parentLevel + 1) {
      children.push(tasks[j]);
    }
  }
  return children;
}

/** テキストのある直下小タスク */
function getCountableDirectChildren(tasks: DailyTask[], parentIndex: number): DailyTask[] {
  return getDirectChildren(tasks, parentIndex).filter((t) => t.text.trim() !== '');
}

/** タブ／ブロック内の残りタスク数（空・完了・親タスクは除外＝未完了の葉のみ） */
function countRemainingTasks(tasks: DailyTask[]): number {
  let count = 0;
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (t.text.trim() === '') continue;
    if (getCountableDirectChildren(tasks, i).length > 0) continue;
    if (t.status !== 'done') count++;
  }
  return count;
}

/** 進捗表示用: 空でない葉タスクの done / total */
function countBlockProgress(tasks: DailyTask[]): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (t.text.trim() === '') continue;
    if (getCountableDirectChildren(tasks, i).length > 0) continue;
    total++;
    if (t.status === 'done') done++;
  }
  return { done, total };
}

/** 親タスクの status を直下小タスクの完了状況に同期 */
function syncParentStatuses(tasks: DailyTask[]): DailyTask[] {
  const next = tasks.map((t) => ({ ...t }));
  for (let i = next.length - 1; i >= 0; i--) {
    const children = getCountableDirectChildren(next, i);
    if (children.length === 0) continue;
    const allDone = children.every((c) => c.status === 'done');
    if (allDone && next[i].status !== 'done') {
      next[i] = { ...next[i], status: 'done' };
    } else if (!allDone && next[i].status === 'done') {
      next[i] = { ...next[i], status: 'todo' };
    }
  }
  return next;
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
  onTextBlur,
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
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

  const resizeTextArea = useCallback(() => {
    const el = textAreaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const countableChildren = getCountableDirectChildren(visibleTasks, index);
  const isParent = countableChildren.length > 0;
  const allChildrenDone = isParent && countableChildren.every((c) => c.status === 'done');
  const childCount = countableChildren.length;
  const parentLooksDone = isParent && allChildrenDone;
  const textLooksDone = isParent ? allChildrenDone : task.status === 'done';

  useEffect(() => {
    resizeTextArea();
  }, [task.text, indentPx, task.indentLevel, resizeTextArea]);

  const setTextRef = useCallback(
    (el: HTMLInputElement | HTMLTextAreaElement | null) => {
      if (el instanceof HTMLTextAreaElement) {
        textAreaRef.current = el;
      } else {
        textAreaRef.current = null;
      }
      inputRef(el);
      if (el instanceof HTMLTextAreaElement) {
        requestAnimationFrame(() => {
          el.style.height = 'auto';
          el.style.height = `${el.scrollHeight}px`;
        });
      }
    },
    [inputRef]
  );

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
          onClick={() => {
            if (!isParent) toggleStatus(index);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={clsx(
            'flex-shrink-0 rounded-full border-[3px] flex items-center justify-center transition-all duration-200',
            'w-8 h-8 mt-1.5 md:w-10 md:h-10 md:mt-1',
            isParent &&
              parentLooksDone &&
              'border-green-500 bg-green-500 text-white cursor-default',
            isParent &&
              !parentLooksDone &&
              'border-gray-300 bg-white text-gray-600 cursor-default',
            !isParent && task.status === 'todo' && 'border-gray-300 bg-white hover:border-gray-400',
            !isParent && task.status === 'doing' && 'border-blue-500 bg-blue-50 text-blue-500',
            !isParent && task.status === 'done' && 'border-green-500 bg-green-500 text-white'
          )}
          aria-label={
            isParent
              ? parentLooksDone
                ? '小タスク完了'
                : `小タスク${childCount}件`
              : undefined
          }
        >
          {isParent && parentLooksDone && (
            <>
              <CheckCircle2 size={20} strokeWidth={3} className="md:hidden" />
              <CheckCircle2 size={24} strokeWidth={3} className="hidden md:block" />
            </>
          )}
          {isParent && !parentLooksDone && (
            <span className="text-xs md:text-sm font-bold tabular-nums leading-none">
              {childCount}
            </span>
          )}
          {!isParent && task.status === 'doing' && (
            <div className="w-3 h-3 md:w-4 md:h-4 bg-blue-500 rounded-full" />
          )}
          {!isParent && task.status === 'done' && (
            <>
              <CheckCircle2 size={20} strokeWidth={3} className="md:hidden" />
              <CheckCircle2 size={24} strokeWidth={3} className="hidden md:block" />
            </>
          )}
        </button>
        <textarea
          ref={setTextRef}
          value={task.text}
          rows={1}
          onChange={(e) => {
            updateText(index, e.target.value);
            requestAnimationFrame(resizeTextArea);
          }}
          onKeyDown={(e) => handleKeyDown(e, index)}
          onPaste={(e) => handlePaste(e, index)}
          onBlur={() => onTextBlur()}
          onPointerDown={(e) => {
            // PC: 行ドラッグと競合しないよう入力側で止める / モバイル: 長押しドラッグのため伝播
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
            'resize-none overflow-hidden break-words whitespace-pre-wrap',
            isMobile ? 'text-xl' : 'text-3xl',
            textLooksDone && 'text-gray-300 line-through decoration-gray-300 decoration-2',
            !textLooksDone && 'text-gray-800'
          )}
        />
        <div className="mt-3 md:mt-4 opacity-0 group-hover:opacity-100 text-xs text-gray-300 font-mono transition-opacity hidden md:block flex-shrink-0">
          {isParent ? (parentLooksDone ? 'DONE' : String(childCount)) : task.status.toUpperCase()}
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
  return (previousLog?.activeGoalIds ?? []).filter((id) => !FIXED_BLOCK_IDS.has(id));
}

function isRoutineTask(task: DailyTask) {
  return task.goalId == null;
}

function isSpotTask(task: DailyTask) {
  return task.goalId === SPOT_TAB;
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

function blockTitle(blockId: BlockId, goalTitleMap: Map<string, string>): string {
  if (blockId === ROUTINE_TAB) return 'ルーティン';
  if (blockId === SPOT_TAB) return '例外';
  return goalTitleMap.get(blockId) || '目標';
}

function blockEmptyMessage(blockId: BlockId): string {
  if (blockId === ROUTINE_TAB) return 'ルーティンのTodoはまだありません。';
  if (blockId === SPOT_TAB) return '例外のタスクはまだありません。';
  return 'この目標のTodoはまだありません。';
}

function TabRemainingBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className={clsx(
        'inline-flex items-center justify-center flex-shrink-0',
        'min-w-[1.25rem] h-5 px-1 rounded-full border border-current',
        'text-[11px] font-semibold tabular-nums leading-none'
      )}
      aria-label={`残り${count}件`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

function getTasksForBlock(allTasks: DailyTask[], blockId: BlockId): DailyTask[] {
  if (blockId === ROUTINE_TAB) return allTasks.filter(isRoutineTask);
  if (blockId === SPOT_TAB) return allTasks.filter(isSpotTask);
  return allTasks.filter((t) => t.goalId === blockId);
}

function mergeBlockIntoAll(
  allTasks: DailyTask[],
  blockId: BlockId,
  newVisible: DailyTask[]
): DailyTask[] {
  if (blockId === ROUTINE_TAB) {
    const others = allTasks.filter((t) => !isRoutineTask(t));
    return [...newVisible, ...others];
  }
  if (blockId === SPOT_TAB) {
    const others = allTasks.filter((t) => !isSpotTask(t));
    return [...others, ...newVisible];
  }
  const others = allTasks.filter((t) => t.goalId !== blockId);
  return [...others, ...newVisible];
}

function goalIdForBlock(blockId: BlockId): string | null {
  return blockId === ROUTINE_TAB ? null : blockId;
}

function isGoalBlock(blockId: BlockId): boolean {
  return blockId !== ROUTINE_TAB && blockId !== SPOT_TAB;
}

/** 目標ブロックの並べ替え用シェル（ルーティンは対象外） */
function SortableGoalBlockShell({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: (opts: {
    dragHandleProps: React.HTMLAttributes<HTMLElement>;
    isDragging: boolean;
  }) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : 0,
    opacity: isDragging ? 0.85 : 1,
  };

  return (
    <section ref={setNodeRef} style={style} className={className}>
      {children({
        dragHandleProps: { ...attributes, ...listeners },
        isDragging,
      })}
    </section>
  );
}

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;

const FREQUENCY_OPTIONS: { value: RoutineFrequency; label: string }[] = [
  { value: 'daily', label: '毎日' },
  { value: 'weekly', label: '毎週' },
  { value: 'monthly', label: '毎月' },
  { value: 'custom', label: 'カスタマイズ' },
  { value: 'off', label: 'OFF' },
];

function frequencySelectClass(frequency: RoutineFrequency): string {
  if (frequency === 'off') return 'border-gray-200 bg-gray-50 text-gray-500';
  if (frequency === 'custom') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-blue-200 bg-blue-50 text-blue-700';
}

interface SortableRoutineItemProps {
  routine: RoutineTask;
  isMobile: boolean;
  onUpdateText: (id: string, text: string) => void;
  onUpdateRoutine: (id: string, patch: Partial<RoutineTask>) => void;
  onDelete: (id: string) => void;
}

function SortableRoutineItem({
  routine,
  isMobile,
  onUpdateText,
  onUpdateRoutine,
  onDelete,
}: SortableRoutineItemProps) {
  const frequency = routine.frequency ?? 'daily';
  const isOff = frequency === 'off';
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: routine.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 0,
    opacity: isDragging ? 0.5 : 1,
    touchAction: isMobile ? 'pan-y' : undefined,
  };

  const dragListeners = isMobile ? listeners : undefined;
  const handleListeners = !isMobile ? listeners : undefined;

  const selectedWeekDays = new Set(routine.weekDays ?? []);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx(
        'flex flex-col gap-3 bg-white p-4 rounded-xl shadow-sm border border-gray-100 group',
        isDragging && 'shadow-md ring-2 ring-blue-100',
        isOff && 'opacity-70'
      )}
      {...attributes}
      {...(dragListeners ?? {})}
    >
      <div className="flex items-center gap-3 md:gap-4">
        <div
          {...(handleListeners ?? {})}
          className="p-1 text-gray-300 hover:text-gray-600 cursor-grab active:cursor-grabbing flex-shrink-0"
          aria-hidden="true"
        >
          <GripVertical size={20} />
        </div>

        <select
          value={frequency}
          onChange={(e) => {
            const next = e.target.value as RoutineFrequency;
            const patch: Partial<RoutineTask> = { frequency: next };
            if (next === 'weekly' && routine.weekDay == null) {
              patch.weekDay = new Date().getDay();
            }
            if (next === 'monthly' && routine.monthDay == null) {
              patch.monthDay = new Date().getDate();
            }
            if (next === 'custom' && (!routine.weekDays || routine.weekDays.length === 0)) {
              patch.weekDays = [new Date().getDay()];
            }
            onUpdateRoutine(routine.id, patch);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`${routine.text || 'ルーティンタスク'}の繰り返し頻度`}
          className={clsx(
            'flex-shrink-0 w-[7.5rem] px-2 py-1.5 rounded-lg border text-xs font-semibold',
            'focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500',
            frequencySelectClass(frequency)
          )}
        >
          {FREQUENCY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <div
          className={clsx(
            'w-2 h-10 rounded-full flex-shrink-0 transition-colors',
            isOff ? 'bg-gray-200' : 'bg-blue-400'
          )}
          aria-hidden="true"
        />

        <input
          value={routine.text}
          onChange={(e) => onUpdateText(routine.id, e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          placeholder="例: 朝の読書、スクワット20回..."
          className={clsx(
            'flex-1 min-w-0 text-xl font-medium outline-none border-none placeholder-gray-300',
            isOff && 'text-gray-400'
          )}
        />

        <button
          type="button"
          onClick={() => onDelete(routine.id)}
          onPointerDown={(e) => e.stopPropagation()}
          className="p-2 text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
          aria-label="削除"
        >
          <Trash2 size={20} />
        </button>
      </div>

      {frequency === 'weekly' && (
        <div
          className="flex flex-wrap items-center gap-2 pl-9 md:pl-12"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span className="text-xs text-gray-500 font-medium flex-shrink-0">曜日</span>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_LABELS.map((label, day) => {
              const selected = (routine.weekDay ?? 0) === day;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => onUpdateRoutine(routine.id, { weekDay: day })}
                  className={clsx(
                    'w-8 h-8 rounded-lg text-xs font-semibold transition-colors',
                    selected
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {frequency === 'monthly' && (
        <div
          className="flex flex-wrap items-center gap-2 pl-9 md:pl-12"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span className="text-xs text-gray-500 font-medium flex-shrink-0">日付</span>
          <select
            value={routine.monthDay ?? new Date().getDate()}
            onChange={(e) =>
              onUpdateRoutine(routine.id, { monthDay: Number(e.target.value) })
            }
            className="px-2 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}日
              </option>
            ))}
          </select>
          <span className="text-[11px] text-gray-400">
            ※短い月は最終日に表示されます
          </span>
        </div>
      )}

      {frequency === 'custom' && (
        <div
          className="flex flex-wrap items-center gap-2 pl-9 md:pl-12"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span className="text-xs text-gray-500 font-medium flex-shrink-0">曜日</span>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_LABELS.map((label, day) => {
              const selected = selectedWeekDays.has(day);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => {
                    const next = new Set(selectedWeekDays);
                    if (selected) next.delete(day);
                    else next.add(day);
                    const weekDays = [...next].sort((a, b) => a - b);
                    onUpdateRoutine(routine.id, {
                      weekDays: weekDays.length > 0 ? weekDays : [day],
                    });
                  }}
                  className={clsx(
                    'w-8 h-8 rounded-lg text-xs font-semibold transition-colors',
                    selected
                      ? 'bg-amber-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DailyTodoApp({
  upcomingDeadlineNodes,
  roadmaps,
  assignedRoadmapId,
}: DailyTodoAppProps) {
  const [view, setView] = useState<'journal' | 'routine'>('journal');
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(getLocalDate());
  const [routineTasks, setRoutineTasks] = useState<RoutineTask[]>([]);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');
  const [copiedBlockId, setCopiedBlockId] = useState<BlockId | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);

  const [allTasks, setAllTasks] = useState<DailyTask[]>([]);
  const [activeGoalIds, setActiveGoalIds] = useState<string[]>([]);
  const [collapsedBlocks, setCollapsedBlocks] = useState<Set<string>>(new Set());
  const [goalPickerOpen, setGoalPickerOpen] = useState(false);
  const [pendingGoalIds, setPendingGoalIds] = useState<Set<string>>(new Set());
  const [journalDrawerOpen, setJournalDrawerOpen] = useState(false);
  const isMobile = useIsMobile();
  const logsRef = useRef<DailyLog[]>([]);
  const textSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTextSaveRef = useRef<{
    date: string;
    tasks: DailyTask[];
    goalIds: string[];
  } | null>(null);
  const routineSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRefsById = useRef<Map<string, HTMLInputElement | HTMLTextAreaElement>>(new Map());
  const isComposingRef = useRef(false);

  useEffect(() => {
    logsRef.current = logs;
  }, [logs]);

  const assignedRoadmap = useMemo(
    () => roadmaps.find((r) => r.id === (assignedRoadmapId ?? '')) ?? null,
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

  /** ブロック並べ替えはハンドル操作のみ想定のため短距離で発火 */
  const blockSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [loadedLogs, routines] = await Promise.all([
          loadDailyLogs(),
          loadRoutineTasks(),
        ]);
        if (cancelled) return;
        setLogs(loadedLogs);
        setRoutineTasks(routines);
        // 旧「その他」の未完了を Backlog へ移行（初回のみ）
        void migrateOtherTasksToBacklog(loadedLogs).catch((e) =>
          console.error('Backlog migration failed', e)
        );
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persistLog = useCallback(
    async (date: string, tasks: DailyTask[], goalIds: string[]) => {
      const allLogs = logsRef.current;
      const existing = allLogs.find((l) => l.date === date);
      const otherLogs = allLogs.filter((l) => l.date !== date);
      const nextLog: DailyLog = {
        date,
        tasks,
        activeGoalIds: goalIds,
        ...(existing?.reflection !== undefined ? { reflection: existing.reflection } : {}),
      };
      const updatedLogs = [...otherLogs, nextLog].sort((a, b) => b.date.localeCompare(a.date));
      logsRef.current = updatedLogs;
      setLogs(updatedLogs);
      setAllTasks(tasks);
      setActiveGoalIds(goalIds);
      await upsertDailyLog(nextLog);
    },
    []
  );

  const flushTextSave = useCallback(async () => {
    if (textSaveTimerRef.current) {
      clearTimeout(textSaveTimerRef.current);
      textSaveTimerRef.current = null;
    }
    const pending = pendingTextSaveRef.current;
    if (!pending) return;
    pendingTextSaveRef.current = null;
    try {
      await persistLog(pending.date, pending.tasks, pending.goalIds);
    } catch (e) {
      console.error('Failed to flush text save', e);
    }
  }, [persistLog]);

  const scheduleTextSave = useCallback(
    (date: string, tasks: DailyTask[], goalIds: string[]) => {
      pendingTextSaveRef.current = { date, tasks, goalIds };
      if (textSaveTimerRef.current) clearTimeout(textSaveTimerRef.current);
      textSaveTimerRef.current = setTimeout(() => {
        void flushTextSave();
      }, TEXT_SAVE_DEBOUNCE_MS);
    },
    [flushTextSave]
  );

  // 日付切替・アンマウント時に未保存テキストを確定
  useEffect(() => {
    return () => {
      if (textSaveTimerRef.current) clearTimeout(textSaveTimerRef.current);
      const pending = pendingTextSaveRef.current;
      if (pending) {
        pendingTextSaveRef.current = null;
        void upsertDailyLog({
          date: pending.date,
          tasks: pending.tasks,
          activeGoalIds: pending.goalIds,
          reflection: logsRef.current.find((l) => l.date === pending.date)?.reflection,
        });
      }
      if (routineSaveTimerRef.current) clearTimeout(routineSaveTimerRef.current);
    };
  }, [selectedDate]);

  // Load / create snapshot for selected date
  useEffect(() => {
    let cancelled = false;

    (async () => {
      await flushTextSave();
      try {
        // キャッシュがあれば即時。なければ1回だけネットワーク取得
        const currentLogs =
          logsRef.current.length > 0 ? logsRef.current : await loadDailyLogs();
        if (cancelled) return;
        logsRef.current = currentLogs;
        setLogs(currentLogs);

        const log = currentLogs.find((l) => l.date === selectedDate);

        if (log) {
          const goalIds = (log.activeGoalIds ?? []).filter((id) => !FIXED_BLOCK_IDS.has(id));
          let tasks = log.tasks;
          let changed = false;

          if (!tasks.some(isRoutineTask)) {
            tasks = [...tasks, emptyTask(null)];
            changed = true;
          }
          if (!tasks.some(isSpotTask)) {
            tasks = [...tasks, emptyTask(SPOT_TAB)];
            changed = true;
          }
          for (const gid of goalIds) {
            if (!tasks.some((t) => t.goalId === gid)) {
              tasks = [...tasks, emptyTask(gid)];
              changed = true;
            }
          }

          if (changed) {
            await persistLog(selectedDate, tasks, goalIds);
            if (cancelled) return;
          } else {
            setAllTasks(tasks);
            setActiveGoalIds(goalIds);
          }
        } else if (selectedDate === getLocalDate()) {
          const routines = await loadRoutineTasks();
          if (cancelled) return;
          const prev = findPreviousDailyLog(selectedDate, currentLogs);
          const carriedGoals = resolveInitialGoalIds(prev);

          const activeRoutines = routines.filter((r) =>
            isRoutineActiveOnDate(r, new Date(selectedDate + 'T12:00:00'))
          );
          const routineList: DailyTask[] =
            activeRoutines.length > 0
              ? activeRoutines.map((r) => ({
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
            ...goalPlaceholderTasks,
            emptyTask(SPOT_TAB),
          ];

          await persistLog(selectedDate, initialTasks, carriedGoals);
          if (cancelled) return;
        } else {
          setAllTasks([emptyTask(null), emptyTask(SPOT_TAB)]);
          setActiveGoalIds([]);
        }

        setSelectedTaskIds(new Set());
        setLastSelectedIndex(null);
      } catch (e) {
        console.error(e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedDate, persistLog, flushTextSave]);

  useEffect(() => {
    const timer = setInterval(() => {
      void (async () => {
        const todayStr = getLocalDate();
        const currentLogs = await loadDailyLogs();
        if (!currentLogs.find((l) => l.date === todayStr)) {
          setLogs(currentLogs);
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          if (selectedDate === getLocalDate(yesterday)) {
            setSelectedDate(todayStr);
          }
        }
      })();
    }, 60000);
    return () => clearInterval(timer);
  }, [selectedDate]);

  /** 達成率・コピー対象は「その他」を除外 */
  const focusTasks = useMemo(
    () => allTasks.filter((t) => !isOtherTask(t)),
    [allTasks]
  );

  const achievementRate = useMemo(
    () => calcDailyAchievementRate(focusTasks),
    [focusTasks]
  );

  const updateBlockAndSave = useCallback(
    (blockId: BlockId, newVisible: DailyTask[]) => {
      const nextAll = mergeBlockIntoAll(allTasks, blockId, newVisible);
      pendingTextSaveRef.current = null;
      if (textSaveTimerRef.current) {
        clearTimeout(textSaveTimerRef.current);
        textSaveTimerRef.current = null;
      }
      void persistLog(selectedDate, nextAll, activeGoalIds);
    },
    [allTasks, activeGoalIds, selectedDate, persistLog]
  );

  const focusTaskInput = useCallback(
    (taskId: string | undefined, caret: 'start' | 'end' = 'start') => {
      if (!taskId) return;
      const apply = () => {
        const el = inputRefsById.current.get(taskId);
        if (!el) return false;
        el.focus();
        const pos = caret === 'end' ? el.value.length : 0;
        try {
          el.setSelectionRange(pos, pos);
        } catch {
          // ignore unsupported selection
        }
        return true;
      };
      // 削除後の再描画を待ってからフォーカス（必要なら1回リトライ）
      requestAnimationFrame(() => {
        if (!apply()) setTimeout(apply, 0);
      });
    },
    []
  );

  const toggleSelection = (id: string, shiftKey: boolean, index: number, blockTasks: DailyTask[]) => {
    const newSelected = new Set(selectedTaskIds);
    if (shiftKey && lastSelectedIndex !== null) {
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      for (let i = start; i <= end; i++) {
        newSelected.add(blockTasks[i].id);
      }
    } else {
      if (newSelected.has(id)) newSelected.delete(id);
      else newSelected.add(id);
      setLastSelectedIndex(index);
    }
    setSelectedTaskIds(newSelected);
  };

  const handleKeyDown = (
    e: React.KeyboardEvent,
    index: number,
    blockId: BlockId,
    blockTasks: DailyTask[]
  ) => {
    if (isComposingRef.current) return;
    const goalId = goalIdForBlock(blockId);

    if (e.key === 'Enter') {
      e.preventDefault();
      if (blockTasks[index].text.trim() === '' && index === blockTasks.length - 1) return;
      const newTask: DailyTask = {
        id: generateId(),
        text: '',
        status: 'todo',
        indentLevel: blockTasks[index].indentLevel,
        goalId,
      };
      const newVisible = [...blockTasks];
      newVisible.splice(index + 1, 0, newTask);
      updateBlockAndSave(blockId, newVisible);
      focusTaskInput(newTask.id);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const newLevel = e.shiftKey
        ? Math.max(0, blockTasks[index].indentLevel - 1)
        : Math.min(5, blockTasks[index].indentLevel + 1);
      const newVisible = [...blockTasks];
      newVisible[index] = { ...newVisible[index], indentLevel: newLevel };
      updateBlockAndSave(blockId, syncParentStatuses(newVisible));
    } else if (e.key === 'Backspace') {
      if (blockTasks[index].text === '' && blockTasks.length > 1) {
        e.preventDefault();
        // 上の行へ。先頭行を消す場合は次の行が新しい先頭になる
        const focusId =
          index > 0 ? blockTasks[index - 1]?.id : blockTasks[index + 1]?.id;
        const newVisible = blockTasks.filter((_, i) => i !== index);
        updateBlockAndSave(blockId, syncParentStatuses(newVisible));
        // 続けて削除できるよう、フォーカス先の右端へ
        focusTaskInput(focusId, 'end');
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (index > 0) focusTaskInput(blockTasks[index - 1]?.id, 'end');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (index < blockTasks.length - 1) focusTaskInput(blockTasks[index + 1]?.id, 'end');
    }
  };

  const handlePaste = (
    e: React.ClipboardEvent,
    index: number,
    blockId: BlockId,
    blockTasks: DailyTask[]
  ) => {
    const pasteData = e.clipboardData.getData('text');
    const lines = pasteData.split(/\r?\n/).filter((line) => line.trim() !== '' || line === '');
    if (lines.length <= 1) return;

    e.preventDefault();
    const goalId = goalIdForBlock(blockId);
    const newVisible = [...blockTasks];
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

    if (blockTasks[index].text.trim() === '') {
      newVisible.splice(index, 1, ...tasksToInsert);
    } else {
      newVisible.splice(index + 1, 0, ...tasksToInsert);
    }
    updateBlockAndSave(blockId, newVisible);
  };

  const handleDragEnd = (event: DragEndEvent, blockId: BlockId, blockTasks: DailyTask[]) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = blockTasks.findIndex((t) => t.id === active.id);
    const newIndex = blockTasks.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    updateBlockAndSave(blockId, arrayMove(blockTasks, oldIndex, newIndex));
  };

  const toggleStatus = (index: number, blockId: BlockId, blockTasks: DailyTask[]) => {
    const current = blockTasks[index].status;
    const next = current === 'todo' ? 'doing' : current === 'doing' ? 'done' : 'todo';
    const newVisible = [...blockTasks];
    newVisible[index] = { ...newVisible[index], status: next };
    updateBlockAndSave(blockId, syncParentStatuses(newVisible));
  };

  const updateText = (index: number, text: string, blockId: BlockId, blockTasks: DailyTask[]) => {
    const newVisible = [...blockTasks];
    newVisible[index] = { ...newVisible[index], text };
    const nextAll = mergeBlockIntoAll(allTasks, blockId, newVisible);
    setAllTasks(nextAll);
    const existing = logsRef.current.find((l) => l.date === selectedDate);
    const nextLog: DailyLog = {
      date: selectedDate,
      tasks: nextAll,
      activeGoalIds: activeGoalIds,
      ...(existing?.reflection !== undefined ? { reflection: existing.reflection } : {}),
    };
    const otherLogs = logsRef.current.filter((l) => l.date !== selectedDate);
    const updatedLogs = [...otherLogs, nextLog].sort((a, b) => b.date.localeCompare(a.date));
    logsRef.current = updatedLogs;
    setLogs(updatedLogs);
    scheduleTextSave(selectedDate, nextAll, activeGoalIds);
  };

  const changeIndent = useCallback(
    (index: number, delta: -1 | 1, blockId: BlockId, blockTasks: DailyTask[]) => {
      const current = blockTasks[index];
      if (!current) return;
      const previousIndent = blockTasks[index - 1]?.indentLevel ?? -1;
      const maxIndent = delta > 0 ? Math.min(5, previousIndent + 1) : 5;
      const newLevel = Math.min(maxIndent, Math.max(0, current.indentLevel + delta));
      if (newLevel === current.indentLevel) return;
      const newVisible = [...blockTasks];
      newVisible[index] = { ...newVisible[index], indentLevel: newLevel };
      updateBlockAndSave(blockId, syncParentStatuses(newVisible));
    },
    [updateBlockAndSave]
  );

  const tasksToCopyText = (tasks: DailyTask[]) =>
    tasks.map((task) => `${'\t'.repeat(task.indentLevel)}${task.text}`).join('\n');

  const copyToClipboard = () => {
    const tasksToCopy =
      selectedTaskIds.size > 0
        ? focusTasks.filter((t) => selectedTaskIds.has(t.id))
        : focusTasks;
    navigator.clipboard.writeText(tasksToCopyText(tasksToCopy)).then(() => {
      setCopyStatus('copied');
      setCopiedBlockId(null);
      setTimeout(() => setCopyStatus('idle'), 2000);
    });
  };

  const copyBlockToClipboard = (blockId: BlockId) => {
    const blockTasks = getTasksForBlock(allTasks, blockId);
    const tasksToCopy =
      selectedTaskIds.size > 0
        ? blockTasks.filter((t) => selectedTaskIds.has(t.id))
        : blockTasks;
    navigator.clipboard.writeText(tasksToCopyText(tasksToCopy)).then(() => {
      setCopiedBlockId(blockId);
      setCopyStatus('idle');
      setTimeout(() => setCopiedBlockId((cur) => (cur === blockId ? null : cur)), 2000);
    });
  };

  const toggleBlockCollapsed = (blockId: BlockId) => {
    setCollapsedBlocks((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  };

  const handleRemoveGoalBlock = (goalId: string) => {
    const nextGoals = activeGoalIds.filter((id) => id !== goalId);
    let nextTasks = allTasks.filter((t) => t.goalId !== goalId);
    if (!nextTasks.some(isRoutineTask)) nextTasks = [...nextTasks, emptyTask(null)];
    if (!nextTasks.some(isSpotTask)) nextTasks = [...nextTasks, emptyTask(SPOT_TAB)];
    void persistLog(selectedDate, nextTasks, nextGoals);
  };

  const handleGoalBlockDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = activeGoalIds.findIndex((id) => id === active.id);
    const newIndex = activeGoalIds.findIndex((id) => id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const nextGoals = arrayMove(activeGoalIds, oldIndex, newIndex);
    void persistLog(selectedDate, allTasks, nextGoals);
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
    void persistLog(selectedDate, [...allTasks, ...placeholders], nextGoals);
    setCollapsedBlocks((prev) => {
      const next = new Set(prev);
      toAdd.forEach((id) => next.delete(id));
      return next;
    });
    setGoalPickerOpen(false);
  };

  const addRoutine = () => {
    const today = new Date();
    const newRoutines = [
      ...routineTasks,
      {
        id: generateId(),
        text: '',
        frequency: 'daily' as const,
        weekDay: today.getDay(),
        monthDay: today.getDate(),
        weekDays: [today.getDay()],
      },
    ];
    setRoutineTasks(newRoutines);
    void saveRoutineTasks(newRoutines);
  };

  const updateRoutine = (id: string, text: string) => {
    const newRoutines = routineTasks.map((r) => (r.id === id ? { ...r, text } : r));
    setRoutineTasks(newRoutines);
    if (routineSaveTimerRef.current) clearTimeout(routineSaveTimerRef.current);
    routineSaveTimerRef.current = setTimeout(() => {
      void saveRoutineTasks(newRoutines);
    }, TEXT_SAVE_DEBOUNCE_MS);
  };

  const patchRoutine = (id: string, patch: Partial<RoutineTask>) => {
    const newRoutines = routineTasks.map((r) =>
      r.id === id ? { ...r, ...patch } : r
    );
    setRoutineTasks(newRoutines);
    void saveRoutineTasks(newRoutines);
  };

  const handleRoutineDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = routineTasks.findIndex((r) => r.id === active.id);
    const newIndex = routineTasks.findIndex((r) => r.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const newRoutines = arrayMove(routineTasks, oldIndex, newIndex);
    setRoutineTasks(newRoutines);
    void saveRoutineTasks(newRoutines);
  };

  const deleteRoutine = (id: string) => {
    if (routineSaveTimerRef.current) {
      clearTimeout(routineSaveTimerRef.current);
      routineSaveTimerRef.current = null;
    }
    const newRoutines = routineTasks.filter((r) => r.id !== id);
    setRoutineTasks(newRoutines);
    void saveRoutineTasks(newRoutines);
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

            {/* 目標追加バー + ブロック一覧 */}
            <div className="px-3 md:px-10 pt-3 md:pt-4 flex items-center gap-2 flex-shrink-0">
              <div className="flex-1 min-w-0 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm md:text-base text-gray-400 truncate">
                ロードマップのノードから目標を追加
              </div>
              <button
                type="button"
                onClick={openGoalPicker}
                title="目標を追加"
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors font-medium flex-shrink-0"
              >
                <Plus size={18} />
                <span className="hidden sm:inline">目標を追加</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 md:p-10 pt-4 md:pt-6 flex flex-col items-center min-h-0">
              <div className="max-w-6xl w-full space-y-4 pb-8 md:pb-32">
                {(() => {
                  const renderBlockBody = (blockId: BlockId) => {
                    const blockTasks = getTasksForBlock(allTasks, blockId);
                    return (
                      <>
                        {blockTasks.length === 0 ? (
                          <p className="text-gray-400 text-sm py-6 text-center">
                            {blockEmptyMessage(blockId)}
                          </p>
                        ) : (
                          <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragEnd={(event) => handleDragEnd(event, blockId, blockTasks)}
                          >
                            <SortableContext
                              items={blockTasks.map((t) => t.id)}
                              strategy={verticalListSortingStrategy}
                            >
                              {blockTasks.map((task, index) => (
                                <SortableTaskItem
                                  key={task.id}
                                  task={task}
                                  index={index}
                                  visibleTasks={blockTasks}
                                  isSelected={selectedTaskIds.has(task.id)}
                                  isMobile={isMobile}
                                  toggleSelection={(id, shiftKey, idx) =>
                                    toggleSelection(id, shiftKey, idx, blockTasks)
                                  }
                                  toggleStatus={(idx) => toggleStatus(idx, blockId, blockTasks)}
                                  updateText={(idx, text) =>
                                    updateText(idx, text, blockId, blockTasks)
                                  }
                                  changeIndent={(idx, delta) =>
                                    changeIndent(idx, delta, blockId, blockTasks)
                                  }
                                  handleKeyDown={(e, idx) =>
                                    handleKeyDown(e, idx, blockId, blockTasks)
                                  }
                                  handlePaste={(e, idx) =>
                                    handlePaste(e, idx, blockId, blockTasks)
                                  }
                                  onTextBlur={() => {
                                    void flushTextSave();
                                  }}
                                  inputRef={(el) => {
                                    if (el) inputRefsById.current.set(task.id, el);
                                    else inputRefsById.current.delete(task.id);
                                  }}
                                  isComposingRef={isComposingRef}
                                />
                              ))}
                            </SortableContext>
                          </DndContext>
                        )}

                        <div className="mt-2 flex justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              const goalId = goalIdForBlock(blockId);
                              const newTask = emptyTask(goalId);
                              updateBlockAndSave(blockId, [...blockTasks, newTask]);
                              focusTaskInput(newTask.id);
                            }}
                            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium px-2 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
                          >
                            <Plus size={16} />
                            Todoを追加
                          </button>
                        </div>
                      </>
                    );
                  };

                  const renderBlockHeader = (
                    blockId: BlockId,
                    opts?: {
                      dragHandleProps?: React.HTMLAttributes<HTMLElement>;
                      isDragging?: boolean;
                    }
                  ) => {
                    const blockTasks = getTasksForBlock(allTasks, blockId);
                    const collapsed = collapsedBlocks.has(blockId);
                    const progress = countBlockProgress(blockTasks);
                    const remaining = countRemainingTasks(blockTasks);
                    const title = blockTitle(blockId, goalTitleMap);
                    const showDrag = isGoalBlock(blockId);

                    return (
                      <div
                        className={clsx(
                          'flex items-center gap-2 px-3 md:px-4 py-3 bg-gray-50/80 border-b border-gray-100',
                          opts?.isDragging && 'bg-blue-50/80'
                        )}
                      >
                        {showDrag && opts?.dragHandleProps && (
                          <button
                            type="button"
                            {...opts.dragHandleProps}
                            className="p-1 rounded-md text-gray-300 hover:text-gray-600 cursor-grab active:cursor-grabbing flex-shrink-0 touch-none"
                            aria-label="ブロックを並べ替え"
                            onClick={(e) => e.preventDefault()}
                          >
                            <GripVertical size={18} />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => toggleBlockCollapsed(blockId)}
                          className="p-1 rounded-md text-gray-500 hover:bg-gray-200/80 transition-colors flex-shrink-0"
                          aria-expanded={!collapsed}
                          aria-label={collapsed ? '展開' : '折りたたむ'}
                        >
                          {collapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
                        </button>

                        <button
                          type="button"
                          onClick={() => toggleBlockCollapsed(blockId)}
                          className="flex-1 min-w-0 text-left flex items-center gap-2"
                        >
                          <TabRemainingBadge count={remaining} />
                          <span className="font-bold text-gray-800 truncate text-sm md:text-base">
                            {title}
                          </span>
                          {blockId === SPOT_TAB && (
                            <span className="hidden sm:inline text-[11px] font-normal text-gray-400 truncate">
                              ロードマップ外・今日限り
                            </span>
                          )}
                        </button>

                        <span className="text-xs md:text-sm tabular-nums text-gray-500 font-medium flex-shrink-0">
                          {progress.done} / {progress.total}
                        </span>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            copyBlockToClipboard(blockId);
                          }}
                          className={clsx(
                            'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors flex-shrink-0',
                            copiedBlockId === blockId
                              ? 'text-green-600 bg-green-50'
                              : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
                          )}
                          title="このブロックのTodoをコピー"
                          aria-label="このブロックのTodoをコピー"
                        >
                          {copiedBlockId === blockId ? <Check size={14} /> : <Copy size={14} />}
                          <span className="hidden md:inline">
                            {copiedBlockId === blockId ? 'Copied' : 'Copy'}
                          </span>
                        </button>

                        {showDrag && (
                          <button
                            type="button"
                            onClick={() => handleRemoveGoalBlock(blockId)}
                            className="text-xs md:text-sm text-gray-400 hover:text-red-500 px-2 py-1 rounded-md hover:bg-red-50 transition-colors flex-shrink-0"
                          >
                            削除
                          </button>
                        )}
                      </div>
                    );
                  };

                  const routineCollapsed = collapsedBlocks.has(ROUTINE_TAB);
                  const spotCollapsed = collapsedBlocks.has(SPOT_TAB);

                  return (
                    <>
                      <section
                        className={clsx(
                          'rounded-2xl border bg-white overflow-hidden transition-colors',
                          'border-gray-200 border-l-4 border-l-blue-300'
                        )}
                      >
                        {renderBlockHeader(ROUTINE_TAB)}
                        {!routineCollapsed && (
                          <div className="p-2 md:p-4">{renderBlockBody(ROUTINE_TAB)}</div>
                        )}
                      </section>

                      <DndContext
                        sensors={blockSensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleGoalBlockDragEnd}
                      >
                        <SortableContext
                          items={activeGoalIds}
                          strategy={verticalListSortingStrategy}
                        >
                          <div className="space-y-4">
                            {activeGoalIds.map((goalId) => {
                              const collapsed = collapsedBlocks.has(goalId);
                              return (
                                <SortableGoalBlockShell
                                  key={goalId}
                                  id={goalId}
                                  className={clsx(
                                    'rounded-2xl border bg-white overflow-hidden transition-colors',
                                    'border-gray-200 border-l-4 border-l-blue-500'
                                  )}
                                >
                                  {({ dragHandleProps, isDragging }) => (
                                    <>
                                      {renderBlockHeader(goalId, {
                                        dragHandleProps,
                                        isDragging,
                                      })}
                                      {!collapsed && (
                                        <div className="p-2 md:p-4">
                                          {renderBlockBody(goalId)}
                                        </div>
                                      )}
                                    </>
                                  )}
                                </SortableGoalBlockShell>
                              );
                            })}
                          </div>
                        </SortableContext>
                      </DndContext>

                      <section
                        className={clsx(
                          'rounded-2xl border bg-white overflow-hidden transition-colors',
                          'border-gray-200 border-l-4 border-l-amber-400'
                        )}
                      >
                        {renderBlockHeader(SPOT_TAB)}
                        {!spotCollapsed && (
                          <div className="p-2 md:p-4">{renderBlockBody(SPOT_TAB)}</div>
                        )}
                      </section>
                    </>
                  );
                })()}
              </div>
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
                    <p className="text-sm md:text-base text-gray-500">
                      毎日・毎週・毎月・曜日指定で繰り返しを設定します。OFFにしたタスクはToDoに反映されません。
                    </p>
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
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleRoutineDragEnd}
                  >
                    <SortableContext
                      items={routineTasks.map((r) => r.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-4">
                        {routineTasks.map((routine) => (
                          <SortableRoutineItem
                            key={routine.id}
                            routine={routine}
                            isMobile={isMobile}
                            onUpdateText={updateRoutine}
                            onUpdateRoutine={patchRoutine}
                            onDelete={deleteRoutine}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
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
