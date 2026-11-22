import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createHandler } from "./app.js";
import { loadServerConfig } from "./config.js";
import { LcdProxy } from "./lcd.js";
import { StaticSite } from "./static.js";

const cfg = loadServerConfig();
const webDist = process.env.MENTARI_WEB_DIST ?? fileURLToPath(new URL("../../web/dist/", import.meta.url));
const port = Number(process.env.PORT ?? "8080");
const host = process.env.HOST ?? "0.0.0.0";

const server = createServer(createHandler({ cfg, lcd: new LcdProxy(cfg), site: new StaticSite(webDist) }));
server.listen(port, host, () => {
  console.log(`mentari server on http://${host}:${port} (site ${webDist})`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
