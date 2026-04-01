import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, addDays } from 'date-fns';
import { Bell, X, ArrowRight } from 'lucide-react';
import { selectDb } from '../lib/db';
import { setSetting, SETTING_KEYS } from '../lib/settings';
import { PRIORITY_COLOR, PRIORITY_LABEL } from '../lib/constants';

interface TaskBrief {
  id: number;
  title: string;
  priority: string;
  due_date: string | null;
  status: string;
}

interface Props {
  onDismiss: () => void;
}


export function MorningBriefingModal({ onDismiss }: Props) {
  const [todayTasks, setTodayTasks] = useState<TaskBrief[]>([]);
  const [soonTasks, setSoonTasks] = useState<TaskBrief[]>([]);
  const [highTasks, setHighTasks] = useState<TaskBrief[]>([]);

  const today = format(new Date(), 'yyyy-MM-dd');
  const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');
  const in3days = format(addDays(new Date(), 3), 'yyyy-MM-dd');

  useEffect(() => {
    async function load() {
      const [todayResult, soonResult, highResult] = await Promise.all([
        selectDb<TaskBrief>(
          "SELECT id, title, priority, due_date, status FROM tasks WHERE due_date = ? AND status != 'done' ORDER BY priority DESC",
          [today]
        ),
        selectDb<TaskBrief>(
          "SELECT id, title, priority, due_date, status FROM tasks WHERE due_date >= ? AND due_date <= ? AND status != 'done' ORDER BY due_date ASC, priority DESC LIMIT 5",
          [tomorrow, in3days]
        ),
        selectDb<TaskBrief>(
          "SELECT id, title, priority, due_date, status FROM tasks WHERE priority = 'high' AND status != 'done' ORDER BY due_date ASC NULLS LAST LIMIT 5"
        ),
      ]);
      setTodayTasks(todayResult);
      setSoonTasks(soonResult);
      // 高優先度タスクのうち今日期日のものは todayTasks に含まれるので除外
      setHighTasks(highResult.filter(t => t.due_date !== today));
    }
    load().catch(console.error);
  }, [today, tomorrow, in3days]);

  const handleDismiss = async () => {
    await setSetting(SETTING_KEYS.LAST_BRIEFING_DATE, today);
    onDismiss();
  };

  const hasTasks = todayTasks.length > 0 || soonTasks.length > 0 || highTasks.length > 0;

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="relative rounded-2xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col" style={{ backgroundColor: '#faf7f0', border: '1px solid #d5c9a8' }}>
        {/* Corner ornaments */}
        <span className="absolute top-2.5 left-2.5 w-4 h-4 border-t border-l border-sebastian-gold/30 pointer-events-none rounded-tl-sm" />
        <span className="absolute top-2.5 right-2.5 w-4 h-4 border-t border-r border-sebastian-gold/30 pointer-events-none rounded-tr-sm" />
        <span className="absolute bottom-2.5 left-2.5 w-4 h-4 border-b border-l border-sebastian-gold/30 pointer-events-none rounded-bl-sm" />
        <span className="absolute bottom-2.5 right-2.5 w-4 h-4 border-b border-r border-sebastian-gold/30 pointer-events-none rounded-br-sm" />

        {/* ヘッダー */}
        <div className="p-6 border-b border-sebastian-border/50 flex items-start justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(201,164,86,0.1)', border: '1px solid rgba(201,164,86,0.3)' }}>
              <Bell size={18} style={{ color: '#c9a456' }} />
            </div>
            <div>
              <h2 className="font-serif text-sebastian-navy text-lg">おはようございます</h2>
              <p className="text-xs text-sebastian-lightgray mt-0.5 font-serif">本日の状況をお知らせします</p>
            </div>
          </div>
          <button onClick={handleDismiss} className="text-sebastian-lightgray/50 hover:text-sebastian-lightgray transition-colors mt-0.5">
            <X size={18} />
          </button>
        </div>

        {/* コンテンツ */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {!hasTasks && (
            <p className="text-sm text-sebastian-lightgray text-center py-6 font-serif">
              本日期日・優先度の高いタスクはありません。<br />
              <span className="text-xs italic">良い1日を。</span>
            </p>
          )}

          {todayTasks.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-xs font-serif text-sebastian-gray shrink-0">今日が期日</h3>
                <span className="text-sebastian-gold/40 text-[9px] shrink-0">◆</span>
                <div className="flex-1 h-px bg-sebastian-gold/15" />
              </div>
              <ul className="space-y-2">
                {todayTasks.map(t => (
                  <li key={t.id} className="flex items-center gap-2 text-sm text-sebastian-text font-serif">
                    <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${PRIORITY_COLOR[t.priority]}`}>
                      {PRIORITY_LABEL[t.priority] || '—'}
                    </span>
                    <span className="flex-1 min-w-0 truncate">{t.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {soonTasks.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-xs font-serif text-sebastian-gray shrink-0">3日以内が期日</h3>
                <span className="text-sebastian-gold/40 text-[9px] shrink-0">◆</span>
                <div className="flex-1 h-px bg-sebastian-gold/15" />
              </div>
              <ul className="space-y-2">
                {soonTasks.map(t => (
                  <li key={t.id} className="flex items-center gap-2 text-sm text-sebastian-text font-serif">
                    <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${PRIORITY_COLOR[t.priority]}`}>
                      {PRIORITY_LABEL[t.priority] || '—'}
                    </span>
                    <span className="flex-1 min-w-0 truncate">{t.title}</span>
                    {t.due_date && (
                      <span className="text-xs text-sebastian-lightgray flex-shrink-0 font-serif">
                        {format(new Date(t.due_date + 'T00:00:00'), 'M/d')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {highTasks.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-xs font-serif text-sebastian-gray shrink-0">優先度が高いタスク</h3>
                <span className="text-sebastian-gold/40 text-[9px] shrink-0">◆</span>
                <div className="flex-1 h-px bg-sebastian-gold/15" />
              </div>
              <ul className="space-y-2">
                {highTasks.map(t => (
                  <li key={t.id} className="flex items-center gap-2 text-sm text-sebastian-text font-serif">
                    <span className="w-1.5 h-1.5 rounded-full bg-sebastian-gold/60 flex-shrink-0" />
                    <span className="flex-1 min-w-0 truncate">{t.title}</span>
                    {t.due_date && (
                      <span className="text-xs text-sebastian-lightgray flex-shrink-0 font-serif">
                        {format(new Date(t.due_date + 'T00:00:00'), 'M/d')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* フッター */}
        <div className="p-5 border-t border-sebastian-border/50 flex items-center gap-3 flex-shrink-0">
          <Link
            to="/tasks"
            onClick={handleDismiss}
            className="flex items-center gap-1 text-sm text-sebastian-gray hover:text-sebastian-navy transition-colors font-serif"
          >
            タスク一覧 <ArrowRight size={13} />
          </Link>
          <button
            onClick={handleDismiss}
            className="ml-auto px-5 py-2 rounded-lg text-sm font-serif transition-colors"
            style={{ backgroundColor: '#131929', color: '#d4c9a8', border: '1px solid rgba(201,164,86,0.3)' }}
          >
            確認しました
          </button>
        </div>
      </div>
    </div>
  );
}
