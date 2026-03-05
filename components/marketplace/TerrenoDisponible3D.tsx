'use client';

import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import type { TerrenoMarketplace } from '@/types';
import { TIER_CONFIG } from '@/lib/terrenosMarketplace';

interface TerrenoDisponible3DProps {
  terreno: TerrenoMarketplace;
  onClick?: (terreno: TerrenoMarketplace) => void;
  seleccionado?: boolean;
}

export const TerrenoDisponible3D: React.FC<TerrenoDisponible3DProps> = ({
  terreno,
  onClick,
  seleccionado = false,
}) => {
  const meshRef = useRef<THREE.Mesh>(null!);
  const glowRef = useRef<THREE.Mesh>(null!);
  const borderRef = useRef<THREE.LineSegments>(null!);

  const tierInfo = TIER_CONFIG[terreno.tier] || TIER_CONFIG.starter;
  const esDisponible = terreno.estado === 'disponible';
  const esReservado = terreno.estado === 'reservado';

  const color = useMemo(() => new THREE.Color(tierInfo.color), [tierInfo.color]);
  const escalaBase = 0.02;

  const anchoWorld = terreno.ancho * escalaBase;
  const altoWorld = terreno.alto * escalaBase;
  const posX = terreno.posicion_x * escalaBase;
  const posZ = terreno.posicion_y * escalaBase;

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();

    if (glowRef.current && esDisponible) {
      const pulse = 0.3 + Math.sin(t * 2) * 0.15;
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity = pulse;
      glowRef.current.position.y = 0.01 + Math.sin(t * 1.5) * 0.02;
    }

    if (borderRef.current) {
      const borderPulse = seleccionado ? 1 : 0.5 + Math.sin(t * 3) * 0.3;
      (borderRef.current.material as THREE.LineBasicMaterial).opacity = borderPulse;
    }
  });

  const borderGeometry = useMemo(() => {
    const hw = anchoWorld / 2;
    const hh = altoWorld / 2;
    const points = [
      new THREE.Vector3(-hw, 0.05, -hh),
      new THREE.Vector3(hw, 0.05, -hh),
      new THREE.Vector3(hw, 0.05, hh),
      new THREE.Vector3(-hw, 0.05, hh),
      new THREE.Vector3(-hw, 0.05, -hh),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    return geo;
  }, [anchoWorld, altoWorld]);

  const precioTexto = terreno.precio_mensual > 0
    ? `$${terreno.precio_mensual}/mes`
    : 'Consultar';

  return (
    <group position={[posX, 0, posZ]}>
      {/* Suelo del terreno */}
      <mesh
        ref={meshRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.02, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.(terreno);
        }}
        onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { document.body.style.cursor = 'default'; }}
      >
        <planeGeometry args={[anchoWorld, altoWorld]} />
        <meshStandardMaterial
          color={esReservado ? '#ef4444' : color}
          transparent
          opacity={seleccionado ? 0.5 : 0.25}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Glow pulsante (solo disponible) */}
      {esDisponible && (
        <mesh
          ref={glowRef}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.01, 0]}
        >
          <planeGeometry args={[anchoWorld + 0.3, altoWorld + 0.3]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.2}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* Borde */}
      <lineSegments ref={borderRef} geometry={borderGeometry}>
        <lineBasicMaterial
          color={seleccionado ? '#ffffff' : esReservado ? '#ef4444' : color}
          transparent
          opacity={0.7}
          linewidth={1}
        />
      </lineSegments>

      {/* Nombre del terreno */}
      <Text
        position={[0, 0.6, 0]}
        fontSize={0.3}
        color="white"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.02}
        outlineColor="#000000"
      >
        {terreno.nombre}
      </Text>

      {/* Tier badge */}
      <Text
        position={[0, 0.3, 0]}
        fontSize={0.18}
        color={tierInfo.color}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.01}
        outlineColor="#000000"
      >
        {tierInfo.label} · {precioTexto}
      </Text>

      {/* Estado badge */}
      {esReservado && (
        <Text
          position={[0, 0.9, 0]}
          fontSize={0.22}
          color="#ef4444"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.02}
          outlineColor="#000000"
        >
          RESERVADO
        </Text>
      )}

      {/* Esquineros 3D (postes) */}
      {[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz], i) => (
        <mesh
          key={i}
          position={[sx * anchoWorld / 2, 0.15, sz * altoWorld / 2]}
        >
          <cylinderGeometry args={[0.03, 0.03, 0.3, 8]} />
          <meshStandardMaterial
            color={esReservado ? '#ef4444' : tierInfo.color}
            emissive={esReservado ? '#ef4444' : tierInfo.color}
            emissiveIntensity={0.5}
          />
        </mesh>
      ))}

      {/* Destacado: banderín */}
      {terreno.destacado && esDisponible && (
        <group position={[anchoWorld / 2 - 0.1, 0, -altoWorld / 2 + 0.1]}>
          <mesh position={[0, 0.5, 0]}>
            <cylinderGeometry args={[0.02, 0.02, 1, 8]} />
            <meshStandardMaterial color="#f59e0b" />
          </mesh>
          <Text
            position={[0.15, 0.85, 0]}
            fontSize={0.14}
            color="#f59e0b"
            anchorX="left"
            anchorY="middle"
            outlineWidth={0.01}
            outlineColor="#000000"
          >
            ★ DESTACADO
          </Text>
        </group>
      )}
    </group>
  );
};
