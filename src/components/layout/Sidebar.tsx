import React, { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, PenLine, ListTodo, Calendar,
  FileText, BookOpen, Settings, Sun, Moon, Sunset,
} from 'lucide-react';
import { type Theme, loadAndApplyTheme, saveTheme } from '../../lib/theme';

const NAV_GROUPS = [
  {
    items: [
      { to: '/', icon: <LayoutDashboard size={18} />, label: 'ホーム', end: true },
      { to: '/memo', icon: <PenLine size={18} />, label: '今日のメモ' },
      { to: '/tasks', icon: <ListTodo size={18} />, label: 'タスク' },
      { to: '/calendar', icon: <Calendar size={18} />, label: '週スケジュール' },
    ],
  },
  {
    label: 'レポート',
    items: [
      { to: '/reports/daily', icon: <FileText size={18} />, label: '日報' },
      { to: '/reports/weekly', icon: <BookOpen size={18} />, label: '週報' },
    ],
  },
  {
    items: [
      { to: '/settings', icon: <Settings size={18} />, label: '設定' },
    ],
  },
];

const THEMES: { value: Theme; icon: React.ReactNode; label: string }[] = [
  { value: 'light', icon: <Sun size={13} />, label: 'ライト' },
  { value: 'dark',  icon: <Moon size={13} />, label: 'ダーク' },
  { value: 'sepia', icon: <Sunset size={13} />, label: 'セピア' },
];

export function Sidebar() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    loadAndApplyTheme().then(setTheme).catch(console.warn);
  }, []);

  const handleTheme = async (t: Theme) => {
    setTheme(t);
    await saveTheme(t);
  };

  return (
    <aside className="w-56 bg-sebastian-navy text-sebastian-ivory h-screen flex flex-col shadow-lg flex-shrink-0">
      {/* ロゴ */}
      <div className="p-5 flex items-center gap-3 border-b border-sebastian-dark">
        <div className="w-7 h-7 rounded-full bg-sebastian-ivory text-sebastian-navy flex items-center justify-center font-serif font-bold italic text-sm flex-shrink-0">
          S
        </div>
        <h1 className="text-lg font-serif tracking-wide">Sebastian</h1>
      </div>

      {/* ナビゲーション */}
      <nav className="flex-1 py-4 px-2 space-y-4 overflow-y-auto">
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi}>
            {group.label && (
              <p className="text-xs text-sebastian-ivory/30 font-medium uppercase tracking-wider px-3 mb-1">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map(link => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={'end' in link ? link.end : false}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                      isActive
                        ? 'bg-sebastian-dark text-white font-medium'
                        : 'text-sebastian-ivory/70 hover:bg-white/5 hover:text-sebastian-ivory'
                    }`
                  }
                >
                  <span className="flex-shrink-0">{link.icon}</span>
                  <span>{link.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* テーマ切り替え */}
      <div className="px-3 pb-3 border-t border-sebastian-dark pt-3">
        <div className="flex gap-1">
          {THEMES.map(t => (
            <button
              key={t.value}
              onClick={() => handleTheme(t.value)}
              title={t.label}
              className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs transition-colors ${
                theme === t.value
                  ? 'bg-white/15 text-sebastian-ivory'
                  : 'text-sebastian-ivory/40 hover:text-sebastian-ivory/70 hover:bg-white/5'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="px-3 pb-3 text-xs text-sebastian-ivory/30 text-center">
        AI Work Supporter v0.1.0
      </div>
    </aside>
  );
}
