/**
 * Stripped-down CapCut project builder for igniting-roughcut.
 * Only handles: speaker video clips + hook text overlay.
 * No MGs, no captions, no greenscreen, no split-screen.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { DraftContentSchema } from "./capcut-schemas.js";
import type { VideoSection } from "./types.js";

// ─── Constants ─────────────────────────────────────────────────────────

const FRAME_DURATION_MICRO = 33333; // 30fps frame slot

const DEFAULTS = {
  fps: 30,
  canvasWidth: 1080,
  canvasHeight: 1920,
  hook: {
    fontSize: 64,
    fillColor: [1, 1, 1] as const,
    transformY: 0.349, // TikTok safe zone
    defaultDurationSec: 3,
  },
  renderIndex: {
    speakerVideo: 0,
    hook: 14000,
  },
} as const;

// All 54 materials.* subcollection keys CapCut expects
const MATERIALS_KEYS = [
  "ai_translates", "audio_balances", "audio_effects", "audio_fades",
  "audio_pannings", "audio_pitch_shifts", "audio_track_indexes", "audios",
  "beats", "canvases", "chromas", "color_curves", "common_mask",
  "digital_human_model_dressing", "digital_humans", "drafts", "effects",
  "flowers", "green_screens", "handwrites", "hsl", "hsl_curves", "images",
  "log_color_wheels", "loudnesses", "manual_beautys", "manual_deformations",
  "material_animations", "material_colors", "multi_language_refs",
  "placeholder_infos", "placeholders", "plugin_effects", "primary_color_wheels",
  "realtime_denoises", "shapes", "smart_crops", "smart_relights",
  "sound_channel_mappings", "speeds", "stickers", "tail_leaders",
  "text_templates", "texts", "time_marks", "transitions", "video_effects",
  "video_radius", "video_shadows", "video_strokes", "video_trackings",
  "videos", "vocal_beautifys", "vocal_separations",
] as const;

// CapCut stubs
const PLATFORM_STUB = {
  app_id: 359289, app_source: "cc", app_version: "8.3.0",
  device_id: "00000000000000000000000000000000", hard_disk_id: "",
  mac_address: "00000000000000000000000000000000",
  os: "windows", os_version: "10.0.19045",
};

const CONFIG_STUB = {
  adjust_max_index: 1, attachment_info: [], combination_max_index: 1,
  export_range: null, extract_audio_last_index: 1, lyrics_recognition_id: "",
  lyrics_sync: true, lyrics_taskinfo: [], maintrack_adsorb: false,
  material_save_mode: 0, multi_language_current: "none", multi_language_list: [],
  multi_language_main: "none", multi_language_mode: "none",
  original_sound_last_index: 1, record_audio_last_index: 1,
  sticker_max_index: 1, subtitle_keywords_config: null,
  subtitle_recognition_id: "", subtitle_sync: true, subtitle_taskinfo: [],
  system_font_list: [], use_float_render: false, video_mute: false,
  zoom_info_params: null,
};

const FUNCTION_ASSISTANT_STUB = {
  audio_noise_segid_list: [], auto_adjust: false, auto_adjust_fixed: false,
  auto_adjust_fixed_value: 50, auto_adjust_segid_list: [], auto_caption: false,
  auto_caption_segid_list: [], auto_caption_template_id: "", caption_opt: false,
  caption_opt_segid_list: [], color_correction: false,
  color_correction_fixed: false, color_correction_fixed_value: 50,
  color_correction_segid_list: [], deflicker_segid_list: [],
  enhance_quality: false, enhance_quality_fixed: false,
  enhance_quality_segid_list: [], enhance_voice_segid_list: [],
  enhande_voice: false, enhande_voice_fixed: false, eye_correction: false,
  eye_correction_segid_list: [], fixed_rec_applied: false,
  fps: { den: 1, num: 0 }, normalize_loudness: false,
  normalize_loudness_audio_denoise_segid_list: [],
  normalize_loudness_fixed: false, normalize_loudness_segid_list: [],
  retouch: false, retouch_fixed: false, retouch_segid_list: [],
  smart_rec_applied: false, smart_segid_list: [], smooth_slow_motion: false,
  smooth_slow_motion_fixed: false, video_noise_segid_list: [],
};

// ─── Helpers ───────────────────────────────────────────────────────────

function freshUuid(): string {
  return crypto.randomUUID().toUpperCase();
}

function toMicro(sec: number): number {
  const raw = sec * 1_000_000;
  return Math.round(raw / FRAME_DURATION_MICRO) * FRAME_DURATION_MICRO;
}

function buildEmptyMaterials(): Record<string, unknown[]> {
  const m: Record<string, unknown[]> = {};
  for (const k of MATERIALS_KEYS) m[k] = [];
  return m;
}

function buildVideoMaterial(opts: {
  id: string; path: string; fileName: string;
  durationMicro: number; width: number; height: number;
}) {
  const timeRange = { duration: opts.durationMicro, start: 0 };
  return {
    aigc_history_id: "", aigc_item_id: "", aigc_type: "none",
    audio_fade: null, beauty_body_auto_preset: null,
    beauty_body_preset_id: "",
    beauty_face_auto_preset: { name: "", preset_id: "", rate_map: "", scene: "" },
    beauty_face_auto_preset_infos: [], beauty_face_preset_infos: [],
    cartoon_path: "", category_id: "", category_name: "local",
    check_flag: 125892607, content_feature_info: null, corner_pin: null,
    crop: {
      lower_left_x: 0, lower_left_y: 1, lower_right_x: 1, lower_right_y: 1,
      upper_left_x: 0, upper_left_y: 0, upper_right_x: 1, upper_right_y: 0,
    },
    crop_ratio: "free", crop_scale: 1, duration: opts.durationMicro,
    extra_type_option: 0, formula_id: "", freeze: null, has_audio: true,
    has_sound_separated: false, height: opts.height, id: opts.id,
    intensifies_audio_path: "", intensifies_path: "",
    is_ai_generate_content: false, is_copyright: false,
    is_text_edit_overdub: false, is_unified_beauty_mode: false,
    live_photo_cover_path: "", live_photo_timestamp: -1, local_id: "",
    local_material_from: "", local_material_id: freshUuid(),
    material_id: "", material_name: opts.fileName, material_url: "",
    matting: {
      custom_matting_id: "", enable_matting_stroke: false, expansion: 0,
      feather: 0, flag: 0, has_use_quick_brush: false,
      has_use_quick_eraser: false, interactiveTime: [], path: "",
      reverse: false, strokes: [],
    },
    media_path: "", multi_camera_info: null, object_locked: null,
    origin_material_id: "", path: opts.path, picture_from: "none",
    picture_set_category_id: "", picture_set_category_name: "",
    request_id: "", reverse_intensifies_path: "", reverse_path: "",
    smart_match_info: null, smart_motion: null, source: 0, source_platform: 0,
    stable: { matrix_path: "", stable_level: 0, time_range: timeRange },
    surface_trackings: [], team_id: "", type: "video", unique_id: "",
    video_algorithm: {
      ai_background_configs: [], ai_expression_driven: null,
      ai_in_painting_config: [], ai_motion_driven: null, aigc_generate: null,
      aigc_generate_list: [], algorithms: [], complement_frame_config: null,
      deflicker: null, gameplay_configs: [], image_interpretation: null,
      motion_blur_config: null, mouth_shape_driver: null,
      noise_reduction: null, path: "", quality_enhance: null,
      skip_algorithm_index: [], smart_complement_frame: null,
      story_video_modify_video_config: {
        is_overwrite_last_video: false, task_id: "", tracker_task_id: "",
      },
      super_resolution: null, time_range: timeRange,
    },
    video_mask_shadow: {
      alpha: 0, angle: 0, blur: 0, color: "", distance: 0, path: "",
      resource_id: "",
    },
    video_mask_stroke: {
      alpha: 0, color: "", distance: 0, horizontal_shift: 0, path: "",
      resource_id: "", size: 0, texture: 0, type: "", vertical_shift: 0,
    },
    width: opts.width,
  };
}

function buildVideoShadowSet() {
  return {
    canvas: {
      album_image: "", blur: 0, color: "", id: freshUuid(), image: "",
      image_id: "", image_name: "", source_platform: 0, team_id: "",
      type: "canvas_color",
    },
    speed: { curve_speed: null, id: freshUuid(), mode: 0, speed: 1, type: "speed" },
    loudness: {
      enable: false, file_id: "", id: freshUuid(), loudness_param: null,
      target_loudness: 0, time_range: null,
    },
    scm: {
      audio_channel_mapping: 0, id: freshUuid(), is_config_open: false,
      type: "none",
    },
    vocal: {
      choice: 0, enter_from: "", final_algorithm: "", id: freshUuid(),
      production_path: "", removed_sounds: [], time_range: null,
      type: "vocal_separation",
    },
    color: {
      gradient_angle: 90, gradient_colors: [], gradient_percents: [],
      height: 0, id: freshUuid(), is_color_clip: false, is_gradient: false,
      solid_color: "", width: 0,
    },
    placeholder: {
      error_path: "", error_text: "", id: freshUuid(), meta_type: "none",
      res_path: "", res_text: "", type: "placeholder_info",
    },
    timeMark: { id: freshUuid(), mark_items: [] },
    animation: {
      animations: [], id: freshUuid(), multi_language_current: "none",
      type: "sticker_animation",
    },
  };
}

function appendShadowRefs(materials: Record<string, unknown[]>): string[] {
  const shadows = buildVideoShadowSet();
  materials.canvases.push(shadows.canvas);
  materials.speeds.push(shadows.speed);
  materials.loudnesses.push(shadows.loudness);
  materials.sound_channel_mappings.push(shadows.scm);
  materials.vocal_separations.push(shadows.vocal);
  materials.material_colors.push(shadows.color);
  materials.placeholder_infos.push(shadows.placeholder);
  materials.time_marks.push(shadows.timeMark);
  materials.material_animations.push(shadows.animation);
  return [
    shadows.timeMark.id, shadows.speed.id, shadows.placeholder.id,
    shadows.canvas.id, shadows.animation.id, shadows.scm.id,
    shadows.color.id, shadows.loudness.id, shadows.vocal.id,
  ];
}

function encodeTextContent(
  text: string,
  fillRgb: readonly [number, number, number],
  size: number
): string {
  return JSON.stringify({
    text,
    styles: [{
      size,
      fill: {
        content: {
          render_type: "solid",
          solid: { color: [fillRgb[0], fillRgb[1], fillRgb[2]] },
        },
      },
      range: [0, text.length],
    }],
  });
}

function buildTextMaterial(opts: {
  id: string; text: string; fontSize: number;
  fillRgb: readonly [number, number, number];
}) {
  return {
    add_type: 0, alignment: 1, background_alpha: 1, background_color: "#000000",
    background_fill: "", background_height: 0, background_horizontal_offset: 0,
    background_round_radius: 0.08, background_style: 1,
    background_vertical_offset: 0, background_width: 0, base_content: "",
    bold_width: 0, border_alpha: 1, border_color: "", border_mode: 0,
    border_width: 0.06,
    caption_template_info: {
      category_id: "", category_name: "", effect_id: "", is_new: false,
      path: "", request_id: "", resource_id: "", resource_name: "",
      source_platform: 0, third_resource_id: "",
    },
    check_flag: 23, combo_info: { text_templates: [] },
    content: encodeTextContent(opts.text, opts.fillRgb, opts.fontSize),
    current_words: { end_time: [], start_time: [], text: [] },
    cutoff_postfix: "", enable_path_typesetting: false, fixed_height: -1,
    fixed_width: -1, font_category_id: "", font_category_name: "", font_id: "",
    font_name: "", font_path: "", font_resource_id: "", font_size: opts.fontSize,
    font_source_platform: 0, font_team_id: "", font_third_resource_id: "",
    font_title: "", font_url: "", fonts: [], force_apply_line_max_width: true,
    global_alpha: 1, group_id: "", has_shadow: false, id: opts.id,
    initial_scale: 0, inner_padding: -1, is_batch_replace: false,
    is_lyric_effect: false, is_rich_text: false, is_words_linear: false,
    italic_degree: 0, ktv_color: "", language: "", layer_weight: 0,
    letter_spacing: 0, line_feed: 1, line_max_width: 0.55, line_spacing: 0.2,
    lyric_group_id: "",
    lyrics_template: {
      category_id: "", category_name: "", effect_id: "", panel: "",
      path: "", request_id: "", resource_id: "", resource_name: "",
    },
    multi_language_current: "none", name: "", offset_on_path: 0,
    oneline_cutoff: false, operation_type: 0, original_size: [],
    preset_category: "", preset_category_id: "",
    preset_has_set_alignment: false, preset_id: "", preset_index: 0,
    preset_name: "", punc_model: "", recognize_model: "",
    recognize_task_id: "", recognize_text: "", recognize_type: 0,
    relevance_segment: [], shadow_alpha: 0.9, shadow_angle: 315,
    shadow_color: "", shadow_distance: 8,
    shadow_point: { x: 0.7071067811865476, y: -0.7071067811865476 },
    shadow_smoothing: 4, shadow_thickness_projection_angle: 0,
    shadow_thickness_projection_distance: 0,
    shadow_thickness_projection_enable: false, shape_clip_x: false,
    shape_clip_y: false, single_char_bg_alpha: 1, single_char_bg_color: "",
    single_char_bg_enable: false, single_char_bg_height: 0,
    single_char_bg_horizontal_offset: 0, single_char_bg_round_radius: 0.3,
    single_char_bg_vertical_offset: 0, single_char_bg_width: 0,
    source_from: "", ssml_content: "", style_name: "", sub_template_id: -1,
    sub_type: 0, subtitle_keywords: null, subtitle_keywords_config: null,
    subtitle_template_original_fontsize: 0, text_alpha: 1,
    text_color: "#FFFFFF", text_curve: null,
    text_exceeds_path_process_type: 0, text_loop_on_path: false,
    text_preset_resource_id: "", text_size: 30, text_to_audio_ids: [],
    text_typesetting_path_index: 0, text_typesetting_paths: null,
    text_typesetting_paths_file: "", translate_original_text: "",
    tts_auto_update: false, type: "text", typesetting: 0, underline: false,
    underline_offset: 0.22, underline_width: 0.05,
    use_effect_default_color: true,
    words: { end_time: [], start_time: [], text: [] },
  };
}

function buildVideoSegment(opts: {
  materialId: string; shadowRefs: string[];
  sourceStartMicro: number; durationMicro: number; renderIndex: number;
}) {
  return {
    caption_info: null, cartoon: false,
    clip: {
      alpha: 1, flip: { horizontal: false, vertical: false },
      rotation: 0, scale: { x: 1, y: 1 }, transform: { x: 0, y: 0 },
    },
    color_correct_alg_result: "", common_keyframes: [], desc: "",
    digital_human_template_group_id: "", enable_adjust: true,
    enable_adjust_mask: false, enable_color_adjust_pro: false,
    enable_color_correct_adjust: false, enable_color_curves: true,
    enable_color_match_adjust: false, enable_color_wheels: true,
    enable_hsl: false, enable_hsl_curves: true, enable_lut: true,
    enable_mask_shadow: false, enable_mask_stroke: false,
    enable_smart_color_adjust: false, enable_video_mask: true,
    extra_material_refs: opts.shadowRefs, group_id: "",
    hdr_settings: { intensity: 1, mode: 1, nits: 1000 },
    id: freshUuid(), intensifies_audio: false, is_loop: false,
    is_placeholder: false, is_tone_modify: false, keyframe_refs: [],
    last_nonzero_volume: 1, lyric_keyframes: null,
    material_id: opts.materialId, raw_segment_id: "",
    render_index: opts.renderIndex,
    render_timerange: { duration: 0, start: 0 },
    responsive_layout: {
      enable: false, horizontal_pos_layout: 0, size_layout: 0,
      target_follow: "", vertical_pos_layout: 0,
    },
    reverse: false, source: "segmentsourcenormal",
    source_timerange: { duration: opts.durationMicro, start: opts.sourceStartMicro },
    speed: 1, state: 0,
    target_timerange: { duration: opts.durationMicro, start: 0 },
    template_id: "", template_scene: "default", track_attribute: 0,
    track_render_index: 0, uniform_scale: { on: true, value: 1 },
    visible: true, volume: 1,
  };
}

function buildTextSegment(opts: {
  materialId: string; animationId: string;
  durationMicro: number; renderIndex: number; transformY: number;
}) {
  return {
    caption_info: null, cartoon: false,
    clip: {
      alpha: 1, flip: { horizontal: false, vertical: false },
      rotation: 0, scale: { x: 1, y: 1 }, transform: { x: 0, y: opts.transformY },
    },
    color_correct_alg_result: "", common_keyframes: [], desc: "",
    digital_human_template_group_id: "", enable_adjust: false,
    enable_adjust_mask: false, enable_color_adjust_pro: false,
    enable_color_correct_adjust: false, enable_color_curves: true,
    enable_color_match_adjust: false, enable_color_wheels: true,
    enable_hsl: false, enable_hsl_curves: true, enable_lut: false,
    enable_mask_shadow: false, enable_mask_stroke: false,
    enable_smart_color_adjust: false, enable_video_mask: true,
    extra_material_refs: [opts.animationId], group_id: "",
    hdr_settings: null, id: freshUuid(), intensifies_audio: false,
    is_loop: false, is_placeholder: false, is_tone_modify: false,
    keyframe_refs: [], last_nonzero_volume: 1, lyric_keyframes: null,
    material_id: opts.materialId, raw_segment_id: "",
    render_index: opts.renderIndex,
    render_timerange: { duration: 0, start: 0 },
    responsive_layout: {
      enable: false, horizontal_pos_layout: 0, size_layout: 0,
      target_follow: "", vertical_pos_layout: 0,
    },
    reverse: false, source: "segmentsourcenormal",
    source_timerange: null, speed: 1, state: 0,
    target_timerange: { duration: opts.durationMicro, start: 0 },
    template_id: "", template_scene: "default", track_attribute: 0,
    track_render_index: 0, uniform_scale: { on: true, value: 1 },
    visible: true, volume: 1,
  };
}

function buildTrack(type: string, flag: number, segments: unknown[]) {
  return {
    attribute: 0, flag, id: freshUuid(), is_default_name: true,
    name: "", segments, type,
  };
}

// ─── Public API ────────────────────────────────────────────────────────

export interface ClipInput {
  /** Absolute path to source video file. */
  sourcePath: string;
  /** In-point on source (seconds). */
  sourceStartSec: number;
  /** Duration to play (seconds). */
  sourceDurationSec: number;
}

export interface BuildRoughcutOpts {
  projectName: string;
  /** CapCut drafts root directory. */
  draftsDir: string;
  /** Clips in timeline order. */
  clips: ClipInput[];
  /** Hook text to display. */
  hookText: string;
  /** Real source video duration in seconds — required for CapCut to play full clips. */
  sourceVideoDurationSec: number;
}

export interface BuildRoughcutResult {
  projectDir: string;
}

/**
 * Build a minimal CapCut project with rough-cut clips and hook text.
 */
export function buildRoughcutProject(opts: BuildRoughcutOpts): BuildRoughcutResult {
  const { clips, hookText } = opts;
  const fps = DEFAULTS.fps;
  const width = DEFAULTS.canvasWidth;
  const height = DEFAULTS.canvasHeight;

  const projectsRoot = opts.draftsDir.replace(/\\/g, "/");
  const projectDir = `${projectsRoot}/${opts.projectName}`;

  const materials = buildEmptyMaterials();

  // ─── Speaker clips ──────────────────────────────────────────────────
  const speakerSegments: unknown[] = [];
  let timelineCursorMicro = 0;

  for (const clip of clips) {
    const videoPath = clip.sourcePath.replace(/\\/g, "/");
    const fileName = videoPath.split("/").pop() ?? "video.mp4";

    const materialId = freshUuid();
    materials.videos.push(
      buildVideoMaterial({
        id: materialId,
        path: videoPath,
        fileName,
        durationMicro: toMicro(opts.sourceVideoDurationSec),
        width: 1080,
        height: 1920,
      })
    );

    const shadowRefs = appendShadowRefs(materials);
    const durationMicro = toMicro(clip.sourceDurationSec);
    const sourceStartMicro = toMicro(clip.sourceStartSec);

    const seg = buildVideoSegment({
      materialId,
      shadowRefs,
      sourceStartMicro,
      durationMicro,
      renderIndex: DEFAULTS.renderIndex.speakerVideo,
    }) as ReturnType<typeof buildVideoSegment> & {
      target_timerange: { start: number; duration: number };
    };
    seg.target_timerange = { start: timelineCursorMicro, duration: durationMicro };

    speakerSegments.push(seg);
    timelineCursorMicro += durationMicro;
  }

  const totalDurationMicro = timelineCursorMicro;

  // ─── Hook text ──────────────────────────────────────────────────────
  const hookTextId = freshUuid();
  materials.texts.push(
    buildTextMaterial({
      id: hookTextId,
      text: hookText,
      fontSize: 12, // CapCut internal unit
      fillRgb: DEFAULTS.hook.fillColor,
    })
  );

  const hookAnim = {
    animations: [], id: freshUuid(),
    multi_language_current: "none", type: "sticker_animation",
  };
  materials.material_animations.push(hookAnim);

  const hookDisplayDurSec = Math.min(
    DEFAULTS.hook.defaultDurationSec,
    timelineCursorMicro / 1_000_000
  );
  const hookSegment = buildTextSegment({
    materialId: hookTextId,
    animationId: hookAnim.id,
    durationMicro: toMicro(hookDisplayDurSec),
    renderIndex: DEFAULTS.renderIndex.hook,
    transformY: DEFAULTS.hook.transformY,
  });

  // ─── Tracks ─────────────────────────────────────────────────────────
  const tracks = [
    buildTrack("video", 0, speakerSegments),
    buildTrack("text", 0, [hookSegment]),
  ];

  // ─── Top-level draft_content.json ───────────────────────────────────
  const draftId = freshUuid();
  const draftContentRaw = {
    canvas_config: { background: null, height, ratio: "9:16", width },
    color_space: -1,
    config: CONFIG_STUB,
    cover: null,
    create_time: 0,
    draft_type: "video",
    duration: totalDurationMicro,
    extra_info: null,
    fps,
    free_render_index_mode_on: false,
    function_assistant_info: FUNCTION_ASSISTANT_STUB,
    group_container: null,
    id: draftId,
    is_drop_frame_timecode: false,
    keyframe_graph_list: [],
    keyframes: {
      adjusts: [], audios: [], effects: [], filters: [],
      handwrites: [], stickers: [], texts: [], videos: [],
    },
    last_modified_platform: PLATFORM_STUB,
    lyrics_effects: [],
    materials,
    mutable_config: null,
    name: opts.projectName,
    new_version: "163.0.0",
    path: "",
    platform: PLATFORM_STUB,
    relationships: [],
    render_index_track_mode_on: false,
    retouch_cover: null,
    smart_ads_info: { draft_url: "", page_from: "", routine: "" },
    source: "default",
    static_cover_image_path: "",
    time_marks: null,
    tracks,
    uneven_animation_template_info: {
      composition: "", content: "", order: "", sub_template_info_list: [],
    },
    update_time: 0,
    version: 360000,
  };

  // Validate before writing
  const draftContent = DraftContentSchema.parse(draftContentRaw);

  // ─── Write project files ────────────────────────────────────────────
  fs.mkdirSync(projectDir, { recursive: true });

  // Sibling directories CapCut expects
  for (const d of [
    "Resources", "Timelines", "matting", "adjust_mask",
    "smart_crop", "common_attachment", "subdraft", "qr_upload", "video",
  ]) {
    fs.mkdirSync(path.join(projectDir, d), { recursive: true });
  }

  // Write draft_content.json
  fs.writeFileSync(
    path.join(projectDir, "draft_content.json"),
    JSON.stringify(draftContent),
    "utf-8"
  );

  // Write sibling meta files
  const nowMicro = Date.now() * 1000;
  const firstClipPath = clips[0]?.sourcePath.replace(/\\/g, "/") ?? "";
  const firstFileName = firstClipPath.split("/").pop() ?? "video.mp4";

  const draftMetaInfo = {
    cloud_draft_cover: false, cloud_draft_sync: false,
    cloud_package_completed_time: "",
    draft_cloud_capcut_purchase_info: "",
    draft_cloud_last_action_download: false,
    draft_cloud_package_type: "", draft_cloud_purchase_info: "",
    draft_cloud_template_id: "", draft_cloud_tutorial_info: "",
    draft_cloud_videocut_purchase_info: "",
    draft_cover: "draft_cover.jpg", draft_deeplink_url: "",
    draft_enterprise_info: {
      draft_enterprise_extra: "", draft_enterprise_id: "",
      draft_enterprise_name: "", enterprise_material: [],
    },
    draft_fold_path: projectDir, draft_id: freshUuid(),
    draft_is_ae_produce: false, draft_is_ai_packaging_used: false,
    draft_is_ai_shorts: false, draft_is_ai_translate: false,
    draft_is_article_video_draft: false, draft_is_cloud_temp_draft: false,
    draft_is_from_deeplink: "false", draft_is_invisible: false,
    draft_is_web_article_video: false,
    draft_materials: [
      {
        type: 0,
        value: [{
          ai_group_type: "", create_time: -1, duration: toMicro(60),
          enter_from: 0, extra_info: firstFileName,
          file_Path: firstClipPath, height: 1920,
          id: freshUuid(), import_time: -1, import_time_ms: -1,
          item_source: 1, md5: "", metetype: "video",
          roughcut_time_range: { duration: toMicro(60), start: 0 },
          sub_time_range: { duration: -1, start: -1 },
          type: 0, width: 1080,
        }],
      },
      { type: 1, value: [] }, { type: 2, value: [] },
      { type: 3, value: [] }, { type: 6, value: [] },
      { type: 7, value: [] }, { type: 8, value: [] },
    ],
    draft_materials_copied_info: [], draft_name: opts.projectName,
    draft_need_rename_folder: false, draft_new_version: "163.0.0",
    draft_removable_storage_device: "",
    draft_root_path: projectsRoot, draft_segment_extra_info: [],
    draft_timeline_materials_size_: 0, draft_type: "",
    draft_web_article_video_enter_from: "",
    tm_draft_cloud_completed: "0", tm_draft_cloud_entry_id: -1,
    tm_draft_cloud_modified: 0, tm_draft_cloud_parent_entry_id: -1,
    tm_draft_cloud_space_id: 0, tm_draft_cloud_user_id: 0,
    tm_draft_create: nowMicro, tm_draft_modified: nowMicro,
    tm_duration: totalDurationMicro,
  };

  fs.writeFileSync(
    path.join(projectDir, "draft_meta_info.json"),
    JSON.stringify(draftMetaInfo),
    "utf-8"
  );

  fs.writeFileSync(
    path.join(projectDir, "draft_virtual_store.json"),
    JSON.stringify({ draft_materials: [], draft_virtual_store: [] }),
    "utf-8"
  );

  fs.writeFileSync(
    path.join(projectDir, "key_value.json"),
    "{}",
    "utf-8"
  );

  console.log(`  Created CapCut project: ${projectDir}`);
  return { projectDir };
}

/**
 * Convert VideoSections (frame-based) to ClipInputs (second-based)
 * for feeding into the CapCut builder.
 */
export function sectionsToClips(
  sections: VideoSection[],
  fps: number,
  videoPath: string
): ClipInput[] {
  return sections.map((s) => ({
    sourcePath: path.resolve(videoPath),
    sourceStartSec: s.startFrame / fps,
    sourceDurationSec: s.durationInFrames / fps,
  }));
}
