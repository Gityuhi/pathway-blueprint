import { useState, useEffect, useRef, useCallback } from 'react';
import clsx from 'clsx';
import Sidebar from './components/Sidebar';
import type { AppTab } from './components/Sidebar';
import RoadmapList from './components/RoadmapList';
import RoadmapEditor from './components/RoadmapEditor';
import DailyTodoApp from './components/DailyTodoApp';
import ActivityHeatmap from './components/ActivityHeatmap';
import AssignRoadmapApp from './components/AssignRoadmapApp';
import MobileDrawer from './components/MobileDrawer';
import MobileMenuButton from './components/MobileMenuButton';
import {
  loadRoadmaps,
  saveRoadmaps,
  deleteRoadmap,
  replaceAllRoadmaps,
  createInitialRoadmap,
  loadAssignedRoadmapId,
  saveAssignedRoadmapId,
  downloadRoadmapExport,
  parseRoadmapImport,
} from './store';
import type { Roadmap } from './store';

interface UpcomingDeadlineNode {
  title: string;
  status: 'yellow' | 'red';
  /** 残り日数（短いほど先に表示） */
  remainingDays: number;
  deadline: string;
}

function App() {
  const [roadmaps, setRoadmaps] = useState<Roadmap[]>([]);
  const [activeRoadmapId, setActiveRoadmapId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>('daily');
  const [upcomingDeadlineNodes, setUpcomingDeadlineNodes] = useState<UpcomingDeadlineNode[]>([]);
  const [assignedRoadmapId, setAssignedRoadmapId] = useState<string | null>(null);
  const [roadmapDrawerOpen, setRoadmapDrawerOpen] = useState(false);
  const [booting, setBooting] = useState(true);

  const roadmapsRef = useRef<Roadmap[]>([]);
  const saveChainRef = useRef(Promise.resolve());

  const setRoadmapsBoth = useCallback((next: Roadmap[]) => {
    roadmapsRef.current = next;
    setRoadmaps(next);
  }, []);

  /** 常に最新の roadmapsRef を直列で upsert（古いリクエストが新しい内容を上書きしない） */
  const persistRoadmaps = useCallback(() => {
    saveChainRef.current = saveChainRef.current
      .catch(() => undefined)
      .then(() => saveRoadmaps(roadmapsRef.current));
    return saveChainRef.current;
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [loaded, assigned] = await Promise.all([
          loadRoadmaps(),
          loadAssignedRoadmapId(),
        ]);
        if (cancelled) return;

        setAssignedRoadmapId(assigned);

        if (loaded.length > 0) {
          setRoadmapsBoth(loaded);
          setActiveRoadmapId(loaded[0].id);
        } else {
          // 空のときクラウドへ保存しない（誤って空読みした場合の全消しを防ぐ）
          const initial = createInitialRoadmap();
          setRoadmapsBoth([initial]);
          setActiveRoadmapId(initial.id);
        }
      } catch (e) {
        console.error('Failed to boot app data', e);
        alert('データの読み込みに失敗しました。再読み込みしてください。');
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setRoadmapsBoth]);

  useEffect(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const nodesWithDeadlines: UpcomingDeadlineNode[] = [];

    const assignedRoadmap = assignedRoadmapId
      ? roadmaps.find((r) => r.id === assignedRoadmapId)
      : null;

    if (assignedRoadmap) {
      assignedRoadmap.nodes.forEach((node) => {
        if (!node.data.deadline) return;

        const [y, m, d] = node.data.deadline.split('-').map(Number);
        const deadlineDate = new Date(y, m - 1, d);
        const remainingDays = Math.round(
          (deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (remainingDays < 0 || remainingDays > 60) return;

        nodesWithDeadlines.push({
          title: node.data.title || '無題のノード',
          status: remainingDays <= 30 ? 'red' : 'yellow',
          remainingDays,
          deadline: node.data.deadline,
        });
      });
    }

    nodesWithDeadlines.sort((a, b) => a.remainingDays - b.remainingDays);
    setUpcomingDeadlineNodes(nodesWithDeadlines);
  }, [roadmaps, assignedRoadmapId]);

  const handleCreateRoadmap = async () => {
    const newRoadmap = createInitialRoadmap();
    const updatedList = [newRoadmap, ...roadmapsRef.current];
    setRoadmapsBoth(updatedList);
    setActiveRoadmapId(newRoadmap.id);
    try {
      await persistRoadmaps();
    } catch (e) {
      console.error(e);
      alert('ロードマップの保存に失敗しました。');
    }
  };

  const handleSaveRoadmap = (updatedRoadmap: Roadmap) => {
    const updatedList = roadmapsRef.current.map((r) =>
      r.id === updatedRoadmap.id ? updatedRoadmap : r
    );
    setRoadmapsBoth(updatedList);
    void persistRoadmaps().catch((e) => {
      console.error(e);
    });
  };

  const handleDeleteRoadmap = async (id: string) => {
    const updatedList = roadmapsRef.current.filter((r) => r.id !== id);

    let nextActiveId = activeRoadmapId;
    let finalRoadmaps = updatedList;

    if (activeRoadmapId === id) {
      if (updatedList.length > 0) {
        nextActiveId = updatedList[0].id;
      } else {
        const newRoadmap = createInitialRoadmap();
        finalRoadmaps = [newRoadmap];
        nextActiveId = newRoadmap.id;
      }
    }

    if (assignedRoadmapId === id) {
      await saveAssignedRoadmapId(null);
      setAssignedRoadmapId(null);
    }

    setRoadmapsBoth(finalRoadmaps);
    setActiveRoadmapId(nextActiveId);

    try {
      // 明示削除してから残りを upsert（saveRoadmaps は DELETE しない）
      await deleteRoadmap(id);
      await persistRoadmaps();
    } catch (e) {
      console.error(e);
      alert('ロードマップの削除に失敗しました。');
    }
  };

  const handleExportRoadmaps = () => {
    downloadRoadmapExport(roadmapsRef.current);
  };

  const handleImportRoadmaps = (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const imported = parseRoadmapImport(text);

      if (!imported || imported.length === 0) {
        alert('有効なロードマップデータが見つかりませんでした。');
        return;
      }

      if (
        !confirm(
          `現在のロードマップ（${roadmapsRef.current.length}件）を、インポートした ${imported.length} 件で置き換えますか？`
        )
      ) {
        return;
      }

      try {
        setRoadmapsBoth(imported);
        setActiveRoadmapId(imported[0].id);
        await replaceAllRoadmaps(imported);

        const stillAssigned = imported.some((r) => r.id === assignedRoadmapId);
        if (!stillAssigned) {
          await saveAssignedRoadmapId(null);
          setAssignedRoadmapId(null);
        }
      } catch (e) {
        console.error(e);
        alert('インポートの保存に失敗しました。');
      }
    };
    reader.onerror = () => {
      alert('ファイルの読み込みに失敗しました。');
    };
    reader.readAsText(file);
  };

  const activeRoadmap = roadmaps.find((r) => r.id === activeRoadmapId);

  const roadmapListProps = {
    roadmaps,
    activeId: activeRoadmapId,
    onSelect: (id: string) => {
      setActiveRoadmapId(id);
      setRoadmapDrawerOpen(false);
    },
    onCreate: () => {
      void handleCreateRoadmap();
      setRoadmapDrawerOpen(false);
    },
    onDelete: (id: string) => {
      void handleDeleteRoadmap(id);
    },
    onExport: handleExportRoadmaps,
    onImport: handleImportRoadmaps,
  };

  if (booting) {
    return (
      <div className="flex w-screen h-[100dvh] items-center justify-center bg-gray-50 text-gray-500">
        読み込み中…
      </div>
    );
  }

  return (
    <div className="flex w-screen h-[100dvh] overflow-hidden bg-gray-50 text-gray-800 font-sans">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="flex-1 flex flex-col min-w-0 min-h-0 pb-bottom-nav md:pb-0">
      {activeTab === 'roadmap' && (
        <div className="flex flex-1 min-h-0 flex-col md:flex-row">
          <div className="md:hidden flex items-center gap-2 px-3 py-2.5 border-b border-gray-200 bg-white flex-shrink-0 safe-top">
            <MobileMenuButton
              onClick={() => setRoadmapDrawerOpen(true)}
              label="ロードマップ一覧を開く"
            />
            <span className="font-semibold text-gray-800 truncate flex-1 min-w-0">
              {activeRoadmap?.title || 'ロードマップ'}
            </span>
          </div>

          <MobileDrawer open={roadmapDrawerOpen} onClose={() => setRoadmapDrawerOpen(false)}>
            <RoadmapList
              {...roadmapListProps}
              className="w-full h-full border-r-0"
            />
          </MobileDrawer>

          <RoadmapList
            {...roadmapListProps}
            className="hidden md:flex"
          />

          <div className="flex-1 relative min-h-0">
            {activeRoadmap ? (
              <RoadmapEditor
                key={activeRoadmap.id}
                roadmap={activeRoadmap}
                onSave={handleSaveRoadmap}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400">
                ロードマップを選択してください
              </div>
            )}
          </div>
        </div>
      )}

      {/* タブ切替でアンマウントしない（再取得・タブ消失を防ぐ） */}
      <div
        className={clsx(
          'flex-1 min-h-0 min-w-0',
          activeTab === 'daily' ? 'flex' : 'hidden'
        )}
      >
        <DailyTodoApp
          upcomingDeadlineNodes={upcomingDeadlineNodes}
          roadmaps={roadmaps}
          assignedRoadmapId={assignedRoadmapId}
        />
      </div>

      <div
        className={clsx(
          'flex-1 min-h-0 min-w-0',
          activeTab === 'activity' ? 'flex' : 'hidden'
        )}
      >
        <ActivityHeatmap />
      </div>

      <div
        className={clsx(
          'flex-1 min-h-0 min-w-0',
          activeTab === 'assign' ? 'flex' : 'hidden'
        )}
      >
        <AssignRoadmapApp
          roadmaps={roadmaps}
          onAssignedChange={setAssignedRoadmapId}
        />
      </div>
      </div>
    </div>
  );
}

export default App;
