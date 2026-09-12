import { BunFileSystem } from "@effect/platform-bun";
import {
  Config,
  ConfigProvider,
  Context,
  Effect,
  Layer,
  Option,
  Schema,
} from "effect";
import { FileSystem } from "effect/FileSystem";

const NonBlankString = Schema.Trimmed.check(Schema.isNonEmpty());

export const MqttConfigSchema = Schema.Struct({
  url: Schema.URLFromString,
  username: Schema.OptionFromOptionalNullOr(NonBlankString),
  password: Schema.OptionFromOptionalNullOr(
    Schema.RedactedFromValue(Schema.NonEmptyString, {
      label: "mqtt.password",
    }),
  ),
}).check(
  Schema.makeFilter((mqtt) =>
    Option.isSome(mqtt.username) === Option.isSome(mqtt.password)
      ? undefined
      : {
          path: [Option.isSome(mqtt.username) ? "password" : "username"],
          issue:
            "username and password must either both be non-empty strings or both be null/omitted",
        },
  ),
);

export const UnitConfigSchema = Schema.Struct({
  sensorTopics: Schema.NonEmptyArray(NonBlankString),
  acTopic: NonBlankString,
});

export type UnitConfig = typeof UnitConfigSchema.Type;

const UnitsConfigSchema = Schema.Record(NonBlankString, UnitConfigSchema).check(
  Schema.isMinProperties(1),
);

export const FileConfigSchema = Schema.Struct({
  mqtt: Schema.OptionFromOptional(MqttConfigSchema),
  units: UnitsConfigSchema,
});

export type FileConfigValue = typeof FileConfigSchema.Type;

export const AppConfigSchema = Schema.Struct({
  mqtt: MqttConfigSchema,
  units: UnitsConfigSchema,
});

export type AppConfigValue = typeof AppConfigSchema.Type;

const FileConfigFromJson = Schema.fromJsonString(FileConfigSchema);

export const decodeFileConfig = Schema.decodeUnknownEffect(FileConfigFromJson, {
  errors: "all",
  onExcessProperty: "error",
});

const mqttFromEnvironment = Config.schema(MqttConfigSchema, "mqtt").pipe(
  Config.option,
);

export class ConfigFileError extends Schema.TaggedError<ConfigFileError>()(
  "ConfigFileError",
  {
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class ConfigValidationError extends Schema.TaggedError<ConfigValidationError>()(
  "ConfigValidationError",
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

const configPath = Config.schema(NonBlankString, "CONFIG_PATH").pipe(
  Config.withDefault("./config.json"),
);

export const resolveAppConfig = Effect.fn("resolveAppConfig")(function* (
  fileConfig: FileConfigValue,
  path: string,
) {
  const provider = yield* ConfigProvider.ConfigProvider;
  const environmentMqtt = yield* mqttFromEnvironment
    .parse(ConfigProvider.constantCase(provider))
    .pipe(
      Effect.mapError(
        () =>
          new ConfigValidationError({
            path: "MQTT_* environment variables",
            message:
              "Set MQTT_URL and either both MQTT_USERNAME and MQTT_PASSWORD or neither",
          }),
      ),
    );
  const mqtt = Option.orElse(environmentMqtt, () => fileConfig.mqtt);

  if (Option.isNone(mqtt)) {
    return yield* new ConfigValidationError({
      path,
      message:
        "MQTT configuration is required: add mqtt to the configuration file or set MQTT_URL",
    });
  }

  return {
    mqtt: mqtt.value,
    units: fileConfig.units,
  };
});

export const loadAppConfig = Effect.fn("loadAppConfig")(function* () {
  const path = yield* configPath;
  const fileSystem = yield* FileSystem;
  const contents = yield* fileSystem
    .readFileString(path)
    .pipe(Effect.mapError((cause) => new ConfigFileError({ path, cause })));

  const fileConfig = yield* decodeFileConfig(contents).pipe(
    Effect.mapError(
      (error) => new ConfigValidationError({ path, message: error.message }),
    ),
  );

  return yield* resolveAppConfig(fileConfig, path);
});

export class AppConfig extends Context.Service<AppConfig, AppConfigValue>()(
  "@app/AppConfig",
) {
  static readonly layer = Layer.effect(AppConfig, loadAppConfig()).pipe(
    Layer.provide(BunFileSystem.layer),
  );
}
