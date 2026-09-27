import { buildApp } from "./app";
import { parseEnv } from "./lib/env";
import { loadRootEnv } from "./lib/load-env";

loadRootEnv();
const env = parseEnv();

const app = buildApp({
  logger: { level: env.NODE_ENV === "production" ? "info" : "debug" },
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: env.PORT, host: env.HOST });
