'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Text, Environment } from '@react-three/drei';
import * as THREE from 'three';
import type { TerrenoMarketplace, ZonaEmpresa } from '@/types';
import { cargarTerrenosPublicos, cargarZonasPublicas } from '@/lib/terrenosMarketplace';
import { TerrenoDisponible3D } from './TerrenoDisponible3D';
import { PanelDetalleTerreno } from './PanelDetalleTerreno';
import { HUDMarketplace } from './HUDMarketplace';

const ESPACIO_GLOBAL_ID = '91887e81-1f26-448c-9d6d-9839e7d83b5d';
const WORLD_SCALE = 0.02;
const WORLD_SIZE_PX = 800;
const WORLD_CENTER = (WORLD_SIZE_PX * WORLD_SCALE) / 2;

/**
 * Componente 3D para zona de empresa existente (read-only, simplificado)
 */
const ZonaExistente3D: React.FC<{ zona: ZonaEmpresa }> = ({ zona }) => {
  const escala = WORLD_SCALE;
  const anchoW = zona.ancho * escala;
  const altoW = zona.alto * escala;
  const posX = zona.posicion_x * escala;
  const posZ = zona.posicion_y * escala;
  const color = zona.color || '#6366f1';
  const esComun = zona.es_comun;

  return (
    <group position={[posX, 0, posZ]}>
      {/* Suelo */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <planeGeometry args={[anchoW, altoW]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={esComun ? 0.15 : 0.3}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Borde */}
      <lineSegments>
        <edgesGeometry args={[new THREE.PlaneGeometry(anchoW, altoW)]} />
        <lineBasicMaterial color={color} transparent opacity={0.5} />
      </lineSegments>

      {/* Mini edificio representativo */}
      {!esComun && (
        <mesh position={[0, 0.3, 0]}>
          <boxGeometry args={[anchoW * 0.5, 0.6, altoW * 0.5]} />
          <meshStandardMaterial
            color={color}
            transparent
            opacity={0.4}
          />
        </mesh>
      )}

      {/* Nombre */}
      <Text
        position={[0, esComun ? 0.3 : 0.8, 0]}
        fontSize={0.22}
        color={color}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.01}
        outlineColor="#000000"
      >
        {esComun ? 'Zona Común' : (zona.empresa?.nombre || zona.nombre_zona || 'Empresa')}
      </Text>

      {/* Badge OCUPADO */}
      {!esComun && (
        <Text
          position={[0, 1.05, 0]}
          fontSize={0.14}
          color="#94a3b8"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.01}
          outlineColor="#000000"
        >
          OCUPADO
        </Text>
      )}
    </group>
  );
};

/**
 * Escena 3D del marketplace
 */
const EscenaMarketplace: React.FC<{
  terrenos: TerrenoMarketplace[];
  zonas: ZonaEmpresa[];
  terrenoSeleccionado: string | null;
  onClickTerreno: (t: TerrenoMarketplace) => void;
}> = ({ terrenos, zonas, terrenoSeleccionado, onClickTerreno }) => {

  return (
    <>
      {/* Iluminación */}
      <ambientLight intensity={0.4} />
      <directionalLight position={[10, 15, 10]} intensity={0.8} castShadow />
      <directionalLight position={[-5, 10, -5]} intensity={0.3} />

      {/* Cielo/ambiente */}
      <fog attach="fog" args={['#0a0a1a', 15, 40]} />
      <color attach="background" args={['#0a0a1a']} />

      {/* Grid del suelo */}
      <Grid
        args={[30, 30]}
        position={[WORLD_CENTER, -0.01, WORLD_CENTER]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#1e293b"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#334155"
        fadeDistance={25}
        infiniteGrid
      />

      {/* Suelo receptor de sombras */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[WORLD_CENTER, -0.02, WORLD_CENTER]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#0f172a" transparent opacity={0.8} />
      </mesh>

      {/* Zonas de empresas existentes */}
      {zonas.map((zona) => (
        <ZonaExistente3D key={zona.id} zona={zona} />
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
        minDistance={3}
        maxDistance={30}
        maxPolarAngle={Math.PI / 2.2}
        minPolarAngle={0.2}
        target={[WORLD_CENTER, 0, WORLD_CENTER]}
        autoRotate
        autoRotateSpeed={0.3}
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
  const [cargando, setCargando] = useState(true);
  const [terrenoSeleccionado, setTerrenoSeleccionado] = useState<TerrenoMarketplace | null>(null);
  const [filtroTier, setFiltroTier] = useState<string | null>(null);

  useEffect(() => {
    const cargar = async () => {
      setCargando(true);
      const [t, z] = await Promise.all([
        cargarTerrenosPublicos(ESPACIO_GLOBAL_ID),
        cargarZonasPublicas(ESPACIO_GLOBAL_ID),
      ]);
      setTerrenos(t);
      setZonas(z);
      setCargando(false);
    };
    cargar();
  }, []);

  const terrenosFiltrados = useMemo(() => {
    if (!filtroTier) return terrenos;
    return terrenos.filter((t) => t.tier === filtroTier);
  }, [terrenos, filtroTier]);

  const handleClickTerreno = useCallback((t: TerrenoMarketplace) => {
    setTerrenoSeleccionado((prev) => (prev?.id === t.id ? null : t));
  }, []);

  const handleReservar = useCallback((t: TerrenoMarketplace) => {
    // Por ahora, redirigir a login para completar la reserva
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
          position: [WORLD_CENTER + 8, 10, WORLD_CENTER + 8],
          fov: 50,
          near: 0.1,
          far: 100,
        }}
        shadows
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: false }}
      >
        <Suspense fallback={null}>
          <EscenaMarketplace
            terrenos={terrenosFiltrados}
            zonas={zonas}
            terrenoSeleccionado={terrenoSeleccionado?.id || null}
            onClickTerreno={handleClickTerreno}
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

      {/* Panel de detalle */}
      <PanelDetalleTerreno
        terreno={terrenoSeleccionado}
        onCerrar={() => setTerrenoSeleccionado(null)}
        onReservar={handleReservar}
      />
    </div>
  );
};
