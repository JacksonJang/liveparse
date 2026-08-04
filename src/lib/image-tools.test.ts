import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_FILES,
  MAX_IMAGE_FILE_BYTES,
  MAX_IMAGE_PIXELS,
  MAX_IMAGE_TOTAL_BYTES,
  ImageToolError,
  calculateResizeGeometry,
  createZipBlob,
  crc32,
  detectAnimatedImage,
  formatBytes,
  probeImage,
  processImage,
  safeOutputName,
  sniffImageMime,
  targetKilobytesToBytes,
  validateImageBatch,
} from './image-tools';

function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function asciiBytes(value: string): Uint8Array {
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

function blobFromBytes(bytes: Uint8Array, type = ''): Blob {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type });
}

function uint16BE(value: number): Uint8Array {
  return new Uint8Array([(value >>> 8) & 0xff, value & 0xff]);
}

function uint32BE(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function uint32LE(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

function uint24LE(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff]);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  return concatBytes(uint32BE(data.length), asciiBytes(type), data, new Uint8Array(4));
}

function pngFixture(width: number, height: number, animated = false): Uint8Array {
  const header = concatBytes(
    uint32BE(width),
    uint32BE(height),
    new Uint8Array([8, 6, 0, 0, 0]),
  );
  const animation = animated
    ? pngChunk('acTL', concatBytes(uint32BE(2), uint32BE(0)))
    : new Uint8Array();
  return concatBytes(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    animation,
    pngChunk('IEND', new Uint8Array()),
  );
}

function jpegFixture(width: number, height: number): Uint8Array {
  return concatBytes(
    new Uint8Array([0xff, 0xd8]),
    new Uint8Array([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]),
    new Uint8Array([0xff, 0xc0, 0x00, 0x11, 0x08]),
    uint16BE(height),
    uint16BE(width),
    new Uint8Array([0x03, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]),
    new Uint8Array([0xff, 0xd9]),
  );
}

function webpChunk(type: string, data: Uint8Array): Uint8Array {
  return concatBytes(
    asciiBytes(type),
    uint32LE(data.length),
    data,
    data.length % 2 === 0 ? new Uint8Array() : new Uint8Array(1),
  );
}

function webpFixture(...chunks: readonly Uint8Array[]): Uint8Array {
  const body = concatBytes(...chunks);
  return concatBytes(asciiBytes('RIFF'), uint32LE(4 + body.length), asciiBytes('WEBP'), body);
}

function vp8xFixture(width: number, height: number, animated = false): Uint8Array {
  return webpFixture(webpChunk('VP8X', concatBytes(
    new Uint8Array([animated ? 0x02 : 0, 0, 0, 0]),
    uint24LE(width - 1),
    uint24LE(height - 1),
  )));
}

function vp8Fixture(width: number, height: number): Uint8Array {
  return webpFixture(webpChunk('VP8 ', new Uint8Array([
    0, 0, 0,
    0x9d, 0x01, 0x2a,
    width & 0xff, (width >>> 8) & 0x3f,
    height & 0xff, (height >>> 8) & 0x3f,
  ])));
}

function vp8lFixture(width: number, height: number): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  return webpFixture(webpChunk('VP8L', new Uint8Array([
    0x2f,
    w & 0xff,
    ((w >>> 8) & 0x3f) | ((h & 0x03) << 6),
    (h >>> 2) & 0xff,
    (h >>> 10) & 0x0f,
  ])));
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)
  ) >>> 0;
}

function paddedFixture(mime: 'image/jpeg' | 'image/png' | 'image/webp', width: number, height: number, size: number): Uint8Array {
  const header = mime === 'image/jpeg'
    ? jpegFixture(width, height)
    : mime === 'image/png'
      ? pngFixture(width, height)
      : vp8xFixture(width, height);
  const output = new Uint8Array(Math.max(size, header.length));
  output.set(header);
  return output;
}

function installCanvasMocks(options: { forcedMime?: 'image/jpeg' | 'image/png' | 'image/webp' } = {}) {
  const close = vi.fn();
  const qualities: Array<number | undefined> = [];
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 20, height: 20, close })));
  vi.stubGlobal('document', {
    createElement: vi.fn((name: string) => {
      if (name !== 'canvas') throw new Error(`Unexpected element: ${name}`);
      const canvas = {
        width: 300,
        height: 150,
        getContext: vi.fn(() => ({
          fillStyle: '#000000',
          fillRect: vi.fn(),
          save: vi.fn(),
          restore: vi.fn(),
          drawImage: vi.fn(),
        })),
        toBlob: vi.fn((callback: (blob: Blob | null) => void, requestedMime: string, quality?: number) => {
          qualities.push(quality);
          const actualMime = options.forcedMime ?? requestedMime as 'image/jpeg' | 'image/png' | 'image/webp';
          const multiplier = actualMime === 'image/png' ? 1 : Math.max(0.05, quality ?? 0.92);
          const modeledSize = Math.ceil(canvas.width * canvas.height * multiplier);
          callback(blobFromBytes(paddedFixture(actualMime, canvas.width, canvas.height, modeledSize), actualMime));
        }),
      };
      return canvas;
    }),
  });
  return { close, qualities };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function errorCode(callback: () => unknown): string | undefined {
  try {
    callback();
  } catch (error) {
    return error instanceof ImageToolError ? error.code : undefined;
  }
  return undefined;
}

describe('image byte validation and probing', () => {
  it('identifies JPEG, PNG, and WebP by magic bytes instead of the declared MIME', async () => {
    const jpeg = jpegFixture(640, 480);
    const png = pngFixture(320, 200);
    const webp = vp8xFixture(123, 456);

    expect(sniffImageMime(jpeg)).toBe('image/jpeg');
    expect(sniffImageMime(png)).toBe('image/png');
    expect(sniffImageMime(webp)).toBe('image/webp');
    expect(sniffImageMime(asciiBytes('not an image'))).toBeNull();

    const deliberatelyMislabelled = blobFromBytes(jpeg, 'image/png');
    await expect(probeImage(deliberatelyMislabelled)).resolves.toMatchObject({
      mime: 'image/jpeg',
      width: 640,
      height: 480,
      pixels: 307_200,
      animated: false,
    });
  });

  it('reads dimensions from PNG and every common WebP bitstream header', async () => {
    const fixtures = [
      [pngFixture(901, 602), 'image/png', 901, 602],
      [vp8xFixture(16_384, 1), 'image/webp', 16_384, 1],
      [vp8Fixture(1_024, 769), 'image/webp', 1_024, 769],
      [vp8lFixture(4_095, 2_049), 'image/webp', 4_095, 2_049],
    ] as const;

    for (const [bytes, mime, width, height] of fixtures) {
      await expect(probeImage(blobFromBytes(bytes))).resolves.toMatchObject({ mime, width, height });
    }
  });

  it('detects APNG and animated WebP without treating static images as animated', () => {
    const apng = pngFixture(20, 10, true);
    const animatedVp8x = vp8xFixture(20, 10, true);
    const animChunkWebp = webpFixture(
      webpChunk('VP8X', concatBytes(new Uint8Array(4), uint24LE(19), uint24LE(9))),
      webpChunk('ANIM', new Uint8Array(6)),
    );

    expect(detectAnimatedImage(apng, 'image/png')).toBe(true);
    expect(detectAnimatedImage(pngFixture(20, 10), 'image/png')).toBe(false);
    expect(detectAnimatedImage(animatedVp8x, 'image/webp')).toBe(true);
    expect(detectAnimatedImage(animChunkWebp, 'image/webp')).toBe(true);
    expect(detectAnimatedImage(vp8lFixture(20, 10), 'image/webp')).toBe(false);
    expect(detectAnimatedImage(jpegFixture(20, 10), 'image/jpeg')).toBe(false);
  });

  it('rejects unsupported, malformed, oversized-dimension, and excessive-pixel inputs', async () => {
    await expect(probeImage(blobFromBytes(asciiBytes('GIF89a')))).rejects.toMatchObject({
      code: 'UNSUPPORTED_FORMAT',
    });
    await expect(probeImage(blobFromBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])))).rejects.toMatchObject({
      code: 'INVALID_IMAGE',
    });
    await expect(probeImage(blobFromBytes(pngFixture(MAX_IMAGE_DIMENSION + 1, 1)))).rejects.toMatchObject({
      code: 'DIMENSIONS_TOO_LARGE',
    });
    await expect(probeImage(blobFromBytes(pngFixture(10_000, 5_000)))).rejects.toMatchObject({
      code: 'PIXELS_TOO_LARGE',
    });
  });
});

describe('image limits and option units', () => {
  it('exports the documented binary limits', () => {
    expect(MAX_IMAGE_FILE_BYTES).toBe(25 * 1024 * 1024);
    expect(MAX_IMAGE_TOTAL_BYTES).toBe(100 * 1024 * 1024);
    expect(MAX_IMAGE_FILES).toBe(20);
    expect(MAX_IMAGE_PIXELS).toBe(40_000_000);
    expect(MAX_IMAGE_DIMENSION).toBe(16_384);
  });

  it('enforces per-file, aggregate, and file-count limits before processing', () => {
    expect(() => validateImageBatch([{ size: MAX_IMAGE_FILE_BYTES }])).not.toThrow();
    expect(errorCode(() => validateImageBatch([{ size: MAX_IMAGE_FILE_BYTES + 1 }]))).toBe('FILE_TOO_LARGE');
    expect(errorCode(() => validateImageBatch(
      Array.from({ length: MAX_IMAGE_FILES + 1 }, () => ({ size: 0 })),
    ))).toBe('TOO_MANY_FILES');
    expect(errorCode(() => validateImageBatch(
      Array.from({ length: 5 }, () => ({ size: MAX_IMAGE_FILE_BYTES })),
    ))).toBe('TOTAL_TOO_LARGE');
  });

  it('uses 1 KB = 1024 bytes and formats binary units predictably', () => {
    expect(targetKilobytesToBytes(1)).toBe(1_024);
    expect(targetKilobytesToBytes(1.5)).toBe(1_536);
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1_023)).toBe('1,023 B');
    expect(formatBytes(1_024)).toBe('1 KB');
    expect(formatBytes(1_536)).toBe('1.5 KB');
    expect(formatBytes(1_048_576)).toBe('1 MB');
    expect(() => targetKilobytesToBytes(0)).toThrow(/positive/);
    expect(() => formatBytes(Number.NaN)).toThrow(/non-negative/);
  });
});

describe('resize geometry', () => {
  it('contains within one or two requested bounds while preserving aspect ratio', () => {
    expect(calculateResizeGeometry(400, 200, 100, 100)).toEqual({
      width: 100,
      height: 50,
      sourceX: 0,
      sourceY: 0,
      sourceWidth: 400,
      sourceHeight: 200,
    });
    expect(calculateResizeGeometry(400, 200, undefined, 25)).toMatchObject({ width: 50, height: 25 });
  });

  it('does not upscale unless explicitly allowed', () => {
    expect(calculateResizeGeometry(100, 50, 400, 400)).toMatchObject({ width: 100, height: 50 });
    expect(calculateResizeGeometry(100, 50, 400, 400, 'contain', true)).toMatchObject({
      width: 400,
      height: 200,
    });
  });

  it('computes centered cover crops and respects no-upscale', () => {
    expect(calculateResizeGeometry(400, 200, 100, 100, 'cover')).toEqual({
      width: 100,
      height: 100,
      sourceX: 100,
      sourceY: 0,
      sourceWidth: 200,
      sourceHeight: 200,
    });
    expect(calculateResizeGeometry(100, 50, 200, 200, 'cover')).toEqual({
      width: 50,
      height: 50,
      sourceX: 25,
      sourceY: 0,
      sourceWidth: 50,
      sourceHeight: 50,
    });
  });

  it('rejects invalid requests and output pixel counts', () => {
    expect(() => calculateResizeGeometry(100, 100, 0, 50)).toThrow(/Width/);
    expect(() => calculateResizeGeometry(100, 100, 50, 50, 'stretch' as 'cover')).toThrow(/mode/);
    expect(() => calculateResizeGeometry(100, 100, 10_000, 10_000, 'cover', true)).toThrow(/pixels/);
  });
});

describe('safe output names', () => {
  it.each([
    ['photo.jpeg', 'image/jpeg', '-compressed', 'photo-compressed.jpg'],
    ['archive.tar.gz', 'image/png', '-processed', 'archive.tar-processed.png'],
    ['../../CON?.png', 'image/jpeg', '-converted', 'image-CON-converted.jpg'],
    ['C:\\temp\\ 보고서 2026.PNG', 'image/webp', '', '보고서 2026.webp'],
    ['', 'image/png', '', 'image.png'],
  ] as const)('sanitizes %j to %j', (name, mime, suffix, expected) => {
    expect(safeOutputName(name, mime, suffix)).toBe(expected);
  });

  it('removes control/path characters and bounds the UTF-16 file-name length', () => {
    const output = safeOutputName(`../${'a'.repeat(300)}\u0000?.png`, 'image/png');
    expect(output).not.toMatch(/[\\/\u0000?]/);
    expect(output.length).toBeLessThanOrEqual(120);
    expect(output).toMatch(/-processed\.png$/);
  });
});

describe('STORE ZIP writer', () => {
  it('computes the standard CRC-32 check value', () => {
    expect(crc32(new TextEncoder().encode('hello'))).toBe(0x3610_a686);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('writes valid local, central, and EOCD headers with UTF-8 names and CRCs', async () => {
    const hello = new TextEncoder().encode('hello');
    const world = new TextEncoder().encode('world!');
    const zip = await createZipBlob([
      { name: '../보고서.txt', blob: blobFromBytes(hello) },
      { name: '../보고서.txt', blob: blobFromBytes(world) },
    ]);
    const bytes = new Uint8Array(await zip.arrayBuffer());
    const decoder = new TextDecoder();

    expect(zip.type).toBe('application/zip');
    expect(readUint32LE(bytes, 0)).toBe(0x0403_4b50);
    expect(readUint16LE(bytes, 6)).toBe(0x0800);
    expect(readUint16LE(bytes, 8)).toBe(0);
    expect(readUint32LE(bytes, 14)).toBe(crc32(hello));
    expect(readUint32LE(bytes, 18)).toBe(hello.length);
    expect(readUint32LE(bytes, 22)).toBe(hello.length);

    const firstNameLength = readUint16LE(bytes, 26);
    const firstName = decoder.decode(bytes.subarray(30, 30 + firstNameLength));
    expect(firstName).toBe('보고서.txt');
    expect(bytes.subarray(30 + firstNameLength, 30 + firstNameLength + hello.length)).toEqual(hello);

    const secondOffset = 30 + firstNameLength + hello.length;
    expect(readUint32LE(bytes, secondOffset)).toBe(0x0403_4b50);
    const secondNameLength = readUint16LE(bytes, secondOffset + 26);
    const secondName = decoder.decode(bytes.subarray(secondOffset + 30, secondOffset + 30 + secondNameLength));
    expect(secondName).toBe('보고서 (2).txt');
    expect(readUint32LE(bytes, secondOffset + 14)).toBe(crc32(world));

    const centralOffset = secondOffset + 30 + secondNameLength + world.length;
    expect(readUint32LE(bytes, centralOffset)).toBe(0x0201_4b50);
    expect(readUint32LE(bytes, centralOffset + 42)).toBe(0);

    const eocdOffset = bytes.length - 22;
    expect(readUint32LE(bytes, eocdOffset)).toBe(0x0605_4b50);
    expect(readUint16LE(bytes, eocdOffset + 8)).toBe(2);
    expect(readUint16LE(bytes, eocdOffset + 10)).toBe(2);
    expect(readUint32LE(bytes, eocdOffset + 16)).toBe(centralOffset);
  });

  it('rejects empty, malformed, excessive-count, and excessive-size entry sets', async () => {
    await expect(createZipBlob([])).rejects.toMatchObject({ code: 'INVALID_ZIP_ENTRY' });
    await expect(createZipBlob([
      { name: 'broken', blob: null as unknown as Blob },
    ])).rejects.toMatchObject({ code: 'INVALID_ZIP_ENTRY' });
    await expect(createZipBlob(Array.from({ length: MAX_IMAGE_FILES + 1 }, (_, index) => ({
      name: `${index}.txt`,
      blob: new Blob(),
    })))).rejects.toMatchObject({ code: 'ZIP_LIMIT_EXCEEDED' });
    const oversized = new Blob();
    Object.defineProperty(oversized, 'size', { value: MAX_IMAGE_FILE_BYTES + 1 });
    await expect(createZipBlob([{ name: 'large.bin', blob: oversized }])).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
    });
  });
});

describe('processing guards that do not require a browser canvas', () => {
  it('preserves the exact original when same-format compression already meets the target', async () => {
    const blob = blobFromBytes(pngFixture(12, 7), 'application/octet-stream');
    Object.defineProperty(blob, 'name', { value: 'photo.PNG' });
    const result = await processImage(blob, { mode: 'compress', targetBytes: blob.size });

    expect(result.blob).toBe(blob);
    expect(result).toMatchObject({
      mime: 'image/png',
      width: 12,
      height: 7,
      outputBytes: blob.size,
      targetBytes: blob.size,
      metTarget: true,
      originalPreserved: true,
      metadataStripped: false,
      quality: null,
      fileName: 'photo.png',
    });
  });

  it('rejects animation before decoding and honors an already-aborted job', async () => {
    await expect(processImage(blobFromBytes(pngFixture(12, 7, true)), {
      mode: 'convert',
      outputMime: 'image/jpeg',
    })).rejects.toMatchObject({ code: 'ANIMATED_IMAGE' });

    const controller = new AbortController();
    controller.abort();
    await expect(processImage(blobFromBytes(pngFixture(12, 7)), {
      mode: 'compress',
      targetBytes: 1,
    }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('browser encoding contract with deterministic canvas doubles', () => {
  it('converts to the requested format and closes the decoded bitmap', async () => {
    const { close, qualities } = installCanvasMocks();
    const result = await processImage(blobFromBytes(pngFixture(20, 20)), {
      mode: 'convert',
      outputMime: 'image/webp',
      quality: 0.8,
    });

    expect(result).toMatchObject({
      mime: 'image/webp',
      width: 20,
      height: 20,
      quality: 0.8,
      metTarget: true,
      originalPreserved: false,
      metadataStripped: true,
    });
    expect(sniffImageMime(new Uint8Array(await result.blob.slice(0, 16).arrayBuffer()))).toBe('image/webp');
    expect(qualities).toEqual([0.8]);
    expect(close).toHaveBeenCalledOnce();
  });

  it('returns the closest encoded result with an explicit warning when an extreme target is unreachable', async () => {
    const { close } = installCanvasMocks();
    const result = await processImage(blobFromBytes(jpegFixture(20, 20)), {
      mode: 'compress',
      outputMime: 'image/jpeg',
      targetBytes: 1,
      quality: 0.9,
    });

    expect(result.outputBytes).toBeGreaterThan(1);
    expect(result.metTarget).toBe(false);
    expect(result.width).toBeGreaterThanOrEqual(1);
    expect(result.height).toBeGreaterThanOrEqual(1);
    expect(result.warnings.some((warning) => /does not reach the 1 B target/i.test(warning))).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects a browser encoder fallback that silently returns the wrong image MIME', async () => {
    const { close } = installCanvasMocks({ forcedMime: 'image/png' });
    await expect(processImage(blobFromBytes(pngFixture(20, 20)), {
      mode: 'convert',
      outputMime: 'image/jpeg',
      quality: 0.8,
    })).rejects.toMatchObject({ code: 'OUTPUT_FORMAT_UNSUPPORTED' });
    expect(close).toHaveBeenCalledOnce();
  });
});
