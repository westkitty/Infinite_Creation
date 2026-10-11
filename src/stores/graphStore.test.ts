import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from './graphStore';
import { emptyGraph } from '../graph/migration';
import { defaultTimeline } from '../persistence/projectService';

function freshProject() {
  useGraphStore.getState().loadProject('p1', 'T', emptyGraph(), defaultTimeline());
}

function radiusOf(id: string): unknown {
  return (useGraphStore.getState().nodes.find((n) => n.id === id)?.data.params as Record<string, unknown>).radius;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  freshProject();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('history coalescing', () => {
  it('merges rapid param edits on one node into a single undo entry', () => {
    const st = useGraphStore.getState();
    const n = st.addNode('image.blur', { x: 0, y: 0 });
    expect(n).not.toBeNull();
    const id = n!.id;
    const initial = radiusOf(id);
    expect(useGraphStore.getState().past.length).toBe(1);

    st.updateNodeParams(id, { radius: 1 });
    st.updateNodeParams(id, { radius: 2 });
    st.updateNodeParams(id, { radius: 3 });
    expect(useGraphStore.getState().past.length).toBe(2);
    expect(radiusOf(id)).toBe(3);

    vi.advanceTimersByTime(900);
    st.updateNodeParams(id, { radius: 4 });
    expect(useGraphStore.getState().past.length).toBe(3);

    // Undo walks entry boundaries, not keystrokes.
    useGraphStore.getState().undo();
    expect(radiusOf(id)).toBe(3);
    useGraphStore.getState().undo();
    expect(radiusOf(id)).toBe(initial);
    useGraphStore.getState().undo();
    expect(useGraphStore.getState().nodes).toHaveLength(0);
  });

  it('does not coalesce across nodes, and edits after undo push + clear redo', () => {
    const st = useGraphStore.getState();
    const a = st.addNode('image.blur', { x: 0, y: 0 })!;
    const b = st.addNode('image.blur', { x: 200, y: 0 })!;
    const base = useGraphStore.getState().past.length;
    st.updateNodeParams(a.id, { radius: 5 });
    st.updateNodeParams(b.id, { radius: 6 });
    expect(useGraphStore.getState().past.length).toBe(base + 2);

    useGraphStore.getState().undo();
    expect(useGraphStore.getState().future.length).toBe(1);
    // Immediate edit after undo must still push (throttle was reset) and kill redo.
    st.updateNodeParams(a.id, { radius: 7 });
    expect(useGraphStore.getState().future).toHaveLength(0);
    const before = radiusOf(a.id);
    useGraphStore.getState().redo();
    expect(radiusOf(a.id)).toBe(before);
  });

  it('structural edits always push, even in rapid succession', () => {
    const st = useGraphStore.getState();
    const base = useGraphStore.getState().past.length;
    st.addNode('image.blur', { x: 0, y: 0 });
    st.addNode('image.blur', { x: 10, y: 0 });
    expect(useGraphStore.getState().past.length).toBe(base + 2);
  });
});
