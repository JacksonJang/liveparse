export type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export type ImageToolMode = 'compress' | 'resize' | 'convert';
export type ImageResizeMode = 'contain' | 'cover';

export const MAX_IMAGE_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_TOTAL_BYTES = 100 * 1024 * 1024;
export const MAX_IMAGE_FILES = 20;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const MAX_IMAGE_DIMENSION = 16_384;

const PNG_SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;
const ZIP_DOS_TIME = 0;
const ZIP_DOS_DATE = 0x0021; // 1980-01-01, the earliest representable DOS date.
const UINT32_MAX = 0xffff_ffff;
const METADATA_WARNING = 'Re-encoding strips EXIF, ICC, XMP, and other embedded metadata.';

export interface ImageProbe {
  readonly mime: SupportedImageMime;
  readonly width: number;
  readonly height: number;
  readonly pixels: number;
  readonly animated: boolean;
  readonly bytes: number;
}

export interface ImageProcessOptions {
  readonly mode: ImageToolMode;
  readonly outputMime?: SupportedImageMime;
  /** Binary byte target. Use targetKilobytesToBytes() for a user-entered KB value. */
  readonly targetBytes?: number;
  readonly width?: number;
  readonly height?: number;
  readonly resizeMode?: ImageResizeMode;
  /** Defaults to false. */
  readonly allowUpscale?: boolean;
  /** JPEG/WebP quality from greater than 0 through 1. PNG never receives this value. */
  readonly quality?: number;
  /** Background used when flattening transparency to JPEG. Defaults to white. */
  readonly background?: string;
  /** Output-name suffix, including any desired separator. */
  readonly suffix?: string;
}

export interface ImageProcessResult {
  readonly blob: Blob;
  readonly mime: SupportedImageMime;
  readonly width: number;
  readonly height: number;
  readonly originalBytes: number;
  readonly outputBytes: number;
  readonly originalProbe: ImageProbe;
  readonly quality: number | null;
  readonly targetBytes: number | null;
  readonly metTarget: boolean;
  readonly originalPreserved: boolean;
  readonly metadataStripped: boolean;
  readonly warnings: readonly string[];
  readonly fileName: string;
}

export interface ImageGeometry {
  readonly width: number;
  readonly height: number;
  readonly sourceX: number;
  readonly sourceY: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
}

export interface ZipEntry {
  readonly name: string;
  readonly blob: Blob;
}

export type ImageToolErrorCode =
  | 'UNSUPPORTED_FORMAT'
  | 'INVALID_IMAGE'
  | 'ANIMATED_IMAGE'
  | 'FILE_TOO_LARGE'
  | 'TOO_MANY_FILES'
  | 'TOTAL_TOO_LARGE'
  | 'DIMENSIONS_TOO_LARGE'
  | 'PIXELS_TOO_LARGE'
  | 'INVALID_OPTIONS'
  | 'DECODE_FAILED'
  | 'CANVAS_UNAVAILABLE'
  | 'OUTPUT_FORMAT_UNSUPPORTED'
  | 'ENCODE_FAILED'
  | 'TARGET_UNREACHABLE'
  | 'ZIP_LIMIT_EXCEEDED'
  | 'INVALID_ZIP_ENTRY';

export class ImageToolError extends Error {
  readonly code: ImageToolErrorCode;

  constructor(code: ImageToolErrorCode, message: string) {
    super(message);
    this.name = 'ImageToolError';
    this.code = code;
  }
}

function ascii(bytes: Uint8Array, offset: number, value: string): boolean {
  if (offset < 0 || offset + value.length > bytes.length) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
}

function hasBytes(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  if (offset < 0 || offset + expected.length > bytes.length) return false;
  return expected.every((value, index) => bytes[offset + index] === value);
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) return -1;
  return bytes[offset] * 0x100 + bytes[offset + 1];
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) return -1;
  return bytes[offset] + bytes[offset + 1] * 0x100;
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 3 > bytes.length) return -1;
  return bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x1_0000;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) return -1;
  return (
    bytes[offset] * 0x1_000000
    + bytes[offset + 1] * 0x1_0000
    + bytes[offset + 2] * 0x100
    + bytes[offset + 3]
  );
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) return -1;
  return (
    bytes[offset]
    + bytes[offset + 1] * 0x100
    + bytes[offset + 2] * 0x1_0000
    + bytes[offset + 3] * 0x1_000000
  );
}

export function sniffImageMime(bytes: Uint8Array): SupportedImageMime | null {
  if (hasBytes(bytes, 0, PNG_SIGNATURE)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) {
    return 'image/webp';
  }
  return null;
}

function forEachPngChunk(
  bytes: Uint8Array,
  visit: (typeOffset: number, dataOffset: number, length: number) => boolean | void,
): void {
  if (!hasBytes(bytes, 0, PNG_SIGNATURE)) return;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = readUint32BE(bytes, offset);
    if (length < 0 || offset + 12 + length > bytes.length) return;
    const typeOffset = offset + 4;
    if (visit(typeOffset, offset + 8, length) === false) return;
    offset += 12 + length;
    if (ascii(bytes, typeOffset, 'IEND')) return;
  }
}

function forEachWebpChunk(
  bytes: Uint8Array,
  visit: (typeOffset: number, dataOffset: number, length: number) => boolean | void,
): void {
  if (sniffImageMime(bytes) !== 'image/webp') return;
  const declaredRiffSize = readUint32LE(bytes, 4);
  const declaredEnd = declaredRiffSize >= 4 ? Math.min(bytes.length, declaredRiffSize + 8) : bytes.length;
  let offset = 12;
  while (offset + 8 <= declaredEnd) {
    const length = readUint32LE(bytes, offset + 4);
    if (length < 0 || offset + 8 + length > declaredEnd) return;
    if (visit(offset, offset + 8, length) === false) return;
    offset += 8 + length + (length & 1);
  }
}

export function detectAnimatedImage(bytes: Uint8Array, mime: SupportedImageMime): boolean {
  if (mime === 'image/png') {
    let animated = false;
    forEachPngChunk(bytes, (typeOffset) => {
      if (ascii(bytes, typeOffset, 'acTL')) {
        animated = true;
        return false;
      }
      return undefined;
    });
    return animated;
  }

  if (mime === 'image/webp') {
    let animated = false;
    forEachWebpChunk(bytes, (typeOffset, dataOffset, length) => {
      if (ascii(bytes, typeOffset, 'VP8X') && length >= 1 && (bytes[dataOffset] & 0x02) !== 0) {
        animated = true;
        return false;
      }
      if (ascii(bytes, typeOffset, 'ANIM') || ascii(bytes, typeOffset, 'ANMF')) {
        animated = true;
        return false;
      }
      return undefined;
    });
    return animated;
  }

  return false;
}

function jpegDimensions(bytes: Uint8Array): readonly [number, number] | null {
  if (sniffImageMime(bytes) !== 'image/jpeg') return null;
  let offset = 2;

  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset];
    offset += 1;

    if (marker === 0x00 || marker === 0x01 || marker === 0xd8 || marker === 0xd9
      || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 2 > bytes.length) return null;
    const segmentLength = readUint16BE(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;

    const isStartOfFrame = (
      (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf)
    );
    if (isStartOfFrame) {
      if (segmentLength < 7) return null;
      const height = readUint16BE(bytes, offset + 3);
      const width = readUint16BE(bytes, offset + 5);
      return width > 0 && height > 0 ? [width, height] : null;
    }
    if (marker === 0xda) return null;
    offset += segmentLength;
  }
  return null;
}

function pngDimensions(bytes: Uint8Array): readonly [number, number] | null {
  if (sniffImageMime(bytes) !== 'image/png' || bytes.length < 24) return null;
  if (readUint32BE(bytes, 8) !== 13 || !ascii(bytes, 12, 'IHDR')) return null;
  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  return width > 0 && height > 0 ? [width, height] : null;
}

function webpDimensions(bytes: Uint8Array): readonly [number, number] | null {
  if (sniffImageMime(bytes) !== 'image/webp') return null;
  let dimensions: readonly [number, number] | null = null;

  forEachWebpChunk(bytes, (typeOffset, dataOffset, length) => {
    if (ascii(bytes, typeOffset, 'VP8X')) {
      if (length < 10) return false;
      const widthMinusOne = readUint24LE(bytes, dataOffset + 4);
      const heightMinusOne = readUint24LE(bytes, dataOffset + 7);
      if (widthMinusOne >= 0 && heightMinusOne >= 0) {
        dimensions = [widthMinusOne + 1, heightMinusOne + 1];
      }
      return false;
    }

    if (ascii(bytes, typeOffset, 'VP8 ')) {
      if (length < 10 || !hasBytes(bytes, dataOffset + 3, [0x9d, 0x01, 0x2a])) return false;
      const width = readUint16LE(bytes, dataOffset + 6) & 0x3fff;
      const height = readUint16LE(bytes, dataOffset + 8) & 0x3fff;
      if (width > 0 && height > 0) dimensions = [width, height];
      return false;
    }

    if (ascii(bytes, typeOffset, 'VP8L')) {
      if (length < 5 || bytes[dataOffset] !== 0x2f) return false;
      const b1 = bytes[dataOffset + 1];
      const b2 = bytes[dataOffset + 2];
      const b3 = bytes[dataOffset + 3];
      const b4 = bytes[dataOffset + 4];
      const width = 1 + b1 + ((b2 & 0x3f) << 8);
      const height = 1 + ((b2 & 0xc0) >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10);
      dimensions = [width, height];
      return false;
    }
    return undefined;
  });

  return dimensions;
}

function dimensionsFor(bytes: Uint8Array, mime: SupportedImageMime): readonly [number, number] | null {
  if (mime === 'image/jpeg') return jpegDimensions(bytes);
  if (mime === 'image/png') return pngDimensions(bytes);
  return webpDimensions(bytes);
}

function assertFileSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new ImageToolError('INVALID_IMAGE', 'The image has an invalid byte length.');
  }
  if (size > MAX_IMAGE_FILE_BYTES) {
    throw new ImageToolError(
      'FILE_TOO_LARGE',
      `Each image must be ${formatBytes(MAX_IMAGE_FILE_BYTES)} or smaller.`,
    );
  }
}

function assertDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new ImageToolError('INVALID_IMAGE', 'The image dimensions are invalid.');
  }
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    throw new ImageToolError(
      'DIMENSIONS_TOO_LARGE',
      `Image width and height must not exceed ${MAX_IMAGE_DIMENSION.toLocaleString('en-US')} pixels.`,
    );
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > MAX_IMAGE_PIXELS) {
    throw new ImageToolError(
      'PIXELS_TOO_LARGE',
      `Images must not exceed ${MAX_IMAGE_PIXELS.toLocaleString('en-US')} pixels.`,
    );
  }
}

export function validateImageBatch(files: readonly Pick<Blob, 'size'>[]): void {
  if (files.length > MAX_IMAGE_FILES) {
    throw new ImageToolError('TOO_MANY_FILES', `Select no more than ${MAX_IMAGE_FILES} images at once.`);
  }
  let total = 0;
  for (const file of files) {
    assertFileSize(file.size);
    total += file.size;
    if (!Number.isSafeInteger(total) || total > MAX_IMAGE_TOTAL_BYTES) {
      throw new ImageToolError(
        'TOTAL_TOO_LARGE',
        `The selected images must total ${formatBytes(MAX_IMAGE_TOTAL_BYTES)} or less.`,
      );
    }
  }
}

export async function probeImage(blob: Blob): Promise<ImageProbe> {
  assertFileSize(blob.size);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mime = sniffImageMime(bytes);
  if (!mime) {
    throw new ImageToolError(
      'UNSUPPORTED_FORMAT',
      'Only files whose bytes identify them as JPEG, PNG, or WebP are supported.',
    );
  }
  const dimensions = dimensionsFor(bytes, mime);
  if (!dimensions) {
    throw new ImageToolError('INVALID_IMAGE', `The ${mime} dimensions could not be read from the file bytes.`);
  }
  const [width, height] = dimensions;
  assertDimensions(width, height);
  return Object.freeze({
    mime,
    width,
    height,
    pixels: width * height,
    animated: detectAnimatedImage(bytes, mime),
    bytes: blob.size,
  });
}

function positiveDimension(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_IMAGE_DIMENSION) {
    throw new ImageToolError(
      'INVALID_OPTIONS',
      `${label} must be a whole number from 1 through ${MAX_IMAGE_DIMENSION.toLocaleString('en-US')}.`,
    );
  }
  return value;
}

export function calculateResizeGeometry(
  sourceWidth: number,
  sourceHeight: number,
  requestedWidth?: number,
  requestedHeight?: number,
  mode: ImageResizeMode = 'contain',
  allowUpscale = false,
): ImageGeometry {
  assertDimensions(sourceWidth, sourceHeight);
  const width = positiveDimension(requestedWidth, 'Width');
  const height = positiveDimension(requestedHeight, 'Height');
  if (mode !== 'contain' && mode !== 'cover') {
    throw new ImageToolError('INVALID_OPTIONS', `Unsupported resize mode: ${String(mode)}.`);
  }

  if (width === undefined && height === undefined) {
    return Object.freeze({
      width: sourceWidth,
      height: sourceHeight,
      sourceX: 0,
      sourceY: 0,
      sourceWidth,
      sourceHeight,
    });
  }

  if (mode === 'contain' || width === undefined || height === undefined) {
    const widthScale = width === undefined ? Number.POSITIVE_INFINITY : width / sourceWidth;
    const heightScale = height === undefined ? Number.POSITIVE_INFINITY : height / sourceHeight;
    let scale = Math.min(widthScale, heightScale);
    if (!allowUpscale) scale = Math.min(scale, 1);
    const outputWidth = Math.max(1, Math.round(sourceWidth * scale));
    const outputHeight = Math.max(1, Math.round(sourceHeight * scale));
    assertDimensions(outputWidth, outputHeight);
    return Object.freeze({
      width: outputWidth,
      height: outputHeight,
      sourceX: 0,
      sourceY: 0,
      sourceWidth,
      sourceHeight,
    });
  }

  let outputScale = 1;
  if (!allowUpscale) outputScale = Math.min(1, sourceWidth / width, sourceHeight / height);
  const outputWidth = Math.max(1, Math.round(width * outputScale));
  const outputHeight = Math.max(1, Math.round(height * outputScale));
  assertDimensions(outputWidth, outputHeight);

  const targetRatio = outputWidth / outputHeight;
  const sourceRatio = sourceWidth / sourceHeight;
  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;
  if (sourceRatio > targetRatio) cropWidth = sourceHeight * targetRatio;
  else if (sourceRatio < targetRatio) cropHeight = sourceWidth / targetRatio;

  return Object.freeze({
    width: outputWidth,
    height: outputHeight,
    sourceX: (sourceWidth - cropWidth) / 2,
    sourceY: (sourceHeight - cropHeight) / 2,
    sourceWidth: cropWidth,
    sourceHeight: cropHeight,
  });
}

function abortError(): Error {
  if (typeof DOMException !== 'undefined') return new DOMException('The image job was cancelled.', 'AbortError');
  const error = new Error('The image job was cancelled.');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

interface DecodedImage {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
  close(): void;
}

async function decodeWithImageElement(blob: Blob, signal?: AbortSignal): Promise<DecodedImage> {
  if (typeof Image === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
    throw new ImageToolError('DECODE_FAILED', 'This browser does not provide an image decoder.');
  }
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = 'async';

  try {
    await new Promise<void>((resolve, reject) => {
      const cleanUp = (): void => {
        image.onload = null;
        image.onerror = null;
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = (): void => {
        cleanUp();
        image.src = '';
        reject(abortError());
      };
      image.onload = () => {
        cleanUp();
        resolve();
      };
      image.onerror = () => {
        cleanUp();
        reject(new ImageToolError('DECODE_FAILED', 'The browser could not decode this image.'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      image.src = objectUrl;
    });
    throwIfAborted(signal);
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function decodeImage(blob: Blob, signal?: AbortSignal): Promise<DecodedImage> {
  throwIfAborted(signal);
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      if (signal?.aborted) {
        bitmap.close();
        throw abortError();
      }
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') throw error;
      // Safari and older browsers can expose createImageBitmap but reject formats
      // that their HTML image decoder supports, so continue to the fallback.
    }
  }
  return decodeWithImageElement(blob, signal);
}

function canvasFor(width: number, height: number): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    throw new ImageToolError('CANVAS_UNAVAILABLE', 'Canvas encoding is unavailable in this environment.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function contextFor(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new ImageToolError('CANVAS_UNAVAILABLE', 'A 2D canvas context could not be created.');
  return context;
}

async function verifiedCanvasBlob(
  canvas: HTMLCanvasElement,
  mime: SupportedImageMime,
  quality: number | undefined,
  signal?: AbortSignal,
): Promise<Blob> {
  throwIfAborted(signal);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((encoded) => {
      if (!encoded) {
        reject(new ImageToolError('ENCODE_FAILED', `The browser failed to encode ${mime}.`));
        return;
      }
      resolve(encoded);
    }, mime, mime === 'image/png' ? undefined : quality);
  });
  throwIfAborted(signal);
  const magic = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  throwIfAborted(signal);
  if (sniffImageMime(magic) !== mime || (blob.type && blob.type.toLowerCase() !== mime)) {
    throw new ImageToolError(
      'OUTPUT_FORMAT_UNSUPPORTED',
      `This browser did not actually encode ${mime}; it returned a different format.`,
    );
  }
  return blob;
}

interface EncodedCandidate {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
  readonly quality: number | null;
}

interface LossySearchResult {
  readonly candidate: EncodedCandidate | null;
  readonly smallest: EncodedCandidate;
}

function scaledDimension(value: number, scale: number): number {
  return Math.max(1, Math.min(MAX_IMAGE_DIMENSION, Math.round(value * scale)));
}

function nextResolutionScale(current: number, targetBytes: number, actualBytes: number): number {
  const estimated = Math.sqrt(targetBytes / Math.max(1, actualBytes)) * 0.92;
  return current * Math.min(0.9, Math.max(0.25, estimated));
}

function optionQuality(value: number | undefined): number {
  const quality = value ?? 0.92;
  if (!Number.isFinite(quality) || quality <= 0 || quality > 1) {
    throw new ImageToolError('INVALID_OPTIONS', 'Quality must be greater than 0 and no more than 1.');
  }
  return quality;
}

function optionTargetBytes(value: number | undefined, required: boolean): number | null {
  if (value === undefined) {
    if (required) throw new ImageToolError('INVALID_OPTIONS', 'Compression requires a target byte size.');
    return null;
  }
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_IMAGE_TOTAL_BYTES) {
    throw new ImageToolError(
      'INVALID_OPTIONS',
      `Target bytes must be a whole number from 1 through ${MAX_IMAGE_TOTAL_BYTES.toLocaleString('en-US')}.`,
    );
  }
  return value;
}

function inputName(blob: Blob, mime: SupportedImageMime): string {
  const named = blob as Blob & { readonly name?: unknown };
  if (typeof named.name === 'string' && named.name.trim()) return named.name;
  return `image.${extensionForMime(mime)}`;
}

function extensionForMime(mime: SupportedImageMime): 'jpg' | 'png' | 'webp' {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  return 'webp';
}

function defaultSuffix(mode: ImageToolMode): string {
  if (mode === 'compress') return '-compressed';
  if (mode === 'resize') return '-resized';
  return '-converted';
}

export async function processImage(
  blob: Blob,
  options: ImageProcessOptions,
  signal?: AbortSignal,
): Promise<ImageProcessResult> {
  throwIfAborted(signal);
  if (!options || !['compress', 'resize', 'convert'].includes(options.mode)) {
    throw new ImageToolError('INVALID_OPTIONS', 'Choose compress, resize, or convert mode.');
  }
  const targetBytes = optionTargetBytes(options.targetBytes, options.mode === 'compress');
  const requestedWidth = positiveDimension(options.width, 'Width');
  const requestedHeight = positiveDimension(options.height, 'Height');
  if (options.mode === 'resize' && requestedWidth === undefined && requestedHeight === undefined) {
    throw new ImageToolError('INVALID_OPTIONS', 'Resize mode requires a width, a height, or both.');
  }
  if (options.mode === 'convert' && options.outputMime === undefined) {
    throw new ImageToolError('INVALID_OPTIONS', 'Convert mode requires an output MIME type.');
  }

  const probe = await probeImage(blob);
  throwIfAborted(signal);
  if (probe.animated) {
    throw new ImageToolError(
      'ANIMATED_IMAGE',
      'Animated WebP and APNG files are rejected because canvas output would silently discard animation frames.',
    );
  }
  const outputMime = options.outputMime ?? probe.mime;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(outputMime)) {
    throw new ImageToolError('INVALID_OPTIONS', `Unsupported output MIME type: ${String(outputMime)}.`);
  }

  const sameFormat = outputMime === probe.mime;
  const noRequestedResize = requestedWidth === undefined && requestedHeight === undefined;
  if (
    options.mode === 'compress'
    && targetBytes !== null
    && blob.size <= targetBytes
    && sameFormat
    && noRequestedResize
  ) {
    const fileName = safeOutputName(inputName(blob, probe.mime), outputMime, options.suffix ?? '');
    return Object.freeze({
      blob,
      mime: outputMime,
      width: probe.width,
      height: probe.height,
      originalBytes: blob.size,
      outputBytes: blob.size,
      originalProbe: probe,
      quality: null,
      targetBytes,
      metTarget: true,
      originalPreserved: true,
      metadataStripped: false,
      warnings: Object.freeze(['The original already met the target, so its bytes and metadata were preserved.']),
      fileName,
    });
  }

  const decoded = await decodeImage(blob, signal);
  try {
    assertDimensions(decoded.width, decoded.height);
    const geometry = calculateResizeGeometry(
      decoded.width,
      decoded.height,
      requestedWidth,
      requestedHeight,
      options.resizeMode ?? 'contain',
      options.allowUpscale ?? false,
    );
    const maxQuality = optionQuality(options.quality);
    const background = options.background?.trim() || '#ffffff';
    const warnings: string[] = [METADATA_WARNING];
    if (outputMime === 'image/png' && options.quality !== undefined) {
      warnings.push('PNG canvas encoding does not accept a quality control; the quality option was ignored.');
    }

    const render = async (
      width: number,
      height: number,
      quality: number | undefined,
    ): Promise<EncodedCandidate> => {
      throwIfAborted(signal);
      assertDimensions(width, height);
      const canvas = canvasFor(width, height);
      const context = contextFor(canvas);
      if (outputMime === 'image/jpeg') {
        context.save();
        context.fillStyle = background;
        context.fillRect(0, 0, width, height);
        context.restore();
      }
      context.drawImage(
        decoded.source,
        geometry.sourceX,
        geometry.sourceY,
        geometry.sourceWidth,
        geometry.sourceHeight,
        0,
        0,
        width,
        height,
      );
      const encoded = await verifiedCanvasBlob(canvas, outputMime, quality, signal);
      return Object.freeze({
        blob: encoded,
        width,
        height,
        quality: outputMime === 'image/png' ? null : (quality ?? maxQuality),
      });
    };

    const searchLossy = async (width: number, height: number): Promise<LossySearchResult> => {
      const highCandidate = await render(width, height, maxQuality);
      if (targetBytes === null || highCandidate.blob.size <= targetBytes) {
        return { candidate: highCandidate, smallest: highCandidate };
      }

      const minimumQuality = Math.min(0.1, maxQuality);
      const lowCandidate = await render(width, height, minimumQuality);
      if (lowCandidate.blob.size > targetBytes) return { candidate: null, smallest: lowCandidate };

      let low = minimumQuality;
      let high = maxQuality;
      let best = lowCandidate;
      for (let iteration = 0; iteration < 9; iteration += 1) {
        throwIfAborted(signal);
        const midpoint = (low + high) / 2;
        const candidate = await render(width, height, midpoint);
        if (candidate.blob.size <= targetBytes) {
          best = candidate;
          low = midpoint;
        } else {
          high = midpoint;
        }
      }
      return { candidate: best, smallest: lowCandidate };
    };

    let candidate: EncodedCandidate | null = null;
    let closestCandidate: EncodedCandidate | null = null;
    let resolutionScale = 1;
    let reducedResolution = false;

    for (let attempt = 0; attempt < 14; attempt += 1) {
      throwIfAborted(signal);
      const width = scaledDimension(geometry.width, resolutionScale);
      const height = scaledDimension(geometry.height, resolutionScale);

      if (outputMime === 'image/png') {
        const encoded = await render(width, height, undefined);
        if (!closestCandidate || encoded.blob.size < closestCandidate.blob.size) closestCandidate = encoded;
        if (targetBytes === null || encoded.blob.size <= targetBytes) {
          candidate = encoded;
          break;
        }
        if (width === 1 && height === 1) break;
        const nextScale = nextResolutionScale(resolutionScale, targetBytes, encoded.blob.size);
        resolutionScale = Math.min(nextScale, resolutionScale * 0.9);
      } else {
        const searched = await searchLossy(width, height);
        const closestForSize = searched.candidate ?? searched.smallest;
        if (!closestCandidate || closestForSize.blob.size < closestCandidate.blob.size) {
          closestCandidate = closestForSize;
        }
        if (searched.candidate) {
          candidate = searched.candidate;
          break;
        }
        if (width === 1 && height === 1 || targetBytes === null) break;
        const nextScale = nextResolutionScale(resolutionScale, targetBytes, searched.smallest.blob.size);
        resolutionScale = Math.min(nextScale, resolutionScale * 0.9);
      }
      reducedResolution = true;
    }

    if (!candidate) {
      candidate = closestCandidate;
      if (!candidate) {
        throw new ImageToolError('ENCODE_FAILED', 'The browser encoder did not produce an image result.');
      }
      warnings.push(
        `The closest browser-encoded result is ${formatBytes(candidate.blob.size)} and does not reach the ${formatBytes(targetBytes ?? 0)} target.`,
      );
    }
    if (reducedResolution || candidate.width < geometry.width || candidate.height < geometry.height) {
      warnings.push('Dimensions were reduced because quality adjustment alone could not meet the byte target.');
    }

    const suffix = options.suffix ?? defaultSuffix(options.mode);
    const fileName = safeOutputName(inputName(blob, probe.mime), outputMime, suffix);
    return Object.freeze({
      blob: candidate.blob,
      mime: outputMime,
      width: candidate.width,
      height: candidate.height,
      originalBytes: blob.size,
      outputBytes: candidate.blob.size,
      originalProbe: probe,
      quality: candidate.quality,
      targetBytes,
      metTarget: targetBytes === null || candidate.blob.size <= targetBytes,
      originalPreserved: false,
      metadataStripped: true,
      warnings: Object.freeze(warnings),
      fileName,
    });
  } finally {
    decoded.close();
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new ImageToolError('INVALID_OPTIONS', 'Byte count must be a non-negative finite number.');
  }
  if (bytes < 1024) return `${Math.round(bytes).toLocaleString('en-US')} B`;
  const units = ['KB', 'MB', 'GB', 'TB'] as const;
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${Number(value.toFixed(digits)).toLocaleString('en-US')} ${units[unitIndex]}`;
}

export function targetKilobytesToBytes(kilobytes: number): number {
  if (!Number.isFinite(kilobytes) || kilobytes <= 0) {
    throw new ImageToolError('INVALID_OPTIONS', 'Target KB must be a positive finite number.');
  }
  const bytes = Math.round(kilobytes * 1024);
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_IMAGE_TOTAL_BYTES) {
    throw new ImageToolError(
      'INVALID_OPTIONS',
      `Target KB must resolve to no more than ${formatBytes(MAX_IMAGE_TOTAL_BYTES)}.`,
    );
  }
  return bytes;
}

function cleanFilePart(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[ .-]+$/g, '')
    .replace(/^[ .]+/g, '')
    .trim();
}

export function safeOutputName(
  name: string,
  mime: SupportedImageMime,
  suffix = '-processed',
): string {
  const pathParts = String(name).split(/[\\/]/).filter(Boolean);
  const lastPathPart = pathParts[pathParts.length - 1] ?? '';
  const withoutExtension = lastPathPart.replace(/\.[^.]*$/, '');
  let base = cleanFilePart(withoutExtension) || 'image';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) base = `image-${base}`;
  const cleanSuffix = cleanFilePart(suffix);
  const normalizedSuffix = cleanSuffix ? (suffix.startsWith('-') ? `-${cleanSuffix.replace(/^-+/, '')}` : cleanSuffix) : '';
  const extension = extensionForMime(mime);
  const maximumBaseLength = Math.max(1, 120 - normalizedSuffix.length - extension.length - 1);
  base = base.slice(0, maximumBaseLength).replace(/[ .-]+$/g, '') || 'image';
  return `${base}${normalizedSuffix}.${extension}`;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? (value >>> 1) ^ 0xedb8_8320 : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffff_ffff) >>> 0;
}

function zipName(name: string, index: number): string {
  const pathParts = String(name).split(/[\\/]/).filter(Boolean);
  const lastPathPart = pathParts[pathParts.length - 1] ?? '';
  const cleaned = cleanFilePart(lastPathPart).replace(/^\.+$/, '');
  return cleaned || `file-${index + 1}`;
}

function uniqueZipName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const extensionIndex = name.lastIndexOf('.');
  const base = extensionIndex > 0 ? name.slice(0, extensionIndex) : name;
  const extension = extensionIndex > 0 ? name.slice(extensionIndex) : '';
  let counter = 2;
  let candidate = `${base} (${counter})${extension}`;
  while (used.has(candidate)) {
    counter += 1;
    candidate = `${base} (${counter})${extension}`;
  }
  used.add(candidate);
  return candidate;
}

function localZipHeader(nameLength: number, checksum: number, size: number): ArrayBuffer {
  const buffer = new ArrayBuffer(30);
  const view = new DataView(buffer);
  view.setUint32(0, 0x0403_4b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, ZIP_UTF8_FLAG, true);
  view.setUint16(8, ZIP_STORE_METHOD, true);
  view.setUint16(10, ZIP_DOS_TIME, true);
  view.setUint16(12, ZIP_DOS_DATE, true);
  view.setUint32(14, checksum, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, nameLength, true);
  view.setUint16(28, 0, true);
  return buffer;
}

function centralZipHeader(
  nameLength: number,
  checksum: number,
  size: number,
  localOffset: number,
): ArrayBuffer {
  const buffer = new ArrayBuffer(46);
  const view = new DataView(buffer);
  view.setUint32(0, 0x0201_4b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, ZIP_UTF8_FLAG, true);
  view.setUint16(10, ZIP_STORE_METHOD, true);
  view.setUint16(12, ZIP_DOS_TIME, true);
  view.setUint16(14, ZIP_DOS_DATE, true);
  view.setUint32(16, checksum, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, nameLength, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, localOffset, true);
  return buffer;
}

function endOfCentralDirectory(entryCount: number, centralSize: number, centralOffset: number): ArrayBuffer {
  const buffer = new ArrayBuffer(22);
  const view = new DataView(buffer);
  view.setUint32(0, 0x0605_4b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, 0, true);
  return buffer;
}

export async function createZipBlob(entries: readonly ZipEntry[]): Promise<Blob> {
  if (entries.length === 0) {
    throw new ImageToolError('INVALID_ZIP_ENTRY', 'At least one ZIP entry is required.');
  }
  if (entries.length > MAX_IMAGE_FILES || entries.length > 0xffff) {
    throw new ImageToolError('ZIP_LIMIT_EXCEEDED', `A ZIP may contain no more than ${MAX_IMAGE_FILES} images.`);
  }
  for (let index = 0; index < entries.length; index += 1) {
    if (!(entries[index]?.blob instanceof Blob)) {
      throw new ImageToolError('INVALID_ZIP_ENTRY', `ZIP entry ${index + 1} does not contain a Blob.`);
    }
  }
  validateImageBatch(entries.map((entry) => entry.blob));

  const encoder = new TextEncoder();
  const localParts: BlobPart[] = [];
  const centralParts: BlobPart[] = [];
  const usedNames = new Set<string>();
  let localOffset = 0;
  let centralSize = 0;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const name = uniqueZipName(zipName(entry.name, index), usedNames);
    const nameBytes = encoder.encode(name);
    if (nameBytes.length === 0 || nameBytes.length > 0xffff) {
      throw new ImageToolError('INVALID_ZIP_ENTRY', `ZIP entry ${index + 1} has an invalid UTF-8 name.`);
    }
    if (entry.blob.size > UINT32_MAX) {
      throw new ImageToolError('ZIP_LIMIT_EXCEEDED', 'ZIP64 is not supported.');
    }
    const bytes = new Uint8Array(await entry.blob.arrayBuffer());
    const checksum = crc32(bytes);
    const localHeader = localZipHeader(nameBytes.length, checksum, bytes.length);
    const centralHeader = centralZipHeader(nameBytes.length, checksum, bytes.length, localOffset);
    localParts.push(localHeader, nameBytes.buffer.slice(nameBytes.byteOffset, nameBytes.byteOffset + nameBytes.byteLength), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    centralParts.push(centralHeader, nameBytes.buffer.slice(nameBytes.byteOffset, nameBytes.byteOffset + nameBytes.byteLength));
    localOffset += 30 + nameBytes.length + bytes.length;
    centralSize += 46 + nameBytes.length;
    if (localOffset > UINT32_MAX || centralSize > UINT32_MAX) {
      throw new ImageToolError('ZIP_LIMIT_EXCEEDED', 'ZIP64 is not supported.');
    }
  }

  return new Blob(
    [...localParts, ...centralParts, endOfCentralDirectory(entries.length, centralSize, localOffset)],
    { type: 'application/zip' },
  );
}
