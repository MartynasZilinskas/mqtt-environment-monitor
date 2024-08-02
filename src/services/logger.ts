import { Logger } from "effect";

export const logger = Logger.make(({ logLevel, message }) => {
    globalThis.console.log(`${new Date().toISOString()} ${logLevel.label.toLowerCase()}: ${message}`)
});
