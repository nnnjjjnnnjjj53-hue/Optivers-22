import {
  ProcessGlassesImageOptions,
  ProcessedGlassesResult,
  processGlassesImage,
} from './glassesImagePipeline';
import type { GlassesWorkerRequest, GlassesWorkerResponse } from '../workers/glassesImage.worker';

type PendingEntry = {
  resolve: (res: ProcessedGlassesResult) => void;
  reject: (err: Error) => void;
  onStage?: (label: string) => void;
};

let sharedWorker: Worker | null = null;
const pendingMap = new Map<string, PendingEntry>();

function canUseModuleWorker(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
}

function getSharedWorker(): Worker | null {
  if (!canUseModuleWorker()) return null;
  if (sharedWorker) return sharedWorker;
  try {
    const worker = new Worker(new URL('../workers/glassesImage.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (ev: MessageEvent<GlassesWorkerResponse>) => {
      const msg = ev.data;
      const entry = pendingMap.get(msg.id);
      if (!entry) return;
      if (msg.kind === 'stage') {
        entry.onStage?.(msg.stageLabelAr);
      } else if (msg.kind === 'done') {
        pendingMap.delete(msg.id);
        entry.resolve(msg.result);
      } else if (msg.kind === 'error') {
        pendingMap.delete(msg.id);
        entry.reject(new Error(msg.message));
      }
    };
    worker.onerror = () => {
      // Terminate broken worker and reject any active tasks cleanly so fallback can recover
      for (const [id, entry] of pendingMap.entries()) {
        pendingMap.delete(id);
        entry.reject(new Error('تعذر تشغيل معالج الصور الخلفي'));
      }
      try {
        worker.terminate();
      } catch {
        // ignore
      }
      sharedWorker = null;
    };
    sharedWorker = worker;
    return worker;
  } catch {
    return null;
  }
}

export async function processGlassesImageInWorker(
  file: Blob,
  options: ProcessGlassesImageOptions = {}
): Promise<ProcessedGlassesResult> {
  const worker = getSharedWorker();
  if (!worker) {
    return processGlassesImage(file, options);
  }

  const { onStage, ...serializableOpts } = options;
  const id = `gi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    return await new Promise<ProcessedGlassesResult>((resolve, reject) => {
      pendingMap.set(id, { resolve, reject, onStage });
      const payload: GlassesWorkerRequest = { id, file, options: serializableOpts };
      worker.postMessage(payload);
    });
  } catch {
    // Graceful main-thread fallback if worker runtime is unavailable in current browser context
    return processGlassesImage(file, options);
  }
}

export function resetGlassesWorker(): void {
  if (sharedWorker) {
    try {
      sharedWorker.terminate();
    } catch {
      // ignore
    }
    sharedWorker = null;
  }
  pendingMap.clear();
}
