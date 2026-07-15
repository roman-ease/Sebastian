import { useEffect, useState, useRef } from 'react';
import { format } from 'date-fns';
import { X, Pencil, Check, Trash2, Plus, History, Sparkles, Bot, Link2 } from 'lucide-react';
import { selectDb, executeDb } from '../lib/db';
import { logTaskAction } from '../lib/taskLogs';
import { pushTask, pushChecklist } from '../lib/supabase';
import { TaskModal, type TaskFormData, type TaskStatus, type TaskPriority } from './TaskModal';
import { PRIORITY_COLOR, PRIORITY_LABEL, STATUS_LABEL } from '../lib/constants';
import {
  generateChecklist,
  suggestAutoCheck,
  generateTaskProgressComment,
} from '../lib/ai';

interface TaskDetail {
  id: number;
  title: string;
  description: string | null;
  notes: string | null;
  priority: string;
  status: string;
  start_date: string | null;
  due_date: string | null;
  category: string | null;
  progress: number;
  project_id: number | null;
  project_name: string | null;
}

interface ChecklistItem {
  id: number;
  text: string;
  checked: number;
}

interface TaskLog {
  id: number;
  action_type: string;
  before_json: string | null;
  after_json: string | null;
  actor_type: string;
  created_at: string;
}

interface Props {
  taskId: number;
  onClose: () => void;
}

// ─── ログ表示ヘルパー ─────────────────────────────────────────

function describeLog(log: TaskLog): string {
  const before = log.before_json ? JSON.parse(log.before_json) : null;
  const after  = log.after_json  ? JSON.parse(log.after_json)  : null;
  switch (log.action_type) {
    case 'create':  return 'タスクを作成';
    case 'archive': return 'アーカイブ';
    case 'restore': return 'アーカイブ解除';
    case 'pin':     return 'ピン留め';
    case 'unpin':   return 'ピン留め解除';
    case 'delete':  return '削除';
    case 'status_change': {
      const from = STATUS_LABEL[before?.status] ?? before?.status ?? '?';
      const to   = STATUS_LABEL[after?.status]  ?? after?.status  ?? '?';
      return `ステータス: ${from} → ${to}`;
    }
    case 'update': {
      if (!before || !after) return 'タスクを更新';
      if ((before.project_id ?? null) !== (after.project_id ?? null)) {
        if (after.project_id == null) return 'プロジェクト割当を解除';
        if (before.project_id == null) return 'プロジェクトへ割当';
        return 'プロジェクト割当を変更';
      }
      if (before.priority !== after.priority)
        return `優先度: ${PRIORITY_LABEL[before.priority] ?? before.priority} → ${PRIORITY_LABEL[after.priority] ?? after.priority}`;
      if (before.progress !== after.progress)
        return `進捗率: ${before.progress ?? 0}% → ${after.progress ?? 0}%`;
      if (before.title !== after.title)       return 'タイトルを変更';
      if (before.due_date !== after.due_date) return '終了日を変更';
      if (before.start_date !== after.start_date) return '開始日を変更';
      if (before.category !== after.category) return 'カテゴリを変更';
      return 'タスクを更新';
    }
    default: return log.action_type;
  }
}

function formatLogTime(createdAt: string): string {
  const d = new Date(createdAt);
  const today = format(new Date(), 'yyyy-MM-dd');
  const logDate = format(d, 'yyyy-MM-dd');
  return logDate === today ? format(d, 'HH:mm') : format(d, 'M/d HH:mm');
}

// ─── メインコンポーネント ─────────────────────────────────────

export function TaskPeekModal({ taskId, onClose }: Props) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [logs, setLogs] = useState<TaskLog[]>([]);

  // ノート編集
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');

  // 進捗率編集
  const [editingProgress, setEditingProgress] = useState(false);
  const [progressDraft, setProgressDraft] = useState(0);

  // チェックリスト追加
  const [newItemText, setNewItemText] = useState('');
  const [showNewItem, setShowNewItem] = useState(false);
  const newItemRef = useRef<HTMLInputElement>(null);

  // AI チェックリスト生成
  const [generatingChecklist, setGeneratingChecklist] = useState(false);

  // AI 代理チェック
  const [checkingProxy, setCheckingProxy] = useState(false);
  const [proxyCheckSuggestions, setProxyCheckSuggestions] = useState<string[]>([]);
  const [showProxyConfirm, setShowProxyConfirm] = useState(false);

  // AI 進捗コメント
  const [aiComment, setAiComment] = useState<string | null>(null);
  const [generatingComment, setGeneratingComment] = useState(false);

  // 編集モーダル切替
  const [editing, setEditing] = useState(false);

  const loadAll = () => {
    return Promise.all([
      selectDb<TaskDetail>(
        `SELECT id, title, description, notes, priority, status, start_date, due_date, category, progress, project_id,
          (SELECT name FROM projects WHERE id = tasks.project_id) as project_name
         FROM tasks WHERE id = ?`,
        [taskId]
      ),
      selectDb<ChecklistItem>(
        'SELECT id, text, checked FROM task_checklist WHERE task_id = ? ORDER BY sort_order ASC, id ASC',
        [taskId]
      ),
      selectDb<TaskLog>(
        'SELECT id, action_type, before_json, after_json, actor_type, created_at FROM task_logs WHERE task_id = ? ORDER BY created_at DESC LIMIT 30',
        [taskId]
      ),
    ]).then(([taskRows, checkRows, logRows]) => {
      setTask(taskRows[0] ?? null);
      setNotesDraft(taskRows[0]?.notes ?? '');
      setProgressDraft(taskRows[0]?.progress ?? 0);
      setChecklist(checkRows);
      setLogs(logRows);
    });
  };

  useEffect(() => {
    loadAll();
  }, [taskId]);

  useEffect(() => {
    if (showNewItem) newItemRef.current?.focus();
  }, [showNewItem]);

  // Escape で閉じる。入力欄（進捗編集・新規チェック項目など）は各自の Escape 処理を
  // 持つため、フォーカスが入力系にある間は閉じない。上に重なる編集モーダル
  // （TaskModal）表示中も、そちらだけが閉じるべきなので反応しない。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || editing) return;
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editing, onClose]);

  const reloadLogs = async () => {
    const rows = await selectDb<TaskLog>(
      'SELECT id, action_type, before_json, after_json, actor_type, created_at FROM task_logs WHERE task_id = ? ORDER BY created_at DESC LIMIT 30',
      [taskId]
    );
    setLogs(rows);
  };

  // ─── ノート ──────────────────────────────────────────────────
  const saveNotes = async () => {
    if (!task) return;
    const newNotes = notesDraft || null;
    if (newNotes === task.notes) { setEditingNotes(false); return; }
    await executeDb('UPDATE tasks SET notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [newNotes, task.id]);
    await logTaskAction({
      taskId: task.id,
      actionType: 'update',
      beforeJson: { notes: task.notes },
      afterJson: { notes: newNotes },
      actorType: 'user',
    });
    pushTask(task.id);
    setTask(t => t ? { ...t, notes: newNotes } : t);
    setEditingNotes(false);
    reloadLogs();
  };

  // ─── 進捗率 ──────────────────────────────────────────────────
  const saveProgress = async (value?: number) => {
    if (!task) return;
    const clamped = Math.min(100, Math.max(0, value ?? progressDraft));
    if (clamped === task.progress) { setProgressDraft(clamped); setEditingProgress(false); return; }
    await executeDb('UPDATE tasks SET progress=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [clamped, task.id]);
    await logTaskAction({
      taskId: task.id,
      actionType: 'update',
      beforeJson: { progress: task.progress },
      afterJson: { progress: clamped },
      actorType: 'user',
    });
    pushTask(task.id);
    setTask(t => t ? { ...t, progress: clamped } : t);
    setProgressDraft(clamped);
    setEditingProgress(false);
    reloadLogs();
  };

  // チェックリスト連動で進捗率を更新
  const linkProgressToChecklist = async () => {
    if (!task || checklist.length === 0) return;
    const pct = Math.round(checklist.filter(i => i.checked).length / checklist.length * 100);
    await saveProgress(pct);
  };

  // ─── チェックリスト ───────────────────────────────────────────
  const toggleItem = async (item: ChecklistItem) => {
    const newChecked = item.checked ? 0 : 1;
    await executeDb('UPDATE task_checklist SET checked=? WHERE id=?', [newChecked, item.id]);
    setChecklist(list => list.map(i => i.id === item.id ? { ...i, checked: newChecked } : i));
    pushChecklist(taskId);
  };

  const deleteItem = async (id: number) => {
    await executeDb('DELETE FROM task_checklist WHERE id=?', [id]);
    setChecklist(list => list.filter(i => i.id !== id));
    pushChecklist(taskId);
  };

  const addItem = async () => {
    const text = newItemText.trim();
    if (!text) return;
    const maxOrder = checklist.length > 0 ? Math.max(...checklist.map(i => i.id)) + 1 : 0;
    const result = await executeDb(
      'INSERT INTO task_checklist (task_id, text, checked, sort_order) VALUES (?, ?, 0, ?)',
      [taskId, text, maxOrder]
    );
    setChecklist(list => [...list, { id: result.lastInsertId as number, text, checked: 0 }]);
    setNewItemText('');
    setShowNewItem(false);
    pushChecklist(taskId);
  };

  // AI チェックリスト生成
  const handleGenerateChecklist = async () => {
    if (!task) return;
    setGeneratingChecklist(true);
    try {
      const items = await generateChecklist({ title: task.title, description: task.description ?? '' });
      for (let i = 0; i < items.length; i++) {
        const result = await executeDb(
          'INSERT INTO task_checklist (task_id, text, checked, sort_order) VALUES (?, ?, 0, ?)',
          [taskId, items[i], checklist.length + i]
        );
        setChecklist(prev => [...prev, { id: result.lastInsertId as number, text: items[i], checked: 0 }]);
      }
      if (items.length > 0) pushChecklist(taskId);
    } catch (e) {
      console.error(e);
    } finally {
      setGeneratingChecklist(false);
    }
  };

  // AI 代理チェック
  const handleProxyCheck = async () => {
    if (!task || checklist.length === 0) return;
    setCheckingProxy(true);
    try {
      const today = format(new Date(), 'yyyy-MM-dd');
      const memos = await selectDb<{ content: string }>('SELECT content FROM daily_memos WHERE date = ?', [today]);
      const memoContent = memos[0]?.content ?? '';
      if (!memoContent.trim()) return;
      const unchecked = checklist.filter(i => !i.checked).map(i => i.text);
      if (unchecked.length === 0) return;
      const suggestions = await suggestAutoCheck({ title: task.title, checklistItems: unchecked, memoContent });
      if (suggestions.length > 0) {
        setProxyCheckSuggestions(suggestions);
        setShowProxyConfirm(true);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setCheckingProxy(false);
    }
  };

  const applyProxyCheck = async () => {
    const targets = proxyCheckSuggestions
      .map(text => checklist.find(i => i.text === text && !i.checked))
      .filter((i): i is ChecklistItem => i != null);
    for (const item of targets) {
      await executeDb('UPDATE task_checklist SET checked=1 WHERE id=?', [item.id]);
    }
    const targetIds = new Set(targets.map(i => i.id));
    setChecklist(list => list.map(i => targetIds.has(i.id) ? { ...i, checked: 1 } : i));
    if (targets.length > 0) pushChecklist(taskId);
    setShowProxyConfirm(false);
    setProxyCheckSuggestions([]);
  };

  // AI 進捗コメント
  const handleGenerateComment = async () => {
    if (!task) return;
    setGeneratingComment(true);
    try {
      const comment = await generateTaskProgressComment({
        title: task.title,
        description: task.description ?? '',
        progress: task.progress,
        checklistDone: checklist.filter(i => i.checked).length,
        checklistTotal: checklist.length,
      });
      setAiComment(comment);
    } catch (e) {
      console.error(e);
      setAiComment('コメントの生成に失敗しました');
    } finally {
      setGeneratingComment(false);
    }
  };

  // ─── 編集モーダルからの保存 ───────────────────────────────────
  const handleEditSave = async (data: TaskFormData) => {
    if (!task) return;
    await executeDb(
      'UPDATE tasks SET title=?, description=?, notes=?, status=?, priority=?, start_date=?, due_date=?, category=?, progress=?, project_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
      [data.title, data.description || null, data.notes || null, data.status, data.priority, data.start_date || null, data.due_date || null, data.category || null, data.progress, data.project_id, task.id]
    );
    await logTaskAction({
      taskId: task.id,
      actionType: task.status !== data.status ? 'status_change' : 'update',
      beforeJson: task,
      afterJson: data,
      actorType: 'user',
    });
    pushTask(task.id);
    setEditing(false);
    loadAll();
  };

  const checkedCount = checklist.filter(i => i.checked).length;

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl p-6 shadow-xl max-h-[85vh] overflow-y-auto"
        style={{ backgroundColor: 'var(--color-white)', border: '1px solid var(--color-sebastian-border)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* 角飾り */}
        <span className="absolute top-2.5 left-2.5 w-4 h-4 border-t border-l border-sebastian-gold/30 pointer-events-none rounded-tl-sm" />
        <span className="absolute top-2.5 right-2.5 w-4 h-4 border-t border-r border-sebastian-gold/30 pointer-events-none rounded-tr-sm" />
        <span className="absolute bottom-2.5 left-2.5 w-4 h-4 border-b border-l border-sebastian-gold/30 pointer-events-none rounded-bl-sm" />
        <span className="absolute bottom-2.5 right-2.5 w-4 h-4 border-b border-r border-sebastian-gold/30 pointer-events-none rounded-br-sm" />

        <div className="absolute top-4 right-4 flex items-center gap-2.5">
          {task && (
            <button
              onClick={() => setEditing(true)}
              className="text-sebastian-lightgray hover:text-sebastian-gold transition-colors"
              title="タスクを編集"
            >
              <Pencil size={14} />
            </button>
          )}
          <button
            onClick={onClose}
            className="text-sebastian-lightgray hover:text-sebastian-gray transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {!task ? (
          <p className="text-sm text-sebastian-lightgray font-serif">読み込み中...</p>
        ) : (
          <div className="space-y-3">
            {/* タイトル */}
            <h2 className="text-base font-serif text-sebastian-navy pr-12 leading-snug">{task.title}</h2>

            {/* バッジ */}
            <div className="flex flex-wrap gap-2">
              <span className={`text-xs px-1.5 py-0.5 rounded border ${PRIORITY_COLOR[task.priority]}`}>
                優先度: {PRIORITY_LABEL[task.priority]}
              </span>
              <span className="text-xs px-1.5 py-0.5 rounded border bg-gray-50 text-gray-500 border-gray-100">
                {STATUS_LABEL[task.status] ?? task.status}
              </span>
              {(task.start_date || task.due_date) && (
                <span className="text-xs px-1.5 py-0.5 rounded border bg-gray-50 text-gray-500 border-gray-100">
                  {task.start_date && task.due_date && task.start_date !== task.due_date
                    ? `${task.start_date} 〜 ${task.due_date}`
                    : task.due_date ?? task.start_date}
                </span>
              )}
              {task.category && (
                <span className="text-xs px-1.5 py-0.5 rounded border bg-gray-50 text-gray-500 border-gray-100">
                  {task.category}
                </span>
              )}
              {task.project_name && (
                <span className="text-xs px-1.5 py-0.5 rounded border border-sebastian-gold/30 text-sebastian-gold-dark" style={{ backgroundColor: 'rgba(201,164,86,0.08)' }}>
                  ◆ {task.project_name}
                </span>
              )}
            </div>

            {/* 概要 */}
            {task.description && (
              <p className="text-sm text-sebastian-gray leading-relaxed font-serif whitespace-pre-wrap border-t border-sebastian-border/40 pt-3">
                {task.description}
              </p>
            )}

            {/* ─── 進捗率 ─── */}
            <div className="border-t border-sebastian-border/40 pt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-display tracking-widest text-sebastian-lightgray uppercase">進捗率</span>
                <div className="flex items-center gap-2">
                  {/* チェックリスト連動 */}
                  {checklist.length > 0 && (
                    <button
                      onClick={linkProgressToChecklist}
                      className="text-sebastian-lightgray hover:text-sebastian-gold transition-colors"
                      title="チェックリストの完了率を進捗率に反映"
                    >
                      <Link2 size={12} />
                    </button>
                  )}
                  {/* AI コメント生成 */}
                  <button
                    onClick={handleGenerateComment}
                    disabled={generatingComment}
                    className="text-sebastian-lightgray hover:text-sebastian-gold transition-colors disabled:opacity-40"
                    title="セバスチャンの一言"
                  >
                    <Sparkles size={12} />
                  </button>
                  {/* 進捗率編集 */}
                  {!editingProgress ? (
                    <button
                      onClick={() => { setProgressDraft(task.progress); setEditingProgress(true); }}
                      className="text-sebastian-lightgray hover:text-sebastian-gold transition-colors"
                      title="進捗率を編集"
                    >
                      <Pencil size={13} />
                    </button>
                  ) : (
                    <div className="flex items-center gap-1">
                      <button onClick={() => saveProgress()} className="text-green-600 hover:text-green-700 transition-colors">
                        <Check size={14} />
                      </button>
                      <button onClick={() => setEditingProgress(false)} className="text-sebastian-lightgray hover:text-sebastian-gray transition-colors">
                        <X size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {editingProgress ? (
                <div className="flex items-center gap-3">
                  <div className="flex-1 relative h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(201,164,86,0.15)' }}>
                    <div className="absolute left-0 top-0 h-full rounded-full transition-all duration-200" style={{ width: `${progressDraft}%`, backgroundColor: 'rgba(201,164,86,0.7)' }} />
                  </div>
                  <input
                    type="number" min={0} max={100} autoFocus
                    className="w-14 text-right bg-sebastian-parchment/50 border border-sebastian-gold/30 rounded px-2 py-1 text-sm font-serif text-sebastian-text outline-none"
                    value={progressDraft}
                    onChange={e => setProgressDraft(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
                    onKeyDown={e => { if (e.key === 'Enter') saveProgress(); if (e.key === 'Escape') setEditingProgress(false); }}
                  />
                  <span className="text-sm font-serif text-sebastian-gray shrink-0">%</span>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="flex-1 relative h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(201,164,86,0.15)' }}>
                    <div className="absolute left-0 top-0 h-full rounded-full transition-all duration-500" style={{ width: `${task.progress}%`, backgroundColor: 'rgba(201,164,86,0.7)' }} />
                  </div>
                  <span className="text-sm font-serif text-sebastian-gray shrink-0 cursor-pointer hover:text-sebastian-navy transition-colors" onClick={() => { setProgressDraft(task.progress); setEditingProgress(true); }}>
                    {task.progress}%
                  </span>
                </div>
              )}

              {/* AI 進捗コメント */}
              {(aiComment || generatingComment) && (
                <div className="flex items-start gap-2 mt-2 pt-2 border-t border-sebastian-border/30">
                  <div
                    className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-display font-semibold mt-0.5"
                    style={{ backgroundColor: '#131929', color: '#c9a456', border: '1px solid rgba(201,164,86,0.3)' }}
                  >
                    S
                  </div>
                  <p className="text-xs font-serif text-sebastian-gray leading-relaxed flex-1">
                    {generatingComment
                      ? <span className="text-sebastian-lightgray italic">考えております...</span>
                      : aiComment
                    }
                  </p>
                </div>
              )}
            </div>

            {/* ─── チェックリスト ─── */}
            <div className="border-t border-sebastian-border/40 pt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-display tracking-widest text-sebastian-lightgray uppercase">
                  チェックリスト
                  {checklist.length > 0 && (
                    <span className="ml-1.5 text-sebastian-gold/70">{checkedCount}/{checklist.length}</span>
                  )}
                </span>
                <div className="flex items-center gap-2">
                  {/* AI 代理チェック */}
                  <button
                    onClick={handleProxyCheck}
                    disabled={checkingProxy || checklist.length === 0}
                    className="text-sebastian-lightgray hover:text-sebastian-gold transition-colors disabled:opacity-30"
                    title="今日のメモをもとに代理チェック"
                  >
                    {checkingProxy ? <span className="text-[10px] font-serif">確認中</span> : <Bot size={13} />}
                  </button>
                  {/* AI 生成 */}
                  <button
                    onClick={handleGenerateChecklist}
                    disabled={generatingChecklist}
                    className="text-sebastian-lightgray hover:text-sebastian-gold transition-colors disabled:opacity-40"
                    title="AI でチェックリストを生成"
                  >
                    {generatingChecklist ? <span className="text-[10px] font-serif">生成中</span> : <Sparkles size={13} />}
                  </button>
                  {/* 手動追加 */}
                  <button
                    onClick={() => setShowNewItem(v => !v)}
                    className="text-sebastian-lightgray hover:text-sebastian-gold transition-colors"
                    title="項目を追加"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>

              {/* 代理チェック確認 */}
              {showProxyConfirm && (
                <div className="mb-3 p-3 rounded-lg border border-sebastian-gold/30" style={{ backgroundColor: 'rgba(201,164,86,0.06)' }}>
                  <p className="text-xs font-serif text-sebastian-gray mb-2">
                    今日のメモから、以下の完了が確認されました
                  </p>
                  <ul className="space-y-1 mb-3">
                    {proxyCheckSuggestions.map(text => (
                      <li key={text} className="flex items-center gap-2 text-xs font-serif text-sebastian-text">
                        <Check size={10} className="text-sebastian-gold shrink-0" />
                        {text}
                      </li>
                    ))}
                  </ul>
                  <div className="flex gap-2">
                    <button
                      onClick={applyProxyCheck}
                      className="flex-1 rounded-lg py-1.5 text-xs font-serif transition-colors"
                      style={{ backgroundColor: '#131929', color: '#d4c9a8', border: '1px solid rgba(201,164,86,0.3)' }}
                    >
                      まとめてチェック
                    </button>
                    <button
                      onClick={() => { setShowProxyConfirm(false); setProxyCheckSuggestions([]); }}
                      className="flex-1 rounded-lg py-1.5 text-xs font-serif text-sebastian-gray hover:bg-sebastian-border/20 transition-colors border border-sebastian-border/40"
                    >
                      閉じる
                    </button>
                  </div>
                </div>
              )}

              {checklist.length === 0 && !showNewItem && !generatingChecklist && (
                <p
                  className="text-xs text-sebastian-lightgray italic font-serif cursor-pointer hover:text-sebastian-gray transition-colors"
                  onClick={() => setShowNewItem(true)}
                >
                  項目なし — + で追加、✨ でAI生成
                </p>
              )}

              <div className="space-y-1">
                {checklist.map(item => (
                  <div key={item.id} className="flex items-center gap-2 group">
                    <button
                      onClick={() => toggleItem(item)}
                      className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                        item.checked
                          ? 'border-sebastian-gold/50 bg-sebastian-gold/10'
                          : 'border-sebastian-border hover:border-sebastian-gold/40'
                      }`}
                    >
                      {item.checked ? <Check size={10} className="text-sebastian-gold" /> : null}
                    </button>
                    <span className={`flex-1 text-sm font-serif leading-snug ${item.checked ? 'line-through text-sebastian-lightgray' : 'text-sebastian-text'}`}>
                      {item.text}
                    </span>
                    <button
                      onClick={() => deleteItem(item.id)}
                      className="opacity-0 group-hover:opacity-100 text-sebastian-lightgray hover:text-red-400 transition-all"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>

              {showNewItem && (
                <div className="flex items-center gap-2 mt-2">
                  <div className="w-4 h-4 rounded border border-sebastian-border flex-shrink-0" />
                  <input
                    ref={newItemRef}
                    type="text"
                    className="flex-1 text-sm font-serif bg-transparent border-b border-sebastian-gold/30 outline-none text-sebastian-text pb-0.5 placeholder:text-sebastian-lightgray/50"
                    placeholder="新しい項目..."
                    value={newItemText}
                    onChange={e => setNewItemText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); addItem(); }
                      if (e.key === 'Escape') { setShowNewItem(false); setNewItemText(''); }
                    }}
                  />
                  <button onClick={addItem} className="text-green-600 hover:text-green-700 transition-colors flex-shrink-0">
                    <Check size={14} />
                  </button>
                  <button onClick={() => { setShowNewItem(false); setNewItemText(''); }} className="text-sebastian-lightgray hover:text-sebastian-gray transition-colors flex-shrink-0">
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>

            {/* ─── 作業ノート ─── */}
            <div className="border-t border-sebastian-border/40 pt-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-display tracking-widest text-sebastian-lightgray uppercase">作業ノート</span>
                {!editingNotes ? (
                  <button onClick={() => { setNotesDraft(task.notes ?? ''); setEditingNotes(true); }}
                    className="text-sebastian-lightgray hover:text-sebastian-gold transition-colors">
                    <Pencil size={13} />
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button onClick={saveNotes} className="text-green-600 hover:text-green-700 transition-colors"><Check size={14} /></button>
                    <button onClick={() => setEditingNotes(false)} className="text-sebastian-lightgray hover:text-sebastian-gray transition-colors"><X size={14} /></button>
                  </div>
                )}
              </div>
              {editingNotes ? (
                <textarea
                  autoFocus rows={5}
                  className="w-full bg-sebastian-parchment/50 border border-sebastian-gold/30 rounded-lg px-3 py-2 outline-none text-sm font-serif text-sebastian-text resize-none leading-relaxed"
                  placeholder="進捗メモ・議事録・参考 URL など"
                  value={notesDraft}
                  onChange={e => setNotesDraft(e.target.value)}
                />
              ) : task.notes ? (
                <p className="text-sm text-sebastian-gray leading-relaxed font-serif whitespace-pre-wrap">{task.notes}</p>
              ) : (
                <p className="text-xs text-sebastian-lightgray italic font-serif cursor-pointer hover:text-sebastian-gray transition-colors"
                  onClick={() => { setNotesDraft(''); setEditingNotes(true); }}>
                  ノートなし — クリックして追記
                </p>
              )}
            </div>

            {/* ─── 変更履歴 ─── */}
            {logs.length > 0 && (
              <div className="border-t border-sebastian-border/40 pt-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <History size={11} className="text-sebastian-lightgray" />
                  <span className="text-[11px] font-display tracking-widest text-sebastian-lightgray uppercase">変更履歴</span>
                </div>
                <ol className="space-y-0">
                  {logs.map((log, idx) => (
                    <li key={log.id} className="flex gap-2.5 items-start">
                      <div className="flex flex-col items-center flex-shrink-0 mt-1">
                        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${log.action_type === 'create' ? 'bg-sebastian-gold/60' : 'bg-sebastian-border'}`} />
                        {idx < logs.length - 1 && <div className="w-px flex-1 min-h-[16px] bg-sebastian-border/50 mt-0.5" />}
                      </div>
                      <div className="flex items-baseline justify-between gap-2 flex-1 pb-3">
                        <span className={`text-xs font-serif leading-snug ${log.action_type === 'create' ? 'text-sebastian-navy' : 'text-sebastian-gray'}`}>
                          {describeLog(log)}
                          {log.actor_type === 'ai' && <span className="ml-1.5 text-[10px] text-sebastian-gold/70 font-sans">AI</span>}
                        </span>
                        <span className="text-[10px] text-sebastian-lightgray/70 font-serif shrink-0">{formatLogTime(log.created_at)}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </div>
    </div>

    {/* 編集モーダル（Peek の上に重ねる。Peek のオーバーレイの外に置いて
        バックドロップクリックが Peek まで伝播して両方閉じるのを防ぐ） */}
    {editing && task && (
      <TaskModal
        mode="edit"
        taskId={task.id}
        initialData={{
          title: task.title,
          description: task.description ?? '',
          notes: task.notes ?? '',
          status: task.status as TaskStatus,
          priority: task.priority as TaskPriority,
          start_date: task.start_date ?? '',
          due_date: task.due_date ?? '',
          category: task.category ?? '',
          progress: task.progress,
          project_id: task.project_id,
        }}
        onSave={handleEditSave}
        onClose={() => { setEditing(false); loadAll(); }}
      />
    )}
    </>
  );
}
