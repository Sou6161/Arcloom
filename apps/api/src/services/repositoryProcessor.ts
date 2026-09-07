import path from 'node:path';
import { mkdir, rename, copyFile } from 'node:fs/promises';
import { RepositoryStatus } from '@decodr/types';
import { storageRoot } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/AppError.js';
import { extractZipFile, removeDir, removeFile } from '../utils/archive.js';
import { scanRepository } from '../scanner/fileScanner.js';
import { repositoryRepository } from '../repositories/repositoryRepository.js';
import { fileRepository } from '../repositories/fileRepository.js';
import { analyzeAndPersist } from './analysisService.js';

/**
 * How much of each file to persist. Explanations truncate at 22k chars per file,
 * so anything beyond this is never sent to the model — storing more would only
 * grow the database.
 */
const STORED_CONTENT_LIMIT = 64_000;

/** A file staged on disk (temp path) with the repo-relative path it should live at. */
export interface StagedFile {
  tempPath: string;
  relativePath: string;
}

/**
 * Scans a prepared project directory, parses it, and persists the results:
 *
 *   SCANNING → ANALYZING → READY
 *
 * Shared by both intake paths (ZIP extraction and direct folder upload).
 */
async function runAnalysis(repositoryId: string, projectDir: string): Promise<void> {
  await repositoryRepository.update(repositoryId, { status: RepositoryStatus.Scanning });
  const scan = await scanRepository(projectDir);

  if (scan.files.length === 0) {
    throw AppError.unprocessable(
      'No React/TypeScript source files were found. Upload a React or TypeScript project.',
    );
  }

  await fileRepository.deleteByRepository(repositoryId);
  await fileRepository.createMany(
    scan.files.map((f) => ({
      repositoryId,
      path: f.relativePath,
      sizeBytes: f.sizeBytes,
      lineCount: f.lineCount,
      // Persisted so explanations keep working after the host wipes its disk.
      content: f.content.slice(0, STORED_CONTENT_LIMIT),
    })),
  );

  await repositoryRepository.update(repositoryId, {
    status: RepositoryStatus.Analyzing,
    storagePath: scan.projectRoot,
    fileCount: scan.files.length,
    totalLines: scan.totalLines,
  });

  const persistedFiles = await fileRepository.listByRepository(repositoryId);
  const counts = await analyzeAndPersist(
    repositoryId,
    scan.projectRoot,
    persistedFiles.map((f) => ({ id: f.id, path: f.path })),
  );

  await repositoryRepository.update(repositoryId, {
    status: RepositoryStatus.Ready,
    error: null,
    componentCount: counts.componentCount,
    hookCount: counts.hookCount,
    routeCount: counts.routeCount,
  });

  logger.info(
    `Repository ${repositoryId} analyzed: ${scan.files.length} files, ` +
      `${counts.componentCount} components, ${counts.hookCount} hooks, ` +
      `${counts.routeCount} routes, ${counts.edgeCount} edges`,
  );
}

async function markFailed(repositoryId: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : 'Unknown processing error';
  logger.error(`Repository ${repositoryId} failed: ${message}`);
  await repositoryRepository
    .update(repositoryId, { status: RepositoryStatus.Failed, error: message })
    .catch((updateErr) => logger.error('Failed to record FAILED status', updateErr));
}

/**
 * ZIP intake: extract the archive, then run analysis. Detached from the request;
 * failures are recorded as a FAILED status.
 */
export async function processRepository(
  repositoryId: string,
  zipPath: string,
): Promise<void> {
  const extractDir = path.join(storageRoot, repositoryId);
  try {
    await repositoryRepository.update(repositoryId, { status: RepositoryStatus.Extracting });
    await extractZipFile(zipPath, extractDir);
    await removeFile(zipPath).catch(() => undefined);
    await runAnalysis(repositoryId, extractDir);
  } catch (err) {
    await markFailed(repositoryId, err);
    await removeFile(zipPath).catch(() => undefined);
    await removeDir(extractDir).catch(() => undefined);
  }
}

/**
 * Folder intake: the client already filtered to source files, so we just place
 * each staged file at its repo-relative path (path-traversal guarded) and run
 * analysis. No archive, no node_modules — fast and small.
 */
export async function processFolder(
  repositoryId: string,
  files: StagedFile[],
): Promise<void> {
  const projectDir = path.join(storageRoot, repositoryId);
  try {
    await repositoryRepository.update(repositoryId, { status: RepositoryStatus.Extracting });

    for (const file of files) {
      const target = path.resolve(projectDir, file.relativePath);
      // Guard: the resolved path must stay within the project directory.
      if (target !== projectDir && !target.startsWith(projectDir + path.sep)) {
        throw AppError.unprocessable(`Unsafe file path: ${file.relativePath}`);
      }
      await mkdir(path.dirname(target), { recursive: true });
      // rename is atomic on the same filesystem; fall back to copy across devices.
      await rename(file.tempPath, target).catch(async () => {
        await copyFile(file.tempPath, target);
        await removeFile(file.tempPath).catch(() => undefined);
      });
    }

    await runAnalysis(repositoryId, projectDir);
  } catch (err) {
    await markFailed(repositoryId, err);
    await Promise.all(files.map((f) => removeFile(f.tempPath).catch(() => undefined)));
    await removeDir(projectDir).catch(() => undefined);
  }
}
