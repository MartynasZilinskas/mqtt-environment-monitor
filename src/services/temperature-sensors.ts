import { differenceInSeconds } from "date-fns";
import {
  Context,
  Effect,
  Filter,
  HashMap,
  Layer,
  Option,
  pipe,
  Ref,
  Stream,
} from "effect";
import { MqttService, type MqttError, type MqttMessage } from "./mqtt";

const parseTemperatureMessage = (
  message: MqttMessage,
): Option.Option<readonly [string, number]> => {
  const temperature = parseFloat(message.payload.toString());

  return Number.isNaN(temperature)
    ? Option.none()
    : Option.some([message.topic, temperature]);
};

type TemperatureReadings = HashMap.HashMap<
  string,
  { value: number; dateUpdated: Date }
>;

const removeStaleAndUpdateReadings =
  (topic: string, temperature: number) =>
  (previousReadings: TemperatureReadings) =>
    pipe(
      HashMap.filter(
        previousReadings,
        (reading) => differenceInSeconds(new Date(), reading.dateUpdated) < 60,
      ),
      HashMap.set(topic, {
        value: temperature,
        dateUpdated: new Date(),
      }),
    );

export interface TemperatureSensorsService {
  readonly averageTemperatureStream: (
    topics: ReadonlyArray<string>,
  ) => Stream.Stream<number, MqttError>;
}

export const TemperatureSensorsService =
  Context.Service<TemperatureSensorsService>("@app/TemperatureSensorsService");

export const TemperatureSensorsServiceLive = Layer.effect(
  TemperatureSensorsService,
  Effect.gen(function* () {
    const mqtt = yield* MqttService;

    return TemperatureSensorsService.of({
      averageTemperatureStream: (topics) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const lastReadingsRef = yield* Ref.make<TemperatureReadings>(
              HashMap.empty(),
            );

            return mqtt.messages(topics).pipe(
              Stream.filterMap(
                Filter.fromPredicateOption(parseTemperatureMessage),
              ),
              Stream.tap(([topic, temperature]) =>
                Effect.logInfo(
                  `Got reading from '${topic}' -> Temperature: ${temperature}`,
                )
              ),
              Stream.mapEffect(([topic, temperature]) =>
                Ref.updateAndGet(
                  lastReadingsRef,
                  removeStaleAndUpdateReadings(topic, temperature),
                )
              ),
              Stream.map((readings) =>
                HashMap.reduce(
                  readings,
                  0,
                  (acc, reading) => acc + reading.value,
                ) / HashMap.size(readings)
              ),
              Stream.map((temperature) => parseFloat(temperature.toFixed(2))),
              Stream.tap((temperature) =>
                Effect.logInfo(`Average temperature: ${temperature}`)
              ),
            );
          }),
        ),
    });
  }),
);
