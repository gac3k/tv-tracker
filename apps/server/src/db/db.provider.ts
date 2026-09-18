import type { Provider } from "@nestjs/common";
import { ensureAdmin, initAuth } from "../auth";
import { config } from "../config";
import { openDb, type Db } from "./client";

/** Injection token for the Drizzle database handle. */
export const DB = Symbol("DB");

export const dbProvider: Provider = {
  provide: DB,
  useFactory: (): Db => {
    const db = openDb(config.dbPath);
    initAuth(db);
    ensureAdmin();
    return db;
  },
};
