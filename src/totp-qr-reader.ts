const zxingReaderWasmUrl = new URL("./vendor/zxing-wasm/zxing_reader.wasm", import.meta.url).href;

type ZXingReadResult = {
  text?: string;
  format?: string;
  symbology?: string;
};

type ZXingReaderModule = {
  prepareZXingModule: (options: {
    overrides: {
      wasmBinary?: Uint8Array;
      locateFile?: (path: string, prefix: string) => string;
    };
  }) => Promise<unknown> | unknown;
  readBarcodes: (
    image: Blob | ArrayBuffer | Uint8Array | ImageData,
    options?: {
      formats?: string[];
      tryHarder?: boolean;
      maxNumberOfSymbols?: number;
    },
  ) => Promise<ZXingReadResult[]>;
};

let zxingReaderPromise: Promise<ZXingReaderModule> | null = null;

async function loadZxingReader() {
  if (!zxingReaderPromise) {
    zxingReaderPromise = (async () => {
      const wasmResponse = await fetch(zxingReaderWasmUrl);
      if (!wasmResponse.ok) {
        throw new Error("Não foi possível carregar o leitor local de QR Code.");
      }

      const wasmBinary = new Uint8Array(await wasmResponse.arrayBuffer());

      // @ts-expect-error O leitor ZXing está vendorizado como ESM puro, sem declarações TypeScript.
      const module = (await import("./vendor/zxing-wasm/reader/index.js")) as ZXingReaderModule;

      await module.prepareZXingModule({
        overrides: {
          wasmBinary,
          locateFile: (path) => {
            if (path.endsWith(".wasm")) return zxingReaderWasmUrl;
            return path;
          },
        },
      });

      return module;
    })();
  }

  return zxingReaderPromise;
}

async function decodeQrWithBarcodeDetector(file: File): Promise<string | null> {
  const maybeBarcodeDetector = window as Window & {
    BarcodeDetector?: new (options?: { formats?: string[] }) => {
      detect: (source: ImageBitmap) => Promise<Array<{ rawValue?: string }>>;
    };
  };

  if (!maybeBarcodeDetector.BarcodeDetector) return null;

  const bitmap = await createImageBitmap(file);
  try {
    const detector = new maybeBarcodeDetector.BarcodeDetector({ formats: ["qr_code"] });
    const results = await detector.detect(bitmap);
    const payload = results
      .map((result) => result.rawValue?.trim() ?? "")
      .find((value) => value.length > 0);

    return payload ?? null;
  } finally {
    bitmap.close();
  }
}

export async function decodeQrFromImageFile(file: File): Promise<string> {
  const browserPayload = await decodeQrWithBarcodeDetector(file);
  if (browserPayload) return browserPayload;

  const reader = await loadZxingReader();
  const results = await reader.readBarcodes(file, {
    formats: ["QRCode"],
    tryHarder: true,
    maxNumberOfSymbols: 1,
  });

  const payload = results
    .map((result) => result.text?.trim() ?? "")
    .find((value) => value.length > 0);

  if (!payload) {
    throw new Error("QR Code não encontrado.");
  }

  return payload;
}
