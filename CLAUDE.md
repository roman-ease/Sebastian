# Sebastian — プロジェクトコンテキスト

親ディレクトリの `../CLAUDE.md`（Sebastian Series 共通コンテキスト）も参照すること。

---

## アプリ概要

AI タスクマネジメントツール。「執事がご主人の代わりに仕事をこなす」受動的サポーター型。
ユーザーが日中に雑なメモを書き連ねるだけで、AI が自動的に日報生成・タスク抽出・週報まとめを引き受ける。

**機能フロー:**
1. **メモ欄（Memo ページ）** — ユーザーが一日中、自由にメモを書き連ねる
2. **「日報を生成」ボタン** — AI がメモ＋タスクログを読み取り、Markdown 形式の日報を自動生成・ファイル保存
3. **「タスクを抽出する」ボタン** — AI が日報からタスク候補を自動識別し、承認 UI でカード化
4. **タスクマネージャー（Tasks ページ）** — ステータス・優先度・期日・カテゴリ・ピン留め・アーカイブで管理
5. **ダッシュボード** — 今日のタスク・高優先・ピン留め・カテゴリ別進捗を一覧表示
6. **週次ビュー / 週報** — ウィークリーカレンダー + AI による週次サマリー自動生成
7. **朝のブリーフィング** — 起動時に当日の予定・未完タスクを執事口調で通知するモーダル

---

## 技術スタック

| 技術 | バージョン | 役割 |
|------|-----------|------|
| Tauri | v2 | デスクトップアプリ基盤（Rust バックエンド + WebView フロントエンド） |
| React | 19 | UI フレームワーク |
| TypeScript | 5.8 | 型安全性 |
| Vite | 7 | ビルドツール |
| Tailwind CSS | v4 | スタイリング（`@theme` ブロックでカスタム変数定義） |
| SQLite | — | ローカル DB（`@tauri-apps/plugin-sql` 経由、`sebastian.db`） |
| react-router-dom | v7 | ページルーティング |
| date-fns | v4 | 日付処理（日本語ロケール対応） |
| lucide-react | 最新 | アイコン |

---

## 主要ファイル

```
src/
  index.css                          — Tailwind @theme + ライト/ダーク/セピア テーマ CSS 変数定義
  components/
    ClassicUI.tsx                    — OrnateCard / CardHeading / PageHeader（全ページ必須コンポーネント）
    layout/
      MainLayout.tsx                 — アプリ全体のレイアウトラッパー
      Sidebar.tsx                    — サイドバー（執事イラスト・ナビ・テーマ切り替え）
    TaskModal.tsx                    — タスク作成・編集モーダル
    TaskCandidatesPanel.tsx          — AI タスク抽出結果の承認 UI
    MorningBriefingModal.tsx         — 朝のブリーフィングモーダル
    TaskPeekModal.tsx                — タスク詳細ポップアップ
  pages/
    Dashboard.tsx                    — 今日のタスク・高優先・ピン留め・カテゴリ集計
    Tasks.tsx                        — フィルタ・ソート・アーカイブ付きタスク一覧
    Memo.tsx                         — 1日1ページのメモ欄（日報生成・タスク抽出ボタン）
    DailyReport.tsx                  — 生成済み日報の表示・編集
    WeeklyReport.tsx                 — 週次サマリー自動生成・閲覧
    WeeklyCalendar.tsx               — 週単位のタスク配置ビュー
    Settings.tsx                     — AI プロバイダー・テーマ・自動起動・同期等の設定
  lib/
    ai.ts                            — AI 呼び出しレイヤー（Gemini / Ollama / 無効の振り分け）
    db.ts                            — SQLite アクセス（selectDb / executeDb）+ デモモード対応
    settings.ts                      — 設定の読み書き（getSetting / setSetting）
    taskLogs.ts                      — タスク変更履歴のログ記録
    sync.ts                          — 外部フォルダへの同期処理
    demoMode.ts                      — デモモード管理
    constants.ts                     — ステータス・優先度ラベル等の定数
public/
  sebastian-butler.png               — サイドバー下部の執事イラスト（セピアトーン PNG）
```

---

## UI デザイン原則（重要）

**新しいページ・モーダルを作るときは必ず `ClassicUI.tsx` のコンポーネントを使う。**
素の `div` や `h1` を直接使うとクラシカル書斎テイストが崩れる。

| 用途 | 使うコンポーネント |
|------|----------------|
| カード（角に金の装飾線が入る） | `<OrnateCard>` |
| セクション見出し（◆ 装飾線付き） | `<CardHeading>` |
| ページ上部ヘッダー | `<PageHeader label="..." title="..." />` |
| 確定系ボタン | インラインスタイル: ダークネイビー背景 + ゴールドボーダー |

**カラーはハードコードしない。** Tailwind クラス `text-sebastian-*` / `bg-sebastian-*`、または CSS 変数 `var(--sidebar-*)` / `var(--color-sebastian-*)` を使う。

---

## テーマ設計

| テーマ名（設定値） | Quill 相当 | サイドバー色 | 本文背景色 |
|-----------------|-----------|------------|----------|
| `light` | Default | `#1e2e4a` Oxford Navy | `#ece6d4` Parchment |
| `dark` | Dark | `#0b1628` Deep Navy | `#071224` Midnight Navy |
| `sepia` | Sepia | `#2a1a0e` Walnut Dark | `#cbb98a` Tan |

---

## AI プロバイダー

設定画面で切り替え可能。`src/lib/ai.ts` の `callAI()` が振り分けを担う。

| プロバイダー | 設定値 | デフォルトモデル |
|------------|-------|--------------|
| Gemini API | `'gemini'` | `gemini-2.0-flash` |
| Ollama（ローカル） | `'ollama'` | `qwen2.5:7b`（`http://localhost:11434`） |
| 無効 | `'disabled'` | — |

---

## 設定キー（`SETTING_KEYS`）

`src/lib/settings.ts` で定義。SQLite の `settings` テーブル（key-value）に永続化。

| キー | 内容 |
|-----|------|
| `ai_provider` | `'gemini'` / `'ollama'` / `'disabled'` |
| `gemini_api_key` / `gemini_model` | Gemini API キーとモデル名 |
| `ollama_endpoint` / `ollama_model` | Ollama エンドポイントとモデル名 |
| `daily_report_path` | 日報ファイルの保存先フォルダ |
| `weekly_report_path` | 週報ファイルの保存先フォルダ |
| `theme` | 現在のテーマ（`light` / `dark` / `sepia`） |
| `global_shortcut` | グローバルショートカット |
| `autostart_enabled` | OS 起動時の自動起動 |
| `reminder_enabled` / `reminder_time` | 日報リマインダー ON/OFF と時刻 |
| `butler_briefing` | 朝のブリーフィング機能 ON/OFF |
| `sync_folder` | 外部同期フォルダパス |

---

## GitHub リポジトリ

`https://github.com/roman-ease/Sebastian.git`
