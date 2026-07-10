/** 優先度ラベル */
export const PRIORITY_LABEL: Record<string, string> = {
  high: '高', medium: '中', low: '低', none: 'なし',
};

/** 優先度バッジ用 Tailwind クラス（bg + text + border） */
export const PRIORITY_COLOR: Record<string, string> = {
  high:   'bg-red-50   text-red-600   border-red-100',
  medium: 'bg-blue-50  text-blue-600  border-blue-100',
  low:    'bg-gray-50  text-gray-500  border-gray-100',
  none:   'bg-gray-50  text-gray-400  border-gray-100',
};

/** ステータスラベル */
export const STATUS_LABEL: Record<string, string> = {
  todo:        '未着手',
  in_progress: '進行中',
  done:        '完了',
  hold:        '保留',
  archived:    'アーカイブ',
};

/** プロジェクトステータスラベル */
export const PROJECT_STATUS_LABEL: Record<string, string> = {
  active:   '進行中',
  done:     '完了',
  hold:     '保留',
  archived: 'アーカイブ',
};

/** プロジェクトステータスバッジ用 Tailwind クラス */
export const PROJECT_STATUS_COLOR: Record<string, string> = {
  active:   'bg-blue-50  text-blue-600  border-blue-100',
  done:     'bg-green-50 text-green-600 border-green-100',
  hold:     'bg-orange-50 text-orange-500 border-orange-100',
  archived: 'bg-gray-50  text-gray-400  border-gray-100',
};
