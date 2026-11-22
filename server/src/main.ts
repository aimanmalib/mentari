import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createHandler } from "./app.js";
import { loadServerConfig } from "./config.js";
import { DemoApi } from "./demo/api.js";
import { liveDemoChain } from "./demo/live.js";
import { LcdProxy } from "./lcd.js";
import { DailyMeter } from "./meter/daily.js";
import { liveMeterJob } from "./meter/live.js";
import { StaticSite } from "./static.js";

const cfg = loadServerConfig();
const webDist = process.env.MENTARI_WEB_DIST ?? fileURLToPath(new URL("../../web/dist/", import.meta.url));
const port = Number(process.env.PORT ?? "8080");
const host = process.env.HOST ?? "0.0.0.0";

// The demo sends live once both contract addresses are set and the demo sender's key file is in the read-only key
// folder; until then every demo request answers with the recorded case to show.
const demo = new DemoApi(cfg.demo, liveDemoChain({ chain: cfg.demoChain, keysDir: process.env.MENTARI_SECRETS_DIR }));
const server = createServer(createHandler({ cfg, lcd: new LcdProxy(cfg), demo, site: new StaticSite(webDist) }));
server.listen(port, host, () => {
  console.log(`mentari server on http://${host}:${port} (site ${webDist})`);
});

// The meter job turns on once `contracts.mentari` is set and the meter key file is in the read-only key folder;
// until then the daily run logs that it is off.
const meterJob = liveMeterJob({
  cfg: cfg.meterJob.model,
  chain: cfg.meterJob.chain,
  keysDir: process.env.MENTARI_SECRETS_DIR,
  windowDays: cfg.meterJob.windowDays,
});
const meter = new DailyMeter(meterJob, cfg.meter);
void meter.start();

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    meter.stop();
    server.close(() => process.exit(0));
  });
}
