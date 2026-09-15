import { pino } from "pino";
import { config } from "./config";

export const logger = pino({
  level: config.LOG_LEVEL,
  transport: process.stdout.isTTY
    ? { target: "pino-pretty", options: { colorize: true } }
    : undefined,
});
