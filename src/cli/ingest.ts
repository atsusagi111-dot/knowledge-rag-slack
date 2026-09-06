import { runIngestCli } from "../ingest/run.js";

runIngestCli(process.argv.slice(2)).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
