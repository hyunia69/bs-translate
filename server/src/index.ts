import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { loadConfig } from "./config.js";
import { DualHub } from "./dual.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerDataRoutes } from "./routes/data.js";
import { registerDualRoutes } from "./routes/dual.js";
import { registerLiveRoutes } from "./routes/live.js";
import { registerSessionRoutes } from "./routes/session.js";
import { registerStatic } from "./routes/static.js";

let cfg;
try {
  cfg = loadConfig();
} catch (err) {
  console.error(`Configuration error: ${(err as Error).message}`);
  process.exit(1);
}

const app = Fastify({
  trustProxy: true,
  bodyLimit: 1024 * 1024,
  logger: {
    level: "info",
    serializers: {
      req: (req) => ({ method: req.method, url: req.url?.split("?")[0], remoteAddress: req.ip }),
    },
  },
});

app.setErrorHandler((err: { statusCode?: number; code?: string }, req, reply) => {
  const status = err.statusCode ?? 500;
  if (status === 429) return reply.code(429).send({ error: "rate_limited" });
  if (status === 413) return reply.code(413).send({ error: "payload_too_large" });
  if (status >= 400 && status < 500) return reply.code(status).send({ error: "bad_request" });
  req.log.error({ code: err.code }, "unhandled error");
  return reply.code(500).send({ error: "internal_error" });
});

const dualHub = await DualHub.load(cfg.dataDir);

await app.register(rateLimit, { global: false });
registerAuthRoutes(app, cfg);
registerSessionRoutes(app, cfg, dualHub);
registerLiveRoutes(app, cfg, dualHub);
registerDataRoutes(app, cfg);
registerDualRoutes(app, cfg, dualHub);
await registerStatic(app, cfg);

if (!cfg.openaiApiKey) app.log.warn("OPENAI_API_KEY is empty: /api/session will return 503");

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info(`${signal} received, shutting down`);
  try {
    await app.close();
    process.exit(0);
  } catch {
    process.exit(1);
  }
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port: cfg.port, host: cfg.host });
} catch (err) {
  app.log.error({ message: (err as Error).message }, "failed to start");
  process.exit(1);
}
