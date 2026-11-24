import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { FrameCat, FrameMaterial, FrameType, LensRegionBox, ModelCalibration } from '../types';

export interface Eyewear3DBuildOptions {
  frameWidthMm?: number;
  opticalDimensions?: string;
  material?: FrameMaterial;
  cat?: FrameCat;
  type?: FrameType;
  frameColor?: string;
  lensColor?: string;
  coatingId?: string;
  wrapCurvatureDeg?: number;
  aspectRatio?: number;
  cutoutUrl?: string;
  calibration?: ModelCalibration;
}

export function detectSoftwareWebGL(gl: WebGLRenderingContext | WebGL2RenderingContext | null): boolean {
  if (!gl) return true;
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return false;
    const renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '').toLowerCase();
    return (
      renderer.includes('swiftshader') ||
      renderer.includes('llvmpipe') ||
      renderer.includes('softpipe') ||
      renderer.includes('software')
    );
  } catch {
    return false;
  }
}

export function parseOpticalDimensions(dim?: string): {
  lensMm: number;
  bridgeMm: number;
  templeMm: number;
} {
  const clean = (dim || '52-18-140').trim();
  const parts = clean.split(/[-/\s]+/).map((n) => parseFloat(n));
  const lensMm = Number.isFinite(parts[0]) && parts[0] >= 36 && parts[0] <= 70 ? parts[0] : 52;
  const bridgeMm = Number.isFinite(parts[1]) && parts[1] >= 12 && parts[1] <= 26 ? parts[1] : 18;
  const templeMm = Number.isFinite(parts[2]) && parts[2] >= 115 && parts[2] <= 165 ? parts[2] : 140;
  return { lensMm, bridgeMm, templeMm };
}

/**
 * Computes Z displacement for a given horizontal offset `x` (in Three.js units)
 * along a cylindrical 12° face-wrap arc centered at the nose bridge (0, 0, 0).
 */
export function computeWrapZ(x: number, totalWidth: number, wrapDeg = 12): number {
  const halfW = Math.max(0.25, totalWidth * 0.5);
  const clampedX = Math.max(-halfW * 1.15, Math.min(halfW * 1.15, x));
  const theta = (Math.max(4, Math.min(24, wrapDeg)) * Math.PI) / 180;
  const radius = halfW / Math.sin(theta);
  const under = Math.max(0, radius * radius - clampedX * clampedX);
  const dz = -(radius - Math.sqrt(under));
  return Math.abs(dz) < 1e-9 ? 0 : dz;
}

export interface TempleHingeAnchors {
  left: { x: number; y: number; z: number };
  right: { x: number; y: number; z: number };
  inwardOverlapUnits: number;
}

/**
 * Computes left & right 3D temple attachment anchors snapped directly to the strictly cropped frame edges
 * (`minX` and `maxX`) at upper-middle hinge height (`Y = +15%` from center) with `2mm` (`0.02` units) inward overlap.
 */
export function computeTempleHingeAnchors(
  frontWidth: number,
  frontHeight: number,
  offsetX = 0,
  offsetY = 0,
  thickness = 0.035,
  wrapDeg = 12
): TempleHingeAnchors {
  const inwardOverlapUnits = 0.02; // 2mm inward overlap into frame hinge (1 unit = 100mm)
  const leftEdgeX = -frontWidth * 0.5 + offsetX;
  const rightEdgeX = frontWidth * 0.5 + offsetX;
  const leftX = leftEdgeX + inwardOverlapUnits;
  const rightX = rightEdgeX - inwardOverlapUnits;
  const hingeY = frontHeight * 0.15 + offsetY;
  const leftZ = computeWrapZ(leftX, frontWidth, wrapDeg) - thickness * 0.2;
  const rightZ = computeWrapZ(rightX, frontWidth, wrapDeg) - thickness * 0.2;
  return {
    left: { x: leftX, y: hingeY, z: leftZ },
    right: { x: rightX, y: hingeY, z: rightZ },
    inwardOverlapUnits,
  };
}

/**
 * Bends any BufferGeometry smoothly around Y-axis using the 12° face-wrap cylindrical curve.
 */
export function applyFaceWrapCurvature(
  geometry: THREE.BufferGeometry,
  totalWidth: number,
  wrapDeg = 12
): void {
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const dz = computeWrapZ(x, totalWidth, wrapDeg);
    pos.setZ(i, z + dz);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

function makeRoundedLensShape(w: number, h: number, type: FrameType): THREE.Shape {
  const hw = w * 0.5;
  const hh = h * 0.5;
  const shape = new THREE.Shape();

  if (type === 'round') {
    shape.absellipse(0, 0, hw, hh, 0, Math.PI * 2, false, 0);
    return shape;
  }

  if (type === 'aviator') {
    shape.moveTo(-hw * 0.88, hh * 0.82);
    shape.quadraticCurveTo(0, hh * 1.02, hw * 0.9, hh * 0.78);
    shape.bezierCurveTo(hw * 1.04, hh * 0.15, hw * 0.78, -hh * 0.88, hw * 0.18, -hh * 0.96);
    shape.quadraticCurveTo(-hw * 0.45, -hh * 1.0, -hw * 0.88, -hh * 0.35);
    shape.quadraticCurveTo(-hw * 1.02, hh * 0.35, -hw * 0.88, hh * 0.82);
    return shape;
  }

  if (type === 'cat') {
    shape.moveTo(-hw * 0.95, hh * 0.55);
    shape.quadraticCurveTo(0, hh * 0.95, hw * 1.02, hh * 0.98);
    shape.bezierCurveTo(hw * 0.94, 0, hw * 0.68, -hh * 0.88, 0, -hh * 0.9);
    shape.bezierCurveTo(-hw * 0.7, -hh * 0.88, -hw * 0.98, -hh * 0.1, -hw * 0.95, hh * 0.55);
    return shape;
  }

  // Wayfarer / classic rounded rectangle
  const r = Math.min(hw, hh) * 0.36;
  shape.moveTo(-hw + r, -hh);
  shape.lineTo(hw - r, -hh);
  shape.quadraticCurveTo(hw, -hh, hw, -hh + r);
  shape.lineTo(hw, hh - r);
  shape.quadraticCurveTo(hw, hh, hw - r, hh);
  shape.lineTo(-hw + r, hh);
  shape.quadraticCurveTo(-hw, hh, -hw, hh - r);
  shape.lineTo(-hw, -hh + r);
  shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
  return shape;
}

/**
 * Extracts a silhouette + optional inner lens holes from an offscreen canvas image
 * and builds an extruded 3D body + curved front/back texture-mapped frame planes.
 */
function buildFrameMeshesFromImage(
  imgEl: HTMLImageElement,
  frontWidth: number,
  frontHeight: number,
  thickness: number,
  wrapDeg: number,
  bridgeXNorm: number,
  bridgeYNorm: number,
  frameMat: THREE.MeshPhysicalMaterial,
  leftBox: LensRegionBox,
  rightBox: LensRegionBox
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'eyewear_front_group';

  const tex = new THREE.Texture(imgEl);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;

  // Offset so nose bridge sits squarely at (0, 0, 0)
  const offsetX = (0.5 - bridgeXNorm) * frontWidth;
  const offsetY = (bridgeYNorm - 0.5) * frontHeight;

  // 1) Textured front & back curved frame caps preserving 100% original frame appearance
  const frontMat = new THREE.MeshPhysicalMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.18,
    roughness: frameMat.roughness,
    metalness: frameMat.metalness,
    clearcoat: frameMat.clearcoat,
    clearcoatRoughness: frameMat.clearcoatRoughness,
    side: THREE.DoubleSide,
  });

  const planeGeoFront = new THREE.PlaneGeometry(frontWidth, frontHeight, 36, 16);
  planeGeoFront.translate(offsetX, offsetY, thickness * 0.5 + 0.0006);
  applyFaceWrapCurvature(planeGeoFront, frontWidth, wrapDeg);
  const frontMesh = new THREE.Mesh(planeGeoFront, frontMat);
  frontMesh.name = 'frame_texture_front';
  group.add(frontMesh);

  const planeGeoBack = new THREE.PlaneGeometry(frontWidth, frontHeight, 36, 16);
  planeGeoBack.translate(offsetX, offsetY, -thickness * 0.5 - 0.0006);
  applyFaceWrapCurvature(planeGeoBack, frontWidth, wrapDeg);
  const backMesh = new THREE.Mesh(planeGeoBack, frontMat);
  backMesh.name = 'frame_texture_back';
  group.add(backMesh);

  // 2) True 3D extruded body depth along rim/bridge silhouette (`THREE.ExtrudeGeometry`)
  // Sample downscaled alpha grid to build clean rim-band depth ribs so edges show solid 3.5mm / 1.8mm thickness
  const gw = 72;
  const gh = Math.max(20, Math.round(gw * (frontHeight / frontWidth)));
  const off = document.createElement('canvas');
  off.width = gw;
  off.height = gh;
  const ctx = off.getContext('2d', { willReadFrequently: true });
  if (ctx) {
    ctx.drawImage(imgEl, 0, 0, gw, gh);
    const data = ctx.getImageData(0, 0, gw, gh).data;

    // Build vertical extruded column strips merged horizontally per row where frame pixels are solid
    const depthGeos: THREE.BufferGeometry[] = [];
    const cellW = frontWidth / gw;
    const cellH = frontHeight / gh;

    for (let y = 0; y < gh; y++) {
      let runStart = -1;
      for (let x = 0; x <= gw; x++) {
        const solid = x < gw && data[(y * gw + x) * 4 + 3] >= 120;
        if (solid && runStart === -1) {
          runStart = x;
        } else if (!solid && runStart !== -1) {
          const runLen = x - runStart;
          const x0 = -frontWidth * 0.5 + runStart * cellW + offsetX;
          const x1 = x0 + runLen * cellW;
          const yBot = frontHeight * 0.5 - (y + 1) * cellH + offsetY;
          const yTop = yBot + cellH * 1.03;

          const shp = new THREE.Shape();
          shp.moveTo(x0, yBot);
          shp.lineTo(x1, yBot);
          shp.lineTo(x1, yTop);
          shp.lineTo(x0, yTop);
          shp.closePath();

          // Subdivide long horizontal bars into <= 8mm segments so 12° wrap curves smoothly
          const segs = Math.max(1, Math.ceil((runLen * cellW) / 0.08));
          if (segs === 1) {
            const g = new THREE.ExtrudeGeometry(shp, {
              depth: thickness,
              bevelEnabled: false,
              curveSegments: 1,
            });
            g.translate(0, 0, -thickness * 0.5);
            depthGeos.push(g);
          } else {
            const subW = (x1 - x0) / segs;
            for (let s = 0; s < segs; s++) {
              const sx0 = x0 + s * subW;
              const sx1 = sx0 + subW * 1.02;
              const subShp = new THREE.Shape();
              subShp.moveTo(sx0, yBot);
              subShp.lineTo(sx1, yBot);
              subShp.lineTo(sx1, yTop);
              subShp.lineTo(sx0, yTop);
              subShp.closePath();
              const g = new THREE.ExtrudeGeometry(subShp, {
                depth: thickness,
                bevelEnabled: false,
                curveSegments: 1,
              });
              g.translate(0, 0, -thickness * 0.5);
              depthGeos.push(g);
            }
          }
          runStart = -1;
        }
      }
    }

    if (depthGeos.length > 0) {
      const merged = mergeBufferGeometries(depthGeos);
      depthGeos.forEach((g) => g.dispose());
      if (merged) {
        applyFaceWrapCurvature(merged, frontWidth, wrapDeg);
        const coreMesh = new THREE.Mesh(merged, frameMat);
        coreMesh.name = 'frame_core_extrude';
        group.add(coreMesh);
      }
    }
  }

  // Keep userData so lenses and temples align accurately to detected boxes
  group.userData = {
    offsetX,
    offsetY,
    leftBox,
    rightBox,
  };

  return group;
}

function mergeBufferGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!geos.length) return null;
  let totalVerts = 0;
  for (const g of geos) {
    const nonIdx = g.index ? g.toNonIndexed() : g;
    totalVerts += nonIdx.attributes.position.count;
  }
  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  let offset = 0;
  for (const rawG of geos) {
    const g = rawG.index ? rawG.toNonIndexed() : rawG;
    if (!g.attributes.normal) g.computeVertexNormals();
    const pArr = g.attributes.position.array as Float32Array;
    const nArr = g.attributes.normal.array as Float32Array;
    positions.set(pArr, offset * 3);
    normals.set(nArr, offset * 3);
    offset += g.attributes.position.count;
    if (g !== rawG) g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return out;
}

function buildProceduralFrontGroup(
  frontWidth: number,
  frontHeight: number,
  thickness: number,
  wrapDeg: number,
  type: FrameType,
  frameMat: THREE.MeshPhysicalMaterial
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'eyewear_front_group';

  const rimThick = type === 'rimless' ? 0.014 : thickness * 1.15 + 0.025;
  const lensW = frontWidth * 0.4;
  const lensH = frontHeight * 0.84;
  const lensCenterOffset = frontWidth * 0.255;

  const geos: THREE.BufferGeometry[] = [];

  if (type !== 'rimless') {
    for (const side of [-1, 1]) {
      const outer = makeRoundedLensShape(lensW + rimThick * 2, lensH + rimThick * 2, type);
      const inner = makeRoundedLensShape(lensW, lensH, type);
      outer.holes.push(inner);
      const g = new THREE.ExtrudeGeometry(outer, {
        depth: thickness,
        bevelEnabled: true,
        bevelThickness: thickness * 0.16,
        bevelSize: thickness * 0.12,
        bevelSegments: 2,
        curveSegments: 18,
      });
      g.translate(side * lensCenterOffset, 0, -thickness * 0.5);
      geos.push(g);
    }
  }

  // Nose bridge bar
  const bridgeShape = new THREE.Shape();
  const bw = Math.max(0.12, lensCenterOffset * 2 - lensW);
  const bh = rimThick * 0.9;
  bridgeShape.moveTo(-bw * 0.62, -bh * 0.5);
  bridgeShape.quadraticCurveTo(0, bh * 0.9, bw * 0.62, -bh * 0.5);
  bridgeShape.lineTo(bw * 0.62, bh * 0.5);
  bridgeShape.quadraticCurveTo(0, bh * 1.6, -bw * 0.62, bh * 0.5);
  bridgeShape.closePath();

  const bridgeGeo = new THREE.ExtrudeGeometry(bridgeShape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: thickness * 0.12,
    bevelSize: thickness * 0.1,
    bevelSegments: 1,
    curveSegments: 8,
  });
  bridgeGeo.translate(0, lensH * 0.1, -thickness * 0.5);
  geos.push(bridgeGeo);

  // Double brow bar for aviator
  if (type === 'aviator') {
    const brow = new THREE.BoxGeometry(lensCenterOffset * 2 + lensW * 0.35, 0.016, thickness * 0.95, 16, 1, 1);
    brow.translate(0, lensH * 0.44, 0);
    geos.push(brow);
  }

  const merged = mergeBufferGeometries(geos);
  geos.forEach((g) => g.dispose());
  if (merged) {
    applyFaceWrapCurvature(merged, frontWidth, wrapDeg);
    const mesh = new THREE.Mesh(merged, frameMat);
    mesh.name = 'frame_core_extrude';
    group.add(mesh);
  }

  group.userData = {
    offsetX: 0,
    offsetY: 0,
    leftBox: { cx: 0.245, cy: 0.5, w: 0.4, h: 0.84 },
    rightBox: { cx: 0.755, cy: 0.5, w: 0.4, h: 0.84 },
  };
  return group;
}

/**
 * Builds curved left & right transparent glass lenses using `THREE.MeshPhysicalMaterial`.
 */
function buildLensPairGroup(
  frontWidth: number,
  frontHeight: number,
  wrapDeg: number,
  type: FrameType,
  leftBox: LensRegionBox,
  rightBox: LensRegionBox,
  offsetX: number,
  offsetY: number,
  lensMat: THREE.MeshPhysicalMaterial
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'eyewear_lenses_group';

  const makeOne = (box: LensRegionBox, name: string) => {
    const lw = Math.max(0.24, box.w * frontWidth * 0.96);
    const lh = Math.max(0.18, box.h * frontHeight * 0.96);
    const lx = (box.cx - 0.5) * frontWidth + offsetX;
    const ly = (0.5 - box.cy) * frontHeight + offsetY;

    const shp = makeRoundedLensShape(lw, lh, type);
    const geo = new THREE.ExtrudeGeometry(shp, {
      depth: 0.009,
      bevelEnabled: false,
      curveSegments: 16,
    });
    geo.translate(lx, ly, -0.0045);
    applyFaceWrapCurvature(geo, frontWidth, wrapDeg);

    const mesh = new THREE.Mesh(geo, lensMat);
    mesh.name = name;
    mesh.renderOrder = 2;
    return mesh;
  };

  group.add(makeOne(leftBox, 'lens_left'));
  group.add(makeOne(rightBox, 'lens_right'));
  return group;
}

/**
 * Builds matching 90° 3D temple arms (`THREE.ExtrudeGeometry` tapered side profile + metallic hinge lug).
 */
function buildTempleArmsGroup(
  frontWidth: number,
  frontHeight: number,
  thickness: number,
  templeLen: number,
  wrapDeg: number,
  materialKind: FrameMaterial,
  frameMat: THREE.MeshPhysicalMaterial,
  offsetX = 0,
  offsetY = 0
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'eyewear_temples_group';

  const armThickness = materialKind === 'metal' ? 0.016 : 0.032;
  const frontLugH = materialKind === 'metal' ? 0.036 : 0.07;
  const midH = materialKind === 'metal' ? 0.022 : 0.044;
  const earDropY = -0.14;
  // 2mm forward engagement into frame thickness so hinge seats cleanly with zero 3D gap
  const forwardLugOverlap = Math.max(0.012, thickness * 0.45);

  // Profile drawn in XY where X = -forwardLugOverlap (inside hinge) -> templeLen (ear tip behind head)
  const armShape = new THREE.Shape();
  armShape.moveTo(-forwardLugOverlap, frontLugH * 0.5);
  armShape.lineTo(templeLen * 0.22, midH * 0.55);
  armShape.lineTo(templeLen * 0.72, midH * 0.45);
  armShape.quadraticCurveTo(templeLen * 0.9, midH * 0.35, templeLen, earDropY);
  armShape.lineTo(templeLen - 0.028, earDropY - 0.018);
  armShape.quadraticCurveTo(templeLen * 0.86, -midH * 0.45, templeLen * 0.72, -midH * 0.45);
  armShape.lineTo(templeLen * 0.22, -midH * 0.48);
  armShape.lineTo(-forwardLugOverlap, -frontLugH * 0.5);
  armShape.closePath();

  const armGeo = new THREE.ExtrudeGeometry(armShape, {
    depth: armThickness,
    bevelEnabled: true,
    bevelThickness: armThickness * 0.14,
    bevelSize: armThickness * 0.1,
    bevelSegments: 1,
    curveSegments: 10,
  });
  armGeo.translate(0, 0, -armThickness * 0.5);
  // Rotate profile from +X into -Z (exact 90° backward orientation)
  armGeo.rotateY(Math.PI * 0.5);

  const hingeMetalMat = new THREE.MeshStandardMaterial({
    color: 0xd4d4d8,
    metalness: 0.9,
    roughness: 0.22,
  });
  const hingeGeo = new THREE.CylinderGeometry(armThickness * 0.55, armThickness * 0.55, frontLugH * 0.9, 10);

  const anchors = computeTempleHingeAnchors(frontWidth, frontHeight, offsetX, offsetY, thickness, wrapDeg);

  for (const side of [-1, 1] as const) {
    const pos = side < 0 ? anchors.left : anchors.right;
    const armHolder = new THREE.Group();
    armHolder.name = side < 0 ? 'temple_left' : 'temple_right';
    armHolder.position.set(pos.x, pos.y, pos.z);
    // Subtle 2.5° outward anatomical temple splay
    armHolder.rotation.y = side * 0.045;

    const armMesh = new THREE.Mesh(armGeo.clone(), frameMat);
    armMesh.renderOrder = 1;
    armHolder.add(armMesh);

    const barrel = new THREE.Mesh(hingeGeo.clone(), hingeMetalMat);
    barrel.position.set(0, 0, -armThickness * 0.25);
    armHolder.add(barrel);

    group.add(armHolder);
  }

  armGeo.dispose();
  hingeGeo.dispose();
  return group;
}

export function createFramePBRMaterial(colorHex: string, materialKind: FrameMaterial): THREE.MeshPhysicalMaterial {
  const col = new THREE.Color(colorHex && colorHex !== 'transparent' ? colorHex : '#1f2937');
  if (materialKind === 'metal') {
    return new THREE.MeshPhysicalMaterial({
      color: col,
      metalness: 0.86,
      roughness: 0.22,
      clearcoat: 0.45,
      clearcoatRoughness: 0.14,
    });
  }
  return new THREE.MeshPhysicalMaterial({
    color: col,
    metalness: 0.08,
    roughness: 0.34,
    clearcoat: 0.65,
    clearcoatRoughness: 0.16,
  });
}

export function createLensPhysicalMaterial(
  isSunglasses: boolean,
  lensColorHex?: string,
  coatingId?: string
): THREE.MeshPhysicalMaterial {
  let tint = '#e6f4ff';
  if (isSunglasses) {
    tint = lensColorHex && lensColorHex !== 'transparent' ? lensColorHex : '#334155';
  } else if (coatingId === 'bluecut' || coatingId === 'bluectrl') {
    tint = '#dbeafe';
  } else if (coatingId === 'photo') {
    tint = '#cbd5e1';
  } else if (coatingId === 'ar') {
    tint = '#d1fae5';
  }

  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(tint),
    transparent: true,
    opacity: isSunglasses ? 0.56 : 0.14,
    roughness: 0.05,
    metalness: 0.04,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    ior: 1.52,
    reflectivity: 0.92,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

/**
 * Builds the complete composite 3D eyewear group centered at the nose bridge `(0, 0, 0)`.
 * Scale convention: `1 Three.js unit = 100 mm` (e.g. `136 mm` = `1.36` units).
 */
export async function buildEyewear3DGroup(opts: Eyewear3DBuildOptions): Promise<THREE.Group> {
  const cal = opts.calibration || {};
  const frameWidthMm = opts.frameWidthMm ?? cal.frameWidthMm ?? 136;
  const { templeMm } = parseOpticalDimensions(opts.opticalDimensions || cal.opticalDimensions);
  const materialKind: FrameMaterial = opts.material || cal.material || 'tr_plastic';
  const cat: FrameCat = opts.cat || (cal.isSunglasses ? 'sun' : 'med');
  const isSunglasses = cat === 'sun';
  const frameType: FrameType = opts.type || 'wayfarer';
  const wrapDeg = cal.wrapCurvatureDeg ?? 12;

  const frontWidth = frameWidthMm / 100;
  const aspect = Math.max(0.24, Math.min(0.65, opts.aspectRatio ?? cal.aspectRatio ?? 0.4));
  const frontHeight = frontWidth * aspect;
  const thicknessMm = materialKind === 'metal' ? 1.8 : 3.5;
  const thickness = thicknessMm / 100;
  const templeLen = templeMm / 100;

  const frameColor = opts.frameColor || '#1e293b';
  const frameMat = createFramePBRMaterial(frameColor, materialKind);
  const lensMat = createLensPhysicalMaterial(isSunglasses, opts.lensColor, opts.coatingId);

  const root = new THREE.Group();
  root.name = 'eyewear_root';
  root.userData = {
    baseWidthMm: frameWidthMm,
    materialKind,
    isSunglasses,
    frameMat,
    lensMat,
  };

  let frontGroup: THREE.Group;
  let offsetX = 0;
  let offsetY = 0;
  let leftBox: LensRegionBox = cal.leftLensBox || { cx: 0.27, cy: 0.5, w: 0.34, h: 0.72 };
  let rightBox: LensRegionBox = cal.rightLensBox || { cx: 0.73, cy: 0.5, w: 0.34, h: 0.72 };

  if (opts.cutoutUrl) {
    try {
      const imgEl = await loadImageElement(opts.cutoutUrl);
      const naturalAspect =
        imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0 ? imgEl.naturalHeight / imgEl.naturalWidth : aspect;
      const resolvedH = frontWidth * naturalAspect;
      frontGroup = buildFrameMeshesFromImage(
        imgEl,
        frontWidth,
        resolvedH,
        thickness,
        wrapDeg,
        cal.bridgeCenterX ?? 0.5,
        cal.bridgeCenterY ?? 0.46,
        frameMat,
        leftBox,
        rightBox
      );
      offsetX = frontGroup.userData.offsetX || 0;
      offsetY = frontGroup.userData.offsetY || 0;

      const lensesGroup = buildLensPairGroup(
        frontWidth,
        resolvedH,
        wrapDeg,
        frameType,
        leftBox,
        rightBox,
        offsetX,
        offsetY,
        lensMat
      );
      const templesGroup = buildTempleArmsGroup(
        frontWidth,
        resolvedH,
        thickness,
        templeLen,
        wrapDeg,
        materialKind,
        frameMat,
        offsetX,
        offsetY
      );

      root.add(frontGroup);
      root.add(lensesGroup);
      root.add(templesGroup);
      return root;
    } catch {
      // Fall back gracefully to procedural 3D frame if texture CORS/load fails
    }
  }

  frontGroup = buildProceduralFrontGroup(frontWidth, frontHeight, thickness, wrapDeg, frameType, frameMat);
  leftBox = frontGroup.userData.leftBox;
  rightBox = frontGroup.userData.rightBox;

  const lensesGroup = buildLensPairGroup(
    frontWidth,
    frontHeight,
    wrapDeg,
    frameType,
    leftBox,
    rightBox,
    0,
    0,
    lensMat
  );
  const templesGroup = buildTempleArmsGroup(
    frontWidth,
    frontHeight,
    thickness,
    templeLen,
    wrapDeg,
    materialKind,
    frameMat,
    0,
    0
  );

  root.add(frontGroup);
  root.add(lensesGroup);
  root.add(templesGroup);
  return root;
}

/**
 * Updates PBR material properties, width scale, and lens state in place without recreating textures.
 */
export function updateEyewear3DLive(
  root: THREE.Group,
  patch: {
    frameWidthMm?: number;
    material?: FrameMaterial;
    cat?: FrameCat;
    lensColor?: string;
    coatingId?: string;
  }
): void {
  const baseWidthMm = Number(root.userData?.baseWidthMm || 136);
  if (patch.frameWidthMm) {
    const s = Math.max(0.75, Math.min(1.25, patch.frameWidthMm / baseWidthMm));
    root.scale.set(s, s, s);
  }

  const frameMat = root.userData?.frameMat as THREE.MeshPhysicalMaterial | undefined;
  if (frameMat && patch.material) {
    if (patch.material === 'metal') {
      frameMat.metalness = 0.86;
      frameMat.roughness = 0.22;
      frameMat.clearcoat = 0.45;
    } else {
      frameMat.metalness = 0.08;
      frameMat.roughness = 0.34;
      frameMat.clearcoat = 0.65;
    }
    frameMat.needsUpdate = true;
  }

  const lensMat = root.userData?.lensMat as THREE.MeshPhysicalMaterial | undefined;
  if (lensMat && (patch.cat !== undefined || patch.lensColor !== undefined || patch.coatingId !== undefined)) {
    const isSun = patch.cat === 'sun';
    let tint = '#e6f4ff';
    if (isSun) {
      tint = patch.lensColor && patch.lensColor !== 'transparent' ? patch.lensColor : '#334155';
    } else if (patch.coatingId === 'bluecut' || patch.coatingId === 'bluectrl') {
      tint = '#dbeafe';
    } else if (patch.coatingId === 'photo') {
      tint = '#cbd5e1';
    } else if (patch.coatingId === 'ar') {
      tint = '#d1fae5';
    }
    lensMat.color.set(tint);
    lensMat.opacity = isSun ? 0.56 : 0.14;
    lensMat.needsUpdate = true;
  }
}

/**
 * Builds an invisible anatomical 3D Head Occluder (`colorWrite: false, depthWrite: true`)
 * that sits inside/behind the frame nose bridge so far temple arms vanish realistically
 * behind the user's ears and cheeks when turning their head sideways.
 */
export function createHeadOccluderMesh(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(1, 28, 22);
  // Proportioned to average adult cranium at 1 unit = 100mm (head width ~142mm -> half-width 0.71)
  geo.scale(0.68, 0.96, 0.84);
  geo.translate(0, -0.06, -0.94);

  const mat = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: true,
    side: THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'ar_head_occluder';
  mesh.renderOrder = 0;
  return mesh;
}

export function disposeThreeObject(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const map = (m as THREE.MeshStandardMaterial).map;
        if (map) map.dispose();
        m.dispose();
      }
    }
  });
}

// Single shared offscreen renderer for crisp 300+ Bulk Review Grid 3D thumbnails
let sharedThumbCtx: {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  pmrem: THREE.PMREMGenerator;
  envRT: THREE.WebGLRenderTarget;
} | null = null;

function getSharedThumbContext() {
  if (sharedThumbCtx) return sharedThumbCtx;
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
    powerPreference: 'default',
  });
  renderer.setSize(300, 210, false);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;

  const hemi = new THREE.HemisphereLight(0xf0f6ff, 0x1e293b, 0.75);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xfff4e2, 1.35);
  key.position.set(1.6, 2.2, 2.8);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x93c5fd, 0.45);
  rim.position.set(-2.0, 0.8, -1.5);
  scene.add(rim);

  const camera = new THREE.PerspectiveCamera(32, 300 / 210, 0.1, 20);
  camera.position.set(0.0, 0.18, 2.95);
  camera.lookAt(0, 0, -0.35);

  sharedThumbCtx = { renderer, scene, camera, pmrem, envRT };
  return sharedThumbCtx;
}

/**
 * Renders a crisp 3/4 angled 3D studio preview DataURL using a single shared offscreen WebGL context.
 * Prevents WebGL context exhaustion across 300+ Bulk Review Grid cards.
 */
export async function renderEyewear3DThumbnail(opts: Eyewear3DBuildOptions): Promise<string> {
  const ctx = getSharedThumbContext();
  const group = await buildEyewear3DGroup(opts);
  // Subtle 3/4 studio hero angle showing both front frame, transparent lenses, & 90° 3D temple arms
  group.rotation.set(0.12, -0.44, 0.02);
  group.position.set(0.08, 0.02, 0.18);
  ctx.scene.add(group);
  ctx.renderer.render(ctx.scene, ctx.camera);
  const dataUrl = ctx.renderer.domElement.toDataURL('image/webp', 0.88);
  ctx.scene.remove(group);
  disposeThreeObject(group);
  return dataUrl;
}
