import clsx from 'clsx';
import { Map, CalendarCheck, BarChart3, UserPlus, LogOut } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';

export type AppTab = 'roadmap' | 'daily' | 'activity' | 'assign';

interface SidebarProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
}

const NAV_ITEMS: {
  id: AppTab;
  label: string;
  shortLabel: string;
  icon: typeof Map;
}[] = [
  { id: 'roadmap', label: 'Roadmaps', shortLabel: 'マップ', icon: Map },
  { id: 'daily', label: "Today's ToDo", shortLabel: 'Todo', icon: CalendarCheck },
  { id: 'activity', label: 'Activity', shortLabel: '記録', icon: BarChart3 },
  { id: 'assign', label: 'ロードマップアサイン', shortLabel: 'アサイン', icon: UserPlus },
];

function NavButton({
  id,
  label,
  shortLabel,
  icon: Icon,
  activeTab,
  onTabChange,
  variant,
}: {
  id: AppTab;
  label: string;
  shortLabel: string;
  icon: typeof Map;
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  variant: 'desktop' | 'mobile';
}) {
  const isActive = activeTab === id;

  if (variant === 'mobile') {
    return (
      <button
        type="button"
        onClick={() => onTabChange(id)}
        className={clsx(
          'flex flex-col items-center justify-center gap-0.5 flex-1 min-w-0 py-1 transition-colors',
          isActive ? 'text-blue-500' : 'text-gray-400'
        )}
      >
        <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
        <span className="text-[10px] font-medium truncate max-w-full px-0.5">
          {shortLabel}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onTabChange(id)}
      className={clsx(
        'p-3 rounded-xl transition-all duration-200 group relative',
        isActive
          ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50'
          : 'text-gray-400 hover:bg-gray-800 hover:text-white'
      )}
    >
      <Icon size={24} />
      <span className="absolute left-14 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
        {label}
      </span>
    </button>
  );
}

export default function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const { signOut, configured } = useAuth();

  const handleSignOut = async () => {
    if (!confirm('ログアウトしますか？')) return;
    await signOut();
  };

  return (
    <>
      {/* Desktop: left sidebar */}
      <aside className="hidden md:flex w-16 flex-col items-center py-6 bg-gray-900 text-white border-r border-gray-800 z-20 flex-shrink-0">
        <div className="mb-8 font-bold text-xl bg-gradient-to-br from-blue-400 to-purple-500 bg-clip-text text-transparent">
          P
        </div>

        <div className="flex flex-col gap-4 w-full px-2 flex-1">
          {NAV_ITEMS.map((item) => (
            <NavButton
              key={item.id}
              {...item}
              activeTab={activeTab}
              onTabChange={onTabChange}
              variant="desktop"
            />
          ))}
        </div>

        {configured && (
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="p-3 rounded-xl text-gray-400 hover:bg-gray-800 hover:text-white transition-colors group relative"
            title="ログアウト"
          >
            <LogOut size={22} />
            <span className="absolute left-14 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
              ログアウト
            </span>
          </button>
        )}
      </aside>

      {/* Mobile: bottom navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-gray-900 border-t border-gray-800 safe-bottom">
        <div className="flex items-stretch h-16 px-1">
          {NAV_ITEMS.map((item) => (
            <NavButton
              key={item.id}
              {...item}
              activeTab={activeTab}
              onTabChange={onTabChange}
              variant="mobile"
            />
          ))}
          {configured && (
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="flex flex-col items-center justify-center gap-0.5 flex-1 min-w-0 py-1 text-gray-400"
            >
              <LogOut size={20} />
              <span className="text-[10px] font-medium">退出</span>
            </button>
          )}
        </div>
      </nav>
    </>
  );
}
