/**
 * Sebastian クラシカルUIコンポーネント
 * 全ページ共通の装飾付きカード・見出し・ページヘッダー
 */

/** カード角飾り付きコンテナ */
export function OrnateCard({
  children,
  className = '',
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`ornate-card relative bg-white rounded-xl shadow-sm border border-sebastian-border ${className}`}
      style={style}
    >
      <span className="absolute top-2.5 left-2.5 w-4 h-4 border-t border-l border-sebastian-gold/30 pointer-events-none rounded-tl-sm" />
      <span className="absolute top-2.5 right-2.5 w-4 h-4 border-t border-r border-sebastian-gold/30 pointer-events-none rounded-tr-sm" />
      <span className="absolute bottom-2.5 left-2.5 w-4 h-4 border-b border-l border-sebastian-gold/30 pointer-events-none rounded-bl-sm" />
      <span className="absolute bottom-2.5 right-2.5 w-4 h-4 border-b border-r border-sebastian-gold/30 pointer-events-none rounded-br-sm" />
      {children}
    </div>
  );
}

/** セクション見出し（◆ 装飾線付き） */
export function CardHeading({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <h3 className="text-sm font-medium text-sebastian-navy shrink-0 font-serif">{children}</h3>
      <span className="text-sebastian-gold/40 text-[9px] shrink-0">◆</span>
      <div className="flex-1 h-px bg-sebastian-gold/15" />
      {action && <span className="shrink-0">{action}</span>}
    </div>
  );
}

/** ページヘッダー（ラベル + 装飾ライン + 大見出し） */
export function PageHeader({
  label,
  title,
  subtitle,
}: {
  label: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
}) {
  return (
    <header className="mb-6">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-[11px] font-display tracking-[0.22em] text-sebastian-gray uppercase shrink-0">
          {label}
        </span>
        <div className="flex-1 h-px bg-sebastian-gold/20" />
        <span className="text-sebastian-gold/45 text-[10px] shrink-0">◆</span>
        <div className="w-10 h-px bg-sebastian-gold/20" />
      </div>
      <h1 className="text-3xl font-serif text-sebastian-navy">{title}</h1>
      {subtitle && (
        <p className="text-sm text-sebastian-gray mt-1 font-serif">{subtitle}</p>
      )}
    </header>
  );
}
