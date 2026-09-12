import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";

const HttpLive = HttpRouter.add(
  "GET",
  "/",
  HttpServerResponse.text("Healthy"),
).pipe(HttpRouter.serve);

const ServerLive = BunHttpServer.layer({ port: 3000 });

const MainLive = HttpLive.pipe(Layer.provide(ServerLive));

BunRuntime.runMain(Layer.launch(MainLive));
