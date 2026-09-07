import { Router } from 'express';
import { repositoryController } from '../controllers/repositoryController.js';
import { conversationController } from '../controllers/conversationController.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { uploadZip, uploadFolder } from '../middleware/upload.js';
import { requireOwnedRepository } from '../middleware/owner.js';
import { askLimiter, uploadLimiter } from '../middleware/rateLimit.js';

/** /api/repositories — every `/:id` route is gated to the caller's session. */
export const repositoryRouter: Router = Router();

// Collection routes (scoped to the caller by owner token, not by :id).
repositoryRouter.get('/', asyncHandler(repositoryController.list));
repositoryRouter.post('/', uploadLimiter, uploadZip, asyncHandler(repositoryController.upload));
repositoryRouter.post('/folder', uploadLimiter, uploadFolder, asyncHandler(repositoryController.uploadFolder));

// Everything addressed by :id must belong to the caller's session.
const owned = asyncHandler(requireOwnedRepository);

repositoryRouter.get('/:id', owned, asyncHandler(repositoryController.detail));
repositoryRouter.delete('/:id', owned, asyncHandler(repositoryController.remove));
repositoryRouter.get('/:id/progress', owned, asyncHandler(repositoryController.progress));
repositoryRouter.get('/:id/components', owned, asyncHandler(repositoryController.entities));
repositoryRouter.get('/:id/graph', owned, asyncHandler(repositoryController.graph));
repositoryRouter.get('/:id/dashboard', owned, asyncHandler(repositoryController.dashboard));

// Persistent explanation conversations
repositoryRouter.get('/:id/conversations', owned, asyncHandler(conversationController.list));
repositoryRouter.post('/:id/conversations/ask', owned, askLimiter, asyncHandler(conversationController.ask));
repositoryRouter.get('/:id/conversations/:cid', owned, asyncHandler(conversationController.detail));
repositoryRouter.delete('/:id/conversations/:cid', owned, asyncHandler(conversationController.remove));
