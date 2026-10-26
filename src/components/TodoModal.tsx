import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, StickyNote } from 'lucide-react';
import type { NodeData, Todo } from '../types';
import { getLocalDate } from '../store';

interface TodoModalProps {
  isOpen: boolean;
  onClose: () => void;
  nodeId: string;
  data: NodeData;
  onUpdate: (id: string, newData: NodeData) => void;
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function buildPayload(
  title: string,
  todos: Todo[],
  deadline: string | undefined,
  memo: string,
  progress: number
): NodeData {
  const trimmedMemo = memo.trim();

  return {
    title,
    todos,
    progress: clampProgress(progress),
    deadline,
    memo: trimmedMemo ? memo : undefined,
  };
}

function snapshotKey(payload: NodeData): string {
  return JSON.stringify({
    title: payload.title,
    todos: payload.todos,
    deadline: payload.deadline ?? null,
    memo: payload.memo ?? null,
    progress: payload.progress,
  });
}

const TodoModal = ({ isOpen, onClose, nodeId, data, onUpdate }: TodoModalProps) => {
  const [title, setTitle] = useState(data.title);
  const [progress, setProgress] = useState(clampProgress(data.progress));
  const [deadline, setDeadline] = useState<string | undefined>(data.deadline);
  const [memo, setMemo] = useState(data.memo ?? '');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const todosRef = useRef<Todo[]>(data.todos);
  const lastPushedKeyRef = useRef<string>('');
  const overlayDownOnSelfRef = useRef(false);
  const stateRef = useRef({ title, progress, deadline, memo });

  stateRef.current = { title, progress, deadline, memo };

  const pushUpdate = useCallback(
    (next: { title: string; progress: number; deadline: string | undefined; memo: string }) => {
      const payload = buildPayload(
        next.title,
        todosRef.current,
        next.deadline,
        next.memo,
        next.progress
      );
      const key = snapshotKey(payload);
      if (key === lastPushedKeyRef.current) return;
      lastPushedKeyRef.current = key;
      onUpdate(nodeId, payload);
    },
    [nodeId, onUpdate]
  );

  // モーダルを開いた時 / ノード切替時のみローカル状態を初期化（data の毎更新では同期しない）
  useEffect(() => {
    if (!isOpen) return;
    const initialProgress = clampProgress(data.progress);
    const initial = {
      title: data.title,
      progress: initialProgress,
      deadline: data.deadline,
      memo: data.memo ?? '',
    };
    todosRef.current = data.todos;
    setTitle(initial.title);
    setProgress(initial.progress);
    setDeadline(initial.deadline);
    setMemo(initial.memo);
    lastPushedKeyRef.current = snapshotKey(
      buildPayload(initial.title, data.todos, initial.deadline, initial.memo, initial.progress)
    );
    // data は開いた瞬間の値だけ使う
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, nodeId]);

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => {
      const el = titleInputRef.current;
      if (!el) return;
      el.focus();
      el.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen, nodeId]);

  // 親への反映はデバウンスし、入力中の再レンダー連鎖を防ぐ
  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => {
      pushUpdate({ title, progress, deadline, memo });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [title, progress, deadline, memo, isOpen, pushUpdate]);

  const handleClose = () => {
    pushUpdate(stateRef.current);
    onClose();
  };

  const handleOverlayPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    overlayDownOnSelfRef.current = e.target === e.currentTarget;
  };

  const handleOverlayPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const startedOnOverlay = overlayDownOnSelfRef.current;
    overlayDownOnSelfRef.current = false;
    if (startedOnOverlay && e.target === e.currentTarget) {
      handleClose();
    }
  };

  if (!isOpen) return null;

  const fill = progress >= 100 ? '#22c55e' : '#3b82f6';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onPointerDown={handleOverlayPointerDown}
      onPointerUp={handleOverlayPointerUp}
      onPointerCancel={() => {
        overlayDownOnSelfRef.current = false;
      }}
      role="presentation"
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh] h-[min(720px,90vh)] animate-in fade-in zoom-in duration-200"
        onPointerDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title.trim() || 'ノード'}
      >
        {/* Header */}
        <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-gray-50 shrink-0">
          <input
            ref={titleInputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="text-2xl font-bold bg-transparent border-none outline-none w-full mr-4 placeholder-gray-400"
            placeholder="タイトルを入力..."
            aria-label="タイトル"
          />
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-200 rounded-full transition-colors shrink-0"
            aria-label="閉じる"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Deadline */}
        <div className="px-5 pt-4 shrink-0">
          <label htmlFor="deadline" className="block text-xs font-medium text-gray-500 mb-1">
            期限
          </label>
          <input
            id="deadline"
            type="date"
            value={deadline || ''}
            onChange={(e) => setDeadline(e.target.value)}
            min={getLocalDate()}
            className="w-full max-w-xs px-3 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
          />
        </div>

        <div className="flex-1 min-h-0 flex flex-col border-t border-gray-100 mt-4">
          <div className="px-5 py-4 shrink-0">
            <div className="flex items-baseline justify-between gap-3 mb-3">
              <label htmlFor="node-progress" className="text-sm font-semibold text-gray-700">
                進捗
              </label>
              <span className="text-2xl font-bold tabular-nums text-gray-800" aria-hidden>
                {progress}%
              </span>
            </div>
            <input
              id="node-progress"
              type="range"
              min={0}
              max={100}
              step={1}
              value={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              onChange={(e) => setProgress(clampProgress(Number(e.target.value)))}
              className="progress-slider"
              style={
                {
                  '--progress': String(progress),
                  '--progress-fill': fill,
                } as React.CSSProperties
              }
            />
          </div>

          <div className="flex flex-col min-h-0 flex-1 border-t border-gray-100">
            <div className="px-5 py-3 shrink-0 flex items-center gap-2">
              <StickyNote size={16} className="text-amber-500" />
              <h3 className="text-sm font-semibold text-gray-700">メモ</h3>
            </div>
            <div className="px-5 pb-5 flex-1 min-h-0 flex flex-col">
              <textarea
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="このノードについてのメモを残せます..."
                className="flex-1 min-h-[140px] w-full resize-none px-4 py-3 rounded-xl border border-gray-200 bg-amber-50/40 focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400 transition-all text-sm text-gray-700 leading-relaxed"
              />
              <p className="mt-2 text-xs text-gray-400">
                メモがあるとロードマップ上にコメントマークが表示されます
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TodoModal;
