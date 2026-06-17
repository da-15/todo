import { useLayoutEffect, useRef, useState } from "react";
import type { TodoTask } from "../types";
import { todayLocal } from "../dateUtils";
import { isPendingSync } from "../storage/taskStore";
import { isGoogleConfigured } from "../config";

interface Props {
  task: TodoTask;
  onToggle: (id: string) => void;
  onEdit: (task: TodoTask) => void;
  onDelete: (id: string) => void;
}

// 左スワイプで露出する削除ボタンの幅。これ以上引いたら開いた状態でスナップする。
const DELETE_WIDTH = 84;

function formatDue(due: string | null): string {
  if (!due) return "";
  const d = new Date(due + "T00:00:00");
  return d.toLocaleDateString("ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  });
}

export function TaskListItem({ task, onToggle, onEdit, onDelete }: Props) {
  // 予定日の色分け: 昨日以前→赤(overdue) / 当日→青(today) / 未来→黒(future)。
  // 完了済みは色分けしない（既定の青のまま）。
  const today = todayLocal();
  const dueState =
    task.isCompleted || task.dueDate === null
      ? ""
      : task.dueDate < today
        ? "overdue"
        : task.dueDate === today
          ? "today"
          : "future";

  // Google 連携時のみ、未同期（未プッシュ）のタスクに青ドットを出す。
  const pendingSync = isGoogleConfigured() && isPendingSync(task);

  // open: 削除ボタンを露出した状態か。dragX: ドラッグ中の一時的な移動量。
  const [open, setOpen] = useState(false);
  const [dragX, setDragX] = useState<number | null>(null);

  // 詳細メモのアコーディオン。expanded: 展開中か。overflowing: 折りたたみ時に
  // 2行以上あふれているか（あふれているときだけシェブロンを出してタップ可能にする）。
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    // 展開中はクランプが外れて測定できないので、折りたたみ時のみ判定する。
    if (expanded) return;
    const el = detailRef.current;
    if (!el) {
      setOverflowing(false);
      return;
    }
    setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, [task.detail, expanded]);

  const startX = useRef(0);
  const startY = useRef(0);
  const decided = useRef(false); // 縦/横どちらのジェスチャーか確定したか
  const horizontal = useRef(false); // 横スワイプと確定したか
  const moved = useRef(false); // 実際に横移動したか（タップ誤発火の抑止用）

  const onTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    decided.current = false;
    horizontal.current = false;
    moved.current = false;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;
    if (!decided.current) {
      // 小さな移動では判定しない。確定後は縦スクロールと横スワイプを排他にする。
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      decided.current = true;
      horizontal.current = Math.abs(dx) > Math.abs(dy);
    }
    if (!horizontal.current) return;
    moved.current = true;
    const base = open ? -DELETE_WIDTH : 0;
    // 0（閉）〜 -DELETE_WIDTH（開）の範囲。わずかなオーバードラッグだけ許容。
    const next = Math.min(0, Math.max(-DELETE_WIDTH - 16, base + dx));
    setDragX(next);
  };

  const onTouchEnd = () => {
    if (horizontal.current && dragX !== null) {
      setOpen(dragX <= -DELETE_WIDTH / 2);
    }
    setDragX(null);
  };

  const tx = dragX ?? (open ? -DELETE_WIDTH : 0);

  const handleBodyClick = () => {
    // スワイプ直後やボタン露出中のタップは編集を開かず、閉じるだけにする。
    if (moved.current) return;
    if (open) {
      setOpen(false);
      return;
    }
    onEdit(task);
  };

  const handleDetailClick = (e: React.MouseEvent) => {
    // スワイプ直後やボタン露出中は本体クリックと同様に無視/閉じるだけ。
    if (moved.current) return;
    if (open) return;
    // 2行以上あふれている詳細メモだけアコーディオンとして開閉。
    // 1行以下のときは本体クリック（編集）に委ねる。
    if (!overflowing) return;
    e.stopPropagation();
    setExpanded((v) => !v);
  };

  return (
    <li className={`task-item ${task.isCompleted ? "done" : ""}`}>
      <button
        className="swipe-delete"
        style={{ width: DELETE_WIDTH }}
        onClick={() => onDelete(task.id)}
        aria-label="削除"
        tabIndex={open ? 0 : -1}
      >
        削除
      </button>

      <div
        className="task-row"
        style={{
          transform: `translateX(${tx}px)`,
          transition: dragX !== null ? "none" : "transform 0.2s ease",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <button
          className={`check ${task.isCompleted ? "checked" : ""}`}
          onClick={() => onToggle(task.id)}
          aria-label={task.isCompleted ? "未完了に戻す" : "完了にする"}
        >
          {task.isCompleted && (
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>

        <div className="task-body" onClick={handleBodyClick}>
          <div className="task-name">
            {task.name}
            {pendingSync && (
              <span className="sync-dot" aria-label="未同期" title="未同期" />
            )}
          </div>
          {task.detail && (
            <div
              className="task-detail"
              onClick={handleDetailClick}
              role={overflowing ? "button" : undefined}
              aria-expanded={overflowing ? expanded : undefined}
            >
              <div
                ref={detailRef}
                className={`task-detail-text ${expanded ? "" : "clamp"}`}
              >
                {task.detail}
              </div>
              {overflowing && (
                <svg
                  className={`task-detail-chevron ${expanded ? "open" : ""}`}
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              )}
            </div>
          )}
          {task.dueDate && (
            <div className={`task-due ${dueState}`}>
              <svg
                className="task-due-icon"
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="4.5" width="18" height="17" rx="2.5" />
                <path d="M3 9.5h18" />
                <path d="M8 2.5v4M16 2.5v4" />
              </svg>
              {formatDue(task.dueDate)}
            </div>
          )}
        </div>

        <button
          className="btn-delete"
          onClick={() => onDelete(task.id)}
          aria-label="削除"
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </li>
  );
}
