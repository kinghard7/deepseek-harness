import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { searchWorkspaceFiles } from '../src/workspace-file-search.ts'

const roots: string[] = []

function workspace(): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-workspace-files-')))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('searchWorkspaceFiles', () => {
  it('lists the root for an empty query and searches descendants for a path fragment', async () => {
    const root = workspace()
    mkdirSync(join(root, 'src'))
    mkdirSync(join(root, '.git'))
    mkdirSync(join(root, 'node_modules'))
    writeFileSync(join(root, 'README.md'), '# project\n')
    writeFileSync(join(root, 'src', 'index.ts'), 'export {}\n')
    writeFileSync(join(root, '.git', 'config'), '[core]\n')
    writeFileSync(join(root, 'node_modules', 'ignored.js'), '')

    await expect(searchWorkspaceFiles(root, '', { maxResults: 10, maxEntries: 100 }, new AbortController().signal))
      .resolves.toEqual({
        items: [
          { path: 'README.md', kind: 'file' },
          { path: 'src', kind: 'directory' },
        ],
        hasMore: false,
      })
    await expect(searchWorkspaceFiles(root, 'index', { maxResults: 10, maxEntries: 100 }, new AbortController().signal))
      .resolves.toEqual({
        items: [{ path: 'src/index.ts', kind: 'file' }],
        hasMore: false,
      })
  })

  it('omits symlinks and reports result-limit truncation', async () => {
    const root = workspace()
    writeFileSync(join(root, 'a.ts'), '')
    writeFileSync(join(root, 'b.ts'), '')
    symlinkSync(join(root, 'a.ts'), join(root, 'linked.ts'))

    await expect(searchWorkspaceFiles(root, '.ts', { maxResults: 1, maxEntries: 100 }, new AbortController().signal))
      .resolves.toMatchObject({
        items: [{ path: expect.stringMatching(/^[ab]\.ts$/), kind: 'file' }],
        hasMore: true,
      })
  })

  it('honors a caller that cancelled before the scan begins', async () => {
    const root = workspace()
    const controller = new AbortController()
    controller.abort(new Error('superseded'))
    await expect(searchWorkspaceFiles(root, '', { maxResults: 10, maxEntries: 100 }, controller.signal))
      .rejects.toThrow('superseded')
  })
})
