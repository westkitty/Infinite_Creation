// Image op worker: runs pure pixel ops off the main thread.
// Protocol: { jobId, op, images: [{width,height,buffer}], params } ->
//           { jobId, ok, image?: {width,height,buffer}, error?: string }
// Buffers are transferred (zero-copy); inputs are treated as immutable.

import type { ImageValue } from '../media/pixel';
import {
  opBlur, opBrightness, opColorBalance, opComposite, opContrast, opCrop,
  opFlip, opHue, opMask, opOpacity, opResize, opRotate, opSaturation, opSharpen,
} from '../media/ops';

export type WorkerOp =
  | 'crop' | 'resize' | 'rotate' | 'flip' | 'brightness' | 'contrast'
  | 'saturation' | 'hue' | 'colorBalance' | 'opacity' | 'blur' | 'sharpen'
  | 'mask' | 'composite';

export interface WorkerRequest {
  jobId: string;
  op: WorkerOp;
  images: Array<{ width: number; height: number; buffer: ArrayBuffer }>;
  params: Record<string, unknown>;
}

export interface WorkerResponse {
  jobId: string;
  ok: boolean;
  image?: { width: number; height: number; buffer: ArrayBuffer };
  error?: string;
}

function toImageValue(w: { width: number; height: number; buffer: ArrayBuffer }): ImageValue {
  return { kind: 'image', width: w.width, height: w.height, data: new Uint8ClampedArray(w.buffer) };
}

function run(req: WorkerRequest): ImageValue {
  const imgs = req.images.map(toImageValue);
  const p = req.params;
  switch (req.op) {
    case 'crop': return opCrop(imgs[0], p as unknown as Parameters<typeof opCrop>[1]);
    case 'resize': return opResize(imgs[0], p as unknown as Parameters<typeof opResize>[1]);
    case 'rotate': return opRotate(imgs[0], p as unknown as Parameters<typeof opRotate>[1]);
    case 'flip': return opFlip(imgs[0], p as unknown as Parameters<typeof opFlip>[1]);
    case 'brightness': return opBrightness(imgs[0], p.brightness as number, p.exposure as number);
    case 'contrast': return opContrast(imgs[0], p.contrast as number);
    case 'saturation': return opSaturation(imgs[0], p.saturation as number);
    case 'hue': return opHue(imgs[0], p.hue as number);
    case 'colorBalance': return opColorBalance(imgs[0], p.red as number, p.green as number, p.blue as number);
    case 'opacity': return opOpacity(imgs[0], p.opacity as number);
    case 'blur': return opBlur(imgs[0], p.radius as number);
    case 'sharpen': return opSharpen(imgs[0], p.amount as number);
    case 'mask': return opMask(imgs[0], imgs[1], !!p.invert);
    case 'composite': return opComposite(imgs[0], imgs[1], p as unknown as Parameters<typeof opComposite>[2]);
    default: throw new Error(`Unknown worker op "${req.op as string}"`);
  }
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    const out = run(req);
    const buffer = out.data.buffer as ArrayBuffer;
    const res: WorkerResponse = { jobId: req.jobId, ok: true, image: { width: out.width, height: out.height, buffer } };
    (self as unknown as { postMessage(m: WorkerResponse, t: Transferable[]): void }).postMessage(res, [buffer]);
  } catch (err) {
    const res: WorkerResponse = { jobId: req.jobId, ok: false, error: err instanceof Error ? err.message : String(err) };
    (self as unknown as { postMessage(m: WorkerResponse): void }).postMessage(res);
  }
};
