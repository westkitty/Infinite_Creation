import { create } from 'zustand';

export type Workspace = 'CREATE' | 'ASSETS' | 'ANIMATE' | 'INSPECT' | 'EXPORT';

interface UIState {
  workspace: Workspace;
  setWorkspace: (w: Workspace) => void;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  bottomCollapsed: boolean;
  toggleLeft: () => void;
  toggleRight: () => void;
  toggleBottom: () => void;
  snapToGrid: boolean;
  toggleSnap: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  compareMode: boolean;
  setCompareMode: (v: boolean) => void;
  saveStatus: 'saved' | 'saving' | 'dirty' | 'error';
  setSaveStatus: (s: UIState['saveStatus']) => void;
}

export const useUIStore = create<UIState>((set) => ({
  workspace: 'CREATE',
  setWorkspace: (workspace) => set({ workspace }),
  leftCollapsed: false,
  rightCollapsed: false,
  bottomCollapsed: false,
  toggleLeft: () => set((s) => ({ leftCollapsed: !s.leftCollapsed })),
  toggleRight: () => set((s) => ({ rightCollapsed: !s.rightCollapsed })),
  toggleBottom: () => set((s) => ({ bottomCollapsed: !s.bottomCollapsed })),
  snapToGrid: true,
  toggleSnap: () => set((s) => ({ snapToGrid: !s.snapToGrid })),
  paletteOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  compareMode: false,
  setCompareMode: (v) => set({ compareMode: v }),
  saveStatus: 'saved',
  setSaveStatus: (saveStatus) => set({ saveStatus }),
}));
