import { expect, test } from "bun:test";
import { Effect, Layer, Logger, Stream } from "effect";
import type { UnitConfig } from "../src/config";
import { FaikoutAcService } from "../src/services/faikout-ac";
import { TemperatureSensorsService } from "../src/services/temperature-sensors";
import { runControllers } from "../src/unit-controller";

test("controls every configured unit and annotates its logs", async () => {
  const subscriptions: Array<ReadonlyArray<string>> = [];
  const commands: Array<{ topic: string; env: number | undefined }> = [];
  const logs: Array<string> = [];

  const temperatureSensors = TemperatureSensorsService.of({
    averageTemperatureStream: (topics) => {
      subscriptions.push(topics);
      return Stream.fromIterable([21.5]);
    },
  });
  const faikoutAc = FaikoutAcService.of({
    sendControlCommand: (topic, command) =>
      Effect.gen(function* () {
        commands.push({ topic, env: command.env });
        yield* Effect.logInfo("command sent");
      }),
  });
  const testLogger = Logger.make((options) => {
    logs.push(Logger.formatSimple.log(options));
  });
  const layer = Layer.mergeAll(
    Layer.succeed(TemperatureSensorsService, temperatureSensors),
    Layer.succeed(FaikoutAcService, faikoutAc),
    Logger.layer([testLogger]),
  );
  const units: Readonly<Record<string, UnitConfig>> = {
    "living-room": {
      sensorTopics: ["sensor/living-room"],
      acTopic: "Faikout/living-room/control",
    },
    bedroom: {
      sensorTopics: ["sensor/bedroom"],
      acTopic: "Faikout/bedroom/control",
    },
  };

  await Effect.runPromise(Effect.provide(runControllers(units), layer));

  expect(subscriptions.toSorted((a, b) => a[0].localeCompare(b[0]))).toEqual([
    ["sensor/bedroom"],
    ["sensor/living-room"],
  ]);
  expect(commands.toSorted((a, b) => a.topic.localeCompare(b.topic))).toEqual([
    { topic: "Faikout/bedroom/control", env: 21.5 },
    { topic: "Faikout/living-room/control", env: 21.5 },
  ]);
  expect(logs.some((line) => line.includes("unitId=living-room"))).toBe(true);
  expect(logs.some((line) => line.includes("unitId=bedroom"))).toBe(true);
});
