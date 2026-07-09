import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { executeDb, selectDb } from '../lib/db';
import { getSetting, SETTING_KEYS } from '../lib/settings';
import { pushMemo, markEditing, clearEditing } from '../lib/supabase';
import { PageHeader } from '../components/ClassicUI';

export default function Memo() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [selectedDate, setSelectedDate] = useState(today);
  const [content, setContent] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'typing' | 'saving' | 'saved' | 'error'>('idle');
  const [reportExists, setReportExists] = useState(false);
  const [memoSyncFolder, setMemoSyncFolder] = useState('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef('');
  const selectedDateRef = useRef(selectedDate);

  const isToday = selectedDate === today;

  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  // 日付切替・アンマウント時に編集中フラグを掃除（残ると pull がその日付を恒久スキップする）
  useEffect(() => {
    return () => clearEditing('daily_memos', selectedDate);
  }, [selectedDate]);

  useEffect(() => {
    getSetting(SETTING_KEYS.MEMO_SYNC_FOLDER).then(val => {
      setMemoSyncFolder(val ?? '');
    });
  }, []);

  const goToPrevDay = () => {
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    setSelectedDate(format(d, 'yyyy-MM-dd'));
  };

  const goToNextDay = () => {
    if (isToday) return;
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    setSelectedDate(format(d, 'yyyy-MM-dd'));
  };

  const selectedDateLabel = format(new Date(selectedDate + 'T00:00:00'), 'M月d日（E）', { locale: ja });

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    setSaveStatus('idle');
    setContent('');
    contentRef.current = '';

    async function loadMemo() {
      try {
        const [rows, reportRows] = await Promise.all([
          selectDb<{ content: string }>(
            'SELECT content FROM daily_memos WHERE date = ?',
            [selectedDate]
          ),
          selectDb<{ id: number }>(
            'SELECT id FROM reports_daily WHERE date = ?',
            [selectedDate]
          ),
        ]);
        if (rows.length > 0) {
          setContent(rows[0].content);
          contentRef.current = rows[0].content;
          setSaveStatus('saved');
        } else {
          setSaveStatus('idle');
        }
        setReportExists(reportRows.length > 0);
      } catch (err) {
        console.error(err);
      }
    }
    loadMemo();
  }, [selectedDate]);

  // Quill連携: 1.5秒ごとに共有ファイルのmtimeを確認し、外部変更を取り込む
  useEffect(() => {
    if (!memoSyncFolder) return;

    let lastMtime = 0;

    const poll = async () => {
      const date = selectedDateRef.current;
      const filePath = `${memoSyncFolder}/${date}.md`.replace(/\\/g, '/');
      try {
        const mtime = await invoke<number | null>('get_file_mtime', { path: filePath });
        if (!mtime || mtime === lastMtime) return;
        lastMtime = mtime;
        const fileContent = await invoke<string>('read_text_file', { path: filePath });
        if (fileContent === contentRef.current) return;
        contentRef.current = fileContent;
        setContent(fileContent);
        setSaveStatus('saved');
        await executeDb(
          `INSERT INTO daily_memos (date, content) VALUES (?, ?)
           ON CONFLICT(date) DO UPDATE SET content=excluded.content, updated_at=CURRENT_TIMESTAMP`,
          [date, fileContent]
        );
      } catch {
        // ファイル未存在またはエラーは無視
      }
    };

    const interval = setInterval(poll, 1500);
    return () => clearInterval(interval);
  }, [memoSyncFolder]);

  const saveMemo = async (newContent: string) => {
    setSaveStatus('saving');
    try {
      await executeDb(
        `INSERT INTO daily_memos (date, content) VALUES (?, ?)
         ON CONFLICT(date) DO UPDATE SET content=excluded.content, updated_at=CURRENT_TIMESTAMP`,
        [selectedDate, newContent]
      );
      setSaveStatus('saved');
    } catch (err) {
      console.error(err);
      setSaveStatus('error');
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setContent(newContent);
    contentRef.current = newContent;
    setSaveStatus('typing');
    // 入力中はこの日付の行を pull の上書き対象から外す（未 push 本文の保護）
    markEditing('daily_memos', selectedDate);

    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(async () => {
      await saveMemo(newContent);
      pushMemo(selectedDate, newContent);
      clearEditing('daily_memos', selectedDate);
      if (memoSyncFolder) {
        const filePath = `${memoSyncFolder}/${selectedDate}.md`.replace(/\\/g, '/');
        invoke('write_text_file', { path: filePath, content: newContent }).catch(console.error);
      }
    }, 1000);
  };

  const statusText: Record<typeof saveStatus, string> = {
    idle: '',
    typing: '入力中...',
    saving: '保存中...',
    saved: '保存済',
    error: '保存失敗 — 再入力で再試行',
  };

  const statusColor: Record<typeof saveStatus, string> = {
    idle: 'text-sebastian-lightgray/50',
    typing: 'text-sebastian-lightgray',
    saving: 'text-sebastian-lightgray',
    saved: 'text-green-600',
    error: 'text-red-500',
  };

  const charCount = content.length;
  const memoUnorganized = isToday && charCount > 0 && !reportExists;

  return (
    <div className="h-full flex flex-col" style={{ height: 'calc(100vh - 6rem)' }}>
      <div className="flex items-start justify-between mb-2">
        <PageHeader label="MEMO" title="日々の記録" />
        <div className="text-right mt-1 shrink-0">
          <div className={`text-sm font-serif ${statusColor[saveStatus]}`}>{statusText[saveStatus]}</div>
          {charCount > 0 && (
            <div className="text-xs text-sebastian-lightgray/60 mt-0.5 font-serif">{charCount} 文字</div>
          )}
        </div>
      </div>

      {/* 日付ナビゲーション */}
      <div className="flex items-center gap-2 mb-4 -mt-4">
        <button
          onClick={goToPrevDay}
          className="p-1 rounded text-sebastian-gray hover:text-sebastian-navy hover:bg-sebastian-border/20 transition-colors"
        >
          <ChevronLeft size={18} />
        </button>
        <span className="text-lg font-serif text-sebastian-navy min-w-[9rem] text-center">
          {selectedDateLabel}
        </span>
        <button
          onClick={goToNextDay}
          disabled={isToday}
          className="p-1 rounded text-sebastian-gray hover:text-sebastian-navy hover:bg-sebastian-border/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronRight size={18} />
        </button>
        {!isToday && (
          <button
            onClick={() => setSelectedDate(today)}
            className="ml-1 text-xs font-serif text-sebastian-gold border border-sebastian-gold/30 rounded px-2 py-0.5 hover:bg-sebastian-gold/10 transition-colors"
          >
            今日に戻る
          </button>
        )}
      </div>

      <div className="relative flex-1 bg-white rounded-xl shadow-sm border border-sebastian-border p-4 min-h-0">
        <span className="absolute top-2.5 left-2.5 w-4 h-4 border-t border-l border-sebastian-gold/30 pointer-events-none rounded-tl-sm" />
        <span className="absolute top-2.5 right-2.5 w-4 h-4 border-t border-r border-sebastian-gold/30 pointer-events-none rounded-tr-sm" />
        <span className="absolute bottom-2.5 left-2.5 w-4 h-4 border-b border-l border-sebastian-gold/30 pointer-events-none rounded-bl-sm" />
        <span className="absolute bottom-2.5 right-2.5 w-4 h-4 border-b border-r border-sebastian-gold/30 pointer-events-none rounded-br-sm" />
        <textarea
          className="w-full h-full resize-none outline-none text-sebastian-text leading-relaxed bg-transparent text-sm font-serif"
          placeholder={
            isToday
              ? `業務の断片、思いついたことなどを自由に入力してください。\nセバスチャンが後で整理します。\n\n例:\n・〇〇さんからTeamsで問い合わせ → 対応済\n・△△の件、週末までに確認が必要\n・研修資料の差し替えを依頼された`
              : `${selectedDateLabel} のメモはありません`
          }
          value={content}
          onChange={handleChange}
        />
      </div>

      {memoUnorganized && (
        <div className="mt-2 flex items-center gap-2 text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 flex-shrink-0">
          <AlertCircle size={13} className="flex-shrink-0" />
          <span>このメモはまだ日報に反映されていません</span>
          <Link
            to="/reports/daily"
            className="ml-auto underline underline-offset-2 hover:text-amber-700 whitespace-nowrap"
          >
            日報を作成する →
          </Link>
        </div>
      )}
    </div>
  );
}
