import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  extractFallbackForegroundFromPixels,
  refineGlassesCutoutPixels,
  sampleOuterBorderColorPixels,
} from '../src/utils/visionPipeline';
import {
  EMASmoother,
  FRAME_SIZE_SCALE,
  FaceTrackingSmoother,
  OneEuroFilter,
  computeCalibratedPlacement,
  computeMetric3DPlacement,
  extractTrackingFromLandmarks,
} from '../src/utils/faceTracker';
import {
  computeWrapZ,
  parseOpticalDimensions,
} from '../src/utils/eyewear3DBuilder';
import {
  cutOutFramePhotoPixels,
  findStrictOpaqueBounds,
  generateDualCutoutPixels,
  measureFrameHorizontalTiltDeg,
  sampleFourCornerMedianBg,
} from '../src/utils/bulkFrameProcessor';
import { computeOrthographicPose, computePhysicalIrisFit } from '../src/components/VideoTryOnCanvas';
import {
  estimateSafeHorizonTiltDeg,
  normalizeLightingPixelsPreservingColor,
} from '../src/ai/productImageProcessor';
import {
  estimateLightingFromRgba,
  selectGlassesAngleLayers,
} from '../src/ai/virtualTryOnEngine';
import {
  assessGlassesSegmentationQuality,
  buildFallbackForegroundMask,
  computeDownscaledDimensions,
  computePrincipalAxisAngleDeg,
  normalizeLightingAutoLevelsGrayWorld,
  parseExifOrientationFromBytes,
  refineGlassesMaskAndDecontaminate,
  sampleOuterCornerMedianColor,
} from '../src/utils/glassesImagePipeline';
import {
  applyBfsLensFloodFill,
  applyChromaKeyAndDespill,
  computeMedianFrameHexAndOpacity,
  computeTightCropBounds,
  computeVerticalSplitRegions,
  detectChromaKeyColor,
  extractWhiteBgCrystalCutout,
  generateColorTintedVariantPixels,
  trimStudioWhitespaceBounds,
  validateEyewearAspectRatio,
} from '../src/workers/cutoutWorker';
import { PLANS0, PLATFORM_SETTINGS0 } from '../src/data/seed';
import {
  DEFAULT_OFFICIAL_LENS_BRANDS,
  LENS_CATEGORIES,
  clampMerchantPriceToVariance,
  makeMatrixCellKey,
  resolveCustomerLensBrands,
  resolveMerchantBrandRowsForTrack,
} from '../src/data/opticalLensMatrix';
import { getShopMaxProducts } from '../src/services/optiverseStore';
import { analyzeRgbaFrameColorVariance } from '../src/utils/splitSheetApi';
import { buildSharedCacheKeys } from '../api/index';

function makeImage(w: number, h: number, bg: [number, number, number]): Uint8ClampedArray {
  const arr = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    arr[p * 4] = bg[0];
    arr[p * 4 + 1] = bg[1];
    arr[p * 4 + 2] = bg[2];
    arr[p * 4 + 3] = 255;
  }
  return arr;
}

function paintRect(
  arr: Uint8ClampedArray,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: [number, number, number]
) {
  for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) {
      const i = (y * w + x) * 4;
      arr[i] = rgb[0];
      arr[i + 1] = rgb[1];
      arr[i + 2] = rgb[2];
      arr[i + 3] = 255;
    }
  }
}

function drawGlasses(
  arr: Uint8ClampedArray,
  w: number,
  h: number,
  frameRgb: [number, number, number],
  lensRgb: [number, number, number] | null,
  rimThickness: number
) {
  // Left rim: x 20..58, y 18..50
  paintRect(arr, w, h, 20, 18, 58, 50, frameRgb);
  if (lensRgb) {
    paintRect(arr, w, h, 20 + rimThickness, 18 + rimThickness, 58 - rimThickness, 50 - rimThickness, lensRgb);
  }
  // Right rim: x 82..120, y 18..50
  paintRect(arr, w, h, 82, 18, 120, 50, frameRgb);
  if (lensRgb) {
    paintRect(arr, w, h, 82 + rimThickness, 18 + rimThickness, 120 - rimThickness, 50 - rimThickness, lensRgb);
  }
  // Bridge: x 59..81, y 26..26+rimThickness-1
  paintRect(arr, w, h, 59, 26, 81, 26 + Math.max(1, rimThickness - 1), frameRgb);
}

console.log('=== OptiVerse Automated Technical Verification ===');

// 1. Thin 2px metal frame preservation + white halo-free clear lens test
{
  const w = 140;
  const h = 70;
  const raw = makeImage(w, h, [255, 255, 255]);
  // 2px gold metal wire frame with crisp white background inside lenses
  drawGlasses(raw, w, h, [201, 162, 75], [255, 255, 255], 2);

  const outerBg = sampleOuterBorderColorPixels(raw, w, h);
  assert.ok(outerBg.r > 250 && outerBg.g > 250 && outerBg.b > 250, 'Outer border background sampled as white');

  const fg = extractFallbackForegroundFromPixels(raw, w, h, outerBg, 'thin_metal');
  const { maskPixels, sampledLensColor } = refineGlassesCutoutPixels(fg, raw, w, h, {
    preset: 'thin_metal',
    isFrontView: true,
  });

  // Top left metal wire pixel (x=38, y=18) must survive un-eroded
  const topWireAlpha = fg[(18 * w + 38) * 4 + 3];
  assert.ok(topWireAlpha >= 170, `Thin 2px metal rim must stay intact (got alpha=${topWireAlpha})`);

  // Bridge wire pixel (x=70, y=26) must survive
  const bridgeAlpha = fg[(26 * w + 70) * 4 + 3];
  assert.ok(bridgeAlpha >= 170, `Bridge wire must stay intact (got alpha=${bridgeAlpha})`);

  // Exterior background pixel (x=5, y=5) must be fully transparent
  assert.equal(fg[(5 * w + 5) * 4 + 3], 0, 'Exterior background must be 0 alpha');

  // Inside left lens pocket (x=39, y=34): should be ~85% transparent (alpha ~34..42, ~13-17% opacity) and marked in mask
  const lensAlpha = fg[(34 * w + 39) * 4 + 3];
  const maskAlpha = maskPixels[(34 * w + 39) * 4 + 3];
  assert.ok(lensAlpha >= 30 && lensAlpha <= 44, `Clear lens should be ~85% transparent (alpha=${lensAlpha})`);
  assert.equal(maskAlpha, 255, 'Lens pocket should be marked opaque in maskPixels');
  assert.equal(sampledLensColor, '#cfe8ff', 'Clear optical lens sampled tint');
  console.log('✓ Test 1 passed: 2px thin metal rim preserved + clear lenses ~85% transparent');
}

// 2. Transparent crystal acetate rim recovery test
{
  const w = 140;
  const h = 70;
  const raw = makeImage(w, h, [246, 245, 243]); // #F6F5F3 background
  // Soft gray-blue crystal acetate rim (#B8C4D4), slightly thicker 4px
  drawGlasses(raw, w, h, [184, 196, 212], [246, 245, 243], 4);

  const outerBg = sampleOuterBorderColorPixels(raw, w, h);
  const fg = extractFallbackForegroundFromPixels(raw, w, h, outerBg, 'transparent');
  // Simulate neural under-segmentation dropping an edge pixel along left rim (x=21, y=34)
  fg[(34 * w + 21) * 4 + 3] = 0;

  refineGlassesCutoutPixels(fg, raw, w, h, {
    preset: 'transparent',
    isFrontView: true,
  });

  const recoveredRimAlpha = fg[(34 * w + 21) * 4 + 3];
  assert.ok(recoveredRimAlpha >= 100, `Transparent crystal edge should recover (got alpha=${recoveredRimAlpha})`);
  console.log('✓ Test 2 passed: Transparent crystal rim recovery preserves faint edge');
}

// 3. Sunglasses frame + tinted lens color preservation test
{
  const w = 140;
  const h = 70;
  const raw = makeImage(w, h, [255, 255, 255]);
  // Black thick frame (#141414) + blue tinted sunglasses lenses (#2B4FA8)
  drawGlasses(raw, w, h, [20, 20, 20], [43, 79, 168], 4);

  const outerBg = sampleOuterBorderColorPixels(raw, w, h);
  const fg = extractFallbackForegroundFromPixels(raw, w, h, outerBg, 'sunglasses');
  const { maskPixels, sampledLensColor } = refineGlassesCutoutPixels(fg, raw, w, h, {
    preset: 'sunglasses',
    isSunglasses: true,
    isFrontView: true,
  });

  // Frame stays dark & opaque
  const frameIdx = (19 * w + 38) * 4;
  assert.ok(fg[frameIdx + 3] >= 220, 'Sunglass frame stays opaque');
  assert.ok(fg[frameIdx] < 50 && fg[frameIdx + 2] < 50, 'Sunglass frame keeps dark black color');

  // Lens center keeps real blue tint & ~50% translucency
  const lensIdx = (34 * w + 39) * 4;
  assert.equal(maskPixels[lensIdx + 3], 255, 'Sunglass lens pocket detected in maskPixels');
  assert.ok(
    fg[lensIdx + 3] >= 110 && fg[lensIdx + 3] <= 155,
    `Sunglass lens has ~50% translucency (got alpha=${fg[lensIdx + 3]})`
  );
  assert.ok(
    fg[lensIdx + 2] > fg[lensIdx] + 50,
    `Sunglass lens keeps original blue hue (r=${fg[lensIdx]}, b=${fg[lensIdx + 2]})`
  );
  assert.notEqual(sampledLensColor, '#cfe8ff', 'Sampled lens color reflects real sunglasses tint');
  console.log(`✓ Test 3 passed: Sunglasses kept original lens hue (${sampledLensColor}) with natural translucency`);
}

// 4. OneEuroFilter jitter reduction vs fast step test
{
  const filter = new OneEuroFilter(1.6, 0.045, 1.0);
  const noisy = [0.5, 0.514, 0.487, 0.512, 0.489, 0.511, 0.491, 0.508];
  const smoothed = noisy.map((v, idx) => filter.filter(v, idx * (1 / 30)));
  const rawDev = noisy.slice(1).reduce((s, v) => s + Math.abs(v - 0.5), 0);
  const smoothDev = smoothed.slice(1).reduce((s, v) => s + Math.abs(v - 0.5), 0);
  assert.ok(smoothDev < rawDev * 0.55, `OneEuroFilter must suppress jitter (rawDev=${rawDev.toFixed(4)}, smoothDev=${smoothDev.toFixed(4)})`);

  // Step response after rapid head turn
  let out = 0;
  for (let i = 0; i < 6; i++) {
    out = filter.filter(0.75, (10 + i) * (1 / 30));
  }
  assert.ok(out > 0.71, `OneEuroFilter responds quickly to fast turn (got ${out.toFixed(4)})`);
  console.log('✓ Test 4 passed: OneEuroFilter suppresses stationary jitter & tracks fast turns');
}

// 5. Landmark extraction (with irises 468/473 & without irises) + calibrated sizing
{
  const buildLandmarks = (withIrises: boolean, noseShiftX = 0) => {
    const lm = Array.from({ length: withIrises ? 478 : 468 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    lm[33] = { x: 0.36, y: 0.44, z: 0 }; // left outer
    lm[133] = { x: 0.42, y: 0.44, z: 0 }; // left inner
    lm[362] = { x: 0.58, y: 0.44, z: 0 }; // right inner
    lm[263] = { x: 0.64, y: 0.44, z: 0 }; // right outer
    lm[168] = { x: 0.5 + noseShiftX * 0.35, y: 0.44, z: 0 }; // bridge
    lm[6] = { x: 0.5 + noseShiftX * 0.3, y: 0.43, z: 0 }; // sellion
    lm[1] = { x: 0.5 + noseShiftX, y: 0.53, z: -0.05 }; // nose tip
    lm[10] = { x: 0.5, y: 0.24, z: 0 }; // forehead
    lm[152] = { x: 0.5, y: 0.78, z: 0 }; // chin
    lm[234] = { x: 0.28, y: 0.48, z: 0.04 }; // left cheek/ear
    lm[454] = { x: 0.72, y: 0.48, z: 0.04 }; // right cheek/ear
    lm[172] = { x: 0.33, y: 0.68, z: 0.02 };
    lm[397] = { x: 0.67, y: 0.68, z: 0.02 };
    if (withIrises) {
      lm[468] = { x: 0.39, y: 0.44, z: 0 };
      lm[473] = { x: 0.61, y: 0.44, z: 0 };
    }
    return lm;
  };

  const trackWithIris = extractTrackingFromLandmarks(buildLandmarks(true));
  const trackNoIris = extractTrackingFromLandmarks(buildLandmarks(false));
  assert.ok(Math.abs(trackWithIris.leftEye.x - 0.39) < 0.005);
  assert.ok(Math.abs(trackNoIris.rightEye.x - 0.61) < 0.005);
  assert.ok(trackWithIris.pdMm >= 56 && trackWithIris.pdMm <= 72);

  const mapBox = (nx: number, ny: number) => ({ x: nx * 1000, y: ny * 800 });
  const smallP = computeCalibratedPlacement(trackWithIris, mapBox, 0.41, 'Small');
  const medP = computeCalibratedPlacement(trackWithIris, mapBox, 0.41, 'Medium');
  const largeP = computeCalibratedPlacement(trackWithIris, mapBox, 0.41, 'Large');

  assert.ok(smallP.glassesWidth < medP.glassesWidth && medP.glassesWidth < largeP.glassesWidth);
  assert.ok(Math.abs(smallP.glassesWidth / medP.glassesWidth - FRAME_SIZE_SCALE.Small) < 0.001);
  assert.ok(Math.abs(largeP.glassesWidth / medP.glassesWidth - FRAME_SIZE_SCALE.Large) < 0.001);

  // Turned head yaw test (nose shifted rightward)
  const turned = extractTrackingFromLandmarks(buildLandmarks(true, 0.09));
  const turnedP = computeCalibratedPlacement(turned, mapBox, 0.41, 'Medium');
  assert.ok(Math.abs(turnedP.screenYawDeg) > 15 && Math.abs(turnedP.screenYawDeg) <= 42);
  assert.ok(turnedP.glassesWidth > medP.glassesWidth * 0.9, 'Turned head maintains calibrated frame scale');

  // FaceTrackingSmoother stability
  const smoother = new FaceTrackingSmoother();
  const s1 = smoother.smooth(trackWithIris, 1000);
  const s2 = smoother.smooth(trackWithIris, 1033);
  assert.equal(s1.faceShape, s2.faceShape);
  console.log('✓ Test 5 & 6 passed: Iris/fallback landmarks, S/M/L calibration, and ±42° yaw stability');
}

// 6. Static UI & Architectural Requirements Checks
{
  const root = process.cwd();
  const merchantSrc = fs.readFileSync(path.join(root, 'src/pages/MerchantPage.tsx'), 'utf8');
  const storefrontSrc = fs.readFileSync(path.join(root, 'src/pages/StorefrontPage.tsx'), 'utf8');
  const pdpSrc = fs.readFileSync(path.join(root, 'src/components/ProductDetailsView.tsx'), 'utf8');
  const wizardSrc = fs.readFileSync(path.join(root, 'src/components/GuidedCaptureWizard.tsx'), 'utf8');
  const modalsSrc = fs.readFileSync(path.join(root, 'src/components/Modals.tsx'), 'utf8');

  assert.ok(!merchantSrc.includes('رابط متجر العملاء الخاص بمحلك'), 'Global storefront link card removed from MerchantPage');
  assert.ok(merchantSrc.includes('إعداد متجر العملاء'), 'Store settings section properly named');
  assert.ok(modalsSrc.includes('isPublished'), 'Merchant can publish/hide products via edit modal');
  assert.ok(merchantSrc.includes("setModal({ t: 'editprod'"), 'Merchant can edit products');
  assert.ok(merchantSrc.includes("setModal({ t: 'delprod'"), 'Merchant uses delete confirmation modal');

  assert.ok(pdpSrc.includes('#F8F9FA'), 'PDP uses neutral #F8F9FA studio backdrop');
  assert.ok(pdpSrc.includes('جرّب على وجهك'), 'PDP includes AI Virtual Try-On CTA');
  assert.ok(pdpSrc.includes('Small') && pdpSrc.includes('Medium') && pdpSrc.includes('Large'), 'PDP includes S/M/L sizes');

  assert.ok(storefrontSrc.includes('p.isPublished !== false'), 'Storefront hides unpublished drafts from public');
  assert.ok(storefrontSrc.includes('frameSize={selectedSize}'), 'Storefront passes selectedSize to FaceTryOnStage');
  assert.ok(storefrontSrc.includes('onOrderProduct='), 'Storefront wires post-try-on direct order flow');

  assert.ok(!wizardSrc.includes('glassesGlbBuilder'), 'GuidedCaptureWizard removed legacy fake GLB builder');
  assert.ok(!wizardSrc.includes('6 زوايا'), 'GuidedCaptureWizard does not require 6 angles');
  assert.ok(wizardSrc.includes('.glb') && wizardSrc.includes('fitScale') && wizardSrc.includes('eyeLineOffset'), 'GuidedCaptureWizard supports optional .glb upload plus fitScale & eyeLineOffset');
  assert.ok(
    wizardSrc.includes('processMerchantGlassesPhoto') && wizardSrc.includes('merchantApproved'),
    'GuidedCaptureWizard uses AI processor and requires explicit merchant approval before publish'
  );

  assert.ok(modalsSrc.includes("t === 'editprod'") && modalsSrc.includes("t === 'delprod'"), 'Modals wired for editprod & delprod');

  const migration004 = fs.readFileSync(path.join(root, 'supabase/migrations/004_products_2d_3d_columns.sql'), 'utf8');
  for (const col of [
    'tryon_mode',
    'processed_image',
    'additional_images',
    'model_3d_url',
    'model_calibration',
    'frame_colors',
    'available_sizes',
  ]) {
    assert.ok(migration004.includes(col), `Migration 004 defines ${col}`);
  }

  const storeSrc = fs.readFileSync(path.join(root, 'src/services/optiverseStore.tsx'), 'utf8');
  assert.ok(
    storeSrc.includes('tryon_mode') && storeSrc.includes('processed_image') && storeSrc.includes('model_calibration'),
    'Store preserves DB columns safely'
  );
  assert.ok(
    storeSrc.includes('signInWithGoogle') && storeSrc.includes('signInWithApple'),
    'Store supports Google & Apple OAuth'
  );

  assert.ok(
    merchantSrc.includes('signInWithGoogle') && merchantSrc.includes('signInWithApple'),
    'Merchant login exposes Google & Apple Sign-In'
  );

  const landingSrc = fs.readFileSync(path.join(root, 'src/pages/LandingPage.tsx'), 'utf8');
  assert.ok(landingSrc.includes('AI + 3D'), 'LandingPage showcases 1:1 mm AI + 3D eyewear scale');
  assert.ok(landingSrc.includes('/stores'), 'LandingPage links directly to certified optician directory');
  assert.ok(landingSrc.includes('14 يوماً'), 'LandingPage highlights 14-day free trial');
  assert.ok(landingSrc.includes('id="how-it-works"'), 'LandingPage includes 5-step customer journey section');

  assert.ok(!storefrontSrc.includes('#FFFCF7') && !modalsSrc.includes('#FFFCF7'), 'All studio surfaces upgraded to #F8F9FA');

  console.log('✓ Test 7 passed: Architectural invariants, 2-photo wizard, Apple/Google Auth, Landing AI+3D journey & DB schema preserved');
}

// 8. AI Image Processor & Virtual Try-On Lighting/Angle Engine Verification
{
  // A. Lighting normalizer preserves exact RGB hue & leaves bright studio images untouched
  const w = 100;
  const h = 60;
  const brightBuf = makeImage(w, h, [255, 255, 255]);
  paintRect(brightBuf, w, h, 20, 15, 80, 45, [190, 160, 120]);
  const resBright = normalizeLightingPixelsPreservingColor(brightBuf, w, h, { r: 255, g: 255, b: 255 });
  assert.equal(resBright.adjusted, false, 'Well-lit studio shot should not be re-exposed');

  // Dim frame gets gentle lift while preserving exact R:G ratio
  const dimBuf = makeImage(w, h, [240, 240, 240]);
  paintRect(dimBuf, w, h, 20, 15, 80, 45, [60, 40, 20]);
  const resDim = normalizeLightingPixelsPreservingColor(dimBuf, w, h, { r: 240, g: 240, b: 240 });
  assert.equal(resDim.adjusted, true, 'Underexposed frame receives gentle bounded brightness lift');
  assert.ok(resDim.gain > 1.0 && resDim.gain <= 1.16, `Gain stays safely bounded (got ${resDim.gain})`);
  const pxIdx = (30 * w + 50) * 4;
  const ratioBefore = 60 / 40;
  const ratioAfter = dimBuf[pxIdx] / dimBuf[pxIdx + 1];
  assert.ok(Math.abs(ratioAfter - ratioBefore) < 0.08, 'RGB color ratio preserved without recoloring glasses');

  // B. Safe horizon tilt guard (1.5°..10° only; rejects tiny or extreme tilts)
  const levelBuf = new Uint8ClampedArray(w * h * 4);
  paintRect(levelBuf, w, h, 10, 18, 42, 38, [20, 20, 20]);
  paintRect(levelBuf, w, h, 58, 18, 90, 38, [20, 20, 20]);
  const levelCheck = estimateSafeHorizonTiltDeg(levelBuf, w, h);
  assert.equal(levelCheck.angleDeg, 0, 'Already-level frame (< 1.5 deg) skips unnecessary rotation');

  const tiltedBuf = new Uint8ClampedArray(w * h * 4);
  paintRect(tiltedBuf, w, h, 10, 16, 42, 36, [20, 20, 20]); // cy=26
  paintRect(tiltedBuf, w, h, 58, 20, 90, 40, [20, 20, 20]); // cy=30 -> atan2(4, 48) ~= 4.76 deg -> angleDeg ~= -4.76
  const tiltCheck = estimateSafeHorizonTiltDeg(tiltedBuf, w, h);
  assert.equal(tiltCheck.confident, true, 'Safe ~4.8° camera roll is confidently detected');
  assert.ok(Math.abs(tiltCheck.angleDeg) >= 3 && Math.abs(tiltCheck.angleDeg) <= 6);

  // C. Face ambient lighting estimation
  const faceRgba = makeImage(64, 64, [150, 120, 100]);
  paintRect(faceRgba, 64, 64, 34, 16, 54, 48, [215, 180, 155]); // brighter right cheek
  const light = estimateLightingFromRgba(faceRgba, 64, 64, { x: 0.5, y: 0.5 }, 0.35);
  assert.ok(light.directionalBiasX > 0.1, `Right-lit face yields positive directionalBiasX (got ${light.directionalBiasX})`);
  assert.ok(light.ambientCssFilter.includes('brightness('), 'Ambient CSS filter returned');

  // D. 2-Photo angle layer selection
  const twoImgs = [
    { id: 'f1', productId: 'p1', angleYaw: 0, label: 'أمامية', imageUrl: 'front.webp', kind: 'front_tryon' as const, sortOrder: 0 },
    { id: 'a2', productId: 'p1', angleYaw: 45, label: 'مائلة', imageUrl: 'angled.webp', kind: 'front_tryon' as const, sortOrder: 1 },
  ];
  const centerLayers = selectGlassesAngleLayers(twoImgs, 2);
  assert.equal(centerLayers.length, 1);
  assert.equal(centerLayers[0].img.id, 'f1', 'Facing camera shows pure front photo');

  const turnedLayers = selectGlassesAngleLayers(twoImgs, 32);
  assert.equal(turnedLayers.length, 2, 'Turning head blends front + 2nd angle smoothly');
  assert.ok(Math.abs(turnedLayers[0].weight + turnedLayers[1].weight - 1) < 1e-6);

  console.log('✓ Test 8 passed: AI color-preserving lighting lift, safe tilt leveling, face lighting probe, and 2-angle blending verified');
}

// 9. Obsolete 3D Runtime Cleanup & FaceTryOnStage AI Integration Verification
{
  const root = process.cwd();
  for (const obsoleteFile of [
    'src/components/ThreeGlassesViewer.tsx',
    'src/components/Glasses3DTryOnOverlay.tsx',
    'src/utils/glasses3DEngine.ts',
    'src/utils/glassesGlbBuilder.ts',
  ]) {
    assert.equal(fs.existsSync(path.join(root, obsoleteFile)), false, `Obsolete 3D runtime file deleted: ${obsoleteFile}`);
  }

  const stageSrc = fs.readFileSync(path.join(root, 'src/components/FaceTryOnStage.tsx'), 'utf8');
  assert.ok(stageSrc.includes('analyzeFaceLighting'), 'FaceTryOnStage integrates AI face lighting analysis');
  assert.ok(stageSrc.includes('selectGlassesAngleLayers'), 'FaceTryOnStage uses 2-angle layer selection');
  assert.ok(stageSrc.includes('onOrderProduct'), 'FaceTryOnStage exposes post-try-on direct order callback');
  assert.ok(!stageSrc.includes('Glasses3DTryOnOverlay'), 'FaceTryOnStage removed obsolete 3D overlay dependency');

  console.log('✓ Test 9 passed: Obsolete 3D runtime files deleted & FaceTryOnStage AI pipeline verified');
}

// 10. Real-Photo Plane + Optional GLB AR Try-On, Cutout, Orthographic Pose & Bulk Uploader Checks
{
  const root = process.cwd();

  // A. EMASmoother suppresses jitter
  const ema = new EMASmoother(0.32, 0.28);
  const sA = ema.update({ cx: 200, cy: 150, pxPerMm: 2.0, glassesWidth: 272, cheekSpanPx: 280, yaw: 0, pitch: 0, roll: 0 });
  const sB = ema.update({ cx: 210, cy: 158, pxPerMm: 2.0, glassesWidth: 272, cheekSpanPx: 280, yaw: 8, pitch: 2, roll: 3 });
  assert.ok(sB.cx > sA.cx && sB.cx < 210, 'EMA smooths position step smoothly');
  assert.ok(sB.yaw > 0 && sB.yaw < 8, 'EMA smooths yaw step smoothly');

  // B. Metric mm scaling (128mm vs 136mm vs 144mm) + OrthographicCamera pose math
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  lm[33] = { x: 0.36, y: 0.44, z: 0 };
  lm[133] = { x: 0.42, y: 0.44, z: 0 };
  lm[362] = { x: 0.58, y: 0.44, z: 0 };
  lm[263] = { x: 0.64, y: 0.44, z: 0 };
  lm[468] = { x: 0.39, y: 0.44, z: 0 };
  lm[473] = { x: 0.61, y: 0.44, z: 0 };
  lm[168] = { x: 0.5, y: 0.44, z: -0.02 };
  lm[6] = { x: 0.5, y: 0.43, z: 0 };
  lm[1] = { x: 0.5, y: 0.53, z: -0.05 };
  lm[10] = { x: 0.5, y: 0.24, z: 0 };
  lm[152] = { x: 0.5, y: 0.78, z: 0 };
  lm[127] = { x: 0.28, y: 0.44, z: 0.04 };
  lm[356] = { x: 0.72, y: 0.44, z: 0.04 };
  lm[234] = { x: 0.28, y: 0.48, z: 0.04 };
  lm[454] = { x: 0.72, y: 0.48, z: 0.04 };
  lm[172] = { x: 0.33, y: 0.68, z: 0.02 };
  lm[397] = { x: 0.67, y: 0.68, z: 0.02 };

  const tr = extractTrackingFromLandmarks(lm);
  const mapFn = (nx: number, ny: number) => ({ x: nx * 1000, y: ny * 800 });
  const m128 = computeMetric3DPlacement(tr, mapFn, 128, 'Medium', 0.41);
  const m136 = computeMetric3DPlacement(tr, mapFn, 136, 'Medium', 0.41);
  const m144 = computeMetric3DPlacement(tr, mapFn, 144, 'Medium', 0.41);
  assert.ok(m128.glassesWidth < m136.glassesWidth && m136.glassesWidth < m144.glassesWidth);
  assert.ok(Math.abs(m144.glassesWidth / m128.glassesWidth - 144 / 128) < 1e-4, 'Frame width scales proportionally to mm');

  const orthoPose = computeOrthographicPose(lm, 1280, 720);
  const expectedWidth = Math.hypot((0.72 - 0.28) * 1280, 0, 0);
  assert.ok(Math.abs(orthoPose.faceWidth - expectedWidth) < 1e-3, 'faceWidth equals distance(L127, L356) in video pixel space');
  assert.ok(Math.abs(orthoPose.quaternion.length() - 1) < 1e-5, 'Orthographic quaternion is unit normalized');
  assert.ok(orthoPose.anchor.z > 0, 'Anchor includes forward +Z shift of faceWidth * 0.07');

  // C. 12° wrap curvature & optical dimensions parsing (preserved for fallback helpers)
  assert.equal(computeWrapZ(0, 1.36, 12), 0, 'Nose bridge centered at (0,0,0)');
  assert.ok(computeWrapZ(0.68, 1.36, 12) < -0.05, '12° wrap sweeps outer frame corners backward (-Z)');
  assert.deepEqual(parseOpticalDimensions('54-19-145'), { lensMm: 54, bridgeMm: 19, templeMm: 145 });

  // D. Bulk tilt measurement
  const tiltArr = new Uint8ClampedArray(100 * 60 * 4);
  paintRect(tiltArr, 100, 60, 10, 16, 42, 36, [20, 20, 20]);
  paintRect(tiltArr, 100, 60, 58, 20, 90, 40, [20, 20, 20]);
  assert.ok(Math.abs(measureFrameHorizontalTiltDeg(tiltArr, 100, 60)) > 2);

  // E. Corner median background sampling + border flood-fill + 8-14% real-glass lenses + <3% transparent gap + sunglasses preservation + alpha>51 tight bounds
  const exW = 140;
  const exH = 70;
  const bgColor: [number, number, number] = [245, 243, 240];
  const clearRaw = makeImage(exW, exH, bgColor);
  drawGlasses(clearRaw, exW, exH, [42, 38, 34], bgColor, 3);
  // Add a tiny enclosed bridge/nose-pad loop (< 3% of image area) between x=64..74, y=30..36
  paintRect(clearRaw, exW, exH, 63, 29, 75, 37, [42, 38, 34]);
  paintRect(clearRaw, exW, exH, 66, 32, 72, 34, bgColor); // 7x3 = 21px (< 3% of 9800 = 294px)

  const cornerSample = sampleFourCornerMedianBg(clearRaw, exW, exH);
  assert.deepEqual(cornerSample, { r: 245, g: 243, b: 240 }, 'Samples median background from four corners');

  const cutClear = cutOutFramePhotoPixels(clearRaw, exW, exH);
  assert.equal(cutClear.pixels[(4 * exW + 4) * 4 + 3], 0, 'Border-connected background must be transparent (alpha=0)');
  assert.equal(cutClear.pixels[(33 * exW + 69) * 4 + 3], 0, 'Small enclosed nose-pad gap (<3% area) must be fully transparent (alpha=0)');

  const topLensIdx = (24 * exW + 39) * 4;
  const botLensIdx = (44 * exW + 39) * 4;
  assert.equal(cutClear.pixels[topLensIdx], 255, 'Clear lens renders white glass reflection R=255');
  assert.ok(cutClear.pixels[topLensIdx + 3] >= 20 && cutClear.pixels[topLensIdx + 3] <= 38, `Clear lens top has ~14% white glass (got alpha=${cutClear.pixels[topLensIdx + 3]})`);
  assert.ok(cutClear.pixels[topLensIdx + 3] > cutClear.pixels[botLensIdx + 3], 'Top of clear glass lens is subtly stronger than bottom (~14% -> ~8%)');
  assert.ok(cutClear.pixels[(19 * exW + 39) * 4 + 3] === 255, 'Solid rim stays fully opaque');
  assert.equal(cutClear.detectedCat, 'med', 'Clear-lens frame classified as medical');

  // Sunglasses with tinted lenses must stay intact and opaque/tinted from the photo
  const sunRaw = makeImage(exW, exH, [250, 250, 250]);
  drawGlasses(sunRaw, exW, exH, [20, 20, 22], [36, 72, 165], 4);
  const cutSun = cutOutFramePhotoPixels(sunRaw, exW, exH);
  const sunLensIdx = (34 * exW + 39) * 4;
  assert.equal(cutSun.pixels[sunLensIdx + 3], 255, 'Tinted sunglasses lens stays untouched from photo');
  assert.ok(cutSun.pixels[sunLensIdx + 2] > cutSun.pixels[sunLensIdx] + 60, 'Tinted sunglasses lens keeps original blue hue');
  assert.equal(cutSun.detectedCat, 'sun', 'Dark tinted lenses detected as sunglasses');

  // Bounding box check with alpha > 51 (0.2)
  const bounds = findStrictOpaqueBounds(cutSun.pixels, exW, exH, 51);
  assert.equal(bounds.minX, 20, 'Strict alpha>51 bounds minX matches frame left edge');
  assert.equal(bounds.maxX, 120, 'Strict alpha>51 bounds maxX matches frame right edge');
  assert.equal(bounds.minY, 18, 'Strict alpha>51 bounds minY matches frame top edge');
  assert.equal(bounds.maxY, 50, 'Strict alpha>51 bounds maxY matches frame bottom edge');

  // E2. Dual-Output Image Processing (Warby Parker Store Photo + Clean Face Try-On Photo)
  const dualW = 140;
  const dualH = 70;
  const studioBg: [number, number, number] = [245, 243, 240];
  const opticalFoldedRaw = makeImage(dualW, dualH, studioBg);
  drawGlasses(opticalFoldedRaw, dualW, dualH, [35, 35, 35], studioBg, 3);
  // Draw horizontal dark folded temple arms running right behind BOTH clear lenses (y=32..36)
  paintRect(opticalFoldedRaw, dualW, dualH, 23, 32, 57, 36, [30, 30, 30]);
  paintRect(opticalFoldedRaw, dualW, dualH, 83, 32, 117, 36, [30, 30, 30]);

  const dualOptical = generateDualCutoutPixels(opticalFoldedRaw, dualW, dualH, {
    category: 'med',
    angleType: 'front',
  });
  const foldedBarIdx = (34 * dualW + 39) * 4;
  const upperPocketIdx = (25 * dualW + 39) * 4;
  const lowerPocketIdx = (42 * dualW + 39) * 4;
  const outerRimIdx = (19 * dualW + 39) * 4;
  assert.equal(dualOptical.storeFrontPixels[foldedBarIdx + 3], 255, 'Store gallery photo preserves dark folded temple arm inside lens');
  assert.equal(dualOptical.tryOnFrontPixels[foldedBarIdx], 255, 'Live try-on hollows folded temple inside lens to white sheen R=255');
  assert.equal(dualOptical.tryOnFrontPixels[foldedBarIdx + 3], 15, 'Live try-on hollows folded temple inside lens to 6% glass (alpha=15)');
  assert.equal(dualOptical.tryOnFrontPixels[upperPocketIdx + 3], 15, 'Live try-on hollows upper lens pocket to 6% glass');
  assert.equal(dualOptical.tryOnFrontPixels[lowerPocketIdx + 3], 15, 'Live try-on hollows lower lens pocket to 6% glass');
  assert.equal(dualOptical.tryOnFrontPixels[outerRimIdx + 3], 255, 'Outer top rim remains 100% opaque in live try-on');

  // Multi-colored background (white wall top + wooden table bottom) AI segmentation + optical inner-lens hollowing pass
  const multiBgOrig = makeImage(dualW, dualH, [242, 242, 242]); // White wall top
  paintRect(multiBgOrig, dualW, dualH, 0, 35, dualW - 1, dualH - 1, [140, 92, 58]); // Wooden table bottom
  drawGlasses(multiBgOrig, dualW, dualH, [24, 24, 28], [242, 242, 242], 3); // Dark optical rims over white wall top
  // Paint wooden table bottom inside lower half of both closed lenses (y=35..47)
  paintRect(multiBgOrig, dualW, dualH, 23, 35, 55, 47, [140, 92, 58]);
  paintRect(multiBgOrig, dualW, dualH, 85, 35, 117, 47, [140, 92, 58]);
  // Simulate @imgly/background-removal cleanly stripping outer wall + wooden table,
  // while leaving opaque wall+table pixels trapped inside the two closed optical lens rims
  const multiBgSeg = new Uint8ClampedArray(multiBgOrig);
  for (let y = 0; y < dualH; y++) {
    for (let x = 0; x < dualW; x++) {
      const inLeft = x >= 20 && x <= 58 && y >= 18 && y <= 50;
      const inRight = x >= 82 && x <= 120 && y >= 18 && y <= 50;
      const inBridge = x >= 59 && x <= 81 && y >= 26 && y <= 28;
      if (!inLeft && !inRight && !inBridge) {
        const i = (y * dualW + x) * 4;
        multiBgSeg[i] = 0;
        multiBgSeg[i + 1] = 0;
        multiBgSeg[i + 2] = 0;
        multiBgSeg[i + 3] = 0;
      }
    }
  }
  const multiCut = generateDualCutoutPixels(multiBgSeg, dualW, dualH, {
    category: 'med',
    alreadySegmentedRgba: true,
    rawOrigPixels: multiBgOrig,
    angleType: 'front',
  });
  const wallInLensIdx = (26 * dualW + 39) * 4;
  const woodInLensIdx = (42 * dualW + 39) * 4;
  assert.equal(multiCut.storeFrontPixels[(5 * dualW + 5) * 4 + 3], 0, 'Outer wall removed');
  assert.equal(multiCut.storeFrontPixels[(62 * dualW + 5) * 4 + 3], 0, 'Outer wooden table removed');
  assert.equal(multiCut.storeFrontPixels[wallInLensIdx + 3], 15, 'Remaining white wall inside optical lens replaced with 6% optical sheen in store photo');
  assert.equal(multiCut.storeFrontPixels[woodInLensIdx + 3], 15, 'Remaining wooden table inside optical lens replaced with 6% optical sheen in store photo');
  assert.equal(multiCut.tryOnFrontPixels[woodInLensIdx + 3], 15, 'Remaining wooden table inside optical lens replaced with 6% optical sheen in try-on photo');
  assert.equal(multiCut.storeFrontPixels[outerRimIdx + 3], 255, 'Optical rim stays 100% opaque after inner-lens hollowing');

  const sunFoldedRaw = makeImage(dualW, dualH, [250, 250, 250]);
  drawGlasses(sunFoldedRaw, dualW, dualH, [20, 20, 22], [40, 80, 170], 4);
  const dualSun = generateDualCutoutPixels(sunFoldedRaw, dualW, dualH, {
    category: 'sun',
    angleType: 'front',
  });
  assert.equal(dualSun.storeFrontPixels[foldedBarIdx + 3], 255, 'Sunglasses store photo preserves tinted lenses');
  assert.equal(dualSun.tryOnFrontPixels[foldedBarIdx + 3], 255, 'Sunglasses live try-on preserves tinted lenses');

  // E3. True-to-Scale Iris Sizing (63mm adult IPD internally) & Arabic Fit Indicator (±5mm)
  const expectedIpdPx = (0.61 - 0.39) * 1280;
  const expectedPxPerMm = expectedIpdPx / 63;
  const idealFit = computePhysicalIrisFit(lm, 1280, 720, Math.round(expectedWidth / expectedPxPerMm), 1.0);
  assert.equal(idealFit.fitStatus, 'ideal');
  assert.ok(idealFit.fitLabelAr.startsWith('مقاس مثالي لوجهك'));
  assert.ok(
    Math.abs(idealFit.targetWidthPx - Math.round(expectedWidth / expectedPxPerMm) * expectedPxPerMm) < 1e-3,
    'targetWidthPx equals frameWidthMm * (pixelIPD / 63) * fitScale'
  );
  const smallFit = computePhysicalIrisFit(lm, 1280, 720, Math.round(idealFit.userFaceWidthMm - 10), 1.0);
  assert.equal(smallFit.fitStatus, 'narrow');
  assert.ok(smallFit.fitLabelAr.includes('ضيقاً'));
  const largeFit = computePhysicalIrisFit(lm, 1280, 720, Math.round(idealFit.userFaceWidthMm + 10), 1.0);
  assert.equal(largeFit.fitStatus, 'oversized');
  assert.ok(largeFit.fitLabelAr.includes('عريض'));

  // F. Static architecture checks for real-photo plane pipeline, dual output, 45-degree UI & RTL fixes
  const bulkSrc = fs.readFileSync(path.join(root, 'src/components/BulkFrameUploader.tsx'), 'utf8');
  const wizardSrc2 = fs.readFileSync(path.join(root, 'src/components/GuidedCaptureWizard.tsx'), 'utf8');
  const previewSrc = fs.readFileSync(path.join(root, 'src/components/FrameFitPreviewCard.tsx'), 'utf8');
  const videoCanvasSrc = fs.readFileSync(path.join(root, 'src/components/VideoTryOnCanvas.tsx'), 'utf8');
  const faceTrackerSrc = fs.readFileSync(path.join(root, 'src/utils/faceTracker.ts'), 'utf8');
  const arStageSrc = fs.readFileSync(path.join(root, 'src/components/Eyewear3DARStage.tsx'), 'utf8');
  const stageSrc = fs.readFileSync(path.join(root, 'src/components/FaceTryOnStage.tsx'), 'utf8');
  const storefrontSrc = fs.readFileSync(path.join(root, 'src/pages/StorefrontPage.tsx'), 'utf8');
  const bulkProcSrc = fs.readFileSync(path.join(root, 'src/utils/bulkFrameProcessor.ts'), 'utf8');
  const merchantSrc = fs.readFileSync(path.join(root, 'src/pages/MerchantPage.tsx'), 'utf8');
  const graphicsSrc = fs.readFileSync(path.join(root, 'src/components/GlassesGraphics.tsx'), 'utf8');
  const pdpSrc = fs.readFileSync(path.join(root, 'src/components/ProductDetailsView.tsx'), 'utf8');
  const storeSrc = fs.readFileSync(path.join(root, 'src/services/optiverseStore.tsx'), 'utf8');
  const idbSrc = fs.readFileSync(path.join(root, 'src/utils/indexedDbStore.ts'), 'utf8');
  const pipelineSrc = fs.readFileSync(path.join(root, 'src/utils/glassesImagePipeline.ts'), 'utf8');
  const workerSrc = fs.readFileSync(path.join(root, 'src/workers/glassesImage.worker.ts'), 'utf8');
  const workerClientSrc = fs.readFileSync(path.join(root, 'src/utils/glassesWorkerClient.ts'), 'utf8');
  const pkgJson = fs.readFileSync(path.join(root, 'package.json'), 'utf8');

  assert.ok(bulkSrc.includes('FrameFitPreview') && bulkSrc.includes('PhotoUploadGuidelines'));
  assert.ok(
    bulkSrc.includes('نظارات طبية') &&
      bulkSrc.includes('نظارات شمسية') &&
      bulkSrc.includes('نظارات بغيار شمس') &&
      bulkSrc.includes('نظارات أطفال') &&
      bulkSrc.includes('شمس معادن / هاف فريم')
  );
  assert.ok(bulkSrc.includes('accept=".glb,.gltf"') && !bulkSrc.includes('عزل AI للخلفية'));
  assert.ok(bulkSrc.includes('multiple') && bulkSrc.includes('جاري التحسين') && bulkSrc.includes('إيقاف مؤقت / إلغاء'));
  assert.ok(bulkSrc.includes('اعتماد') && bulkSrc.includes('إعادة المعالجة') && bulkSrc.includes('isPublished: false'));
  assert.ok(
    bulkSrc.includes('أمامي كتالوج') &&
      bulkSrc.includes('جانبي 3/4') &&
      bulkSrc.includes('مفرّغة للتجربة') &&
      bulkSrc.includes("quality === 'check'")
  );
  assert.ok(bulkSrc.includes('عرض المزيد') && bulkSrc.includes('addProduct') && !bulkSrc.includes('.slice(0, 350)'));
  assert.ok(bulkSrc.includes('loading="lazy"') && bulkSrc.includes('decoding="async"'));

  assert.ok(wizardSrc2.includes('نظارات طبية (تفريغ العدسات تلقائياً)') && wizardSrc2.includes('نظارات شمسية (الحفاظ على لون العدسات)'));
  assert.ok(wizardSrc2.includes('اعتماد') && wizardSrc2.includes('إعادة المحاولة') && wizardSrc2.includes("quality === 'check'"));
  assert.ok(!wizardSrc2.includes('تحسين عزل خلفية مزدحمة'));

  assert.ok(previewSrc.includes('fitScale') && previewSrc.includes('eyeLineOffset') && previewSrc.includes('0.85') && previewSrc.includes('1.15') && previewSrc.includes('dir="ltr"'));
  assert.ok(previewSrc.includes('loading="lazy"') && previewSrc.includes('decoding="async"'));
  assert.ok(
    previewSrc.includes('النتيجة النهائية') &&
      previewSrc.includes('معاينة على الوجه') &&
      previewSrc.includes('#F8F7F4') &&
      previewSrc.includes('grid grid-cols-2 gap-2') &&
      !previewSrc.includes('للتجربة الحية (مفرّغة)')
  );
  assert.ok(graphicsSrc.includes('loading="lazy"') && graphicsSrc.includes('decoding="async"'));
  assert.ok(pdpSrc.includes('loading="lazy"') && pdpSrc.includes('decoding="async"'));
  assert.ok(merchantSrc.includes('MERCHANT_PAGE_SIZE = 24') && merchantSrc.includes('عرض المزيد'));
  assert.ok(storefrontSrc.includes('STORE_PAGE_SIZE = 24') && storefrontSrc.includes('عرض المزيد'));
  assert.ok(
    storeSrc.includes('idbSaveSnapshot') &&
      storeSrc.includes('idbLoadSnapshot') &&
      !storeSrc.includes('localStorage.setItem(STORAGE_KEY') &&
      idbSrc.includes('indexedDB') &&
      idbSrc.includes('idbGetCachedModel')
  );

  // Commercial-permissive open-source stack & Web Worker enforcement
  assert.ok(!pkgJson.includes('@imgly/background-removal') && pkgJson.includes('onnxruntime-web'));
  assert.ok(!pipelineSrc.includes('RMBG-1.4') && !pipelineSrc.includes('@imgly/background-removal'));
  assert.ok(
    pipelineSrc.includes('u2netp.onnx') &&
      pipelineSrc.includes("['webgpu', 'wasm']") &&
      pipelineSrc.includes("executionProviders: ['wasm']") &&
      pipelineSrc.includes('#F8F7F4') &&
      pipelineSrc.includes('image/webp') &&
      pipelineSrc.includes('idbGetCachedModel')
  );
  assert.ok(workerSrc.includes('processGlassesImage') && workerClientSrc.includes('glassesImage.worker.ts'));
  assert.ok(bulkProcSrc.includes('processGlassesImageInWorker') && !bulkProcSrc.includes('@imgly/background-removal'));

  assert.ok(faceTrackerSrc.includes('runningMode') && faceTrackerSrc.includes('numFaces: 1') && faceTrackerSrc.includes("delegate: 'GPU'") && faceTrackerSrc.includes("delegate: 'CPU'"));
  assert.ok(videoCanvasSrc.includes('OrthographicCamera') && videoCanvasSrc.includes('setSize(w, h, false)') && videoCanvasSrc.includes('setPixelRatio(1)'));
  assert.ok(videoCanvasSrc.includes('loopRef.current') && videoCanvasSrc.includes('lastVideoTimeRef') && videoCanvasSrc.includes('PlaneGeometry(1, planeH)'));
  assert.ok(videoCanvasSrc.includes('SRGBColorSpace') && videoCanvasSrc.includes('toneMapped: false') && videoCanvasSrc.includes('GLTFLoader'));
  assert.ok(videoCanvasSrc.includes('colorWrite: false') && videoCanvasSrc.includes('depthWrite: true'));
  assert.ok(videoCanvasSrc.includes('computePhysicalIrisFit') && videoCanvasSrc.includes('12'));
  assert.ok(videoCanvasSrc.includes('Face detected') && videoCanvasSrc.includes('No face — move closer, improve lighting') && videoCanvasSrc.includes('[TryOn]'));

  assert.ok(stageSrc.includes('VideoTryOnCanvas') && stageSrc.includes('aspect-[3/4] sm:aspect-[4/3]') && stageSrc.includes('scaleX(-1)'));
  assert.ok(stageSrc.includes('resolveTryOnFrontUrl') && stageSrc.includes('resolveStoreFrontUrl') && !stageSrc.includes('fixed bottom-0'));
  assert.ok(storefrontSrc.includes('#F8F9FA') && storefrontSrc.includes('جانبي 3/4') && storefrontSrc.includes('أمامي') && !storefrontSrc.includes('PD {pd}mm'));
  assert.ok(arStageSrc.includes('PlaneGeometry') && arStageSrc.includes('GLTFLoader'));

  console.log('✓ Test 10 passed: Permissive U²-Net WebGPU/WASM Worker, WebP studio+cutout, IndexedDB-only images, and approval gate verified');
}

// 11. Unit Tests for Pure Functions in glassesImagePipeline.ts
{
  // A. Downscaling cap at 1024px longest side
  assert.deepEqual(computeDownscaledDimensions(2400, 1200, 1024), { width: 1024, height: 512 });
  assert.deepEqual(computeDownscaledDimensions(800, 2000, 1024), { width: 410, height: 1024 });
  assert.deepEqual(computeDownscaledDimensions(640, 480, 1024), { width: 640, height: 480 });

  // B. EXIF Orientation parser (JPEG APP1 Exif big-endian orientation tag = 6)
  const fakeJpeg = new Uint8Array(64);
  fakeJpeg.set([0xff, 0xd8, 0xff, 0xe1, 0x00, 32], 0);
  // "Exif\0\0"
  fakeJpeg.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 6);
  // TIFF header MM (big endian), magic 42, IFD offset 8
  fakeJpeg.set([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08], 12);
  // IFD: 1 entry, tag 0x0112 (Orientation), type SHORT (3), count 1, value 6
  fakeJpeg.set([0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00], 20);
  assert.equal(parseExifOrientationFromBytes(fakeJpeg), 6, 'EXIF orientation tag 6 parsed cleanly');

  // C. Mask refinement (halo erosion + semi-transparent lens cavity) + PCA deskew + lighting normalization + quality check
  const w = 140;
  const h = 70;
  const rawOpt = makeImage(w, h, [242, 240, 236]);
  drawGlasses(rawOpt, w, h, [28, 32, 40], [242, 240, 236], 3);
  const bg = sampleOuterCornerMedianColor(rawOpt, w, h);
  const mask = buildFallbackForegroundMask(rawOpt, w, h, bg);
  const refOpt = refineGlassesMaskAndDecontaminate(rawOpt, mask, w, h, { category: 'med', outerBg: bg });

  const lensCenterIdx = (34 * w + 39) * 4;
  assert.ok(
    refOpt.refinedPixels[lensCenterIdx + 3] >= 15 && refOpt.refinedPixels[lensCenterIdx + 3] <= 45,
    `Optical lens cavity stays semi-transparent (alpha=${refOpt.refinedPixels[lensCenterIdx + 3]})`
  );
  assert.equal(refOpt.lensMaskPixels[lensCenterIdx + 3], 255, 'Lens mask highlights optical lens cavity');
  assert.equal(refOpt.refinedPixels[(2 * w + 2) * 4 + 3], 0, 'Exterior background stays fully transparent');

  // Lighting normalization lifts dim/cast foreground
  const normRes = normalizeLightingAutoLevelsGrayWorld(refOpt.refinedPixels, w, h);
  assert.equal(normRes.applied, true, 'Auto-levels & gray-world normalization executes on foreground');

  // Quality assessment returns 'good' on crisp dark frame
  const qGood = assessGlassesSegmentationQuality(refOpt.refinedPixels, rawOpt, w, h, bg, 'webgpu');
  assert.equal(qGood.quality, 'good', `Well-contrasted dark frame passes as quality='good' (reasons=${qGood.reasons.join(',')})`);

  // Low-contrast transparent crystal frame triggers quality='check'
  const rawClear = makeImage(w, h, [238, 238, 238]);
  drawGlasses(rawClear, w, h, [215, 220, 225], [238, 238, 238], 4);
  const clearMask = new Uint8Array(w * h);
  for (let y = 18; y <= 50; y++) {
    for (let x = 20; x <= 58; x++) clearMask[y * w + x] = 220;
    for (let x = 82; x <= 120; x++) clearMask[y * w + x] = 220;
  }
  const refClear = refineGlassesMaskAndDecontaminate(rawClear, clearMask, w, h, {
    category: 'med',
    outerBg: { r: 238, g: 238, b: 238 },
  });
  const qCheck = assessGlassesSegmentationQuality(
    refClear.refinedPixels,
    rawClear,
    w,
    h,
    { r: 238, g: 238, b: 238 },
    'wasm'
  );
  assert.equal(qCheck.quality, 'check', 'Transparent low-contrast frame triggers quality="check"');
  assert.ok(Boolean(qCheck.noteAr), 'Quality check supplies Arabic review note');

  // PCA principal-axis deskew detects tilted frame
  const pcaArr = new Uint8ClampedArray(120 * 80 * 4);
  paintRect(pcaArr, 120, 80, 12, 22, 46, 40, [20, 20, 20]);
  paintRect(pcaArr, 120, 80, 74, 30, 108, 48, [20, 20, 20]);
  const pcaAngle = computePrincipalAxisAngleDeg(pcaArr, 120, 80);
  assert.ok(Math.abs(pcaAngle) >= 3 && Math.abs(pcaAngle) <= 10, `PCA deskew detects frame tilt cleanly (got ${pcaAngle}°)`);

  console.log('✓ Test 11 passed: Downscaling, EXIF parser, halo erosion, optical translucency, PCA deskew, light normalization & quality check verified');
}

// 12. OptiVerse v5 5-Mode Upload, Chroma-Key/BFS Worker, WebGPU Try-On, Canvas Portrait Try-On & Storefront/PDP Reviews Checks
{
  const root = process.cwd();

  // A. Chroma-key detection (#0000FF blue, #00FF00 green, #FF00FF magenta, vs natural photo)
  const w = 140;
  const h = 70;
  const blueBg = makeImage(w, h, [0, 0, 255]);
  drawGlasses(blueBg, w, h, [32, 32, 32], [0, 0, 255], 3);
  const detBlue = detectChromaKeyColor(blueBg, w, h);
  assert.equal(detBlue.kind, 'blue', 'Detects pure blue chroma key');

  const greenBg = makeImage(w, h, [0, 255, 0]);
  const detGreen = detectChromaKeyColor(greenBg, w, h);
  assert.equal(detGreen.kind, 'green', 'Detects pure green chroma key');

  const magentaBg = makeImage(w, h, [255, 0, 255]);
  const detMagenta = detectChromaKeyColor(magentaBg, w, h);
  assert.equal(detMagenta.kind, 'magenta', 'Detects pure magenta chroma key');

  const warmWallBg = makeImage(w, h, [242, 238, 230]);
  const detNone = detectChromaKeyColor(warmWallBg, w, h);
  assert.equal(detNone.kind, null, 'Returns null for non-chroma natural studio/room walls');

  // B. applyChromaKeyAndDespill (45/95 standard vs 35/75 metal + despill)
  const metalBlue = makeImage(w, h, [0, 0, 255]);
  drawGlasses(metalBlue, w, h, [190, 160, 90], [0, 0, 255], 2);
  // Subtle blue spill along top wire pixel (dist = 42 -> transparent in standard <45, semi-opaque in metal >35)
  metalBlue[(18 * w + 38) * 4] = 20;
  metalBlue[(18 * w + 38) * 4 + 1] = 20;
  metalBlue[(18 * w + 38) * 4 + 2] = 223; // dist ~ 42.7
  const stdKeyed = applyChromaKeyAndDespill(metalBlue, w, h, 'blue', { r: 0, g: 0, b: 255 }, 'prescription');
  const metalKeyed = applyChromaKeyAndDespill(metalBlue, w, h, 'blue', { r: 0, g: 0, b: 255 }, 'metal');
  assert.equal(stdKeyed[(18 * w + 38) * 4 + 3], 0, 'Standard mode keys dist<45');
  assert.ok(metalKeyed[(18 * w + 38) * 4 + 3] > 0, 'Metal mode preserves thin faint rim above dist=35');

  // Edge despill strips excess blue spill when blue fringe hits rim (within key edge distance)
  metalBlue[(19 * w + 38) * 4] = 45;
  metalBlue[(19 * w + 38) * 4 + 1] = 40;
  metalBlue[(19 * w + 38) * 4 + 2] = 215;
  const despilled = applyChromaKeyAndDespill(metalBlue, w, h, 'blue', { r: 0, g: 0, b: 255 }, 'metal');
  const dIdx = (19 * w + 38) * 4;
  assert.ok(
    despilled[dIdx + 2] <= Math.max(despilled[dIdx], despilled[dIdx + 1]),
    'Blue channel despilled to max(R, G)'
  );

  // C. applyBfsLensFloodFill (>=3% -> alpha=20 sheen, <3% -> alpha=0, sunglasses skip)
  const bfsOptical = applyBfsLensFloodFill(stdKeyed, w, h, { skipSunglasses: false });
  assert.equal(bfsOptical.pixels[(3 * w + 3) * 4 + 3], 0, 'Border-connected background is alpha=0');
  assert.equal(bfsOptical.pixels[(34 * w + 39) * 4 + 3], 20, 'Enclosed optical lens >=3% receives alpha=20 glass sheen');

  const sunKeyed = makeImage(w, h, [0, 0, 255]);
  drawGlasses(sunKeyed, w, h, [20, 20, 20], [45, 85, 160], 4);
  const sunDespilled = applyChromaKeyAndDespill(sunKeyed, w, h, 'blue', { r: 0, g: 0, b: 255 }, 'sunglasses');
  const bfsSun = applyBfsLensFloodFill(sunDespilled, w, h, { skipSunglasses: true });
  assert.equal(bfsSun.pixels[(34 * w + 39) * 4 + 3], 255, 'Sunglasses tinted lens keeps original alpha=255');

  // D. Median rim hex + crop + aspect ratio validator
  const med = computeMedianFrameHexAndOpacity(bfsSun.pixels, w, h);
  assert.ok(med.frameHexColor.startsWith('#') && med.frameOpacity === 1.0);
  const tight = computeTightCropBounds(bfsSun.pixels, w, h, 8, 45);
  assert.equal(tight.minX, 12);
  assert.equal(tight.maxX, 128);
  assert.equal(validateEyewearAspectRatio(1200, 480).valid, true);
  assert.equal(validateEyewearAspectRatio(400, 400).valid, false);

  // E. Module 4 & 5 UI Integration Checks
  const videoTryOnSrc = fs.readFileSync(path.join(root, 'src/components/VideoTryOnCanvas.tsx'), 'utf8');
  const photoTryOnSrc = fs.readFileSync(path.join(root, 'src/components/CustomerPhotoTryOn.tsx'), 'utf8');
  const storefrontSrc = fs.readFileSync(path.join(root, 'src/pages/StorefrontPage.tsx'), 'utf8');
  const pdpSrc = fs.readFileSync(path.join(root, 'src/components/ProductDetailsView.tsx'), 'utf8');
  const bulkSrc = fs.readFileSync(path.join(root, 'src/components/BulkFrameUploader.tsx'), 'utf8');

  assert.ok(
    videoTryOnSrc.includes('WebGPURenderer') &&
      videoTryOnSrc.includes('0.012') &&
      videoTryOnSrc.includes('0.48') &&
      videoTryOnSrc.includes('0.85') &&
      videoTryOnSrc.includes('0.9') &&
      videoTryOnSrc.includes('0.72') &&
      videoTryOnSrc.includes('تركيب غيار الشمس'),
    'VideoTryOnCanvas implements WebGPU + WebGL fallback, thin metal temples, kids 0.90 scale / 0.72 temples, and Clip-On toggle'
  );

  assert.ok(
    photoTryOnSrc.includes('التجربة على صورتك بالكانفاس') &&
      photoTryOnSrc.includes('رفع روشتة كشف النظر') &&
      photoTryOnSrc.includes('تكبير وتصغير') &&
      photoTryOnSrc.includes('تدوير') &&
      photoTryOnSrc.includes('إعادة التوسيط') &&
      photoTryOnSrc.includes('تحميل الصورة') &&
      photoTryOnSrc.includes('capture="user"'),
    'CustomerPhotoTryOn implements full 2D Canvas interactive portrait try-on and Rx upload'
  );

  assert.ok(
    storefrontSrc.includes('initialFrameId') &&
      storefrontSrc.includes('بغيار شمس') &&
      storefrontSrc.includes('أطفال') &&
      storefrontSrc.includes('معادن') &&
      storefrontSrc.includes('جرّب على وجهك') &&
      storefrontSrc.includes('/s/'),
    'StorefrontPage supports /s/[slug]/f/[frameId] routing, 6 category filters, and Try-On CTAs on #F8F9FA'
  );

  assert.ok(
    pdpSrc.includes('الوضع الطبي') &&
      pdpSrc.includes('بغيار الشمس') &&
      pdpSrc.includes('addProductReview') &&
      pdpSrc.includes('إرسال التقييم'),
    'ProductDetailsView implements Clip-On gallery switch, Rx trigger, and 1-5 Star Reviews UI'
  );

  assert.ok(
    bulkSrc.includes('تنبيه: كل نظارة بغيار شمس تتطلب صورتين (بدون الغيار + بالغيار).') &&
      bulkSrc.includes('saveDraftFrame') &&
      bulkSrc.includes('loadDraftFrames'),
    'BulkFrameUploader implements Clip-On even-pair guard and IndexedDB draft persistence'
  );

  console.log('✓ Test 12 passed: Chroma-Key/BFS cutoutWorker, WebGPU + Kids/Metal/Clip-On Try-On, Canvas Portrait Try-On, & Storefront/PDP Reviews verified');
}

// 13. Single-Call 16:9 Split Sheet Server Route + Vertical 50/50 Slicing + Studio Shadow Trim
{
  const root = process.cwd();

  // A. Pure vertical split calculation (even & odd widths)
  const split16x9 = computeVerticalSplitRegions(1920, 1080);
  assert.equal(split16x9.midX, 960);
  assert.deepEqual(split16x9.left, { x: 0, y: 0, width: 960, height: 1080 });
  assert.deepEqual(split16x9.right, { x: 960, y: 0, width: 960, height: 1080 });

  const splitOdd = computeVerticalSplitRegions(1377, 775);
  assert.equal(splitOdd.left.width + splitOdd.right.width, 1377);
  assert.equal(splitOdd.right.x, splitOdd.midX);

  // B. Right-half #F8F9FA studio whitespace trim preserves soft bottom contact shadow
  const rw = 160;
  const rh = 120;
  const rightPanel = makeImage(rw, rh, [248, 249, 250]); // #F8F9FA
  // Paint frame at x=40..120, y=30..75
  paintRect(rightPanel, rw, rh, 40, 30, 120, 75, [30, 30, 34]);
  // Paint soft bottom contact shadow at x=44..116, y=82..88 (#E2E4E8, dist ~ 30 from #F8F9FA)
  paintRect(rightPanel, rw, rh, 44, 82, 116, 88, [226, 228, 232]);

  const trimBounds = trimStudioWhitespaceBounds(rightPanel, rw, rh, 12);
  assert.equal(trimBounds.minX, 28, 'Trims outer left whitespace while keeping 12px pad');
  assert.equal(trimBounds.maxX, 132, 'Trims outer right whitespace while keeping 12px pad');
  assert.equal(trimBounds.minY, 18, 'Trims outer top whitespace while keeping 12px pad');
  assert.equal(trimBounds.maxY, 100, 'Preserves soft bottom contact shadow (y=88 + 12px pad = 100)');

  // C. Synthetic 16:9 Split Sheet left-half chroma-key + BFS clear lens verification
  const sheetW = 280;
  const sheetH = 70;
  const half = computeVerticalSplitRegions(sheetW, sheetH);
  assert.equal(half.left.width, 140);
  const leftBuf = makeImage(half.left.width, half.left.height, [0, 0, 255]);
  drawGlasses(leftBuf, half.left.width, half.left.height, [215, 220, 228], [0, 0, 255], 3);
  const det = detectChromaKeyColor(leftBuf, half.left.width, half.left.height);
  assert.equal(det.kind, 'blue');
  const keyed = applyChromaKeyAndDespill(leftBuf, half.left.width, half.left.height, 'blue', det.rgb, 'prescription');
  const bfs = applyBfsLensFloodFill(keyed, half.left.width, half.left.height, { skipSunglasses: false });
  assert.equal(bfs.pixels[(34 * 140 + 39) * 4 + 3], 20, 'Left-half split lens hollowed to optical sheen alpha=20');

  // D. Server, Metadata, Package & Client Isolation Verification
  const serverSrc = fs.readFileSync(path.join(root, 'api/index.ts'), 'utf8');
  const splitApiSrc = fs.readFileSync(path.join(root, 'src/utils/splitSheetApi.ts'), 'utf8');
  const workerSrc = fs.readFileSync(path.join(root, 'src/workers/cutoutWorker.ts'), 'utf8');
  const clientSrc = fs.readFileSync(path.join(root, 'src/utils/cutoutWorkerClient.ts'), 'utf8');
  const bulkSrc = fs.readFileSync(path.join(root, 'src/components/BulkFrameUploader.tsx'), 'utf8');
  const metaJson = fs.readFileSync(path.join(root, 'metadata.json'), 'utf8');
  const pkgJson = fs.readFileSync(path.join(root, 'package.json'), 'utf8');

  const splitFnStart = serverSrc.indexOf('async function generateSplitSheetWithFallback');
  const splitFnEnd = serverSrc.indexOf('export function createEyewearServerApp');
  const splitFnSrc = serverSrc.slice(splitFnStart, splitFnEnd);

  assert.ok(
    serverSrc.includes('/api/eyewear/split-sheet') &&
      serverSrc.includes("model: 'gemini-3.1-flash-lite-image'") ||
      splitFnSrc.includes("'gemini-3.1-flash-lite-image'") &&
      splitFnSrc.includes("aspectRatio: '16:9'") &&
      serverSrc.includes("'User-Agent': 'aistudio-build'") &&
      !splitFnSrc.includes('responseMimeType') &&
      !splitFnSrc.includes('responseSchema'),
    'server.ts calls gemini-3.1-flash-lite-image with 16:9 aspectRatio and required telemetry User-Agent without responseMimeType on image call'
  );
  assert.ok(
    serverSrc.includes('gemini-2.5-flash-lite') &&
      serverSrc.includes('shared_eyewear_cache') &&
      serverSrc.includes('authenticateRequest'),
    'server.ts enforces JWT/credit guard, free OCR model, and global shared catalog cache'
  );
  assert.ok(
    !splitApiSrc.includes('@google/genai') &&
      !splitApiSrc.includes('GEMINI_API_KEY') &&
      splitApiSrc.includes('/api/eyewear/split-sheet'),
    'splitSheetApi.ts stays clean of SDK keys and calls server route'
  );
  assert.ok(
    workerSrc.includes('splitSheetFile') &&
      workerSrc.includes('computeVerticalSplitRegions') &&
      workerSrc.includes('trimStudioWhitespaceBounds') &&
      clientSrc.includes('splitSheetFile'),
    'cutoutWorker + client implement vertical split-sheet slicing'
  );
  assert.ok(
    bulkSrc.includes('generateSplitSheetViaServer') &&
      metaJson.includes('MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API') &&
      pkgJson.includes('"start": "node server.ts"') &&
      pkgJson.includes('"dev": "tsx server.ts"'),
    'BulkFrameUploader, metadata.json, and package.json configured for full-stack 16:9 split pipeline'
  );

  console.log('✓ Test 13 passed: Single-call 16:9 split-sheet server, vertical 50/50 slicing, shadow trim, & full-stack wiring verified');
}

// 14. Production SaaS Upgrade Verification: Crystal Cutout, Color Variants, Plans/Flags, Directory, Admin Demo & Merchant CRM/Onboarding
{
  const root = process.cwd();

  // A. Crystal white-bg cutout preserves crystal acetate border and clears outer background
  const cw = 80;
  const ch = 40;
  const crystalBuf = makeImage(cw, ch, [255, 255, 255]);
  // Draw slightly shaded neutral crystal rim around frame
  paintRect(crystalBuf, cw, ch, 16, 10, 64, 30, [205, 210, 218]);
  // Inner lens remains white/clear
  paintRect(crystalBuf, cw, ch, 20, 14, 36, 26, [255, 255, 255]);
  paintRect(crystalBuf, cw, ch, 44, 14, 60, 26, [255, 255, 255]);
  const crystalOut = extractWhiteBgCrystalCutout(crystalBuf, cw, ch);
  assert.equal(crystalOut[(2 * cw + 2) * 4 + 3], 0, 'Outer pure white background removed to alpha=0');
  assert.ok(crystalOut[(12 * cw + 24) * 4 + 3] > 100, 'Crystal rim pixel stays visible');

  // B. Color variant generator re-tints opaque frame pixels while keeping transparent bg intact
  const tw = 24;
  const th = 24;
  const tintSrc = new Uint8ClampedArray(tw * th * 4);
  paintRect(tintSrc, tw, th, 4, 4, 20, 20, [140, 140, 140]);
  const tintedBlue = generateColorTintedVariantPixels(tintSrc, tw, th, '#2563EB');
  assert.equal(tintedBlue[(1 * tw + 1) * 4 + 3], 0, 'Transparent exterior remains untouched');
  const pxB = (12 * tw + 12) * 4;
  assert.ok(tintedBlue[pxB + 2] > tintedBlue[pxB], 'Blue channel dominates when tinted to #2563EB');

  // C. Default-OFF Feature Flags & Plan Caps + Top-up
  assert.equal(PLATFORM_SETTINGS0.enablePrescriptionLenses, false);
  assert.equal(PLATFORM_SETTINGS0.allowMerchantLensBrandingToggle, false);
  assert.equal(PLATFORM_SETTINGS0.enableSponsoredSuppliers, false);
  assert.equal(PLANS0.length, 3);

  const basicShop = {
    id: 's1',
    name: 'Basic Shop',
    city: 'القاهرة',
    planTier: 'basic' as const,
    plan: 'الأساسية',
    days: 14,
    status: 'active' as const,
    exp: 'شهر',
    slug: 'basic',
    price: 599,
    color: '#0284C7',
    wa: '01000000000',
    logo: '👓',
    topupCredits: 50,
  };
  assert.equal(getShopMaxProducts(basicShop, PLATFORM_SETTINGS0), 150, 'Basic 100 + 50 topup = 150');
  assert.equal(
    getShopMaxProducts({ ...basicShop, isDemoAdminStore: true }, PLATFORM_SETTINGS0),
    1000,
    'Admin Demo Store receives 1000 maxProducts'
  );

  // D. New & Upgraded Pages Wiring Check
  const appSrc = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  const dirSrc = fs.readFileSync(path.join(root, 'src/pages/DirectoryPage.tsx'), 'utf8');
  const adminSrc = fs.readFileSync(path.join(root, 'src/pages/AdminPage.tsx'), 'utf8');
  const merchantSrc = fs.readFileSync(path.join(root, 'src/pages/MerchantPage.tsx'), 'utf8');
  const storefrontSrc = fs.readFileSync(path.join(root, 'src/pages/StorefrontPage.tsx'), 'utf8');
  const pdpSrc = fs.readFileSync(path.join(root, 'src/components/ProductDetailsView.tsx'), 'utf8');
  const bulkSrc = fs.readFileSync(path.join(root, 'src/components/BulkFrameUploader.tsx'), 'utf8');

  assert.ok(appSrc.includes("'/stores'") && appSrc.includes('DirectoryPage'), 'App.tsx routes /stores to DirectoryPage');
  assert.ok(dirSrc.includes('EGYPT_GOVERNORATES') && dirSrc.includes('متجر مميز'), 'DirectoryPage filters governorates and prioritizes featured stores');
  assert.ok(
    adminSrc.includes('switchToAdminDemoStore') &&
      adminSrc.includes('enablePrescriptionLenses') &&
      adminSrc.includes('allowMerchantLensBrandingToggle') &&
      adminSrc.includes('enableSponsoredSuppliers') &&
      adminSrc.includes('enableStoresDirectory') &&
      adminSrc.includes('landingPreviewFrames'),
    'AdminPage exposes demo store toggle, directory toggle, landing preview frames & all global feature flags'
  );
  assert.ok(
    merchantSrc.includes('signInWithPhoneOtp') &&
      merchantSrc.includes('onboardingCompleted') &&
      merchantSrc.includes('markCrmRecallSent') &&
      merchantSrc.includes('addTopUpCredits') &&
      merchantSrc.includes('STORE_THEMES') &&
      merchantSrc.includes('/api/merchant/generate-logo') &&
      merchantSrc.includes('mobileMode="dock"'),
    'MerchantPage implements Phone OTP, onboarding gate, CRM 6m/12m recalls, top-up packs, Store Themes, AI logo, and bottom dock'
  );
  assert.ok(
    storefrontSrc.includes('enablePrescriptionLenses') &&
      storefrontSrc.includes('resolveStoreTheme') &&
      pdpSrc.includes('enablePrescriptionLenses') &&
      pdpSrc.includes('salePrice'),
    'StorefrontPage & ProductDetailsView gate Rx UI cleanly, apply merchant theme, and render salePrice'
  );
  assert.ok(
    bulkSrc.includes('MAX_BATCH_SIZE = 50') &&
      bulkSrc.includes('submitBatchSplitSheetViaServer') &&
      bulkSrc.includes('extractOpticalDimensionsViaServer') &&
      bulkSrc.includes('generateTintedCatalogAsset'),
    'BulkFrameUploader implements 50-item batch limit, 1-tap category cards, OCR, and $0 Auto-Color variants'
  );

  console.log('✓ Test 14 passed: Crystal white-bg cutout, $0 tint variants, default-OFF flags, plan caps, Directory, Admin Demo, & CRM/OTP verified');
}

// 15. Precision Upgrade: Solid vs Patterned Variance, Cache Isolation, Warby Parker Storefront, 2-Frame Comparison, A/B Polls, Merchant 2-Photo Cards & Landing Portrait
{
  const root = process.cwd();

  // A. Solid vs Patterned frame color variance detection
  const vw = 80;
  const vh = 40;
  const solidBuf = makeImage(vw, vh, [248, 249, 250]);
  paintRect(solidBuf, vw, vh, 10, 10, 70, 30, [24, 24, 28]);
  const solidAnalysis = analyzeRgbaFrameColorVariance(solidBuf, vw, vh);
  assert.equal(solidAnalysis.isPatterned, false, 'Uniform black frame detected as non-patterned solid');

  const patternBuf = makeImage(vw, vh, [248, 249, 250]);
  // Multi-hue tortoise / striped pattern across frame body
  paintRect(patternBuf, vw, vh, 10, 10, 30, 30, [220, 140, 20]);
  paintRect(patternBuf, vw, vh, 31, 10, 50, 30, [30, 18, 12]);
  paintRect(patternBuf, vw, vh, 51, 10, 70, 30, [15, 110, 195]);
  const patternAnalysis = analyzeRgbaFrameColorVariance(patternBuf, vw, vh);
  assert.equal(patternAnalysis.isPatterned, true, 'Multi-color tortoise/striped frame detected as patterned');

  // B. Server cache keys separate pat1 vs pat0 cleanly
  const solidKey = buildSharedCacheKeys({
    modelCode: 'RB3025',
    frameColor: '#111827',
    phash: 'abcd1234abcd1234',
    keepLensBranding: false,
    isPatterned: false,
  });
  const patKey = buildSharedCacheKeys({
    modelCode: 'RB3025',
    frameColor: '#111827',
    phash: 'abcd1234abcd1234',
    keepLensBranding: false,
    isPatterned: true,
  });
  assert.ok(solidKey.primaryKey.endsWith(':pat0') && solidKey.phashKey.endsWith(':pat0'));
  assert.ok(patKey.primaryKey.endsWith(':pat1') && patKey.phashKey.endsWith(':pat1'));
  assert.notEqual(solidKey.primaryKey, patKey.primaryKey);

  // C. Wiring assertions across server, storefront, PDP, modals, merchant & landing
  const serverSrc = fs.readFileSync(path.join(root, 'api/index.ts'), 'utf8');
  const bulkSrc = fs.readFileSync(path.join(root, 'src/components/BulkFrameUploader.tsx'), 'utf8');
  const storefrontSrc = fs.readFileSync(path.join(root, 'src/pages/StorefrontPage.tsx'), 'utf8');
  const pdpSrc = fs.readFileSync(path.join(root, 'src/components/ProductDetailsView.tsx'), 'utf8');
  const modalsSrc = fs.readFileSync(path.join(root, 'src/components/Modals.tsx'), 'utf8');
  const merchantSrc = fs.readFileSync(path.join(root, 'src/pages/MerchantPage.tsx'), 'utf8');
  const landingSrc = fs.readFileSync(path.join(root, 'src/pages/LandingPage.tsx'), 'utf8');
  const cssSrc = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');

  assert.ok(
    serverSrc.includes('!params.isPatterned && keys.modelCode') && serverSrc.includes('solidModelTemplate'),
    'server.ts blocks solid recoloring shortcut for patterned frames'
  );
  assert.ok(
    bulkSrc.includes('computeFrameColorVariance') &&
      bulkSrc.includes('solidModelTemplate') &&
      bulkSrc.includes('autoGroupColors = true') &&
      !bulkSrc.includes('تجميع الألوان التلقائي (توفير AI)'),
    'BulkFrameUploader silently auto-groups solid siblings and guards patterned frames'
  );
  assert.ok(
    storefrontSrc.includes('أنت الآن في وضع المعاينة كعميل') &&
      storefrontSrc.includes('العودة للوحة التحكم') &&
      storefrontSrc.includes('shop.videoUrl') &&
      storefrontSrc.includes('مجموعة النظارات الكاملة') &&
      storefrontSrc.includes('وصل حديثاً') &&
      storefrontSrc.includes('تسوّق حسب شكل الإطار') &&
      storefrontSrc.includes('تسوّق حسب الفئة واللون') &&
      storefrontSrc.includes('cardSelectedColors') &&
      storefrontSrc.includes('compareModalOpen') &&
      storefrontSrc.includes('قارن بين النظارتين الآن') &&
      storefrontSrc.includes("params.get('poll')"),
    'StorefrontPage implements Warby Parker editorial layout, live swatches, 2-frame comparison, and A/B poll deep-linking'
  );
  assert.ok(
    pdpSrc.includes('الصورة الأمامية (بالوش)') &&
      pdpSrc.includes('الصورة الجانبية (بالجنب 3/4)') &&
      pdpSrc.includes('أشكال الوجه المناسبة') &&
      pdpSrc.includes('مشاركة للأصدقاء') &&
      pdpSrc.includes('اطلب الآن عبر واتساب'),
    'ProductDetailsView implements 2-photo swipeable gallery, face-shape fit, share & WhatsApp CTA'
  );
  assert.ok(
    modalsSrc.includes('p2?: Product') &&
      modalsSrc.includes('اسأل أصدقاءك: أيهما أحلى عليّ؟') &&
      modalsSrc.includes('تغيير الصورة') &&
      modalsSrc.includes('حفظ التعديلات'),
    'Modals implements A/B VoteModal and simplified 5-field QuickEditProductModal'
  );
  assert.ok(
    merchantSrc.includes('?preview=1') &&
      merchantSrc.includes('أكثر النظارات تجربةً وطلبًا من عملائك') &&
      merchantSrc.includes('بالوش') &&
      merchantSrc.includes('بالجنب'),
    'MerchantPage exposes ?preview=1 return flow, radar copy, and 2-photo product cards'
  );
  assert.ok(
    landingSrc.includes('landing_editorial_portrait') &&
      landingSrc.includes('تفاصيل الباقات') &&
      cssSrc.includes('chevron-pulse-') &&
      cssSrc.includes('pricing-arrive-glow'),
    'LandingPage & index.css include studio portrait alignment, triple-chevron scroll, and arrival glow'
  );

  console.log('✓ Test 15 passed: Pattern/solid variance, cache isolation, Warby Parker storefront, 2-frame comparison, A/B polls & 1-screen merchant edit verified');
}

// 16. Complete Optical Lens Matrix & Sponsorship Engine Verification
{
  const root = process.cwd();

  // A. Global default-OFF master flags
  assert.equal(PLATFORM_SETTINGS0.enableLensesSystem, false, 'enableLensesSystem defaults to false');
  assert.equal(PLATFORM_SETTINGS0.enablePrescriptionLenses, false, 'enablePrescriptionLenses defaults to false');

  // B. Two-track seeded brands & exact 6 categories / refractive indices
  const svBrands = DEFAULT_OFFICIAL_LENS_BRANDS.filter((b) => b.track === 'single_vision');
  const labBrands = DEFAULT_OFFICIAL_LENS_BRANDS.filter((b) => b.track === 'custom_lab');
  assert.ok(
    ['Pixel', 'Kodak', 'Scope', 'HCL', 'Best', 'Biven', 'Square'].every((n) =>
      svBrands.some((b) => b.nameEn.includes(n))
    ),
    'Track A seeds Pixel, Kodak, Scope, HCL, Best, Biven, and Square'
  );
  assert.ok(
    ['Kodak', 'Pixel', 'Scope', 'HCL'].every((n) =>
      labBrands.some((b) => b.nameEn.includes(n) && typeof b.estimatedDays === 'number' && b.estimatedDays > 0)
    ),
    'Track B seeds custom lab brands with estimatedDays'
  );
  assert.equal(LENS_CATEGORIES.length, 6, 'Exact 6 optical lens categories defined');

  const whiteMeta = LENS_CATEGORIES.find((c) => c.key === 'white_plastic')!;
  const arMeta = LENS_CATEGORIES.find((c) => c.key === 'anti_reflection')!;
  const blueMeta = LENS_CATEGORIES.find((c) => c.key === 'blue_cut')!;
  const photoMeta = LENS_CATEGORIES.find((c) => c.key === 'photochromic')!;
  const nightMeta = LENS_CATEGORIES.find((c) => c.key === 'night_drive')!;
  const triMeta = LENS_CATEGORIES.find((c) => c.key === 'three_in_one')!;

  assert.equal(blueMeta.nameAr, 'بلو كات', 'Blue Cut is cleanly labeled بلو كات');
  assert.deepEqual(whiteMeta.indices, ['1.56', '1.60', '1.67', '1.74']);
  assert.deepEqual(arMeta.indices, ['1.56', '1.60', '1.67', '1.74']);
  assert.deepEqual(blueMeta.indices, ['1.56', '1.60', '1.67', '1.74']);
  assert.deepEqual(photoMeta.indices, ['1.56', '1.60', '1.67']);
  assert.deepEqual(photoMeta.variants, ['photo_grey', 'photo_brown']);
  assert.deepEqual(nightMeta.indices, ['1.56', '1.60', '1.67']);
  assert.deepEqual(triMeta.indices, ['1.56', '1.60', '1.67']);
  assert.deepEqual(triMeta.variants, ['photo_grey', 'photo_brown']);

  // C. Admin variance clamping (±allowedVariancePct%)
  const clampedLow = clampMerchantPriceToVariance(100, 1000, 20);
  const clampedHigh = clampMerchantPriceToVariance(1500, 1000, 20);
  const withinOk = clampMerchantPriceToVariance(1150, 1000, 20);
  assert.equal(clampedLow.clamped, 800);
  assert.equal(clampedLow.isOutOfBounds, true);
  assert.equal(clampedHigh.clamped, 1200);
  assert.equal(clampedHigh.isOutOfBounds, true);
  assert.equal(withinOk.clamped, 1150);
  assert.equal(withinOk.isOutOfBounds, false);

  // D. Priority ordering: Official/sponsored brands strictly precede Custom merchant brands & honor ON/OFF + store_decide
  const cellKey160 = makeMatrixCellKey('blue_cut', 'none', '1.60');
  const testShopId = 'test-shop-matrix';
  const merchantCfgs = [
    {
      shopId: testShopId,
      brandId: 'custom-local-1',
      track: 'single_vision' as const,
      isCustomBrand: true,
      nameAr: 'معمل النخبة الخاص',
      nameEn: 'Elite Custom',
      isEnabled: true,
      prices: {
        [makeMatrixCellKey('blue_cut', 'none', '1.56')]: { enabled: true, price: 320 },
        [cellKey160]: { enabled: true, price: 480 },
      },
    },
    {
      shopId: testShopId,
      brandId: 'sv-best',
      track: 'single_vision' as const,
      isCustomBrand: false,
      isEnabled: false, // Toggled OFF by merchant
      prices: {},
    },
  ];

  const rowsCheck = resolveMerchantBrandRowsForTrack(
    DEFAULT_OFFICIAL_LENS_BRANDS,
    merchantCfgs,
    testShopId,
    'single_vision'
  );
  assert.equal(rowsCheck.officialRows[0].brandId, 'sv-pixel', 'Official priority #1 stays at top');
  assert.equal(rowsCheck.customRows[0].brandId, 'custom-local-1');

  const custExact = resolveCustomerLensBrands({
    officialBrands: DEFAULT_OFFICIAL_LENS_BRANDS,
    merchantConfigs: merchantCfgs,
    shopId: testShopId,
    track: 'single_vision',
    categoryKey: 'blue_cut',
    variant: 'none',
    indexOrStoreDecide: '1.60',
  });
  assert.equal(custExact[0].brandId, 'sv-pixel', 'Official Sponsor renders first for customer');
  assert.equal(custExact[0].sponsorBadge, 'official_sponsor');
  assert.ok(!custExact.some((b) => b.brandId === 'sv-best'), 'Disabled merchant brand hidden from customers');
  assert.equal(
    custExact[custExact.length - 1].brandId,
    'custom-local-1',
    'Merchant custom brand strictly appears AFTER official/sponsored brands'
  );

  const custStoreDecide = resolveCustomerLensBrands({
    officialBrands: DEFAULT_OFFICIAL_LENS_BRANDS,
    merchantConfigs: merchantCfgs,
    shopId: testShopId,
    track: 'single_vision',
    categoryKey: 'blue_cut',
    variant: 'none',
    indexOrStoreDecide: 'store_decide',
  });
  assert.equal(custStoreDecide[0].isStoreDecide, true);
  assert.ok(custStoreDecide[0].maxPrice > custStoreDecide[0].minPrice, 'Store-decide exposes price range');

  // E. UI & Migration Wiring Verification
  const adminSrc = fs.readFileSync(path.join(root, 'src/pages/AdminPage.tsx'), 'utf8');
  const adminLensSrc = fs.readFileSync(path.join(root, 'src/components/AdminLensMatrixManager.tsx'), 'utf8');
  const merchantSrc = fs.readFileSync(path.join(root, 'src/pages/MerchantPage.tsx'), 'utf8');
  const merchantLensSrc = fs.readFileSync(path.join(root, 'src/components/MerchantLensMatrixManager.tsx'), 'utf8');
  const storefrontSrc = fs.readFileSync(path.join(root, 'src/pages/StorefrontPage.tsx'), 'utf8');
  const pdpSrc = fs.readFileSync(path.join(root, 'src/components/ProductDetailsView.tsx'), 'utf8');
  const mig008Src = fs.readFileSync(path.join(root, 'supabase/migrations/008_optical_lens_matrix.sql'), 'utf8');

  assert.ok(
    adminSrc.includes('تفعيل نظام العدسات الطبية والرعاة') &&
      adminSrc.includes('AdminLensMatrixManager') &&
      adminLensSrc.includes('SPONSOR_BADGE_LABELS.official_sponsor') &&
      adminLensSrc.includes('السعر الشائع في السوق (ج.م)'),
    'AdminPage & AdminLensMatrixManager wire global toggle, priority, sponsor badge, variance & market price'
  );
  assert.ok(
    merchantSrc.includes('العدسات الطبية — قريباً ✨') &&
      merchantSrc.includes('MerchantLensMatrixManager') &&
      merchantLensSrc.includes('+ إضافة شركة عدسات خاصة بمحلي') &&
      merchantLensSrc.includes('clampMerchantPriceToVariance'),
    'MerchantPage & MerchantLensMatrixManager implement pre-launch teaser and variance-clamped lens pricing'
  );
  assert.ok(
    storefrontSrc.includes('تحديد الضغط بواسطة المتجر بعد مراجعة الكشف') &&
      storefrontSrc.includes('enableLensesSystem') &&
      storefrontSrc.includes('resolveCustomerLensBrands') &&
      pdpSrc.includes('enableLensesSystem') &&
      mig008Src.includes('official_lens_brands') &&
      mig008Src.includes('merchant_lens_configs'),
    'Storefront 4-step matrix, store-decide option, PDP flag guard & SQL migration 008 verified'
  );

  console.log('✓ Test 16 passed: Complete Optical Lens Matrix, Sponsorship Priority, Variance Clamping & 4-Step Flow verified');
}

console.log('=== ALL TESTS PASSED ===');


