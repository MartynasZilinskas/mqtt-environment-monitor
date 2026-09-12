import { describe, expect, test } from "bun:test";
import { ConfigProvider, Effect, Option, Redacted } from "effect";
import { decodeFileConfig, resolveAppConfig } from "../src/config";

const units = {
  "living-room": {
    sensorTopics: ["sensors/living-room/temperature"],
    acTopic: "Faikout/living-room/control",
  },
};

const mqtt = {
  url: "mqtt://mqtt.example.com:1883",
  username: "thermostat",
  password: "secret",
};

const invalidEnvironmentSettings: Array<Record<string, string>> = [
  {
    MQTT_USERNAME: "environment-user",
    MQTT_PASSWORD: "environment-secret",
  },
  { MQTT_URL: "not-a-url" },
  {
    MQTT_URL: "mqtt://environment.example.com:1883",
    MQTT_USERNAME: "environment-user",
  },
];

const decode = (input: unknown) => decodeFileConfig(JSON.stringify(input));

const resolve = (input: unknown, env: Record<string, string> = {}) =>
  Effect.gen(function* () {
    const fileConfig = yield* decode(input);
    return yield* resolveAppConfig(fileConfig, "config.json");
  }).pipe(
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromEnv({ env }),
    ),
  );

describe("application configuration", () => {
  test("uses MQTT configuration from the file", async () => {
    const config = await Effect.runPromise(resolve({ mqtt, units }));

    expect(config.mqtt.url.toString()).toBe("mqtt://mqtt.example.com:1883");
    expect(Option.getOrUndefined(config.mqtt.username)).toBe("thermostat");
    expect(Option.map(config.mqtt.password, Redacted.value)).toEqual(
      Option.some("secret"),
    );
  });

  test("allows file MQTT configuration to be omitted when environment variables are set", async () => {
    const config = await Effect.runPromise(
      resolve(
        { units },
        {
          MQTT_URL: "mqtt://environment.example.com:1883",
          MQTT_USERNAME: "environment-user",
          MQTT_PASSWORD: "environment-secret",
        },
      ),
    );

    expect(config.mqtt.url.toString()).toBe(
      "mqtt://environment.example.com:1883",
    );
    expect(Option.getOrUndefined(config.mqtt.username)).toBe(
      "environment-user",
    );
    expect(Option.map(config.mqtt.password, Redacted.value)).toEqual(
      Option.some("environment-secret"),
    );
  });

  test("supports an anonymous MQTT connection from MQTT_URL", async () => {
    const config = await Effect.runPromise(
      resolve({ units }, { MQTT_URL: "mqtt://environment.example.com:1883" }),
    );

    expect(Option.isNone(config.mqtt.username)).toBe(true);
    expect(Option.isNone(config.mqtt.password)).toBe(true);
  });

  test("environment MQTT configuration replaces the file configuration atomically", async () => {
    const config = await Effect.runPromise(
      resolve(
        { mqtt, units },
        { MQTT_URL: "mqtt://environment.example.com:1883" },
      ),
    );

    expect(config.mqtt.url.toString()).toBe(
      "mqtt://environment.example.com:1883",
    );
    expect(Option.isNone(config.mqtt.username)).toBe(true);
    expect(Option.isNone(config.mqtt.password)).toBe(true);
  });

  test("rejects a missing MQTT configuration", async () => {
    await expect(Effect.runPromise(resolve({ units }))).rejects.toBeDefined();
  });

  test("rejects partial environment credentials instead of falling back to the file", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        resolve(
          { mqtt, units },
          {
            MQTT_URL: "mqtt://environment.example.com:1883",
            MQTT_PASSWORD: "must-not-appear",
          },
        ),
      ),
    );

    if (error._tag !== "ConfigValidationError") {
      throw error;
    }

    expect(error.path).toBe("MQTT_* environment variables");
    expect(error.message).not.toContain("must-not-appear");
  });

  test.each(invalidEnvironmentSettings)(
    "rejects incomplete or invalid environment MQTT settings",
    async (env) => {
      await expect(
        Effect.runPromise(resolve({ mqtt, units }, env)),
      ).rejects.toBeDefined();
    },
  );

  test.each([
    { mqtt: null, units },
    { mqtt: { url: "mqtt://mqtt.example.com:1883" }, units: {} },
    {
      mqtt: { url: "mqtt://mqtt.example.com:1883" },
      units: {
        "living-room": {
          sensorTopics: [],
          acTopic: "Faikout/living-room/control",
        },
      },
    },
    { mqtt: { url: "mqtt://mqtt.example.com:1883" }, units, unexpected: true },
    { mqtt: { url: "not-a-url" }, units },
    {
      mqtt: {
        url: "mqtt://mqtt.example.com:1883",
        username: "thermostat",
      },
      units,
    },
  ])("rejects invalid file configuration", async (config) => {
    await expect(Effect.runPromise(decode(config))).rejects.toBeDefined();
  });
});
