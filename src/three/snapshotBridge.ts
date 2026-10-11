// Bridge between the interactive 3D viewer and the execution engine's
// model.snapshot node. The viewer registers a frame-capture callback while
// mounted; the scheduler calls it only when a snapshot node runs.

import type { ImageValue } from '../media/pixel';

let provider: (() => Promise<ImageValue | null>) | null = null;

export function registerSnapshotProvider(fn: (() => Promise<ImageValue | null>) | null): void {
  provider = fn;
}

export async function captureViewerSnapshot(): Promise<ImageValue | null> {
  if (!provider) return null;
  return provider();
}
