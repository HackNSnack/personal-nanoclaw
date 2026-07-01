/**
 * scripts/test-vision-providers.ts
 *
 * Tests every OpenRouter provider endpoint for the current vision model to find
 * the cheapest one that actually applies its vision tower (accepting an image ≠
 * processing it — DeepInfra fp8 is a known example of the latter).
 *
 * Usage:
 *   pnpm exec tsx scripts/test-vision-providers.ts
 *
 * Prerequisites:
 *   - OneCLI gateway running:  cd ~/.onecli && docker compose up -d
 *   - At least one nanoclaw agent container running (to mint an aoc_ token).
 *     Send any Slack message to the bot first if none is running.
 *   - /tmp/onecli-combined-ca.pem present (generated on gateway start).
 *
 * Probe design:
 *   Sends a 64×64 solid-red PNG and asks "what colour is this image?".
 *   PASS: response contains "red".
 *   FAIL: "NO_IMAGE" / refusal / wrong colour.
 *   ERROR: network/HTTP error or provider unavailable with allow_fallbacks:false.
 *
 * After running, update OPENCODE_OPENROUTER_ROUTING in ~/.config/nanoclaw/secrets.env
 * and restart: systemctl --user restart nanoclaw-v2-a72e394a.service
 */

import { execSync, execFileSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Config ────────────────────────────────────────────────────────────────────

const MODEL = 'mistralai/mistral-small-3.2-24b-instruct';
const PROXY_HOST = '127.0.0.1';
const PROXY_PORT = 10255;
const CA_PATH = '/tmp/onecli-combined-ca.pem';
const OPENROUTER_API = 'https://openrouter.ai/api/v1';
const MAX_TOKENS = 50;
const CURL_TIMEOUT_S = 60;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_PATH = join(__dirname, '../container/agent-runner/test-fixtures/vision-probe.png');

// Provider list for mistralai/mistral-small-3.2-24b-instruct (fetched 2026-06-30).
// Sorted cheapest prompt price first — the goal is to find the cheapest that works.
// Update by running: pnpm exec tsx scripts/test-vision-providers.ts --refresh-providers
// (not yet implemented; re-check via OpenRouter MCP openrouter_model-endpoints)
const PROVIDERS: ReadonlyArray<{
  name: string;
  tag: string;
  quant: string;
  promptPerM: number;
  completionPerM: number;
}> = [
  { name: 'DeepInfra', tag: 'deepinfra/fp8', quant: 'fp8',     promptPerM: 0.075, completionPerM: 0.200 },
  { name: 'Parasail',  tag: 'parasail/bf16', quant: 'bf16',    promptPerM: 0.090, completionPerM: 0.300 },
  { name: 'Venice',    tag: 'venice/fp8',    quant: 'fp8',      promptPerM: 0.094, completionPerM: 0.250 },
  { name: 'Mistral',   tag: 'mistral',       quant: 'full',     promptPerM: 0.100, completionPerM: 0.300 },
];

// ─── Minimal PNG generator ─────────────────────────────────────────────────────
// Solid-colour 64×64 PNG using only node:zlib — no image library needed.

function buildCrc32Table(): Uint32Array {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    t[i] = c;
  }
  return t;
}
const CRC32_TABLE = buildCrc32Table();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([len, typeBytes, data, crcBuf]);
}

/** Creates a solid-red SIZE×SIZE PNG. Kept small (~200 B) for cheap API calls. */
function makeSolidRedPng(size = 64): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);  // width
  ihdrData.writeUInt32BE(size, 4);  // height
  ihdrData[8] = 8;                  // bit depth
  ihdrData[9] = 2;                  // colour type: truecolour (RGB)
  // compression, filter, interlace default to 0

  // Raw image rows: filter-byte(0) + R G B per pixel
  const rowLen = 1 + size * 3;
  const raw = Buffer.alloc(size * rowLen);
  for (let y = 0; y < size; y++) {
    const base = y * rowLen;
    raw[base] = 0; // filter type None
    for (let x = 0; x < size; x++) {
      raw[base + 1 + x * 3]     = 255; // R
      raw[base + 1 + x * 3 + 1] =   0; // G
      raw[base + 1 + x * 3 + 2] =   0; // B
    }
  }

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdrData),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Token extraction ──────────────────────────────────────────────────────────
// Agent tokens are stable (not per-container) — read directly from OneCLI
// rather than scraping a running docker process.

function getToken(): string {
  try {
    const raw = execSync('onecli agents list 2>/dev/null', { encoding: 'utf8' }).trim();
    const result = JSON.parse(raw) as { data: Array<{ accessToken: string; identifier: string }> };
    // Prefer the nanoclaw agent (identifier starts with 'ag-'), fall back to default
    const agent = result.data.find((a) => a.identifier.startsWith('ag-')) ?? result.data[0];
    const token = agent?.accessToken;
    if (token) return token;
  } catch (err) {
    void err;
  }
  throw new Error(
    'Could not get OneCLI agent token.\n' +
    'Is the OneCLI gateway running?  cd ~/.onecli && docker compose up -d',
  );
}

// ─── HTTP via OneCLI HTTPS proxy ───────────────────────────────────────────────
// The gateway is a credential-injecting HTTPS forward-proxy (CONNECT tunnel) at
// 127.0.0.1:10255. It presents a self-signed MITM CA, so we pass --cacert.
// We use curl (available everywhere, handles CONNECT tunnels natively) rather
// than adding a proxy-agent npm dep to the host project.

interface OpenRouterResponse {
  id?: string;
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string; code?: number };
}

function proxyPost(proxyUrl: string, url: string, body: unknown): OpenRouterResponse {
  let raw: string;
  try {
    raw = execFileSync(
      'curl',
      [
        '-s',                            // silent — no progress bar
        '--proxy',   proxyUrl,
        '--cacert',  CA_PATH,
        '-X',        'POST',
        '-H',        'Content-Type: application/json',
        '--data',    '@-',               // body from stdin → avoids ARG_MAX concerns
        '--max-time', String(CURL_TIMEOUT_S),
        url,
      ],
      {
        input:    JSON.stringify(body),
        encoding: 'utf8',
        timeout:  (CURL_TIMEOUT_S + 5) * 1000,
      },
    );
  } catch (err) {
    throw Object.assign(
      new Error(`curl failed: ${err instanceof Error ? err.message : String(err)}`),
      { cause: err },
    );
  }

  let parsed: OpenRouterResponse;
  try {
    parsed = JSON.parse(raw) as OpenRouterResponse;
  } catch (parseErr) {
    throw Object.assign(
      new Error(`non-JSON response: ${parseErr instanceof Error ? parseErr.message : String(parseErr)} — body: ${raw.slice(0, 80)}`),
      { cause: parseErr },
    );
  }

  if (parsed.error) {
    throw new Error(`OpenRouter error ${parsed.error.code ?? ''}: ${parsed.error.message ?? JSON.stringify(parsed.error)}`);
  }
  return parsed;
}

// ─── Vision test ───────────────────────────────────────────────────────────────

const PROBE_PROMPT =
  'What is the dominant colour in this image? ' +
  'Reply with ONLY a single colour name (e.g. "red"). ' +
  'If you cannot see any image at all, reply with exactly: NO_IMAGE';

type VisionResult = 'PASS ✅' | 'FAIL ❌' | 'ERROR ⚠️';

interface ProviderResult {
  name: string;
  tag: string;
  quant: string;
  promptPerM: number;
  completionPerM: number;
  vision: VisionResult;
  reply: string;
  genId?: string;
}

function testProvider(
  proxyUrl: string,
  imageDataUrl: string,
  provider: (typeof PROVIDERS)[number],
): ProviderResult {
  const body = {
    model: MODEL,
    provider: {
      only: [provider.name],
      allow_fallbacks: false, // hard-pin; a 404 = this provider can't serve → ERROR
      data_collection: 'deny',
    },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text',      text: PROBE_PROMPT },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ],
    max_tokens: MAX_TOKENS,
  };

  let vision: VisionResult;
  let reply = '';
  let genId: string | undefined;

  try {
    const resp = proxyPost(proxyUrl, `${OPENROUTER_API}/chat/completions`, body);
    genId = resp.id;
    reply = (resp.choices?.[0]?.message?.content ?? '').trim().slice(0, 100);
    const lc = reply.toLowerCase();
    // PASS: response mentions red without also saying it can't see the image
    vision = lc.includes('red') && !lc.includes('no_image') ? 'PASS ✅' : 'FAIL ❌';
  } catch (err) {
    vision = 'ERROR ⚠️';
    reply = err instanceof Error ? err.message.slice(0, 100) : String(err).slice(0, 100);
  }

  return { ...provider, vision, reply, genId };
}

// ─── Output formatting ─────────────────────────────────────────────────────────

function printTable(results: ProviderResult[]): void {
  const W = 92;
  const hr = '─'.repeat(W);
  console.log('\n' + hr);
  console.log(
    'Provider'.padEnd(12) +
    'Quant'.padEnd(6) +
    '$prompt/M'.padStart(11) +
    '$compl/M'.padStart(10) +
    '  Vision' +
    '  Reply',
  );
  console.log(hr);
  for (const r of results) {
    const priceP = `$${r.promptPerM.toFixed(3)}`;
    const priceC = `$${r.completionPerM.toFixed(3)}`;
    const genPart = r.genId ? `  [${r.genId}]` : '';
    const replyTrunc = r.reply.slice(0, 40);
    console.log(
      r.name.padEnd(12) +
      r.quant.padEnd(6) +
      priceP.padStart(11) +
      priceC.padStart(10) +
      `  ${r.vision}` +
      `  "${replyTrunc}"` +
      genPart,
    );
  }
  console.log(hr);
}

function printRecommendation(results: ProviderResult[]): void {
  const passing = results
    .filter((r) => r.vision === 'PASS ✅')
    .sort((a, b) => a.promptPerM - b.promptPerM);

  if (passing.length === 0) {
    console.log('\n⚠️  No providers passed the vision test.');
    console.log('   Mistral (pinned) remains the only confirmed working option.');
    console.log('   Check the ERROR rows above for provider-specific errors.');
    return;
  }

  const best = passing[0];
  console.log(`\n✅ Cheapest vision-working provider: ${best.name} (${best.tag})`);
  console.log(`   $${best.promptPerM}/1M prompt  $${best.completionPerM}/1M completion`);
  console.log('\n   To apply — edit ~/.config/nanoclaw/secrets.env:');
  console.log(`   OPENCODE_OPENROUTER_ROUTING={"only":["${best.name}"],"data_collection":"deny"}`);
  console.log('\n   Then restart the host service:');
  console.log('   systemctl --user restart nanoclaw-v2-a72e394a.service\n');
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 1. Generate probe image (cache to fixture path for reproducibility)
  const png = makeSolidRedPng(64);
  if (!existsSync(FIXTURE_PATH)) {
    mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
    writeFileSync(FIXTURE_PATH, png);
    console.log(`📸 Created probe fixture: ${FIXTURE_PATH}`);
  }
  const imageDataUrl = `data:image/png;base64,${png.toString('base64')}`;
  console.log(`   Probe: 64×64 solid-red PNG (${png.length} B → ${imageDataUrl.length} B data URL)`);

  // 2. Verify CA cert
  if (!existsSync(CA_PATH)) {
    throw new Error(
      `MITM CA not found at ${CA_PATH}.\n` +
      'Is the OneCLI gateway running?  cd ~/.onecli && docker compose up -d',
    );
  }

  // 3. Get proxy token
  const token = getToken();
  const proxyUrl = `http://x:${token}@${PROXY_HOST}:${PROXY_PORT}`;
  console.log(`🔑 Token: ${token.slice(0, 8)}… via ${PROXY_HOST}:${PROXY_PORT}\n`);

  // 4. Test each provider in sequence (parallel would interleave output)
  const results: ProviderResult[] = [];
  for (const p of PROVIDERS) {
    process.stdout.write(`  Testing ${p.name.padEnd(10)} (${p.tag.padEnd(14)}) ... `);
    const result = testProvider(proxyUrl, imageDataUrl, p);
    console.log(`${result.vision}  "${result.reply.slice(0, 60)}"`);
    results.push(result);
  }

  // 5. Summary
  printTable(results);
  printRecommendation(results);
}

main().catch((err) => {
  console.error('\n❌', err instanceof Error ? err.message : err);
  process.exit(1);
});
