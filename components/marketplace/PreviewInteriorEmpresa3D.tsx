'use client';

import React, { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';
import type { ObjetoEspacio } from '@/lib/terrenosMarketplace';

/**
 * Escritorio3D read-only — replica exacta de la geometría real
 */
const EscritorioPreview: React.FC<{
  posicion: [number, number, number];
  rotacionY: number;
  ocupado: boolean;
}> = ({ posicion, rotacionY, ocupado }) => (
  <group position={posicion} rotation={[0, rotacionY, 0]}>
    <mesh position={[0, 0.4, 0]} castShadow>
      <boxGeometry args={[2.4, 0.12, 1.2]} />
      <meshStandardMaterial color={ocupado ? '#475569' : '#1e293b'} roughness={0.6} metalness={0.2} />
    </mesh>
    {[[-1, -0.45], [1, -0.45], [-1, 0.45], [1, 0.45]].map(([px, pz], i) => (
      <mesh key={i} position={[px, 0.17, pz]} castShadow>
        <boxGeometry args={[0.08, 0.34, 0.08]} />
        <meshStandardMaterial color="#0f172a" roughness={0.8} />
      </mesh>
    ))}
    <mesh position={[0, 0.3, -0.9]} castShadow>
      <boxGeometry args={[0.6, 0.6, 0.5]} />
      <meshStandardMaterial color={ocupado ? '#1e293b' : '#334155'} roughness={0.7} />
    </mesh>
    {ocupado && (
      <mesh position={[0, 0.55, 0]}>
        <sphereGeometry args={[0.08, 12, 12]} />
        <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={0.8} />
      </mesh>
    )}
  </group>
);

/**
 * GhostAvatar animado — se mueve suavemente (idle animation)
 */
const GhostAvatarAnimado: React.FC<{
  posicionBase: [number, number, number];
  indice: number;
  sentado: boolean;
}> = ({ posicionBase, indice, sentado }) => {
  const ref = useRef<THREE.Group>(null);
  const seed = useMemo(() => indice * 1.37, [indice]);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();

    if (sentado) {
      // Sentado: solo respira (sube y baja levemente)
      ref.current.position.y = posicionBase[1] + Math.sin(t * 1.5 + seed) * 0.02;
      // Pequeña rotación de cabeza
      ref.current.rotation.y = Math.sin(t * 0.8 + seed * 2) * 0.15;
    } else {
      // Caminando: se mueve en óvalo
      const radius = 1.5 + indice * 0.3;
      const speed = 0.3 + indice * 0.05;
      ref.current.position.x = posicionBase[0] + Math.cos(t * speed + seed) * radius;
      ref.current.position.z = posicionBase[2] + Math.sin(t * speed + seed) * radius;
      ref.current.position.y = posicionBase[1] + Math.abs(Math.sin(t * speed * 2 + seed)) * 0.08;
      // Mira hacia donde camina
      ref.current.rotation.y = Math.atan2(
        -Math.sin(t * speed + seed) * radius,
        -Math.cos(t * speed + seed) * radius * speed
      );
    }
  });

  return (
    <group ref={ref} position={posicionBase}>
      {/* Cabeza */}
      <mesh position={[0, 1.1, 0]}>
        <sphereGeometry args={[0.35, 12, 12]} />
        <meshStandardMaterial color="#94a3b8" transparent opacity={0.4} />
      </mesh>
      {/* Cuerpo */}
      <mesh position={[0, 0.45, 0]}>
        <cylinderGeometry args={[0.28, 0.38, 0.7, 10]} />
        <meshStandardMaterial color="#94a3b8" transparent opacity={0.35} />
      </mesh>
      {/* Sombra */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.5, 12]} />
        <meshStandardMaterial color="#94a3b8" transparent opacity={0.1} />
      </mesh>
    </group>
  );
};

/**
 * Escena interior del espacio de la empresa
 */
const EscenaInterior: React.FC<{
  objetos: ObjetoEspacio[];
  miembros: number;
  color: string;
}> = ({ objetos, miembros, color }) => {
  // Calcular centro y bounds de los objetos
  const { centroX, centroZ, camDist } = useMemo(() => {
    if (objetos.length === 0) return { centroX: 0, centroZ: 0, camDist: 8 };
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    objetos.forEach((o) => {
      minX = Math.min(minX, o.posicion_x);
      maxX = Math.max(maxX, o.posicion_x);
      minZ = Math.min(minZ, o.posicion_z);
      maxZ = Math.max(maxZ, o.posicion_z);
    });
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const span = Math.max(maxX - minX, maxZ - minZ, 6);
    return { centroX: cx, centroZ: cz, camDist: span * 1.2 };
  }, [objetos]);

  // GhostAvatars: sentados en escritorios + caminando
  const ghostData = useMemo(() => {
    const ghosts: Array<{ pos: [number, number, number]; sentado: boolean }> = [];
    const count = Math.min(miembros, 10);
    for (let i = 0; i < count; i++) {
      if (i < objetos.length) {
        const o = objetos[i];
        ghosts.push({
          pos: [o.posicion_x, 0, o.posicion_z - 1.2],
          sentado: true,
        });
      } else {
        ghosts.push({
          pos: [centroX, 0, centroZ],
          sentado: false,
        });
      }
    }
    return ghosts;
  }, [miembros, objetos, centroX, centroZ]);

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[8, 12, 8]} intensity={0.7} castShadow />
      <directionalLight position={[-4, 8, -4]} intensity={0.3} />

      <fog attach="fog" args={['#0f172a', 20, 50]} />
      <color attach="background" args={['#0f172a']} />

      {/* Suelo */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[centroX, -0.01, centroZ]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color="#1a1a2e" />
      </mesh>

      {/* Grid sutil en el suelo */}
      <gridHelper args={[30, 30, '#1e293b', '#1e293b']} position={[centroX, 0, centroZ]} />

      {/* Borde de la zona */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[centroX, 0.005, centroZ]}>
        <planeGeometry args={[14, 14]} />
        <meshStandardMaterial color={color} transparent opacity={0.06} />
      </mesh>

      {/* Escritorios REALES de la BD */}
      {objetos.map((obj) => (
        <EscritorioPreview
          key={obj.id}
          posicion={[obj.posicion_x, obj.posicion_y, obj.posicion_z]}
          rotacionY={obj.rotacion_y || 0}
          ocupado={obj.owner_id !== null}
        />
      ))}

      {/* GhostAvatars animados */}
      {ghostData.map((g, i) => (
        <GhostAvatarAnimado
          key={`ghost-${i}`}
          posicionBase={g.pos}
          indice={i}
          sentado={g.sentado}
        />
      ))}

      {/* Cámara orbital */}
      <OrbitControls
        makeDefault
        enablePan={false}
        enableZoom
        enableRotate
        minDistance={4}
        maxDistance={20}
        maxPolarAngle={Math.PI / 2.3}
        minPolarAngle={0.3}
        target={[centroX, 0.5, centroZ]}
        autoRotate
        autoRotateSpeed={0.5}
      />
    </>
  );
};

/**
 * Preview 3D Live del interior de una empresa
 * Se renderiza dentro del panel lateral al clickear una zona
 */
interface PreviewInteriorEmpresa3DProps {
  objetos: ObjetoEspacio[];
  miembros: number;
  color: string;
}

export const PreviewInteriorEmpresa3D: React.FC<PreviewInteriorEmpresa3DProps> = ({
  objetos,
  miembros,
  color,
}) => {
  return (
    <div className="relative w-full h-56 rounded-xl overflow-hidden border border-white/10 bg-[#0f172a]">
      <Canvas
        camera={{
          position: [20, 8, 20],
          fov: 45,
          near: 0.1,
          far: 100,
        }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: false }}
      >
        <Suspense fallback={null}>
          <EscenaInterior objetos={objetos} miembros={miembros} color={color} />
        </Suspense>
      </Canvas>

      {/* Overlay info */}
      <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 bg-black/60 backdrop-blur-sm rounded-lg border border-white/10">
        <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        <span className="text-[9px] text-green-300 font-bold uppercase tracking-wider">
          Vista en vivo
        </span>
      </div>

      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
        <span className="text-[9px] text-zinc-500">Arrastra para rotar · Scroll para zoom</span>
        <span className="text-[9px] text-zinc-400 font-medium">{objetos.length} escritorios · {miembros} activos</span>
      </div>
    </div>
  );
};
