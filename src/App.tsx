import { useEffect, useMemo, useRef, useState } from "react";
import { useTasks } from "./hooks/useTasks";
import { TaskListItem } from "./components/TaskListItem";
import { TaskEditor } from "./components/TaskEditor";
import { SettingsView } from "./components/SettingsView";
import { InstallGuide } from "./components/InstallGuide";
import { isGoogleConfigured } from "./config";
import { isLoggedIn, login, warmUp } from "./google/auth";
import { syncWithGoogle } from "./sync/googleTasksSync";
import { updateBadge, maybeRequestNotificationPermissionOnce } from "./badge";
import { getSyncMeta } from "./storage/syncMeta";
import { getSettings, setSettings } from "./storage/settings";
import type { TodoTask } from "./types";
import type { NewTaskInput } from "./storage/taskStore";

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari 独自プロパティ
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

// 完了/未完了を切り替えた直後は並び替えを少し待ち、その場でグレーになるのを
// 見せてから移動させる。移動後は移動先の行を一瞬ハイライトする。
const SETTLE_DELAY_MS = 800;
const FLASH_MS = 1200;

function formatSyncTime(iso: string | null): string {
  if (!iso) return "未同期";
  const d = new Date(iso);
  return `最終同期 ${d.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export function App() {
  const { tasks, refresh, add, edit, remove, toggle } = useTasks();
  // frozenOrder: 切り替え直後に固定しておく表示順（null なら通常のソート順）。
  // flashIds: 移動直後にハイライトするタスク。
  const [frozenOrder, setFrozenOrder] = useState<string[] | null>(null);
  const [flashIds, setFlashIds] = useState<Set<string>>(() => new Set());
  const toggledIds = useRef<Set<string>>(new Set());
  const settleTimer = useRef<number>();
  const flashTimer = useRef<number>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<TodoTask | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(
    () => getSyncMeta().lastSyncedAt,
  );
  const [showInstall, setShowInstall] = useState(
    () => !isStandalone() && !getSettings().installGuideDismissed,
  );

  // 起動時に GIS クライアントを事前初期化しておく。
  // これで同期時に login() が requestAccessToken を同期的に呼べ、
  // タップ操作内でポップアップを開ける（iOS のポップアップブロック対策）。
  useEffect(() => {
    void warmUp();
  }, []);

  // 起動時・フォアグラウンド復帰時にバッジ更新。初回に通知許可をリクエスト。
  useEffect(() => {
    void maybeRequestNotificationPermissionOnce();
    void updateBadge();
    const onVisible = () => {
      if (document.visibilityState === "visible") void updateBadge();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // 並び順（「上ほど優先・直近」という思想で統一。日付はすべて昇順）:
  //  1. 未完了を上、完了済みを下
  //  2. 完了済みどうしは「完了した日（updatedAt）」の古い順（古いものが上）
  //  3. 未完了どうしは 予定日ありを日付昇順 → 予定日なしを更新日の古い順
  const sorted = useMemo(
    () =>
      [...tasks].sort((a, b) => {
        if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
        if (a.isCompleted && b.isCompleted)
          return a.updatedAt.localeCompare(b.updatedAt);
        const aHas = a.dueDate !== null;
        const bHas = b.dueDate !== null;
        if (aHas !== bHas) return aHas ? -1 : 1;
        if (aHas && bHas) return a.dueDate!.localeCompare(b.dueDate!);
        return a.updatedAt.localeCompare(b.updatedAt);
      }),
    [tasks],
  );

  // 固定中は切り替え前の順番で表示する。固定後に追加されたタスクなど、
  // 固定順に含まれないものがあれば固定を諦めて通常のソート順にする。
  const displayed = useMemo(() => {
    if (!frozenOrder) return sorted;
    const byId = new Map(sorted.map((t) => [t.id, t]));
    const kept = frozenOrder.flatMap((id) => byId.get(id) ?? []);
    return kept.length === sorted.length ? kept : sorted;
  }, [sorted, frozenOrder]);

  useEffect(
    () => () => {
      window.clearTimeout(settleTimer.current);
      window.clearTimeout(flashTimer.current);
    },
    [],
  );

  const handleToggle = (id: string) => {
    // 連続タップ時は最初の順番を保ったまま、待ち時間だけ延長する。
    if (!frozenOrder) setFrozenOrder(displayed.map((t) => t.id));
    toggledIds.current.add(id);
    toggle(id);
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      setFrozenOrder(null);
      setFlashIds(new Set(toggledIds.current));
      toggledIds.current = new Set();
      window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(
        () => setFlashIds(new Set()),
        FLASH_MS,
      );
    }, SETTLE_DELAY_MS);
  };

  const handleSync = async () => {
    if (syncing) return; // 多重起動を防ぐ
    if (!isGoogleConfigured()) {
      setSyncMsg("Google 未設定のため同期できません");
      setTimeout(() => setSyncMsg(null), 3000);
      return;
    }
    setSyncing(true);
    try {
      if (!isLoggedIn()) {
        // 未ログイン/失効時は対話ログインを直接呼ぶ。
        // サイレント(prompt:"none")を先に挟むと、その待ち時間でタップ/クリックの
        // transient activation が失効し、続くポップアップがブロックされて固まる
        // （特に pull-to-refresh）。同意済みなら login(true) は一瞬で自動完了する。
        await login(true);
      }
      const result = await syncWithGoogle();
      refresh();
      setLastSync(getSyncMeta().lastSyncedAt);
      const pushed = result.pushedNew + result.pushedUpdated + result.pushedDeleted;
      const pulled = result.pulledNew + result.pulledUpdated + result.pulledDeleted;
      setSyncMsg(
        result.errors.length
          ? `同期に一部失敗（${result.errors.length}件）`
          : `同期完了 ↑${pushed} ↓${pulled}`,
      );
    } catch (e) {
      setSyncMsg(`同期失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 4000);
    }
  };

  const openNew = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (task: TodoTask) => {
    setEditing(task);
    setEditorOpen(true);
  };
  const handleSave = (input: NewTaskInput) => {
    if (editing) {
      edit(editing.id, {
        name: input.name.trim(),
        detail: input.detail,
        dueDate: input.dueDate,
      });
    } else {
      add(input);
    }
    setEditorOpen(false);
    setEditing(null);
  };

  const dismissInstall = () => {
    setSettings({ installGuideDismissed: true });
    setShowInstall(false);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>ToDo</h1>
        <button
          className="icon-btn"
          onClick={() => setSettingsOpen(true)}
          aria-label="設定"
        >
          ⋮
        </button>
      </header>

      <div className="sync-bar">
        <span className="muted small">{formatSyncTime(lastSync)}</span>
        <button
          className="link-btn"
          onClick={handleSync}
          disabled={syncing}
          type="button"
        >
          {syncing && <span className="spinner" aria-hidden="true" />}
          同期
        </button>
        {syncMsg && <div className="sync-toast">{syncMsg}</div>}
      </div>

      <div className="list-scroll">
        {showInstall && <InstallGuide onDismiss={dismissInstall} />}
        {displayed.length === 0 ? (
          <p className="empty">タスクはありません。</p>
        ) : (
          <ul className="task-list">
            {displayed.map((task) => (
              <TaskListItem
                key={task.id}
                task={task}
                flash={flashIds.has(task.id)}
                onToggle={handleToggle}
                onEdit={openEdit}
                onDelete={remove}
              />
            ))}
          </ul>
        )}
      </div>

      <button className="fab" onClick={openNew} aria-label="新規タスク">
        ＋
      </button>

      {editorOpen && (
        <TaskEditor
          initial={editing}
          onSave={handleSave}
          onCancel={() => {
            setEditorOpen(false);
            setEditing(null);
          }}
        />
      )}
      {settingsOpen && (
        <SettingsView
          onClose={() => setSettingsOpen(false)}
          onDataChanged={() => {
            refresh();
            setLastSync(getSyncMeta().lastSyncedAt);
          }}
        />
      )}
    </div>
  );
}
