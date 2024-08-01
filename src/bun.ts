import {
  HttpServer,
  HttpServerResponse,
  HttpRouter,
  HttpMiddleware,
} from "@effect/platform";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { Layer } from "effect";

const HttpLive = HttpRouter.empty.pipe(
  HttpRouter.get("/", HttpServerResponse.text("Healthy")),
  HttpServer.serve(HttpMiddleware.logger),
);

const ServerLive = BunHttpServer.layer({ port: 3000 });

const MainLive = HttpLive.pipe(Layer.provide(ServerLive));

BunRuntime.runMain(Layer.launch(MainLive));
