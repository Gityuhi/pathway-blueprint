import { useEffect, useMemo, useState } from 'react';
import {
  eachDayOfInterval,
  format,
  getDate,
  getDay,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  startOfMonth,
  addMonths,
  subMonths,
} from 'date-fns';
import { ja } from 'date-fns/locale';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, X, Check, Save, Edit3 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getLocalDate, loadDailyLogs, saveDailyLogReflection } from '../store';
import type { DailyLog, DailyTask } from '../types';

type DayMark = 'complete' | 'incomplete' | 'today' | 'future' | 'other-month';

function getCountableTasks(tasks: DailyTask[]): DailyTask[] {
  return tasks.filter((t) => t.text.trim() !== '');
}

/** その日のスナップショットから ○ / × を判定 */
function evaluateDay(log: DailyLog | undefined): 'complete' | 'incomplete' {
  const tasks = getCountableTasks(log?.tasks ?? []);
  if (tasks.length === 0) return 'incomplete';
  return tasks.every((t) => t.status === 'done') ? 'complete' : 'incomplete';
}

function useTimeLeft() {
  const [label, setLabel] = useState('00:00:00 left');

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const end = new Date(now);
      end.setHours(24, 0, 0, 0);
      const ms = Math.max(0, end.getTime() - now.getTime());
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      setLabel(
        `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} left`
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return label;
}

export default function ActivityHeatmap() {
  const [cursorMonth, setCursorMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [logs, setLogs] = useState<DailyLog[]>(() => loadDailyLogs());
  const [modalDate, setModalDate] = useState<string | null>(null);
  const [reflectionDraft, setReflectionDraft] = useState('');
  const [isEditingReflection, setIsEditingReflection] = useState(true);
  const [reflectionSaved, setReflectionSaved] = useState(false);

  const today = useMemo(() => {
    const s = getLocalDate();
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }, []);

  const timeLeft = useTimeLeft();

  // Refresh logs when mounting / month changes (in case Daily Todo updated)
  useEffect(() => {
    setLogs(loadDailyLogs());
  }, [cursorMonth]);

  const logMap = useMemo(() => {
    const map = new Map<string, DailyLog>();
    logs.forEach((l) => map.set(l.date, l));
    return map;
  }, [logs]);

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(cursorMonth);
    const startPad = getDay(monthStart); // 0 = Sun
    const gridStart = new Date(monthStart);
    gridStart.setDate(gridStart.getDate() - startPad);

    // 6 weeks × 7 days
    const gridEnd = new Date(gridStart);
    gridEnd.setDate(gridEnd.getDate() + 41);

    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [cursorMonth]);

  const getMark = (day: Date): DayMark => {
    if (!isSameMonth(day, cursorMonth)) return 'other-month';
    if (isSameDay(day, today)) return 'today';
    if (isAfter(day, today)) return 'future';
    const dateStr = format(day, 'yyyy-MM-dd');
    return evaluateDay(logMap.get(dateStr));
  };

  const modalLog = modalDate ? logMap.get(modalDate) : undefined;
  const modalTasks = getCountableTasks(modalLog?.tasks ?? []);

  useEffect(() => {
    if (!modalDate) return;
    const saved = modalLog?.reflection ?? '';
    setReflectionDraft(saved);
    setIsEditingReflection(!saved.trim());
    setReflectionSaved(false);
  }, [modalDate, modalLog?.reflection]);

  const handleSaveReflection = () => {
    if (!modalDate) return;
    const updated = saveDailyLogReflection(modalDate, reflectionDraft);
    setLogs(updated);
    setIsEditingReflection(false);
    setReflectionSaved(true);
    setTimeout(() => setReflectionSaved(false), 2000);
  };

  const closeModal = () => {
    setModalDate(null);
    setReflectionDraft('');
    setIsEditingReflection(true);
    setReflectionSaved(false);
  };

  return (
    <div className="w-full h-full min-h-0 overflow-y-auto bg-gray-100 flex items-start md:items-center justify-center p-3 md:p-8">
      <div className="w-full max-w-md bg-[#2a2d35] rounded-2xl md:rounded-3xl shadow-2xl p-4 md:p-6 text-white">
        {/* Month nav */}
        <div className="flex items-center justify-between mb-4 md:mb-6">
          <button
            type="button"
            onClick={() => setCursorMonth((m) => subMonths(m, 1))}
            className="p-2 rounded-full hover:bg-white/10 text-gray-300 transition-colors"
          >
            <ChevronLeft size={22} />
          </button>
          <h2 className="text-base md:text-lg font-semibold tracking-wide">
            {format(cursorMonth, 'MMMM yyyy', { locale: ja })}
          </h2>
          <button
            type="button"
            onClick={() => setCursorMonth((m) => addMonths(m, 1))}
            className="p-2 rounded-full hover:bg-white/10 text-gray-300 transition-colors"
          >
            <ChevronRight size={22} />
          </button>
        </div>

        {/* Day + countdown */}
        <div className="flex items-baseline justify-between mb-4 md:mb-6 px-1">
          <div className="text-2xl md:text-3xl font-bold tracking-tight">
            Day {getDate(today)}
          </div>
          <div className="text-xs md:text-sm text-gray-400 font-mono tabular-nums">{timeLeft}</div>
        </div>

        {/* Weekday headers */}
        <div className="grid grid-cols-7 gap-1 md:gap-2 mb-2 md:mb-3 text-center text-[10px] md:text-xs text-gray-500 font-medium">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <div key={`${d}-${i}`}>{d}</div>
          ))}
        </div>

        {/* Days */}
        <div className="grid grid-cols-7 gap-1 md:gap-2">
          {calendarDays.map((day) => {
            const mark = getMark(day);
            const dateStr = format(day, 'yyyy-MM-dd');
            const inMonth = isSameMonth(day, cursorMonth);
            const canOpen = inMonth && (isBefore(day, today) || isSameDay(day, today));

            return (
              <button
                key={dateStr}
                type="button"
                disabled={!inMonth}
                onClick={() => {
                  if (canOpen) setModalDate(dateStr);
                }}
                onDoubleClick={() => {
                  if (canOpen) setModalDate(dateStr);
                }}
                title={
                  canOpen
                    ? `${dateStr}（タップで詳細）`
                    : dateStr
                }
                className={clsx(
                  'aspect-square rounded-full flex flex-col items-center justify-center relative transition-transform min-w-0',
                  inMonth && 'hover:scale-105 active:scale-95',
                  mark === 'other-month' && 'invisible pointer-events-none',
                  mark === 'today' && 'bg-blue-500/25 border-2 md:border-[3px] border-blue-500 text-white',
                  mark === 'future' && 'bg-[#3a3d47] text-gray-400',
                  mark === 'incomplete' &&
                    'border border-dashed md:border-2 border-red-500/80 text-gray-200',
                  mark === 'complete' &&
                    'border border-dashed md:border-2 border-emerald-500/80 text-gray-200'
                )}
              >
                <span
                  className={clsx(
                    'text-xs md:text-sm font-semibold leading-none',
                    mark === 'today' && 'text-white',
                    mark === 'future' && 'text-gray-400'
                  )}
                >
                  {getDate(day)}
                </span>
                {mark === 'incomplete' && (
                  <X size={12} className="text-red-500 mt-0.5 md:hidden" strokeWidth={3} />
                )}
                {mark === 'incomplete' && (
                  <X size={14} className="text-red-500 mt-0.5 hidden md:block" strokeWidth={3} />
                )}
                {mark === 'complete' && (
                  <Check size={12} className="text-emerald-400 mt-0.5 md:hidden" strokeWidth={3} />
                )}
                {mark === 'complete' && (
                  <Check size={14} className="text-emerald-400 mt-0.5 hidden md:block" strokeWidth={3} />
                )}
              </button>
            );
          })}
        </div>

        <p className="mt-4 md:mt-5 text-center text-[10px] md:text-xs text-gray-500">
          過去の日付をタップすると、その日の Todo と振り返りを確認できます
        </p>
      </div>

      {modalDate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={closeModal}
          role="presentation"
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg md:max-w-3xl max-h-[85vh] flex flex-col overflow-hidden text-gray-800"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="p-5 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-xl font-bold">
                  {format(new Date(modalDate + 'T00:00:00'), 'yyyy年M月d日(E)', {
                    locale: ja,
                  })}
                </h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  {evaluateDay(modalLog) === 'complete' ? 'すべて完了' : '未完了あり / タスクなし'}
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="p-2 hover:bg-gray-100 rounded-full"
              >
                <X size={18} className="text-gray-500" />
              </button>
            </div>

            <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">
              <section className="p-5 border-b md:border-b-0 md:border-r border-gray-100 md:w-1/2 md:overflow-y-auto md:min-h-0">
                <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  Todo
                </h4>
                {modalTasks.length === 0 ? (
                  <p className="text-center text-gray-400 py-6 text-sm">この日の Todo はありません</p>
                ) : (
                  <ul className="space-y-2">
                    {modalTasks.map((task) => (
                      <li
                        key={task.id}
                        className="flex items-start gap-3 px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-100"
                        style={{ paddingLeft: `${12 + task.indentLevel * 16}px` }}
                      >
                        <span
                          className={clsx(
                            'mt-0.5 flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center',
                            task.status === 'todo' && 'border-gray-300 bg-white',
                            task.status === 'doing' && 'border-blue-500 bg-blue-50',
                            task.status === 'done' && 'border-green-500 bg-green-500 text-white'
                          )}
                        >
                          {task.status === 'doing' && (
                            <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                          )}
                          {task.status === 'done' && <Check size={14} strokeWidth={3} />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p
                            className={clsx(
                              'text-base font-medium',
                              task.status === 'done' && 'text-gray-400 line-through'
                            )}
                          >
                            {task.text}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5 uppercase tracking-wide">
                            {task.status}
                            {task.goalId == null
                              ? ' · ルーティン'
                              : task.goalId === 'other'
                                ? ' · その他'
                                : ' · 目標'}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="p-5 md:w-1/2 md:overflow-y-auto md:min-h-0">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
                    振り返り
                  </h4>
                  {!isEditingReflection && (
                    <button
                      type="button"
                      onClick={() => setIsEditingReflection(true)}
                      className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium"
                    >
                      <Edit3 size={16} />
                      編集
                    </button>
                  )}
                </div>

                {isEditingReflection ? (
                  <div className="space-y-3">
                    <textarea
                      value={reflectionDraft}
                      onChange={(e) => setReflectionDraft(e.target.value)}
                      placeholder="Markdown で振り返りを書く..."
                      className="w-full min-h-[140px] md:min-h-[220px] p-3 rounded-xl border border-gray-200 bg-gray-50 text-gray-800 text-sm leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 font-mono"
                    />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleSaveReflection}
                        className={clsx(
                          'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                          reflectionSaved
                            ? 'bg-green-600 text-white'
                            : 'bg-blue-600 text-white hover:bg-blue-700'
                        )}
                      >
                        {reflectionSaved ? <Check size={16} /> : <Save size={16} />}
                        {reflectionSaved ? '保存しました' : '保存'}
                      </button>
                    </div>
                  </div>
                ) : reflectionDraft.trim() ? (
                  <article className="prose prose-sm max-w-none prose-headings:text-gray-800 prose-p:text-gray-700 prose-a:text-blue-600 prose-strong:text-gray-800 prose-code:text-gray-800 prose-pre:bg-gray-50 prose-pre:border prose-pre:border-gray-200">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{reflectionDraft}</ReactMarkdown>
                  </article>
                ) : (
                  <p className="text-sm text-gray-400 text-center py-8">
                    振り返りはまだありません。「編集」から Markdown で記録できます。
                  </p>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
