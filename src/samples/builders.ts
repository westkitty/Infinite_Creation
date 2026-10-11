// Sample workflow builders: real, editable, executable graphs. Samples use
// solid-color sources so they run anywhere with zero imports; users replace
// the sources with Image Import nodes for production work.

import { GRAPH_SCHEMA_VERSION, type GraphDoc, type TimelineDoc } from '../types/graph';
import { defaultParams, getNodeDef } from '../graph/registry';

export interface Sample {
  id: 'A' | 'B' | 'C';
  name: string;
  description: string;
  graph: GraphDoc;
  timeline: TimelineDoc;
}

let seq = 0;
function n(
  type: string,
  id: string,
  x: number,
  y: number,
  params: Record<string, unknown> = {},
  label?: string,
): GraphDoc['nodes'][number] {
  const def = getNodeDef(type);
  if (!def) throw new Error(`Sample references unknown node type ${type}`);
  return { id, type, position: { x, y }, data: { label, params: { ...defaultParams(def), ...params }, disabled: false } };
}
function e(source: string, sourceHandle: string, target: string, targetHandle: string): GraphDoc['edges'][number] {
  return { id: `e_${seq++}`, source, sourceHandle, target, targetHandle };
}
function doc(nodes: GraphDoc['nodes'], edges: GraphDoc['edges']): GraphDoc {
  return { schemaVersion: GRAPH_SCHEMA_VERSION, nodes, edges, links: [], viewport: { x: 40, y: 60, zoom: 0.9 } };
}
function emptyTimeline(): TimelineDoc {
  return { schemaVersion: 1, fps: 30, duration: 4, timebase: '30fps', tracks: [], playhead: 0 };
}

export function buildSampleA(): Sample {
  seq = 0;
  const nodes = [
    n('source.solidColor', 'src_base', 60, 120, { color: '#2e7fc1', width: 640, height: 480 }, 'Base plate'),
    n('image.crop', 'crop', 320, 120, { mode: 'pixels', x: 40, y: 30, width: 400, height: 300, lockAspect: false }, 'Crop 400×300'),
    n('image.colorBalance', 'grade', 580, 120, { red: 15, green: 4, blue: -10 }, 'Warm grade'),
    n('source.solidColor', 'src_badge', 60, 380, { color: '#c8102e', width: 160, height: 120 }, 'Badge layer'),
    n('image.composite', 'comp', 840, 140, { x: 200, y: 150, scale: 100, opacity: 85, blend: 'source-over' }, 'Composite badge'),
    n('image.export', 'export', 1100, 140, { format: 'png', quality: 92, filename: 'sample_a' }, 'Export PNG'),
  ];
  const edges = [
    e('src_base', 'image', 'crop', 'image'),
    e('crop', 'image', 'grade', 'image'),
    e('grade', 'image', 'comp', 'background'),
    e('src_badge', 'image', 'comp', 'foreground'),
    e('comp', 'image', 'export', 'image'),
  ];
  return {
    id: 'A',
    name: 'A · Image production pipeline',
    description: 'Import → Crop → Color → Composite → Export PNG. Executes end to end; swap the solid sources for Image Import nodes.',
    graph: doc(nodes, edges),
    timeline: emptyTimeline(),
  };
}

export function buildSampleB(): Sample {
  seq = 100;
  const nodes = [
    n('source.solidColor', 'src', 60, 180, { color: '#3a7f4c', width: 1200, height: 1200 }, 'Master artwork'),
    n('image.resize', 'master', 320, 180, { mode: 'dimensions', width: 1080, height: 1080, percent: 100, keepAspect: true, quality: 'high' }, 'Master 1080'),
    n('image.contrast', 'grade', 580, 180, { contrast: 15 }, 'Punch +15'),
    n('util.branch', 'branch', 800, 180, {}, 'Branch'),
    n('image.resize', 'r512', 1020, 80, { mode: 'dimensions', width: 512, height: 512, percent: 100, keepAspect: true, quality: 'high' }, 'Avatar 512'),
    n('image.export', 'x512', 1280, 80, { format: 'png', quality: 92, filename: 'avatar_512' }, 'Export 512'),
    n('image.resize', 'r256', 1020, 300, { mode: 'dimensions', width: 256, height: 256, percent: 100, keepAspect: true, quality: 'high' }, 'Avatar 256'),
    n('image.export', 'x256', 1280, 300, { format: 'png', quality: 92, filename: 'avatar_256' }, 'Export 256'),
  ];
  const edges = [
    e('src', 'image', 'master', 'image'),
    e('master', 'image', 'grade', 'image'),
    e('grade', 'image', 'branch', 'image'),
    e('branch', 'a', 'r512', 'image'),
    e('r512', 'image', 'x512', 'image'),
    e('branch', 'b', 'r256', 'image'),
    e('r256', 'image', 'x256', 'image'),
  ];
  return {
    id: 'B',
    name: 'B · Social asset factory',
    description: 'One master → shared grade → branched export dimensions. The shared intermediate computes once (cache hits on re-run).',
    graph: doc(nodes, edges),
    timeline: emptyTimeline(),
  };
}

export function buildSampleC(): Sample {
  seq = 200;
  const nodes = [
    n('source.solidColor', 'f1', 60, 60, { color: '#c8102e', width: 320, height: 200 }, 'Frame 1'),
    n('source.solidColor', 'f2', 60, 240, { color: '#2e7fc1', width: 320, height: 200 }, 'Frame 2'),
    n('source.solidColor', 'f3', 60, 420, { color: '#3a7f4c', width: 320, height: 200 }, 'Frame 3'),
    n('timeline.sequence', 'seq', 340, 200, { fps: 12 }, 'Sequence @12fps'),
    n('timeline.frameDuration', 'hold', 600, 200, { frames: 6 }, 'Hold 6 frames'),
    n('timeline.keyframes', 'keys', 340, 420, { time: 1, keys: '0:0,1:100' }, 'Fade 0→100'),
    n('timeline.transform', 'xf', 600, 420, { x: 10, y: 0, scale: 100, rotation: 0, opacity: 90 }, 'Drift +10px'),
    n('timeline.preview', 'prev', 880, 200, { time: 1, width: 320, height: 200 }, 'Preview t=1s'),
    n('image.export', 'xprev', 1140, 200, { format: 'png', quality: 92, filename: 'timeline_frame' }, 'Export frame'),
  ];
  const edges = [
    e('f1', 'image', 'seq', 'images'),
    e('f2', 'image', 'seq', 'images'),
    e('f3', 'image', 'seq', 'images'),
    e('seq', 'sequence', 'hold', 'sequence'),
    e('prev', 'image', 'xprev', 'image'),
  ];
  const timeline: TimelineDoc = {
    schemaVersion: 1, fps: 12, duration: 2, timebase: '12fps', playhead: 1,
    tracks: [
      { id: 'trk_demo', name: 'Demo stills', kind: 'image', assetIds: [], clipStart: 0, clipDuration: 2, keyframes: [], muted: false },
    ],
  };
  return {
    id: 'C',
    name: 'C · Animated image sequence',
    description: 'Stills → Sequence → hold durations; keyframed fade; deterministic project-timeline render at t=1s → PNG. Attach library images to the timeline track (ANIMATE) to animate real media.',
    graph: doc(nodes, edges),
    timeline,
  };
}

export function buildSample(id: 'A' | 'B' | 'C'): Sample {
  if (id === 'A') return buildSampleA();
  if (id === 'B') return buildSampleB();
  return buildSampleC();
}
