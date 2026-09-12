import { Logger } from "effect";

export const logger = Logger.withConsoleLog(Logger.formatSimple);
