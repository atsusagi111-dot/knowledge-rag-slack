import { runIngestCli } from "../ingest/run.js";
import { config } from "../config.js";
import { embeddingClient } from "../providers.js";
import { flag, positionals, runCli } from "../lib/cli.js";

runCli(() =>
  runIngestCli(
    { force: flag("--force"), dryRun: flag("--dry-run"), prune: flag("--prune"), retryFailed: flag("--retry-failed") },
    positionals()[0] ?? config.docsDir,
    embeddingClient(),
  ),
);
