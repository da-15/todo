import { countUncompletedSimple } from "./storage/taskStore";
import { getSettings, setSettings } from "./storage/settings";

/** 未完了 simple 件数をアプリアイコンのバッジに反映する。 */
export async function updateBadge(): Promise<void> {
  const count = countUncompletedSimple();
  try {
    if ("setAppBadge" in navigator) {
      if (count > 0) {
        await navigator.setAppBadge(count);
      } else {
        await navigator.clearAppBadge?.();
      }
    }
  } catch (e) {
    // 権限・対応状況により失敗しても無視（フォールバック: バッジなしで動作）
    console.warn("badge: 更新に失敗", e);
  }
}

/**
 * 通知許可をリクエストする。iOS PWA ではバッジ表示に通知許可が前提となる。
 * 拒否されてもアプリはバッジなしで通常動作する。
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  setSettings({ notificationRequested: true });
  if (!("Notification" in window)) return "denied";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** 初回のみ通知許可を自動リクエストする。 */
export async function maybeRequestNotificationPermissionOnce(): Promise<void> {
  const { notificationRequested } = getSettings();
  if (!notificationRequested) {
    await requestNotificationPermission();
  }
}
