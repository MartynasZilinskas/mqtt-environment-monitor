import { Context, Effect, Layer } from "effect";
import { MqttService, type MqttError } from "./mqtt";

export type TemperatureTarget =
  | number
  | readonly [minTemperature: number, maxTemperature: number];

export type ControlCommand = Partial<{
  env: number;
  target: TemperatureTarget;
}>;

export interface FaikoutAcService {
  readonly sendControlCommand: (
    topic: string,
    command: ControlCommand,
  ) => Effect.Effect<void, MqttError>;
}

export const FaikoutAcService = Context.Service<FaikoutAcService>(
  "@app/FaikoutAcService",
);

export const FaikoutAcServiceLive = Layer.effect(
  FaikoutAcService,
  Effect.gen(function* () {
    const mqtt = yield* MqttService;

    return FaikoutAcService.of({
      sendControlCommand: (topic, command) =>
        Effect.gen(function* () {
          yield* Effect.logInfo(
            `Sending control command: ${JSON.stringify(command)}`,
          );
          yield* mqtt.publish(topic, JSON.stringify(command));
        }),
    });
  }),
);
