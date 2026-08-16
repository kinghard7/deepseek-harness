/**
 * Bounded workspace-relative path discovery for the browser's file-reference
 * menu. This is deliberately separate from model tools: callers get paths,
 * never file bodies or Host-absolute locations.
 */
import { opendir, realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { WORKSPACE_FILE_SEARCH_RESULT_LIMIT, type WorkspaceFileItem } from './api/sessions.ts'

/** The fixed result-page maximum exposed to one browser menu. */
export const DEFAULT_WORKSPACE_FILE_SEARCH_MAX_RESULTS = WORKSPACE_FILE_SEARCH_RESULT_LIMIT
/** The maximum directory entries one browser query may inspect. */
export const DEFAULT_WORKSPACE_FILE_SEARCH_MAX_ENTRIES = 10_000

/** Bounds applied to one workspace file-reference lookup. */
export interface WorkspaceFileSearchLimits {
  /** Maximum result rows returned to the browser. */
  readonly maxResults: number
  /** Maximum filesystem entries inspected before reporting truncation. */
  readonly maxEntries: number
}

/** Result of one bounded workspace-relative path lookup. */
export interface WorkspaceFileSearchResult {
  /** Matching files and directories, all relative to the session cwd. */
  readonly items: WorkspaceFileItem[]
  /** True when the configured result or inspection bound cut the search short. */
  readonly hasMore: boolean
}

const SKIPPED_DIRECTORY_NAMES = new Set(['.git', 'node_modules'])

/** Stop promptly when the browser has superseded this request. */
function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error('workspace file search was aborted')
}

/** Convert an OS-relative path to the platform-neutral form inserted into a prompt. */
function displayPath(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}

/** Case-insensitive relative-path match after accepting either separator from the browser. */
function matches(path: string, query: string): boolean {
  return path.toLocaleLowerCase().includes(query.replaceAll('\\', '/').toLocaleLowerCase())
}

/**
 * List top-level paths for an empty query, or search descendant paths for a
 * non-empty query. Symlinks are omitted so every returned relative path stays
 * within the session's real workspace tree.
 * @param cwd - session working directory, resolved by the API gateway.
 * @param query - browser-entered relative path fragment.
 * @param limits - per-request result and inspection bounds.
 * @param signal - caller cancellation.
 * @returns matching relative file and directory paths.
 */
export async function searchWorkspaceFiles(
  cwd: string,
  query: string,
  limits: WorkspaceFileSearchLimits,
  signal: AbortSignal,
): Promise<WorkspaceFileSearchResult> {
  const root = await realpath(cwd)
  const items: WorkspaceFileItem[] = []
  let inspected = 0
  let hasMore = false

  const collect = async (directory: string, prefix: string, recursive: boolean): Promise<void> => {
    throwIfAborted(signal)
    const handle = await opendir(directory)
    try {
      for await (const entry of handle) {
        throwIfAborted(signal)
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory() && SKIPPED_DIRECTORY_NAMES.has(entry.name)) continue
        inspected += 1
        if (inspected > limits.maxEntries) {
          hasMore = true
          return
        }
        const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
        const kind = entry.isDirectory() ? 'directory' : 'file'
        if (query === '' || matches(path, query)) {
          items.push({ path: displayPath(path), kind })
          if (items.length >= limits.maxResults) {
            hasMore = true
            return
          }
        }
        if (recursive && kind === 'directory') {
          await collect(join(directory, entry.name), path, true)
          if (hasMore) return
        }
      }
    } finally {
      await handle.close().catch(() => undefined)
    }
  }

  await collect(root, '', query !== '')
  return {
    items: items.toSorted((left, right) => left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind)),
    hasMore,
  }
}
