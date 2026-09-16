import { Module } from "@nestjs/common";
import { ArtworkService } from "./artwork/artwork.service";
import { dbProvider } from "./db/db.provider";
import { HistoryController } from "./http/history.controller";
import { JobsController } from "./http/jobs.controller";
import { LibraryController } from "./http/library.controller";
import { WatchlistController } from "./http/watchlist.controller";
import { ShowsController } from "./http/shows.controller";
import { LibraryService } from "./library/library.service";
import { WatchlistService } from "./watchlist/watchlist.service";
import { ShowsService } from "./shows/shows.service";
import { RemoteLoginController } from "./http/remote-login.controller";
import { RemoteLoginService } from "./remote-login/remote-login.service";
import { ProvidersController } from "./http/providers.controller";
import { ExtensionController } from "./http/extension.controller";
import { SettingsController } from "./http/settings.controller";
import { ObservationsService } from "./observations/observations.service";
import { SessionsService } from "./sessions/sessions.service";
import { ProviderRegistry } from "./providers/registry.service";
import { PluginRegistry } from "./plugins/registry.service";
import { SyncService } from "./sync/sync.service";
import { JobsService } from "./jobs/jobs.service";
import { SyncQueue } from "./jobs/sync.queue";

/** Single module — the service is small; split into feature modules when it isn't. */
@Module({
  controllers: [
    ProvidersController,
    ExtensionController,
    SettingsController,
    HistoryController,
    LibraryController,
    WatchlistController,
    ShowsController,
    RemoteLoginController,
    JobsController,
  ],
  providers: [
    dbProvider,
    ObservationsService,
    SessionsService,
    ProviderRegistry,
    PluginRegistry,
    SyncService,
    ArtworkService,
    LibraryService,
    WatchlistService,
    ShowsService,
    RemoteLoginService,
    JobsService,
    SyncQueue,
  ],
})
export class AppModule {}
