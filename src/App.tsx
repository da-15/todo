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
import { getAllTasksRaw, isPendingSync } from "./storage/taskStore";
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
// 削除は「元に戻す」トーストを出している間は保存せず、消えた時点で確定する。
const UNDO_DELETE_MS = 5000;

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
  const { tasks, refresh, add, edit, remove } = useTasks();
  // pending: 切り替えたがまだ保存していない完了状態（id → 切り替え後の isCompleted）。
  //   タップ直後は見た目だけ切り替え、少し待ってから実際に変わったものだけ保存する。
  //   待っている間に元へ戻せば何も保存されず、更新日時も並び順も変わらない。
  // frozenOrder: 保存待ちの間、固定しておく表示順（null なら通常のソート順）。
  // flashIds: 移動直後にハイライトするタスク。
  const [pending, setPending] = useState<Map<string, boolean>>(() => new Map());
  const [frozenOrder, setFrozenOrder] = useState<string[] | null>(null);
  const [flashIds, setFlashIds] = useState<Set<string>>(() => new Set());
  // タイマーやイベントリスナーから最新の値を読むための参照。
  const pendingRef = useRef(pending);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const settleTimer = useRef<number>();
  const flashTimer = useRef<number>();
  // pendingDeleteId: 削除したがまだ保存していないタスク（一覧からは隠す）。
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const pendingDeleteRef = useRef(pendingDeleteId);
  const deleteTimer = useRef<number>();
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
  // syncReady: 事前初期化が終わったか。終わる前に同期するとポップアップが
  // ブロックされやすいので、未同期ドットはこれが true になるまで出さない。
  // 読み込みに失敗した場合も true にする（ドットが出ないままになるのを防ぐ。
  // 同期を押せば login 時に読み込みを再試行する）。
  const [syncReady, setSyncReady] = useState(false);
  useEffect(() => {
    void warmUp().finally(() => setSyncReady(true));
  }, []);

  // Google にまだ反映していない変更（削除を含む）が1件でもあるか。
  // 削除済みのタスクは一覧に出ないので、tombstone を含む全件から判定する。
  const hasUnsynced = useMemo(
    () => isGoogleConfigured() && getAllTasksRaw().some(isPendingSync),
    [tasks],
  );

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
      tasks
        .filter((t) => t.id !== pendingDeleteId)
        .map((t) =>
          pending.has(t.id) ? { ...t, isCompleted: pending.get(t.id)! } : t,
        )
        .sort((a, b) => {
          if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
          if (a.isCompleted && b.isCompleted)
            return a.updatedAt.localeCompare(b.updatedAt);
          const aHas = a.dueDate !== null;
          const bHas = b.dueDate !== null;
          if (aHas !== bHas) return aHas ? -1 : 1;
          if (aHas && bHas) return a.dueDate!.localeCompare(b.dueDate!);
          return a.updatedAt.localeCompare(b.updatedAt);
        }),
    [tasks, pending, pendingDeleteId],
  );

  // 固定中は切り替え前の順番で表示する。固定後に追加されたタスクなど、
  // 固定順に含まれないものがあれば固定を諦めて通常のソート順にする。
  const displayed = useMemo(() => {
    if (!frozenOrder) return sorted;
    const byId = new Map(sorted.map((t) => [t.id, t]));
    const kept = frozenOrder.flatMap((id) => byId.get(id) ?? []);
    return kept.length === sorted.length ? kept : sorted;
  }, [sorted, frozenOrder]);

  const updatePending = (next: Map<string, boolean>) => {
    pendingRef.current = next;
    setPending(next);
  };

  // 保存待ちの切り替えを保存し、固定していた並び順を解除する。
  // 保存したタスクの id を返す。
  const commitPending = (): string[] => {
    window.clearTimeout(settleTimer.current);
    const changes = pendingRef.current;
    updatePending(new Map());
    setFrozenOrder(null);
    const committed: string[] = [];
    for (const [id, isCompleted] of changes) {
      const stored = tasksRef.current.find((t) => t.id === id);
      // 同期などで保存済みの状態が既に同じになっていれば書き込まない
      if (!stored || stored.isCompleted === isCompleted) continue;
      edit(id, { isCompleted });
      committed.push(id);
    }
    return committed;
  };

  const settle = () => {
    const moved = commitPending();
    if (moved.length === 0) return;
    setFlashIds(new Set(moved));
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(
      () => setFlashIds(new Set()),
      FLASH_MS,
    );
  };

  const updatePendingDelete = (id: string | null) => {
    pendingDeleteRef.current = id;
    setPendingDeleteId(id);
  };

  // 保存待ちの削除を確定する。
  const commitDelete = () => {
    window.clearTimeout(deleteTimer.current);
    const id = pendingDeleteRef.current;
    if (id === null) return;
    updatePendingDelete(null);
    remove(id);
  };

  // 削除を取り消す。まだ保存していないので、隠していたのを戻すだけでよい。
  const undoDelete = () => {
    window.clearTimeout(deleteTimer.current);
    updatePendingDelete(null);
  };

  // 保存待ちのままアプリを閉じても切り替えや削除が失われないよう、
  // バックグラウンドに回った時点ですぐ保存する。
  useEffect(() => {
    const flush = () => {
      if (pendingRef.current.size > 0) commitPending();
      commitDelete();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      window.clearTimeout(settleTimer.current);
      window.clearTimeout(flashTimer.current);
      window.clearTimeout(deleteTimer.current);
    };
    // commitPending / commitDelete は ref と安定した関数だけを使うので、
    // 初回の登録のままでよい
  }, []);

  const handleToggle = (id: string) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const next = new Map(pendingRef.current);
    const shown = next.get(id) ?? task.isCompleted;
    // 保存済みの状態に戻ったら保存待ちから外す（＝何も保存しない）
    if (!shown === task.isCompleted) next.delete(id);
    else next.set(id, !shown);
    updatePending(next);
    window.clearTimeout(settleTimer.current);
    if (next.size === 0) {
      setFrozenOrder(null);
      return;
    }
    // 連続タップ時は最初の順番を保ったまま、待ち時間だけ延長する。
    if (!frozenOrder) setFrozenOrder(displayed.map((t) => t.id));
    settleTimer.current = window.setTimeout(settle, SETTLE_DELAY_MS);
  };

  const handleDelete = (id: string) => {
    // 続けて削除したときは前の削除を確定し、取り消せるのは直前の1件だけにする。
    // 完了の保存待ちはそのまま残す（取り消したときに切り替えた状態で戻すため。
    // 削除が先に確定した場合は、保存時にタスクが見つからず何もしない）。
    commitDelete();
    updatePendingDelete(id);
    deleteTimer.current = window.setTimeout(commitDelete, UNDO_DELETE_MS);
  };

  const handleSync = async () => {
    if (syncing) return; // 多重起動を防ぐ
    // 保存待ちの切り替えと削除も今回の同期に含める
    commitPending();
    commitDelete();
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
        <div className="sync-actions">
          {hasUnsynced && syncReady && (
            <span
              className="sync-dot"
              aria-label="未同期の変更あり"
              title="未同期の変更あり"
            />
          )}
          <button
            className="link-btn"
            onClick={handleSync}
            disabled={syncing}
            type="button"
          >
            {syncing && <span className="spinner" aria-hidden="true" />}
            同期
          </button>
        </div>
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
                onDelete={handleDelete}
              />
            ))}
          </ul>
        )}
      </div>

      {pendingDeleteId && (
        // key でトーストを差し替え、続けて削除したときも表示アニメーションをやり直す
        <div className="undo-toast" key={pendingDeleteId} role="status">
          <span>タスクを削除しました</span>
          <button className="undo-btn" type="button" onClick={undoDelete}>
            元に戻す
          </button>
        </div>
      )}

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
