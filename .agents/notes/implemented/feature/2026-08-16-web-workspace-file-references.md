# Agent Note: Web workspace file references

Status: implemented

English | [中文](2026-08-16-web-workspace-file-references.zh.md)

## Problem

Web users can name a workspace file in a prompt, but the composer has no path discovery. The model-facing `glob` and `grep` tools cannot populate a browser menu, and the Host directory picker accepts arbitrary filesystem paths outside the active Session. Sending an absolute path to the browser would also disclose Host filesystem layout without a Session-scoped authorization decision.

## Decision

The Web composer registers `workspace-file` as an `@` input source in `@deepseek-ai/dsh-client-ui-workspace`. It calls `ctx.workspaces.searchWorkspaceFiles(sessionId, query, signal)`, renders relative file and directory paths, and inserts a selected candidate as literal `@path` text. The ordinary user-message event records that text, so replay reconstructs the model-visible prompt without a separate event type. The source does not read file contents or attach file data to the message.

`session.searchWorkspaceFiles` is a typed ApiProxy method. The Host receives only the Session id and query, resolves the live Agent, and takes its `Session.header.cwd` as the search root. The browser never supplies a filesystem root and receives only slash-normalized relative paths plus a file or directory kind. Empty queries return one top-level page; non-empty queries search descendants. The scanner skips symbolic links, `.git`, and `node_modules`, stops at configurable `workspaceFileSearchMaxResults` and `workspaceFileSearchMaxEntries` limits, and reports truncation on the wire. The fixed response maximum remains 100 paths, while deployments may configure a lower candidate limit.

The workspace runtime owns the browser call rather than giving `ui-workspace` direct access to the connection service. `ui-input-trigger` remains a generic source registry; it only adds the localized `workspace-file` group label.

## Alternatives considered

- **Call the model `glob` tool from the browser** — the tool is a model-facing Consumer with tool-result formatting and Agent ownership, not a browser API. Reusing it would expose an execution surface without a typed browser authorization path.
- **Use `host.listDirectory`** — directory browse is intentionally whole-host and accepts a path selected by the browser. It cannot enforce that a request stays below the active Session cwd, and it does not return files.
- **Return absolute paths and let the client constrain them** — a browser-side check cannot prevent a compromised or stale client from requesting another Host path. The Host resolves the Session before accessing the filesystem and returns relative paths only.
- **Read file contents when a candidate is selected** — selection is a path-discovery interaction, not context attachment. Eager reads increase token cost and can inject unrelated or untrusted file content into a user request.
- **Put the source in `ui-input-trigger`** — that package owns trigger mechanics shared by command, skill, and subagent sources. Workspace authorization and path lookup belong to the workspace feature and runtime service.

## Consequences

The new Web affordance is useful only for sessions with a recorded working directory. A missing session or unreadable workspace returns a normal RPC failure and leaves the trigger menu without candidates. Recursive queries trade broader discovery for bounded Host work; users can narrow the fragment when a result page is truncated. Existing `@` subagent candidates continue to register independently. The behavior is covered by scanner and ApiProxy tests, a `ui-workspace` registration test, and the assembled Web check.
