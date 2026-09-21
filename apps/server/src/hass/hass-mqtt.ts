import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import mqtt, { type MqttClient } from "mqtt";
import { desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { DB } from "../db/db.provider";
import { ADMIN_USER_ID, playbackSessions, providerObservations } from "../db/schema";
import { logger } from "../logger";
import { readAppSettings } from "../settings/app-settings";
import { appVersion } from "../version";
import { discoveryPayload, pickLastWatched, statePayload } from "./payload";

const log = logger.child({ component: "hass-mqtt" });

@Injectable()
export class HomeAssistantMqtt implements OnModuleInit, OnApplicationShutdown {
  private client: MqttClient | null = null;
  private url: string | null = null;

  constructor(@Inject(DB) private readonly db: Db) {}

  onModuleInit(): void {
    this.reconnect();
  }

  onApplicationShutdown(): void {
    this.drop();
  }

  /** Re-read YAML/env and connect or disconnect. */
  reconnect(): void {
    const url = readAppSettings().mqttUrl ?? null;
    if (!url) {
      this.drop();
      return;
    }
    if (this.client && this.url === url) {
      this.publish();
      return;
    }
    this.drop();
    this.url = url;
    const client = mqtt.connect(url, {
      clientId: `tv-tracker-${process.pid}`,
      reconnectPeriod: 10_000,
      connectTimeout: 8_000,
    });
    this.client = client;
    client.on("connect", () => {
      log.info({ broker: redactBroker(url) }, "mqtt connected");
      this.publish();
    });
    client.on("error", (err) => {
      log.warn({ err: err.message }, "mqtt error");
    });
  }

  /** Discovery + Last Watched state. Safe to call after a sync. */
  publish(): void {
    const client = this.client;
    if (!client?.connected) return;
    const settings = readAppSettings();
    const version = appVersion();
    const discovery = discoveryPayload(settings.discoveryPrefix, version);
    const last = pickLastWatched(
      this.db
        .select()
        .from(playbackSessions)
        .where(eq(playbackSessions.userId, ADMIN_USER_ID))
        .orderBy(desc(playbackSessions.endedAt))
        .limit(1)
        .all(),
      this.db
        .select()
        .from(providerObservations)
        .where(eq(providerObservations.userId, ADMIN_USER_ID))
        .orderBy(desc(providerObservations.observedAt), desc(providerObservations.id))
        .limit(1)
        .all()
    );
    const state = statePayload(last);
    client.publish(discovery.topic, JSON.stringify(discovery.body), { qos: 1, retain: true });
    client.publish(state.topic, JSON.stringify(state.body), { qos: 1, retain: true });
  }

  private drop(): void {
    if (!this.client) return;
    this.client.removeAllListeners();
    this.client.end(true);
    this.client = null;
    this.url = null;
  }
}

function redactBroker(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "mqtt";
  }
}
