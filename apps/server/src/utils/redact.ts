/** Recursively redact sensitive-looking keys before writing fixtures to disk. */
const SENSITIVE_KEY = /auth|token|cookie|guid|email|secret|password|session/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(val);
    }
    return out;
  }
  return value;
}
