import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, differenceInCalendarDays } from 'date-fns';
import { Plus, Pencil, Trash2, AlertCircle, ChevronDown, ChevronUp, Archive, FolderOpen } from 'lucide-react';
import { selectDb, executeDb } from '../lib/db';
import { pushProject, pushProjectDelete, pushTask } from '../lib/supabase';
import { ProjectModal, type ProjectFormData, type ProjectStatus } from '../components/ProjectModal';
import { OrnateCard, PageHeader } from '../components/ClassicUI';
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_COLOR } from '../lib/constants';

export interface ProjectRow {
  id: number;
  name: string;
  description: string | null;
  status: ProjectStatus;
  start_date: string | null;
  target_date: string | null;
  task_total: number;
  task_done: number;
  created_at: string;
  updated_at: string;
}

/** 期日までの残り日数表示（超過は警告色） */
export function TargetBadge({ targetDate, status }: { targetDate: string | null; status: string }) {
  if (!targetDate || status === 'done' || status === 'archived') return null;
  const days = differenceInCalendarDays(new Date(targetDate + 'T00:00:00'), new Date());
  if (days < 0) {
    return <span className="text-xs font-serif text-red-500">期日超過 {-days} 日</span>;
  }
  if (days === 0) {
    return <span className="text-xs font-serif text-red-500">本日期日</span>;
  }
  return <span className="text-xs font-serif text-sebastian-lightgray/80">残り {days} 日</span>;
}

export default function Projects() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingProject, setEditingProject] = useState<ProjectRow | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [showFinished, setShowFinished] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const loadProjects = async () => {
    const rows = await selectDb<ProjectRow>(
      `SELECT projects.*,
        (SELECT COUNT(*) FROM tasks WHERE project_id = projects.id AND archived = 0) as task_total,
        (SELECT COUNT(*) FROM tasks WHERE project_id = projects.id AND archived = 0 AND status = 'done') as task_done
       FROM projects
       ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'hold' THEN 1 WHEN 'done' THEN 2 ELSE 3 END,
                CASE WHEN target_date IS NULL THEN 1 ELSE 0 END, target_date ASC, created_at DESC`
    );
    setProjects(rows);
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const handleCreate = async (data: ProjectFormData) => {
    setErrorMsg('');
    try {
      const result = await executeDb(
        'INSERT INTO projects (name, description, status, start_date, target_date) VALUES (?, ?, ?, ?, ?)',
        [data.name, data.description || null, data.status, data.start_date || null, data.target_date || null]
      );
      pushProject(result.lastInsertId as number);
      setModalMode(null);
      loadProjects();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(`プロジェクトの追加に失敗しました: ${msg}`);
    }
  };

  const handleEdit = async (data: ProjectFormData) => {
    if (!editingProject) return;
    setErrorMsg('');
    try {
      await executeDb(
        'UPDATE projects SET name=?, description=?, status=?, start_date=?, target_date=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
        [data.name, data.description || null, data.status, data.start_date || null, data.target_date || null, editingProject.id]
      );
      pushProject(editingProject.id);
      setModalMode(null);
      setEditingProject(null);
      loadProjects();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(`プロジェクトの更新に失敗しました: ${msg}`);
    }
  };

  const handleDelete = async (project: ProjectRow) => {
    setErrorMsg('');
    try {
      const syncRows = await selectDb<{ sync_id: string | null }>(
        'SELECT sync_id FROM projects WHERE id=?', [project.id]
      );
      const syncId = syncRows[0]?.sync_id;
      // 所属タスクは削除せず「未割当」に戻す（タスクの中身は守る）
      const affected = await selectDb<{ id: number }>(
        'SELECT id FROM tasks WHERE project_id=?', [project.id]
      );
      await executeDb(
        'UPDATE tasks SET project_id=NULL, updated_at=CURRENT_TIMESTAMP WHERE project_id=?',
        [project.id]
      );
      await executeDb('DELETE FROM projects WHERE id=?', [project.id]);
      if (syncId) pushProjectDelete(syncId);
      for (const t of affected) pushTask(t.id);
      setDeletingId(null);
      loadProjects();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(`プロジェクトの削除に失敗しました: ${msg}`);
      setDeletingId(null);
    }
  };

  const openEdit = (project: ProjectRow) => {
    setEditingProject(project);
    setModalMode('edit');
  };

  const ongoing = projects.filter(p => p.status === 'active' || p.status === 'hold');
  const finished = projects.filter(p => p.status === 'done' || p.status === 'archived');

  const renderCard = (project: ProjectRow) => {
    const pct = project.task_total > 0 ? Math.round(project.task_done / project.task_total * 100) : 0;
    return (
      <OrnateCard key={project.id} className="group cursor-pointer hover:shadow-md transition-shadow">
        <div className="px-5 py-4" onClick={() => navigate(`/projects/${project.id}`)}>
          {/* 1行目: 名前 + ステータス + 操作 */}
          <div className="flex items-center gap-2 pt-1">
            <h3 className="text-base font-serif text-sebastian-navy leading-snug flex-1 min-w-0 truncate">
              {project.name}
            </h3>
            <span className={`text-xs px-1.5 py-0.5 rounded border shrink-0 ${PROJECT_STATUS_COLOR[project.status]}`}>
              {PROJECT_STATUS_LABEL[project.status]}
            </span>
            {deletingId === project.id ? (
              <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                <span className="text-xs text-gray-500">削除しますか？</span>
                <button
                  onClick={() => handleDelete(project)}
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
              <div
                className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={e => e.stopPropagation()}
              >
                <button
                  onClick={() => openEdit(project)}
                  className="p-1.5 text-sebastian-lightgray/60 hover:text-sebastian-navy hover:bg-sebastian-parchment rounded-lg transition-colors"
                  title="編集"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => setDeletingId(project.id)}
                  className="p-1.5 text-sebastian-lightgray/60 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  title="削除（タスクは未割当に戻る）"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </div>

          {/* 2行目: 期間・残り日数 */}
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {(project.start_date || project.target_date) && (
              <span className="text-xs text-sebastian-lightgray/80 font-serif">
                {project.start_date ? format(new Date(project.start_date + 'T00:00:00'), 'yyyy/M/d') : '—'}
                {' 〜 '}
                {project.target_date ? format(new Date(project.target_date + 'T00:00:00'), 'yyyy/M/d') : '—'}
              </span>
            )}
            <TargetBadge targetDate={project.target_date} status={project.status} />
            {project.description && (
              <span className="text-xs text-sebastian-lightgray/60 truncate max-w-[320px] font-serif">
                {project.description}
              </span>
            )}
          </div>

          {/* 3行目: 進捗バー */}
          <div className="flex items-center gap-3 mt-3">
            <div className="flex-1 relative h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(201,164,86,0.15)' }}>
              <div
                className="absolute left-0 top-0 h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, backgroundColor: 'rgba(201,164,86,0.7)' }}
              />
            </div>
            <span className="text-sm font-serif text-sebastian-gray shrink-0">{pct}%</span>
            <span className="text-xs text-sebastian-lightgray/70 font-serif shrink-0">
              {project.task_done}/{project.task_total} 件
            </span>
          </div>
        </div>
      </OrnateCard>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <PageHeader label="PROJECTS" title="プロジェクト" />
        <button
          onClick={() => { setEditingProject(null); setModalMode('create'); }}
          className="mt-1 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-serif transition-colors shrink-0"
          style={{ backgroundColor: '#131929', color: '#d4c9a8', border: '1px solid rgba(201,164,86,0.3)' }}
        >
          <Plus size={15} />
          プロジェクトを追加
        </button>
      </div>

      {errorMsg && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
          <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg('')} className="ml-auto text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* 進行中・保留 */}
      {ongoing.length === 0 ? (
        <OrnateCard>
          <div className="text-center text-sebastian-lightgray py-12 text-sm italic font-serif">
            <FolderOpen size={24} className="mx-auto mb-3 opacity-40" />
            進行中のプロジェクトはありません
          </div>
        </OrnateCard>
      ) : (
        <div className="space-y-3">
          {ongoing.map(renderCard)}
        </div>
      )}

      {/* 完了・アーカイブ */}
      {finished.length > 0 && (
        <div>
          <button
            onClick={() => setShowFinished(v => !v)}
            className="flex items-center gap-2 text-sm text-sebastian-lightgray hover:text-sebastian-gray transition-colors w-full py-1 font-serif"
          >
            {showFinished ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            <Archive size={14} />
            完了・アーカイブ済み（{finished.length}件）
          </button>
          {showFinished && (
            <div className="mt-3 space-y-3">
              {finished.map(renderCard)}
            </div>
          )}
        </div>
      )}

      {/* モーダル */}
      {modalMode === 'create' && (
        <ProjectModal
          mode="create"
          onSave={handleCreate}
          onClose={() => setModalMode(null)}
        />
      )}
      {modalMode === 'edit' && editingProject && (
        <ProjectModal
          mode="edit"
          initialData={{
            name: editingProject.name,
            description: editingProject.description ?? '',
            status: editingProject.status,
            start_date: editingProject.start_date ?? '',
            target_date: editingProject.target_date ?? '',
          }}
          onSave={handleEdit}
          onClose={() => { setModalMode(null); setEditingProject(null); }}
        />
      )}
    </div>
  );
}
