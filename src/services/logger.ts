import { Logger } from "effect";

export const logger = Logger.make(({ date, logLevel, message }) => {
  globalThis.console.log(
    `${date.toISOString()} ${logLevel.toLowerCase()}: ${message}`,
  );
});
