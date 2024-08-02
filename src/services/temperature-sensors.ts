import {
  Context,
  Data,
  Effect,
  Option,
  Ref,
  Stream,
  Config,
  Layer,
  HashMap,
  pipe,
} from "effect";
import type mqtt from "mqtt";
import { MqttService, type MqttMessage } from "./mqtt";
import { differenceInSeconds } from "date-fns";

const parseTemperatureMessage = (
  message: MqttMessage,
): Option.Option<readonly [string, number]> => {
  const temperature = parseFloat(message.payload.toString());

  return Number.isNaN(temperature)
    ? Option.none()
    : Option.some(Data.tuple(message.topic, temperature));
};

const removeStaleAndUpdateReadings =
  (topic: string, temperature: number) =>
    (previousReadings: TemperatureReadings) =>
      pipe(
        HashMap.filterMap(previousReadings, (reading) =>
          differenceInSeconds(new Date(), reading.dateUpdated) < 60
            ? Option.some(reading)
            : Option.none(),
        ),
        HashMap.set(topic, {
          value: temperature,
          dateUpdated: new Date(),
        }),
      );

export interface TemperatureSensorsService {
  readonly averageTemperatureStream: (
    client: mqtt.MqttClient,
  ) => Stream.Stream<number, Error, MqttService>;
}

export const TemperatureSensorsService =
  Context.GenericTag<TemperatureSensorsService>(
    "@app/TemperatureSensorsService",
  );

export type TemperatureSensorsConfig = Readonly<{
  temperatureSensorTopics: string[];
}>;

type TemperatureReadings = HashMap.HashMap<
  string,
  { value: number; dateUpdated: Date }
>;

const make = ({ temperatureSensorTopics }: TemperatureSensorsConfig) =>
  TemperatureSensorsService.of({
    averageTemperatureStream: (client) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const mqttService = yield* MqttService;

          yield* mqttService.subscribeTopic(client, temperatureSensorTopics);

          const lastReadingsRef = yield* Ref.make<TemperatureReadings>(
            HashMap.empty(),
          );

          return mqttService.messageStream(client).pipe(
            Stream.filter((message) =>
              temperatureSensorTopics.includes(message.topic),
            ),
            Stream.filterMap(parseTemperatureMessage),
            Stream.tap(([topic, temperature]) => Effect.logInfo(`Got reading from '${topic}' -> Temperature: ${temperature}`)),
            Stream.mapEffect(([topic, temperature]) =>
              Ref.updateAndGet(
                lastReadingsRef,
                removeStaleAndUpdateReadings(topic, temperature),
              ),
            ),
            Stream.map(
              (readings) =>
              (HashMap.reduce(
                readings,
                0,
                (acc, reading) => acc + reading.value,
              ) / HashMap.size(readings)),
            ),
            Stream.map((temperature) => parseFloat(temperature.toFixed(2))),
            Stream.tap((temperature) => Effect.logInfo(`Average temperature: ${temperature}`)),
          );
        }),
      ),
  });

const layer = (config: Config.Config.Wrap<TemperatureSensorsConfig>) =>
  Config.unwrap(config).pipe(
    Effect.map(make),
    Layer.effect(TemperatureSensorsService),
  );

export const TemperatureSensorsServiceLive = layer({
  temperatureSensorTopics: Config.string("TEMPERATURE_SENSOR_TOPICS").pipe(
    Config.map((topics) => topics.split(",")),
  ),
});
