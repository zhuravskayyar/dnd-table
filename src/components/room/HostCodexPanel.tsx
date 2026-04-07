import { type FormEvent, useEffect, useState } from 'react';
import {
  fetchAiStatus,
  generateAiImage,
  generateAiSpeech,
  generateAiText,
  generateAiTextParallel,
} from '../../api/rooms';
import { STRICT_HOST_RULES } from '../../constants/hostRules';
import type {
  AiImageResponse,
  AiParallelTextJobResult,
  AiServiceStatus,
  AiTextResponse,
  Room,
} from '../../types';
import { Banner } from '../ui/Banner';
import { FormField } from '../ui/FormField';
import { SectionCard } from '../ui/SectionCard';
import { SectionPanel } from '../ui/SectionPanel';

type HostCodexPanelProps = {
  room: Room;
};

type TtsPlayback = {
  url: string;
  model: string;
  voice: string;
  durationMs: number;
  format: string;
};

function getDefaultSystemPrompt(language: string) {
  return language === 'English'
    ? 'You are a concise creative assistant for tabletop RPG prep. Be concrete and directly usable.'
    : 'Ти лаконічний творчий асистент для підготовки настільної RPG. Відповідай конкретно й придатно до використання.';
}

function getDefaultTextPrompt(language: string) {
  return language === 'English'
    ? 'Summarize the current room stakes in 3 sharp bullet points.'
    : 'Стисло підсумуй поточні ставки цієї кімнати у 3 чітких пунктах.';
}

function getDefaultParallelPrompts(language: string) {
  return language === 'English'
    ? [
      'Give me three ominous rumors tied to this session.',
      'Describe one hidden threat that could surface in the next scene.',
      'Write one NPC line that immediately creates pressure.',
    ].join('\n\n')
    : [
      'Дай три тривожні чутки, повʼязані з цією сесією.',
      'Опиши одну приховану загрозу, яка може сплисти в наступній сцені.',
      'Напиши одну репліку NPC, яка миттєво створює тиск.',
    ].join('\n\n');
}

function getDefaultImagePrompt(language: string, title: string) {
  return language === 'English'
    ? `Dark fantasy key art for "${title}", torch-lit gate, wet stone, tense atmosphere, cinematic composition`
    : `Темне фентезійне key art для "${title}", брама в смолоскипах, мокрий камінь, напружена атмосфера, кінематографічна композиція`;
}

function getDefaultTtsText(language: string) {
  return language === 'English'
    ? 'The gate chain groans, the watchman reaches for steel, and the city decides whether it fears you or needs you.'
    : 'Ланцюг на брамі скрегоче, вартовий тягнеться до зброї, а місто просто зараз вирішує, чи боїться вас, чи потребує.';
}

function getFallbackVoice(language: string) {
  return language === 'English' ? 'en-US-AvaNeural' : 'uk-UA-PolinaNeural';
}

function splitPromptBatch(value: string) {
  return value
    .split(/\n\s*\n+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function formatProviderLabel(status: AiServiceStatus | null) {
  if (!status) {
    return 'Loading';
  }

  return status.textProvider === 'unconfigured' ? 'Not configured' : status.textProvider;
}

export function HostCodexPanel({ room }: HostCodexPanelProps) {
  const defaultSystemPrompt = getDefaultSystemPrompt(room.language);
  const [status, setStatus] = useState<AiServiceStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusRetryTick, setStatusRetryTick] = useState(0);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [textResult, setTextResult] = useState<AiTextResponse | null>(null);
  const [parallelResults, setParallelResults] = useState<AiParallelTextJobResult[]>([]);
  const [imageResult, setImageResult] = useState<AiImageResponse | null>(null);
  const [ttsPlayback, setTtsPlayback] = useState<TtsPlayback | null>(null);
  const [textForm, setTextForm] = useState({
    model: '',
    systemPrompt: defaultSystemPrompt,
    prompt: getDefaultTextPrompt(room.language),
  });
  const [parallelForm, setParallelForm] = useState({
    model: '',
    systemPrompt: defaultSystemPrompt,
    prompts: getDefaultParallelPrompts(room.language),
  });
  const [imageForm, setImageForm] = useState({
    model: '',
    systemPrompt: '',
    prompt: getDefaultImagePrompt(room.language, room.title),
    aspectRatio: '16:9',
    imageSize: '1K',
  });
  const [ttsForm, setTtsForm] = useState({
    model: 'tts-1',
    input: getDefaultTtsText(room.language),
    voice: getFallbackVoice(room.language),
    responseFormat: 'mp3',
    speed: '1',
  });

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;

    void fetchAiStatus()
      .then((payload) => {
        if (cancelled) {
          return;
        }

        setStatus(payload.status);
        setStatusError(null);
        setTextForm((current) => (
          current.model.trim() || !payload.status.textModel
            ? current
            : { ...current, model: payload.status.textModel }
        ));
        setParallelForm((current) => (
          current.model.trim() || !payload.status.textModel
            ? current
            : { ...current, model: payload.status.textModel }
        ));
        setImageForm((current) => (
          current.model.trim() || !payload.status.imageModel
            ? current
            : { ...current, model: payload.status.imageModel }
        ));
        setTtsForm((current) => (
          current.voice.trim() || !payload.status.ttsDefaultVoice
            ? current
            : { ...current, voice: payload.status.ttsDefaultVoice }
        ));
      })
      .catch((loadError) => {
        if (!cancelled) {
          setStatusError(loadError instanceof Error ? loadError.message : 'Failed to load AI status.');
          retryTimer = window.setTimeout(() => {
            setStatusRetryTick((current) => current + 1);
          }, 2000);
        }
      });

    return () => {
      cancelled = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [statusRetryTick]);

  useEffect(() => () => {
    if (ttsPlayback) {
      URL.revokeObjectURL(ttsPlayback.url);
    }
  }, [ttsPlayback]);

  const canGenerateText = status?.textProvider !== 'unconfigured';
  const canGenerateImage = Boolean(status?.imageProvider);
  const canGenerateSpeech = Boolean(status?.ttsProvider && status.ttsReachable);

  const handleTextSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyKey('text');
    setError(null);
    setNotice(null);

    try {
      const result = await generateAiText({
        prompt: textForm.prompt.trim(),
        systemPrompt: textForm.systemPrompt.trim(),
        model: textForm.model.trim() || undefined,
      });
      setTextResult(result);
      setNotice('Single prompt completed.');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to generate text.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleParallelSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyKey('parallel');
    setError(null);
    setNotice(null);

    try {
      const prompts = splitPromptBatch(parallelForm.prompts);
      if (prompts.length === 0) {
        throw new Error('Add at least one prompt block for parallel execution.');
      }

      const result = await generateAiTextParallel({
        prompts,
        systemPrompt: parallelForm.systemPrompt.trim(),
        model: parallelForm.model.trim() || undefined,
      });
      setParallelResults(result.results);
      setNotice(`Parallel batch finished: ${result.results.length} prompt(s).`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to run prompts in parallel.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleImageSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyKey('image');
    setError(null);
    setNotice(null);

    try {
      const result = await generateAiImage({
        prompt: imageForm.prompt.trim(),
        systemPrompt: imageForm.systemPrompt.trim() || undefined,
        model: imageForm.model.trim() || undefined,
        aspectRatio: imageForm.aspectRatio,
        imageSize: imageForm.imageSize,
      });
      setImageResult(result);
      setNotice(`Image generation returned ${result.images.length} image(s).`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to generate image.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleTtsSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyKey('tts');
    setError(null);
    setNotice(null);

    try {
      const speed = Number(ttsForm.speed);
      const result = await generateAiSpeech({
        input: ttsForm.input.trim(),
        voice: ttsForm.voice.trim() || undefined,
        model: ttsForm.model.trim() || undefined,
        responseFormat: ttsForm.responseFormat as 'mp3' | 'wav' | 'opus' | 'aac' | 'flac' | 'pcm',
        speed: Number.isFinite(speed) ? speed : 1,
      });
      const url = URL.createObjectURL(result.audioBlob);

      setTtsPlayback((current) => {
        if (current) {
          URL.revokeObjectURL(current.url);
        }

        return {
          url,
          model: result.metadata.model,
          voice: result.metadata.voice,
          durationMs: result.metadata.durationMs,
          format: result.metadata.format,
        };
      });
      setNotice('TTS audio is ready.');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to synthesize speech.');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <SectionPanel
      title={STRICT_HOST_RULES.uiTerminology.codexTitle}
      subtitle="Prompt lab, image generation, parallel prompt fan-out, and TTS sit behind the same server gateway so API keys stay off the client."
      actions={(
        <button
          type="button"
          className="rpg-button rpg-btn-dark rounded-sm px-4 py-2"
          onClick={() => {
            setStatusError(null);
            setStatusRetryTick((current) => current + 1);
          }}
          disabled={busyKey !== null}
        >
          Refresh AI Status
        </button>
      )}
    >
      <div className="space-y-4">
        {notice ? <Banner tone="info" message={notice} /> : null}
        {statusError ? <Banner tone="error" message={statusError} /> : null}
        {error ? <Banner tone="error" message={error} /> : null}

        <SectionCard>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-[#d4af37]">Text</p>
              <p className="rpg-text text-sm">{formatProviderLabel(status)}</p>
              <p className="text-xs text-[#bba791]">{status?.textModel || 'Model not loaded yet.'}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-[#d4af37]">Image</p>
              <p className="rpg-text text-sm">{status?.imageProvider || 'Disabled'}</p>
              <p className="text-xs text-[#bba791]">{status?.imageModel || 'Configure OpenRouter for image output.'}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-[#d4af37]">TTS</p>
              <p className="rpg-text text-sm">
                {status?.ttsProvider
                  ? (status.ttsReachable ? 'edge-tts online' : 'edge-tts offline')
                  : 'Disabled'}
              </p>
              <p className="text-xs text-[#bba791]">
                {status?.ttsProvider
                  ? `${status.ttsBaseUrl}${status.ttsStatusMessage ? ` • ${status.ttsStatusMessage}` : ''}`
                  : 'Set EDGE_TTS_BASE_URL to enable speech.'}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-[#d4af37]">Parallel Keys</p>
              <p className="rpg-text text-sm">{status?.parallelKeyCount ?? 0}</p>
              <p className="text-xs text-[#bba791]">Qwen runs through one active server-side key.</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard>
          <form className="space-y-4" onSubmit={handleTextSubmit}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[0.85fr_1.15fr]">
              <FormField label="Text Model">
                <input
                  className="rpg-input"
                  value={textForm.model}
                  onChange={(event) => setTextForm((current) => ({ ...current, model: event.target.value }))}
                  placeholder="qwen-plus"
                />
              </FormField>
              <FormField label="Prompt">
                <textarea
                  className="rpg-input min-h-28"
                  value={textForm.prompt}
                  onChange={(event) => setTextForm((current) => ({ ...current, prompt: event.target.value }))}
                />
              </FormField>
            </div>
            <FormField label="System Prompt">
              <textarea
                className="rpg-input min-h-24"
                value={textForm.systemPrompt}
                onChange={(event) => setTextForm((current) => ({ ...current, systemPrompt: event.target.value }))}
              />
            </FormField>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                className="rpg-button rpg-btn-blue rounded-sm px-4 py-3"
                disabled={busyKey !== null || !canGenerateText}
              >
                {busyKey === 'text' ? 'Running...' : 'Run Single Prompt'}
              </button>
              <p className="text-xs text-[#bba791]">
                Server-side execution keeps the model key off the browser.
              </p>
            </div>
          </form>
          {textResult ? (
            <div className="mt-4 rounded-sm border border-[#3a281c] bg-[#120d0a] p-4">
              <p className="mb-2 text-xs uppercase tracking-[0.2em] text-[#d4af37]">
                {textResult.provider} • {textResult.model} • {textResult.durationMs} ms
                {textResult.keySlot !== null ? ` • key ${textResult.keySlot + 1}` : ''}
              </p>
              <div className="whitespace-pre-wrap text-sm leading-6 text-[#e6d5c3]">{textResult.text}</div>
            </div>
          ) : null}
        </SectionCard>

        <SectionCard>
          <form className="space-y-4" onSubmit={handleParallelSubmit}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[0.85fr_1.15fr]">
              <FormField label="Parallel Model">
                <input
                  className="rpg-input"
                  value={parallelForm.model}
                  onChange={(event) => setParallelForm((current) => ({ ...current, model: event.target.value }))}
                  placeholder="qwen-plus"
                />
              </FormField>
              <FormField label="Prompt Blocks">
                <textarea
                  className="rpg-input min-h-36"
                  value={parallelForm.prompts}
                  onChange={(event) => setParallelForm((current) => ({ ...current, prompts: event.target.value }))}
                />
              </FormField>
            </div>
            <FormField label="Shared System Prompt">
              <textarea
                className="rpg-input min-h-24"
                value={parallelForm.systemPrompt}
                onChange={(event) => setParallelForm((current) => ({ ...current, systemPrompt: event.target.value }))}
              />
            </FormField>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                className="rpg-button rpg-btn-green rounded-sm px-4 py-3"
                disabled={busyKey !== null || !canGenerateText}
              >
                {busyKey === 'parallel' ? 'Running...' : 'Run In Parallel'}
              </button>
              <p className="text-xs text-[#bba791]">
                Separate prompt jobs with an empty line. Results keep source order.
              </p>
            </div>
          </form>
          {parallelResults.length > 0 ? (
            <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
              {parallelResults.map((result) => (
                <div
                  key={result.id}
                  className="rounded-sm border border-[#3a281c] bg-[#120d0a] p-4"
                >
                  <p className="mb-2 text-xs uppercase tracking-[0.2em] text-[#d4af37]">
                    {result.status === 'success'
                      ? `${result.provider} • ${result.model} • ${result.durationMs} ms${result.keySlot !== null ? ` • key ${result.keySlot + 1}` : ''}`
                      : `error • ${result.model}`}
                  </p>
                  <p className="mb-3 whitespace-pre-wrap text-xs leading-5 text-[#bba791]">{result.prompt}</p>
                  <div className="whitespace-pre-wrap text-sm leading-6 text-[#e6d5c3]">
                    {result.status === 'success' ? result.text : result.error}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </SectionCard>

        <SectionCard>
          <form className="space-y-4" onSubmit={handleImageSubmit}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField label="Image Model">
                <input
                  className="rpg-input"
                  value={imageForm.model}
                  onChange={(event) => setImageForm((current) => ({ ...current, model: event.target.value }))}
                  placeholder="google/gemini-2.5-flash-image-preview"
                />
              </FormField>
              <FormField label="Aspect Ratio">
                <select
                  className="rpg-input"
                  value={imageForm.aspectRatio}
                  onChange={(event) => setImageForm((current) => ({ ...current, aspectRatio: event.target.value }))}
                >
                  <option value="1:1">1:1</option>
                  <option value="4:3">4:3</option>
                  <option value="3:2">3:2</option>
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                </select>
              </FormField>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField label="Prompt">
                <textarea
                  className="rpg-input min-h-28"
                  value={imageForm.prompt}
                  onChange={(event) => setImageForm((current) => ({ ...current, prompt: event.target.value }))}
                />
              </FormField>
              <div className="space-y-4">
                <FormField label="System Prompt">
                  <textarea
                    className="rpg-input min-h-20"
                    value={imageForm.systemPrompt}
                    onChange={(event) => setImageForm((current) => ({ ...current, systemPrompt: event.target.value }))}
                    placeholder="Optional style steering"
                  />
                </FormField>
                <FormField label="Image Size">
                  <select
                    className="rpg-input"
                    value={imageForm.imageSize}
                    onChange={(event) => setImageForm((current) => ({ ...current, imageSize: event.target.value }))}
                  >
                    <option value="1K">1K</option>
                    <option value="2K">2K</option>
                    <option value="4K">4K</option>
                  </select>
                </FormField>
              </div>
            </div>
            <button
              type="submit"
              className="rpg-button rpg-btn-dark rounded-sm px-4 py-3"
              disabled={busyKey !== null || !canGenerateImage}
            >
              {busyKey === 'image' ? 'Rendering...' : 'Generate Image'}
            </button>
          </form>
          {imageResult ? (
            <div className="mt-4 space-y-3">
              <p className="text-xs uppercase tracking-[0.2em] text-[#d4af37]">
                {imageResult.provider} • {imageResult.model} • {imageResult.durationMs} ms
                {imageResult.keySlot !== null ? ` • key ${imageResult.keySlot + 1}` : ''}
              </p>
              {imageResult.text ? (
                <p className="whitespace-pre-wrap text-sm leading-6 text-[#e6d5c3]">{imageResult.text}</p>
              ) : null}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {imageResult.images.map((image, index) => (
                  <img
                    key={`${index}-${image.slice(0, 32)}`}
                    src={image}
                    alt={`Generated scene ${index + 1}`}
                    className="w-full rounded-sm border border-[#3a281c] bg-[#0a0705] object-cover"
                  />
                ))}
              </div>
            </div>
          ) : null}
        </SectionCard>

        <SectionCard>
          <form className="space-y-4" onSubmit={handleTtsSubmit}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField label="Voice">
                <input
                  className="rpg-input"
                  value={ttsForm.voice}
                  onChange={(event) => setTtsForm((current) => ({ ...current, voice: event.target.value }))}
                  placeholder="uk-UA-PolinaNeural"
                />
              </FormField>
              <FormField label="Format">
                <select
                  className="rpg-input"
                  value={ttsForm.responseFormat}
                  onChange={(event) => setTtsForm((current) => ({ ...current, responseFormat: event.target.value }))}
                >
                  <option value="mp3">mp3</option>
                  <option value="wav">wav</option>
                  <option value="opus">opus</option>
                  <option value="aac">aac</option>
                  <option value="flac">flac</option>
                  <option value="pcm">pcm</option>
                </select>
              </FormField>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[0.9fr_0.9fr_1.2fr]">
              <FormField label="TTS Model">
                <input
                  className="rpg-input"
                  value={ttsForm.model}
                  onChange={(event) => setTtsForm((current) => ({ ...current, model: event.target.value }))}
                />
              </FormField>
              <FormField label="Speed">
                <input
                  className="rpg-input"
                  type="number"
                  min="0.25"
                  max="4"
                  step="0.05"
                  value={ttsForm.speed}
                  onChange={(event) => setTtsForm((current) => ({ ...current, speed: event.target.value }))}
                />
              </FormField>
              <FormField label="Speech Text">
                <textarea
                  className="rpg-input min-h-28"
                  value={ttsForm.input}
                  onChange={(event) => setTtsForm((current) => ({ ...current, input: event.target.value }))}
                />
              </FormField>
            </div>
              <button
                type="submit"
                className="rpg-button rpg-btn-red rounded-sm px-4 py-3"
                disabled={busyKey !== null || !canGenerateSpeech}
              >
                {busyKey === 'tts' ? 'Rendering...' : 'Generate Voice'}
              </button>
              {!canGenerateSpeech && status?.ttsProvider ? (
                <p className="text-xs text-[#bba791]">
                  Start `openai-edge-tts` on `{status.ttsBaseUrl}` and keep the API key aligned with `EDGE_TTS_API_KEY`.
                </p>
              ) : null}
          </form>
          {ttsPlayback ? (
            <div className="mt-4 space-y-3 rounded-sm border border-[#3a281c] bg-[#120d0a] p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-[#d4af37]">
                edge-tts • {ttsPlayback.model} • {ttsPlayback.voice} • {ttsPlayback.durationMs} ms • {ttsPlayback.format}
              </p>
              <audio controls src={ttsPlayback.url} className="w-full" />
            </div>
          ) : null}
        </SectionCard>

        <SectionCard>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <p className="mb-3 text-xs uppercase tracking-[0.2em] text-[#d4af37]">
                Host Codex
              </p>
              <ol className="space-y-2 text-sm rpg-text">
                {STRICT_HOST_RULES.hostCodex.map((rule, index) => (
                  <li key={rule}>
                    <strong>{index + 1}.</strong> {rule}
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <p className="mb-3 text-xs uppercase tracking-[0.2em] text-[#d4af37]">
                {STRICT_HOST_RULES.uiTerminology.checklistTitle}
              </p>
              <ol className="space-y-2 text-sm rpg-text">
                {STRICT_HOST_RULES.operationalChecklist.map((step, index) => (
                  <li key={step}>
                    <strong>{index + 1}.</strong> {step}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </SectionCard>
      </div>
    </SectionPanel>
  );
}
