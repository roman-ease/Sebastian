import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format, differenceInCalendarDays, addDays, isMonday } from 'date-fns';
import {
  ArrowLeft, Plus, Pencil, Circle, CheckCircle, Clock, Loader, CalendarOff,
  Sparkles, RefreshCw, AlertCircle,
} from 'lucide-react';
import { selectDb, executeDb } from '../lib/db';
import { logTaskAction } from '../lib/taskLogs';
import { pushProject, pushTask } from '../lib/supabase';
import { generateProjectTasks, type ProjectTaskCandidate } from '../lib/ai';
import { OrnateCard, CardHeading, PageHeader } from '../components/ClassicUI';
import { ProjectModal, type ProjectFormData, type ProjectStatus } from '../components/ProjectModal';
import { TaskModal, type TaskFormData, type TaskStatus } from '../components/TaskModal';
import { TaskPeekModal } from '../components/TaskPeekModal';
import { ProjectTaskSuggestPanel } from '../components/ProjectTaskSuggestPanel';
import { TargetBadge } from './Projects';
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_COLOR, PRIORITY_COLOR, PRIORITY_LABEL } from '../lib/constants';

interface Project {
  id: number;
  name: string;
  description: string | null;
  status: ProjectStatus;
  start_date: string | null;
  target_date: string | null;
}

interface ProjectTask {
  id: number;
  title: string;
  status: TaskStatus;
  priority: string;
  start_date: string | null;
  due_date: string | null;
  progress: number;
  checklist_total: number;
  checklist_done: number;
}

function StatusIcon({ status, size = 15 }: { status: TaskStatus; size?: number }) {
  switch (status) {
    case 'done':        return <CheckCircle size={size} className="text-green-600 flex-shrink-0" />;
    case 'in_progress': return <Loader size={size} className="text-blue-500 flex-shrink-0" />;
    case 'hold':        return <Clock size={size} className="text-orange-400 flex-shrink-0" />;
    default:            return <Circle size={size} className="text-gray-300 flex-shrink-0" />;
  }
}

// ─── WBS（ガント）の座標計算 ─────────────────────────────────────

const DAY0 = 'T00:00:00';
const LABEL_W = 200; // タスク名列の幅(px)

interface ChartGeometry {
  start: Date;
  totalDays: number;
  weekTicks: { leftPct: number; label: string }[];
  todayPct: number | null;
  targetPct: number | null;
}

function pctOf(date: Date, geo: { start: Date; totalDays: number }): number {
  return (differenceInCalendarDays(date, geo.start) / geo.totalDays) * 100;
}

function buildGeometry(project: Project, dated: ProjectTask[]): ChartGeometry | null {
  const dates: Date[] = [];
  const push = (s: string | null) => { if (s) dates.push(new Date(s + DAY0)); };
  push(project.start_date);
  push(project.target_date);
  dated.forEach(t => { push(t.start_date); push(t.due_date); });
  const today = new Date(format(new Date(), 'yyyy-MM-dd') + DAY0);
  dates.push(today);
  if (dates.length === 0) return null;

  let start = new Date(Math.min(...dates.map(d => d.getTime())));
  let end = new Date(Math.max(...dates.map(d => d.getTime())));
  start = addDays(start, -2);
  end = addDays(end, 3);
  // 最低2週間分は確保（短すぎると1日の幅が広すぎて間延びする）
  if (differenceInCalendarDays(end, start) < 14) end = addDays(start, 14);

  const totalDays = differenceInCalendarDays(end, start) + 1;
  const geo = { start, totalDays };

  const weekTicks: { leftPct: number; label: string }[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (isMonday(d)) {
      weekTicks.push({ leftPct: pctOf(d, geo), label: format(d, 'M/d') });
    }
  }

  // 今日線は「今日のマスの中央」に引く（日の頭に引くと今日1日分が線の右に落ちてズレて見える）
  const todayPct = today >= start && today <= end
    ? ((differenceInCalendarDays(today, start) + 0.5) / totalDays) * 100
    : null;
  const target = project.target_date ? new Date(project.target_date + DAY0) : null;
  // 期日線は「期日当日の終わり」に引く
  const targetPct = target && target >= start && target <= end
    ? pctOf(addDays(target, 1), geo)
    : null;

  return { ...geo, weekTicks, todayPct, targetPct };
}

/** ガント1行分のタイムライン背景（週罫線・今日線・期日線） */
function TimelineGrid({ geo }: { geo: ChartGeometry }) {
  return (
    <>
      {geo.weekTicks.map(t => (
        <div
          key={t.leftPct}
          className="absolute inset-y-0 w-px pointer-events-none"
          style={{ left: `${t.leftPct}%`, backgroundColor: 'rgba(201,164,86,0.12)' }}
        />
      ))}
      {geo.targetPct != null && (
        <div
          className="absolute inset-y-0 w-px pointer-events-none"
          style={{ left: `${geo.targetPct}%`, backgroundColor: 'rgba(201,164,86,0.55)' }}
        />
      )}
      {geo.todayPct != null && (
        <div
          className="absolute inset-y-0 w-px pointer-events-none"
          style={{ left: `${geo.todayPct}%`, backgroundColor: 'rgba(180,80,80,0.45)' }}
        />
      )}
    </>
  );
}

export default function ProjectDetail() {
  const { id } = useParams();
  const projectId = Number(id);
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [peekTaskId, setPeekTaskId] = useState<number | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiCandidates, setAiCandidates] = useState<ProjectTaskCandidate[] | null>(null);
  const [aiError, setAiError] = useState('');

  const loadAll = async () => {
    const [projRows, taskRows] = await Promise.all([
      selectDb<Project>(
        'SELECT id, name, description, status, start_date, target_date FROM projects WHERE id = ?',
        [projectId]
      ),
      selectDb<ProjectTask>(
        `SELECT id, title, status, priority, start_date, due_date, progress,
          (SELECT COUNT(*) FROM task_checklist WHERE task_id = tasks.id) as checklist_total,
          (SELECT COUNT(*) FROM task_checklist WHERE task_id = tasks.id AND checked = 1) as checklist_done
         FROM tasks WHERE project_id = ? AND archived = 0
         ORDER BY CASE WHEN start_date IS NULL AND due_date IS NULL THEN 1 ELSE 0 END,
                  COALESCE(start_date, due_date) ASC, due_date ASC, id ASC`,
        [projectId]
      ),
    ]);
    setProject(projRows[0] ?? null);
    setTasks(taskRows);
  };

  useEffect(() => {
    loadAll();
  }, [projectId]);

  const datedTasks = useMemo(() => tasks.filter(t => t.start_date || t.due_date), [tasks]);
  const undatedTasks = useMemo(() => tasks.filter(t => !t.start_date && !t.due_date), [tasks]);
  const geo = useMemo(
    () => (project ? buildGeometry(project, datedTasks) : null),
    [project, datedTasks]
  );

  const doneCount = tasks.filter(t => t.status === 'done').length;
  const pct = tasks.length > 0 ? Math.round(doneCount / tasks.length * 100) : 0;
  const avgProgress = tasks.length > 0
    ? Math.round(tasks.reduce((sum, t) => sum + (t.status === 'done' ? 100 : t.progress), 0) / tasks.length)
    : 0;

  const handleEditProject = async (data: ProjectFormData) => {
    if (!project) return;
    await executeDb(
      'UPDATE projects SET name=?, description=?, status=?, start_date=?, target_date=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
      [data.name, data.description || null, data.status, data.start_date || null, data.target_date || null, project.id]
    );
    pushProject(project.id);
    setShowEditModal(false);
    loadAll();
  };

  const handleCreateTask = async (data: TaskFormData) => {
    const result = await executeDb(
      'INSERT INTO tasks (title, description, notes, status, priority, start_date, due_date, category, progress, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [data.title, data.description || null, data.notes || null, data.status, data.priority, data.start_date || null, data.due_date || null, data.category || null, data.progress, data.project_id]
    );
    await logTaskAction({
      taskId: result.lastInsertId as number,
      actionType: 'create',
      afterJson: data,
      actorType: 'user',
    });
    pushTask(result.lastInsertId as number);
    setShowTaskModal(false);
    loadAll();
  };

  const handleGenerateTasks = async () => {
    if (!project) return;
    setAiBusy(true);
    setAiError('');
    setAiCandidates(null);
    try {
      const result = await generateProjectTasks(
        {
          name: project.name,
          description: project.description,
          start_date: project.start_date,
          target_date: project.target_date,
          existingTasks: tasks.map(t => ({
            title: t.title, status: t.status,
            start_date: t.start_date, due_date: t.due_date,
          })),
        },
        format(new Date(), 'yyyy-MM-dd')
      );
      setAiCandidates(result);
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  };

  if (!project) {
    return (
      <div className="space-y-6">
        <PageHeader label="PROJECT" title="プロジェクト" />
        <OrnateCard>
          <p className="text-center text-sebastian-lightgray py-12 text-sm italic font-serif">
            プロジェクトが見つかりません
          </p>
        </OrnateCard>
      </div>
    );
  }

  // バーが期日線を超えているか（完了済みは対象外）
  const isOverTarget = (t: ProjectTask): boolean => {
    if (!project.target_date || t.status === 'done') return false;
    const end = t.due_date ?? t.start_date;
    return !!end && end > project.target_date;
  };

  return (
    <div className="space-y-6">
      {/* ─── ヘッダー ─── */}
      <div className="flex items-start justify-between gap-6">
        <div className="flex-1 min-w-0">
          <button
            onClick={() => navigate('/projects')}
            className="flex items-center gap-1.5 text-xs text-sebastian-lightgray hover:text-sebastian-gray font-serif mb-2 transition-colors"
          >
            <ArrowLeft size={12} />
            プロジェクト一覧
          </button>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-serif text-sebastian-navy">{project.name}</h1>
            <span className={`text-xs px-1.5 py-0.5 rounded border ${PROJECT_STATUS_COLOR[project.status]}`}>
              {PROJECT_STATUS_LABEL[project.status]}
            </span>
            <button
              onClick={() => setShowEditModal(true)}
              className="p-1.5 text-sebastian-lightgray/60 hover:text-sebastian-navy hover:bg-sebastian-parchment rounded-lg transition-colors"
              title="プロジェクトを編集"
            >
              <Pencil size={14} />
            </button>
          </div>
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            {(project.start_date || project.target_date) && (
              <span className="text-sm text-sebastian-gray font-serif">
                {project.start_date ? format(new Date(project.start_date + DAY0), 'yyyy/M/d') : '—'}
                {' 〜 '}
                {project.target_date ? format(new Date(project.target_date + DAY0), 'yyyy/M/d') : '—'}
              </span>
            )}
            <TargetBadge targetDate={project.target_date} status={project.status} />
          </div>
          {project.description && (
            <p className="text-sm text-sebastian-gray leading-relaxed font-serif whitespace-pre-wrap mt-2 max-w-2xl">
              {project.description}
            </p>
          )}
        </div>
        <div className="mt-1 flex flex-col items-end gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={handleGenerateTasks}
              disabled={aiBusy}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-serif transition-colors disabled:opacity-60"
              style={{ backgroundColor: 'transparent', color: '#8a7340', border: '1px solid rgba(201,164,86,0.45)' }}
              title="プロジェクト概要と登録済みタスクから、不足しているタスクを AI が提案します"
            >
              {aiBusy ? <RefreshCw size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {aiBusy ? '考えております...' : 'AI タスク生成'}
            </button>
            <button
              onClick={() => setShowTaskModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-serif transition-colors"
              style={{ backgroundColor: '#131929', color: '#d4c9a8', border: '1px solid rgba(201,164,86,0.3)' }}
            >
              <Plus size={15} />
              タスクを追加
            </button>
          </div>

          {/* 概況プレート（真鍮の銘板イメージ） */}
          {tasks.length > 0 && (
            <div
              className="rounded-lg px-6 py-4 self-stretch"
              style={{ border: '1px solid rgba(201,164,86,0.35)', backgroundColor: 'rgba(201,164,86,0.06)' }}
            >
              <p className="text-xs font-serif tracking-widest text-sebastian-gold-dark mb-3">◆ 概況</p>
              <dl className="space-y-2.5">
                {project.target_date && project.status !== 'done' && project.status !== 'archived' && (() => {
                  const days = differenceInCalendarDays(new Date(project.target_date + DAY0), new Date());
                  return (
                    <div className="flex items-baseline justify-between gap-10 text-sm font-serif">
                      <dt className="text-sebastian-lightgray">残り日数</dt>
                      <dd className={`text-base ${days <= 0 ? 'text-red-500' : 'text-sebastian-navy'}`}>
                        {days < 0 ? `超過 ${-days} 日` : days === 0 ? '本日期日' : `${days} 日`}
                      </dd>
                    </div>
                  );
                })()}
                <div className="flex items-baseline justify-between gap-10 text-sm font-serif">
                  <dt className="text-sebastian-lightgray">タスク</dt>
                  <dd className="text-base text-sebastian-navy">{doneCount} / {tasks.length} 完了</dd>
                </div>
                <div className="flex items-baseline justify-between gap-10 text-sm font-serif">
                  <dt className="text-sebastian-lightgray">進捗率平均</dt>
                  <dd className="text-base text-sebastian-navy">{avgProgress}%</dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      </div>

      {/* ─── AI タスク生成: 候補の承認パネル ─── */}
      {(aiCandidates != null || aiError) && (
        <OrnateCard>
          <div className="px-5 py-4">
            <CardHeading>AI タスク生成</CardHeading>
            {aiError ? (
              <div className="flex items-start gap-2 text-sm text-red-700 py-1">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <div className="flex-1 whitespace-pre-wrap font-serif">{aiError}</div>
                <button onClick={() => setAiError('')} className="text-xs text-sebastian-lightgray hover:text-sebastian-navy font-serif shrink-0">閉じる</button>
              </div>
            ) : (
              <ProjectTaskSuggestPanel
                projectId={projectId}
                candidates={aiCandidates!}
                onApplied={() => { setAiCandidates(null); loadAll(); }}
              />
            )}
          </div>
        </OrnateCard>
      )}

      {/* ─── 進捗サマリー ─── */}
      <OrnateCard>
        <div className="px-5 py-4">
          <CardHeading>進捗</CardHeading>
          <div className="flex items-center gap-4">
            <div className="flex-1 relative h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(201,164,86,0.15)' }}>
              <div
                className="absolute left-0 top-0 h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, backgroundColor: 'rgba(201,164,86,0.7)' }}
              />
            </div>
            <span className="text-xl font-serif text-sebastian-navy shrink-0">{pct}%</span>
          </div>
          <div className="flex items-center gap-4 mt-2">
            <span className="text-xs text-sebastian-lightgray font-serif">
              完了 {doneCount} / 全 {tasks.length} 件
            </span>
            <span className="text-xs text-sebastian-lightgray/70 font-serif">
              タスク進捗率平均 {avgProgress}%
            </span>
          </div>
        </div>
      </OrnateCard>

      {/* ─── WBS（ガント） ─── */}
      <OrnateCard>
        <div className="px-5 py-4">
          <CardHeading>WBS</CardHeading>
          {datedTasks.length === 0 || !geo ? (
            <p className="text-sm text-sebastian-lightgray italic font-serif py-4 text-center">
              日付（開始日・終了日）を持つタスクがここに表示されます
            </p>
          ) : (
            <div className="overflow-x-auto">
              <div style={{ minWidth: 640 }}>
                {/* 目盛りヘッダー */}
                <div className="flex">
                  <div style={{ width: LABEL_W }} className="shrink-0" />
                  {/* overflow-hidden: 右端付近のラベルがはみ出して横スクロールを生まないように */}
                  {/* border-l(transparent): タスク行側の border-l と座標原点を揃える（1px の折れ防止） */}
                  <div className="relative flex-1 h-7 overflow-hidden border-l border-transparent">
                    <TimelineGrid geo={geo} />
                    {geo.weekTicks.filter(t => t.leftPct <= 94).map(t => (
                      <span
                        key={t.leftPct}
                        className="absolute top-1 text-[10px] text-sebastian-lightgray/70 font-serif"
                        style={{ left: `calc(${t.leftPct}% + 3px)` }}
                      >
                        {t.label}
                      </span>
                    ))}
                    {geo.targetPct != null && (
                      <span
                        className="absolute top-1 text-[10px] font-serif text-sebastian-gold-dark"
                        style={geo.targetPct > 92
                          ? { left: `${geo.targetPct}%`, transform: 'translateX(calc(-100% - 5px))' }
                          : { left: `calc(${geo.targetPct}% + 3px)` }}
                      >
                        期日
                      </span>
                    )}
                    {geo.todayPct != null && (
                      <span
                        className="absolute bottom-0 text-[10px] font-serif"
                        style={geo.todayPct > 92
                          ? { left: `${geo.todayPct}%`, transform: 'translateX(calc(-100% - 5px))', color: 'rgba(180,80,80,0.8)' }
                          : { left: `calc(${geo.todayPct}% + 3px)`, color: 'rgba(180,80,80,0.8)' }}
                      >
                        今日
                      </span>
                    )}
                  </div>
                </div>

                {/* タスク行 */}
                {datedTasks.map(task => {
                  const barStart = new Date((task.start_date ?? task.due_date!) + DAY0);
                  const barEnd = new Date((task.due_date ?? task.start_date!) + DAY0);
                  const leftPct = pctOf(barStart, geo);
                  const widthPct = Math.max(
                    (differenceInCalendarDays(barEnd, barStart) + 1) / geo.totalDays * 100,
                    0.8
                  );
                  const over = isOverTarget(task);
                  const done = task.status === 'done';
                  return (
                    <div
                      key={task.id}
                      className="flex items-center group cursor-pointer hover:bg-sebastian-parchment/30 rounded transition-colors"
                      onClick={() => setPeekTaskId(task.id)}
                    >
                      {/* タスク名列 */}
                      <div style={{ width: LABEL_W }} className="shrink-0 flex items-center gap-1.5 py-1.5 pr-3">
                        <StatusIcon status={task.status} size={13} />
                        <span
                          className={`text-xs font-serif truncate ${done ? 'line-through text-sebastian-lightgray' : 'text-sebastian-text group-hover:text-sebastian-navy'}`}
                          title={task.title}
                        >
                          {task.title}
                        </span>
                      </div>
                      {/* タイムライン */}
                      <div className="relative flex-1 h-8 border-l border-sebastian-border/20">
                        <TimelineGrid geo={geo} />
                        <div
                          className="absolute top-1/2 -translate-y-1/2 h-4 rounded-full overflow-hidden"
                          style={{
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
                            minWidth: 12,
                            backgroundColor: over ? 'rgba(180,80,80,0.18)' : 'rgba(201,164,86,0.22)',
                            border: over ? '1px solid rgba(180,80,80,0.5)' : '1px solid rgba(201,164,86,0.35)',
                            opacity: done ? 0.45 : 1,
                          }}
                          title={`${task.start_date ?? ''} 〜 ${task.due_date ?? ''}（進捗 ${task.progress}%）`}
                        >
                          <div
                            className="absolute left-0 top-0 h-full"
                            style={{
                              width: `${done ? 100 : task.progress}%`,
                              backgroundColor: over ? 'rgba(180,80,80,0.55)' : 'rgba(201,164,86,0.65)',
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {geo && datedTasks.some(isOverTarget) && (
            <p className="text-xs font-serif mt-3 pt-3 border-t border-sebastian-border/30" style={{ color: 'rgba(170,70,70,0.9)' }}>
              ◆ 期日線を越えるタスクがございます。日程の見直しをご検討ください。
            </p>
          )}
        </div>
      </OrnateCard>

      {/* ─── 日程未定 ─── */}
      {undatedTasks.length > 0 && (
        <OrnateCard>
          <div className="px-5 py-4">
            <CardHeading>日程未定</CardHeading>
            <ul className="divide-y divide-sebastian-border/30">
              {undatedTasks.map(task => (
                <li
                  key={task.id}
                  className="flex items-center gap-2.5 py-2 cursor-pointer hover:bg-sebastian-parchment/30 rounded transition-colors group"
                  onClick={() => setPeekTaskId(task.id)}
                >
                  <CalendarOff size={13} className="text-sebastian-lightgray/50 shrink-0" />
                  <StatusIcon status={task.status} size={14} />
                  <span className={`flex-1 text-sm font-serif truncate ${task.status === 'done' ? 'line-through text-sebastian-lightgray' : 'text-sebastian-text group-hover:text-sebastian-navy'}`}>
                    {task.title}
                  </span>
                  {task.checklist_total > 0 && (
                    <span className="text-xs text-sebastian-lightgray/70 font-serif shrink-0">
                      ☑ {task.checklist_done}/{task.checklist_total}
                    </span>
                  )}
                  {task.priority !== 'none' && (
                    <span className={`text-xs px-1.5 py-0.5 rounded border shrink-0 ${PRIORITY_COLOR[task.priority]}`}>
                      {PRIORITY_LABEL[task.priority]}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs text-sebastian-lightgray/60 italic font-serif mt-2">
              開始日・終了日を設定すると WBS に表示されます
            </p>
          </div>
        </OrnateCard>
      )}

      {/* ─── モーダル ─── */}
      {showEditModal && (
        <ProjectModal
          mode="edit"
          initialData={{
            name: project.name,
            description: project.description ?? '',
            status: project.status,
            start_date: project.start_date ?? '',
            target_date: project.target_date ?? '',
          }}
          onSave={handleEditProject}
          onClose={() => setShowEditModal(false)}
        />
      )}
      {showTaskModal && (
        <TaskModal
          mode="create"
          initialData={{ project_id: projectId }}
          onSave={handleCreateTask}
          onClose={() => setShowTaskModal(false)}
        />
      )}
      {peekTaskId != null && (
        <TaskPeekModal
          taskId={peekTaskId}
          onClose={() => { setPeekTaskId(null); loadAll(); }}
        />
      )}
    </div>
  );
}
