import { create } from 'zustand';
import type { AssetRecord } from '../types/graph';

interface AssetState {
  projectId: string | null;
  assets: AssetRecord[];
  search: string;
  kindFilter: string;
  showFavoritesOnly: boolean;
  sortKey: 'createdAt' | 'name' | 'size';
  selectedAssetId: string | null;
  setAssets: (a: AssetRecord[]) => void;
  setProject: (id: string | null) => void;
  setSearch: (s: string) => void;
  setKindFilter: (k: string) => void;
  setFavoritesOnly: (v: boolean) => void;
  setSortKey: (k: AssetState['sortKey']) => void;
  setSelectedAsset: (id: string | null) => void;
  upsert: (a: AssetRecord) => void;
  remove: (id: string) => void;
}

export const useAssetStore = create<AssetState>((set) => ({
  projectId: null,
  assets: [],
  search: '',
  kindFilter: 'all',
  showFavoritesOnly: false,
  sortKey: 'createdAt',
  selectedAssetId: null,
  setAssets: (assets) => set({ assets }),
  setProject: (projectId) => set({ projectId, assets: [], selectedAssetId: null }),
  setSearch: (search) => set({ search }),
  setKindFilter: (kindFilter) => set({ kindFilter }),
  setFavoritesOnly: (showFavoritesOnly) => set({ showFavoritesOnly }),
  setSortKey: (sortKey) => set({ sortKey }),
  setSelectedAsset: (selectedAssetId) => set({ selectedAssetId }),
  upsert: (a) => set((s) => ({ assets: [...s.assets.filter((x) => x.id !== a.id), a] })),
  remove: (id) => set((s) => ({ assets: s.assets.filter((x) => x.id !== id) })),
}));
