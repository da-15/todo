import { useRef, useState, type ReactNode } from "react";

interface Props {
  onRefresh: () => Promise<void>;
  disabled?: boolean;
  syncing?: boolean;
  children: ReactNode;
}

const THRESHOLD = 70; // px 引き下げで発火
const MAX_PULL = 110;

/**
 * 一覧トップでの下スワイプ（pull-to-refresh）を検出する。
 * スクロール位置が最上部のときのみ反応する。
 */
export function PullToRefresh({
  onRefresh,
  disabled,
  syncing,
  children,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const onTouchStart = (e: React.TouchEvent) => {
    if (disabled || refreshing) return;
    const el = containerRef.current;
    if (el && el.scrollTop <= 0) {
      startY.current = e.touches[0].clientY;
    } else {
      startY.current = null;
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current === null) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy > 0) {
      // 抵抗をつけて引き下げ量を抑える
      setPull(Math.min(MAX_PULL, dy * 0.5));
    }
  };

  const onTouchEnd = async () => {
    if (startY.current === null) return;
    startY.current = null;
    if (pull >= THRESHOLD && !refreshing) {
      setRefreshing(true);
      setPull(THRESHOLD);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        setPull(0);
      }
    } else {
      setPull(0);
    }
  };

  return (
    <div
      ref={containerRef}
      className="ptr-container"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div
        className="ptr-indicator"
        style={{ height: pull, opacity: pull > 10 ? 1 : 0 }}
      >
        {refreshing || syncing ? (
          <span className="spinner" aria-label="同期中" />
        ) : pull >= THRESHOLD ? (
          "離して同期"
        ) : (
          "引き下げて同期"
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}
