// Google Identity Services (GIS) の OAuth 2.0 トークンフロー（SPA 向け）。
// アクセストークンはメモリ保持のみとし、localStorage には保存しない（セキュリティ上の配慮）。
// GIS はリフレッシュトークンを発行せず、トークンは約1時間で失効するため、
// 再起動・失効後の同期時には再認証が必要になる。
import { GOOGLE_CLIENT_ID, GOOGLE_TASKS_SCOPE, isGoogleConfigured } from "../config";

// GIS の型は最小限だけ宣言する。
interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}
// ポップアップを閉じた／開けなかった場合などに発火する GIS のエラー。
// type 例: "popup_closed" | "popup_failed_to_open"
interface GisError {
  type?: string;
  message?: string;
}
interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void;
  callback: (resp: TokenResponse) => void;
}
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (resp: TokenResponse) => void;
            error_callback?: (err: GisError) => void;
          }) => TokenClient;
          revoke: (token: string, done?: () => void) => void;
        };
      };
    };
  }
}

let tokenClient: TokenClient | null = null;
let accessToken: string | null = null;
let tokenExpiresAt = 0; // epoch ms

// 進行中の login() のエラー処理。ポップアップを閉じたときに即座に解決するため、
// クライアント生成時に登録した error_callback からここへ通知する。
let activeErrorHandler: ((err: GisError) => void) | null = null;

const listeners = new Set<(loggedIn: boolean) => void>();

export function onAuthChange(cb: (loggedIn: boolean) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function notify() {
  const v = isLoggedIn();
  listeners.forEach((cb) => cb(v));
}

function waitForGis(timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (window.google?.accounts?.oauth2) return resolve();
      if (Date.now() - start > timeoutMs)
        return reject(new Error("Google Identity Services の読み込みに失敗しました"));
      setTimeout(tick, 100);
    };
    tick();
  });
}

// GIS が読み込み済みなら同期的にクライアントを生成して返す。未ロードなら null。
function initClientSync(): TokenClient | null {
  if (tokenClient) return tokenClient;
  if (!isGoogleConfigured()) return null;
  if (!window.google?.accounts?.oauth2) return null;
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_TASKS_SCOPE,
    callback: () => {}, // requestAccessToken 内で都度差し替える
    // ポップアップを閉じた／開けなかったときに発火。進行中の login() を即座に終わらせる。
    error_callback: (err) => activeErrorHandler?.(err),
  });
  return tokenClient;
}

/**
 * 起動時に GIS クライアントを事前初期化しておく。
 * これにより login() が requestAccessToken を「同期的に」呼べるようになり、
 * タップ/クリックのユーザー操作スタック内でポップアップを開ける
 * （iOS は await を挟むとポップアップをブロックするため）。
 */
export async function warmUp(): Promise<void> {
  if (!isGoogleConfigured() || tokenClient) return;
  try {
    await waitForGis();
    initClientSync();
  } catch {
    /* 起動時の事前初期化失敗は無視（login 時に再試行） */
  }
}

export function isLoggedIn(): boolean {
  return !!accessToken && Date.now() < tokenExpiresAt;
}

/**
 * アクセストークンを取得する。
 * @param interactive true ならユーザーに同意ダイアログを表示しうる。
 *
 * 重要: GIS 準備済みのときは requestAccessToken を同期的に呼ぶ。
 * await を挟むと iOS ではポップアップがブロックされるため、warmUp() で
 * 事前初期化しておくことが前提。
 */
export function login(interactive = true): Promise<string> {
  return new Promise((resolve, reject) => {
    // GIS のコールバックが呼ばれずに固まるのを防ぐため、必ずタイムアウトで解決する。
    // 通常はポップアップを閉じれば error_callback が即発火するので、これは
    // 「認証画面を開いたまま放置」した場合の保険。長すぎると不快なので短めにする。
    let settled = false;
    const timeoutMs = interactive ? 25_000 : 10_000;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeErrorHandler = null;
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error("認証がタイムアウトしました")));
    }, timeoutMs);

    const requestWith = (client: TokenClient) => {
      client.callback = (resp: TokenResponse) => {
        finish(() => {
          if (resp.error || !resp.access_token) {
            reject(new Error(resp.error ?? "アクセストークンの取得に失敗しました"));
            return;
          }
          accessToken = resp.access_token;
          tokenExpiresAt = Date.now() + (resp.expires_in ?? 3600) * 1000 - 60_000;
          notify();
          resolve(accessToken);
        });
      };
      // ポップアップを閉じた／キャンセルした場合はここで即座に終了する。
      activeErrorHandler = (err: GisError) => {
        finish(() =>
          reject(
            new Error(
              err.type === "popup_closed"
                ? "認証がキャンセルされました"
                : "認証ウィンドウを開けませんでした",
            ),
          ),
        );
      };
      client.requestAccessToken({ prompt: interactive ? "" : "none" });
    };

    if (!isGoogleConfigured()) {
      settled = true;
      clearTimeout(timer);
      reject(new Error("Google クライアント ID が未設定です（VITE_GOOGLE_CLIENT_ID）"));
      return;
    }

    const client = initClientSync();
    if (client) {
      // 同期パス: ユーザー操作スタック内で実行 → ポップアップが開ける
      requestWith(client);
    } else {
      // GIS 未ロード（通常は warmUp 済みなので稀）。ジェスチャーは失われうる。
      waitForGis()
        .then(() => {
          const c = initClientSync();
          if (!c) throw new Error("Google Identity Services の初期化に失敗しました");
          requestWith(c);
        })
        .catch((e) => finish(() => reject(e)));
    }
  });
}

/** 有効なトークンを返す。期限切れなら静かに再取得を試みる。 */
export async function getAccessToken(): Promise<string> {
  if (isLoggedIn()) return accessToken!;
  return login(false);
}

export function logout(): void {
  if (accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(accessToken);
  }
  accessToken = null;
  tokenExpiresAt = 0;
  notify();
}
