import { useState, useEffect, useMemo } from 'react';
import { format } from 'date-fns';
import { Plus, Circle, CheckCircle, Clock, Loader, Trash2, AlertCircle, Archive, ArchiveRestore, ChevronDown, ChevronUp, Pin, PinOff, Search, X, ArrowUp, ArrowDown } from 'lucide-react';
import { selectDb, executeDb } from '../lib/db';
import { logTaskAction } from '../lib/taskLogs';
import { TaskModal, type TaskFormData, type TaskStatus, type TaskPriority } from '../components/TaskModal';
import { OrnateCard, PageHeader } from '../components/ClassicUI';

interface Task {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  category: string | null;
  archived: number;
  pinned: number;
  created_at: string;
  updated_at: string;
}

type FilterTab = 'all' | 'todo' | 'in_progress' | 'done' | 'hold';
type SortKey = 'created_at' | 'updated_at' | 'due_date' | 'priority';
type SortDir = 'asc' | 'desc';

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2, none: 3 };

const PRIORITY_BADGE: Record<string, React.ReactNode> = {
  high: <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded-full">高</span>,
  medium: <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">中</span>,
  low: <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">低</span>,
  none: null,
};

function StatusIcon({ status }: { status: TaskStatus }) {
  switch (status) {
    case 'done':
      return <CheckCircle size={20} className="text-green-600 flex-shrink-0" />;
    case 'in_progress':
      return <Loader size={20} className="text-blue-500 flex-shrink-0" />;
    case 'hold':
      return <Clock size={20} className="text-orange-400 flex-shrink-0" />;
    default:
      return <Circle size={20} className="text-gray-300 flex-shrink-0" />;
  }
}

const FILTER_LABELS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'todo', label: '未着手' },
  { key: 'in_progress', label: '進行中' },
  { key: 'hold', label: '保留' },
  { key: 'done', label: '完了' },
];

const SORT_LABELS: { key: SortKey; label: string }[] = [
  { key: 'created_at', label: '作成日' },
  { key: 'updated_at', label: '更新日' },
  { key: 'due_date', label: '期日' },
  { key: 'priority', label: '優先度' },
];

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [archivedTasks, setArchivedTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [archivingId, setArchivingId] = useState<number | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const loadTasks = async () => {
    const [active, archived] = await Promise.all([
      selectDb<Task>(
        'SELECT id, title, description, status, priority, due_date, category, archived, pinned, created_at, updated_at FROM tasks WHERE archived = 0'
      ),
      selectDb<Task>(
        'SELECT id, title, description, status, priority, due_date, category, archived, pinned, created_at, updated_at FROM tasks WHERE archived = 1 ORDER BY updated_at DESC'
      ),
    ]);
    setTasks(active);
    setArchivedTasks(archived);
  };

  useEffect(() => {
    loadTasks();
  }, []);

  // カテゴリ一覧（タスクから動的生成）
  const categories = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach(t => { if (t.category) set.add(t.category); });
    return [...set].sort((a, b) => a.localeCompare(b, 'ja'));
  }, [tasks]);

  // フィルタリング + ソート
  const filteredTasks = useMemo(() => {
    let result = tasks;

    // ステータスフィルター
    if (filter !== 'all') {
      result = result.filter(t => t.status === filter);
    }

    // カテゴリフィルター
    if (categoryFilter) {
      result = result.filter(t => t.category === categoryFilter);
    }

    // キーワード検索
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(t =>
        t.title.toLowerCase().includes(q) ||
        (t.category?.toLowerCase().includes(q) ?? false) ||
        (t.description?.toLowerCase().includes(q) ?? false)
      );
    }

    // ソート（ピン留めは常に先頭）
    result = [...result].sort((a, b) => {
      if (a.pinned !== b.pinned) return b.pinned - a.pinned;

      const dir = sortDir === 'asc' ? 1 : -1;

      switch (sortKey) {
        case 'priority':
          return dir * ((PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3));
        case 'due_date': {
          if (!a.due_date && !b.due_date) return 0;
          if (!a.due_date) return 1;   // 期日なしは末尾
          if (!b.due_date) return -1;
          return dir * a.due_date.localeCompare(b.due_date);
        }
        case 'updated_at':
          return dir * a.updated_at.localeCompare(b.updated_at);
        default: // created_at
          return dir * a.created_at.localeCompare(b.created_at);
      }
    });

    return result;
  }, [tasks, filter, categoryFilter, searchQuery, sortKey, sortDir]);

  const handleCreate = async (data: TaskFormData) => {
    setErrorMsg('');
    try {
      const result = await executeDb(
        'INSERT INTO tasks (title, description, status, priority, due_date, category) VALUES (?, ?, ?, ?, ?, ?)',
        [data.title, data.description || null, data.status, data.priority, data.due_date || null, data.category || null]
      );
      await logTaskAction({
        taskId: result.lastInsertId as number,
        actionType: 'create',
        afterJson: data,
        actorType: 'user',
      });
      setModalMode(null);
      loadTasks();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(`タスクの追加に失敗しました: ${msg}`);
    }
  };

  const handleEdit = async (data: TaskFormData) => {
    if (!editingTask) return;
    setErrorMsg('');
    try {
      await executeDb(
        'UPDATE tasks SET title=?, description=?, status=?, priority=?, due_date=?, category=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
        [data.title, data.description || null, data.status, data.priority, data.due_date || null, data.category || null, editingTask.id]
      );
      await logTaskAction({
        taskId: editingTask.id,
        actionType: editingTask.status !== data.status ? 'status_change' : 'update',
        beforeJson: editingTask,
        afterJson: data,
        actorType: 'user',
      });
      setModalMode(null);
      setEditingTask(null);
      loadTasks();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(`タスクの更新に失敗しました: ${msg}`);
    }
  };

  const handleToggleStatus = async (task: Task) => {
    const newStatus: TaskStatus = task.status === 'done' ? 'todo' : 'done';
    try {
      await executeDb(
        'UPDATE tasks SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
        [newStatus, task.id]
      );
      await logTaskAction({
        taskId: task.id,
        actionType: 'status_change',
        beforeJson: { status: task.status },
        afterJson: { status: newStatus },
        actorType: 'user',
      });
      loadTasks();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(`ステータス更新に失敗しました: ${msg}`);
    }
  };

  const handleTogglePin = async (task: Task) => {
    const newPinned = task.pinned ? 0 : 1;
    try {
      await executeDb(
        'UPDATE tasks SET pinned=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
        [newPinned, task.id]
      );
      await logTaskAction({
        taskId: task.id,
        actionType: newPinned ? 'pin' : 'unpin',
        actorType: 'user',
      });
      loadTasks();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(`ピン留め操作に失敗しました: ${msg}`);
    }
  };

  const handleArchive = async (task: Task) => {
    try {
      await executeDb(
        'UPDATE tasks SET archived=1, updated_at=CURRENT_TIMESTAMP WHERE id=?',
        [task.id]
      );
      await logTaskAction({
        taskId: task.id,
        actionType: 'archive',
        beforeJson: { archived: 0, status: task.status },
        actorType: 'user',
      });
      setArchivingId(null);
      loadTasks();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(`アーカイブに失敗しました: ${msg}`);
      setArchivingId(null);
    }
  };

  const handleRestore = async (task: Task) => {
    try {
      await executeDb(
        'UPDATE tasks SET archived=0, updated_at=CURRENT_TIMESTAMP WHERE id=?',
        [task.id]
      );
      await logTaskAction({
        taskId: task.id,
        actionType: 'restore',
        beforeJson: { archived: 1 },
        afterJson: { archived: 0 },
        actorType: 'user',
      });
      loadTasks();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(`復元に失敗しました: ${msg}`);
    }
  };

  const handleDelete = async (id: number) => {
    const task = tasks.find(t => t.id === id) ?? archivedTasks.find(t => t.id === id);
    try {
      await executeDb('DELETE FROM tasks WHERE id=?', [id]);
      await logTaskAction({
        taskId: id,
        actionType: 'delete',
        beforeJson: task ?? undefined,
        actorType: 'user',
      });
      setDeletingId(null);
      loadTasks();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(`タスクの削除に失敗しました: ${msg}`);
      setDeletingId(null);
    }
  };

  const openEdit = (task: Task) => {
    setEditingTask(task);
    setModalMode('edit');
  };

  const hasActiveFilters = searchQuery.trim() !== '' || categoryFilter !== '';

  const clearFilters = () => {
    setSearchQuery('');
    setCategoryFilter('');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <PageHeader label="TASKS" title="タスク一覧" />
        <button
          onClick={() => { setEditingTask(null); setModalMode('create'); }}
          className="mt-1 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-serif transition-colors shrink-0"
          style={{ backgroundColor: '#131929', color: '#d4c9a8', border: '1px solid rgba(201,164,86,0.3)' }}
        >
          <Plus size={15} />
          タスクを追加
        </button>
      </div>

      {/* エラー表示 */}
      {errorMsg && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
          <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg('')} className="ml-auto text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* フィルタタブ */}
      <div className="flex gap-1 bg-sebastian-border/30 rounded-xl p-1 w-fit">
        {FILTER_LABELS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-serif transition-colors ${
              filter === key
                ? 'bg-white text-sebastian-navy shadow-sm'
                : 'text-sebastian-lightgray hover:text-sebastian-gray'
            }`}
          >
            {label}
            {key !== 'all' && (
              <span className="ml-1.5 text-xs text-sebastian-lightgray/70">
                {tasks.filter(t => t.status === key).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 検索・ソート・カテゴリバー */}
      <div className="flex flex-wrap items-center gap-2">
        {/* キーワード検索 */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-sebastian-lightgray pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="タイトル・カテゴリで検索"
            className="w-full pl-8 pr-7 py-1.5 text-sm font-serif bg-white border border-sebastian-border rounded-lg text-sebastian-text placeholder-sebastian-lightgray/60 focus:outline-none focus:border-sebastian-gold/50"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-sebastian-lightgray/60 hover:text-sebastian-gray"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* カテゴリフィルター */}
        {categories.length > 0 && (
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="py-1.5 pl-3 pr-7 text-sm font-serif bg-white border border-sebastian-border rounded-lg text-sebastian-text focus:outline-none focus:border-sebastian-gold/50 appearance-none cursor-pointer"
            style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23999\' stroke-width=\'2\'%3E%3Cpolyline points=\'6 9 12 15 18 9\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
          >
            <option value="">カテゴリ: すべて</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        )}

        {/* ソートキー */}
        <select
          value={sortKey}
          onChange={e => setSortKey(e.target.value as SortKey)}
          className="py-1.5 pl-3 pr-7 text-sm font-serif bg-white border border-sebastian-border rounded-lg text-sebastian-text focus:outline-none focus:border-sebastian-gold/50 appearance-none cursor-pointer"
          style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23999\' stroke-width=\'2\'%3E%3Cpolyline points=\'6 9 12 15 18 9\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
        >
          {SORT_LABELS.map(({ key, label }) => (
            <option key={key} value={key}>並び替え: {label}</option>
          ))}
        </select>

        {/* 昇降順ボタン */}
        <button
          onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-serif bg-white border border-sebastian-border rounded-lg text-sebastian-gray hover:border-sebastian-gold/50 transition-colors"
          title={sortDir === 'asc' ? '昇順' : '降順'}
        >
          {sortDir === 'asc'
            ? <ArrowUp size={13} className="text-sebastian-navy" />
            : <ArrowDown size={13} className="text-sebastian-navy" />
          }
          <span className="text-xs">{sortDir === 'asc' ? '昇順' : '降順'}</span>
        </button>

        {/* フィルタークリア */}
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 text-xs text-sebastian-lightgray hover:text-sebastian-gray font-serif underline underline-offset-2"
          >
            <X size={11} />
            絞り込みを解除
          </button>
        )}

        {/* 件数表示 */}
        <span className="ml-auto text-xs text-sebastian-lightgray font-serif">
          {filteredTasks.length} 件
          {filteredTasks.length !== tasks.length && <span className="ml-1">/ {tasks.length} 件中</span>}
        </span>
      </div>

      {/* アクティブなタスクリスト */}
      <OrnateCard>
        {filteredTasks.length === 0 ? (
          <div className="text-center text-sebastian-lightgray py-12 text-sm italic font-serif">
            {hasActiveFilters || filter !== 'all' ? '条件に一致するタスクがありません' : 'タスクがありません'}
          </div>
        ) : (
          <ul className="divide-y divide-sebastian-border/40">
            {filteredTasks.map(task => (
              <li key={task.id} className="flex items-center gap-3 px-5 py-4 hover:bg-sebastian-parchment/30 transition-colors group">
                {/* ステータスアイコン（クリックで完了/未着手トグル） */}
                <button
                  onClick={() => handleToggleStatus(task)}
                  className="hover:scale-110 transition-transform"
                  title="ステータスを切り替え"
                >
                  <StatusIcon status={task.status} />
                </button>

                {/* タスク情報 */}
                <div className="flex-1 min-w-0">
                  <button
                    onClick={() => openEdit(task)}
                    className={`block text-sm text-left w-full font-serif hover:underline underline-offset-2 ${task.status === 'done' ? 'line-through text-sebastian-lightgray' : 'text-sebastian-text hover:text-sebastian-navy'}`}
                  >
                    {task.title}
                  </button>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {task.category && (
                      <button
                        onClick={() => setCategoryFilter(task.category === categoryFilter ? '' : task.category!)}
                        className={`text-xs font-serif transition-colors ${task.category === categoryFilter ? 'text-sebastian-navy underline underline-offset-1' : 'text-sebastian-lightgray hover:text-sebastian-navy'}`}
                        title={task.category === categoryFilter ? 'カテゴリフィルターを解除' : `"${task.category}" で絞り込む`}
                      >
                        {task.category}
                      </button>
                    )}
                    {task.due_date && (
                      <span className="text-xs text-sebastian-lightgray/80 font-serif">
                        期日: {format(new Date(task.due_date + 'T00:00:00'), 'M/d')}
                      </span>
                    )}
                    {task.description && (
                      <span className="text-xs text-sebastian-lightgray/60 truncate max-w-[200px] font-serif">{task.description}</span>
                    )}
                  </div>
                </div>

                {/* 優先度・操作ボタン */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* ピン留めボタン：ピン済みは常時表示 */}
                  <button
                    onClick={() => handleTogglePin(task)}
                    className={`p-1 rounded transition-colors ${
                      task.pinned
                        ? 'text-sebastian-gold-dark'
                        : 'text-sebastian-lightgray/40 opacity-0 group-hover:opacity-100 hover:text-sebastian-gold-dark'
                    }`}
                    title={task.pinned ? 'ピン留め解除' : 'ピン留め'}
                  >
                    {task.pinned ? <Pin size={14} /> : <PinOff size={14} />}
                  </button>

                  {PRIORITY_BADGE[task.priority]}

                  {archivingId === task.id ? (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-gray-500">アーカイブしますか？</span>
                      <button
                        onClick={() => handleArchive(task)}
                        className="text-xs bg-sebastian-navy text-white px-2 py-1 rounded hover:bg-sebastian-dark transition-colors"
                      >
                        アーカイブ
                      </button>
                      <button
                        onClick={() => setArchivingId(null)}
                        className="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded hover:bg-gray-300 transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  ) : deletingId === task.id ? (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-gray-500">削除しますか？</span>
                      <button
                        onClick={() => handleDelete(task.id)}
                        className="text-xs bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600 transition-colors"
                      >
                        削除
                      </button>
                      <button
                        onClick={() => setDeletingId(null)}
                        className="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded hover:bg-gray-300 transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => { setArchivingId(task.id); setDeletingId(null); }}
                        className="p-1.5 text-sebastian-lightgray/60 hover:text-sebastian-navy hover:bg-sebastian-parchment rounded-lg transition-colors"
                        title="アーカイブ"
                      >
                        <Archive size={14} />
                      </button>
                      <button
                        onClick={() => { setDeletingId(task.id); setArchivingId(null); }}
                        className="p-1.5 text-sebastian-lightgray/60 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="削除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </OrnateCard>

      {/* アーカイブ済みセクション */}
      {archivedTasks.length > 0 && (
        <div>
          <button
            onClick={() => setShowArchived(v => !v)}
            className="flex items-center gap-2 text-sm text-sebastian-lightgray hover:text-sebastian-gray transition-colors w-full py-1 font-serif"
          >
            {showArchived ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            <Archive size={14} />
            アーカイブ済み（{archivedTasks.length}件）
          </button>

          {showArchived && (
            <div className="mt-3 bg-sebastian-parchment/50 rounded-xl border border-sebastian-border/50">
              <ul className="divide-y divide-sebastian-border/30">
                {archivedTasks.map(task => (
                  <li key={task.id} className="flex items-center gap-3 px-5 py-3 group">
                    <Archive size={16} className="text-sebastian-lightgray/50 flex-shrink-0" />

                    <div className="flex-1 min-w-0">
                      <span className="block text-sm text-sebastian-lightgray line-through font-serif">
                        {task.title}
                      </span>
                      <div className="flex items-center gap-2 mt-0.5">
                        {task.category && (
                          <span className="text-xs text-sebastian-lightgray/70 font-serif">{task.category}</span>
                        )}
                        {task.due_date && (
                          <span className="text-xs text-sebastian-lightgray/70 font-serif">
                            期日: {format(new Date(task.due_date + 'T00:00:00'), 'M/d')}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleRestore(task)}
                        className="flex items-center gap-1 text-xs text-sebastian-lightgray hover:text-sebastian-navy hover:bg-white px-2 py-1 rounded-lg transition-colors font-serif"
                        title="復元"
                      >
                        <ArchiveRestore size={13} />
                        復元
                      </button>
                      {deletingId === task.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleDelete(task.id)}
                            className="text-xs bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600 transition-colors"
                          >
                            削除
                          </button>
                          <button
                            onClick={() => setDeletingId(null)}
                            className="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded hover:bg-gray-300 transition-colors"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeletingId(task.id)}
                          className="p-1.5 text-gray-300 hover:text-red-400 hover:bg-red-50 rounded-lg transition-colors"
                          title="完全に削除"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* モーダル */}
      {modalMode === 'create' && (
        <TaskModal
          mode="create"
          onSave={handleCreate}
          onClose={() => setModalMode(null)}
        />
      )}
      {modalMode === 'edit' && editingTask && (
        <TaskModal
          mode="edit"
          initialData={{
            title: editingTask.title,
            description: editingTask.description ?? '',
            status: editingTask.status,
            priority: editingTask.priority,
            due_date: editingTask.due_date ?? '',
            category: editingTask.category ?? '',
          }}
          onSave={handleEdit}
          onClose={() => { setModalMode(null); setEditingTask(null); }}
        />
      )}
    </div>
  );
}
