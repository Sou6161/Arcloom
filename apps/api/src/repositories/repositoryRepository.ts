import type { Prisma, Repository as RepositoryModel } from '@prisma/client';
import { prisma } from '../database/prisma.js';

/**
 * Data-access layer for repositories. Encapsulates all Prisma queries so
 * services stay persistence-agnostic.
 */
export const repositoryRepository = {
  create(data: Prisma.RepositoryCreateInput): Promise<RepositoryModel> {
    return prisma.repository.create({ data });
  },

  findById(id: string): Promise<RepositoryModel | null> {
    return prisma.repository.findUnique({ where: { id } });
  },

  list(ownerToken: string): Promise<RepositoryModel[]> {
    return prisma.repository.findMany({
      where: { ownerToken },
      orderBy: { createdAt: 'desc' },
    });
  },

  /** How many projects a visitor currently has. */
  countByOwner(ownerToken: string): Promise<number> {
    return prisma.repository.count({ where: { ownerToken } });
  },

  /** Projects older than `cutoff`, for scheduled cleanup. */
  findOlderThan(cutoff: Date): Promise<RepositoryModel[]> {
    return prisma.repository.findMany({ where: { createdAt: { lt: cutoff } } });
  },

  update(
    id: string,
    data: Prisma.RepositoryUpdateInput,
  ): Promise<RepositoryModel> {
    return prisma.repository.update({ where: { id }, data });
  },

  delete(id: string): Promise<RepositoryModel> {
    return prisma.repository.delete({ where: { id } });
  },
};
