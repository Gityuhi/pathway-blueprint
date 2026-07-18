import { useEffect, useState } from 'react';
import { UserPlus, Save, Check } from 'lucide-react';
import clsx from 'clsx';
import { loadAssignedRoadmapId, saveAssignedRoadmapId, type Roadmap } from '../store';

interface AssignRoadmapAppProps {
  roadmaps: Roadmap[];
  onAssignedChange?: (roadmapId: string | null) => void;
}

export default function AssignRoadmapApp({
  roadmaps,
  onAssignedChange,
}: AssignRoadmapAppProps) {
  const [roadmapId, setRoadmapId] = useState<string>('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const id = await loadAssignedRoadmapId();
      if (!cancelled) setRoadmapId(id || '');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (roadmapId && !roadmaps.find((r) => r.id === roadmapId)) {
      setRoadmapId('');
    }
  }, [roadmaps, roadmapId]);

  const handleSave = async () => {
    const next = roadmapId || null;
    await saveAssignedRoadmapId(next);
    onAssignedChange?.(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex-1 h-full overflow-y-auto bg-gray-50 min-h-0">
      <div className="max-w-xl mx-auto p-4 md:p-10">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 rounded-xl bg-blue-100 text-blue-600">
            <UserPlus size={22} />
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800">ロードマップアサイン</h1>
        </div>
        <p className="text-sm md:text-base text-gray-500 mb-6 md:mb-8 md:ml-[52px]">
          Today&apos;s ToDo で使うロードマップを1つ選びます。選んだロードマップのノードを、その日の目標タブとして追加できます。
        </p>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-6">
          <div>
            <label htmlFor="assign-roadmap" className="block text-sm font-medium text-gray-700 mb-2">
              ロードマップ
            </label>
            <select
              id="assign-roadmap"
              value={roadmapId}
              onChange={(e) => setRoadmapId(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            >
              <option value="">未アサイン</option>
              {roadmaps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title || '無題のロードマップ'}
                </option>
              ))}
            </select>
            {roadmaps.length === 0 && (
              <p className="mt-2 text-sm text-amber-600">
                ロードマップがまだありません。先に Roadmaps から作成してください。
              </p>
            )}
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="button"
              onClick={() => void handleSave()}
              className={clsx(
                'flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-colors',
                saved
                  ? 'bg-green-600 text-white'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              )}
            >
              {saved ? <Check size={18} /> : <Save size={18} />}
              {saved ? '保存しました' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
