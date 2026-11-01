// skirm worker: BullMQ consumers for `registry` (record_match for ranked v2 matches), `benchmarks`
// (skill benchmarks and trials) and `seasons` (the season tick). Config from env (@skirm/server
// loadConfig); NoopRegistry and NoopSeasons when NEAR_OPS_* are unset.
import { ConfigError, loadConfig } from '@skirm/server';
import { errorCode, jsonLogger } from './deps';
import { startWorkerApp } from './app';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      jsonLogger.error('invalid environment', { issues: err.issues });
      process.exit(1);
    }
    throw err;
  }
  for (const w of config.warnings) jsonLogger.warn(w);

  const app = await startWorkerApp(config, process.env);
  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    jsonLogger.info('worker stopping', { signal });
    app
      .close(Number(process.env.WORKER_SHUTDOWN_GRACE_MS ?? 30_000))
      .then(() => {
        jsonLogger.info('worker stopped');
        process.exit(0);
      })
      .catch((err) => {
        jsonLogger.error('shutdown failed', { code: errorCode(err) });
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

main().catch((err) => {
  jsonLogger.error('worker failed to start', {
    code: errorCode(err),
    message: err instanceof Error ? err.message : undefined,
  });
  process.exit(1);
});
