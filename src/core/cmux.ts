export function parseCmuxSurfaceRef(output: string): string | null {
  const trimmed = output.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const fromJson = findSurfaceRef(parsed);
    if (fromJson) return fromJson;
  } catch {
    // Fall through to plain-text parsing for cmux builds that print refs.
  }
  return matchSurfaceRef(trimmed);
}

function findSurfaceRef(value: unknown): string | null {
  const direct = matchSurfaceRef(value);
  if (direct) return direct;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findSurfaceRef(item);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const surface = record.surface && typeof record.surface === "object"
    ? record.surface as Record<string, unknown>
    : null;
  const preferred = [
    record.surface_ref,
    record.selected_surface_ref,
    record.ref,
    surface?.ref,
    surface?.id,
    record.selected_surface_id,
  ];
  for (const item of preferred) {
    const found = matchSurfaceRef(item);
    if (found) return found;
    if (typeof item === "string" && item.length > 0 && item !== record.ref) return item;
  }
  for (const item of Object.values(record)) {
    const found = findSurfaceRef(item);
    if (found) return found;
  }
  return null;
}

function matchSurfaceRef(value: unknown): string | null {
  return typeof value === "string"
    ? value.match(/surface:[A-Za-z0-9._:-]+/)?.[0] ?? null
    : null;
}
