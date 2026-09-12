import { Effect, Layer, Logger, Stream } from "effect";
import { MqttService, MqttServiceLive } from "./services/mqtt";
import { BunRuntime } from "@effect/platform-bun";
import { FaikinAcService, FaikinAcServiceLive } from "./services/faikin-ac";
import {
  TemperatureSensorsService,
  TemperatureSensorsServiceLive,
} from "./services/temperature-sensors";
import { logger } from "./services/logger";

const program = Effect.scoped(
  Effect.gen(function* () {
    const mqttService = yield* MqttService;
    const temperatureSensorsService = yield* TemperatureSensorsService;
    const faikinAcService = yield* FaikinAcService;

    const client = yield* mqttService.connect();

    yield* temperatureSensorsService.averageTemperatureStream(client).pipe(
      Stream.mapEffect((temperature) =>
        faikinAcService.sendControlCommand(client, { env: temperature }),
      ),
      Stream.runDrain,
    );
  }),
);

const MainLive = Layer.mergeAll(
  MqttServiceLive,
  TemperatureSensorsServiceLive,
  FaikinAcServiceLive,
  Logger.layer([logger, Logger.tracerLogger]),
);

const runnable = Effect.provide(program, MainLive);

BunRuntime.runMain(runnable);
