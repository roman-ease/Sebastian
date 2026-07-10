import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';

export type ProjectStatus = 'active' | 'done' | 'hold' | 'archived';

export interface ProjectFormData {
  name: string;
  description: string;
  status: ProjectStatus;
  start_date: string;
  target_date: string;
}

interface Props {
  initialData?: Partial<ProjectFormData>;
  onSave: (data: ProjectFormData) => void;
  onClose: () => void;
  mode: 'create' | 'edit';
}

export function ProjectModal({ initialData, onSave, onClose, mode }: Props) {
  const [form, setForm] = useState<ProjectFormData>({
    name: initialData?.name ?? '',
    description: initialData?.description ?? '',
    status: initialData?.status ?? 'active',
    start_date: initialData?.start_date ?? '',
    target_date: initialData?.target_date ?? '',
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSave(form);
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="relative rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col"
        style={{ backgroundColor: '#faf7f0', border: '1px solid #d5c9a8' }}
        onClick={e => e.stopPropagation()}
      >
        <span className="absolute top-2.5 left-2.5 w-4 h-4 border-t border-l border-sebastian-gold/30 pointer-events-none rounded-tl-sm z-10" />
        <span className="absolute top-2.5 right-2.5 w-4 h-4 border-t border-r border-sebastian-gold/30 pointer-events-none rounded-tr-sm z-10" />
        <span className="absolute bottom-2.5 left-2.5 w-4 h-4 border-b border-l border-sebastian-gold/30 pointer-events-none rounded-bl-sm z-10" />
        <span className="absolute bottom-2.5 right-2.5 w-4 h-4 border-b border-r border-sebastian-gold/30 pointer-events-none rounded-br-sm z-10" />

        <div className="flex items-center justify-between px-6 pt-6 pb-4 flex-shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-serif text-sebastian-navy">
              {mode === 'create' ? 'プロジェクトを追加' : 'プロジェクトを編集'}
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

        <div className="overflow-y-auto flex-1 px-6 pb-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 名前 */}
            <div>
              <label className="block text-sm text-sebastian-gray font-serif mb-1">
                プロジェクト名 <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                required
                autoFocus
                className="w-full bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 outline-none focus:border-sebastian-gold/50 transition-colors font-serif text-sebastian-text"
                placeholder="例: ファイルサーバ更改"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>

            {/* 概要 */}
            <div>
              <label className="block text-sm text-sebastian-gray font-serif mb-1">概要</label>
              <textarea
                rows={3}
                className="w-full bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 outline-none focus:border-sebastian-gold/50 resize-none transition-colors font-serif text-sebastian-text"
                placeholder="目的・ゴール・スコープなど"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>

            {/* ステータス */}
            <div>
              <label className="block text-sm text-sebastian-gray font-serif mb-1">ステータス</label>
              <select
                className="w-full bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 outline-none focus:border-sebastian-gold/50 transition-colors font-serif text-sebastian-text"
                value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value as ProjectStatus }))}
              >
                <option value="active">進行中</option>
                <option value="hold">保留</option>
                <option value="done">完了</option>
                <option value="archived">アーカイブ</option>
              </select>
            </div>

            {/* 開始日・期日 */}
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
                <label className="block text-sm text-sebastian-gray font-serif mb-1">期日</label>
                <input
                  type="date"
                  className="w-full bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 outline-none focus:border-sebastian-gold/50 transition-colors font-serif text-sebastian-text"
                  value={form.target_date}
                  onChange={e => setForm(f => ({ ...f, target_date: e.target.value }))}
                />
              </div>
            </div>

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
        </div>
      </div>
    </div>
  );
}
