import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";

const NO_CACHE = new Set(["index.html", "sw.js", "manifest.webmanifest"]);

export async function registerStatic(app: FastifyInstance, cfg: Config): Promise<void> {
  if (!cfg.webDist) return;
  await app.register(fastifyStatic, {
    root: cfg.webDist,
    setHeaders(res, filePath) {
      const name = filePath.split(/[\\/]/).pop() ?? "";
      if (NO_CACHE.has(name)) res.header("Cache-Control", "no-cache");
    },
  });
  app.setNotFoundHandler(async (req, reply) => {
    const isApi = req.url === "/health" || req.url.startsWith("/api");
    if (req.method === "GET" && !isApi) {
      return reply.header("Cache-Control", "no-cache").sendFile("index.html");
    }
    return reply.code(404).send({ error: "not_found" });
  });
}
