'use client';
import React, { useRef, useEffect, useMemo, Suspense, useState, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrthographicCamera, PerspectiveCamera, Grid, Text, CameraControls, Html, PerformanceMonitor, useGLTF } from '@react-three/drei';
import { Physics, RigidBody, CuboidCollider } from '@react-three/rapier';
import * as THREE from 'three';
import { User, PresenceStatus, ZonaEmpresa } from '@/types';
import { GLTFAvatar, useAvatarControls, AnimationState } from '../Avatar3DGLTF';
import { VideoWithBackground } from '../VideoWithBackground';
import { GhostAvatar } from '../3d/GhostAvatar';
import { ZonaEmpresa as ZonaEmpresa3D } from '../3d/ZonaEmpresa';
import { Escritorio3D } from '../3d/Escritorio3D';
import type { EspacioObjeto } from '@/hooks/space3d/useEspacioObjetos';
import { DayNightCycle } from '../3d/DayNightCycle';
import { ObjetosInteractivos } from '../3d/ObjetosInteractivos';
import { ParticulasClima } from '../3d/ParticulasClima';
import { EmoteSync, useSyncEffects } from '../3d/EmoteSync';
import { hapticFeedback, isMobileDevice } from '@/lib/mobileDetect';
import { useStore } from '@/store/useStore';
import { type CameraSettings } from '../CameraSettingsMenu';
import { obtenerEstadoUsuarioEcs, type EstadoEcsEspacio } from '@/lib/ecs/espacioEcs';
import { type JoystickInput } from '../3d/MobileJoystick';
import { getSettingsSection } from '@/lib/userSettings';
import {
  AvatarLodLevel, DireccionAvatar, themeColors,
  MOVE_SPEED, RUN_SPEED, WORLD_SIZE, TELEPORT_DISTANCE,
  CHAIR_SIT_RADIUS, CHAIR_POSITIONS_3D, LOD_NEAR_DISTANCE, LOD_MID_DISTANCE,
  USAR_LIVEKIT, playTeleportSound, IconPrivacy, IconExpand,
} from './shared';
import { statusColors, STATUS_LABELS, type VirtualSpace3DProps } from './spaceTypes';
import { Player, type PlayerProps } from './Player3D';
import { RemoteUsers, CameraFollow, TeleportEffect, type AvatarProps } from './Avatar3DScene';

// --- Scene ---
export interface SceneProps {
  currentUser: User;
  onlineUsers: User[];
  setPosition: (x: number, y: number, direction?: string, isSitting?: boolean, isMoving?: boolean) => void;
  theme: string;
  orbitControlsRef: React.MutableRefObject<any>;
  stream: MediaStream | null;
  remoteStreams: Map<string, MediaStream>;
  showVideoBubbles?: boolean;
  localMessage?: string;
  remoteMessages: Map<string, string>;
  localReactions?: Array<{ id: string; emoji: string }>;
  remoteReaction?: { emoji: string; from: string; fromName: string } | null;
  onClickAvatar?: () => void;
  moveTarget?: { x: number; z: number } | null;
  onReachTarget?: () => void;
  onDoubleClickFloor?: (point: THREE.Vector3) => void;
  onTapFloor?: (point: THREE.Vector3) => void;
  teleportTarget?: { x: number; z: number } | null;
  onTeleportDone?: () => void;
  showFloorGrid?: boolean;
  showNamesAboveAvatars?: boolean;
  cameraSensitivity?: number;
  invertYAxis?: boolean;
  cameraMode?: string;
  realtimePositionsRef?: React.MutableRefObject<Map<string, any>>;
  interpolacionWorkerRef?: React.MutableRefObject<Worker | null>;
  posicionesInterpoladasRef?: React.MutableRefObject<Map<string, { x: number; z: number; direction?: DireccionAvatar; isMoving?: boolean }>>;
  ecsStateRef?: React.MutableRefObject<EstadoEcsEspacio>;
  broadcastMovement?: (x: number, y: number, direction: string, isMoving: boolean, animState?: string, reliable?: boolean) => void;
  moveSpeed?: number;
  runSpeed?: number;
  zonasEmpresa?: ZonaEmpresa[];
  onZoneCollision?: (zonaId: string | null) => void;
  usersInCallIds?: Set<string>;
  usersInAudioRangeIds?: Set<string>;
  empresasAutorizadas?: string[];
  mobileInputRef?: React.MutableRefObject<JoystickInput>;
  enableDayNightCycle?: boolean;
  onXPEvent?: (accion: string, cooldownMs?: number) => void;
  onClickRemoteAvatar?: (userId: string) => void;
  avatarInteractions?: AvatarProps['avatarInteractions'];
  espacioObjetos?: EspacioObjeto[];
  onReclamarObjeto?: (id: string) => void;
  onLiberarObjeto?: (id: string) => void;
  objetoOwnerNames?: Map<string, string>;
}

export const Scene: React.FC<SceneProps> = ({ currentUser, onlineUsers, setPosition, theme, orbitControlsRef, stream, remoteStreams, showVideoBubbles = true, localMessage, remoteMessages, localReactions, remoteReaction, onClickAvatar, moveTarget, onReachTarget, onDoubleClickFloor, onTapFloor, teleportTarget, onTeleportDone, showFloorGrid = false, showNamesAboveAvatars = true, cameraSensitivity = 5, invertYAxis = false, cameraMode = 'free', realtimePositionsRef, interpolacionWorkerRef, posicionesInterpoladasRef, ecsStateRef, broadcastMovement, moveSpeed, runSpeed, zonasEmpresa = [], onZoneCollision, usersInCallIds, usersInAudioRangeIds, empresasAutorizadas = [], mobileInputRef, enableDayNightCycle = false, onXPEvent, onClickRemoteAvatar, avatarInteractions, espacioObjetos = [], onReclamarObjeto, onLiberarObjeto, objetoOwnerNames }) => {
  const gridColor = theme === 'arcade' ? '#00ff41' : '#6366f1';
  const { camera } = useThree();
  const frustumRef = useRef(new THREE.Frustum());
  const projectionRef = useRef(new THREE.Matrix4());
  const chairMeshRef = useRef<THREE.InstancedMesh>(null);
  const chairDummy = useMemo(() => new THREE.Object3D(), []);
  const playerColliderRef = useRef<any>(null);
  const playerColliderPositionRef = useRef({ x: (currentUser.x || 400) / 16, z: (currentUser.y || 400) / 16 });
  const zonaColisionRef = useRef<string | null>(null);
  
  // Cargar el modelo del terreno exportado desde Blender
  const { scene: terrainScene } = useGLTF('/models/terrain.glb');
  const chairPositions = useMemo(
    () => [
      [8, 0.35, 8],
      [12, 0.35, 8],
      [8, 0.35, 12],
      [12, 0.35, 12],
      [8, 0.35, 10],
      [12, 0.35, 10],
    ],
    []
  );

  useFrame(() => {
    projectionRef.current.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustumRef.current.setFromProjectionMatrix(projectionRef.current);
  });

  useFrame(() => {
    if (!playerColliderRef.current) return;
    playerColliderRef.current.setNextKinematicTranslation({
      x: playerColliderPositionRef.current.x,
      y: 0,
      z: playerColliderPositionRef.current.z,
    });
  });

  const handlePlayerPositionUpdate = useCallback((x: number, z: number) => {
    playerColliderPositionRef.current = { x, z };
  }, []);

  const handleZoneEnter = useCallback((payload: any) => {
    const zonaId = payload?.other?.rigidBodyObject?.userData?.zonaId ?? payload?.other?.colliderObject?.userData?.zonaId;
    if (!zonaId || zonaColisionRef.current === zonaId) return;
    zonaColisionRef.current = zonaId;
    onZoneCollision?.(zonaId);
  }, [onZoneCollision]);

  const handleZoneExit = useCallback((payload: any) => {
    const zonaId = payload?.other?.rigidBodyObject?.userData?.zonaId ?? payload?.other?.colliderObject?.userData?.zonaId;
    if (!zonaId || zonaColisionRef.current !== zonaId) return;
    zonaColisionRef.current = null;
    onZoneCollision?.(null);
  }, [onZoneCollision]);

  useEffect(() => {
    if (!chairMeshRef.current) return;
    chairPositions.forEach((pos, idx) => {
      chairDummy.position.set(pos[0], pos[1], pos[2]);
      chairDummy.updateMatrix();
      chairMeshRef.current?.setMatrixAt(idx, chairDummy.matrix);
    });
    chairMeshRef.current.instanceMatrix.needsUpdate = true;
  }, [chairPositions, chairDummy]);

  return (
    <>
      {/* Iluminación: DayNightCycle dinámico o luces estáticas */}
      {enableDayNightCycle ? (
        <DayNightCycle enabled={true} />
      ) : (
        <>
          <ambientLight intensity={0.7} />
          <directionalLight position={[10, 20, 10]} intensity={1.2} castShadow />
        </>
      )}
      
      {/* CameraControls (drei) — basado en camera-controls de yomotsu.
          Reemplaza OrbitControls + CameraFollow manual.
          - smoothTime controla damping (menor = más rápido)
          - No usa props declarativos de position/target (evita reset en re-renders)
          - CameraFollow maneja el seguimiento del jugador via setTarget/setPosition */}
      <CameraControls
        ref={orbitControlsRef}
        makeDefault
        minDistance={5}
        maxDistance={50}
        maxPolarAngle={Math.PI / 2 - 0.1}
        minPolarAngle={Math.PI / 6}
        truckSpeed={cameraMode === 'free' ? 0.5 : 0}
        azimuthRotateSpeed={cameraMode !== 'fixed' ? cameraSensitivity / 10 : 0}
        polarRotateSpeed={cameraMode !== 'fixed' ? cameraSensitivity / 10 : 0}
        dollySpeed={0.8}
        smoothTime={0.15}
      />
      
      {showFloorGrid && (
        <Grid
          args={[WORLD_SIZE * 2, WORLD_SIZE * 2]}
          position={[WORLD_SIZE / 2, 0, WORLD_SIZE / 2]}
          cellSize={1}
          cellThickness={0.5}
          cellColor={gridColor}
          sectionSize={5}
          sectionThickness={1}
          sectionColor={gridColor}
          fadeDistance={100}
          fadeStrength={1}
          followCamera={false}
        />
      )}
      
      {/* Piso importado desde Blender (Estilo Riot Games: Malla estática pura con texturas) */}
      <group position={[-25, -0.02, 75]}>
        <primitive 
          object={terrainScene} 
          receiveShadow 
        />
      </group>

      {/* Suelo base invisible para Raycast (eventos de clic/tap) — Restaurado para mantener estabilidad de colisiones y coordenadas */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}
        onClick={(e) => {
          e.stopPropagation();
          if (onTapFloor) onTapFloor(e.point);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (onDoubleClickFloor) onDoubleClickFloor(e.point);
        }}
        visible={false}
      >
        <planeGeometry args={[1000, 1000]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      {/* Zonas por empresa */}
      {zonasEmpresa.filter((zona) => zona.estado === 'activa').map((zona) => {
        const anchoZona = Math.max(1, Number(zona.ancho) / 16);
        const altoZona = Math.max(1, Number(zona.alto) / 16);
        const posicionX = Number(zona.posicion_x) / 16;
        const posicionZ = Number(zona.posicion_y) / 16;
        const colorZona = zona.color || '#64748b';
        const esZonaComun = !!zona.es_comun;
        const esZonaPropia = !!zona.empresa_id && zona.empresa_id === currentUser.empresa_id;
        const variante = esZonaComun ? 'comun' : esZonaPropia ? 'propia' : 'ajena';
        const nombreZona = zona.nombre_zona || (esZonaComun ? 'Zona común' : zona.empresa?.nombre) || undefined;
        const opacidad = variante === 'propia' ? 0.45 : variante === 'comun' ? 0.2 : 0.28;

        return (
          <ZonaEmpresa3D
            key={zona.id}
            posicion={[posicionX, 0.01, posicionZ]}
            ancho={anchoZona}
            alto={altoZona}
            color={colorZona}
            nombre={nombreZona}
            logoUrl={zona.empresa?.logo_url ?? null}
            esZonaComun={esZonaComun}
            variante={variante}
            opacidad={opacidad}
          />
        );
      })}

      <Physics gravity={[0, 0, 0]}>
        <RigidBody
          ref={playerColliderRef}
          type="kinematicPosition"
          colliders={false}
          onIntersectionEnter={handleZoneEnter}
          onIntersectionExit={handleZoneExit}
        >
          <CuboidCollider args={[0.45, 1, 0.45]} />
        </RigidBody>
        {zonasEmpresa.filter((zona) => zona.estado === 'activa').map((zona) => {
          const anchoZona = Math.max(1, Number(zona.ancho) / 16);
          const altoZona = Math.max(1, Number(zona.alto) / 16);
          const posicionX = Number(zona.posicion_x) / 16;
          const posicionZ = Number(zona.posicion_y) / 16;
          return (
            <RigidBody key={`zona-collider-${zona.id}`} type="fixed" colliders={false} userData={{ zonaId: zona.id }}>
              <CuboidCollider
                args={[anchoZona / 2, 1, altoZona / 2]}
                position={[posicionX, 0, posicionZ]}
                sensor
              />
            </RigidBody>
          );
        })}
      </Physics>
      
      {/* Marcador visual del destino (estilo Gather) */}
      {moveTarget && (
        <group position={[moveTarget.x, 0.05, moveTarget.z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.3, 0.5, 32]} />
            <meshBasicMaterial color="#6366f1" transparent opacity={0.6} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.2, 32]} />
            <meshBasicMaterial color="#6366f1" transparent opacity={0.3} />
          </mesh>
        </group>
      )}

      {/* Escritorios persistentes desde BD */}
      {espacioObjetos.map((obj) => (
        <Escritorio3D
          key={obj.id}
          objeto={obj}
          playerPosition={playerColliderPositionRef.current}
          currentUserId={currentUser.id || null}
          onReclamar={onReclamarObjeto || (() => {})}
          onLiberar={onLiberarObjeto || (() => {})}
          ownerName={objetoOwnerNames?.get(obj.owner_id || '') || null}
        />
      ))}

      {/* Mesas y objetos (Demo) */}
      <mesh position={[10, 0.5, 10]} castShadow receiveShadow>
        <boxGeometry args={[4, 1, 2]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
      <Text position={[10, 1.5, 10]} fontSize={0.5} color="white" anchorX="center" anchorY="middle">
        Mesa de Reunión
      </Text>

      <instancedMesh ref={chairMeshRef} args={[undefined, undefined, chairPositions.length]} castShadow receiveShadow>
        <boxGeometry args={[1, 0.6, 1]} />
        <meshStandardMaterial color="#0f172a" />
      </instancedMesh>
      
      <mesh position={[25, 0.02, 10]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[6, 6]} />
        <meshBasicMaterial color="#3b82f6" opacity={0.15} transparent />
      </mesh>
      <Text position={[25, 0.1, 13.5]} fontSize={0.3} color="#3b82f6" anchorX="center">
        Sala 2
      </Text>
      
      {/* Jugador actual */}
      <Player 
        currentUser={currentUser} 
        setPosition={setPosition} 
        stream={stream} 
        showVideoBubble={showVideoBubbles && !usersInCallIds?.size} // Bug 1 Fix: Ocultar bubble local si hay llamada activa (HUD visible)
        message={localMessage} 
        reactions={localReactions}
        onClickAvatar={onClickAvatar}
        moveTarget={moveTarget}
        onReachTarget={onReachTarget}
        teleportTarget={teleportTarget}
        onTeleportDone={onTeleportDone}
        broadcastMovement={broadcastMovement}
        moveSpeed={moveSpeed}
        runSpeed={runSpeed}
        ecsStateRef={ecsStateRef}
        onPositionUpdate={handlePlayerPositionUpdate}
        zonasEmpresa={zonasEmpresa}
        empresasAutorizadas={empresasAutorizadas}
        usersInCallIds={usersInCallIds}
        mobileInputRef={mobileInputRef}
        onXPEvent={onXPEvent}
      />
      
      {/* Cámara que sigue al jugador — DEBE montarse DESPUÉS de Player para que useFrame lea posición actualizada */}
      <CameraFollow controlsRef={orbitControlsRef} />
      
      {/* Usuarios remotos */}
      <RemoteUsers users={onlineUsers} remoteStreams={remoteStreams} showVideoBubble={showVideoBubbles} usersInCallIds={usersInCallIds} usersInAudioRangeIds={usersInAudioRangeIds} remoteMessages={remoteMessages} remoteReaction={remoteReaction} realtimePositionsRef={realtimePositionsRef} interpolacionWorkerRef={interpolacionWorkerRef} posicionesInterpoladasRef={posicionesInterpoladasRef} ecsStateRef={ecsStateRef} frustumRef={frustumRef} onClickRemoteAvatar={onClickRemoteAvatar} avatarInteractions={avatarInteractions} />

      {/* Objetos interactivos — ocultos hasta tener modelos GLB reales
      <ObjetosInteractivos
        playerPosition={playerColliderPositionRef.current}
        onInteract={(tipo) => {
          if (tipo === 'coffee') {
            if (currentUser?.id) {}
          }
        }}
      />
      */}

      {/* Partículas clima — ocultas hasta ajuste visual
      <ParticulasClima
        centro={playerColliderPositionRef.current}
      />
      */}
    </>
  );
};

