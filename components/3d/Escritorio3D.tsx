/**
 * @module components/3d/Escritorio3D
 * Componente 3D para escritorios persistentes reclamables.
 * Renderiza un escritorio con indicador de dueño, tooltip de interacción
 * y glow de proximidad. Soporta: reclamar, liberar y mover.
 */

import React, { useRef, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { EspacioObjeto } from '@/hooks/space3d/useEspacioObjetos';

interface Escritorio3DProps {
  objeto: EspacioObjeto;
  playerPosition: { x: number; z: number };
  currentUserId: string | null;
  onReclamar: (id: string) => void;
  onLiberar: (id: string) => void;
  ownerName?: string | null;
}

const PROXIMIDAD_INTERACCION = 3; // unidades 3D

export const Escritorio3D: React.FC<Escritorio3DProps> = ({
  objeto,
  playerPosition,
  currentUserId,
  onReclamar,
  onLiberar,
  ownerName,
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const [cercano, setCercano] = useState(false);
  const [hover, setHover] = useState(false);

  const esPropio = objeto.owner_id === currentUserId;
  const esLibre = objeto.owner_id === null;
  const posicion: [number, number, number] = [objeto.posicion_x, objeto.posicion_y, objeto.posicion_z];

  // Color según estado
  const colorEscritorio = useMemo(() => {
    if (esPropio) return '#4f46e5'; // Indigo — tu escritorio
    if (!esLibre) return '#475569'; // Slate — ocupado por otro
    return '#1e293b'; // Dark — libre
  }, [esPropio, esLibre]);

  // Proximidad check en useFrame (no dispara re-renders excesivos)
  useFrame(() => {
    const dx = playerPosition.x - posicion[0];
    const dz = playerPosition.z - posicion[2];
    const dist = Math.sqrt(dx * dx + dz * dz);
    const ahora = dist < PROXIMIDAD_INTERACCION;
    if (ahora !== cercano) setCercano(ahora);
  });

  const handleClick = (e: any) => {
    e.stopPropagation();
    if (!cercano) return;
    if (esLibre) {
      onReclamar(objeto.id);
    } else if (esPropio) {
      onLiberar(objeto.id);
    }
  };

  // Label según estado
  const label = esPropio
    ? '🪑 Tu escritorio (clic para liberar)'
    : esLibre
      ? '🪑 Escritorio libre (clic para reclamar)'
      : `🪑 Escritorio de ${ownerName || 'otro usuario'}`;

  return (
    <group position={posicion}>
      {/* Mesa */}
      <mesh
        ref={meshRef}
        position={[0, 0.4, 0]}
        castShadow
        receiveShadow
        onClick={handleClick}
        onPointerOver={() => setHover(true)}
        onPointerOut={() => setHover(false)}
      >
        <boxGeometry args={[2.4, 0.12, 1.2]} />
        <meshStandardMaterial
          color={colorEscritorio}
          emissive={cercano ? (esLibre ? '#22c55e' : esPropio ? '#6366f1' : '#ef4444') : '#000000'}
          emissiveIntensity={cercano ? 0.4 : 0}
          roughness={0.6}
          metalness={0.2}
        />
      </mesh>

      {/* Patas de la mesa */}
      {[[-1, 0, -0.45], [1, 0, -0.45], [-1, 0, 0.45], [1, 0, 0.45]].map((pos, i) => (
        <mesh key={i} position={[pos[0], 0.17, pos[2]]} castShadow>
          <boxGeometry args={[0.08, 0.34, 0.08]} />
          <meshStandardMaterial color="#0f172a" roughness={0.8} />
        </mesh>
      ))}

      {/* Silla detrás del escritorio */}
      <mesh position={[0, 0.3, -0.9]} castShadow>
        <boxGeometry args={[0.6, 0.6, 0.5]} />
        <meshStandardMaterial
          color={esPropio ? '#4338ca' : esLibre ? '#334155' : '#1e293b'}
          roughness={0.7}
        />
      </mesh>

      {/* Indicador de dueño (bolita de color sobre la mesa) */}
      {!esLibre && (
        <mesh position={[0, 0.55, 0]}>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshStandardMaterial
            color={esPropio ? '#22c55e' : '#f59e0b'}
            emissive={esPropio ? '#22c55e' : '#f59e0b'}
            emissiveIntensity={0.8}
          />
        </mesh>
      )}

      {/* Tooltip HTML (solo cuando cerca) */}
      {cercano && (
        <Html position={[0, 1.2, 0]} center style={{ pointerEvents: 'none' }}>
          <div className="bg-black/85 backdrop-blur-sm px-3 py-1.5 rounded-xl border border-white/10 whitespace-nowrap shadow-xl">
            <span className="text-[11px] text-white/90 font-medium">{label}</span>
          </div>
        </Html>
      )}

      {/* Glow de proximidad */}
      {cercano && (
        <pointLight
          color={esLibre ? '#22c55e' : esPropio ? '#6366f1' : '#ef4444'}
          intensity={1.5}
          distance={4}
          position={[0, 0.8, 0]}
        />
      )}
    </group>
  );
};
