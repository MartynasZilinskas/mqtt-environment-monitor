import { Config, Context, Effect, Layer, pipe, Stream, Option } from "effect";
import { Schema } from "@effect/schema";
import { MqttService, type MqttMessage } from "./mqtt";
import mqtt from "mqtt";

const AcState = Schema.Struct({
  target: Schema.Union(
    Schema.Number,
    Schema.Tuple(Schema.Number, Schema.Number),
  ),
});

const decodeAcStateMessage = (message: MqttMessage) =>
  pipe(
    Schema.parseJson(AcState),
    Schema.decodeUnknownOption,
  )(message.payload.toString());

const compareTemperatureTarget = (
  a: TemperatureTarget,
  b: TemperatureTarget,
) => {
  if (typeof a === "number" && typeof b === "number") {
    return a === b;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    return a[0] === b[0] && a[1] === b[1];
  }

  return false;
};

type TemperatureTarget =
  | number
  | readonly [minTemperature: number, maxTemperature: number];

type ControlCommand = Partial<{
  env: number;
  target: TemperatureTarget;
}>;

export interface FaikinAcService {
  readonly targetTemperatureStream: (
    client: mqtt.MqttClient,
  ) => Stream.Stream<TemperatureTarget, unknown, MqttService>;
  readonly sendControlCommand: (
    client: mqtt.MqttClient,
    command: ControlCommand,
  ) => Effect.Effect<void, unknown, MqttService>;
}

export const FaikinAcService = Context.GenericTag<FaikinAcService>(
  "@app/FaikinAcService",
);

export type FaikinAcConfig = Readonly<{
  faikinTopic: Option.Option<string>;
  commandControlTopic: string;
}>;

const make = ({ faikinTopic, commandControlTopic }: FaikinAcConfig) =>
  FaikinAcService.of({
    targetTemperatureStream: (client) =>
      Option.match(faikinTopic, {
        onNone: () => Stream.never,
        onSome: (topic) => Stream.unwrap(
          Effect.gen(function* () {
            const mqttService = yield* MqttService;
            yield* mqttService.subscribeTopic(client, topic);

            return mqttService.messageStream(client).pipe(
              Stream.filter((message) => message.topic === topic),
              Stream.filterMap(decodeAcStateMessage),
              Stream.map((acState) => acState.target),
              Stream.changesWith(compareTemperatureTarget),
            );
          }),
        ),
      }),
    sendControlCommand: (client, command) =>
      Effect.gen(function* () {
        const mqttService = yield* MqttService;
        yield* Effect.logInfo(`Sending control command: ${JSON.stringify(command)}`);
        yield* mqttService.sendMessage(
          client,
          commandControlTopic,
          JSON.stringify(command),
        );
      }),
  });

const layer = (config: Config.Config.Wrap<FaikinAcConfig>) =>
  Config.unwrap(config).pipe(Effect.map(make), Layer.effect(FaikinAcService));

export const FaikinAcServiceLive = layer({
  faikinTopic: Config.string("FAIKIN_AC_TOPIC").pipe(Config.option),
  commandControlTopic: Config.string("FAIKIN_AC_COMMAND_CONTROL_TOPIC"),
});
