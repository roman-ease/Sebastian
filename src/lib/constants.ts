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
