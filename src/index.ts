import { BunRuntime } from "@effect/platform-bun";
import { Effect, Layer, Logger } from "effect";
import { AppConfig } from "./config";
import { FaikoutAcServiceLive } from "./services/faikout-ac";
import { logger } from "./services/logger";
import { MqttServiceLive } from "./services/mqtt";
import { TemperatureSensorsServiceLive } from "./services/temperature-sensors";
import { runControllers } from "./unit-controller";

const program = Effect.gen(function* () {
  const config = yield* AppConfig;
  yield* runControllers(config.units);
});

const ConfiguredMqttLive = MqttServiceLive.pipe(
  Layer.provideMerge(AppConfig.layer),
);

const ControllerServicesLive = Layer.mergeAll(
  TemperatureSensorsServiceLive,
  FaikoutAcServiceLive,
).pipe(Layer.provideMerge(ConfiguredMqttLive));

const MainLive = Layer.mergeAll(
  ControllerServicesLive,
  Logger.layer([logger, Logger.tracerLogger]),
);

BunRuntime.runMain(Effect.provide(program, MainLive));
