import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { db } from '../assets/db';
import { useAssetStore } from '../stores/assetStore';
import type { AssetRecord } from '../types/graph';
import { AssetDetails } from './AssetLibrary';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function row(id: string, note?: string): AssetRecord {
  return {
    id, name: `Asset ${id}`, kind: 'image', mime: 'image/png', size: 10,
    hash: `hash-${id}`, createdAt: 1, tags: [], favorite: false,
    approval: 'draft', note, missing: false,
  };
}

let writes = 0;
function onUpdating() { writes += 1; }

beforeEach(async () => {
  await db.assets.clear();
  useAssetStore.getState().setAssets([]);
  writes = 0;
  db.assets.hook('updating', onUpdating);
});

afterEach(() => {
  db.assets.hook('updating').unsubscribe(onUpdating);
  cleanup();
  vi.restoreAllMocks();
});

async function noteBox() {
  return screen.findByPlaceholderText('Note for this revision…');
}

describe('revision-note debounce', () => {
  it('coalesces rapid keystrokes into one IndexedDB write with the final value', async () => {
    const a = row('a1');
    await db.assets.put({ ...a, projectId: 'p1' });
    render(<AssetDetails asset={a} />);
    const box = await noteBox();
    fireEvent.change(box, { target: { value: 'h' } });
    fireEvent.change(box, { target: { value: 'he' } });
    fireEvent.change(box, { target: { value: 'hel' } });
    // Within the debounce window nothing has been committed.
    await sleep(60);
    expect(writes).toBe(0);
    expect((await db.assets.get('a1'))?.note).toBeUndefined();
    // After the window: exactly one write, carrying the final draft.
    await vi.waitFor(async () => {
      expect(await db.assets.get('a1')).toMatchObject({ note: 'hel' });
    }, { timeout: 3000 });
    await sleep(100);
    expect(writes).toBe(1);
    expect(useAssetStore.getState().assets.find((x) => x.id === 'a1')?.note).toBe('hel');
  });

  it('flushes a pending edit on unmount instead of dropping it', async () => {
    const a = row('a2');
    await db.assets.put({ ...a, projectId: 'p1' });
    const { unmount } = render(<AssetDetails asset={a} />);
    const box = await noteBox();
    fireEvent.change(box, { target: { value: 'unsaved draft' } });
    unmount();
    await vi.waitFor(async () => {
      expect(await db.assets.get('a2')).toMatchObject({ note: 'unsaved draft' });
    }, { timeout: 3000 });
  });

  it('flushes the previous asset edit when selection changes', async () => {
    const a = row('a3');
    const b = row('b3');
    await db.assets.put({ ...a, projectId: 'p1' });
    await db.assets.put({ ...b, projectId: 'p1' });
    const { rerender } = render(<AssetDetails asset={a} />);
    const box = await noteBox();
    fireEvent.change(box, { target: { value: 'note for a' } });
    rerender(<AssetDetails asset={b} />);
    await vi.waitFor(async () => {
      expect(await db.assets.get('a3')).toMatchObject({ note: 'note for a' });
    }, { timeout: 3000 });
    // The newly selected asset shows its own (empty) note, not the stale draft.
    expect((await noteBox() as HTMLTextAreaElement).value).toBe('');
  });
});
