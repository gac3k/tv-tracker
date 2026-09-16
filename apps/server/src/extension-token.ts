import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { UnauthorizedException } from "@nestjs/common";
import { config } from "./config";

const TOKEN_FILE = "extension.token";

export function extensionToken(): string {
  const fromEnv = process.env.EXTENSION_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const file = path.join(config.dataDir, TOKEN_FILE);
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing.length >= 16) return existing;
  } catch {
    // create below
  }
  fs.mkdirSync(config.dataDir, { recursive: true });
  const token = randomBytes(32).toString("hex");
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return token;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function assertExtensionToken(authorization: string | undefined): void {
  const provided = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  // Hash both sides so a length mismatch cannot skip the constant-time compare.
  if (!timingSafeEqual(digest(provided), digest(extensionToken()))) {
    throw new UnauthorizedException("Missing or invalid extension token");
  }
}
