import { useState, useEffect } from 'react';
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
  const [assignedRoadmapId, setAssignedRoadmapId] = useState<string | null>(() =>
    loadAssignedRoadmapId()
  );
  const [roadmapDrawerOpen, setRoadmapDrawerOpen] = useState(false);

  useEffect(() => {
    const loaded = loadRoadmaps();
    setRoadmaps(loaded);
    if (loaded.length > 0) {
      setActiveRoadmapId(loaded[0].id);
    } else {
      const initial = createInitialRoadmap();
      setRoadmaps([initial]);
      setActiveRoadmapId(initial.id);
      saveRoadmaps([initial]);
    }
  }, []);

  useEffect(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const nodesWithDeadlines: UpcomingDeadlineNode[] = [];

    // アサインされたロードマップのノードだけを対象にする
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

        // 期限切れは除外。残り60日以内のみ
        if (remainingDays < 0 || remainingDays > 60) return;

        nodesWithDeadlines.push({
          title: node.data.title || '無題のノード',
          status: remainingDays <= 30 ? 'red' : 'yellow',
          remainingDays,
          deadline: node.data.deadline,
        });
      });
    }

    // 期限が短い順
    nodesWithDeadlines.sort((a, b) => a.remainingDays - b.remainingDays);

    setUpcomingDeadlineNodes(nodesWithDeadlines);
  }, [roadmaps, assignedRoadmapId]);

  const handleCreateRoadmap = () => {
    const newRoadmap = createInitialRoadmap();
    const updatedList = [newRoadmap, ...roadmaps];
    setRoadmaps(updatedList);
    setActiveRoadmapId(newRoadmap.id);
    saveRoadmaps(updatedList);
  };

  const handleSaveRoadmap = (updatedRoadmap: Roadmap) => {
    const updatedList = roadmaps.map((r) =>
      r.id === updatedRoadmap.id ? updatedRoadmap : r
    );
    setRoadmaps(updatedList);
    saveRoadmaps(updatedList);
  };

  const handleDeleteRoadmap = (id: string) => {
    const updatedList = roadmaps.filter((r) => r.id !== id);

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
      saveAssignedRoadmapId(null);
      setAssignedRoadmapId(null);
    }

    setRoadmaps(finalRoadmaps);
    setActiveRoadmapId(nextActiveId);
    saveRoadmaps(finalRoadmaps);
  };

  const handleExportRoadmaps = () => {
    downloadRoadmapExport(roadmaps);
  };

  const handleImportRoadmaps = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const imported = parseRoadmapImport(text);

      if (!imported || imported.length === 0) {
        alert('有効なロードマップデータが見つかりませんでした。');
        return;
      }

      if (
        !confirm(
          `現在のロードマップ（${roadmaps.length}件）を、インポートした ${imported.length} 件で置き換えますか？`
        )
      ) {
        return;
      }

      setRoadmaps(imported);
      setActiveRoadmapId(imported[0].id);
      saveRoadmaps(imported);

      const stillAssigned = imported.some((r) => r.id === assignedRoadmapId);
      if (!stillAssigned) {
        saveAssignedRoadmapId(null);
        setAssignedRoadmapId(null);
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
      handleCreateRoadmap();
      setRoadmapDrawerOpen(false);
    },
    onDelete: handleDeleteRoadmap,
    onExport: handleExportRoadmaps,
    onImport: handleImportRoadmaps,
  };

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

      {activeTab === 'daily' && (
        <DailyTodoApp
          upcomingDeadlineNodes={upcomingDeadlineNodes}
          roadmaps={roadmaps}
          assignedRoadmapId={assignedRoadmapId}
        />
      )}

      {activeTab === 'activity' && <ActivityHeatmap />}

      {activeTab === 'assign' && (
        <AssignRoadmapApp
          roadmaps={roadmaps}
          onAssignedChange={setAssignedRoadmapId}
        />
      )}
      </div>
    </div>
  );
}

export default App;
