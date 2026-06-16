import { useRef, useState, type ReactNode } from "react";

interface Props {
  onRefresh: () => void | Promise<void>;
  disabled?: boolean;
  children: ReactNode;
}

const THRESHOLD = 70; // px 引き下げで発火
const MAX_PULL = 110;

/**
 * 一覧トップでの下スワイプ（pull-to-refresh）を検出する。
 * スクロール位置が最上部のときのみ反応する。
 *
 * 同期中の表示はしない（同期ボタン左のスピナーで分かるため）。リリース時に
 * インジケーターを即座に畳むので、一覧（チケット）の位置がズレない。
 * onRefresh はタップのジェスチャースタック内で同期的に呼ぶ（OAuth ポップアップ対策）。
 */
export function PullToRefresh({ onRefresh, disabled, children }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);

  const onTouchStart = (e: React.TouchEvent) => {
    if (disabled) return;
    const el = containerRef.current;
    startY.current = el && el.scrollTop <= 0 ? e.touches[0].clientY : null;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current === null) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy > 0) {
      // 抵抗をつけて引き下げ量を抑える
      setPull(Math.min(MAX_PULL, dy * 0.5));
    }
  };

  const onTouchEnd = () => {
    if (startY.current === null) return;
    startY.current = null;
    const trigger = pull >= THRESHOLD;
    setPull(0); // 即座に戻す → 一覧の位置がズレない
    if (trigger) {
      // await しない: ユーザー操作スタック内で同期的に呼ぶことで
      // iOS でも OAuth ポップアップが開ける。同期中表示はボタン側に任せる。
      void onRefresh();
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
        {pull >= THRESHOLD ? "離して同期" : "引き下げて同期"}
      </div>
      <div>{children}</div>
    </div>
  );
}
