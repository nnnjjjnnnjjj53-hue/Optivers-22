import { useEffect, useState } from 'react';
import { Product } from '../types';

export type MemoryTier = 'high' | 'medium' | 'low';

export interface CameraProbeResult {
  supported: boolean;
  hasVideoInput: boolean;
  permissionState: 'granted' | 'prompt' | 'denied' | 'unknown';
}

export interface DeviceCapabilitiesSnapshot {
  webglSupported: boolean;
  webglVersion: 0 | 1 | 2;
  isHardwareWebGL: boolean;
  maxTextureSize: number;
  rendererLabel: string;
  deviceMemoryGb: number | null;
  cpuCores: number | null;
  saveData: boolean;
  memoryTier: MemoryTier;
  cameraApiSupported: boolean;
  cameraAvailable: boolean | null;
  cameraPermission: 'granted' | 'prompt' | 'denied' | 'unknown';
  runtimeWebglFaulted: boolean;
  is3DCapable: boolean;
}

const SOFTWARE_GL_RE = /SwiftShader|llvmpipe|softpipe|Software|Basic Render|Microsoft Basic/i;
const VALID_GLB_EXT_RE = /\.(glb|gltf)(\?|#|$)/i;

let cachedSnapshot: DeviceCapabilitiesSnapshot | null = null;
let runtimeFaultFlag = false;
const faultListeners = new Set<() => void>();

export function reportRuntimeWebglFault(): void {
  if (runtimeFaultFlag) return;
  runtimeFaultFlag = true;
  if (cachedSnapshot) {
    cachedSnapshot = {
      ...cachedSnapshot,
      runtimeWebglFaulted: true,
      is3DCapable: false,
    };
  }
  faultListeners.forEach((fn) => fn());
}

export function resetRuntimeWebglFaultForTests(): void {
  runtimeFaultFlag = false;
  cachedSnapshot = null;
}

export function evaluateCapabilitiesSnapshot(input: {
  webglSupported: boolean;
  webglVersion: 0 | 1 | 2;
  isHardwareWebGL: boolean;
  maxTextureSize: number;
  rendererLabel?: string;
  deviceMemoryGb: number | null;
  cpuCores: number | null;
  saveData: boolean;
  cameraApiSupported: boolean;
  cameraAvailable?: boolean | null;
  cameraPermission?: 'granted' | 'prompt' | 'denied' | 'unknown';
  runtimeWebglFaulted?: boolean;
}): DeviceCapabilitiesSnapshot {
  const {
    webglSupported,
    webglVersion,
    isHardwareWebGL,
    maxTextureSize,
    rendererLabel = '',
    deviceMemoryGb,
    cpuCores,
    saveData,
    cameraApiSupported,
    cameraAvailable = null,
    cameraPermission = 'unknown',
    runtimeWebglFaulted = false,
  } = input;

  const isLowRam = deviceMemoryGb !== null && deviceMemoryGb <= 2;
  const isLowCpu = cpuCores !== null && cpuCores <= 2;
  const isSmallGpu = maxTextureSize > 0 && maxTextureSize < 2048;

  let memoryTier: MemoryTier = 'medium';
  if (saveData || isLowRam || isLowCpu || !webglSupported || !isHardwareWebGL || isSmallGpu) {
    memoryTier = 'low';
  } else if (
    (deviceMemoryGb === null || deviceMemoryGb >= 4) &&
    (cpuCores === null || cpuCores >= 4) &&
    webglVersion === 2 &&
    maxTextureSize >= 4096
  ) {
    memoryTier = 'high';
  }

  const is3DCapable =
    webglSupported &&
    isHardwareWebGL &&
    !runtimeWebglFaulted &&
    memoryTier !== 'low' &&
    !saveData;

  return {
    webglSupported,
    webglVersion,
    isHardwareWebGL,
    maxTextureSize,
    rendererLabel,
    deviceMemoryGb,
    cpuCores,
    saveData,
    memoryTier,
    cameraApiSupported,
    cameraAvailable,
    cameraPermission,
    runtimeWebglFaulted,
    is3DCapable,
  };
}

function probeWebGLContext(): {
  webglSupported: boolean;
  webglVersion: 0 | 1 | 2;
  isHardwareWebGL: boolean;
  maxTextureSize: number;
  rendererLabel: string;
} {
  if (typeof document === 'undefined') {
    return {
      webglSupported: false,
      webglVersion: 0,
      isHardwareWebGL: false,
      maxTextureSize: 0,
      rendererLabel: 'ssr',
    };
  }

  try {
    const canvas = document.createElement('canvas');
    let webglVersion: 0 | 1 | 2 = 0;
    let gl: WebGLRenderingContext | WebGL2RenderingContext | null = canvas.getContext('webgl2', {
      failIfMajorPerformanceCaveat: false,
    }) as WebGL2RenderingContext | null;
    if (gl) {
      webglVersion = 2;
    } else {
      gl =
        (canvas.getContext('webgl') as WebGLRenderingContext | null) ||
        (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);
      if (gl) webglVersion = 1;
    }

    if (!gl) {
      return {
        webglSupported: false,
        webglVersion: 0,
        isHardwareWebGL: false,
        maxTextureSize: 0,
        rendererLabel: 'none',
      };
    }

    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const rendererLabel = String(gl.getParameter(param) || '');
    const maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0);
    const isHardwareWebGL = !SOFTWARE_GL_RE.test(rendererLabel);

    gl.getExtension('WEBGL_lose_context')?.loseContext();

    return {
      webglSupported: true,
      webglVersion,
      isHardwareWebGL,
      maxTextureSize,
      rendererLabel,
    };
  } catch {
    return {
      webglSupported: false,
      webglVersion: 0,
      isHardwareWebGL: false,
      maxTextureSize: 0,
      rendererLabel: 'error',
    };
  }
}

export function detectDeviceCapabilities(forceRefresh = false): DeviceCapabilitiesSnapshot {
  if (cachedSnapshot && !forceRefresh) {
    return cachedSnapshot;
  }

  const webgl = probeWebGLContext();
  const nav = typeof navigator !== 'undefined' ? (navigator as unknown as {
    deviceMemory?: number;
    hardwareConcurrency?: number;
    connection?: { saveData?: boolean };
    mediaDevices?: MediaDevices;
  }) : undefined;

  const deviceMemoryGb = typeof nav?.deviceMemory === 'number' && nav.deviceMemory > 0 ? nav.deviceMemory : null;
  const cpuCores =
    typeof nav?.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0 ? nav.hardwareConcurrency : null;
  const saveData = Boolean(nav?.connection?.saveData);
  const cameraApiSupported = Boolean(nav?.mediaDevices?.getUserMedia);

  cachedSnapshot = evaluateCapabilitiesSnapshot({
    ...webgl,
    deviceMemoryGb,
    cpuCores,
    saveData,
    cameraApiSupported,
    cameraAvailable: cachedSnapshot?.cameraAvailable ?? null,
    cameraPermission: cachedSnapshot?.cameraPermission ?? 'unknown',
    runtimeWebglFaulted: runtimeFaultFlag,
  });

  return cachedSnapshot;
}

export async function probeCameraHardware(): Promise<CameraProbeResult> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { supported: false, hasVideoInput: false, permissionState: 'denied' };
  }

  let permissionState: 'granted' | 'prompt' | 'denied' | 'unknown' = 'unknown';
  try {
    if (navigator.permissions?.query) {
      const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
      if (status.state === 'granted' || status.state === 'prompt' || status.state === 'denied') {
        permissionState = status.state;
      }
    }
  } catch {
    // Permissions API not supported for camera in some browsers (e.g. Safari/iOS)
  }

  let hasVideoInput = true;
  try {
    if (navigator.mediaDevices.enumerateDevices) {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter((d) => d.kind === 'videoinput');
      // If enumerateDevices returns any entries, check explicitly for a camera
      if (devices.length > 0) {
        hasVideoInput = cams.length > 0;
      }
    }
  } catch {
    hasVideoInput = true;
  }

  if (cachedSnapshot) {
    cachedSnapshot = {
      ...cachedSnapshot,
      cameraAvailable: hasVideoInput && permissionState !== 'denied',
      cameraPermission: permissionState,
    };
  }

  return {
    supported: true,
    hasVideoInput,
    permissionState,
  };
}

/**
 * Checks whether a product actually has a valid GLB/glTF 3D model URL.
 */
export function hasProductGlb(product?: Pick<Product, 'tryonMode' | 'model3dUrl' | 'glbUrl'>): boolean {
  if (!product) return false;
  const raw = (product.model3dUrl || product.glbUrl || '').trim();
  if (!raw || raw === 'undefined' || raw === 'null') return false;
  if (raw.startsWith('blob:') || raw.startsWith('data:model/') || raw.startsWith('data:application/octet-stream')) {
    return true;
  }
  if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('/')) {
    // Allow signed storage URLs or direct .glb/.gltf paths
    return VALID_GLB_EXT_RE.test(raw) || raw.includes('frames/') || raw.includes('model');
  }
  return VALID_GLB_EXT_RE.test(raw);
}

/**
 * Smart Engine Router:
 * - Returns '3d' ONLY when product is configured as 3D with a real GLB model AND device is capable (hardware WebGL + sufficient RAM/CPU).
 * - Silently falls back to '2d' on weak devices, software renderers, missing GLB, or 2D products with zero technical error popups.
 */
export function resolveEffectiveTryOnEngine(
  product: Pick<Product, 'tryonMode' | 'model3dUrl' | 'glbUrl'> | undefined,
  caps: Pick<DeviceCapabilitiesSnapshot, 'is3DCapable'>,
  sessionGlbFailed = false
): '3d' | '2d' {
  if (!product) return '2d';
  if (product.tryonMode !== '3d') return '2d';
  if (!hasProductGlb(product)) return '2d';
  if (!caps.is3DCapable || sessionGlbFailed) return '2d';
  return '3d';
}

export function useDeviceCapabilities(): DeviceCapabilitiesSnapshot {
  const [snapshot, setSnapshot] = useState<DeviceCapabilitiesSnapshot>(() => detectDeviceCapabilities());

  useEffect(() => {
    let active = true;
    const syncFault = () => {
      if (!active) return;
      setSnapshot(detectDeviceCapabilities(true));
    };
    faultListeners.add(syncFault);

    probeCameraHardware().then((cam) => {
      if (!active) return;
      setSnapshot((prev) => ({
        ...prev,
        cameraApiSupported: cam.supported,
        cameraAvailable: cam.supported && cam.hasVideoInput && cam.permissionState !== 'denied',
        cameraPermission: cam.permissionState,
      }));
    });

    return () => {
      active = false;
      faultListeners.delete(syncFault);
    };
  }, []);

  return snapshot;
}
