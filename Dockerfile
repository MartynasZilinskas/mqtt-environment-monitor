FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

COPY . .

ENV NODE_ENV=production
RUN bun run check-types

RUN bun build --compile --minify --sourcemap ./src/index.ts --outfile app

FROM base AS release
USER bun
EXPOSE 3000/tcp
COPY --from=base /app/app .
ENTRYPOINT ["./app"]
