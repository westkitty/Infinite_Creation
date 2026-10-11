import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AssetRecordSchema, type AssetRecord } from '../types/graph';
import { buildLineage } from '../assets/lineage';
import { LineageGraph } from './ProvenancePanel';
import { useAssetStore } from '../stores/assetStore';

function asset(id: string, parentIds: string[] = []): AssetRecord {
  return AssetRecordSchema.parse({
    id, name: `${id}.png`, kind: 'derived', mime: 'image/png',
    size: 10, hash: `h-${id}`, createdAt: 1,
    provenance: { parentIds, inputHashes: [], params: {} },
  });
}

describe('LineageGraph', () => {
  it('renders ancestor generations and selects the clicked asset', () => {
    const all = [asset('a'), asset('b', ['a']), asset('c', ['b']), asset('d', ['c'])];
    const model = buildLineage(all[2], all);
    useAssetStore.getState().setSelectedAsset(null);
    render(<LineageGraph model={model} />);
    // Ancestors + self + child all rendered left-to-right.
    expect(screen.getByText('a.png')).toBeInTheDocument();
    expect(screen.getByText('b.png')).toBeInTheDocument();
    expect(screen.getByText('c.png')).toBeInTheDocument();
    expect(screen.getByText('d.png')).toBeInTheDocument();
    fireEvent.click(screen.getByText('b.png'));
    expect(useAssetStore.getState().selectedAssetId).toBe('b');
    // Clicking the selected asset itself is a no-op, not an error.
    fireEvent.click(screen.getByText('c.png'));
    expect(useAssetStore.getState().selectedAssetId).toBe('b');
  });
});
