/**
 * Zod schemas for CapCut draft_content.json validation.
 * Stripped version — only what's needed for roughcut (clips + hook text).
 */

import { z } from "zod/v4";

export const TimerangeSchema = z
  .object({
    start: z.number().int(),
    duration: z.number().int(),
  })
  .passthrough();

export const MaterialSchema = z
  .object({
    id: z.string(),
    type: z.string().optional(),
    path: z.string().optional(),
    material_name: z.string().optional(),
    duration: z.number().int().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  })
  .passthrough();

export const TextMaterialSchema = z
  .object({
    id: z.string(),
    content: z.string(),
    type: z.string().optional(),
    font_size: z.number().optional(),
  })
  .passthrough();

export const SegmentSchema = z
  .object({
    id: z.string(),
    material_id: z.string(),
    source_timerange: TimerangeSchema.nullable().optional(),
    target_timerange: TimerangeSchema,
    render_index: z.number().int().optional(),
    extra_material_refs: z.array(z.string()).optional(),
  })
  .passthrough();

export const TrackSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    attribute: z.number().int().optional(),
    flag: z.number().int().optional(),
    segments: z.array(SegmentSchema),
  })
  .passthrough();

export const MaterialsSchema = z
  .object({
    videos: z.array(MaterialSchema),
    texts: z.array(TextMaterialSchema),
  })
  .passthrough();

export const DraftContentSchema = z
  .object({
    id: z.string(),
    duration: z.number().int(),
    fps: z.number().optional(),
    materials: MaterialsSchema,
    tracks: z.array(TrackSchema),
    canvas_config: z.any().optional(),
    new_version: z.string().optional(),
    version: z.number().optional(),
  })
  .passthrough();

export type DraftContent = z.infer<typeof DraftContentSchema>;
