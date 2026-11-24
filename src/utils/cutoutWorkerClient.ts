import {
  CutoutWorkerOptions,
  CutoutWorkerOutput,
  CutoutWorkerRequest,
  CutoutWorkerResponse,
  processCutoutFrame,
} from '../workers/cutoutWorker';

type PendingTask = {
  resolve: (res: CutoutWorkerOutput) => void;
  reject: (err: Error) => void;
  onStage?: (label: string) => void;
};

let cutoutWorker: Worker | null = null;
const pending = new Map<string, PendingTask>();

function canRunCutoutWorker(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
}

function getCutoutWorker(): Worker | null {
  if (!canRunCutoutWorker()) return null;
  if (cutoutWorker) return cutoutWorker;
  try {
    const w = new Worker(new URL('../workers/cutoutWorker.ts', import.meta.url), {
      type: 'module',
    });
    w.onmessage = (ev: MessageEvent<CutoutWorkerResponse>) => {
      const msg = ev.data;
      const entry = pending.get(msg.id);
      if (!entry) return;
      if (msg.kind === 'stage') {
        entry.onStage?.(msg.stageLabelAr);
      } else if (msg.kind === 'done') {
        pending.delete(msg.id);
        entry.resolve(msg.result);
      } else if (msg.kind === 'error') {
        pending.delete(msg.id);
        entry.reject(new Error(msg.message));
      }
    };
    w.onerror = () => {
      for (const [id, entry] of pending.entries()) {
        pending.delete(id);
        entry.reject(new Error('تعذر تشغيل معالج العزل الخلفي'));
      }
      try {
        w.terminate();
      } catch {
        // ignore
      }
      cutoutWorker = null;
    };
    cutoutWorker = w;
    return w;
  } catch {
    return null;
  }
}

export async function processCutoutInWorker(
  frontFile: Blob,
  sideFile?: Blob,
  options: CutoutWorkerOptions = {},
  onStage?: (stageLabelAr: string) => void,
  splitSheetFile?: Blob
): Promise<CutoutWorkerOutput> {
  const worker = getCutoutWorker();
  if (!worker) {
    return processCutoutFrame(frontFile, sideFile, options, onStage, splitSheetFile);
  }

  const id = `cut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    return await new Promise<CutoutWorkerOutput>((resolve, reject) => {
      pending.set(id, { resolve, reject, onStage });
      const payload: CutoutWorkerRequest = { id, frontFile, sideFile, splitSheetFile, options };
      worker.postMessage(payload);
    });
  } catch {
    return processCutoutFrame(frontFile, sideFile, options, onStage, splitSheetFile);
  }
}
