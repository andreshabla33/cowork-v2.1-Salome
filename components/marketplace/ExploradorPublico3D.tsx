'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, Text, Environment } from '@react-three/drei';
import * as THREE from 'three';
import type { TerrenoMarketplace, ZonaEmpresa } from '@/types';
import { cargarTerrenosPublicos, cargarZonasPublicas, cargarEmpresasPublicas, cargarObjetosPublicos } from '@/lib/terrenosMarketplace';
import type { EmpresaPublica, ObjetoEspacio } from '@/lib/terrenosMarketplace';
import { TerrenoDisponible3D } from './TerrenoDisponible3D';
import { PanelDetalleTerreno } from './PanelDetalleTerreno';
import { PanelDetalleEmpresa } from './PanelDetalleEmpresa';
import { HUDMarketplace } from './HUDMarketplace';
import { ModalGestosMediaPipe } from './ModalGestosMediaPipe';
import type { GestureType, GestureData } from './HandController';

const ESPACIO_GLOBAL_ID = '91887e81-1f26-448c-9d6d-9839e7d83b5d';
const WORLD_SCALE = 1 / 16; // Igual que VirtualSpace3D: posicion / 16
const WORLD_SIZE_PX = 1200;
const WORLD_CENTER = (WORLD_SIZE_PX * WORLD_SCALE) / 2;

/**
 * Vista principal: zona de empresa como bloque limpio (progressive disclosure)
 * Interior solo se muestra al clickear → panel lateral con 3D live preview
 */
const ZonaExistente3D: React.FC<{
  zona: ZonaEmpresa;
  empresa?: EmpresaPublica;
  onClick?: (zona: ZonaEmpresa) => void;
  seleccionada?: boolean;
}> = ({ zona, empresa, onClick, seleccionada = false }) => {
  const escala = WORLD_SCALE;
  const anchoW = zona.ancho * escala;
  const altoW = zona.alto * escala;
  const posX = zona.posicion_x * escala;
  const posZ = zona.posicion_y * escala;
  const color = zona.color || '#6366f1';
  const esComun = zona.es_comun;
  const miembros = empresa?.miembros_count || 0;
  const nombre = esComun ? 'Zona Común' : (empresa?.nombre || zona.nombre_zona || 'Empresa');
  const edificioH = esComun ? 0.8 : 0.5 + Math.min(miembros * 0.15, 2.5);

  return (
    <group position={[posX, 0, posZ]} userData={{ tipo: 'zona', zonaId: zona.id }}>
      {/* Suelo clickeable */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.01, 0]}
        onClick={(e) => { e.stopPropagation(); onClick?.(zona); }}
        onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { document.body.style.cursor = 'default'; }}
        userData={{ tipo: 'zona', zonaId: zona.id }}
      >
        <planeGeometry args={[anchoW, altoW]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={seleccionada ? 0.4 : esComun ? 0.1 : 0.15}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Borde */}
      <lineSegments>
        <edgesGeometry args={[new THREE.PlaneGeometry(anchoW, altoW)]} />
        <lineBasicMaterial color={seleccionada ? '#ffffff' : color} transparent opacity={seleccionada ? 0.9 : 0.4} />
      </lineSegments>

      {/* Mini edificio estilizado (altura proporcional a miembros) */}
      {!esComun && (
        <mesh position={[0, edificioH / 2, 0]} castShadow>
          <boxGeometry args={[anchoW * 0.6, edificioH, altoW * 0.6]} />
          <meshStandardMaterial
            color={color}
            transparent
            opacity={seleccionada ? 0.6 : 0.35}
            roughness={0.4}
            metalness={0.1}
          />
        </mesh>
      )}

      {/* Techo del edificio */}
      {!esComun && (
        <mesh position={[0, edificioH + 0.05, 0]}>
          <boxGeometry args={[anchoW * 0.65, 0.08, altoW * 0.65]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.2} />
        </mesh>
      )}

      {/* Luz activa si hay miembros (señal de vida) */}
      {!esComun && miembros > 0 && (
        <pointLight
          color={color}
          intensity={seleccionada ? 3 : 1}
          distance={10}
          position={[0, edificioH + 0.5, 0]}
        />
      )}

      {/* Nombre */}
      <Text
        position={[0, esComun ? 0.7 : edificioH + 0.6, 0]}
        fontSize={0.65}
        color="white"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.04}
        outlineColor="#000000"
      >
        {nombre}
      </Text>

      {/* Subtítulo: industria */}
      {!esComun && empresa?.industria && (
        <Text
          position={[0, edificioH + 0.15, 0]}
          fontSize={0.35}
          color={color}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.02}
          outlineColor="#000000"
        >
          {empresa.industria}
        </Text>
      )}

      {/* Indicador miembros activos (bolita verde pulsante) */}
      {!esComun && miembros > 0 && (
        <>
          <mesh position={[anchoW * 0.3 - 0.3, edificioH + 0.45, 0]}>
            <sphereGeometry args={[0.12, 8, 8]} />
            <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={1} />
          </mesh>
          <Text
            position={[anchoW * 0.3 + 0.05, edificioH + 0.45, 0]}
            fontSize={0.25}
            color="#22c55e"
            anchorX="left"
            anchorY="middle"
            outlineWidth={0.015}
            outlineColor="#000000"
          >
            {miembros}
          </Text>
        </>
      )}

      {/* Esquineros */}
      {[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz], i) => (
        <mesh key={i} position={[sx * anchoW / 2, 0.15, sz * altoW / 2]}>
          <cylinderGeometry args={[0.05, 0.05, 0.3, 6]} />
          <meshStandardMaterial color={color} transparent opacity={0.4} />
        </mesh>
      ))}
    </group>
  );
};

/**
 * Cursor 3D controlado por el dedo índice (modelo Apple Vision Pro: apuntar + pellizco = seleccionar)
 * - Proyecta un rayo desde la cámara usando la posición del índice en pantalla
 * - Muestra un reticle donde el rayo toca el suelo
 * - Al recibir 'gesture-tap' → raycasting para detectar qué zona/terreno está bajo el cursor
 */
const CursorGesto3D: React.FC<{
  pointerRef: React.MutableRefObject<{ x: number; y: number }>;
  modalActivo: boolean;
  zonas: ZonaEmpresa[];
  terrenos: TerrenoMarketplace[];
  onClickZona: (z: ZonaEmpresa) => void;
  onClickTerreno: (t: TerrenoMarketplace) => void;
}> = ({ pointerRef, modalActivo, zonas, terrenos, onClickZona, onClickTerreno }) => {
  const { camera, scene, raycaster } = useThree();
  const cursorRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const prevHitRef = useRef<string | null>(null);

  // Raycasting helper: busca zonas/terrenos bajo un punto NDC
  const raycastAt = useCallback((ndcX: number, ndcY: number) => {
    const ndc = new THREE.Vector2(ndcX * 2 - 1, -(ndcY * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(scene.children, true);
    for (const hit of hits) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj) {
        const ud = (obj as any).userData;
        if (ud?.tipo === 'zona' && ud?.zonaId) {
          const z = zonas.find(z => z.id === ud.zonaId);
          if (z) return { type: 'zona' as const, zona: z, point: hit.point };
        }
        if (ud?.tipo === 'terreno' && ud?.terrenoId) {
          const t = terrenos.find(t => t.id === ud.terrenoId);
          if (t) return { type: 'terreno' as const, terreno: t, point: hit.point };
        }
        obj = obj.parent;
      }
    }
    // Fallback: intersect ground plane
    const groundHits = hits.filter(h => h.object.userData?.isGround);
    if (groundHits.length > 0) return { type: 'ground' as const, point: groundHits[0].point };
    return null;
  }, [camera, scene, raycaster, zonas, terrenos]);

  // Listener para tap (selección por gesto)
  useEffect(() => {
    if (!modalActivo) return;
    const handler = (e: Event) => {
      const { x, y } = (e as CustomEvent).detail;
      const hit = raycastAt(x, y);
      if (hit?.type === 'zona') onClickZona(hit.zona);
      else if (hit?.type === 'terreno') onClickTerreno(hit.terreno);
    };
    window.addEventListener('gesture-tap', handler);
    return () => window.removeEventListener('gesture-tap', handler);
  }, [modalActivo, raycastAt, onClickZona, onClickTerreno]);

  // Mover cursor cada frame
  useFrame(() => {
    if (!modalActivo || !cursorRef.current || !ringRef.current) return;
    const px = pointerRef.current.x;
    const py = pointerRef.current.y;
    if (px < 0 || py < 0) {
      cursorRef.current.visible = false;
      ringRef.current.visible = false;
      return;
    }

    const ndc = new THREE.Vector2(px * 2 - 1, -(py * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(scene.children, true);

    // Buscar primer hit sólido (no el cursor mismo)
    const validHit = hits.find(h => h.object !== cursorRef.current && h.object !== ringRef.current);
    if (validHit) {
      const p = validHit.point;
      cursorRef.current.position.set(p.x, p.y + 0.05, p.z);
      cursorRef.current.visible = true;
      ringRef.current.position.set(p.x, p.y + 0.03, p.z);
      ringRef.current.visible = true;

      // Check hover state para feedback visual
      let hoverId: string | null = null;
      let obj: THREE.Object3D | null = validHit.object;
      while (obj) {
        const ud = (obj as any).userData;
        if (ud?.tipo === 'zona' || ud?.tipo === 'terreno') {
          hoverId = ud.zonaId || ud.terrenoId;
          break;
        }
        obj = obj.parent;
      }
      // Cambiar color del cursor si está sobre algo seleccionable
      const mat = cursorRef.current.material as THREE.MeshStandardMaterial;
      if (hoverId) {
        mat.color.setHex(0x22d3ee); // cyan
        mat.emissive.setHex(0x22d3ee);
      } else {
        mat.color.setHex(0xffffff);
        mat.emissive.setHex(0xffffff);
      }
      prevHitRef.current = hoverId;
    } else {
      cursorRef.current.visible = false;
      ringRef.current.visible = false;
    }
  });

  if (!modalActivo) return null;

  return (
    <>
      {/* Cursor dot */}
      <mesh ref={cursorRef} visible={false}>
        <sphereGeometry args={[0.3, 16, 16]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={2} transparent opacity={0.9} />
      </mesh>
      {/* Cursor ring */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.5, 0.7, 32]} />
        <meshStandardMaterial color="#22d3ee" emissive="#22d3ee" emissiveIntensity={1} transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>
    </>
  );
};

/**
 * Puente: gestos MediaPipe → OrbitControls + cámara
 * Usa coordenadas esféricas para rotación 360° (modelo Sketchfab/Google model-viewer)
 */
const GestureOrbitBridge: React.FC<{
  gestureRef: React.MutableRefObject<{ gesture: GestureType; data: GestureData }>;
}> = ({ gestureRef }) => {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);
  const velocityRef = useRef({ x: 0, y: 0 });

  useFrame(() => {
    if (!controlsRef.current) return;
    const controls = controlsRef.current;
    const g = gestureRef.current.gesture;
    const d = gestureRef.current.data;

    if (g === 'pinch_drag') {
      controls.enabled = false;
      controls.autoRotate = false;
      velocityRef.current.x = -d.deltaX * 6;
      velocityRef.current.y = -d.deltaY * 6;
    } else if (g === 'pinch_zoom') {
      controls.enabled = false;
      controls.autoRotate = false;
      const zoomDir = d.deltaY > 0 ? -1 : 1;
      const dist = camera.position.distanceTo(controls.target);
      const newDist = THREE.MathUtils.clamp(dist + zoomDir, 10, 120);
      const dir = camera.position.clone().sub(controls.target).normalize();
      camera.position.copy(controls.target).add(dir.multiplyScalar(newDist));
    } else {
      controls.enabled = true;
      controls.autoRotate = true;
      velocityRef.current.x *= 0.9;
      velocityRef.current.y *= 0.9;
    }

    const vx = velocityRef.current.x;
    const vy = velocityRef.current.y;
    if (Math.abs(vx) > 0.001 || Math.abs(vy) > 0.001) {
      const target = controls.target as THREE.Vector3;
      const offset = camera.position.clone().sub(target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta -= vx;
      spherical.phi = THREE.MathUtils.clamp(spherical.phi + vy, 0.2, Math.PI / 2.2);
      offset.setFromSpherical(spherical);
      camera.position.copy(target).add(offset);
      camera.lookAt(target);
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enablePan
      enableZoom
      enableRotate
      minDistance={10}
      maxDistance={120}
      maxPolarAngle={Math.PI / 2.2}
      minPolarAngle={0.2}
      target={[WORLD_CENTER, 0, WORLD_CENTER]}
      autoRotate
      autoRotateSpeed={0.15}
    />
  );
};

/**
 * Escena 3D del marketplace
 */
const EscenaMarketplace: React.FC<{
  terrenos: TerrenoMarketplace[];
  zonas: ZonaEmpresa[];
  empresas: EmpresaPublica[];
  terrenoSeleccionado: string | null;
  zonaSeleccionada: string | null;
  onClickTerreno: (t: TerrenoMarketplace) => void;
  onClickZona: (z: ZonaEmpresa) => void;
  gestureRef: React.MutableRefObject<{ gesture: GestureType; data: GestureData }>;
  pointerRef: React.MutableRefObject<{ x: number; y: number }>;
  modalGestosActivo: boolean;
}> = ({ terrenos, zonas, empresas, terrenoSeleccionado, zonaSeleccionada, onClickTerreno, onClickZona, gestureRef, pointerRef, modalGestosActivo }) => {

  const empresaMap = useMemo(() => {
    const map: Record<string, EmpresaPublica> = {};
    empresas.forEach((e) => { map[e.id] = e; });
    return map;
  }, [empresas]);

  return (
    <>
      {/* Iluminación */}
      <ambientLight intensity={0.4} />
      <directionalLight position={[30, 40, 30]} intensity={0.8} castShadow />
      <directionalLight position={[-15, 25, -15]} intensity={0.3} />

      {/* Cielo/ambiente */}
      <fog attach="fog" args={['#0a0a1a', 60, 180]} />
      <color attach="background" args={['#0a0a1a']} />

      {/* Grid del suelo */}
      <Grid
        args={[120, 120]}
        position={[WORLD_CENTER, -0.01, WORLD_CENTER]}
        cellSize={4}
        cellThickness={0.5}
        cellColor="#1e293b"
        sectionSize={16}
        sectionThickness={1}
        sectionColor="#334155"
        fadeDistance={100}
        infiniteGrid
      />

      {/* Suelo receptor de sombras */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[WORLD_CENTER, -0.02, WORLD_CENTER]} receiveShadow userData={{ isGround: true }}>
        <planeGeometry args={[150, 150]} />
        <meshStandardMaterial color="#0f172a" transparent opacity={0.8} />
      </mesh>

      {/* Zonas de empresas existentes — con objetos reales + GhostAvatars */}
      {zonas.map((zona) => (
        <ZonaExistente3D
          key={zona.id}
          zona={zona}
          empresa={zona.empresa_id ? empresaMap[zona.empresa_id] : undefined}
          onClick={onClickZona}
          seleccionada={zonaSeleccionada === zona.id}
        />
      ))}

      {/* Terrenos disponibles */}
      {terrenos.map((terreno) => (
        <TerrenoDisponible3D
          key={terreno.id}
          terreno={terreno}
          onClick={onClickTerreno}
          seleccionado={terrenoSeleccionado === terreno.id}
        />
      ))}

      {/* Cursor de gesto 3D (raycasting + reticle) */}
      <CursorGesto3D
        pointerRef={pointerRef}
        modalActivo={modalGestosActivo}
        zonas={zonas}
        terrenos={terrenos}
        onClickZona={onClickZona}
        onClickTerreno={onClickTerreno}
      />

      {/* Cámara orbital + puente de gestos MediaPipe */}
      <GestureOrbitBridge gestureRef={gestureRef} />
    </>
  );
};

/**
 * Página principal del explorador público de terrenos
 */
export const ExploradorPublico3D: React.FC = () => {
  const [terrenos, setTerrenos] = useState<TerrenoMarketplace[]>([]);
  const [zonas, setZonas] = useState<ZonaEmpresa[]>([]);
  const [empresas, setEmpresas] = useState<EmpresaPublica[]>([]);
  const [objetos, setObjetos] = useState<ObjetoEspacio[]>([]);
  const [cargando, setCargando] = useState(true);
  const [terrenoSeleccionado, setTerrenoSeleccionado] = useState<TerrenoMarketplace | null>(null);
  const [zonaSeleccionada, setZonaSeleccionada] = useState<ZonaEmpresa | null>(null);
  const [filtroTier, setFiltroTier] = useState<string | null>(null);
  const [modalGestos, setModalGestos] = useState(false);
  const gestureRef = useRef<{ gesture: GestureType; data: GestureData }>({
    gesture: 'none',
    data: { x: 0.5, y: 0.5, pinchDistance: 0, handedness: 'right', deltaX: 0, deltaY: 0, indexX: 0.5, indexY: 0.5 },
  });
  const pointerRef = useRef<{ x: number; y: number }>({ x: 0.5, y: 0.5 });

  const handleGestureFromModal = useCallback((g: GestureType, data: GestureData) => {
    // Tap = seleccionar zona/terreno bajo el cursor
    if (g === 'tap') {
      gestureRef.current = { gesture: 'none', data };
      // Dispatch custom event para que CursorGesto3D lo procese via raycasting
      window.dispatchEvent(new CustomEvent('gesture-tap', { detail: { x: data.indexX, y: data.indexY } }));
      return;
    }
    gestureRef.current = { gesture: g, data };
  }, []);

  const handlePointerMove = useCallback((x: number, y: number) => {
    pointerRef.current = { x, y };
  }, []);

  useEffect(() => {
    const cargar = async () => {
      setCargando(true);
      const [t, z, e, o] = await Promise.all([
        cargarTerrenosPublicos(ESPACIO_GLOBAL_ID),
        cargarZonasPublicas(ESPACIO_GLOBAL_ID),
        cargarEmpresasPublicas(ESPACIO_GLOBAL_ID),
        cargarObjetosPublicos(ESPACIO_GLOBAL_ID),
      ]);
      setTerrenos(t);
      setZonas(z);
      setEmpresas(e);
      setObjetos(o);
      setCargando(false);
    };
    cargar();
  }, []);

  const terrenosFiltrados = useMemo(() => {
    if (!filtroTier) return terrenos;
    return terrenos.filter((t) => t.tier === filtroTier);
  }, [terrenos, filtroTier]);

  const empresaSeleccionada = useMemo(() => {
    if (!zonaSeleccionada?.empresa_id) return null;
    return empresas.find((e) => e.id === zonaSeleccionada.empresa_id) || null;
  }, [zonaSeleccionada, empresas]);

  const handleClickTerreno = useCallback((t: TerrenoMarketplace) => {
    setZonaSeleccionada(null);
    setTerrenoSeleccionado((prev) => (prev?.id === t.id ? null : t));
  }, []);

  const handleClickZona = useCallback((z: ZonaEmpresa) => {
    setTerrenoSeleccionado(null);
    setZonaSeleccionada((prev) => (prev?.id === z.id ? null : z));
  }, []);

  const handleReservar = useCallback((t: TerrenoMarketplace) => {
    alert(`Para reservar "${t.nombre}" necesitas crear una cuenta.\n\nRedirigiendo al registro...`);
    window.location.href = '/';
  }, []);

  const handleVolverHome = useCallback(() => {
    window.location.href = '/';
  }, []);

  if (cargando) {
    return (
      <div className="fixed inset-0 bg-[#0a0a1a] flex flex-col items-center justify-center gap-6">
        <div className="relative">
          <div className="w-20 h-20 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-violet-500 rounded-lg" />
          </div>
        </div>
        <div className="text-center">
          <p className="text-sm font-bold text-white">Cargando espacio virtual...</p>
          <p className="text-[10px] text-zinc-500 mt-1 uppercase tracking-wider">Preparando terrenos y empresas</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-[#0a0a1a]">
      {/* Canvas 3D */}
      <Canvas
        camera={{
          position: [WORLD_CENTER + 35, 45, WORLD_CENTER + 35],
          fov: 50,
          near: 0.1,
          far: 500,
        }}
        shadows
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: false }}
      >
        <Suspense fallback={null}>
          <EscenaMarketplace
            terrenos={terrenosFiltrados}
            zonas={zonas}
            empresas={empresas}
            terrenoSeleccionado={terrenoSeleccionado?.id || null}
            zonaSeleccionada={zonaSeleccionada?.id || null}
            onClickTerreno={handleClickTerreno}
            onClickZona={handleClickZona}
            gestureRef={gestureRef}
            pointerRef={pointerRef}
            modalGestosActivo={modalGestos}
          />
        </Suspense>
      </Canvas>

      {/* HUD */}
      <HUDMarketplace
        terrenos={terrenos}
        zonas={zonas}
        filtroTier={filtroTier}
        setFiltroTier={setFiltroTier}
        onVolverHome={handleVolverHome}
        onToggleGestos={() => setModalGestos(m => !m)}
        gestosActivos={modalGestos}
      />

      {/* Modal de gestos MediaPipe */}
      <ModalGestosMediaPipe
        abierto={modalGestos}
        onCerrar={() => {
          setModalGestos(false);
          gestureRef.current = { gesture: 'none', data: { x: 0.5, y: 0.5, pinchDistance: 0, handedness: 'right', deltaX: 0, deltaY: 0, indexX: 0.5, indexY: 0.5 } };
          pointerRef.current = { x: -1, y: -1 };
        }}
        onGesture={handleGestureFromModal}
        onPointerMove={handlePointerMove}
      />

      {/* Panel de detalle terreno */}
      <PanelDetalleTerreno
        terreno={terrenoSeleccionado}
        onCerrar={() => setTerrenoSeleccionado(null)}
        onReservar={handleReservar}
      />

      {/* Panel de detalle empresa */}
      <PanelDetalleEmpresa
        zona={zonaSeleccionada}
        empresa={empresaSeleccionada}
        objetos={objetos}
        onCerrar={() => setZonaSeleccionada(null)}
        onVerTerrenos={() => {
          setZonaSeleccionada(null);
          setFiltroTier(null);
        }}
      />
    </div>
  );
};
