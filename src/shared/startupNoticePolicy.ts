export const CURRENT_NOTICE_VERSION = 1;

export function normalizeAcknowledgedNoticeVersion(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function shouldShowStartupNotice(
  acknowledgedVersion: unknown,
  currentVersion = CURRENT_NOTICE_VERSION
) {
  const normalizedCurrentVersion = normalizeAcknowledgedNoticeVersion(currentVersion);
  if (normalizedCurrentVersion === 0) return false;
  return normalizeAcknowledgedNoticeVersion(acknowledgedVersion) < normalizedCurrentVersion;
}
