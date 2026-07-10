import { useState } from 'react';
import { Sparkles, Plus, RefreshCw, CheckCircle, AlertCircle, X } from 'lucide-react';
import { executeDb } from '../lib/db';
import { logTaskAction } from '../lib/taskLogs';
import { pushTask } from '../lib/supabase';
import { type ProjectTaskCandidate } from '../lib/ai';
import { PRIORITY_COLOR, PRIORITY_LABEL } from '../lib/constants';

interface Props {
  projectId: number;
  candidates: ProjectTaskCandidate[];
  onApplied: () => void; // 適用完了 or 閉じる（親でパネルを畳み、一覧を再読込する）
}

export function ProjectTaskSuggestPanel({ projectId, candidates, onApplied }: Props) {
  const [checked, setChecked] = useState<Set<number>>(() => new Set(candidates.map((_, i) => i)));
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const toggleCheck = (i: number) => {
    setChecked(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const handleApply = async () => {
    setApplying(true);
    setErrorMsg('');
    try {
      for (let i = 0; i < candidates.length; i++) {
        if (!checked.has(i)) continue;
        const c = candidates[i];
        const result = await executeDb(
          'INSERT INTO tasks (title, description, status, priority, start_date, due_date, progress, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [c.title, c.description || null, 'todo', c.priority, c.start_date, c.due_date, 0, projectId]
        );
        await logTaskAction({
          taskId: result.lastInsertId as number,
          actionType: 'create',
          afterJson: { ...c, project_id: projectId },
          actorType: 'ai',
          sourceType: 'project',
          sourceId: String(projectId),
          note: c.reason,
        });
        pushTask(result.lastInsertId as number);
      }
      setApplied(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(`登録に失敗しました: ${msg}`);
    } finally {
      setApplying(false);
    }
  };

  if (candidates.length === 0) {
    return (
      <div className="flex items-center justify-between text-sm text-sebastian-lightgray font-serif italic py-2">
        追加すべきタスク案は見つかりませんでした。計画は十分に整っているようです。
        <button onClick={onApplied} className="p-1 text-sebastian-lightgray/60 hover:text-sebastian-navy">
          <X size={15} />
        </button>
      </div>
    );
  }

  if (applied) {
    return (
      <div className="flex items-center justify-between py-2">
        <span className="flex items-center gap-2 text-sm text-green-700 font-serif">
          <CheckCircle size={15} />
          {checked.size} 件のタスクをプロジェクトに追加しました
        </span>
        <button
          onClick={onApplied}
          className="px-3 py-1 text-xs font-serif rounded-lg border border-sebastian-border/50 text-sebastian-gray hover:bg-sebastian-parchment transition-colors"
        >
          閉じる
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-serif text-sebastian-navy">
          <Sparkles size={15} />
          タスク案をご用意いたしました（{candidates.length}件）
        </div>
        <div className="flex gap-2 text-xs text-sebastian-lightgray font-serif">
          <button onClick={() => setChecked(new Set(candidates.map((_, i) => i)))} className="hover:text-sebastian-navy">すべて選択</button>
          <span>/</span>
          <button onClick={() => setChecked(new Set())} className="hover:text-sebastian-navy">すべて解除</button>
        </div>
      </div>

      <ul className="divide-y divide-sebastian-border/30">
        {candidates.map((c, i) => (
          <li key={i} className={`flex items-start gap-3 py-2.5 transition-opacity ${checked.has(i) ? '' : 'opacity-45'}`}>
            <input
              type="checkbox"
              checked={checked.has(i)}
              onChange={() => toggleCheck(i)}
              className="w-4 h-4 mt-0.5 accent-sebastian-navy shrink-0"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-serif text-sebastian-text">{c.title}</span>
                {c.priority !== 'none' && (
                  <span className={`text-xs px-1.5 py-0.5 rounded border shrink-0 ${PRIORITY_COLOR[c.priority]}`}>
                    {PRIORITY_LABEL[c.priority]}
                  </span>
                )}
                {(c.start_date || c.due_date) && (
                  <span className="text-xs text-sebastian-lightgray font-serif shrink-0">
                    {c.start_date ?? '—'} 〜 {c.due_date ?? '—'}
                  </span>
                )}
              </div>
              {c.description && (
                <p className="text-xs text-sebastian-gray font-serif mt-0.5">{c.description}</p>
              )}
              {c.reason && (
                <p className="text-xs text-sebastian-lightgray/70 font-serif italic mt-0.5">◆ {c.reason}</p>
              )}
            </div>
          </li>
        ))}
      </ul>

      {errorMsg && (
        <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg p-3">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          {errorMsg}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={handleApply}
          disabled={applying || checked.size === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-serif transition-colors disabled:opacity-50"
          style={{ backgroundColor: '#131929', color: '#d4c9a8', border: '1px solid rgba(201,164,86,0.3)' }}
        >
          {applying
            ? <><RefreshCw size={14} className="animate-spin" />登録中...</>
            : <><Plus size={14} />{checked.size} 件をタスクに追加</>
          }
        </button>
        <button
          onClick={onApplied}
          disabled={applying}
          className="px-4 py-2 text-sm font-serif rounded-lg border border-sebastian-border/50 text-sebastian-gray hover:bg-sebastian-parchment transition-colors disabled:opacity-50"
        >
          スキップ
        </button>
        <span className="text-xs text-sebastian-lightgray/60 font-serif">AI 提案は変更履歴に記録されます</span>
      </div>
    </div>
  );
}
