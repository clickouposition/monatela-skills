/** SFX used by style-edit — file names inside the studio SX folder (same set as full-edit). */
export const SFX_FILES = {
  boom: "ES_Designed, Boom, Impact, Dark, Cinematic, Low Long Rumble 01 - Epidemic Sound.mp3",
  riser: "ES_Designed, Riser, Bass, Sharp Detail Riser - Epidemic Sound.mp3",
  transition: "Transition 2.mp3",
  whoosh: "ES_Swooshes, Whoosh, Fast, Close, Airy, Zoom 01 - Epidemic Sound.mp3",
  click: "ES_Computers, Keyboard & Mouse, Mouse, Apple Magic, Left Click, Various Single - Epidemic Sound.mp3",
  pop: "ES_Cartoon, Pop, Small Lid - Epidemic Sound.mp3",
  popup: "Pop up Sound effect ( 256kbps cbr ).mp3",
} as const;
export type SfxKey = keyof typeof SFX_FILES;
