import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import { config } from "./config";
import { logger } from "./logger";
import { attachRemoteLoginGateway } from "./remote-login/remote-login.gateway";
import { RemoteLoginService } from "./remote-login/remote-login.service";
import { SyncQueue } from "./jobs/sync.queue";
import { LibraryService } from "./library/library.service";
import { PluginRegistry } from "./plugins/registry.service";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // Pino instance type differs from Fastify's logger interface only nominally.
    new FastifyAdapter({ loggerInstance: logger as never }),
    { logger: false } // Fastify/pino handles request logging; skip Nest's own logger
  );
  // Extension fetches from moz-extension://; Firefox still applies CORS even with host permission.
  app.enableCors({
    origin: true,
    allowedHeaders: ["Authorization", "Content-Type", "Accept"],
  });
  app.getHttpAdapter().getInstance().addHook("onRequest", (req, reply, done) => {
    if (req.headers["access-control-request-private-network"] === "true") {
      void reply.header("Access-Control-Allow-Private-Network", "true");
    }
    done();
  });
  app.enableShutdownHooks();

  // Queue + scheduler start only in the HTTP entrypoint, never in the CLI context.
  await app.get(SyncQueue).start();
  app.get(PluginRegistry).mount(app.getHttpAdapter().getInstance(), app.get(LibraryService));

  // Binding beyond 127.0.0.1 must be an explicit decision (HOST=0.0.0.0).
  await app.listen(config.PORT, config.HOST);

  // The frame stream shares Nest's HTTP server, so it inherits the same bind
  // address (127.0.0.1 unless HOST was explicitly widened).
  attachRemoteLoginGateway(app.getHttpServer(), app.get(RemoteLoginService));
}

bootstrap().catch((err: unknown) => {
  logger.error({ err }, "failed to start server");
  process.exit(1);
});
