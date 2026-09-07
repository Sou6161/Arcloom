import path from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import { isIgnoredDirectory, isSourceFile } from '../utils/sourceFiles.js';

/** A source file discovered during the scan. */
export interface ScannedFile {
  /** Path relative to the detected project root, POSIX-style. */
  relativePath: string;
  /** Absolute path on disk. */
  absolutePath: string;
  sizeBytes: number;
  lineCount: number;
  /** Source text, already read here to count lines — reused so we never re-read. */
  content: string;
}

export interface ScanResult {
  /** Absolute path treated as the project root (unwrapped from the ZIP folder). */
  projectRoot: string;
  files: ScannedFile[];
  totalLines: number;
}

/**
 * Many ZIPs wrap the project in a single top-level folder. Unwrap nested
 * single-folder layers so repo-relative paths start at the real project root
 * (e.g. "src/App.tsx" rather than "my-app/src/App.tsx").
 */
async function detectProjectRoot(extractedDir: string): Promise<string> {
  let current = extractedDir;
  // Bound the loop to avoid pathological archives.
  for (let depth = 0; depth < 8; depth += 1) {
    const entries = await readdir(current, { withFileTypes: true });
    const visible = entries.filter(
      (e) => !e.name.startsWith('.') || e.name === '.well-known',
    );
    const dirs = visible.filter(
      (e) => e.isDirectory() && !isIgnoredDirectory(e.name),
    );
    const files = visible.filter((e) => e.isFile());

    if (files.length === 0 && dirs.length === 1) {
      current = path.join(current, dirs[0]!.name);
      continue;
    }
    break;
  }
  return current;
}

/** Counts lines, ignoring a trailing newline so empty files report 0. */
function countLines(content: string): number {
  if (content.length === 0) return 0;
  return content.replace(/\n+$/, '').split('\n').length;
}

/**
 * Scans the extracted repository for source files, returning their
 * repo-relative paths, sizes, and line counts.
 */
export async function scanRepository(extractedDir: string): Promise<ScanResult> {
  const projectRoot = await detectProjectRoot(extractedDir);
  const files: ScannedFile[] = [];
  let totalLines = 0;

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (isIgnoredDirectory(entry.name)) continue;
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile() || !isSourceFile(entry.name)) continue;

      const [info, content] = await Promise.all([
        stat(absolutePath),
        readFile(absolutePath, 'utf8'),
      ]);
      const lineCount = countLines(content);
      totalLines += lineCount;
      files.push({
        relativePath: path
          .relative(projectRoot, absolutePath)
          .split(path.sep)
          .join('/'),
        absolutePath,
        sizeBytes: info.size,
        lineCount,
        content,
      });
    }
  }

  await walk(projectRoot);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { projectRoot, files, totalLines };
}
