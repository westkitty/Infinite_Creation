import { z } from 'zod';

export const GRAPH_SCHEMA_VERSION = 3 as const;
export const APP_VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------
export const DataTypeSchema = z.enum([
  'ImageAsset',
  'ImageMask',
  'AudioAsset',
  'VideoAsset',
  'Model3DAsset',
  'ImageSequence',
  'AnimationTimeline',
  'TextPrompt',
  'NumericValue',
  'ColorValue',
  'BooleanValue',
  'TransformParameters',
  'MetadataObject',
  'AssetCollection',
  'ExportArtifact',
]);
export type DataType = z.infer<typeof DataTypeSchema>;

// ImageAsset and ImageMask are intercompatible for image inputs (mask is a
// single-channel image asset). Everything else requires exact match, except
// AssetCollection which fans out per-member (handled by scheduler).
export function typesCompatible(source: DataType, target: DataType): boolean {
  if (source === target) return true;
  if (
    (source === 'ImageAsset' && target === 'ImageMask') ||
    (source === 'ImageMask' && target === 'ImageAsset')
  ) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------
export const PortSchema = z.object({
  id: z.string().min(1),
  dataType: DataTypeSchema,
  required: z.boolean(),
  multiple: z.boolean().default(false),
  label: z.string(),
  description: z.string().optional(),
  defaultValue: z.unknown().optional(),
  version: z.number().int().default(1),
});
export type Port = z.infer<typeof PortSchema>;

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------
export const ParamTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'color',
  'select',
  'slider',
  'assetRef',
  'text',
]);
export type ParamType = z.infer<typeof ParamTypeSchema>;

export const ParamDefSchema = z.object({
  key: z.string().min(1),
  label: z.string(),
  type: ParamTypeSchema,
  default: z.unknown(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  options: z.array(z.string()).optional(),
  description: z.string().optional(),
  required: z.boolean().default(false),
});
export type ParamDef = z.infer<typeof ParamDefSchema>;

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------
export const NodeFamilySchema = z.enum([
  'SOURCE',
  'IMAGE',
  'TIMELINE',
  '3D',
  'UTILITY',
  'FUTURE_PROVIDERS',
  'SUBGRAPH',
]);
export type NodeFamily = z.infer<typeof NodeFamilySchema>;

export const NodeDefinitionSchema = z.object({
  type: z.string().min(1),
  label: z.string(),
  family: NodeFamilySchema,
  description: z.string(),
  version: z.number().int().min(1),
  inputs: z.array(PortSchema),
  outputs: z.array(PortSchema),
  params: z.array(ParamDefSchema),
  unavailable: z.boolean().default(false),
  unavailableReason: z.string().optional(),
});
export type NodeDefinition = z.infer<typeof NodeDefinitionSchema>;

export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.object({
    label: z.string().optional(),
    params: z.record(z.unknown()).default({}),
    disabled: z.boolean().default(false),
    note: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    collapsed: z.boolean().optional(),
    preset: z.string().optional(),
  }),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  sourceHandle: z.string().min(1),
  target: z.string().min(1),
  targetHandle: z.string().min(1),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const ViewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number(),
});
export type Viewport = z.infer<typeof ViewportSchema>;

// ---------------------------------------------------------------------------
// Graph document
// ---------------------------------------------------------------------------
export const GraphDocSchema = z.object({
  schemaVersion: z.number().int(),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  viewport: ViewportSchema.optional(),
});
export type GraphDoc = z.infer<typeof GraphDocSchema>;

// ---------------------------------------------------------------------------
// Execution state
// ---------------------------------------------------------------------------
export const ExecStatusSchema = z.enum([
  'idle',
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
  'blocked',
  'stale',
]);
export type ExecStatus = z.infer<typeof ExecStatusSchema>;

export interface NodeRunRecord {
  nodeId: string;
  status: ExecStatus;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  cacheHit?: boolean;
  error?: string;
  outputHash?: string;
  outputAssetId?: string;
}

export interface RunRecord {
  runId: string;
  startedAt: number;
  finishedAt?: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  nodeRuns: Record<string, NodeRunRecord>;
  error?: string;
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------
export const AssetKindSchema = z.enum([
  'image',
  'audio',
  'video',
  'model3d',
  'sequence',
  'artifact',
  'derived',
]);
export type AssetKind = z.infer<typeof AssetKindSchema>;

export const ApprovalStateSchema = z.enum(['draft', 'review', 'approved', 'rejected', 'superseded']);
export type ApprovalState = z.infer<typeof ApprovalStateSchema>;

export const AssetRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  kind: AssetKindSchema,
  mime: z.string(),
  size: z.number().int().nonnegative(),
  hash: z.string(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  duration: z.number().optional(),
  createdAt: z.number(),
  tags: z.array(z.string()).default([]),
  favorite: z.boolean().default(false),
  approval: ApprovalStateSchema.default('draft'),
  note: z.string().optional(),
  provenance: z
    .object({
      parentIds: z.array(z.string()).default([]),
      nodeId: z.string().optional(),
      nodeType: z.string().optional(),
      nodeVersion: z.number().optional(),
      inputHashes: z.array(z.string()).default([]),
      params: z.record(z.unknown()).default({}),
      runId: z.string().optional(),
      outputFormat: z.string().optional(),
    })
    .optional(),
  missing: z.boolean().default(false),
});
export type AssetRecord = z.infer<typeof AssetRecordSchema>;

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------
export const ProjectMetaSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  schemaVersion: z.number().int(),
  description: z.string().optional(),
});
export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;

export interface PersistedProject {
  meta: ProjectMeta;
  graph: GraphDoc;
  timeline: TimelineDoc;
  approvals: Record<string, ApprovalState>;
  notes: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------
export const KeyframeSchema = z.object({
  id: z.string(),
  time: z.number().nonnegative(),
  value: z.unknown(),
  interpolation: z.enum(['linear', 'hold']).default('linear'),
});
export type Keyframe = z.infer<typeof KeyframeSchema>;

export const TimelineTrackSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['image', 'transform', 'opacity']),
  assetIds: z.array(z.string()).default([]),
  clipStart: z.number().default(0),
  clipDuration: z.number().default(1),
  keyframes: z.array(KeyframeSchema).default([]),
  muted: z.boolean().default(false),
});
export type TimelineTrack = z.infer<typeof TimelineTrackSchema>;

export const TimelineDocSchema = z.object({
  schemaVersion: z.number().int(),
  fps: z.number().positive().default(30),
  duration: z.number().positive().default(4),
  timebase: z.string().default('30fps'),
  tracks: z.array(TimelineTrackSchema).default([]),
  playhead: z.number().default(0),
});
export type TimelineDoc = z.infer<typeof TimelineDocSchema>;
