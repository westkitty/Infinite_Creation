import type { NodeDefinition } from '../types/graph';

function P(
  id: string,
  dataType: NodeDefinition['inputs'][number]['dataType'],
  label: string,
  required = true,
  multiple = false,
  description?: string,
): NodeDefinition['inputs'][number] {
  return { id, dataType, required, multiple, label, description, version: 1 };
}

function num(key: string, label: string, def: number, extra: Partial<NodeDefinition['params'][number]> = {}) {
  return { key, label, type: 'number' as const, default: def, required: false as const, ...extra };
}
function slider(key: string, label: string, def: number, min: number, max: number, step = 1, description?: string) {
  return { key, label, type: 'slider' as const, default: def, min, max, step, description, required: false as const };
}
function str(key: string, label: string, def: string, type: 'string' | 'text' = 'string', description?: string) {
  return { key, label, type, default: def, description, required: false as const };
}
function bool(key: string, label: string, def: boolean, description?: string) {
  return { key, label, type: 'boolean' as const, default: def, description, required: false as const };
}
function color(key: string, label: string, def: string, description?: string) {
  return { key, label, type: 'color' as const, default: def, description, required: false as const };
}
function sel(key: string, label: string, def: string, options: string[], description?: string) {
  return { key, label, type: 'select' as const, default: def, options, description, required: false as const };
}
function assetRef(key: string, label: string, description?: string) {
  return { key, label, type: 'assetRef' as const, default: '', description, required: false as const };
}

type NodeDefInput = Omit<NodeDefinition, 'unavailable' | 'unavailableReason'> & {
  unavailable?: boolean;
  unavailableReason?: string;
};
const DEFS: NodeDefInput[] = [
  // ---------------- SOURCE ----------------
  {
    type: 'source.imageImport', label: 'Image Import', family: 'SOURCE',
    description: 'Import a raster image asset into the graph. Outputs the decoded image.',
    version: 1, inputs: [], outputs: [P('image', 'ImageAsset', 'Image', true, false, 'Decoded image')],
    params: [assetRef('assetId', 'Image asset', 'Select an image from the library')],
  },
  {
    type: 'source.audioImport', label: 'Audio Import', family: 'SOURCE',
    description: 'Reference an audio asset. Playback supported in preview; no DSP in v1.',
    version: 1, inputs: [], outputs: [P('audio', 'AudioAsset', 'Audio')],
    params: [assetRef('assetId', 'Audio asset')],
  },
  {
    type: 'source.videoImport', label: 'Video Import', family: 'SOURCE',
    description: 'Reference a video asset. Preview playback only in v1.',
    version: 1, inputs: [], outputs: [P('video', 'VideoAsset', 'Video')],
    params: [assetRef('assetId', 'Video asset')],
  },
  {
    type: 'source.glbImport', label: 'GLB Import', family: 'SOURCE',
    description: 'Reference a GLB/GLTF 3D model for the viewer.',
    version: 1, inputs: [], outputs: [P('model', 'Model3DAsset', 'Model')],
    params: [assetRef('assetId', 'Model asset')],
  },
  {
    type: 'source.prompt', label: 'Prompt / Text', family: 'SOURCE',
    description: 'Text value. Not media — prompts never render as generated images.',
    version: 1, inputs: [], outputs: [P('text', 'TextPrompt', 'Text')],
    params: [str('text', 'Text', '', 'text', 'Prompt or annotation text')],
  },
  {
    type: 'source.solidColor', label: 'Solid Color', family: 'SOURCE',
    description: 'Generate a solid-color image of explicit dimensions.',
    version: 1, inputs: [], outputs: [P('image', 'ImageAsset', 'Image')],
    params: [
      color('color', 'Color', '#c8102e'),
      num('width', 'Width', 512, { min: 1, max: 8192 }),
      num('height', 'Height', 512, { min: 1, max: 8192 }),
    ],
  },
  {
    type: 'source.assetRef', label: 'Asset Library Reference', family: 'SOURCE',
    description: 'Generic asset reference passthrough (metadata only).',
    version: 1, inputs: [], outputs: [P('collection', 'AssetCollection', 'Collection')],
    params: [assetRef('assetId', 'Asset')],
  },
  // ---------------- IMAGE ----------------
  {
    type: 'image.crop', label: 'Crop', family: 'IMAGE',
    description: 'Crop to pixel or normalized coordinates with optional aspect lock.',
    version: 2, inputs: [P('image', 'ImageAsset', 'Image')],
    outputs: [P('image', 'ImageAsset', 'Cropped')],
    params: [
      sel('mode', 'Mode', 'pixels', ['pixels', 'normalized'], 'Coordinate mode'),
      num('x', 'X', 0, { min: 0, max: 8192 }),
      num('y', 'Y', 0, { min: 0, max: 8192 }),
      num('width', 'Width', 256, { min: 1, max: 8192 }),
      num('height', 'Height', 256, { min: 1, max: 8192 }),
      bool('lockAspect', 'Lock aspect', false),
    ],
  },
  {
    type: 'image.resize', label: 'Resize', family: 'IMAGE',
    description: 'Resize by explicit dimensions or percentage with aspect control.',
    version: 2, inputs: [P('image', 'ImageAsset', 'Image')],
    outputs: [P('image', 'ImageAsset', 'Resized')],
    params: [
      sel('mode', 'Mode', 'dimensions', ['dimensions', 'percent'], 'Sizing mode'),
      num('width', 'Width', 512, { min: 1, max: 8192 }),
      num('height', 'Height', 512, { min: 1, max: 8192 }),
      num('percent', 'Percent', 100, { min: 1, max: 1600 }),
      bool('keepAspect', 'Keep aspect', true),
      sel('quality', 'Quality', 'high', ['low', 'medium', 'high', 'pixelated'], 'Resampling quality'),
    ],
  },
  {
    type: 'image.rotate', label: 'Rotate', family: 'IMAGE',
    description: 'Rotate by arbitrary angle with fit/expand control.',
    version: 1, inputs: [P('image', 'ImageAsset', 'Image')],
    outputs: [P('image', 'ImageAsset', 'Rotated')],
    params: [
      slider('angle', 'Angle (deg)', 0, -180, 180, 1),
      sel('fit', 'Fit', 'expand', ['expand', 'crop'], 'Expand canvas or keep size'),
    ],
  },
  {
    type: 'image.flip', label: 'Flip', family: 'IMAGE',
    description: 'Flip horizontally and/or vertically.',
    version: 1, inputs: [P('image', 'ImageAsset', 'Image')],
    outputs: [P('image', 'ImageAsset', 'Flipped')],
    params: [bool('horizontal', 'Horizontal', true), bool('vertical', 'Vertical', false)],
  },
  {
    type: 'image.exposure', label: 'Exposure / Brightness', family: 'IMAGE',
    description: 'Adjust brightness and exposure stops.',
    version: 1, inputs: [P('image', 'ImageAsset', 'Image')],
    outputs: [P('image', 'ImageAsset', 'Adjusted')],
    params: [slider('brightness', 'Brightness', 0, -100, 100, 1), slider('exposure', 'Exposure (stops)', 0, -4, 4, 0.1)],
  },
  {
    type: 'image.contrast', label: 'Contrast', family: 'IMAGE',
    description: 'Adjust contrast around midpoint.',
    version: 1, inputs: [P('image', 'ImageAsset', 'Image')],
    outputs: [P('image', 'ImageAsset', 'Adjusted')],
    params: [slider('contrast', 'Contrast', 0, -100, 100, 1)],
  },
  {
    type: 'image.saturation', label: 'Saturation', family: 'IMAGE',
    description: 'Adjust color saturation.',
    version: 1, inputs: [P('image', 'ImageAsset', 'Image')],
    outputs: [P('image', 'ImageAsset', 'Adjusted')],
    params: [slider('saturation', 'Saturation', 0, -100, 100, 1)],
  },
  {
    type: 'image.hue', label: 'Hue', family: 'IMAGE',
    description: 'Rotate hue in degrees.',
    version: 1, inputs: [P('image', 'ImageAsset', 'Image')],
    outputs: [P('image', 'ImageAsset', 'Adjusted')],
    params: [slider('hue', 'Hue shift (deg)', 0, -180, 180, 1)],
  },
  {
    type: 'image.colorBalance', label: 'Color Balance', family: 'IMAGE',
    description: 'Per-channel gain adjustment.',
    version: 1, inputs: [P('image', 'ImageAsset', 'Image')],
    outputs: [P('image', 'ImageAsset', 'Adjusted')],
    params: [
      slider('red', 'Red', 0, -100, 100, 1),
      slider('green', 'Green', 0, -100, 100, 1),
      slider('blue', 'Blue', 0, -100, 100, 1),
    ],
  },
  {
    type: 'image.opacity', label: 'Opacity', family: 'IMAGE',
    description: 'Scale alpha channel by a factor.',
    version: 1, inputs: [P('image', 'ImageAsset', 'Image')],
    outputs: [P('image', 'ImageAsset', 'Adjusted')],
    params: [slider('opacity', 'Opacity %', 100, 0, 100, 1)],
  },
  {
    type: 'image.blur', label: 'Blur', family: 'IMAGE',
    description: 'Gaussian blur by radius.',
    version: 1, inputs: [P('image', 'ImageAsset', 'Image')],
    outputs: [P('image', 'ImageAsset', 'Blurred')],
    params: [slider('radius', 'Radius', 4, 0, 50, 1)],
  },
  {
    type: 'image.sharpen', label: 'Sharpen', family: 'IMAGE',
    description: 'Unsharp-mask style sharpening.',
    version: 1, inputs: [P('image', 'ImageAsset', 'Image')],
    outputs: [P('image', 'ImageAsset', 'Sharpened')],
    params: [slider('amount', 'Amount', 50, 0, 200, 1)],
  },
  {
    type: 'image.mask', label: 'Mask', family: 'IMAGE',
    description: 'Apply a mask image alpha to the source image.',
    version: 1,
    inputs: [P('image', 'ImageAsset', 'Image'), P('mask', 'ImageMask', 'Mask')],
    outputs: [P('image', 'ImageAsset', 'Masked')],
    params: [bool('invert', 'Invert mask', false)],
  },
  {
    type: 'image.composite', label: 'Composite', family: 'IMAGE',
    description: 'Layer foreground over background with position, scale, opacity, blend.',
    version: 2,
    inputs: [P('background', 'ImageAsset', 'Background'), P('foreground', 'ImageAsset', 'Foreground')],
    outputs: [P('image', 'ImageAsset', 'Composited')],
    params: [
      num('x', 'X', 0, { min: -8192, max: 8192 }),
      num('y', 'Y', 0, { min: -8192, max: 8192 }),
      num('scale', 'Scale %', 100, { min: 1, max: 1600 }),
      slider('opacity', 'Opacity %', 100, 0, 100, 1),
      sel('blend', 'Blend mode', 'source-over', ['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference'], 'Canvas blend mode'),
    ],
  },
  {
    type: 'image.convert', label: 'Format Conversion', family: 'IMAGE',
    description: 'Set export encoding (PNG/JPEG/WebP) passthrough for the image.',
    version: 1, inputs: [P('image', 'ImageAsset', 'Image')],
    outputs: [P('image', 'ImageAsset', 'Converted')],
    params: [
      sel('format', 'Format', 'png', ['png', 'jpeg', 'webp']),
      slider('quality', 'Quality', 92, 1, 100, 1, 'JPEG/WebP quality'),
    ],
  },
  {
    type: 'image.export', label: 'Image Export', family: 'IMAGE',
    description: 'Encode the image to a downloadable artifact (PNG/JPEG/WebP).',
    version: 2, inputs: [P('image', 'ImageAsset', 'Image')],
    outputs: [P('artifact', 'ExportArtifact', 'Artifact')],
    params: [
      sel('format', 'Format', 'png', ['png', 'jpeg', 'webp']),
      slider('quality', 'Quality', 92, 1, 100, 1),
      str('filename', 'Filename', 'output', 'string', 'Base filename without extension'),
    ],
  },
  // ---------------- TIMELINE ----------------
  {
    type: 'timeline.sequence', label: 'Image Sequence', family: 'TIMELINE',
    description: 'Collect ordered images into a sequence collection.',
    version: 1, inputs: [P('images', 'ImageAsset', 'Images', true, true)],
    outputs: [P('sequence', 'ImageSequence', 'Sequence')],
    params: [num('fps', 'FPS', 30, { min: 1, max: 120 })],
  },
  {
    type: 'timeline.frameDuration', label: 'Frame Duration', family: 'TIMELINE',
    description: 'Set per-frame hold duration for a sequence.',
    version: 1, inputs: [P('sequence', 'ImageSequence', 'Sequence')],
    outputs: [P('sequence', 'ImageSequence', 'Sequence')],
    params: [num('frames', 'Frames per image', 12, { min: 1, max: 3600 })],
  },
  {
    type: 'timeline.keyframes', label: 'Keyframe Track', family: 'TIMELINE',
    description: 'Evaluate a keyframed numeric track at time t.',
    version: 1, inputs: [],
    outputs: [P('value', 'NumericValue', 'Value')],
    params: [num('time', 'Time (s)', 0, { min: 0, max: 3600 }), str('keys', 'Keys (t:v,...)', '0:0,1:100', 'string', 'Comma-separated time:value pairs')],
  },
  {
    type: 'timeline.transform', label: 'Transform Animation', family: 'TIMELINE',
    description: 'Build transform parameters (used by renderer).',
    version: 1, inputs: [],
    outputs: [P('transform', 'TransformParameters', 'Transform')],
    params: [
      num('x', 'X', 0, { min: -8192, max: 8192 }),
      num('y', 'Y', 0, { min: -8192, max: 8192 }),
      num('scale', 'Scale %', 100, { min: 1, max: 1600 }),
      num('rotation', 'Rotation', 0, { min: -360, max: 360 }),
      num('opacity', 'Opacity %', 100, { min: 0, max: 100 }),
    ],
  },
  {
    type: 'timeline.preview', label: 'Timeline Preview', family: 'TIMELINE',
    description: 'Render the project timeline at a timestamp to an image.',
    version: 1, inputs: [P('timeline', 'AnimationTimeline', 'Timeline', false)],
    outputs: [P('image', 'ImageAsset', 'Frame')],
    params: [num('time', 'Time (s)', 0, { min: 0, max: 3600 }), num('width', 'Width', 512, { min: 1, max: 4096 }), num('height', 'Height', 512, { min: 1, max: 4096 })],
  },
  // ---------------- 3D ----------------
  {
    type: 'model.loader', label: 'GLB Loader', family: '3D',
    description: 'Load a GLB asset into the 3D workspace.',
    version: 1, inputs: [P('model', 'Model3DAsset', 'Model')],
    outputs: [P('model', 'Model3DAsset', 'Loaded')],
    params: [],
  },
  {
    type: 'model.viewer', label: 'Model Viewer', family: '3D',
    description: 'Display configuration for the interactive 3D viewer.',
    version: 1, inputs: [P('model', 'Model3DAsset', 'Model')],
    outputs: [P('model', 'Model3DAsset', 'Configured')],
    params: [
      sel('background', 'Background', 'dark', ['dark', 'light', 'checker', 'transparent']),
      sel('lighting', 'Lighting', 'studio', ['studio', 'soft', 'harsh', 'none']),
      bool('grid', 'Grid', true),
    ],
  },
  {
    type: 'model.camera', label: 'Camera Controls', family: '3D',
    description: 'Camera preset for the 3D viewer.',
    version: 1, inputs: [P('model', 'Model3DAsset', 'Model')],
    outputs: [P('model', 'Model3DAsset', 'Configured')],
    params: [sel('preset', 'Preset', 'orbit', ['orbit', 'front', 'side', 'top'], 'Camera preset')],
  },
  {
    type: 'model.snapshot', label: 'Model Snapshot', family: '3D',
    description: 'Capture the current viewer frame as an image asset.',
    version: 1, inputs: [P('model', 'Model3DAsset', 'Model')],
    outputs: [P('image', 'ImageAsset', 'Snapshot')],
    params: [num('width', 'Width', 1024, { min: 64, max: 4096 }), num('height', 'Height', 1024, { min: 64, max: 4096 })],
  },
  // ---------------- UTILITY ----------------
  {
    type: 'util.numeric', label: 'Numeric Parameter', family: 'UTILITY',
    description: 'Constant numeric value usable by parameter links.',
    version: 1, inputs: [], outputs: [P('value', 'NumericValue', 'Value')],
    params: [num('value', 'Value', 0, {})],
  },
  {
    type: 'util.color', label: 'Color Parameter', family: 'UTILITY',
    description: 'Constant color value usable by parameter links.',
    version: 1, inputs: [], outputs: [P('value', 'ColorValue', 'Value')],
    params: [color('value', 'Value', '#ffffff')],
  },
  {
    type: 'util.metadata', label: 'Metadata Inspector', family: 'UTILITY',
    description: 'Extract metadata from any connected asset.',
    version: 1, inputs: [P('input', 'ImageAsset', 'Input', false)],
    outputs: [P('metadata', 'MetadataObject', 'Metadata')],
    params: [],
  },
  {
    type: 'util.compare', label: 'Compare', family: 'UTILITY',
    description: 'Before/after comparison helper (passthrough A with comparison view).',
    version: 1,
    inputs: [P('a', 'ImageAsset', 'Before'), P('b', 'ImageAsset', 'After')],
    outputs: [P('image', 'ImageAsset', 'Passthrough A')],
    params: [slider('split', 'Split %', 50, 0, 100, 1)],
  },
  {
    type: 'util.branch', label: 'Branch', family: 'UTILITY',
    description: 'Fan out one image to two identical outputs.',
    version: 1, inputs: [P('image', 'ImageAsset', 'Image')],
    outputs: [P('a', 'ImageAsset', 'Branch A'), P('b', 'ImageAsset', 'Branch B')],
    params: [],
  },
  {
    type: 'util.merge', label: 'Merge', family: 'UTILITY',
    description: 'Collect images into an asset collection (no pixel blending).',
    version: 1, inputs: [P('images', 'ImageAsset', 'Images', true, true)],
    outputs: [P('collection', 'AssetCollection', 'Collection')],
    params: [],
  },
  {
    type: 'util.subgraph', label: 'Reusable Subgraph', family: 'SUBGRAPH',
    description: 'Execute a saved single-input/single-output subgraph definition inline (expanded by the scheduler into ordinary nodes).',
    version: 1,
    inputs: [P('image', 'ImageAsset', 'Image')],
    outputs: [P('image', 'ImageAsset', 'Output')],
    params: [str('subgraphId', 'Subgraph ID', '', 'string', 'ID of a saved subgraph (see Subgraphs library)')],
  },
  {
    type: 'util.inspector', label: 'Output Inspector', family: 'UTILITY',
    description: 'Passthrough node that surfaces its input in the preview panel.',
    version: 1, inputs: [P('input', 'ImageAsset', 'Input')],
    outputs: [P('image', 'ImageAsset', 'Passthrough')],
    params: [],
  },
  // ---------------- FUTURE PROVIDERS ----------------
  {
    type: 'provider.imageGen', label: 'Image Generation Adapter', family: 'FUTURE_PROVIDERS',
    description: 'UNAVAILABLE: no generation provider configured. Requires a real adapter.',
    version: 1, inputs: [P('prompt', 'TextPrompt', 'Prompt')],
    outputs: [P('image', 'ImageAsset', 'Generated')],
    params: [], unavailable: true, unavailableReason: 'No image-generation provider is configured. This node cannot execute.',
  },
  {
    type: 'provider.videoGen', label: 'Video Generation Adapter', family: 'FUTURE_PROVIDERS',
    description: 'UNAVAILABLE: no generation provider configured.',
    version: 1, inputs: [P('prompt', 'TextPrompt', 'Prompt')],
    outputs: [P('video', 'VideoAsset', 'Generated')],
    params: [], unavailable: true, unavailableReason: 'No video-generation provider is configured. This node cannot execute.',
  },
  {
    type: 'provider.audioGen', label: 'Audio Generation Adapter', family: 'FUTURE_PROVIDERS',
    description: 'UNAVAILABLE: no generation provider configured.',
    version: 1, inputs: [P('prompt', 'TextPrompt', 'Prompt')],
    outputs: [P('audio', 'AudioAsset', 'Generated')],
    params: [], unavailable: true, unavailableReason: 'No audio-generation provider is configured. This node cannot execute.',
  },
];

export const NODE_DEFS: NodeDefinition[] = DEFS.map((d) => ({ unavailable: false, ...d }));
const BY_TYPE = new Map<string, NodeDefinition>(NODE_DEFS.map((d) => [d.type, d]));

export function getNodeDef(type: string): NodeDefinition | undefined {
  return BY_TYPE.get(type);
}

export function defaultParams(def: NodeDefinition): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of def.params) out[p.key] = p.default;
  return out;
}

export function nodeFamilies(): Array<{ family: NodeDefinition['family']; defs: NodeDefinition[] }> {
  const order: Array<NodeDefinition['family']> = ['SOURCE', 'IMAGE', 'TIMELINE', '3D', 'UTILITY', 'SUBGRAPH', 'FUTURE_PROVIDERS'];
  return order.map((family) => ({ family, defs: NODE_DEFS.filter((d) => d.family === family) }));
}
