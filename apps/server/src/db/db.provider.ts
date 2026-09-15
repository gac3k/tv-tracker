import type { Provider } from "@nestjs/common";
import { config } from "../config";
import { openDb, type Db } from "./client";

/** Injection token for the Drizzle database handle. */
export const DB = Symbol("DB");

export const dbProvider: Provider = {
  provide: DB,
  useFactory: (): Db => openDb(config.dbPath),
};
