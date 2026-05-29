# shinobi-plugin-example

Reference Shinobi plugin. Forks of this repo are the recommended starting
point for any custom MCP tool you want to wire into Shinobi.

Registers one tool: **`plugin_export_markdown`**. Pass a `project_id`,
get back a single Markdown brief that includes the project header,
subtasks grouped by status, decisions, dead ends, notes, and per-project
context. Useful for handoff docs, status summaries, or pasting into
Slack.

## Install

This package follows the auto-discovery naming convention
(`shinobi-plugin-*`), so Shinobi finds it without any config once it's
in `node_modules`.

```bash
# From npm (after the package is published)
npm install -g shinobi-plugin-example

# Or from this repo (recommended while iterating)
npm install -g github:numbererikson/shinobi-plugin-example
```

Restart your MCP client and `mcp__shinobi__plugin_export_markdown`
becomes available.

Verify it loaded:

```text
mcp__shinobi__plugin_hello
```

The response lists every discovered plugin and the tools it registered.
You should see `shinobi-plugin-example` with one tool.

## Use

From your MCP client:

```text
mcp__shinobi__plugin_export_markdown { "project_id": 1 }
```

Pipe the returned `markdown` into a file:

```text
"Export project 1 as Markdown and save it to ./project-1-brief.md"
```

The agent calls the tool, takes the `markdown` field, and writes the
file.

## How it works

This plugin uses the read-only `ShinobiApi` facade Shinobi passes to
every plugin's `register` function. The full available surface is
documented in
[docs/plugin-development.md](https://github.com/numbererikson/shinobi/blob/main/docs/plugin-development.md)
in the main Shinobi repo. The plugin pulls:

- `api.getProject(id)` — project header
- `api.listSubtasks({ projectId })` — every task with status + priority
- `api.listDecisions({ projectId, limit: 20 })` — recent decisions
- `api.listDeadEnds({ projectId, limit: 20 })` — recent dead ends
- `api.listNotes({ projectId, limit: 20 })` — recent notes
- `api.getContext(id)` — conventions, don't-touch list, deploy notes

…and renders them as one Markdown document.

Plugins are **read-only** by design. If you need a tool that writes to
Shinobi state, the right pattern is for the tool to return a structured
plan ("here's what I'd write") and have the LLM call a built-in tool
like `log_decision` or `create_task` to do the actual write. Built-in
tools have audit logging, schema validation, and the activity timeline
hook; plugin writes would bypass all of that.

## Fork it

This repo is intentionally minimal. To build your own plugin:

1. Fork or clone this repo.
2. Rename in `package.json` (must start with `shinobi-plugin-` for
   auto-discovery).
3. Rewrite `index.mjs` — keep the `export default function register`
   signature.
4. Update `description` and `keywords` in `package.json`.
5. `npm install -g .` to test locally; publish when ready.

The `peerDependencies` entry pins to `@shinobiapps/shinobi >=0.1.3`
because the plugin API contract stabilized in that release. Future
breaking changes will be reflected in a peer-dep bump.

## License

MIT — see [LICENSE](./LICENSE).
