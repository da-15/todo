import { useEffect, useState } from "react";
import { isGoogleConfigured } from "../config";
import { isLoggedIn, login, logout, onAuthChange } from "../google/auth";
import { requestNotificationPermission } from "../badge";
import { setSyncMeta } from "../storage/syncMeta";
import { clearAllTasks } from "../storage/taskStore";
import { syncWithGoogle } from "../sync/googleTasksSync";

interface Props {
  onClose: () => void;
  onDataChanged: () => void;
}

export function SettingsView({ onClose, onDataChanged }: Props) {
  const [loggedIn, setLoggedIn] = useState(isLoggedIn());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | "unsupported">(
    "Notification" in window ? Notification.permission : "unsupported",
  );

  useEffect(() => onAuthChange(setLoggedIn), []);

  const handleLogin = async () => {
    setBusy(true);
    setError(null);
    try {
      await login(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleNotif = async () => {
    const perm = await requestNotificationPermission();
    setNotifPerm(perm);
  };

  const ensureLogin = async () => {
    // 直接対話ログインを呼ぶ（サイレント前段は activation 失効でポップアップが
    // 固まる原因になるため。同意済みなら一瞬で自動完了する）。
    if (!isLoggedIn()) await login(true);
  };

  // 同期状態リセット: lastSyncedAt を消して全件取り直す。紐付け・タスク本体は保持。
  const handleFullResync = async () => {
    if (!isGoogleConfigured()) return;
    setBusy(true);
    setError(null);
    try {
      await ensureLogin();
      setSyncMeta({ lastSyncedAt: null });
      const r = await syncWithGoogle();
      onDataChanged();
      setError(
        r.errors.length ? `一部失敗（${r.errors.length}件）` : "全件取り直し完了",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // ローカル初期化: ローカルを全消去し Google から取り直す。未同期タスクは失われる。
  const handleResetLocal = async () => {
    if (
      !confirm(
        "ローカルのタスクをすべて消去し、Google から取り直します。\n" +
          "Google に同期されていないタスクは失われます。続けますか？",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      clearAllTasks();
      setSyncMeta({ lastSyncedAt: null });
      onDataChanged();
      if (isGoogleConfigured()) {
        await ensureLogin();
        const r = await syncWithGoogle();
        onDataChanged();
        setError(
          r.errors.length
            ? `取り直しで一部失敗（${r.errors.length}件）`
            : "初期化して取り直し完了",
        );
      } else {
        setError("ローカルを初期化しました");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>設定</h2>

        <section className="settings-section">
          <h3>Google Tasks 連携</h3>
          {!isGoogleConfigured() ? (
            <p className="muted">
              クライアント ID が未設定です。<code>.env.local</code> に
              <code>VITE_GOOGLE_CLIENT_ID</code> を設定してください。
            </p>
          ) : loggedIn ? (
            <>
              <p className="muted">連携済み。</p>
              <button className="btn-ghost" onClick={logout} type="button">
                ログアウト
              </button>
            </>
          ) : (
            <>
              <p className="muted">
                未連携。ログインすると Google Tasks と双方向同期します。
                未ログインでもローカルのみで利用できます。
              </p>
              <button
                className="btn-primary"
                onClick={handleLogin}
                disabled={busy}
                type="button"
              >
                {busy ? "処理中…" : "Google でログイン"}
              </button>
            </>
          )}
          {error && <p className="error">{error}</p>}
        </section>

        <section className="settings-section">
          <h3>通知 / バッジ</h3>
          {notifPerm === "unsupported" ? (
            <p className="muted">この環境では通知に未対応です。</p>
          ) : notifPerm === "granted" ? (
            <p className="muted">許可済み。未完了のタスク数をバッジ表示します。</p>
          ) : (
            <>
              <p className="muted">
                バッジ表示には通知許可が必要です（iOS 16.4 以降）。
                {notifPerm === "denied" &&
                  " 現在は拒否されています。OSのアプリ設定から許可してください。"}
              </p>
              {notifPerm === "default" && (
                <button className="btn-primary" onClick={handleNotif} type="button">
                  通知を許可する
                </button>
              )}
            </>
          )}
        </section>

        <section className="settings-section">
          <h3>ホーム画面に追加（iOS）</h3>
          <p className="muted">
            Safari の共有ボタン →「ホーム画面に追加」でインストールすると、
            スタンドアロン起動とバッジが有効になります。
          </p>
        </section>

        <section className="settings-section">
          <h3>トラブル時のリセット</h3>
          <p className="muted">
            同期エラーが解消しないときに使います。
          </p>
          <div className="reset-buttons">
            <button
              className="btn-ghost"
              onClick={handleFullResync}
              disabled={busy || !isGoogleConfigured()}
              type="button"
            >
              全件を取り直す（安全）
            </button>
            <button
              className="btn-danger"
              onClick={handleResetLocal}
              disabled={busy}
              type="button"
            >
              ローカルを初期化して取り直す
            </button>
          </div>
          <p className="muted small">
            「全件を取り直す」はタスクを残したまま Google と再照合します。
            それでも直らないときだけ「ローカルを初期化」を使ってください
            （未同期のタスクは失われます）。
          </p>
          {error && <p className="error">{error}</p>}
        </section>

        <div className="modal-actions">
          <button className="btn-primary" onClick={onClose} type="button">
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
