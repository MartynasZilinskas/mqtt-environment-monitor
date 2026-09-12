import { Effect, Stream } from "effect";
import type { UnitConfig } from "./config";
import { FaikoutAcService } from "./services/faikout-ac";
import { TemperatureSensorsService } from "./services/temperature-sensors";

export const runUnit = Effect.fn("runUnit")(function* (config: UnitConfig) {
  const temperatureSensors = yield* TemperatureSensorsService;
  const faikoutAc = yield* FaikoutAcService;

  yield* Effect.logInfo("Starting unit controller");
  yield* temperatureSensors.averageTemperatureStream(config.sensorTopics).pipe(
    Stream.mapEffect((temperature) =>
      faikoutAc.sendControlCommand(config.acTopic, { env: temperature })
    ),
    Stream.runDrain,
  );
});

export const runControllers = (
  units: Readonly<Record<string, UnitConfig>>,
) =>
  Effect.forEach(
    Object.entries(units),
    ([unitId, config]) =>
      runUnit(config).pipe(
        Effect.tapCause((cause) =>
          Effect.logError("Unit controller failed", cause)
        ),
        Effect.annotateLogs({ unitId }),
      ),
    { concurrency: "unbounded", discard: true },
  );
