import { memo, useState } from 'react';
import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';
import { MessageSquareText, Minus, Plus } from 'lucide-react';
import type { NodeData } from '../types';
import clsx from 'clsx';

const MEMO_PREVIEW_MAX = 200;

/** 期限日を0日として、今日からの残り日数を返す（過ぎていれば負数） */
function getRemainingDays(deadline: string): number {
  const [year, month, day] = deadline.split('-').map(Number);
  const deadlineDate = new Date(year, month - 1, day);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round(
    (deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
}

function truncateMemo(memo: string): string {
  const normalized = memo.trim();
  if (normalized.length <= MEMO_PREVIEW_MAX) return normalized;
  return `${normalized.slice(0, MEMO_PREVIEW_MAX)}…`;
}

const CustomNode = ({ id, data, selected }: NodeProps<NodeData>) => {
  const remainingDays = data.deadline ? getRemainingDays(data.deadline) : null;
  const hasMemo = Boolean(data.memo?.trim());
  const [showMemoTip, setShowMemoTip] = useState(false);

  let deadlineClass = '';
  let daysClass = 'text-gray-600';
  if (remainingDays !== null) {
    if (remainingDays <= 30) {
      deadlineClass = 'bg-red-100 border-red-400';
      daysClass = 'text-red-600';
    } else if (remainingDays <= 60) {
      deadlineClass = 'bg-yellow-100 border-yellow-400';
      daysClass = 'text-yellow-700';
    }
  }

  return (
    <div
      className={clsx(
        'relative px-4 py-3 shadow-lg rounded-xl w-[280px] max-w-[280px] box-border',
        'transition-colors duration-200 border overflow-visible',
        deadlineClass || 'bg-white border-gray-100',
        selected
          ? deadlineClass
            ? 'ring-2 ring-blue-200'
            : 'border-blue-500 ring-2 ring-blue-200'
          : ''
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-gray-400 !w-3 !h-3 !-ml-1.5"
      />

      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-1.5 min-w-0 flex-1">
            {hasMemo && (
              <div
                className="relative flex-shrink-0 mt-1 nodrag nopan"
                onMouseEnter={() => setShowMemoTip(true)}
                onMouseLeave={() => setShowMemoTip(false)}
              >
                <span
                  className="inline-flex items-center justify-center text-amber-500"
                  aria-label="メモあり"
                >
                  <MessageSquareText size={16} strokeWidth={2.25} />
                </span>
                {showMemoTip && data.memo && (
                  <div
                    role="tooltip"
                    className={clsx(
                      'pointer-events-none absolute left-1/2 bottom-full z-50 mb-2 -translate-x-1/2',
                      'w-56 max-h-40 overflow-y-auto rounded-lg border border-amber-200 bg-white px-3 py-2',
                      'text-left text-xs leading-relaxed text-gray-700 shadow-lg whitespace-pre-wrap break-words'
                    )}
                  >
                    {truncateMemo(data.memo)}
                    <span
                      className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-amber-200"
                      aria-hidden
                    />
                  </div>
                )}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div
                className="font-bold text-gray-800 text-base leading-snug break-words line-clamp-2"
                title={data.title || '無題のノード'}
              >
                {data.title || '無題のノード'}
              </div>
              {data.deadline && (
                <div className="mt-0.5 text-[11px] text-gray-400 tabular-nums">
                  期限 {data.deadline.replace(/-/g, '/')}
                </div>
              )}
            </div>
          </div>
          {remainingDays !== null && (
            <div
              className={clsx(
                'flex-shrink-0 min-w-[2rem] px-1.5 py-0.5 text-center',
                'text-lg font-bold tabular-nums leading-tight',
                'border border-red-500 rounded',
                daysClass
              )}
              title={`残り${remainingDays}日`}
            >
              {remainingDays}
            </div>
          )}
        </div>

        <div className="w-full">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Progress</span>
            <span>{Math.round(data.progress || 0)}%</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
            <div
              className={clsx(
                'h-full rounded-full transition-all duration-500 ease-out',
                data.progress === 100 ? 'bg-green-500' : 'bg-blue-500'
              )}
              style={{ width: `${data.progress || 0}%` }}
            />
          </div>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!bg-gray-400 !w-3 !h-3 !-mr-1.5"
      />

      {data.hasChildren && (
        <button
          type="button"
          title={data.collapsed ? '子ノードを表示' : '子ノードを隠す'}
          onClick={(e) => {
            e.stopPropagation();
            data.onToggleCollapse?.(id);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          className={clsx(
            'absolute -right-3 top-1/2 -translate-y-1/2 z-10',
            'flex items-center justify-center gap-0.5 min-w-[22px] h-[22px] px-1',
            'rounded-full border border-gray-300 bg-white text-gray-600',
            'shadow-sm hover:bg-gray-50 hover:border-blue-400 hover:text-blue-600',
            'transition-colors nodrag nopan'
          )}
        >
          {data.collapsed ? (
            <>
              <Plus size={12} strokeWidth={2.5} />
              {(data.childCount ?? 0) > 0 && (
                <span className="text-[10px] font-semibold leading-none">
                  {data.childCount}
                </span>
              )}
            </>
          ) : (
            <Minus size={12} strokeWidth={2.5} />
          )}
        </button>
      )}
    </div>
  );
};

export default memo(CustomNode);
