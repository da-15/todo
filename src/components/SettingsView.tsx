import { useEffect, useState } from "react";
import { isGoogleConfigured } from "../config";
import { isLoggedIn, login, logout, onAuthChange } from "../google/auth";
import { requestNotificationPermission } from "../badge";

interface Props {
  onClose: () => void;
}

export function SettingsView({ onClose }: Props) {
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
              <p className="muted">連携済み。プルダウンで同期できます。</p>
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
            <p className="muted">許可済み。未完了のシンプルタスク数をバッジ表示します。</p>
          ) : (
            <>
              <p className="muted">
                バッジ表示には通知許可が必要です（iOS 16.4 以降）。
                {notifPerm === "denied" &&
                  " 現在は拒否されています。設定アプリから許可してください。"}
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

        <div className="modal-actions">
          <button className="btn-primary" onClick={onClose} type="button">
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
