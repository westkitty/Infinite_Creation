// Bounded worker pool with main-thread fallback.
// - Concurrency bounded to hardwareConcurrency (clamped 1..4).
// - Cooperative cancellation: cancelled jobs resolve as cancelled; late worker
//   responses for a superseded generation are ignored by the scheduler.
// - If Worker construction fails (or in tests), ops run on the main thread.

import type { ImageValue } from '../media/pixel';
import {
  opBlur, opBrightness, opColorBalance, opComposite, opContrast, opCrop,
  opFlip, opHue, opMask, opOpacity, opResize, opRotate, opSaturation, opSharpen,
} from '../media/ops';
import type { WorkerOp, WorkerRequest, WorkerResponse } from '../workers/image.worker';

interface PendingJob {
  resolve: (img: ImageValue) => void;
  reject: (e: Error) => void;
  signal?: AbortSignal;
  onAbort: () => void;
}

const MAX_WORKERS = Math.min(4, Math.max(1, (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2));

let pool: Worker[] = [];
let nextWorker = 0;
let workerFailed = typeof Worker === 'undefined';
const pending = new Map<string, PendingJob>();
let jobSeq = 0;

function getWorker(): Worker | null {
  if (workerFailed) return null;
  try {
    if (pool.length < MAX_WORKERS) {
      const w = new Worker(new URL('../workers/image.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<WorkerResponse>) => handleResponse(e.data);
      w.onerror = () => { workerFailed = true; failAll(new Error('Image worker crashed; falling back to main thread')); };
      pool.push(w);
    }
    const w = pool[nextWorker % pool.length];
    nextWorker++;
    return w;
  } catch {
    workerFailed = true;
    return null;
  }
}

function handleResponse(res: WorkerResponse): void {
  const job = pending.get(res.jobId);
  if (!job) return; // superseded/cancelled — ignore late result
  pending.delete(res.jobId);
  job.signal?.removeEventListener('abort', job.onAbort);
  if (!res.ok || !res.image) {
    job.reject(new Error(res.error ?? 'Worker op failed'));
    return;
  }
  job.resolve({ kind: 'image', width: res.image.width, height: res.image.height, data: new Uint8ClampedArray(res.image.buffer) });
}

function failAll(e: Error): void {
  for (const [, job] of pending) job.reject(e);
  pending.clear();
}

function runOnMainThread(op: WorkerOp, images: ImageValue[], params: Record<string, unknown>): ImageValue {
  switch (op) {
    case 'crop': return opCrop(images[0], params as never);
    case 'resize': return opResize(images[0], params as never);
    case 'rotate': return opRotate(images[0], params as never);
    case 'flip': return opFlip(images[0], params as never);
    case 'brightness': return opBrightness(images[0], params.brightness as number, params.exposure as number);
    case 'contrast': return opContrast(images[0], params.contrast as number);
    case 'saturation': return opSaturation(images[0], params.saturation as number);
    case 'hue': return opHue(images[0], params.hue as number);
    case 'colorBalance': return opColorBalance(images[0], params.red as number, params.green as number, params.blue as number);
    case 'opacity': return opOpacity(images[0], params.opacity as number);
    case 'blur': return opBlur(images[0], params.radius as number);
    case 'sharpen': return opSharpen(images[0], params.amount as number);
    case 'mask': return opMask(images[0], images[1], !!params.invert);
    case 'composite': return opComposite(images[0], images[1], params as never);
  }
}

export function workerAvailable(): boolean {
  return !workerFailed && typeof Worker !== 'undefined';
}

export async function runOp(
  op: WorkerOp,
  images: ImageValue[],
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ImageValue> {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  const worker = getWorker();
  if (!worker) {
    // Main-thread fallback (also used in unit tests).
    await new Promise((r) => setTimeout(r, 0)); // yield; keeps UI responsive-ish
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    return runOnMainThread(op, images, params);
  }
  const jobId = `job_${++jobSeq}_${Date.now().toString(36)}`;
  return new Promise<ImageValue>((resolve, reject) => {
    const onAbort = () => {
      pending.delete(jobId);
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    if (signal) {
      if (signal.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    pending.set(jobId, { resolve, reject, signal, onAbort });
    // Copy buffers for transfer so caller inputs stay immutable.
    const payload: WorkerRequest = {
      jobId, op, params,
      images: images.map((img) => {
        const copy = new Uint8ClampedArray(img.data);
        return { width: img.width, height: img.height, buffer: copy.buffer as ArrayBuffer };
      }),
    };
    try {
      worker.postMessage(payload, payload.images.map((i) => i.buffer));
    } catch {
      pending.delete(jobId);
      workerFailed = true;
      // Retry on main thread transparently.
      resolve(runOnMainThread(op, images, params));
    }
  });
}

export function terminatePool(): void {
  for (const w of pool) {
    try { w.terminate(); } catch { /* ignore */ }
  }
  pool = [];
  failAll(new Error('Worker pool terminated'));
}
