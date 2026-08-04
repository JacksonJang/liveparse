import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ImageToolError,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_FILE_BYTES,
  MAX_IMAGE_FILES,
  MAX_IMAGE_TOTAL_BYTES,
  createZipBlob,
  formatBytes,
  probeImage,
  processImage,
  safeOutputName,
  targetKilobytesToBytes,
  type ImageProbe,
  type ImageProcessOptions,
  type ImageProcessResult,
  type ImageResizeMode,
  type ImageToolMode,
  type SupportedImageMime,
  type ZipEntry,
} from './lib/image-tools';
import './styles.css';
import './image-tools.css';

type PageMode = 'image-compressor' | 'image-resizer' | 'png-to-jpg' | 'webp-to-jpg' | 'webp-to-png';
type OutputChoice = 'original' | SupportedImageMime;
type ResizeUnit = 'pixels' | 'percent';
type ItemStage = 'probing' | 'ready' | 'processing' | 'done' | 'probe-error' | 'process-error';

interface BatchItem {
  id: number;
  file: File;
  stage: ItemStage;
  probe: ImageProbe | null;
  sourceUrl: string | null;
  result: ImageProcessResult | null;
  resultUrl: string | null;
  error: string | null;
}

interface ProgressState {
  completed: number;
  total: number;
}

interface PageCopy {
  badge: string;
  queueTitle: string;
  queueHelp: string;
  dropTitle: string;
  dropHelp: string;
  processLabel: string;
  resultTitle: string;
  acceptedLabel: string;
  accept: string;
  coreMode: ImageToolMode;
  fixedOutput: SupportedImageMime | null;
  requiredInput: SupportedImageMime | null;
  suffix: string;
}

const PAGE_COPY: Record<PageMode, PageCopy> = {
  'image-compressor': {
    badge: 'Image compressor',
    queueTitle: 'Images to compress',
    queueHelp: 'Build a local batch, choose a target, then start processing.',
    dropTitle: 'Choose images to compress',
    dropHelp: 'Drop files here, browse, or paste an image from your clipboard.',
    processLabel: 'Compress images',
    resultTitle: 'Compressed images',
    acceptedLabel: 'JPG, PNG, or WebP',
    accept: '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp',
    coreMode: 'compress',
    fixedOutput: null,
    requiredInput: null,
    suffix: '-compressed',
  },
  'image-resizer': {
    badge: 'Image resizer',
    queueTitle: 'Images to resize',
    queueHelp: 'Set exact pixels or a percentage for this local batch.',
    dropTitle: 'Choose images to resize',
    dropHelp: 'Drop files here, browse, or paste an image from your clipboard.',
    processLabel: 'Resize images',
    resultTitle: 'Resized images',
    acceptedLabel: 'JPG, PNG, or WebP',
    accept: '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp',
    coreMode: 'resize',
    fixedOutput: null,
    requiredInput: null,
    suffix: '-resized',
  },
  'png-to-jpg': {
    badge: 'PNG → JPG',
    queueTitle: 'PNG files to convert',
    queueHelp: 'Transparency is replaced with your selected background color.',
    dropTitle: 'Choose PNG images',
    dropHelp: 'Drop PNG files here, browse, or paste a PNG from your clipboard.',
    processLabel: 'Convert PNG to JPG',
    resultTitle: 'JPG results',
    acceptedLabel: 'PNG only',
    accept: '.png,image/png',
    coreMode: 'convert',
    fixedOutput: 'image/jpeg',
    requiredInput: 'image/png',
    suffix: '-converted',
  },
  'webp-to-jpg': {
    badge: 'WebP → JPG',
    queueTitle: 'WebP files to convert',
    queueHelp: 'Choose JPG quality and a background for transparent pixels.',
    dropTitle: 'Choose WebP images',
    dropHelp: 'Drop WebP files here, browse, or paste a WebP from your clipboard.',
    processLabel: 'Convert WebP to JPG',
    resultTitle: 'JPG results',
    acceptedLabel: 'WebP only',
    accept: '.webp,image/webp',
    coreMode: 'convert',
    fixedOutput: 'image/jpeg',
    requiredInput: 'image/webp',
    suffix: '-converted',
  },
  'webp-to-png': {
    badge: 'WebP → PNG',
    queueTitle: 'WebP files to convert',
    queueHelp: 'PNG output keeps still-image transparency without lossy encoding.',
    dropTitle: 'Choose WebP images',
    dropHelp: 'Drop WebP files here, browse, or paste a WebP from your clipboard.',
    processLabel: 'Convert WebP to PNG',
    resultTitle: 'PNG results',
    acceptedLabel: 'WebP only',
    accept: '.webp,image/webp',
    coreMode: 'convert',
    fixedOutput: 'image/png',
    requiredInput: 'image/webp',
    suffix: '-converted',
  },
};

const TARGET_PRESETS_KB = [20, 50, 100, 200, 500, 1024] as const;
const DEFAULT_TARGET_KB = 200;
const DEFAULT_QUALITY = 82;
const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 800;
const DEFAULT_PERCENT = 50;

function resolvePageMode(): PageMode {
  const dataPage = document.body.dataset.page ?? '';
  const path = window.location.pathname.toLowerCase();
  const candidates: PageMode[] = ['image-compressor', 'image-resizer', 'png-to-jpg', 'webp-to-jpg', 'webp-to-png'];
  return candidates.find((candidate) => dataPage === candidate || path.includes(`/${candidate}`)) ?? 'image-compressor';
}

function mimeLabel(mime: SupportedImageMime): string {
  if (mime === 'image/jpeg') return 'JPG';
  if (mime === 'image/png') return 'PNG';
  return 'WebP';
}

function displayError(error: unknown): string {
  if (error instanceof ImageToolError) return error.message;
  if (error instanceof DOMException && error.name === 'AbortError') return 'Processing was cancelled.';
  if (error instanceof Error) return error.message;
  return 'This image could not be processed.';
}

function savingsLabel(originalBytes: number, outputBytes: number): string {
  if (originalBytes <= 0) return '—';
  const difference = ((originalBytes - outputBytes) / originalBytes) * 100;
  if (Math.abs(difference) < .05) return '0%';
  return difference > 0 ? `${difference.toFixed(1)}% smaller` : `${Math.abs(difference).toFixed(1)}% larger`;
}

function uniqueZipName(name: string, used: Map<string, number>): string {
  const normalized = name.toLowerCase();
  const seen = used.get(normalized) ?? 0;
  used.set(normalized, seen + 1);
  if (seen === 0) return name;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)}-${seen + 1}${name.slice(dot)}` : `${name}-${seen + 1}`;
}

function outputLabel(choice: OutputChoice): string {
  return choice === 'original' ? 'Keep original format' : mimeLabel(choice);
}

function ImageToolsApp({ pageMode }: { pageMode: PageMode }) {
  const page = PAGE_COPY[pageMode];
  const [items, setItemsState] = useState<BatchItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<ProgressState>({ completed: 0, total: 0 });
  const [activity, setActivity] = useState(`Ready. ${page.acceptedLabel} files stay in this browser tab.`);

  const [outputChoice, setOutputChoice] = useState<OutputChoice>('original');
  const [quality, setQuality] = useState(DEFAULT_QUALITY);
  const [background, setBackground] = useState('#ffffff');
  const [targetKb, setTargetKb] = useState(DEFAULT_TARGET_KB);
  const [targetInput, setTargetInput] = useState(String(DEFAULT_TARGET_KB));
  const [resizeUnit, setResizeUnit] = useState<ResizeUnit>('pixels');
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [percent, setPercent] = useState(DEFAULT_PERCENT);
  const [aspectLocked, setAspectLocked] = useState(true);
  const [resizeMode, setResizeMode] = useState<ImageResizeMode>('contain');
  const [noUpscale, setNoUpscale] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<BatchItem[]>([]);
  const activeIdsRef = useRef(new Set<number>());
  const objectUrlsRef = useRef(new Set<string>());
  const nextIdRef = useRef(1);
  const jobIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const updateItems = (updater: (current: BatchItem[]) => BatchItem[]) => {
    setItemsState((current) => {
      const next = updater(current);
      itemsRef.current = next;
      return next;
    });
  };

  const createTrackedUrl = (blob: Blob): string => {
    const url = URL.createObjectURL(blob);
    objectUrlsRef.current.add(url);
    return url;
  };

  const releaseUrl = (url: string | null) => {
    if (!url || !objectUrlsRef.current.delete(url)) return;
    URL.revokeObjectURL(url);
  };

  useEffect(() => () => {
    mountedRef.current = false;
    jobIdRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    activeIdsRef.current.clear();
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current.clear();
  }, []);

  const readyItems = useMemo(() => items.filter((item) => item.probe !== null && item.stage !== 'probe-error'), [items]);
  const completedItems = useMemo(() => items.filter((item) => item.result !== null && item.resultUrl !== null), [items]);
  const totalBytes = useMemo(() => items.reduce((sum, item) => sum + item.file.size, 0), [items]);
  const firstProbe = readyItems[0]?.probe ?? null;
  const chosenOutput = page.fixedOutput ?? outputChoice;
  const usesLossyControls = chosenOutput === 'image/jpeg' || chosenOutput === 'image/webp' || chosenOutput === 'original';
  const usesBackground = chosenOutput === 'image/jpeg';

  const cancelActiveJob = (announcement = 'Processing cancelled. Completed files are still available.') => {
    if (!controllerRef.current && !processing) return;
    jobIdRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setProcessing(false);
    updateItems((current) => current.map((item) => item.stage === 'processing' ? { ...item, stage: 'ready' } : item));
    setActivity(announcement);
  };

  const invalidateResults = () => {
    const hadWork = processing || itemsRef.current.some((item) => item.result !== null || item.stage === 'process-error');
    jobIdRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setProcessing(false);
    setProgress({ completed: 0, total: 0 });
    updateItems((current) => current.map((item) => {
      releaseUrl(item.resultUrl);
      if (!item.probe) return item;
      return { ...item, stage: 'ready', result: null, resultUrl: null, error: null };
    }));
    if (hadWork) setActivity('Settings changed. Choose the process button to create fresh results.');
  };

  const changeSetting = (change: () => void) => {
    invalidateResults();
    change();
  };

  const modeAccepts = (probe: ImageProbe): string | null => {
    if (probe.animated) return 'Animated images are not supported. Export a still frame and try again.';
    if (page.requiredInput && probe.mime !== page.requiredInput) {
      return `This converter accepts ${mimeLabel(page.requiredInput)} input, but the file contains ${mimeLabel(probe.mime)} data.`;
    }
    return null;
  };

  const probeQueuedItem = async (item: BatchItem) => {
    try {
      const probe = await probeImage(item.file);
      if (!activeIdsRef.current.has(item.id) || !mountedRef.current) return;
      const restriction = modeAccepts(probe);
      if (restriction) throw new Error(restriction);
      const sourceUrl = createTrackedUrl(item.file);
      updateItems((current) => current.map((candidate) => candidate.id === item.id
        ? { ...candidate, probe, sourceUrl, stage: 'ready', error: null }
        : candidate));
    } catch (error) {
      if (!activeIdsRef.current.has(item.id) || !mountedRef.current) return;
      updateItems((current) => current.map((candidate) => candidate.id === item.id
        ? { ...candidate, stage: 'probe-error', error: displayError(error) }
        : candidate));
    }
  };

  const addFiles = (files: readonly File[], source: 'picker' | 'drop' | 'clipboard') => {
    if (files.length === 0) return;
    if (processing) cancelActiveJob('The active job was cancelled before adding files. Completed results remain available.');

    const current = itemsRef.current;
    const capacity = Math.max(0, MAX_IMAGE_FILES - current.length);
    const candidates = Array.from(files).slice(0, capacity);
    let runningBytes = current
      .filter((item) => item.stage !== 'probe-error')
      .reduce((sum, item) => sum + item.file.size, 0);
    const queued: BatchItem[] = [];

    for (const file of candidates) {
      const id = nextIdRef.current++;
      let error: string | null = null;
      if (file.size > MAX_IMAGE_FILE_BYTES) {
        error = `${formatBytes(file.size)} exceeds the ${formatBytes(MAX_IMAGE_FILE_BYTES)} per-file limit.`;
      } else if (runningBytes + file.size > MAX_IMAGE_TOTAL_BYTES) {
        error = `Adding this file would exceed the ${formatBytes(MAX_IMAGE_TOTAL_BYTES)} batch limit.`;
      } else {
        runningBytes += file.size;
      }
      const item: BatchItem = {
        id,
        file,
        stage: error ? 'probe-error' : 'probing',
        probe: null,
        sourceUrl: null,
        result: null,
        resultUrl: null,
        error,
      };
      activeIdsRef.current.add(id);
      queued.push(item);
    }

    if (queued.length > 0) updateItems((existing) => [...existing, ...queued]);
    const skipped = files.length - candidates.length;
    const rejected = queued.filter((item) => item.error).length;
    const sourceLabel = source === 'clipboard' ? 'clipboard' : source === 'drop' ? 'drop' : 'picker';
    const details = [
      `${queued.length - rejected} file${queued.length - rejected === 1 ? '' : 's'} queued from the ${sourceLabel}`,
      rejected ? `${rejected} rejected by size limits` : '',
      skipped ? `${skipped} not added because the batch is limited to ${MAX_IMAGE_FILES}` : '',
    ].filter(Boolean).join(' · ');
    setActivity(details || `The batch already contains ${MAX_IMAGE_FILES} files.`);

    const itemsToProbe = queued.filter((item) => item.stage === 'probing');
    void (async () => {
      for (const item of itemsToProbe) await probeQueuedItem(item);
    })();
  };

  const removeItem = (id: number) => {
    if (processing) cancelActiveJob('Processing cancelled because the batch changed. Completed results remain available.');
    activeIdsRef.current.delete(id);
    const item = itemsRef.current.find((candidate) => candidate.id === id);
    if (!item) return;
    releaseUrl(item.sourceUrl);
    releaseUrl(item.resultUrl);
    updateItems((current) => current.filter((candidate) => candidate.id !== id));
    setActivity(`${item.file.name || 'Clipboard image'} removed from the batch.`);
  };

  const clearAll = () => {
    jobIdRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setProcessing(false);
    setProgress({ completed: 0, total: 0 });
    activeIdsRef.current.clear();
    itemsRef.current.forEach((item) => {
      releaseUrl(item.sourceUrl);
      releaseUrl(item.resultUrl);
    });
    updateItems(() => []);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setActivity('Batch cleared. Add images to begin again.');
  };

  const handleDrop = (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files), 'drop');
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (files.length === 0) return;
    event.preventDefault();
    addFiles(files, 'clipboard');
  };

  const setTargetFromInput = (raw: string) => {
    setTargetInput(raw);
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) setTargetKb(parsed);
  };

  const chooseTargetPreset = (kilobytes: number) => {
    changeSetting(() => {
      setTargetKb(kilobytes);
      setTargetInput(String(kilobytes));
    });
  };

  const referenceRatio = firstProbe ? firstProbe.width / firstProbe.height : DEFAULT_WIDTH / DEFAULT_HEIGHT;

  const updateWidth = (next: number) => {
    const safe = Math.max(1, Math.min(MAX_IMAGE_DIMENSION, Math.round(next || 1)));
    changeSetting(() => {
      setWidth(safe);
      if (aspectLocked) setHeight(Math.max(1, Math.min(MAX_IMAGE_DIMENSION, Math.round(safe / referenceRatio))));
    });
  };

  const updateHeight = (next: number) => {
    const safe = Math.max(1, Math.min(MAX_IMAGE_DIMENSION, Math.round(next || 1)));
    changeSetting(() => {
      setHeight(safe);
      if (aspectLocked) setWidth(Math.max(1, Math.min(MAX_IMAGE_DIMENSION, Math.round(safe * referenceRatio))));
    });
  };

  const settingsError = (): string | null => {
    if (pageMode === 'image-compressor') {
      const parsed = Number(targetInput);
      if (!Number.isFinite(parsed) || parsed <= 0) return 'Enter a target larger than 0 KB.';
      if (parsed > MAX_IMAGE_FILE_BYTES / 1024) {
        return `Choose a target no larger than ${formatBytes(MAX_IMAGE_FILE_BYTES)}.`;
      }
    }
    if (pageMode === 'image-resizer') {
      if (resizeUnit === 'percent') {
        if (!Number.isFinite(percent) || percent < 1 || percent > 500) return 'Enter a percentage from 1% to 500%.';
      } else if (width < 1 || height < 1 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
        return `Width and height must be from 1 to ${MAX_IMAGE_DIMENSION.toLocaleString('en-US')} pixels.`;
      }
    }
    return null;
  };

  const optionsFor = (item: BatchItem): ImageProcessOptions => {
    if (!item.probe) throw new Error('Image dimensions are unavailable.');
    const outputMime = page.fixedOutput ?? (outputChoice === 'original' ? undefined : outputChoice);
    const effectiveOutputMime = outputMime ?? item.probe.mime;
    const common = {
      mode: page.coreMode,
      outputMime,
      quality: effectiveOutputMime === 'image/png' ? undefined : quality / 100,
      background: effectiveOutputMime === 'image/jpeg' ? background : undefined,
      suffix: page.suffix,
    } satisfies ImageProcessOptions;

    if (pageMode === 'image-compressor') {
      return {
        ...common,
        targetBytes: targetKilobytesToBytes(targetKb),
      };
    }
    if (pageMode === 'image-resizer') {
      const percentScale = Math.min(percent / 100, noUpscale ? 1 : Number.POSITIVE_INFINITY);
      const targetWidth = resizeUnit === 'percent'
        ? Math.max(1, Math.round(item.probe.width * percentScale))
        : width;
      const targetHeight = resizeUnit === 'percent'
        ? Math.max(1, Math.round(item.probe.height * percentScale))
        : height;
      return {
        ...common,
        width: targetWidth,
        height: targetHeight,
        resizeMode,
        allowUpscale: !noUpscale,
      };
    }
    return common;
  };

  const runProcessing = async () => {
    const validation = settingsError();
    if (validation) {
      setActivity(validation);
      return;
    }
    const processable = itemsRef.current.filter((item) => item.probe !== null && item.stage !== 'probe-error');
    if (processable.length === 0) {
      setActivity('Add at least one supported image before processing.');
      return;
    }

    jobIdRef.current += 1;
    const jobId = jobIdRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setProcessing(true);
    setProgress({ completed: 0, total: processable.length });

    const processableIds = new Set(processable.map((item) => item.id));
    updateItems((current) => current.map((item) => {
      if (!processableIds.has(item.id)) return item;
      releaseUrl(item.resultUrl);
      return { ...item, stage: 'ready', result: null, resultUrl: null, error: null };
    }));
    setActivity(`Processing 0 of ${processable.length} images locally…`);

    let succeeded = 0;
    let failed = 0;
    let completed = 0;

    for (const snapshot of processable) {
      if (controller.signal.aborted || jobId !== jobIdRef.current) break;
      updateItems((current) => current.map((item) => item.id === snapshot.id ? { ...item, stage: 'processing', error: null } : item));
      try {
        const currentItem = itemsRef.current.find((item) => item.id === snapshot.id) ?? snapshot;
        const result = await processImage(currentItem.file, optionsFor(currentItem), controller.signal);
        if (controller.signal.aborted || jobId !== jobIdRef.current || !activeIdsRef.current.has(snapshot.id)) break;
        const resultUrl = createTrackedUrl(result.blob);
        updateItems((current) => current.map((item) => item.id === snapshot.id
          ? { ...item, stage: 'done', result, resultUrl, error: null }
          : item));
        succeeded += 1;
      } catch (error) {
        if (controller.signal.aborted || jobId !== jobIdRef.current) break;
        updateItems((current) => current.map((item) => item.id === snapshot.id
          ? { ...item, stage: 'process-error', error: displayError(error), result: null, resultUrl: null }
          : item));
        failed += 1;
      }
      completed += 1;
      setProgress({ completed, total: processable.length });
      setActivity(`Processed ${completed} of ${processable.length} images locally…`);
    }

    if (jobId !== jobIdRef.current) return;
    controllerRef.current = null;
    setProcessing(false);
    if (controller.signal.aborted) {
      setActivity(`Processing cancelled after ${completed} of ${processable.length} images.`);
    } else if (failed > 0) {
      setActivity(`${succeeded} image${succeeded === 1 ? '' : 's'} completed · ${failed} failed. Review each result below.`);
    } else {
      setActivity(`${succeeded} image${succeeded === 1 ? '' : 's'} processed locally. No files were uploaded.`);
    }
  };

  const downloadResult = (item: BatchItem) => {
    if (!item.result || !item.resultUrl) return;
    const name = item.result.fileName || safeOutputName(item.file.name, item.result.mime, page.suffix);
    const link = document.createElement('a');
    link.href = item.resultUrl;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setActivity(`${name} download started.`);
  };

  const downloadZip = async () => {
    const results = itemsRef.current.filter((item) => item.result !== null);
    if (results.length === 0) return;
    try {
      const used = new Map<string, number>();
      const entries: ZipEntry[] = results.map((item) => {
        const result = item.result!;
        const proposed = result.fileName || safeOutputName(item.file.name, result.mime, page.suffix);
        return { name: uniqueZipName(proposed, used), blob: result.blob };
      });
      setActivity(`Building a ZIP with ${entries.length} image${entries.length === 1 ? '' : 's'} locally…`);
      const zip = await createZipBlob(entries);
      const url = URL.createObjectURL(zip);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${pageMode}-results.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setActivity(`ZIP download started with ${entries.length} image${entries.length === 1 ? '' : 's'}.`);
    } catch (error) {
      setActivity(`The ZIP could not be created: ${displayError(error)}`);
    }
  };

  const renderFormatControls = () => {
    if (page.fixedOutput) {
      return (
        <div className="image-tools-field full">
          <span>Output format</span>
          <div className="image-tools-fixed-output">
            <strong>{mimeLabel(page.fixedOutput)}</strong>
            <span>{page.fixedOutput === 'image/png'
              ? 'Lossless PNG output preserves still-image transparency.'
              : 'JPG is widely compatible; transparent pixels use the background below.'}</span>
          </div>
        </div>
      );
    }
    return (
      <label className="image-tools-field full">
        <span>Output format</span>
        <select value={outputChoice} onChange={(event) => changeSetting(() => setOutputChoice(event.target.value as OutputChoice))}>
          <option value="original">Keep original format</option>
          <option value="image/jpeg">JPG</option>
          <option value="image/png">PNG</option>
          <option value="image/webp">WebP</option>
        </select>
        <small>{outputChoice === 'original'
          ? 'Each file keeps its detected JPG, PNG, or WebP format.'
          : `Every result is encoded as ${outputLabel(outputChoice)}.`}</small>
      </label>
    );
  };

  const renderCompressorSettings = () => (
    <>
      <div className="image-tools-field full">
        <span>Target file size</span>
        <div className="image-tools-presets" aria-label="Target size presets">
          {TARGET_PRESETS_KB.map((preset) => (
            <button
              type="button"
              className={`image-tools-preset ${targetKb === preset && Number(targetInput) === preset ? 'active' : ''}`}
              aria-pressed={targetKb === preset && Number(targetInput) === preset}
              onClick={() => chooseTargetPreset(preset)}
              key={preset}
            >
              {preset === 1024 ? '1 MB' : `${preset} KB`}
            </button>
          ))}
        </div>
      </div>
      <label className="image-tools-field full">
        <span>Custom target</span>
        <div className="image-tools-inline-input">
          <input
            type="number"
            min="1"
            max={Math.floor(MAX_IMAGE_FILE_BYTES / 1024)}
            step="1"
            inputMode="decimal"
            value={targetInput}
            onChange={(event) => {
              invalidateResults();
              setTargetFromInput(event.target.value);
            }}
          />
          <span>KB</span>
        </div>
      </label>
      <div className="image-tools-field full">
        <div className="image-tools-target-note">
          <strong>A best-quality limit, not an exact byte promise</strong>
          <span>The tool searches for the highest-quality output at or below the target. Some images cannot reach an extreme target without further dimension loss.</span>
        </div>
      </div>
    </>
  );

  const renderResizerSettings = () => (
    <>
      <div className="image-tools-field full">
        <span>Resize by</span>
        <div className="image-tools-segment" role="group" aria-label="Resize unit">
          <button type="button" className={resizeUnit === 'pixels' ? 'active' : ''} aria-pressed={resizeUnit === 'pixels'} onClick={() => changeSetting(() => setResizeUnit('pixels'))}>Pixels</button>
          <button type="button" className={resizeUnit === 'percent' ? 'active' : ''} aria-pressed={resizeUnit === 'percent'} onClick={() => changeSetting(() => setResizeUnit('percent'))}>Percent</button>
        </div>
      </div>
      {resizeUnit === 'pixels' ? (
        <>
          <label className="image-tools-field">
            <span>Width</span>
            <div className="image-tools-inline-input">
              <input type="number" min="1" max={MAX_IMAGE_DIMENSION} value={width} onChange={(event) => updateWidth(Number(event.target.value))} />
              <span>px</span>
            </div>
          </label>
          <label className="image-tools-field">
            <span>Height</span>
            <div className="image-tools-inline-input">
              <input type="number" min="1" max={MAX_IMAGE_DIMENSION} value={height} onChange={(event) => updateHeight(Number(event.target.value))} />
              <span>px</span>
            </div>
          </label>
          <label className="image-tools-check full">
            <input type="checkbox" checked={aspectLocked} onChange={(event) => setAspectLocked(event.target.checked)} />
            <span>
              <strong>Lock entered proportions</strong>
              <small>{firstProbe ? 'Width and height follow the first ready image ratio.' : 'The initial 3:2 ratio is used until an image is ready.'}</small>
            </span>
          </label>
          <div className="image-tools-field full">
            <span>Fit inside target</span>
            <div className="image-tools-segment" role="group" aria-label="Resize fit mode">
              <button type="button" className={resizeMode === 'contain' ? 'active' : ''} aria-pressed={resizeMode === 'contain'} onClick={() => changeSetting(() => setResizeMode('contain'))}>Contain</button>
              <button type="button" className={resizeMode === 'cover' ? 'active' : ''} aria-pressed={resizeMode === 'cover'} onClick={() => changeSetting(() => setResizeMode('cover'))}>Cover & crop</button>
            </div>
            <small>{resizeMode === 'contain' ? 'Fits each image within the box without cropping.' : 'Fills the box and crops overflow from the center.'}</small>
          </div>
        </>
      ) : (
        <label className="image-tools-field full">
          <span>Scale percentage</span>
          <div className="image-tools-inline-input">
            <input type="number" min="1" max="500" step="1" value={percent} onChange={(event) => changeSetting(() => setPercent(Number(event.target.value)))} />
            <span>%</span>
          </div>
          <small>Each image is scaled from its own original dimensions.</small>
        </label>
      )}
      <label className="image-tools-check full">
        <input type="checkbox" checked={noUpscale} onChange={(event) => changeSetting(() => setNoUpscale(event.target.checked))} />
        <span>
          <strong>Do not enlarge smaller images</strong>
          <small>Upscaling adds pixels but cannot create missing image detail.</small>
        </span>
      </label>
    </>
  );

  return (
    <div className="image-tools-app" onPaste={handlePaste}>
      <div className="image-tools-toolbar">
        <div className="image-tools-local">
          <span aria-hidden="true" />
          <div>
            <strong>Local image processing</strong>
            <small>No upload endpoint or external image API is used.</small>
          </div>
        </div>
        <span className="image-tools-mode-badge">{page.badge}</span>
      </div>

      <div className="image-tools-shell">
        <section className="image-tools-source" aria-labelledby="image-tools-queue-title">
          <div className="image-tools-heading">
            <div>
              <p>01 · Build the batch</p>
              <h2 id="image-tools-queue-title">{page.queueTitle}</h2>
              <small>{page.queueHelp}</small>
            </div>
            <button type="button" className="image-tools-clear" disabled={items.length === 0} onClick={clearAll}>Clear</button>
          </div>

          <div className="image-tools-drop-wrap">
            <input
              ref={fileInputRef}
              className="image-tools-file-input"
              type="file"
              accept={page.accept}
              multiple
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                addFiles(Array.from(event.target.files ?? []), 'picker');
                event.target.value = '';
              }}
            />
            <button
              type="button"
              className={`image-tools-dropzone ${dragging ? 'dragging' : ''}`}
              aria-describedby="image-tools-drop-help image-tools-limits"
              onClick={() => fileInputRef.current?.click()}
              onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
              onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragging(true); }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
              }}
              onDrop={handleDrop}
            >
              <span className="image-tools-dropzone-content">
                <span className="image-tools-drop-mark" aria-hidden="true">IMG</span>
                <strong>{page.dropTitle}</strong>
                <span id="image-tools-drop-help">{page.dropHelp}</span>
                <small>{page.acceptedLabel} · Click or press Enter/Space to browse</small>
              </span>
            </button>
          </div>

          <p className="image-tools-limit-note" id="image-tools-limits">
            <strong>Batch limits</strong>
            <span>Up to {MAX_IMAGE_FILES} files · {formatBytes(MAX_IMAGE_FILE_BYTES)} each · {formatBytes(MAX_IMAGE_TOTAL_BYTES)} total. File signatures and decoded dimensions are checked, not filename extensions alone.</span>
          </p>

          {items.length > 0 && (
            <ul className="image-tools-file-list" aria-label="Selected image files">
              {items.map((item) => (
                <li className={`image-tools-file-item ${item.stage === 'probe-error' || item.stage === 'process-error' ? 'error' : ''}`} aria-busy={item.stage === 'probing' || item.stage === 'processing'} key={item.id}>
                  <span className="image-tools-file-thumb">
                    {item.sourceUrl ? <img src={item.sourceUrl} alt="" /> : item.stage === 'probing' ? 'CHECK' : 'FILE'}
                  </span>
                  <span className="image-tools-file-copy">
                    <strong title={item.file.name}>{item.file.name || 'Clipboard image'}</strong>
                    {item.error ? <small className="error">{item.error}</small> : (
                      <span className="image-tools-file-meta">
                        <span>{formatBytes(item.file.size)}</span>
                        {item.probe && <span>{item.probe.width.toLocaleString('en-US')} × {item.probe.height.toLocaleString('en-US')}</span>}
                        {item.probe && <span>{mimeLabel(item.probe.mime)}</span>}
                        {item.stage === 'probing' && <span>Inspecting</span>}
                        {item.stage === 'processing' && <span>Processing</span>}
                        {item.stage === 'done' && <span>Ready</span>}
                      </span>
                    )}
                  </span>
                  <button type="button" className="image-tools-remove" aria-label={`Remove ${item.file.name || 'clipboard image'}`} onClick={() => removeItem(item.id)}>×</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="image-tools-settings" aria-labelledby="image-tools-settings-title">
          <div className="image-tools-heading">
            <div>
              <p>02 · Choose output</p>
              <h2 id="image-tools-settings-title">Processing settings</h2>
              <small>Nothing runs until you choose the process button.</small>
            </div>
          </div>

          <div className="image-tools-settings-grid">
            {pageMode === 'image-compressor' && renderCompressorSettings()}
            {pageMode === 'image-resizer' && renderResizerSettings()}
            {renderFormatControls()}

            {usesLossyControls && (
              <label className="image-tools-field full">
                <span>Starting quality · {quality}%</span>
                <input
                  type="range"
                  min="10"
                  max="100"
                  step="1"
                  value={quality}
                  onChange={(event) => changeSetting(() => setQuality(Number(event.target.value)))}
                />
                <small>{pageMode === 'image-compressor'
                  ? outputChoice === 'original'
                    ? 'Used for JPG and WebP files. PNG target reduction changes dimensions because Canvas has no PNG quality control.'
                    : 'The compressor may lower this value while searching for the target.'
                  : 'Higher quality usually creates a larger JPG or WebP file.'}</small>
              </label>
            )}

            {usesBackground && (
              <label className="image-tools-field full">
                <span>Transparency background</span>
                <input type="color" value={background} onChange={(event) => changeSetting(() => setBackground(event.target.value))} />
                <small>JPG has no alpha channel. Transparent pixels are flattened onto this color.</small>
              </label>
            )}

            <p className="image-tools-privacy-note image-tools-field full">
              <strong>Private by design</strong>
              <span>Pixels stay on this device. Re-encoding removes embedded metadata. Animated images and HEIC are rejected instead of silently losing frames or decoding remotely.</span>
            </p>
          </div>

          <div className="image-tools-actions">
            {processing ? (
              <button type="button" className="image-tools-clear" onClick={() => cancelActiveJob()}>Cancel</button>
            ) : (
              <button type="button" className="image-tools-primary" disabled={readyItems.length === 0 || items.some((item) => item.stage === 'probing')} onClick={() => { void runProcessing(); }}>{page.processLabel}</button>
            )}
            <button type="button" className="image-tools-secondary" disabled={items.length === 0} onClick={clearAll}>Clear batch</button>
          </div>
        </aside>
      </div>

      {(processing || progress.total > 0) && (
        <div className="image-tools-progress" aria-label="Batch progress">
          <div className="image-tools-progress-head">
            <strong>{processing ? 'Processing locally' : 'Last batch'}</strong>
            <span>{progress.completed} of {progress.total}</span>
          </div>
          <progress value={progress.completed} max={Math.max(1, progress.total)}>{progress.completed} of {progress.total}</progress>
        </div>
      )}

      <section className="image-tools-results" aria-labelledby="image-tools-results-title">
        <div className="image-tools-result-head">
          <div>
            <p>03 · Compare and save</p>
            <h2 id="image-tools-results-title">{page.resultTitle}</h2>
            <small>{completedItems.length} result{completedItems.length === 1 ? '' : 's'} · {formatBytes(totalBytes)} selected</small>
          </div>
          <div className="image-tools-result-actions">
            <button type="button" className="image-tools-primary" disabled={completedItems.length === 0 || processing} onClick={() => { void downloadZip(); }}>Download all as ZIP</button>
          </div>
        </div>

        {items.every((item) => item.result === null && item.stage !== 'process-error') ? (
          <div className="image-tools-empty-results">
            <strong>No generated files yet</strong>
            <p>Add supported images, review the settings, and start the batch. Original files are never modified.</p>
          </div>
        ) : (
          <ul className="image-tools-result-list">
            {items.filter((item) => item.result !== null || item.stage === 'process-error').map((item) => {
              const result = item.result;
              const targetState = result?.targetBytes !== null && result?.targetBytes !== undefined
                ? result.metTarget ? 'Target met' : 'Closest result'
                : 'Ready';
              return (
                <li className={`image-tools-result-card ${item.stage === 'process-error' ? 'failed' : ''}`} key={item.id}>
                  <div className="image-tools-result-summary image-tools-result-head">
                    <div className="image-tools-file-summary">
                      <div>
                        <strong title={item.file.name}>{item.file.name || 'Clipboard image'}</strong>
                        <small>{result ? `${mimeLabel(result.mime)} · ${result.width.toLocaleString('en-US')} × ${result.height.toLocaleString('en-US')}` : 'Processing failed'}</small>
                      </div>
                    </div>
                    {result && (
                      <div className="image-tools-result-actions">
                        <span className={`image-tools-result-state ${result.targetBytes !== null && !result.metTarget ? 'warning' : ''}`}>{targetState}</span>
                        <button type="button" className="image-tools-download" onClick={() => downloadResult(item)}>Download</button>
                      </div>
                    )}
                  </div>

                  {result && item.resultUrl ? (
                    <>
                      <div className="image-tools-preview-grid">
                        <figure className="image-tools-preview">
                          <figcaption><strong>Original</strong><span>{formatBytes(item.file.size)}</span></figcaption>
                          <div className="image-tools-preview-frame">
                            {item.sourceUrl && <img src={item.sourceUrl} alt={`Original preview of ${item.file.name || 'clipboard image'}`} />}
                          </div>
                        </figure>
                        <figure className="image-tools-preview">
                          <figcaption><strong>Result</strong><span>{formatBytes(result.outputBytes)}</span></figcaption>
                          <div className="image-tools-preview-frame">
                            <img src={item.resultUrl} alt={`Processed preview of ${item.file.name || 'clipboard image'}`} />
                          </div>
                        </figure>
                      </div>
                      <div className="image-tools-result-details">
                        <div className="image-tools-result-facts">
                          <div><span>Dimensions</span><strong>{result.width.toLocaleString('en-US')} × {result.height.toLocaleString('en-US')}</strong></div>
                          <div><span>Output size</span><strong>{formatBytes(result.outputBytes)}</strong></div>
                          <div><span>Size change</span><strong>{savingsLabel(result.originalBytes, result.outputBytes)}</strong></div>
                          <div><span>Encoding</span><strong>{result.quality === null ? 'Lossless' : `${Math.round(result.quality * 100)}% quality`}</strong></div>
                          {result.targetBytes !== null && <div><span>Target</span><strong>{formatBytes(result.targetBytes)} · {result.metTarget ? 'met' : 'not reached'}</strong></div>}
                          <div><span>Metadata</span><strong>{result.metadataStripped ? 'Removed' : 'Not re-encoded'}</strong></div>
                        </div>
                        {result.warnings.length > 0 && (
                          <ul className="image-tools-warnings">
                            {result.warnings.map((warning, index) => <li key={`${item.id}-${index}`}>{warning}</li>)}
                          </ul>
                        )}
                      </div>
                    </>
                  ) : item.error ? (
                    <p className="image-tools-result-error"><strong>Could not process this file.</strong><br />{item.error}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="image-tools-status" role="status" aria-live="polite" aria-atomic="true">
        <strong>Local status</strong>
        <span>{activity}</span>
      </p>
    </div>
  );
}

const root = document.getElementById('image-tools-root') ?? document.getElementById('root');
if (root) createRoot(root).render(<React.StrictMode><ImageToolsApp pageMode={resolvePageMode()} /></React.StrictMode>);
