import { describe, expect, test } from "bun:test";
import { Effect, Option, Redacted } from "effect";
import { decodeAppConfig } from "../src/config";

const units = {
  "living-room": {
    sensorTopics: ["sensors/living-room/temperature"],
    acTopic: "Faikout/living-room/control",
  },
};

const decode = (input: unknown) =>
  Effect.runPromise(decodeAppConfig(JSON.stringify(input)));

describe("application configuration", () => {
  test("accepts paired MQTT credentials and redacts the password", async () => {
    const config = await decode({
      mqtt: {
        url: "mqtt://mqtt.example.com:1883",
        username: "thermostat",
        password: "secret",
      },
      units,
    });

    expect(Option.getOrUndefined(config.mqtt.username)).toBe("thermostat");
    expect(Option.map(config.mqtt.password, Redacted.value)).toEqual(
      Option.some("secret"),
    );
  });

  test.each([
    { url: "mqtt://mqtt.example.com:1883" },
    {
      url: "mqtt://mqtt.example.com:1883",
      username: null,
      password: null,
    },
    {
      url: "mqtt://mqtt.example.com:1883",
      username: null,
    },
  ])("accepts anonymous MQTT configuration", async (mqtt) => {
    const config = await decode({ mqtt, units });

    expect(Option.isNone(config.mqtt.username)).toBe(true);
    expect(Option.isNone(config.mqtt.password)).toBe(true);
  });

  test.each([
    {
      mqtt: {
        url: "mqtt://mqtt.example.com:1883",
        username: "thermostat",
      },
      units,
    },
    {
      mqtt: {
        url: "mqtt://mqtt.example.com:1883",
        username: null,
        password: "secret",
      },
      units,
    },
    {
      mqtt: { url: "mqtt://mqtt.example.com:1883" },
      units: {},
    },
    {
      mqtt: { url: "mqtt://mqtt.example.com:1883" },
      units: {
        "living-room": {
          sensorTopics: [],
          acTopic: "Faikout/living-room/control",
        },
      },
    },
    {
      mqtt: { url: "mqtt://mqtt.example.com:1883" },
      units,
      unexpected: true,
    },
    {
      mqtt: { url: "not-a-url" },
      units,
    },
  ])("rejects invalid configuration", async (config) => {
    await expect(decode(config)).rejects.toBeDefined();
  });
});
