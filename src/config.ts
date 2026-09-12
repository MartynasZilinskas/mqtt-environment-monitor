import { BunFileSystem } from "@effect/platform-bun";
import { Config, Context, Effect, Layer, Option, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";

const NonBlankString = Schema.Trimmed.check(Schema.isNonEmpty());

const MqttConfigSchema = Schema.Struct({
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
      }
  ),
);

export const UnitConfigSchema = Schema.Struct({
  sensorTopics: Schema.NonEmptyArray(NonBlankString),
  acTopic: NonBlankString,
});

export type UnitConfig = typeof UnitConfigSchema.Type;

export const AppConfigSchema = Schema.Struct({
  mqtt: MqttConfigSchema,
  units: Schema.Record(NonBlankString, UnitConfigSchema).check(
    Schema.isMinProperties(1),
  ),
});

export type AppConfigValue = typeof AppConfigSchema.Type;

const AppConfigFromJson = Schema.fromJsonString(AppConfigSchema);

export const decodeAppConfig = Schema.decodeUnknownEffect(AppConfigFromJson, {
  errors: "all",
  onExcessProperty: "error",
});

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

export const loadAppConfig = Effect.fn("loadAppConfig")(function* () {
  const path = yield* configPath;
  const fileSystem = yield* FileSystem;
  const contents = yield* fileSystem.readFileString(path).pipe(
    Effect.mapError((cause) => new ConfigFileError({ path, cause })),
  );

  return yield* decodeAppConfig(contents).pipe(
    Effect.mapError(
      (error) => new ConfigValidationError({ path, message: error.message }),
    ),
  );
});

export class AppConfig extends Context.Service<AppConfig, AppConfigValue>()(
  "@app/AppConfig",
) {
  static readonly layer = Layer.effect(AppConfig, loadAppConfig()).pipe(
    Layer.provide(BunFileSystem.layer),
  );
}
