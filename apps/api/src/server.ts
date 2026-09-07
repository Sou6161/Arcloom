import { createApp } from './app.js';
import { port } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './database/prisma.js';
import { logger } from './utils/logger.js';
import { startRetentionSweep } from './services/retentionService.js';

async function main(): Promise<void> {
  await connectDatabase();

  // Uploads are deleted automatically after the retention window.
  startRetentionSweep();

  const app = createApp();
  // Bind to 0.0.0.0 so hosting platforms (Render) can route to the service.
  const server = app.listen(port, '0.0.0.0', () => {
    logger.info(`Decodr API listening on port ${port}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received — shutting down`);
    server.close();
    await disconnectDatabase();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('Fatal startup error', err);
  process.exit(1);
});
