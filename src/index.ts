import { Console, Effect, Exit, Layer, pipe, Scope, Stream } from "effect";
import { MqttService, MqttServiceLive } from "./services/mqtt";
import { BunRuntime } from "@effect/platform-bun";
import { FaikinAcService, FaikinAcServiceLive } from "./services/faikin-ac";
import {
  TemperatureSensorsService,
  TemperatureSensorsServiceLive,
} from "./services/temperature-sensors";

const program = Effect.gen(function* () {
  const mqttService = yield* MqttService;
  const temperatureSensorsService = yield* TemperatureSensorsService;
  const faikinAcService = yield* FaikinAcService;

  const mainScope = yield* Scope.make();
  const client = yield* pipe(mqttService.connect(), Scope.extend(mainScope));


  yield* temperatureSensorsService
    .averageTemperatureStream(client)
    .pipe(
      Stream.tap((temperature) => Console.log(`Temperature: ${temperature}`)),
      Stream.mapEffect((temperature) =>
        faikinAcService.sendControlCommand(client, { env: temperature }),
      ),
      Stream.runDrain,
    );

  yield* Scope.close(mainScope, Exit.void);
});

const MainLive = MqttServiceLive.pipe(
  Layer.provideMerge(TemperatureSensorsServiceLive),
  Layer.provideMerge(FaikinAcServiceLive),
);

const runnable = Effect.provide(program, MainLive);

BunRuntime.runMain(runnable);
