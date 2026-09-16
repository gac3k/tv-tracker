export function appVersion(): string {
  return process.env["APP_VERSION"]?.trim() || "dev";
}
