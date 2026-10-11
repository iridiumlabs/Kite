export function expandedMessageIds(defaults: Set<string>, collapsed: Set<string>, extra: Set<string>) {
  return new Set([...defaults, ...extra].filter(id => !collapsed.has(id)));
}

export function toggleMessageExpansion(id: string, expanded: Set<string>, collapsed: Set<string>, extra: Set<string>) {
  const nextCollapsed = new Set(collapsed);
  const nextExtra = new Set(extra);
  if (expanded.has(id)) {
    nextCollapsed.add(id);
    nextExtra.delete(id);
  } else {
    nextCollapsed.delete(id);
    nextExtra.add(id);
  }
  return { collapsed: nextCollapsed, extra: nextExtra };
}
