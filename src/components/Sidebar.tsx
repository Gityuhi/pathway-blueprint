import clsx from 'clsx';
import { Map, CalendarCheck, BookOpen, BarChart3, UserPlus } from 'lucide-react';

export type AppTab = 'roadmap' | 'daily' | 'report' | 'activity' | 'assign';

interface SidebarProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
}

const NAV_ITEMS: { id: AppTab; label: string; icon: typeof Map }[] = [
  { id: 'roadmap', label: 'Roadmaps', icon: Map },
  { id: 'daily', label: "Today's ToDo", icon: CalendarCheck },
  { id: 'report', label: 'Daily Report', icon: BookOpen },
  { id: 'activity', label: 'Activity', icon: BarChart3 },
  { id: 'assign', label: 'ロードマップアサイン', icon: UserPlus },
];

export default function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  return (
    <div className="w-16 flex flex-col items-center py-6 bg-gray-900 text-white border-r border-gray-800 z-20">
      <div className="mb-8 font-bold text-xl bg-gradient-to-br from-blue-400 to-purple-500 bg-clip-text text-transparent">
        P
      </div>

      <div className="flex flex-col gap-4 w-full px-2">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className={clsx(
              'p-3 rounded-xl transition-all duration-200 group relative',
              activeTab === id
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50'
                : 'text-gray-400 hover:bg-gray-800 hover:text-white'
            )}
          >
            <Icon size={24} />
            <span className="absolute left-14 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
              {label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
