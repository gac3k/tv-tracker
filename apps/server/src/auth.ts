import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { fromNodeHeaders } from "better-auth/node";
import { username } from "better-auth/plugins";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "./db/client";
import { ADMIN_USER_ID, account, session, user, verification } from "./db/schema";
import { config } from "./config";
import { assertExtensionToken } from "./extension-token";

const actor = new AsyncLocalStorage<string>();

export function actorUserId(): string {
  return actor.getStore() ?? ADMIN_USER_ID;
}

export function runAsUser<T>(userId: string, fn: () => T): T {
  return actor.run(userId, fn);
}

// ponytail: Node scrypt, swap to better-auth default hasher if hashes must interop elsewhere
function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;
  const next = scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  try {
    return timingSafeEqual(Buffer.from(keyHex, "hex"), next);
  } catch {
    return false;
  }
}

export function createAuth(db: Db) {
  return betterAuth({
    baseURL: config.AUTH_BASE_URL,
    basePath: "/api/auth",
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: config.AUTH_TRUSTED_ORIGINS,
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: { user, session, account, verification },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 5,
      requireEmailVerification: false,
      password: {
        hash: async (value) => hashPassword(value),
        verify: async ({ hash, password }) => verifyPassword(password, hash),
      },
    },
    plugins: [username({ displayUsername: false, minUsernameLength: 3 })],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let authInstance: Auth | undefined;
let dbInstance: Db | undefined;

export function initAuth(db: Db): Auth {
  dbInstance = db;
  authInstance = createAuth(db);
  return authInstance;
}

export function getAuth(): Auth {
  if (!authInstance) throw new Error("auth not initialized");
  return authInstance;
}

export function ensureAdmin(): void {
  if (!dbInstance) throw new Error("auth not initialized");
  const existing = dbInstance.select({ id: user.id }).from(user).where(eq(user.id, ADMIN_USER_ID)).get();
  if (existing) return;
  const now = new Date();
  dbInstance
    .insert(user)
    .values({
      id: ADMIN_USER_ID,
      name: "Admin",
      email: "admin@tv.local",
      emailVerified: true,
      username: "admin",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  dbInstance
    .insert(account)
    .values({
      id: "admin-credential",
      accountId: ADMIN_USER_ID,
      providerId: "credential",
      userId: ADMIN_USER_ID,
      password: hashPassword("admin"),
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

function requestPath(url: string): string {
  const raw = url.split("?")[0] ?? url;
  try {
    return raw.includes("://") ? new URL(raw).pathname : raw;
  } catch {
    return raw;
  }
}

/** Health, Better Auth, and MCP stay open. MCP auth later if the LAN is no longer the trust boundary. */
export function isPublicAuthPath(url: string): boolean {
  const path = requestPath(url);
  return path === "/health" || path.startsWith("/api/auth") || path === "/mcp" || path.startsWith("/mcp/");
}

function extensionOwner(authorization: string | undefined): boolean {
  try {
    assertExtensionToken(authorization);
    return true;
  } catch {
    return false;
  }
}

export function mountAuth(app: FastifyInstance, auth: Auth): void {
  app.route({
    method: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    url: "/api/auth/*",
    async handler(request: FastifyRequest, reply: FastifyReply) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const headers = fromNodeHeaders(request.headers);
      const body =
        request.method === "GET" || request.method === "HEAD" || request.body == null
          ? undefined
          : typeof request.body === "string"
            ? request.body
            : JSON.stringify(request.body);
      const req = new Request(url.toString(), {
        method: request.method,
        headers,
        ...(body ? { body } : {}),
      });
      const response = await auth.handler(req);
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        reply.header(key, value);
      });
      return reply.send(response.body ? await response.text() : null);
    },
  });

  app.addHook("onRequest", (request, reply, done) => {
    if (
      request.method === "OPTIONS" ||
      isPublicAuthPath(request.url) ||
      isPublicAuthPath(request.raw.url ?? "")
    ) {
      done();
      return;
    }
    if (extensionOwner(request.headers.authorization)) {
      actor.run(ADMIN_USER_ID, done);
      return;
    }
    void auth.api
      .getSession({ headers: fromNodeHeaders(request.headers) })
      .then((sessionValue) => {
        if (!sessionValue) {
          void reply.code(401).send({ error: "unauthorized" });
          return;
        }
        actor.run(sessionValue.user.id, done);
      })
      .catch(done);
  });
}
