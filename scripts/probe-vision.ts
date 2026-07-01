/**
 * scripts/probe-vision.ts
 *
 * Tests a single model + provider combination for working vision.
 * Variant of test-vision-providers.ts for ad-hoc evaluation of new models.
 *
 * Usage:
 *   pnpm exec tsx scripts/probe-vision.ts --model <openrouter-model-id> --provider <name>
 *
 * Examples:
 *   pnpm exec tsx scripts/probe-vision.ts \
 *     --model mistralai/mistral-small-3.2-24b-instruct \
 *     --provider Parasail
 *
 *   pnpm exec tsx scripts/probe-vision.ts \
 *     --model meta-llama/llama-4-maverick \
 *     --provider Fireworks
 *
 * Provider name = the provider_name field from OpenRouter's model-endpoints API.
 * Use the OpenRouter MCP tool `openrouter_model-endpoints` to list providers
 * for a given model before running this script.
 *
 * Prerequisites: same as test-vision-providers.ts (nanoclaw running, OneCLI
 * gateway up, /tmp/onecli-combined-ca.pem present).
 */

import { execSync, execFileSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Args ─────────────────────────────────────────────────────────────────────

function parseArgs(): { model: string; provider: string } {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };
  const model = get('--model');
  const provider = get('--provider');
  if (!model || !provider) {
    console.error('Usage: pnpm exec tsx scripts/probe-vision.ts --model <id> --provider <name>');
    console.error('  --model     OpenRouter model ID, e.g. mistralai/mistral-small-3.2-24b-instruct');
    console.error('  --provider  Provider name from openrouter_model-endpoints, e.g. DeepInfra');
    process.exit(1);
  }
  return { model, provider };
}

// ─── Config ────────────────────────────────────────────────────────────────────

const PROXY_HOST = '127.0.0.1';
const PROXY_PORT = 10255;
const CA_PATH = '/tmp/onecli-combined-ca.pem';
const OPENROUTER_API = 'https://openrouter.ai/api/v1';
const MAX_TOKENS = 50;
const CURL_TIMEOUT_S = 60;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_PATH = join(__dirname, '../container/agent-runner/test-fixtures/vision-probe.png');

// ─── PNG generation (reused from test-vision-providers.ts) ────────────────────

function buildCrc32Table(): Uint32Array {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
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

function makeSolidRedPng(size = 64): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  const rowLen = 1 + size * 3;
  const raw = Buffer.alloc(size * rowLen);
  for (let y = 0; y < size; y++) {
    const base = y * rowLen;
    raw[base] = 0;
    for (let x = 0; x < size; x++) {
      raw[base + 1 + x * 3] = 255;
      raw[base + 1 + x * 3 + 1] = 0;
      raw[base + 1 + x * 3 + 2] = 0;
    }
  }
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdrData),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Proxy helpers ─────────────────────────────────────────────────────────────

function getToken(): string {
  try {
    const raw = execSync('onecli agents list 2>/dev/null', { encoding: 'utf8' }).trim();
    const result = JSON.parse(raw) as { data: Array<{ accessToken: string; identifier: string }> };
    const agent = result.data.find((a) => a.identifier.startsWith('ag-')) ?? result.data[0];
    const token = agent?.accessToken;
    if (token) return token;
  } catch (err) {
    void err;
  }
  throw new Error('Could not get OneCLI agent token. Is the gateway running?  cd ~/.onecli && docker compose up -d');
}

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
        '-s',
        '--proxy',
        proxyUrl,
        '--cacert',
        CA_PATH,
        '-X',
        'POST',
        '-H',
        'Content-Type: application/json',
        '--data',
        '@-',
        '--max-time',
        String(CURL_TIMEOUT_S),
        url,
      ],
      { input: JSON.stringify(body), encoding: 'utf8', timeout: (CURL_TIMEOUT_S + 5) * 1000 },
    );
  } catch (err) {
    throw Object.assign(new Error(`curl failed: ${err instanceof Error ? err.message : String(err)}`), { cause: err });
  }
  let parsed: OpenRouterResponse;
  try {
    parsed = JSON.parse(raw) as OpenRouterResponse;
  } catch (parseErr) {
    throw Object.assign(new Error(`non-JSON response: ${raw.slice(0, 120)}`), { cause: parseErr });
  }
  if (parsed.error) {
    throw new Error(
      `OpenRouter error ${parsed.error.code ?? ''}: ${parsed.error.message ?? JSON.stringify(parsed.error)}`,
    );
  }
  return parsed;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { model, provider } = parseArgs();

  // Probe image — reuse committed fixture if present, else generate
  const png = existsSync(FIXTURE_PATH) ? readFileSync(FIXTURE_PATH) : makeSolidRedPng(64);
  const imageDataUrl = `data:image/png;base64,${png.toString('base64')}`;

  if (!existsSync(CA_PATH)) {
    throw new Error(`MITM CA not found at ${CA_PATH}. Is the OneCLI gateway running?`);
  }

  const token = getToken();
  const proxyUrl = `http://x:${token}@${PROXY_HOST}:${PROXY_PORT}`;

  console.log(`Model:    ${model}`);
  console.log(`Provider: ${provider}`);
  console.log(`Probe:    64×64 solid-red PNG via ${PROXY_HOST}:${PROXY_PORT}\n`);

  const body = {
    model,
    provider: { only: [provider], allow_fallbacks: false, data_collection: 'deny' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'What is the dominant colour in this image? Reply with ONLY a single colour name. If you cannot see any image, reply with exactly: NO_IMAGE',
          },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ],
    max_tokens: MAX_TOKENS,
  };

  let vision: 'PASS ✅' | 'FAIL ❌' | 'ERROR ⚠️';
  let reply = '';
  let genId: string | undefined;

  try {
    const resp = proxyPost(proxyUrl, `${OPENROUTER_API}/chat/completions`, body);
    genId = resp.id;
    reply = (resp.choices?.[0]?.message?.content ?? '').trim();
    const lc = reply.toLowerCase();
    vision = lc.includes('red') && !lc.includes('no_image') ? 'PASS ✅' : 'FAIL ❌';
  } catch (err) {
    vision = 'ERROR ⚠️';
    reply = err instanceof Error ? err.message : String(err);
  }

  console.log(`Result:   ${vision}`);
  console.log(`Reply:    "${reply}"`);
  if (genId) console.log(`Gen-ID:   ${genId}`);

  if (vision === 'PASS ✅') {
    console.log('\nTo use this provider, set in ~/.config/nanoclaw/secrets.env:');
    console.log(`OPENCODE_OPENROUTER_ROUTING={"only":["${provider}"],"data_collection":"deny"}`);
    console.log('Then: systemctl --user restart nanoclaw-v2-a72e394a.service');
  }

  process.exit(vision === 'PASS ✅' ? 0 : 1);
}

main().catch((err) => {
  console.error('❌', err instanceof Error ? err.message : err);
  process.exit(1);
});
