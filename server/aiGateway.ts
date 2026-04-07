import crypto from 'node:crypto';
import type {
  AiImageResponse,
  AiParallelTextJobResult,
  AiServiceStatus,
  AiTextResponse,
  AiTtsFormat,
  AiTtsMetadata,
} from '../src/types';

const QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const QWEN_DEFAULT_TEXT_MODEL = 'qwen-plus';
const OPENROUTER_DEFAULT_IMAGE_MODEL = 'google/gemini-2.5-flash-image-preview';
const EDGE_TTS_DEFAULT_BASE_URL = 'http://localhost:5050';
const EDGE_TTS_DEFAULT_MODEL = 'tts-1';
const EDGE_TTS_DEFAULT_VOICE = 'uk-UA-PolinaNeural';
const EDGE_TTS_DEFAULT_FORMAT: AiTtsFormat = 'mp3';

let nextOpenRouterKeyIndex = 0;

type TextRequest = {
  prompt: string;
  systemPrompt: string;
  model?: string;
  temperature?: number;
};

type ParallelTextRequest = {
  prompts: string[];
  systemPrompt: string;
  model?: string;
  temperature?: number;
};

type ImageRequest = {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
};

type TtsRequest = {
  input: string;
  voice?: string;
  model?: string;
  responseFormat?: AiTtsFormat;
  speed?: number;
};

type SpeechResult = {
  audioBuffer: Buffer;
  contentType: string;
  fileName: string;
  metadata: AiTtsMetadata;
};

function parseKeyList(raw: string | undefined) {
  return (raw ?? '')
    .split(/[\n,;]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function getOpenRouterKeys() {
  return parseKeyList(process.env.OPENROUTER_API_KEYS ?? process.env.OPENROUTER_API_KEY);
}

function getQwenApiKey() {
  return process.env.DASHSCOPE_API_KEY?.trim() || process.env.QWEN_API_KEY?.trim() || '';
}

function getDefaultTextModel() {
  return process.env.QWEN_TEXT_MODEL?.trim()
    || process.env.DASHSCOPE_TEXT_MODEL?.trim()
    || QWEN_DEFAULT_TEXT_MODEL;
}

function getDefaultImageModel() {
  return process.env.OPENROUTER_IMAGE_MODEL?.trim() || OPENROUTER_DEFAULT_IMAGE_MODEL;
}

function getEdgeTtsBaseUrl() {
  return process.env.EDGE_TTS_BASE_URL?.trim() || EDGE_TTS_DEFAULT_BASE_URL;
}

function getEdgeTtsDefaultVoice() {
  return process.env.EDGE_TTS_DEFAULT_VOICE?.trim() || EDGE_TTS_DEFAULT_VOICE;
}

function getEdgeTtsDefaultFormat(): AiTtsFormat {
  const value = process.env.EDGE_TTS_DEFAULT_FORMAT?.trim().toLowerCase();
  if (value === 'mp3' || value === 'wav' || value === 'opus' || value === 'aac' || value === 'flac' || value === 'pcm') {
    return value;
  }

  return EDGE_TTS_DEFAULT_FORMAT;
}

function resolveTextProvider() {
  if (getQwenApiKey()) {
    return 'qwen' as const;
  }

  throw new Error('No Qwen API key is configured. Set DASHSCOPE_API_KEY or QWEN_API_KEY.');
}

function takeOpenRouterKey() {
  const keys = getOpenRouterKeys();
  if (keys.length === 0) {
    throw new Error('OPENROUTER_API_KEYS is not configured on the server.');
  }

  const keySlot = nextOpenRouterKeyIndex % keys.length;
  nextOpenRouterKeyIndex = (nextOpenRouterKeyIndex + 1) % keys.length;

  return {
    apiKey: keys[keySlot],
    keySlot,
  };
}

function buildOpenRouterHeaders(apiKey: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) {
    headers['HTTP-Referer'] = appUrl;
  }

  headers['X-Title'] = process.env.OPENROUTER_APP_NAME?.trim() || 'Codex RPG Host Studio';
  return headers;
}

function buildQwenHeaders(apiKey: string) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }

      if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
        return part.text;
      }

      return '';
    })
    .join('')
    .trim();
}

function extractImageUrls(images: unknown) {
  if (!Array.isArray(images)) {
    return [];
  }

  return images
    .map((image) => {
      if (typeof image === 'string' && image.startsWith('data:image/')) {
        return image;
      }

      if (!image || typeof image !== 'object') {
        return null;
      }

      if ('image_url' in image && image.image_url && typeof image.image_url === 'object' && 'url' in image.image_url && typeof image.image_url.url === 'string') {
        return image.image_url.url;
      }

      if ('imageUrl' in image && image.imageUrl && typeof image.imageUrl === 'object' && 'url' in image.imageUrl && typeof image.imageUrl.url === 'string') {
        return image.imageUrl.url;
      }

      return null;
    })
    .filter((value): value is string => Boolean(value));
}

function buildChatMessages({ prompt, systemPrompt }: { prompt: string; systemPrompt?: string }) {
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];

  if (systemPrompt?.trim()) {
    messages.push({
      role: 'system',
      content: systemPrompt.trim(),
    });
  }

  messages.push({
    role: 'user',
    content: prompt.trim(),
  });

  return messages;
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object' && 'error' in payload && payload.error && typeof payload.error === 'object' && 'message' in payload.error && typeof payload.error.message === 'string') {
    return payload.error.message;
  }

  return fallback;
}

async function parseFailurePayload(response: Response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {
      error: {
        message: text,
      },
    };
  }
}

async function generateQwenText({
  prompt,
  systemPrompt,
  model,
  temperature = 0.4,
}: TextRequest): Promise<AiTextResponse> {
  const startedAt = Date.now();
  const apiKey = getQwenApiKey();
  if (!apiKey) {
    throw new Error('DASHSCOPE_API_KEY is not configured on the server.');
  }

  const selectedModel = model?.trim() || getDefaultTextModel();

  const response = await fetch(QWEN_API_URL, {
    method: 'POST',
    headers: buildQwenHeaders(apiKey),
    body: JSON.stringify({
      model: selectedModel,
      messages: buildChatMessages({ prompt, systemPrompt }),
      temperature,
    }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(getErrorMessage(payload, 'Qwen request failed.'));
  }

  const text = extractTextContent(payload?.choices?.[0]?.message?.content);
  if (!text) {
    throw new Error('Qwen returned an empty text response.');
  }

  return {
    text,
    model: typeof payload?.model === 'string' ? payload.model : selectedModel,
    provider: 'qwen',
    durationMs: Date.now() - startedAt,
    keySlot: null,
  };
}

export async function generateTextWithMetadata(input: TextRequest): Promise<AiTextResponse> {
  resolveTextProvider();
  return generateQwenText(input);
}

export async function generateServerText(input: TextRequest) {
  const result = await generateTextWithMetadata(input);
  return result.text;
}

export async function generateParallelText({
  prompts,
  systemPrompt,
  model,
  temperature,
}: ParallelTextRequest): Promise<AiParallelTextJobResult[]> {
  const cleanedPrompts = prompts.map((prompt) => prompt.trim()).filter(Boolean);

  const results = await Promise.allSettled(
    cleanedPrompts.map(async (prompt) => ({
      prompt,
      result: await generateTextWithMetadata({
        prompt,
        systemPrompt,
        model,
        temperature,
      }),
    })),
  );

  return results.map((entry, index) => {
    const prompt = cleanedPrompts[index];
    if (entry.status === 'fulfilled') {
      return {
        id: crypto.randomUUID(),
        prompt,
        status: 'success',
        text: entry.value.result.text,
        error: null,
        model: entry.value.result.model,
        provider: entry.value.result.provider,
        durationMs: entry.value.result.durationMs,
        keySlot: entry.value.result.keySlot,
      };
    }

    return {
      id: crypto.randomUUID(),
      prompt,
      status: 'error',
      text: null,
      error: entry.reason instanceof Error ? entry.reason.message : 'Parallel prompt failed.',
      model: model?.trim() || getDefaultTextModel(),
      provider: null,
      durationMs: 0,
      keySlot: null,
    };
  });
}

export async function generateImage({
  prompt,
  systemPrompt,
  model,
  aspectRatio,
  imageSize,
}: ImageRequest): Promise<AiImageResponse> {
  const startedAt = Date.now();
  const { apiKey, keySlot } = takeOpenRouterKey();
  const selectedModel = model?.trim() || getDefaultImageModel();
  const imageConfig: Record<string, string> = {};

  if (aspectRatio?.trim()) {
    imageConfig.aspect_ratio = aspectRatio.trim();
  }

  if (imageSize?.trim()) {
    imageConfig.image_size = imageSize.trim();
  }

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: buildOpenRouterHeaders(apiKey),
    body: JSON.stringify({
      model: selectedModel,
      messages: buildChatMessages({ prompt, systemPrompt }),
      modalities: ['image', 'text'],
      stream: false,
      ...(Object.keys(imageConfig).length > 0 ? { image_config: imageConfig } : {}),
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, 'OpenRouter image request failed.'));
  }

  const message = payload?.choices?.[0]?.message;
  const images = extractImageUrls(message?.images);
  if (images.length === 0) {
    throw new Error('OpenRouter did not return any generated images.');
  }

  return {
    images,
    text: extractTextContent(message?.content),
    model: typeof payload?.model === 'string' ? payload.model : selectedModel,
    provider: 'openrouter',
    durationMs: Date.now() - startedAt,
    keySlot,
  };
}

function getMimeTypeForFormat(format: AiTtsFormat) {
  switch (format) {
    case 'wav':
      return 'audio/wav';
    case 'opus':
      return 'audio/ogg; codecs=opus';
    case 'aac':
      return 'audio/aac';
    case 'flac':
      return 'audio/flac';
    case 'pcm':
      return 'audio/L16';
    case 'mp3':
    default:
      return 'audio/mpeg';
  }
}

function buildTtsUrl(baseUrl: string) {
  return new URL('v1/audio/speech', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

async function probeTtsEndpoint(baseUrl: string) {
  try {
    const response = await fetch(buildTtsUrl(baseUrl), {
      method: 'OPTIONS',
      signal: AbortSignal.timeout(1500),
    });

    return {
      reachable: true,
      message: `TTS endpoint responded with ${response.status}.`,
    };
  } catch (error) {
    return {
      reachable: false,
      message: error instanceof Error ? error.message : 'Unable to reach TTS endpoint.',
    };
  }
}

export async function synthesizeSpeech({
  input,
  voice,
  model,
  responseFormat,
  speed,
}: TtsRequest): Promise<SpeechResult> {
  const startedAt = Date.now();
  const baseUrl = getEdgeTtsBaseUrl();
  const selectedVoice = voice?.trim() || getEdgeTtsDefaultVoice();
  const selectedModel = model?.trim() || EDGE_TTS_DEFAULT_MODEL;
  const selectedFormat = responseFormat ?? getEdgeTtsDefaultFormat();
  const apiKey = process.env.EDGE_TTS_API_KEY?.trim();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    Accept: getMimeTypeForFormat(selectedFormat),
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(buildTtsUrl(baseUrl), {
    method: 'POST',
    headers,
    body: Buffer.from(JSON.stringify({
      model: selectedModel,
      input: input.trim(),
      voice: selectedVoice,
      response_format: selectedFormat,
      ...(typeof speed === 'number' ? { speed } : {}),
    }), 'utf8'),
  });

  if (!response.ok) {
    const payload = await parseFailurePayload(response);
    throw new Error(getErrorMessage(payload, 'Edge TTS request failed.'));
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  if (audioBuffer.length === 0) {
    throw new Error('Edge TTS returned an empty audio response.');
  }

  return {
    audioBuffer,
    contentType: response.headers.get('content-type') || getMimeTypeForFormat(selectedFormat),
    fileName: `speech.${selectedFormat}`,
    metadata: {
      provider: 'edge-tts',
      model: selectedModel,
      voice: selectedVoice,
      durationMs: Date.now() - startedAt,
      format: selectedFormat,
    },
  };
}

export async function getAiServiceStatus(): Promise<AiServiceStatus> {
  const openRouterKeys = getOpenRouterKeys();
  const configuredTtsBaseUrl = process.env.EDGE_TTS_BASE_URL?.trim() || null;
  const textProvider = getQwenApiKey() ? 'qwen' : 'unconfigured';
  const ttsProbe = configuredTtsBaseUrl
    ? await probeTtsEndpoint(configuredTtsBaseUrl)
    : { reachable: false, message: null };

  return {
    textProvider,
    textModel: textProvider === 'unconfigured' ? null : getDefaultTextModel(),
    imageProvider: openRouterKeys.length > 0 ? 'openrouter' : null,
    imageModel: openRouterKeys.length > 0 ? getDefaultImageModel() : null,
    ttsProvider: configuredTtsBaseUrl ? 'edge-tts' : null,
    ttsBaseUrl: configuredTtsBaseUrl,
    ttsDefaultVoice: configuredTtsBaseUrl ? getEdgeTtsDefaultVoice() : null,
    ttsReachable: ttsProbe.reachable,
    ttsStatusMessage: ttsProbe.message,
    parallelKeyCount: textProvider === 'unconfigured' ? 0 : 1,
  };
}
