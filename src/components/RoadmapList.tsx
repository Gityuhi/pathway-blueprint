import { useRef } from 'react';
import { Plus, LayoutGrid, Clock, Trash2, Download, Upload } from 'lucide-react';
import type { Roadmap } from '../store';
import clsx from 'clsx';

interface RoadmapListProps {
  roadmaps: Roadmap[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  className?: string;
}

export default function RoadmapList({
  roadmaps,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  onExport,
  onImport,
  className,
}: RoadmapListProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImport(file);
    }
    e.target.value = '';
  };

  return (
    <div
      className={clsx(
        'w-64 bg-gray-50 border-r border-gray-200 flex flex-col h-full',
        className
      )}
    >
      <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-white">
        <h2 className="font-bold text-gray-800 flex items-center gap-2">
            <LayoutGrid size={18} className="text-gray-500" />
            ライブラリ
        </h2>
        <div className="flex items-center gap-0.5">
          <button
            onClick={onExport}
            className="p-1.5 hover:bg-gray-100 rounded-md text-gray-500 hover:text-blue-600 transition-colors"
            title="エクスポート"
          >
            <Download size={18} />
          </button>
          <button
            onClick={handleImportClick}
            className="p-1.5 hover:bg-gray-100 rounded-md text-gray-500 hover:text-blue-600 transition-colors"
            title="インポート"
          >
            <Upload size={18} />
          </button>
          <button
            onClick={onCreate}
            className="p-1.5 hover:bg-gray-100 rounded-md text-blue-600 transition-colors"
            title="新規作成"
          >
            <Plus size={20} />
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {roadmaps.length === 0 && (
            <div className="text-center text-xs text-gray-400 mt-10 px-4">
                ロードマップがありません。<br/>右上の「＋」ボタンから作成してください。
            </div>
        )}

        {roadmaps.map(roadmap => (
            <div
                key={roadmap.id}
                className={clsx(
                    "w-full text-left p-3 rounded-lg transition-all duration-200 border group relative cursor-pointer flex items-center justify-between",
                    activeId === roadmap.id 
                        ? "bg-white border-blue-200 shadow-sm ring-1 ring-blue-100" 
                        : "bg-transparent border-transparent hover:bg-gray-100"
                )}
                onClick={() => onSelect(roadmap.id)}
            >
                <div className="flex-1 min-w-0 pr-2">
                    <div className="font-medium text-sm truncate text-gray-800 mb-1">
                        {roadmap.title || '無題のロードマップ'}
                    </div>
                    <div className="text-[10px] text-gray-400 flex items-center gap-1">
                        <Clock size={10} />
                        {new Date(roadmap.updatedAt).toLocaleDateString()} {new Date(roadmap.updatedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </div>
                </div>
                
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (confirm('本当に削除しますか？')) {
                            onDelete(roadmap.id);
                        }
                    }}
                    className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 md:opacity-0 md:group-hover:opacity-100 transition-all flex-shrink-0"
                    title="削除"
                >
                    <Trash2 size={16} />
                </button>
            </div>
        ))}
      </div>
    </div>
  );
}
