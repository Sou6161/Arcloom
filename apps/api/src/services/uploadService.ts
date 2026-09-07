import type { Repository } from '@decodr/types';
import { RepositoryStatus } from '@decodr/types';
import { repositoryRepository } from '../repositories/repositoryRepository.js';
import { toRepositoryDto } from '../repositories/repositoryMapper.js';
import { AppError } from '../utils/AppError.js';
import { processRepository, processFolder, type StagedFile } from './repositoryProcessor.js';

/**
 * Most projects a single visitor may keep at once. Without auth this is the only
 * bound on how much one person can store, so it protects both disk and database.
 */
const MAX_PROJECTS_PER_VISITOR = 10;

/** Rejects the upload when the visitor is already at their project limit. */
async function assertUnderProjectLimit(ownerToken: string): Promise<void> {
  const existing = await repositoryRepository.countByOwner(ownerToken);
  if (existing >= MAX_PROJECTS_PER_VISITOR) {
    throw AppError.badRequest(
      `You can keep up to ${MAX_PROJECTS_PER_VISITOR} projects at once. ` +
        'Delete one to upload another.',
    );
  }
}

/** Cleans a raw folder/zip name into a display name. */
function cleanName(raw: string): string {
  const base = raw.replace(/\.zip$/i, '').trim();
  const cleaned = base.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 120) : 'Untitled repository';
}

export const uploadService = {
  /**
   * Persists a repository for an uploaded ZIP and kicks off processing in the
   * background. Returns immediately so the client can poll for progress.
   */
  async uploadAndProcess(
    file: Express.Multer.File,
    ownerToken: string,
  ): Promise<Repository> {
    // Disk storage populates `path`; guard against an empty/missing upload.
    if (!file?.path) {
      throw AppError.badRequest('No file was uploaded under field "file".');
    }
    await assertUnderProjectLimit(ownerToken);

    const repo = await repositoryRepository.create({
      name: cleanName(file.originalname),
      ownerToken,
      status: RepositoryStatus.Pending,
      // Replaced with the detected project root once scanning completes.
      storagePath: 'pending',
    });

    // Detached: the processor extracts from the temp path, cleans it up, and
    // records failures as FAILED status itself.
    void processRepository(repo.id, file.path);

    return toRepositoryDto(repo);
  },

  /**
   * Persists a repository from a set of already-filtered source files (direct
   * folder upload) and kicks off processing in the background.
   */
  async uploadFolderAndProcess(params: {
    name: string;
    files: StagedFile[];
    ownerToken: string;
  }): Promise<Repository> {
    if (params.files.length === 0) {
      throw AppError.badRequest('No source files were found in that folder.');
    }
    await assertUnderProjectLimit(params.ownerToken);

    const repo = await repositoryRepository.create({
      name: cleanName(params.name),
      ownerToken: params.ownerToken,
      status: RepositoryStatus.Pending,
      storagePath: 'pending',
    });

    void processFolder(repo.id, params.files);

    return toRepositoryDto(repo);
  },
};
