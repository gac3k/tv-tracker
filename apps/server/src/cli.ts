import "reflect-metadata";
import { parseArgs } from "node:util";
import { NestFactory } from "@nestjs/core";
import type { INestApplicationContext } from "@nestjs/common";
import { AppModule } from "./app.module";
import { config } from "./config";
import { ObservationsService } from "./observations/observations.service";
import { JobsService } from "./jobs/jobs.service";
import { PluginRegistry } from "./plugins/registry.service";
import { ProviderError } from "./providers/errors";
import type { PlaybackObservation, ProviderName } from "./providers/provider";
import { SyncService } from "./sync/sync.service";

const USAGE = `Usage:
  pnpm cli login <provider>                 Interactive login in a visible browser
  pnpm cli status <provider>                Check persisted session authentication
  pnpm cli sync <provider> [options]        Fetch history (and persist it)

Sync options:
  --dry-run        Fetch and print, do not persist
  --debug          Dump raw payloads to stdout
  --save-fixture   Save sanitized raw responses to .data/fixtures/<provider>/
  --pages <n>      History pages to fetch (default ${config.SYNC_PAGES}, 50 items each)

Providers: netflix (prime, max, apple, disney planned)`;

function formatTable(observations: PlaybackObservation[]): string {
  const header = ["Provider", "Type", "Show", "Title", "S", "E", "Progress", "Watched"];
  const rows = observations.map((o) => [
    o.provider,
    o.mediaType,
    o.showTitle ?? "-",
    (o.title ?? "-").slice(0, 40),
    o.seasonNumber?.toString() ?? "-",
    o.episodeNumber?.toString() ?? "-",
    o.progress !== undefined ? `${Math.round(o.progress)}%` : "-",
    o.watchedAt ? o.watchedAt.toISOString().slice(0, 10) : "-",
  ]);
  const all = [header, ...rows];
  const widths = header.map((_, i) => Math.max(...all.map((r) => (r[i] ?? "").length)));
  return all
    .map((r) => r.map((cell, i) => (cell ?? "").padEnd(widths[i] ?? 0)).join("  "))
    .join("\n");
}

async function run(app: INestApplicationContext): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      "dry-run": { type: "boolean", default: false },
      debug: { type: "boolean", default: false },
      "save-fixture": { type: "boolean", default: false },
      pages: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const [command, providerName] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return;
  }
  if (!providerName) {
    console.error(`Missing provider name.\n\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  const sync = app.get(SyncService);
  const observations = app.get(ObservationsService);
  const jobs = app.get(JobsService);
  const plugins = app.get(PluginRegistry);
  const plugin = plugins.has(providerName) ? plugins.get(providerName) : null;
  plugin?.instance.applySettings?.(plugin.settings);
  const provider = plugin ? null : sync.getProvider(providerName);

  switch (command) {
    case "login": {
      if (plugin) await plugin.instance.login?.();
      else await provider!.login();
      const status = plugin
        ? ((await plugin.instance.isAuthenticated?.()) ?? { authenticated: false })
        : await provider!.isAuthenticated();
      console.log(
        status.authenticated
          ? `Authenticated as profile: ${status.profileName ?? "(unknown)"}`
          : "Warning: session does not look authenticated yet. Re-run login if sync fails."
      );
      break;
    }

    case "status": {
      const name = plugin?.meta.id ?? provider!.name;
      const status = plugin
        ? ((await plugin.instance.isAuthenticated?.()) ?? { authenticated: true })
        : await provider!.isAuthenticated();
      const state = observations.getSyncState(name as ProviderName);
      console.log(`${name}:`);
      console.log(`  authenticated: ${status.authenticated ? "yes" : "no"}`);
      if (status.profileName) {
        console.log(`  profile: ${status.profileName}`);
      }
      if (state?.lastSyncAt) {
        console.log(`  last sync: ${state.lastSyncAt.toISOString()} (${state.lastSyncStatus})`);
      }
      if (!status.authenticated) {
        console.log(`  hint: run \`pnpm cli login ${name}\``);
      }
      break;
    }

    case "sync": {
      const options = {
        pages: values.pages ? Number(values.pages) : undefined,
        saveFixture: values["save-fixture"],
      };
      if (values["dry-run"]) {
        if (plugin) {
          console.error("Plugins have no dry-run fetch. Omit --dry-run to emit a sync event.");
          process.exitCode = 1;
          break;
        }
        const fetched = await provider!.sync(options);
        console.log(formatTable(fetched));
        console.log(`\n${fetched.length} observations fetched (dry run, nothing persisted).`);
        if (values.debug) {
          console.log(JSON.stringify(fetched, null, 2));
        }
      } else {
        const { results } = await jobs.execute({
          trigger: "cli",
          provider: (plugin?.meta.id ?? provider!.name) as ProviderName,
          options,
        });
        const result = results[0];
        if (!result || result.status !== "success") {
          console.error(
            `Sync ${result?.status ?? "failed"}: ${result?.error ?? "unknown error"} (${result?.errorType ?? ""})`
          );
          process.exitCode = 1;
          break;
        }
        console.log(
          result.exported != null
            ? `Export done: ${result.exported} marked, ${result.unmatched ?? 0} unmatched.`
            : `Sync done: ${result.fetched} fetched, ${result.inserted} new, ` +
                `${result.skipped} already known, ${result.sessions} derived sessions.`
        );
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}\n\n${USAGE}`);
      process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  if (err instanceof ProviderError) {
    console.error(`\n${err.name}: ${err.message}`);
  } else {
    console.error(err);
  }
  process.exitCode = 1;
});
