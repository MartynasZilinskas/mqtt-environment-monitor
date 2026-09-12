import {
  Context,
  Effect,
  Layer,
  Option,
  Predicate,
  PubSub,
  Redacted,
  Schema,
  Stream,
} from "effect";
import mqtt, { type OnMessageCallback } from "mqtt";
import { AppConfig } from "../config";

export type MqttMessage = Readonly<{
  topic: string;
  payload: Buffer;
}>;

export class MqttError extends Schema.TaggedError<MqttError>()("MqttError", {
  operation: Schema.Literals(["connect", "subscribe", "publish"]),
  cause: Schema.Defect(),
}) {}

export interface MqttService {
  readonly messages: (
    topics: ReadonlyArray<string>,
  ) => Stream.Stream<MqttMessage, MqttError>;
  readonly publish: (
    topic: string,
    payload: string | Buffer,
  ) => Effect.Effect<void, MqttError>;
}

export const MqttService = Context.Service<MqttService>("@app/MqttService");

const makeMqttError = (
  operation: MqttError["operation"],
  cause: unknown,
) =>
  new MqttError({
    operation,
    cause: Predicate.isError(cause)
      ? cause
      : new Error(`MQTT ${operation} failed`, { cause }),
  });

export const MqttServiceLive = Layer.effect(
  MqttService,
  Effect.gen(function* () {
    const config = yield* AppConfig;
    const credentials = Option.product(
      config.mqtt.username,
      config.mqtt.password,
    );
    const options = Option.match(credentials, {
      onNone: () => ({}),
      onSome: ([username, password]) => ({
        username,
        password: Redacted.value(password),
      }),
    });

    const client = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () => mqtt.connectAsync(config.mqtt.url.toString(), options),
        catch: (cause) => makeMqttError("connect", cause),
      }),
      (client) =>
        Effect.tryPromise(() => client.endAsync()).pipe(
          Effect.catch((error) =>
            Effect.logError("Failed to close MQTT connection", error)
          ),
        ),
    );

    const messages = yield* PubSub.unbounded<MqttMessage>();
    yield* Effect.addFinalizer(() => PubSub.shutdown(messages));

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const messageCallback: OnMessageCallback = (topic, payload) => {
          PubSub.publishUnsafe(messages, { topic, payload });
        };

        client.on("message", messageCallback);
        return messageCallback;
      }),
      (messageCallback) =>
        Effect.sync(() => {
          client.off("message", messageCallback);
        }),
    );

    const subscribe = (
      topics: ReadonlyArray<string>,
    ): Effect.Effect<void, MqttError> =>
      Effect.callback<void, MqttError>((resume) => {
        client.subscribe([...topics], (error) => {
          resume(
            error
              ? Effect.fail(makeMqttError("subscribe", error))
              : Effect.void,
          );
        });
      });

    return MqttService.of({
      messages: (topics) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const subscription = yield* PubSub.subscribe(messages);
            yield* subscribe(topics);
            const acceptedTopics = new Set(topics);

            return Stream.fromEffectRepeat(PubSub.take(subscription)).pipe(
              Stream.filter((message) => acceptedTopics.has(message.topic)),
            );
          }),
        ),
      publish: (topic, payload) =>
        Effect.tryPromise({
          try: () => client.publishAsync(topic, payload),
          catch: (cause) => makeMqttError("publish", cause),
        }).pipe(Effect.asVoid),
    });
  }),
);
