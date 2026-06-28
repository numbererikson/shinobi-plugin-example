/**
 * shinobi-plugin-example
 *
 * Reference plugin showing how to use the ShinobiApi read-only facade
 * to read a project's full state and emit a single Markdown brief.
 *
 * Registers one MCP tool: plugin_export_markdown
 *   Input:  { project_id: number }
 *   Output: { markdown: string, project_title: string, generated_at: string }
 *
 * The handler is deliberately a single function so it reads top-to-bottom
 * as a template you can fork.
 */

export default function register(registry, api) {
  registry.registerTool({
    name: 'plugin_export_markdown',
    description:
      'Export a Shinobi project as a single Markdown brief. Pulls the project header, ' +
      'every subtask grouped by status, the last 20 decisions, the last 20 dead ends, ' +
      'the last 20 notes, and the per-project context. Useful for handoff docs, ' +
      'investor / client one-pagers, or a status summary you paste into a Slack channel.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'integer', description: 'Shinobi project id' },
      },
      required: ['project_id'],
      additionalProperties: false,
    },
    handler: (args) => {
      const id = Number(args.project_id);
      const project = api.getProject(id);
      if (!project) {
        throw new Error(`project ${id} not found`);
      }

      const subtasks = api.listSubtasks({ projectId: id });
      const decisions = api.listDecisions({ projectId: id, limit: 20 });
      const deadEnds = api.listDeadEnds({ projectId: id, limit: 20 });
      const notes = api.listNotes({ projectId: id, limit: 20 });
      const context = api.getContext(id);

      const md = renderMarkdown({
        project,
        subtasks,
        decisions,
        deadEnds,
        notes,
        context,
      });

      return {
        markdown: md,
        project_title: project.title,
        generated_at: new Date().toISOString(),
      };
    },
  });
}

function renderMarkdown({ project, subtasks, decisions, deadEnds, notes, context }) {
  const lines = [];

  lines.push(`# ${project.title}`);
  lines.push('');
  if (project.description) {
    lines.push(project.description);
    lines.push('');
  }
  lines.push(`- **Workspace:** ${project.workspace ?? '(unset)'}`);
  lines.push(`- **Status:** ${project.status}`);
  lines.push(`- **Priority:** ${project.priority}`);
  if (project.due_date) lines.push(`- **Due:** ${project.due_date}`);
  lines.push(`- **Created:** ${project.created_at}`);
  lines.push('');

  if (subtasks.length > 0) {
    lines.push('## Subtasks');
    lines.push('');
    for (const status of ['todo', 'in_progress', 'done']) {
      const group = subtasks.filter((s) => s.status === status);
      if (group.length === 0) continue;
      lines.push(`### ${status.replace('_', ' ')} (${group.length})`);
      lines.push('');
      for (const s of group) {
        const tag = s.priority && s.priority !== 'medium' ? ` _[${s.priority}]_` : '';
        lines.push(`- **#${s.id}** ${s.title}${tag}`);
        if (s.description) {
          lines.push(`  ${s.description.split('\n')[0].slice(0, 200)}`);
        }
      }
      lines.push('');
    }
  }

  if (decisions.length > 0) {
    lines.push('## Decisions');
    lines.push('');
    for (const d of decisions) {
      lines.push(`### ${d.summary}`);
      lines.push(`_kind: ${d.kind ?? 'other'} · status: ${d.status ?? 'open'}_`);
      lines.push('');
      lines.push(d.rationale);
      if (d.alternatives_considered) {
        lines.push('');
        lines.push(`**Alternatives:** ${d.alternatives_considered}`);
      }
      lines.push('');
    }
  }

  if (deadEnds.length > 0) {
    lines.push('## Dead ends');
    lines.push('');
    for (const de of deadEnds) {
      const flag = de.never_retry ? ' 🚫 never retry' : '';
      lines.push(`### Attempt #${de.id}${flag}`);
      lines.push('');
      lines.push(`**Tried:** ${de.attempted_approach}`);
      lines.push('');
      lines.push(`**Failed because:** ${de.failure_reason}`);
      lines.push('');
    }
  }

  if (notes.length > 0) {
    lines.push('## Notes');
    lines.push('');
    for (const n of notes) {
      lines.push(`### Note #${n.id}`);
      lines.push('');
      lines.push(n.body);
      lines.push('');
    }
  }

  if (context) {
    lines.push('## Per-project context');
    lines.push('');
    if (context.conventions) {
      lines.push('### Conventions');
      lines.push(context.conventions);
      lines.push('');
    }
    if (Array.isArray(context.dont_touch) && context.dont_touch.length > 0) {
      lines.push('### Do not touch');
      for (const item of context.dont_touch) {
        lines.push(`- ${item}`);
      }
      lines.push('');
    }
    if (context.test_patterns) {
      lines.push('### Test patterns');
      lines.push(context.test_patterns);
      lines.push('');
    }
    if (context.deploy_notes) {
      lines.push('### Deploy notes');
      lines.push(context.deploy_notes);
      lines.push('');
    }
  }

  lines.push('---');
  lines.push(`_Generated by shinobi-plugin-example at ${new Date().toISOString()}_`);

  return lines.join('\n');
}
