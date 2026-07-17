import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Plus, Trash2, Check, StickyNote } from 'lucide-react';
import type { NodeData, Todo } from '../types';
import clsx from 'clsx';
import { getLocalDate } from '../store';

interface TodoModalProps {
  isOpen: boolean;
  onClose: () => void;
  nodeId: string;
  data: NodeData;
  onUpdate: (id: string, newData: NodeData) => void;
}

function buildPayload(
  title: string,
  todos: Todo[],
  deadline: string | undefined,
  memo: string
): NodeData {
  const total = todos.length;
  const completed = todos.filter((t) => t.completed).length;
  const progress = total === 0 ? 0 : (completed / total) * 100;
  const trimmedMemo = memo.trim();

  return {
    title,
    todos,
    progress,
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
  const [todos, setTodos] = useState<Todo[]>(data.todos);
  const [deadline, setDeadline] = useState<string | undefined>(data.deadline);
  const [memo, setMemo] = useState(data.memo ?? '');
  const [newTodoText, setNewTodoText] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastPushedKeyRef = useRef<string>('');
  const stateRef = useRef({ title, todos, deadline, memo });

  stateRef.current = { title, todos, deadline, memo };

  const pushUpdate = useCallback(
    (next: { title: string; todos: Todo[]; deadline: string | undefined; memo: string }) => {
      const payload = buildPayload(next.title, next.todos, next.deadline, next.memo);
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
    const initial = {
      title: data.title,
      todos: data.todos,
      deadline: data.deadline,
      memo: data.memo ?? '',
    };
    setTitle(initial.title);
    setTodos(initial.todos);
    setDeadline(initial.deadline);
    setMemo(initial.memo);
    setNewTodoText('');
    lastPushedKeyRef.current = snapshotKey(
      buildPayload(initial.title, initial.todos, initial.deadline, initial.memo)
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
      pushUpdate({ title, todos, deadline, memo });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [title, todos, deadline, memo, isOpen, pushUpdate]);

  const handleClose = () => {
    // 閉じる前に未反映分を即座に保存
    pushUpdate(stateRef.current);
    onClose();
  };

  if (!isOpen) return null;

  const handleAddTodo = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!newTodoText.trim()) return;
    const newTodo: Todo = {
      id: crypto.randomUUID(),
      text: newTodoText,
      completed: false,
    };
    setTodos([...todos, newTodo]);
    setNewTodoText('');
  };

  const toggleTodo = (id: string) => {
    setTodos(todos.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t)));
  };

  const deleteTodo = (id: string) => {
    setTodos(todos.filter((t) => t.id !== id));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={handleClose}
      role="presentation"
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh] h-[min(720px,90vh)] animate-in fade-in zoom-in duration-200"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-gray-50 shrink-0">
          <input
            ref={titleInputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="text-2xl font-bold bg-transparent border-none outline-none w-full mr-4 placeholder-gray-400"
            placeholder="タイトルを入力..."
          />
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-200 rounded-full transition-colors shrink-0"
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

        {/* Tasks + Memo */}
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-0 md:gap-0 border-t border-gray-100 mt-4">
          {/* Tasks column */}
          <div className="flex flex-col min-h-0 border-b md:border-b-0 md:border-r border-gray-100">
            <div className="px-5 py-3 shrink-0">
              <h3 className="text-sm font-semibold text-gray-700">タスク</h3>
            </div>
            <div className="px-5 pb-3 overflow-y-auto flex-1 min-h-0">
              <div className="space-y-2">
                {todos.map((todo) => (
                  <div
                    key={todo.id}
                    className="group flex items-center gap-3 bg-white p-2 rounded-lg hover:bg-gray-50 border border-transparent hover:border-gray-100 transition-all"
                  >
                    <button
                      onClick={() => toggleTodo(todo.id)}
                      className={clsx(
                        'flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors',
                        todo.completed
                          ? 'bg-green-500 border-green-500'
                          : 'border-gray-300 hover:border-blue-400'
                      )}
                    >
                      {todo.completed && <Check size={14} className="text-white" />}
                    </button>
                    <span
                      className={clsx(
                        'flex-1 text-gray-700 transition-opacity',
                        todo.completed && 'line-through opacity-50'
                      )}
                    >
                      {todo.text}
                    </span>
                    <button
                      onClick={() => deleteTodo(todo.id)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-all"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>

              {todos.length === 0 && (
                <div className="text-center text-gray-400 py-10 text-sm">タスクがありません</div>
              )}
            </div>
            <div className="p-4 border-t border-gray-100 bg-gray-50 shrink-0">
              <form onSubmit={handleAddTodo} className="flex gap-2">
                <input
                  ref={inputRef}
                  value={newTodoText}
                  onChange={(e) => setNewTodoText(e.target.value)}
                  placeholder="新しいタスクを追加..."
                  className="flex-1 px-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                />
                <button
                  type="submit"
                  disabled={!newTodoText.trim()}
                  className="bg-blue-600 text-white p-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Plus size={22} />
                </button>
              </form>
            </div>
          </div>

          {/* Memo column */}
          <div className="flex flex-col min-h-0">
            <div className="px-5 py-3 shrink-0 flex items-center gap-2">
              <StickyNote size={16} className="text-amber-500" />
              <h3 className="text-sm font-semibold text-gray-700">メモ</h3>
            </div>
            <div className="px-5 pb-5 flex-1 min-h-0 flex flex-col">
              <textarea
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="このノードについてのメモを残せます..."
                className="flex-1 min-h-[180px] w-full resize-none px-4 py-3 rounded-xl border border-gray-200 bg-amber-50/40 focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400 transition-all text-sm text-gray-700 leading-relaxed"
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
