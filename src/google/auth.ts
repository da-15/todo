// Google Identity Services (GIS) の OAuth 2.0 トークンフロー（SPA 向け）。
//
// アクセストークンは localStorage に失効時刻つきで保存し、有効な間は再利用する。
// iOS の standalone PWA ではサイレント取得（prompt:"none"）が
// サードパーティ Cookie 制限で失敗しやすく、再起動のたびに再ログインを
// 強いられるため。トークンは短命（約1時間）・スコープは tasks 限定・
// リフレッシュトークンは持たないため、個人用途ではリスクは限定的。
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_TASKS_SCOPE,
  isGoogleConfigured,
  STORAGE_KEYS,
} from "../config";

// GIS の型は最小限だけ宣言する。
interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
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

// 起動時に保存済みトークンを復元する。
(function restore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.auth);
    if (!raw) return;
    const { token, expiresAt } = JSON.parse(raw) as {
      token: string;
      expiresAt: number;
    };
    if (token && Date.now() < expiresAt) {
      accessToken = token;
      tokenExpiresAt = expiresAt;
    } else {
      localStorage.removeItem(STORAGE_KEYS.auth);
    }
  } catch {
    /* 破損時は無視 */
  }
})();

function persistToken(): void {
  if (accessToken) {
    localStorage.setItem(
      STORAGE_KEYS.auth,
      JSON.stringify({ token: accessToken, expiresAt: tokenExpiresAt }),
    );
  } else {
    localStorage.removeItem(STORAGE_KEYS.auth);
  }
}

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

async function ensureClient(): Promise<TokenClient> {
  if (!isGoogleConfigured()) {
    throw new Error(
      "Google クライアント ID が未設定です（VITE_GOOGLE_CLIENT_ID）",
    );
  }
  await waitForGis();
  if (!tokenClient) {
    tokenClient = window.google!.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_TASKS_SCOPE,
      callback: () => {}, // requestToken 内で都度差し替える
    });
  }
  return tokenClient;
}

export function isLoggedIn(): boolean {
  return !!accessToken && Date.now() < tokenExpiresAt;
}

/**
 * アクセストークンを取得する。
 * @param interactive true ならユーザーに同意ダイアログを表示しうる。
 */
export function login(interactive = true): Promise<string> {
  return new Promise(async (resolve, reject) => {
    try {
      const client = await ensureClient();
      client.callback = (resp: TokenResponse) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error ?? "アクセストークンの取得に失敗しました"));
          return;
        }
        accessToken = resp.access_token;
        tokenExpiresAt = Date.now() + (resp.expires_in ?? 3600) * 1000 - 60_000;
        persistToken();
        notify();
        resolve(accessToken);
      };
      client.requestAccessToken({ prompt: interactive ? "" : "none" });
    } catch (e) {
      reject(e);
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
  persistToken();
  notify();
}
