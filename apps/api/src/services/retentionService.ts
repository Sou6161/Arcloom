import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { storageRoot } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { removeDir } from '../utils/archive.js';
import { repositoryRepository } from '../repositories/repositoryRepository.js';
import { prisma } from '../database/prisma.js';

/** Directories under the storage root that are not project folders. */
const NON_PROJECT_DIRS = new Set(['_uploads']);

/**
 * Uploaded projects are deleted automatically after this long.
 *
 * The landing page promises visitors that their code is not kept. This sweep is
 * what makes that true by construction rather than by policy — nobody has to
 * remember to clean up, and an abandoned session cannot leave source code
 * sitting on disk indefinitely.
 */
const RETENTION_HOURS = 48;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly

/** Deletes every project older than the retention window. Safe to call anytime. */
export async function purgeExpiredRepositories(): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000);
  const expired = await repositoryRepository.findOlderThan(cutoff);
  if (expired.length === 0) return 0;

  let removed = 0;
  for (const repo of expired) {
    try {
      // Database first: the row is the source of truth, and cascades take the
      // files, components, graph and conversations with it.
      await repositoryRepository.delete(repo.id);
      // Then the extracted source, whether or not the recorded path is usable.
      await removeDir(path.join(storageRoot, repo.id)).catch(() => undefined);
      removed += 1;
    } catch (err) {
      logger.error(
        `Retention sweep could not delete ${repo.id}: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  logger.info(`Retention sweep removed ${removed} project(s) older than ${RETENTION_HOURS}h`);
  return removed;
}

/**
 * Deletes storage directories with no matching project row.
 *
 * Rows are removed by cascade when a project is deleted, but a crash between the
 * two steps — or any delete that predates this sweep — can leave the extracted
 * source behind. Without this, orphaned code would sit on disk forever, which is
 * exactly what the retention promise is meant to prevent.
 */
export async function purgeOrphanedDirectories(): Promise<number> {
  let entries: string[];
  try {
    entries = (await readdir(storageRoot, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !NON_PROJECT_DIRS.has(e.name))
      .map((e) => e.name);
  } catch {
    return 0; // storage root not created yet
  }
  if (entries.length === 0) return 0;

  const known = new Set(
    (await prisma.repository.findMany({ where: { id: { in: entries } }, select: { id: true } }))
      .map((r) => r.id),
  );

  let removed = 0;
  for (const dir of entries) {
    if (known.has(dir)) continue;
    await removeDir(path.join(storageRoot, dir)).catch(() => undefined);
    removed += 1;
  }
  if (removed > 0) logger.info(`Retention sweep removed ${removed} orphaned director(ies)`);
  return removed;
}

/**
 * Starts the hourly sweep. The timer is unref'd so it never holds the process
 * open during shutdown.
 */
export function startRetentionSweep(): NodeJS.Timeout {
  const sweep = async (): Promise<void> => {
    await purgeExpiredRepositories();
    await purgeOrphanedDirectories();
  };

  void sweep().catch((err) => logger.error('Initial retention sweep failed', err));
  const timer = setInterval(() => {
    void sweep().catch((err) => logger.error('Retention sweep failed', err));
  }, SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}
