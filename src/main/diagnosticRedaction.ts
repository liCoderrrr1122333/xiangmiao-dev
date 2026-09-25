const sensitiveKeyPattern = /authorization|cookie|password|secret|api[-_]?key|access[-_]?token|refresh[-_]?token|session[-_]?token|email|account[-_]?id|user[-_]?id/i;
const sensitiveAssignmentPattern = /(authorization|cookie|password|secret|api[-_]?key|access[-_]?token|refresh[-_]?token|session[-_]?token)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const urlPattern = /https?:\/\/[^\s"'<>]+/gi;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const windowsUserPathPattern = /([A-Z]:[\\/]Users[\\/])[^\\/\s"'<>]+/gi;
const fileUrlUserPathPattern = /(file:\/{2,3}[A-Z]:\/Users\/)[^/\s"'<>]+/gi;

function sanitizeUrl(value: string) {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return value;
  }
}

function sanitizeDiagnosticString(value: string) {
  const sanitized = value
    .replace(urlPattern, (match) => sanitizeUrl(match))
    .replace(bearerPattern, 'Bearer [redacted]')
    .replace(sensitiveAssignmentPattern, (_match, key: string) => `${key}=[redacted]`)
    .replace(emailPattern, '[redacted-email]')
    .replace(windowsUserPathPattern, '$1[redacted]')
    .replace(fileUrlUserPathPattern, '$1[redacted]');
  return sanitized.length > 4096 ? `${sanitized.slice(0, 4096)}...[truncated]` : sanitized;
}

function sanitizeDiagnosticValue(value: unknown, key = '', depth = 0): unknown {
  if (sensitiveKeyPattern.test(key)) return '[redacted]';
  if (depth > 6) return '[truncated]';
  if (typeof value === 'string') return sanitizeDiagnosticString(value);
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeDiagnosticValue(item, '', depth + 1));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizeDiagnosticValue(childValue, childKey, depth + 1)
      ])
    );
  }
  return value;
}

export function sanitizeDiagnosticRecord(details: Record<string, unknown>) {
  return sanitizeDiagnosticValue(details) as Record<string, unknown>;
}
