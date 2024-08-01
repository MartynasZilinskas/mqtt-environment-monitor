import {
  Chunk,
  Config,
  Context,
  Effect,
  Layer,
  Redacted,
  Stream,
  StreamEmit,
} from "effect";
import type { Scope } from "effect/Scope";
import mqtt, { type ISubscriptionMap, type OnMessageCallback } from "mqtt";

export interface MqttService {
  readonly connect: () => Effect.Effect<mqtt.MqttClient, Error, Scope>;
  readonly subscribeTopic: (
    client: mqtt.MqttClient,
    topic: string | string[] | ISubscriptionMap,
  ) => Effect.Effect<undefined, Error>;
  readonly messageStream: (
    client: mqtt.MqttClient,
  ) => Stream.Stream<MqttMessage, never, never>;
  readonly sendMessage: (
    client: mqtt.MqttClient,
    topic: string,
    payload: string | Buffer,
  ) => Effect.Effect<void, Error, never>;
}

export const MqttService = Context.GenericTag<MqttService>("@app/MqttService");

export type MqttMessage = Readonly<{
  topic: string;
  payload: Buffer;
}>;

export type MqttConfig = Readonly<{
  url: string;
  username: string;
  password: Redacted.Redacted<string>;
}>;

const make = ({ url, username, password }: MqttConfig) =>
  MqttService.of({
    connect: () =>
      Effect.acquireRelease(
        Effect.promise(() =>
          mqtt.connectAsync(url, {
            username: username,
            password: Redacted.value(password),
          }),
        ),
        (client) => Effect.promise(() => client.endAsync()),
      ),
    subscribeTopic: (client, topic) =>
      Effect.async<undefined, Error, never>((cb) => {
        client.subscribe(topic, (err) => {
          if (err) {
            cb(Effect.fail(err));
          } else {
            cb(Effect.succeed(undefined));
          }
        });
      }),
    messageStream: (client) =>
      Stream.async((emit: StreamEmit.Emit<never, never, MqttMessage, void>) => {
        const messageCallback: OnMessageCallback = (topic, payload) => {
          emit(Effect.succeed(Chunk.of({ topic, payload })));
        };

        client.on("message", messageCallback);

        return Effect.sync(() => {
          client.off("message", messageCallback);
        });
      }),
    sendMessage: (client, topic, payload) =>
      Effect.tryPromise(() => client.publishAsync(topic, payload)),
  });

const layer = (config: Config.Config.Wrap<MqttConfig>) =>
  Config.unwrap(config).pipe(Effect.map(make), Layer.effect(MqttService));

export const MqttServiceLive = layer({
  url: Config.string("MQTT_URL"),
  username: Config.string("MQTT_USERNAME"),
  password: Config.redacted("MQTT_PASSWORD"),
});
