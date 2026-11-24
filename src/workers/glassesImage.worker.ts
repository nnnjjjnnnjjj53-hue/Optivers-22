import {
  ProcessGlassesImageOptions,
  ProcessedGlassesResult,
  processGlassesImage,
} from '../utils/glassesImagePipeline';

export interface GlassesWorkerRequest {
  id: string;
  file: Blob;
  options: Omit<ProcessGlassesImageOptions, 'onStage'>;
}

export type GlassesWorkerResponse =
  | { id: string; kind: 'stage'; stageLabelAr: string }
  | { id: string; kind: 'done'; result: ProcessedGlassesResult }
  | { id: string; kind: 'error'; message: string };

const workerScope = globalThis as unknown as {
  onmessage: ((ev: MessageEvent<GlassesWorkerRequest>) => void) | null;
  postMessage: (msg: GlassesWorkerResponse) => void;
};

let chain = Promise.resolve();

workerScope.onmessage = (ev: MessageEvent<GlassesWorkerRequest>) => {
  const { id, file, options } = ev.data;
  chain = chain.then(async () => {
    try {
      const result = await processGlassesImage(file, {
        ...options,
        onStage: (stageLabelAr) => {
          workerScope.postMessage({ id, kind: 'stage', stageLabelAr });
        },
      });
      workerScope.postMessage({ id, kind: 'done', result });
    } catch (err) {
      workerScope.postMessage({
        id,
        kind: 'error',
        message: err instanceof Error ? err.message : 'تعذر معالجة الصورة',
      });
    }
  });
};
