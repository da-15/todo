import { useEffect, useMemo, useState } from "react";
import { useTasks } from "./hooks/useTasks";
import { TaskListItem } from "./components/TaskListItem";
import { TaskEditor } from "./components/TaskEditor";
import { SettingsView } from "./components/SettingsView";
import { PullToRefresh } from "./components/PullToRefresh";
import { InstallGuide } from "./components/InstallGuide";
import { isGoogleConfigured } from "./config";
import { isLoggedIn, login } from "./google/auth";
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
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<TodoTask | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(
    () => getSyncMeta().lastSyncedAt,
  );
  const [showInstall, setShowInstall] = useState(
    () => !isStandalone() && !getSettings().installGuideDismissed,
  );

  // 起動時にサイレントでトークン再取得を試みる。
  // 過去に許可済み & Google セッションが有効なら UI なしでログイン状態を復元できる。
  // 失敗（未許可・セッション切れ等）してもローカルのみで動作するため無視する。
  useEffect(() => {
    if (isGoogleConfigured() && !isLoggedIn()) {
      login(false).catch(() => {
        /* サイレント取得失敗。手動ログインにフォールバック */
      });
    }
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

  // 並び順: 未完了優先 → 予定日ありを日付昇順 → 予定日なしを作成日降順。
  const sorted = useMemo(
    () =>
      [...tasks].sort((a, b) => {
        if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
        const aHas = a.dueDate !== null;
        const bHas = b.dueDate !== null;
        if (aHas !== bHas) return aHas ? -1 : 1;
        if (aHas && bHas) return a.dueDate!.localeCompare(b.dueDate!);
        return b.createdAt.localeCompare(a.createdAt);
      }),
    [tasks],
  );

  const handleSync = async () => {
    if (!isGoogleConfigured()) {
      setSyncMsg("Google 未設定のため同期できません");
      setTimeout(() => setSyncMsg(null), 3000);
      return;
    }
    try {
      if (!isLoggedIn()) {
        // まずサイレント再取得を試し、失敗時のみ対話ログインに切り替える。
        // これにより無駄なポップアップを減らす。
        try {
          await login(false);
        } catch {
          await login(true);
        }
      }
      const result = await syncWithGoogle();
      refresh();
      setLastSync(result.finishedAt);
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
        <button className="link-btn" onClick={handleSync} type="button">
          同期
        </button>
        {syncMsg && <div className="sync-toast">{syncMsg}</div>}
      </div>

      <PullToRefresh onRefresh={handleSync}>
        {showInstall && <InstallGuide onDismiss={dismissInstall} />}
        {sorted.length === 0 ? (
          <p className="empty">
            タスクがありません。右下の＋から追加できます。
          </p>
        ) : (
          <ul className="task-list">
            {sorted.map((task) => (
              <TaskListItem
                key={task.id}
                task={task}
                onToggle={toggle}
                onEdit={openEdit}
                onDelete={remove}
              />
            ))}
          </ul>
        )}
      </PullToRefresh>

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
