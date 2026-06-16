/**
 * ローカルタイムゾーンでの「今日」を "YYYY-MM-DD" で返す。
 * Date#toISOString は UTC 基準のため、日本（UTC+9）の午前0〜9時台では
 * 前日の日付になってしまう。予定日（ローカルの暦日）の比較・既定値には
 * こちらを使う。
 */
export function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
