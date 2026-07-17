import { useState, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Calendar, Save, Edit3, Lock } from 'lucide-react';
import clsx from 'clsx';
import { loadDailyReports, saveDailyReports, getLocalDate } from '../store';
import type { DailyReport } from '../types';

export default function DailyReportApp() {
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(getLocalDate());
  const [content, setContent] = useState<string>('');
  const [isSaved, setIsSaved] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const today = getLocalDate();
  const isToday = selectedDate === today;

  // Load reports on mount
  useEffect(() => {
    const loaded = loadDailyReports();
    setReports(loaded);
  }, []);

  // Update content when date changes
  useEffect(() => {
    const report = reports.find(r => r.date === selectedDate);
    setContent(report ? report.content : '');
    setIsSaved(true);
    // Only allow editing if it's today
    setIsEditing(isToday); 
  }, [selectedDate, reports, isToday]);

  const handleSave = () => {
    const otherReports = reports.filter(r => r.date !== selectedDate);
    const newReports = [...otherReports, { date: selectedDate, content }];
    newReports.sort((a, b) => b.date.localeCompare(a.date));
    
    setReports(newReports);
    saveDailyReports(newReports);
    setIsSaved(true);
    
    setTimeout(() => setIsSaved(false), 2000);
  };

  const handleContentChange = (val: string) => {
    setContent(val);
    if (isSaved) setIsSaved(false);
  };

  // Sidebar List
  const sortedReports = [...reports].sort((a, b) => b.date.localeCompare(a.date));
  let displayReports = sortedReports;
  if (!displayReports.find(r => r.date === selectedDate)) {
      displayReports = [{ date: selectedDate, content: '' }, ...sortedReports];
      displayReports.sort((a, b) => b.date.localeCompare(a.date));
  }

  return (
    <div className="flex h-full w-full bg-white">
      {/* Sidebar (Dates) */}
      <div className="w-64 bg-gray-50 border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200 font-bold text-gray-700 flex items-center gap-2">
            <Calendar size={18} />
            Reports
        </div>
        <div className="flex-1 overflow-y-auto p-2">
            {displayReports.map((report) => (
                <button
                    key={report.date}
                    onClick={() => setSelectedDate(report.date)}
                    className={clsx(
                        "w-full text-left px-4 py-3 rounded-lg text-sm mb-1 transition-colors flex justify-between items-center",
                        selectedDate === report.date 
                            ? "bg-blue-50 text-blue-700 font-medium" 
                            : "text-gray-600 hover:bg-gray-100"
                    )}
                >
                    <span>{new Date(report.date).toLocaleDateString('ja-JP', { weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' })}</span>
                    {report.date === today && <span className="w-2 h-2 rounded-full bg-blue-500" title="Today"></span>}
                </button>
            ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="px-8 py-4 border-b border-gray-100 flex justify-between items-center bg-white">
            <div>
                <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-3">
                    {new Date(selectedDate).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}
                    {!isToday && <Lock size={16} className="text-gray-400" title="Read Only" />}
                </h1>
                <p className="text-sm text-gray-400">Daily Report</p>
            </div>
            
            {isToday ? (
                <button
                    onClick={handleSave}
                    className={clsx(
                        "flex items-center gap-2 px-6 py-2 rounded-lg font-bold transition-all shadow-sm",
                        isSaved 
                            ? "bg-green-100 text-green-700 border border-green-200"
                            : "bg-blue-600 text-white hover:bg-blue-700 border border-transparent shadow-blue-200"
                    )}
                >
                    <Save size={18} />
                    {isSaved ? 'Saved' : 'Save Report'}
                </button>
            ) : (
                <div className="text-sm text-gray-400 bg-gray-100 px-3 py-1 rounded-full flex items-center gap-1">
                    <Lock size={14} /> 閲覧モード
                </div>
            )}
        </div>

        {/* Editor & Preview */}
        <div className="flex-1 flex overflow-hidden">
            {/* Editor (Only visible if Today) */}
            {isToday && (
                <div className="flex-1 border-r border-gray-100 flex flex-col bg-gray-50/50">
                    <div className="p-2 bg-gray-100 text-xs font-bold text-gray-500 uppercase border-b border-gray-200 text-center tracking-wider">
                        Editor
                    </div>
                    <textarea
                        value={content}
                        onChange={(e) => handleContentChange(e.target.value)}
                        className="flex-1 p-8 resize-none outline-none text-gray-800 leading-relaxed font-mono text-base bg-transparent"
                        placeholder="# 今日の振り返り&#13;&#10;&#13;&#10;## できたこと&#13;&#10;- タスクA&#13;&#10;- タスクB&#13;&#10;&#13;&#10;## 課題&#13;&#10;1. 時間管理&#13;&#10;2. ..."
                    />
                </div>
            )}

            {/* Preview (Full width if not today, or split) */}
            <div className={clsx("flex flex-col bg-white", isToday ? "flex-1" : "w-full")}>
                {isToday && (
                    <div className="p-2 bg-gray-100 text-xs font-bold text-gray-500 uppercase border-b border-gray-200 text-center tracking-wider">
                        Preview
                    </div>
                )}
                <div className="flex-1 p-10 overflow-y-auto">
                    <article className="prose prose-slate prose-lg max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {content || (isToday ? '*プレビューが表示されます*' : '*日報はありません*')}
                        </ReactMarkdown>
                    </article>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
}