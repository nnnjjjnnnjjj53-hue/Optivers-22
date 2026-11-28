import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { LandingPreviewFrame } from '../types';
import { MiniGlasses } from './GlassesGraphics';
import {
  buildEyewear3DGroup,
  disposeThreeObject,
  parseOpticalDimensions,
} from '../utils/eyewear3DBuilder';

export function Hero3DEyewearCanvas({ frame }: { frame: LandingPreviewFrame }) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const [webglError, setWebglError] = useState(false);
  const [imgTilt, setImgTilt] = useState({ rx: 0, ry: 0 });

  const normalizedDims = (frame.dimensions || '52-18-140').replace(/□/g, '-');

  useEffect(() => {
    if (frame.imageUrl) return;
    const container = stageRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer | null = null;
    let pmrem: THREE.PMREMGenerator | null = null;
    let envRT: THREE.WebGLRenderTarget | null = null;
    let controls: OrbitControls | null = null;
    let rafId = 0;
    let ro: ResizeObserver | null = null;

    try {
      const width = Math.max(260, container.clientWidth || 440);
      const height = Math.max(220, container.clientHeight || 340);

      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.style.display = 'block';
      renderer.domElement.style.touchAction = 'none';

      container.innerHTML = '';
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      sceneRef.current = scene;

      pmrem = new THREE.PMREMGenerator(renderer);
      envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
      scene.environment = envRT.texture;

      const hemi = new THREE.HemisphereLight(0xf8fafc, 0x334155, 0.85);
      scene.add(hemi);

      const key = new THREE.DirectionalLight(0xfff7ed, 1.45);
      key.position.set(1.8, 2.5, 2.8);
      scene.add(key);

      const rim = new THREE.DirectionalLight(0xbae6fd, 0.55);
      rim.position.set(-2.2, 1.1, -1.8);
      scene.add(rim);

      const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 25);
      camera.position.set(0.95, 0.24, 2.08);

      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableZoom = false;
      controls.enablePan = false;
      controls.enableDamping = true;
      controls.dampingFactor = 0.07;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 1.65;
      controls.minPolarAngle = Math.PI * 0.26;
      controls.maxPolarAngle = Math.PI * 0.68;
      controls.target.set(0, -0.02, -0.5);
      controls.update();
      controlsRef.current = controls;

      ro = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect;
        if (!rect || !renderer) return;
        const w = Math.max(220, Math.round(rect.width));
        const h = Math.max(200, Math.round(rect.height));
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
      });
      ro.observe(container);

      const animate = () => {
        rafId = window.requestAnimationFrame(animate);
        controls?.update();
        renderer?.render(scene, camera);
      };
      animate();
    } catch {
      setWebglError(true);
    }

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      ro?.disconnect();
      controls?.dispose();
      controlsRef.current = null;
      if (groupRef.current) {
        sceneRef.current?.remove(groupRef.current);
        disposeThreeObject(groupRef.current);
        groupRef.current = null;
      }
      envRT?.dispose();
      pmrem?.dispose();
      renderer?.dispose();
      if (container) container.innerHTML = '';
      sceneRef.current = null;
    };
  }, [Boolean(frame.imageUrl)]);

  useEffect(() => {
    if (frame.imageUrl || webglError) return;
    const scene = sceneRef.current;
    if (!scene) return;

    let cancelled = false;
    const { lensMm, bridgeMm } = parseOpticalDimensions(normalizedDims);
    const frameWidthMm = Math.max(128, Math.min(152, Math.round(lensMm * 2 + bridgeMm + 12)));
    const isMetal = frame.type === 'aviator' || frame.type === 'rimless';
    const isSun = Boolean(frame.lensColor && frame.lensColor.toLowerCase() !== '#cfe8ff');

    buildEyewear3DGroup({
      type: frame.type,
      material: isMetal ? 'metal' : 'acetate',
      cat: isSun ? 'sun' : 'med',
      frameColor: frame.frameColor,
      lensColor: frame.lensColor,
      opticalDimensions: normalizedDims,
      frameWidthMm,
      aspectRatio: frame.type === 'aviator' ? 0.43 : frame.type === 'rimless' ? 0.37 : 0.4,
      coatingId: isSun ? undefined : 'ar',
    })
      .then((group) => {
        if (cancelled) {
          disposeThreeObject(group);
          return;
        }
        if (groupRef.current) {
          scene.remove(groupRef.current);
          disposeThreeObject(groupRef.current);
        }
        groupRef.current = group;
        scene.add(group);
      })
      .catch(() => {
        if (!cancelled) setWebglError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [
    frame.id,
    frame.type,
    frame.frameColor,
    frame.lensColor,
    frame.imageUrl,
    normalizedDims,
    webglError,
  ]);

  if (frame.imageUrl) {
    return (
      <div
        className="w-full h-full flex items-center justify-center p-8 sm:p-10 select-none"
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const nx = (e.clientX - rect.left) / Math.max(1, rect.width) - 0.5;
          const ny = (e.clientY - rect.top) / Math.max(1, rect.height) - 0.5;
          setImgTilt({ rx: -ny * 14, ry: nx * 18 });
        }}
        onPointerLeave={() => setImgTilt({ rx: 0, ry: 0 })}
      >
        <img
          src={frame.imageUrl}
          alt={frame.name}
          width={360}
          height={220}
          loading="lazy"
          decoding="async"
          style={{
            transform: `perspective(900px) rotateX(${imgTilt.rx}deg) rotateY(${imgTilt.ry}deg) scale(1.02)`,
          }}
          className="max-h-[220px] w-auto object-contain transition-transform duration-150 ease-out drop-shadow-[0_14px_20px_rgba(15,23,42,0.18)]"
        />
      </div>
    );
  }

  if (webglError) {
    return (
      <div className="w-full h-full flex items-center justify-center p-8">
        <MiniGlasses
          type={frame.type}
          frame={frame.frameColor}
          lens={frame.lensColor}
          w={220}
        />
      </div>
    );
  }

  return (
    <div
      ref={stageRef}
      aria-label={`معاينة ثلاثية الأبعاد تفاعلية لإطار ${frame.name}`}
      className="w-full h-full cursor-grab active:cursor-grabbing select-none"
    />
  );
}

export default Hero3DEyewearCanvas;
