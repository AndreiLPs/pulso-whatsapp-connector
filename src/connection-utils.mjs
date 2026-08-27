const terminalDisconnectCodes = new Set([401, 403, 411, 440, 500]);

export function disconnectCode(error) {
  const raw = error?.output?.statusCode ?? error?.data?.statusCode ?? error?.statusCode ?? 0;
  const code = Number(raw);
  return Number.isFinite(code) ? code : 0;
}

export function shouldReconnect(code, attempts, maximumAttempts = 5) {
  return attempts < maximumAttempts && !terminalDisconnectCodes.has(code);
}

export function reconnectDelay(code, attempts) {
  if (code === 515) return 300;
  return Math.min(5_000, 500 * (2 ** Math.max(0, attempts)));
}
