import {
  Config,
  Context,
  Effect,
  Layer,
  Queue,
  Redacted,
  Stream,
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

export const MqttService = Context.Service<MqttService>("@app/MqttService");

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
      Effect.callback<undefined, Error>((cb) => {
        client.subscribe(topic, (err) => {
          if (err) {
            cb(Effect.fail(err));
          } else {
            cb(Effect.succeed(undefined));
          }
        });
      }),
    messageStream: (client) =>
      Stream.callback<MqttMessage>((queue) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            const messageCallback: OnMessageCallback = (topic, payload) => {
              Queue.offerUnsafe(queue, { topic, payload });
            };

            client.on("message", messageCallback);
            return messageCallback;
          }),
          (messageCallback) =>
            Effect.sync(() => {
              client.off("message", messageCallback);
            }),
        ),
      ),
    sendMessage: (client, topic, payload) =>
      Effect.tryPromise(() => client.publishAsync(topic, payload)),
  });

const layer = (config: Config.Wrap<MqttConfig>) =>
  Config.unwrap(config).pipe(Effect.map(make), Layer.effect(MqttService));

export const MqttServiceLive = layer({
  url: Config.String("MQTT_URL"),
  username: Config.String("MQTT_USERNAME"),
  password: Config.Redacted("MQTT_PASSWORD"),
});
