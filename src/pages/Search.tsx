import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Search as SearchIcon, ListTodo, FileText, BookOpen } from 'lucide-react';
import { selectDb } from '../lib/db';
import { PageHeader } from '../components/ClassicUI';
import { PRIORITY_COLOR, PRIORITY_LABEL, STATUS_LABEL } from '../lib/constants';

interface TaskResult { id: number; title: string; status: string; priority: string; category: string | null; due_date: string | null; }
interface MemoResult { date: string; content: string; }
interface ReportResult { date: string; content: string; }

export default function Search() {
  const [query, setQuery] = useState('');
  const [tasks, setTasks] = useState<TaskResult[]>([]);
  const [memos, setMemos] = useState<MemoResult[]>([]);
  const [reports, setReports] = useState<ReportResult[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!query.trim() || query.length < 2) { setTasks([]); setMemos([]); setReports([]); return; }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const like = `%${query}%`;
        const [taskRes, memoRes, reportRes] = await Promise.all([
          selectDb<TaskResult>('SELECT id, title, status, priority, category, due_date FROM tasks WHERE archived = 0 AND (title LIKE ? OR description LIKE ? OR notes LIKE ?) LIMIT 10', [like, like, like]),
          selectDb<MemoResult>('SELECT date, content FROM daily_memos WHERE content LIKE ? ORDER BY date DESC LIMIT 5', [like]),
          selectDb<ReportResult>('SELECT date, content FROM reports_daily WHERE content LIKE ? ORDER BY date DESC LIMIT 5', [like]),
        ]);
        setTasks(taskRes); setMemos(memoRes); setReports(reportRes);
      } finally { setLoading(false); }
    }, 300);
  }, [query]);

  const hasResults = tasks.length > 0 || memos.length > 0 || reports.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader label="SEARCH" title="検索" />

      <div className="relative">
        <SearchIcon size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-sebastian-lightgray pointer-events-none" />
        <input
          autoFocus
          type="text"
          className="w-full pl-11 pr-4 py-3 bg-white border border-sebastian-border rounded-xl font-serif text-sebastian-text outline-none focus:border-sebastian-gold/50 transition-colors text-sm"
          placeholder="タスク・メモ・日報を横断検索..."
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        {loading && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-sebastian-lightgray font-serif">検索中...</span>}
      </div>

      {query.length >= 2 && !loading && !hasResults && (
        <p className="text-sm text-sebastian-lightgray italic text-center py-10 font-serif">「{query}」の検索結果はありません</p>
      )}

      {tasks.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <ListTodo size={13} className="text-sebastian-lightgray" />
            <span className="text-[11px] font-display tracking-[0.18em] text-sebastian-lightgray uppercase">タスク</span>
            <div className="flex-1 h-px bg-sebastian-gold/15" />
          </div>
          <ul className="space-y-1.5">
            {tasks.map(t => (
              <li key={t.id}>
                <Link to="/tasks" className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white border border-sebastian-border/60 hover:border-sebastian-gold/30 transition-colors group">
                  <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${PRIORITY_COLOR[t.priority]}`}>{PRIORITY_LABEL[t.priority]}</span>
                  <span className="flex-1 font-serif text-sm text-sebastian-text group-hover:text-sebastian-navy truncate">{t.title}</span>
                  {t.category && <span className="text-xs text-sebastian-lightgray shrink-0">{t.category}</span>}
                  <span className="text-xs text-sebastian-lightgray shrink-0">{STATUS_LABEL[t.status] ?? t.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {memos.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <FileText size={13} className="text-sebastian-lightgray" />
            <span className="text-[11px] font-display tracking-[0.18em] text-sebastian-lightgray uppercase">メモ</span>
            <div className="flex-1 h-px bg-sebastian-gold/15" />
          </div>
          <ul className="space-y-1.5">
            {memos.map(m => (
              <li key={m.date}>
                <Link to="/memo" className="block px-4 py-2.5 rounded-xl bg-white border border-sebastian-border/60 hover:border-sebastian-gold/30 transition-colors group">
                  <p className="text-xs text-sebastian-lightgray mb-0.5 font-serif">{m.date}</p>
                  <p className="text-sm font-serif text-sebastian-text group-hover:text-sebastian-navy leading-relaxed line-clamp-2">
                    {m.content.substring(0, 150)}{m.content.length > 150 ? '…' : ''}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {reports.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <BookOpen size={13} className="text-sebastian-lightgray" />
            <span className="text-[11px] font-display tracking-[0.18em] text-sebastian-lightgray uppercase">日報</span>
            <div className="flex-1 h-px bg-sebastian-gold/15" />
          </div>
          <ul className="space-y-1.5">
            {reports.map(r => (
              <li key={r.date}>
                <Link to="/reports/daily" className="block px-4 py-2.5 rounded-xl bg-white border border-sebastian-border/60 hover:border-sebastian-gold/30 transition-colors group">
                  <p className="text-xs text-sebastian-lightgray mb-0.5 font-serif">{r.date}</p>
                  <p className="text-sm font-serif text-sebastian-text group-hover:text-sebastian-navy leading-relaxed line-clamp-2">
                    {r.content.substring(0, 150)}{r.content.length > 150 ? '…' : ''}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
