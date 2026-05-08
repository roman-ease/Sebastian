import React, { useState, useEffect, useRef } from 'react';
import { X, Check, Trash2, Plus } from 'lucide-react';
import { selectDb, executeDb } from '../lib/db';
import { pushChecklist } from '../lib/supabase';

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'hold';
export type TaskPriority = 'none' | 'low' | 'medium' | 'high';

export interface TaskFormData {
  title: string;
  description: string;
  notes: string;
  status: TaskStatus;
  priority: TaskPriority;
  start_date: string;
  due_date: string;
  category: string;
  progress: number;
}

interface ChecklistItem {
  id: number;
  text: string;
  checked: number;
}

interface Props {
  initialData?: Partial<TaskFormData>;
  onSave: (data: TaskFormData) => void;
  onClose: () => void;
  mode: 'create' | 'edit';
  taskId?: number; // 編集時のみ渡される
}

export function TaskModal({ initialData, onSave, onClose, mode, taskId }: Props) {
  const [form, setForm] = useState<TaskFormData>({
    title: initialData?.title ?? '',
    description: initialData?.description ?? '',
    notes: initialData?.notes ?? '',
    status: initialData?.status ?? 'todo',
    priority: initialData?.priority ?? 'none',
    start_date: initialData?.start_date ?? '',
    due_date: initialData?.due_date ?? '',
    category: initialData?.category ?? '',
    progress: initialData?.progress ?? 0,
  });

  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [newItemText, setNewItemText] = useState('');
  const [showNewItem, setShowNewItem] = useState(false);
  const newItemRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // 編集モードのときチェックリストを読み込む
  useEffect(() => {
    if (taskId == null) return;
    selectDb<ChecklistItem>(
      'SELECT id, text, checked FROM task_checklist WHERE task_id = ? ORDER BY sort_order ASC, id ASC',
      [taskId]
    ).then(rows => setChecklist(rows));
  }, [taskId]);

  useEffect(() => {
    if (showNewItem) newItemRef.current?.focus();
  }, [showNewItem]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    onSave(form);
  };

  // ─── チェックリスト操作 ───────────────────────────────────
  const toggleItem = async (item: ChecklistItem) => {
    const newChecked = item.checked ? 0 : 1;
    await executeDb('UPDATE task_checklist SET checked=? WHERE id=?', [newChecked, item.id]);
    setChecklist(list => list.map(i => i.id === item.id ? { ...i, checked: newChecked } : i));
    if (taskId != null) pushChecklist(taskId);
  };

  const deleteItem = async (id: number) => {
    await executeDb('DELETE FROM task_checklist WHERE id=?', [id]);
    setChecklist(list => list.filter(i => i.id !== id));
    if (taskId != null) pushChecklist(taskId);
  };

  const addItem = async () => {
    const text = newItemText.trim();
    if (!text || taskId == null) return;
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

  const checkedCount = checklist.filter(i => i.checked).length;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onClose}
    >
      {/* 外枠: 角飾り・タイトルバーはスクロール対象外 */}
      <div
        className="relative rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col"
        style={{ backgroundColor: '#faf7f0', border: '1px solid #d5c9a8' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Corner ornaments — 外枠に固定されるので常に四隅に表示 */}
        <span className="absolute top-2.5 left-2.5 w-4 h-4 border-t border-l border-sebastian-gold/30 pointer-events-none rounded-tl-sm z-10" />
        <span className="absolute top-2.5 right-2.5 w-4 h-4 border-t border-r border-sebastian-gold/30 pointer-events-none rounded-tr-sm z-10" />
        <span className="absolute bottom-2.5 left-2.5 w-4 h-4 border-b border-l border-sebastian-gold/30 pointer-events-none rounded-bl-sm z-10" />
        <span className="absolute bottom-2.5 right-2.5 w-4 h-4 border-b border-r border-sebastian-gold/30 pointer-events-none rounded-br-sm z-10" />

        {/* タイトルバー（スクロール対象外・常に上端に固定） */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 flex-shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-serif text-sebastian-navy">
              {mode === 'create' ? 'タスクを追加' : 'タスクを編集'}
            </h2>
            <span className="text-sebastian-gold/40 text-[9px]">◆</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sebastian-lightgray hover:text-sebastian-gray transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* スクロール領域 */}
        <div className="overflow-y-auto flex-1 px-6 pb-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* タイトル */}
          <div>
            <label className="block text-sm text-sebastian-gray font-serif mb-1">
              タイトル <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              required
              autoFocus
              className="w-full bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 outline-none focus:border-sebastian-gold/50 transition-colors font-serif text-sebastian-text"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            />
          </div>

          {/* 概要 */}
          <div>
            <label className="block text-sm text-sebastian-gray font-serif mb-1">概要</label>
            <textarea
              rows={2}
              className="w-full bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 outline-none focus:border-sebastian-gold/50 resize-none transition-colors font-serif text-sebastian-text"
              placeholder="詳細・背景・対応方針など"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
          </div>

          {/* 作業ノート */}
          <div>
            <label className="block text-sm text-sebastian-gray font-serif mb-1">作業ノート</label>
            <textarea
              rows={4}
              className="w-full bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 outline-none focus:border-sebastian-gold/50 resize-none transition-colors font-serif text-sebastian-text"
              placeholder={"進捗メモ・議事録・参考 URL などを自由に\n（タスクカードから随時追記できます）"}
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>

          {/* ステータス・優先度 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-sebastian-gray font-serif mb-1">ステータス</label>
              <select
                className="w-full bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 outline-none focus:border-sebastian-gold/50 transition-colors font-serif text-sebastian-text"
                value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value as TaskStatus }))}
              >
                <option value="todo">未着手</option>
                <option value="in_progress">進行中</option>
                <option value="done">完了</option>
                <option value="hold">保留</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-sebastian-gray font-serif mb-1">優先度</label>
              <select
                className="w-full bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 outline-none focus:border-sebastian-gold/50 transition-colors font-serif text-sebastian-text"
                value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: e.target.value as TaskPriority }))}
              >
                <option value="none">なし</option>
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </select>
            </div>
          </div>

          {/* 開始日・終了日 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-sebastian-gray font-serif mb-1">開始日</label>
              <input
                type="date"
                className="w-full bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 outline-none focus:border-sebastian-gold/50 transition-colors font-serif text-sebastian-text"
                value={form.start_date}
                onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm text-sebastian-gray font-serif mb-1">終了日</label>
              <input
                type="date"
                className="w-full bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 outline-none focus:border-sebastian-gold/50 transition-colors font-serif text-sebastian-text"
                value={form.due_date}
                onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
              />
            </div>
          </div>

          {/* カテゴリ */}
          <div>
            <label className="block text-sm text-sebastian-gray font-serif mb-1">カテゴリ</label>
            <input
              type="text"
              className="w-full bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 outline-none focus:border-sebastian-gold/50 transition-colors font-serif text-sebastian-text"
              placeholder="例: 情シス, 研修, 採用"
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
            />
          </div>

          {/* 進捗率 */}
          <div>
            <label className="block text-sm text-sebastian-gray font-serif mb-1">
              進捗率
              <span className="ml-2 text-sebastian-lightgray font-sans font-normal">{form.progress}%</span>
            </label>
            <div className="flex items-center gap-3">
              <div className="flex-1 relative h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(201,164,86,0.15)' }}>
                <div
                  className="absolute left-0 top-0 h-full rounded-full transition-all duration-200"
                  style={{ width: `${form.progress}%`, backgroundColor: 'rgba(201,164,86,0.7)' }}
                />
              </div>
              <input
                type="number"
                min={0}
                max={100}
                className="w-16 text-right bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-2 py-1.5 outline-none focus:border-sebastian-gold/50 transition-colors font-serif text-sebastian-text text-sm"
                value={form.progress}
                onChange={e => setForm(f => ({ ...f, progress: Math.min(100, Math.max(0, Number(e.target.value) || 0)) }))}
              />
              <span className="text-sm font-serif text-sebastian-gray">%</span>
            </div>
          </div>

          {/* チェックリスト（編集時のみ） */}
          {mode === 'edit' && taskId != null && (
            <div className="border-t border-sebastian-border/40 pt-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-sebastian-gray font-serif">
                  チェックリスト
                  {checklist.length > 0 && (
                    <span className="ml-2 text-sebastian-lightgray font-sans text-xs">
                      {checkedCount}/{checklist.length}
                    </span>
                  )}
                </label>
                <button
                  type="button"
                  onClick={() => setShowNewItem(v => !v)}
                  className="text-sebastian-lightgray hover:text-sebastian-gold transition-colors"
                  title="項目を追加"
                >
                  <Plus size={14} />
                </button>
              </div>

              {checklist.length === 0 && !showNewItem && (
                <p
                  className="text-xs text-sebastian-lightgray italic font-serif cursor-pointer hover:text-sebastian-gray transition-colors"
                  onClick={() => setShowNewItem(true)}
                >
                  項目なし — クリックして追加
                </p>
              )}

              <div className="space-y-1.5">
                {checklist.map(item => (
                  <div key={item.id} className="flex items-center gap-2 group">
                    <button
                      type="button"
                      onClick={() => toggleItem(item)}
                      className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                        item.checked
                          ? 'border-sebastian-gold/50 bg-sebastian-gold/10'
                          : 'border-sebastian-border hover:border-sebastian-gold/40'
                      }`}
                    >
                      {item.checked ? <Check size={10} className="text-sebastian-gold" /> : null}
                    </button>
                    <span className={`flex-1 text-sm font-serif leading-snug ${
                      item.checked ? 'line-through text-sebastian-lightgray' : 'text-sebastian-text'
                    }`}>
                      {item.text}
                    </span>
                    <button
                      type="button"
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
                  <button type="button" onClick={addItem} className="text-green-600 hover:text-green-700 transition-colors flex-shrink-0">
                    <Check size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowNewItem(false); setNewItemText(''); }}
                    className="text-sebastian-lightgray hover:text-sebastian-gray transition-colors flex-shrink-0"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* アクションボタン */}
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              className="flex-1 rounded-lg py-2 font-serif transition-colors"
              style={{ backgroundColor: '#131929', color: '#d4c9a8', border: '1px solid rgba(201,164,86,0.3)' }}
            >
              {mode === 'create' ? '追加する' : '保存する'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-sebastian-border/30 text-sebastian-gray rounded-lg py-2 font-serif hover:bg-sebastian-border/50 transition-colors"
            >
              キャンセル
            </button>
          </div>
        </form>
        </div>{/* /overflow-y-auto */}
      </div>
    </div>
  );
}
