'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Text, Environment } from '@react-three/drei';
import * as THREE from 'three';
import type { TerrenoMarketplace, ZonaEmpresa } from '@/types';
import { cargarTerrenosPublicos, cargarZonasPublicas, cargarEmpresasPublicas, cargarObjetosPublicos } from '@/lib/terrenosMarketplace';
import type { EmpresaPublica, ObjetoEspacio } from '@/lib/terrenosMarketplace';
import { TerrenoDisponible3D } from './TerrenoDisponible3D';
import { PanelDetalleTerreno } from './PanelDetalleTerreno';
import { PanelDetalleEmpresa } from './PanelDetalleEmpresa';
import { HUDMarketplace } from './HUDMarketplace';

const ESPACIO_GLOBAL_ID = '91887e81-1f26-448c-9d6d-9839e7d83b5d';
const WORLD_SCALE = 0.02;
const WORLD_SIZE_PX = 2000;
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
  const edificioH = esComun ? 0.3 : 0.15 + Math.min(miembros * 0.06, 0.8);

  return (
    <group position={[posX, 0, posZ]}>
      {/* Suelo clickeable */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.01, 0]}
        onClick={(e) => { e.stopPropagation(); onClick?.(zona); }}
        onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { document.body.style.cursor = 'default'; }}
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
        <mesh position={[0, edificioH + 0.02, 0]}>
          <boxGeometry args={[anchoW * 0.65, 0.03, altoW * 0.65]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.2} />
        </mesh>
      )}

      {/* Luz activa si hay miembros (señal de vida) */}
      {!esComun && miembros > 0 && (
        <pointLight
          color={color}
          intensity={seleccionada ? 2 : 0.6}
          distance={3}
          position={[0, edificioH + 0.2, 0]}
        />
      )}

      {/* Nombre */}
      <Text
        position={[0, esComun ? 0.25 : edificioH + 0.2, 0]}
        fontSize={0.2}
        color="white"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.015}
        outlineColor="#000000"
      >
        {nombre}
      </Text>

      {/* Subtítulo: industria */}
      {!esComun && empresa?.industria && (
        <Text
          position={[0, edificioH + 0.05, 0]}
          fontSize={0.1}
          color={color}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.006}
          outlineColor="#000000"
        >
          {empresa.industria}
        </Text>
      )}

      {/* Indicador miembros activos (bolita verde pulsante) */}
      {!esComun && miembros > 0 && (
        <>
          <mesh position={[anchoW * 0.3 - 0.1, edificioH + 0.15, 0]}>
            <sphereGeometry args={[0.04, 8, 8]} />
            <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={1} />
          </mesh>
          <Text
            position={[anchoW * 0.3 + 0.05, edificioH + 0.15, 0]}
            fontSize={0.08}
            color="#22c55e"
            anchorX="left"
            anchorY="middle"
            outlineWidth={0.005}
            outlineColor="#000000"
          >
            {miembros}
          </Text>
        </>
      )}

      {/* Esquineros sutiles */}
      {[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz], i) => (
        <mesh key={i} position={[sx * anchoW / 2, 0.05, sz * altoW / 2]}>
          <cylinderGeometry args={[0.015, 0.015, 0.1, 6]} />
          <meshStandardMaterial color={color} transparent opacity={0.4} />
        </mesh>
      ))}
    </group>
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
}> = ({ terrenos, zonas, empresas, terrenoSeleccionado, zonaSeleccionada, onClickTerreno, onClickZona }) => {

  const empresaMap = useMemo(() => {
    const map: Record<string, EmpresaPublica> = {};
    empresas.forEach((e) => { map[e.id] = e; });
    return map;
  }, [empresas]);

  return (
    <>
      {/* Iluminación */}
      <ambientLight intensity={0.4} />
      <directionalLight position={[10, 15, 10]} intensity={0.8} castShadow />
      <directionalLight position={[-5, 10, -5]} intensity={0.3} />

      {/* Cielo/ambiente */}
      <fog attach="fog" args={['#0a0a1a', 30, 80]} />
      <color attach="background" args={['#0a0a1a']} />

      {/* Grid del suelo */}
      <Grid
        args={[60, 60]}
        position={[WORLD_CENTER, -0.01, WORLD_CENTER]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#1e293b"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#334155"
        fadeDistance={50}
        infiniteGrid
      />

      {/* Suelo receptor de sombras */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[WORLD_CENTER, -0.02, WORLD_CENTER]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#0f172a" transparent opacity={0.8} />
      </mesh>

      {/* Separador visual: línea entre zonas y terrenos */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[940 * WORLD_SCALE, 0.005, WORLD_CENTER]}>
        <planeGeometry args={[0.04, 40]} />
        <meshStandardMaterial color="#334155" transparent opacity={0.5} />
      </mesh>

      {/* Labels de sección */}
      <Text
        position={[490 * WORLD_SCALE, 0.3, 50 * WORLD_SCALE]}
        fontSize={0.4}
        color="#475569"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.01}
        outlineColor="#000000"
      >
        EMPRESAS
      </Text>
      <Text
        position={[1400 * WORLD_SCALE, 0.3, 50 * WORLD_SCALE]}
        fontSize={0.4}
        color="#475569"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.01}
        outlineColor="#000000"
      >
        TERRENOS DISPONIBLES
      </Text>

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

      {/* Cámara orbital */}
      <OrbitControls
        makeDefault
        enablePan
        enableZoom
        enableRotate
        minDistance={5}
        maxDistance={60}
        maxPolarAngle={Math.PI / 2.2}
        minPolarAngle={0.2}
        target={[WORLD_CENTER, 0, WORLD_CENTER]}
        autoRotate
        autoRotateSpeed={0.2}
      />
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
          position: [WORLD_CENTER + 15, 18, WORLD_CENTER + 15],
          fov: 50,
          near: 0.1,
          far: 200,
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
