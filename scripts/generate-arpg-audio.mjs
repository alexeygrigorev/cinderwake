// Run: node --env-file=../red-stamp/.env scripts/generate-arpg-audio.mjs
// Existing assets are reused; --only=<cue> limits requests. No credentials are saved.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const directory = new URL("../public/assets/audio/", import.meta.url);
const digest = (audio) => createHash("sha256").update(audio).digest("hex");
function ffmpeg(audio, args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-i", "pipe:0", ...args]);
    const output = [];
    let diagnostics = "";
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => {
      diagnostics += chunk;
    });
    child.on("error", reject);
    child.stdin.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve({ audio: Buffer.concat(output), diagnostics })
        : reject(new Error("FFmpeg audio processing failed")),
    );
    child.stdin.end(audio);
  });
}
async function normalize(audio) {
  const analysis = await ffmpeg(audio, [
    "-af",
    "volumedetect",
    "-f",
    "null",
    "-",
  ]);
  const peak = Number(
    analysis.diagnostics.match(/max_volume: (-?[\d.]+) dB/)?.[1],
  );
  if (!Number.isFinite(peak)) throw new Error("Audio has no measurable signal");
  const gainDb = Number((-3 - peak).toFixed(1));
  const result = await ffmpeg(audio, [
    "-af",
    `volume=${gainDb}dB`,
    "-ar",
    "44100",
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "128k",
    "-f",
    "mp3",
    "pipe:1",
  ]);
  return {
    audio: result.audio,
    processing: {
      method: "FFmpeg peak normalization",
      targetPeakDb: -3,
      sourcePeakDb: peak,
      gainDb,
      sourceSha256: digest(audio),
    },
  };
}
const voices = {
  ileya: { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily - Velvety Actress" },
  tess: {
    id: "EXAVITQu4vr4xnSDxMaL",
    name: "Sarah - Mature, Reassuring, Confident",
  },
};
const sounds = [
  [
    "strike",
    0.5,
    "One fast heavy sword swing, close dry metallic air whoosh, immediate onset, dark fantasy game combat, no voice, no music.",
  ],
  [
    "hit",
    0.5,
    "One powerful sword impact against old leather armor, sharp metal bite then low body thud, immediate onset, dry close combat game effect, no voice, no music.",
  ],
  [
    "loot",
    0.7,
    "Small handful of gold coins dropping into a leather pouch, crisp delicate bright metal clink, satisfying short treasure pickup, immediate onset, no music.",
  ],
  [
    "quest",
    1.5,
    "A single warm ancient bronze bell chime with subtle shimmering overtones and a short fading tail, dark fantasy quest completion, hopeful and restrained, no voice.",
  ],
  [
    "danger",
    0.6,
    "One low heavy shield impact with a brief gravel crunch, tense blunt damage warning for a dark fantasy game, immediate onset, no voice, no music.",
  ],
  [
    "ability",
    1.0,
    "One fiery magical shockwave bursting outward, deep punchy ignition then short rushing embers, immediate onset, dark fantasy action game, no voice, no music.",
  ],
].map(([cue, duration, text]) => ({ cue, kind: "sfx", duration, text }));
const narration = [
  [
    "quest:arrival",
    "ileya",
    "The dead have taken the road. Break their ranks, then find what calls them.",
  ],
  [
    "quest:keeper",
    "ileya",
    "That stone giant was our bell keeper. Silence him. Let the road remember peace.",
  ],
  [
    "quest:road",
    "ileya",
    "The bell is silent. Follow the old road sign. Embercross still holds.",
  ],
  [
    "npc:ileya",
    "ileya",
    "You brought the warning home. Return to the south gate and seal the rift.",
  ],
  [
    "npc:tess",
    "tess",
    "Your room is ready. Rest here. We will keep a light for your return.",
  ],
  [
    "quest:complete",
    "ileya",
    "For one more dawn, the dead are silent. Embercross remembers your name.",
  ],
].map(([cue, character, text]) => ({ cue, kind: "voice", character, text }));

const key = process.env.ELEVENLABS_API_KEY;
const normalizeExisting = process.argv.includes("--normalize-existing");
if (!key && !normalizeExisting)
  throw new Error("Missing ELEVENLABS_API_KEY; use Node --env-file.");
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
await mkdir(directory, { recursive: true });
const manifestUrl = new URL("manifest.json", directory);
const manifest = await readFile(manifestUrl, "utf8")
  .then(JSON.parse)
  .catch(() => ({
    schemaVersion: 1,
    provider: "ElevenLabs",
    credentialMethod:
      "ELEVENLABS_API_KEY loaded by Node --env-file; never stored in assets",
    documentation: [
      "https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert",
      "https://elevenlabs.io/docs/api-reference/text-to-speech/convert",
    ],
    assets: [],
  }));
for (const item of [...sounds, ...narration]) {
  if (only && item.cue !== only) continue;
  const file = `${item.cue.replaceAll(":", "-")}.mp3`;
  const destination = new URL(file, directory);
  if (
    await readFile(destination)
      .then(() => true)
      .catch(() => false)
  ) {
    const entry = manifest.assets.find((asset) => asset.cue === item.cue);
    if (normalizeExisting && entry && !entry.processing) {
      const normalized = await normalize(await readFile(destination));
      await writeFile(destination, normalized.audio);
      Object.assign(entry, {
        processing: normalized.processing,
        bytes: normalized.audio.length,
        sha256: digest(normalized.audio),
      });
      await writeFile(manifestUrl, `${JSON.stringify(manifest, null, 2)}\n`);
      console.log(`normalize ${file}: ${normalized.processing.gainDb} dB`);
      continue;
    }
    console.log(`reuse ${file}`);
    continue;
  }
  if (normalizeExisting) continue;
  const voice = item.kind === "voice" ? voices[item.character] : undefined;
  const model = voice ? "eleven_multilingual_v2" : "eleven_text_to_sound_v2";
  const endpoint = voice
    ? `/v1/text-to-speech/${voice.id}?output_format=mp3_44100_128`
    : "/v1/sound-generation";
  const body = voice
    ? {
        text: item.text,
        model_id: model,
        voice_settings: {
          stability: 0.65,
          similarity_boost: 0.75,
          style: 0.15,
          use_speaker_boost: true,
          speed: 1.0,
        },
      }
    : {
        text: item.text,
        model_id: model,
        duration_seconds: item.duration,
        prompt_influence: 0.55,
      };
  console.log(`generate ${file}`);
  const response = await fetch(`https://api.elevenlabs.io${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok)
    throw new Error(
      `ElevenLabs HTTP ${response.status} for ${item.cue}; no asset written`,
    );
  const sourceAudio = Buffer.from(await response.arrayBuffer());
  if (sourceAudio.length < 1000)
    throw new Error(`Invalid audio response for ${item.cue}`);
  const { audio, processing } = await normalize(sourceAudio);
  await writeFile(destination, audio);
  manifest.assets.push({
    ...item,
    file,
    model,
    ...(voice ? { voice: { ...voice, category: "premade" } } : {}),
    generatedAt: new Date().toISOString(),
    bytes: audio.length,
    processing,
    sha256: createHash("sha256").update(audio).digest("hex"),
    requestId: response.headers.get("request-id"),
  });
  await writeFile(manifestUrl, `${JSON.stringify(manifest, null, 2)}\n`);
}
console.log(`Audio assets: ${fileURLToPath(directory)}`);
