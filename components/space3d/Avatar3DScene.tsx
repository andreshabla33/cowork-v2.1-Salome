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
import { statusColors, type VirtualSpace3DProps } from './spaceTypes';
import { StableVideo } from './Overlays';

// --- Avatar ---
export interface AvatarProps {
  position: THREE.Vector3;
  config: any;
  name: string;
  status: PresenceStatus;
  isCurrentUser?: boolean;
  animationState?: AnimationState;
  direction?: string;
  reaction?: string | null;
  videoStream?: MediaStream | null;
  camOn?: boolean;
  showVideoBubble?: boolean;
  message?: string | null;
  onClickAvatar?: () => void;
  onClickRemoteAvatar?: (userId: string) => void;
  userId?: string;
  mirrorVideo?: boolean;
  hideSelfView?: boolean;
  showName?: boolean;
  lodLevel?: AvatarLodLevel;
  esFantasma?: boolean;
  remoteAvatar3DConfig?: any;
  // Interacciones Gather-style avanzadas (Fases A-C)
  avatarInteractions?: {
    onGoTo?: (userId: string) => void;
    onNudge?: (userId: string) => void;
    onInvite?: (userId: string) => void;
    onFollow?: (userId: string) => void;
    onWave?: (userId: string) => void;
    followTargetId?: string | null;
    profilePhoto?: string | null;
  };
}

// Labels de estado para mostrar al hacer clic
const STATUS_LABELS: Record<PresenceStatus, string> = {
  [PresenceStatus.AVAILABLE]: 'Disponible',
  [PresenceStatus.BUSY]: 'Ocupado',
  [PresenceStatus.AWAY]: 'Ausente',
  [PresenceStatus.DND]: 'No molestar',
};

export const Avatar: React.FC<AvatarProps> = ({ position, config, name, status, isCurrentUser, animationState = 'idle', direction, reaction, videoStream, camOn, showVideoBubble = true, message, onClickAvatar, onClickRemoteAvatar, userId, mirrorVideo: mirrorVideoProp, hideSelfView: hideSelfViewProp, showName: showNameProp, lodLevel: lodLevelProp, esFantasma = false, remoteAvatar3DConfig, avatarInteractions }) => {
  const [showStatusLabel, setShowStatusLabel] = useState(false);
  const [showFloatingCard, setShowFloatingCard] = useState(false);
  const [showRadialWheel, setShowRadialWheel] = useState(false);
  const [avatarHeight, setAvatarHeight] = useState(2.0);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastClickRef = useRef(0);
  const clickPreventedRef = useRef(false);
  const { avatar3DConfig } = useStore();
  
  // Leer video settings, space3d settings y performance settings desde localStorage
  const videoSettings = useMemo(() => getSettingsSection('video'), []);
  const space3dS = useMemo(() => getSettingsSection('space3d'), []);
  const perfS = useMemo(() => getSettingsSection('performance'), []);
  const mirrorVideo = mirrorVideoProp ?? videoSettings.mirrorVideo ?? true;
  const hideSelfView = hideSelfViewProp ?? videoSettings.hideSelfView ?? false;
  const showName = showNameProp ?? space3dS.showNamesAboveAvatars ?? true;
  const lodLevel = lodLevelProp ?? 'high';
  const showHigh = lodLevel === 'high';
  const showMid = lodLevel === 'mid';
  const showLow = lodLevel === 'low';
  // Misma empresa: siempre GLTF (nunca sprites) — estilo Gather.town
  const esMismaEmpresa = !esFantasma && !isCurrentUser;
  const renderGLTF = showHigh || (esMismaEmpresa && (showMid || showLow));
  const renderSprite = !renderGLTF && (showMid || showLow);
  const gltfScale = showHigh ? 1.2 : showMid ? 0.9 : 0.6; // Escala reducida a distancia
  
  // Posiciones Y basadas en altura REAL medida con computeBoundingBox post-render.
  // avatarHeight = altura visual real del avatar en unidades de escena (top del HeadTop_End).
  // Sumamos un padding extra para evitar que el nombre choque con cuernos, sombreros, etc.
  const nameY = avatarHeight + 0.4;
  const videoY = avatarHeight + 1.15;
  const chatY = avatarHeight + (camOn ? 2.75 : 0.95);
  const reactionY = avatarHeight + (camOn ? 1.75 : 0.65);
  const radialY = avatarHeight + (camOn ? 2.05 : 0.65);
  const allowDetails = showHigh;
  // Misma empresa: nombre visible a cualquier distancia, video bubble visible a cualquier LOD (estilo LOL/Roblox)
  const allowName = showName && (!camOn || !(showHigh || showMid)) && (esMismaEmpresa || lodLevel !== 'low');
  const allowVideo = (showHigh || showMid || (esMismaEmpresa && showLow)) && camOn;
  const allowMessage = allowDetails && message;
  const allowReaction = (showHigh || showMid) && reaction;
  const spriteColor = isCurrentUser ? '#60a5fa' : statusColors[status];
  // Si animaciones desactivadas, forzar idle
  const effectiveAnimState = perfS.showAvatarAnimations === false ? 'idle' as AnimationState : animationState;
  
  // Auto-ocultar el label después de 2 segundos
  useEffect(() => {
    if (showStatusLabel) {
      const timer = setTimeout(() => setShowStatusLabel(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [showStatusLabel]);

  // Cerrar card/radial al hacer clic fuera (Escape)
  useEffect(() => {
    if (!showFloatingCard && !showRadialWheel) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowFloatingCard(false); setShowRadialWheel(false); }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [showFloatingCard, showRadialWheel]);

  // Handler de interacción multi-gesto para avatares remotos
  const handlePointerDown = useCallback((e: any) => {
    if (isCurrentUser || !userId || !avatarInteractions) return;
    e.stopPropagation();
    clickPreventedRef.current = false;
    // Iniciar timer para clic sostenido (500ms) → radial wheel
    longPressTimerRef.current = setTimeout(() => {
      clickPreventedRef.current = true;
      setShowFloatingCard(false);
      setShowRadialWheel(true);
    }, 500);
  }, [isCurrentUser, userId, avatarInteractions]);

  const handlePointerUp = useCallback((e: any) => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
  }, []);

  const handleClick = useCallback((e: any) => {
    e.stopPropagation();
    if (isCurrentUser && onClickAvatar) { onClickAvatar(); return; }
    if (isCurrentUser || !userId) return;
    // Si fue clic sostenido, no procesar como clic normal
    if (clickPreventedRef.current) { clickPreventedRef.current = false; return; }

    const now = Date.now();
    const timeSinceLastClick = now - lastClickRef.current;
    lastClickRef.current = now;

    // Doble clic (< 350ms) → teleport directo (Fase B)
    if (timeSinceLastClick < 350 && avatarInteractions?.onGoTo) {
      setShowFloatingCard(false);
      setShowRadialWheel(false);
      avatarInteractions.onGoTo(userId);
      return;
    }

    // Clic simple → emitir evento al componente principal para card screen-space (Fase A)
    setShowRadialWheel(false);
    if (onClickRemoteAvatar) {
      onClickRemoteAvatar(userId);
    }
  }, [isCurrentUser, userId, onClickAvatar, onClickRemoteAvatar]);
  
  return (
    <group position={position}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {/* Hitbox invisible para capturar raycast (r3f no propaga eventos click a group sin mesh) */}
      {!isCurrentUser && (
        <mesh visible={false}>
          <cylinderGeometry args={[0.8, 0.8, 3, 8]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>
      )}
      {/* Avatar 3D GLTF — misma empresa siempre GLTF (estilo Gather) */}
      {renderGLTF && (
        <GLTFAvatar
          key={isCurrentUser ? (avatar3DConfig?.modelo_url || 'default') : (remoteAvatar3DConfig?.modelo_url || 'remote')}
          avatarConfig={isCurrentUser ? avatar3DConfig : (remoteAvatar3DConfig || undefined)}
          animationState={effectiveAnimState}
          direction={direction}
          skinColor={config?.skinColor}
          clothingColor={config?.clothingColor}
          scale={gltfScale}
          onHeightComputed={setAvatarHeight}
        />
      )}
      {/* Sprites solo para otras empresas o LOD bajo sin empresa */}
      {renderSprite && (
        <sprite scale={showMid ? [1.6, 1.6, 1.6] : [0.8, 0.8, 0.8]}>
          <spriteMaterial color={spriteColor} />
        </sprite>
      )}
      
      {/* Mensaje de Chat - Burbuja moderna 2026 (glassmorphism + pill shape) */}
      {allowMessage && (
        <Html position={[0, chatY, 0]} center distanceFactor={10} zIndexRange={[100, 0]}>
          <div className="animate-chat-bubble">
            <div className="bg-white/95 backdrop-blur-sm text-gray-800 px-3 py-1.5 rounded-full shadow-lg max-w-[180px] text-xs font-medium whitespace-nowrap overflow-hidden text-ellipsis">
              {message}
            </div>
            {/* Indicador de cola sutil */}
            <div className="flex justify-center -mt-0.5">
              <div className="w-2 h-2 bg-white/95 rotate-45 shadow-sm"></div>
            </div>
          </div>
        </Html>
      )}
      
      {/* Video Bubble above avatar (Gather style) */}
      {allowVideo && showVideoBubble && !(isCurrentUser && hideSelfView) && (
        <Html position={[0, videoY, 0]} center distanceFactor={12} zIndexRange={[100, 0]}>
          <div className="w-24 h-16 rounded-[12px] overflow-hidden border-[2px] border-[#6366f1] shadow-lg bg-black relative transform transition-all hover:scale-125 flex items-center justify-center">
             {videoStream && videoStream.getVideoTracks().length > 0 ? (
               <StableVideo stream={videoStream} muted={isCurrentUser} className={`w-full h-full object-cover transform scale-110 ${isCurrentUser && mirrorVideo ? '-scale-x-100' : ''}`} />
             ) : (
               /* Placeholder cuando hay cámara pero no hay stream (usuario lejos) */
               <div className="flex flex-col items-center justify-center w-full h-full bg-gradient-to-br from-indigo-900/80 to-purple-900/80">
                 <div className="w-8 h-8 rounded-full bg-indigo-500/30 flex items-center justify-center mb-1">
                   <svg className="w-4 h-4 text-indigo-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                   </svg>
                 </div>
                 <span className="text-[9px] text-white/80 font-medium">{name.split(' ')[0]}</span>
               </div>
             )}
          </div>
        </Html>
      )}
      
      {/* Reacción emoji encima del avatar - Animación 2026 */}
      {allowReaction && (
        <Html position={[0, reactionY, 0]} center distanceFactor={8} zIndexRange={[200, 0]}>
          <div className="animate-emoji-float text-5xl drop-shadow-[0_4px_12px_rgba(0,0,0,0.4)]">
            {reaction}
          </div>
        </Html>
      )}
      
      {/* Nombre flotante con indicador de estado - Clickeable para ver estado */}
      {!allowVideo && allowName && (
        <Html position={[0, nameY, 0]} center distanceFactor={10} zIndexRange={[100, 0]} sprite>
          <div 
            className={`flex items-center gap-1 whitespace-nowrap ${!isCurrentUser ? 'cursor-pointer hover:scale-105 transition-transform' : ''}`}
            style={{ willChange: 'transform' }}
            onClick={() => !isCurrentUser && setShowStatusLabel(true)}
          >
            <span 
              className="text-sm font-medium drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
              style={{ color: isCurrentUser ? '#60a5fa' : '#ffffff' }}
            >
              {name}
            </span>
            <span 
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: statusColors[status] }}
            />
          </div>
          {/* Tooltip con nombre del estado al hacer clic */}
          {showStatusLabel && !isCurrentUser && (
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 animate-emoji-popup">
              <div 
                className="px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider text-white shadow-lg whitespace-nowrap"
                style={{ backgroundColor: statusColors[status] }}
              >
                {STATUS_LABELS[status]}
              </div>
            </div>
          )}
        </Html>
      )}

      {/* Card flotante Fase A movida a screen-space overlay en componente principal */}

      {/* === FASE C: Radial Wheel (clic sostenido 500ms) estilo LoL === */}
      {showRadialWheel && !isCurrentUser && userId && avatarInteractions && (
        <Html position={[0, radialY, 0]} center distanceFactor={6} zIndexRange={[310, 0]}>
          <div className="select-none pointer-events-auto" onClick={(e) => { e.stopPropagation(); setShowRadialWheel(false); }}>
            <div className="relative w-[160px] h-[160px] animate-in fade-in zoom-in-50 duration-100">
              {/* Centro: nombre */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-zinc-800/90 border border-white/10 flex items-center justify-center z-10">
                <span className="text-[9px] font-bold text-white/60 text-center leading-tight truncate px-1">{name.split(' ')[0]}</span>
              </div>
              {/* Arriba: Follow */}
              <button onClick={(e) => { e.stopPropagation(); avatarInteractions.onFollow?.(userId); setShowRadialWheel(false); }}
                className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-12 rounded-full bg-violet-600/80 hover:bg-violet-500 border border-violet-400/30 flex flex-col items-center justify-center text-white transition-all hover:scale-110 shadow-lg"
                title="Seguir">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                <span className="text-[7px] font-bold mt-0.5">{avatarInteractions.followTargetId === userId ? 'Dejar' : 'Seguir'}</span>
              </button>
              {/* Derecha: Invite */}
              <button onClick={(e) => { e.stopPropagation(); avatarInteractions.onInvite?.(userId); setShowRadialWheel(false); }}
                className="absolute top-1/2 right-0 -translate-y-1/2 w-12 h-12 rounded-full bg-indigo-600/80 hover:bg-indigo-500 border border-indigo-400/30 flex flex-col items-center justify-center text-white transition-all hover:scale-110 shadow-lg"
                title="Invitar">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
                <span className="text-[7px] font-bold mt-0.5">Invitar</span>
              </button>
              {/* Abajo: Wave */}
              <button onClick={(e) => { e.stopPropagation(); avatarInteractions.onWave?.(userId); setShowRadialWheel(false); }}
                className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-12 rounded-full bg-amber-500/80 hover:bg-amber-400 border border-amber-400/30 flex flex-col items-center justify-center text-white transition-all hover:scale-110 shadow-lg"
                title="Saludar">
                <span className="text-lg">👋</span>
                <span className="text-[7px] font-bold -mt-0.5">Hola</span>
              </button>
              {/* Izquierda: Nudge */}
              <button onClick={(e) => { e.stopPropagation(); avatarInteractions.onNudge?.(userId); setShowRadialWheel(false); }}
                className="absolute top-1/2 left-0 -translate-y-1/2 w-12 h-12 rounded-full bg-pink-500/80 hover:bg-pink-400 border border-pink-400/30 flex flex-col items-center justify-center text-white transition-all hover:scale-110 shadow-lg"
                title="Ring">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                <span className="text-[7px] font-bold mt-0.5">Ring</span>
              </button>
            </div>
          </div>
        </Html>
      )}
    </group>
  );
};

// --- RemoteAvatarInterpolated ---
// ============== AVATAR REMOTO CON INTERPOLACIÓN ==============
export const RemoteAvatarInterpolated: React.FC<{
  user: User;
  remoteStream: MediaStream | null;
  showVideoBubble?: boolean;
  message?: string;
  reaction?: string | null;
  realtimePositionsRef?: React.MutableRefObject<Map<string, any>>;
  interpolacionWorkerRef?: React.MutableRefObject<Worker | null>;
  posicionesInterpoladasRef?: React.MutableRefObject<Map<string, { x: number; z: number; direction?: DireccionAvatar; isMoving?: boolean }>>;
  ecsStateRef?: React.MutableRefObject<EstadoEcsEspacio>;
  lodLevel?: AvatarLodLevel;
  frustumRef?: React.MutableRefObject<THREE.Frustum>;
  onClickRemoteAvatar?: (userId: string) => void;
  avatarInteractions?: AvatarProps['avatarInteractions'];
}> = ({ user, remoteStream, showVideoBubble, message, reaction, realtimePositionsRef, interpolacionWorkerRef, posicionesInterpoladasRef, ecsStateRef, lodLevel, frustumRef, onClickRemoteAvatar, avatarInteractions }) => {
  const groupRef = useRef<THREE.Group>(null);
  const initialPos = useMemo(() => {
    const ecsData = ecsStateRef?.current ? obtenerEstadoUsuarioEcs(ecsStateRef.current, user.id) : null;
    if (ecsData && Date.now() - (ecsData.timestamp ?? 0) <= 2000) {
      return { x: ecsData.x, z: ecsData.z };
    }
    return { x: user.x / 16, z: user.y / 16 };
  }, [ecsStateRef, user.id, user.x, user.y]);
  const targetPos = useRef({ ...initialPos });
  const currentPos = useRef({ ...initialPos });
  const [isMoving, setIsMoving] = useState(false);
  const [remoteAnimState, setRemoteAnimState] = useState<string>('idle');
  const [remoteTeleport, setRemoteTeleport] = useState<{ phase: 'out' | 'in'; origin: [number, number, number]; dest: [number, number, number] } | null>(null);
  const [isVisible, setIsVisible] = useState(true);
  const lastVisibleRef = useRef(true);
  const tempVec = useMemo(() => new THREE.Vector3(), []);
  const lastDirectionRef = useRef<DireccionAvatar>(user.direction as DireccionAvatar);
  const lastMovingRef = useRef(false);
  const lastTargetRef = useRef<{ x: number; z: number } | null>(null);
  
  // Estado local para dirección, movimiento y animación (viene del broadcast)
  const remoteStateRef = useRef<{ direction: DireccionAvatar; isMoving: boolean; animState: string; renderedAnim: string }>({ 
    direction: user.direction as DireccionAvatar, 
    isMoving: false, 
    animState: 'idle',
    renderedAnim: 'idle'
  });

  // Actualizar posición destino cuando cambia user.x/y (Presence - Fallback lento)
  useEffect(() => {
    // Solo actualizar si NO tenemos datos realtime recientes (para evitar conflicto)
    const hasRealtime = realtimePositionsRef?.current?.has(user.id);
    const realtimeData = hasRealtime ? realtimePositionsRef!.current.get(user.id) : null;
    const isRecent = realtimeData && (Date.now() - realtimeData.timestamp < 2000); // 2s timeout
    const ecsData = ecsStateRef?.current ? obtenerEstadoUsuarioEcs(ecsStateRef.current, user.id) : null;
    const ecsFresh = ecsData && Date.now() - (ecsData.timestamp ?? 0) <= 2000;

    if (!isRecent && !ecsFresh) {
      const newX = user.x / 16;
      const newZ = user.y / 16;
      updateTargetPosition(newX, newZ);
    }
  }, [ecsStateRef, user.x, user.y, user.id]);

  const enviarEstadoWorker = (payload: { x: number; z: number; direction?: string; isMoving?: boolean; teleport?: boolean }) => {
    if (!interpolacionWorkerRef?.current) return;
    interpolacionWorkerRef.current.postMessage({
      type: 'upsert',
      payload: {
        id: user.id,
        x: payload.x,
        z: payload.z,
        direction: payload.direction,
        isMoving: payload.isMoving,
        teleport: payload.teleport,
      }
    });
  };

  useEffect(() => {
    enviarEstadoWorker({ x: currentPos.current.x, z: currentPos.current.z, direction: user.direction, isMoving: false });
    return () => {
      if (!interpolacionWorkerRef?.current) return;
      interpolacionWorkerRef.current.postMessage({ type: 'remove', payload: { id: user.id } });
    };
  }, [user.id]);

  const updateTargetPosition = (newX: number, newZ: number, direction?: string, remoteMoving?: boolean) => {
    const dx = newX - currentPos.current.x;
    const dz = newZ - currentPos.current.z;
    const jumpDist = Math.sqrt(dx * dx + dz * dz);

    if (jumpDist > TELEPORT_DISTANCE * 0.8) {
      // Salto grande detectado → teleport visual
      const origin: [number, number, number] = [currentPos.current.x, 0, currentPos.current.z];
      const dest: [number, number, number] = [newX, 0, newZ];

      setRemoteTeleport({ phase: 'out', origin, dest });
      playTeleportSound();
      enviarEstadoWorker({ x: newX, z: newZ, direction, isMoving: remoteMoving, teleport: true });

      setTimeout(() => {
        currentPos.current = { x: newX, z: newZ };
        targetPos.current = { x: newX, z: newZ };
        if (groupRef.current) {
          groupRef.current.position.x = newX;
          groupRef.current.position.z = newZ;
        }
        setRemoteTeleport(prev => prev ? { ...prev, phase: 'in' } : null);

        setTimeout(() => setRemoteTeleport(null), 400);
      }, 300);
    } else {
      targetPos.current = { x: newX, z: newZ };
      enviarEstadoWorker({ x: newX, z: newZ, direction, isMoving: remoteMoving });
    }
  };

  // Interpolar suavemente hacia la posición destino
  useFrame((state, delta) => {
    let usoRealtime = false;
    let ecsData: ReturnType<typeof obtenerEstadoUsuarioEcs> | null = null;
    // 1. Verificar datos realtime (Broadcast - Rápido)
    if (realtimePositionsRef && realtimePositionsRef.current.has(user.id)) {
      const data = realtimePositionsRef.current.get(user.id);
      // Usar datos si son frescos (< 1500ms) - Aumentado para soportar heartbeat de 400ms + jitter
      if (Date.now() - data.timestamp < 1500) {
        const rX = data.x / 16;
        const rZ = data.y / 16;
        const directionChanged = data.direction !== lastDirectionRef.current;
        const movingChanged = data.isMoving !== lastMovingRef.current;
        const shouldUpdateTarget = Math.abs(rX - targetPos.current.x) > 0.01 || Math.abs(rZ - targetPos.current.z) > 0.01;

        if (shouldUpdateTarget || directionChanged || movingChanged) {
          updateTargetPosition(rX, rZ, data.direction, data.isMoving);
          lastDirectionRef.current = data.direction;
          lastMovingRef.current = data.isMoving;
          lastTargetRef.current = { x: rX, z: rZ };
        }

        remoteStateRef.current.direction = data.direction;
        remoteStateRef.current.isMoving = data.isMoving;
        const newAnim = data.animState || (data.isMoving ? 'walk' : 'idle');
        remoteStateRef.current.animState = newAnim;
        
        // Bug 4 Fix: Usar ref para chequear el último anim renderizado y evitar stale closures
        if (newAnim !== remoteStateRef.current.renderedAnim) {
          remoteStateRef.current.renderedAnim = newAnim;
          setRemoteAnimState(newAnim);
        }
        usoRealtime = true;
      }
    }

    if (!usoRealtime && ecsStateRef?.current) {
      ecsData = obtenerEstadoUsuarioEcs(ecsStateRef.current, user.id);
      if (ecsData) {
        const ecsAge = Date.now() - (ecsData.timestamp ?? 0);
        if (ecsAge <= 2000) {
          const directionChanged = ecsData.direction !== lastDirectionRef.current;
          const movingChanged = ecsData.isMoving !== lastMovingRef.current;
          const shouldUpdateTarget =
            !lastTargetRef.current ||
            Math.abs(ecsData.x - lastTargetRef.current.x) > 0.01 ||
            Math.abs(ecsData.z - lastTargetRef.current.z) > 0.01;
          if (shouldUpdateTarget || directionChanged || movingChanged) {
            updateTargetPosition(ecsData.x, ecsData.z, ecsData.direction, ecsData.isMoving);
            lastDirectionRef.current = ecsData.direction as DireccionAvatar;
            lastMovingRef.current = ecsData.isMoving;
            lastTargetRef.current = { x: ecsData.x, z: ecsData.z };
          }
          remoteStateRef.current.direction = ecsData.direction as DireccionAvatar;
          remoteStateRef.current.isMoving = ecsData.isMoving;
          // ECS no tiene animState, inferir de isMoving
          const ecsAnim = ecsData.isMoving ? 'walk' : 'idle';
          remoteStateRef.current.animState = ecsAnim;
          
          if (ecsAnim !== remoteStateRef.current.renderedAnim) {
            remoteStateRef.current.renderedAnim = ecsAnim;
            setRemoteAnimState(ecsAnim);
          }
        }
      }
    }

    if (!groupRef.current || remoteTeleport) return;

    const workerData = posicionesInterpoladasRef?.current?.get(user.id);
    if (workerData) {
      currentPos.current.x = workerData.x;
      currentPos.current.z = workerData.z;
      groupRef.current.position.x = workerData.x;
      groupRef.current.position.z = workerData.z;

      if (workerData.direction) {
        remoteStateRef.current.direction = workerData.direction;
      }
      const nuevoEstadoMov = !!workerData.isMoving;
      if (isMoving !== nuevoEstadoMov) setIsMoving(nuevoEstadoMov);
    } else if (ecsData && Date.now() - (ecsData.timestamp ?? 0) <= 2000) {
      currentPos.current.x = ecsData.x;
      currentPos.current.z = ecsData.z;
      groupRef.current.position.x = ecsData.x;
      groupRef.current.position.z = ecsData.z;
      remoteStateRef.current.direction = ecsData.direction as DireccionAvatar;
      const nuevoEstadoMov = !!ecsData.isMoving;
      if (isMoving !== nuevoEstadoMov) setIsMoving(nuevoEstadoMov);
    }

    if (frustumRef?.current && groupRef.current) {
      groupRef.current.getWorldPosition(tempVec);
      const visible = frustumRef.current.containsPoint(tempVec);
      if (visible !== lastVisibleRef.current) {
        lastVisibleRef.current = visible;
        setIsVisible(visible);
      }
    }
  });

  const isHiddenByTeleport = remoteTeleport?.phase === 'out';
  const hasVideoStream = remoteStream && remoteStream.getVideoTracks().length > 0;
  const shouldShowCamera = user.isCameraOn || (hasVideoStream && !user.esFantasma); // Fallback: si hay stream, mostrar aunque isCameraOn tenga lag

  return (
    <>
      <group ref={groupRef} position={[currentPos.current.x, 0, currentPos.current.z]} visible={isVisible}>
        {!isHiddenByTeleport && (
          user.esFantasma ? (
            <GhostAvatar
              position={[0, 0, 0]}
              escala={0.95}
              opacidad={0.3}
              mostrarEtiqueta={true}
              etiqueta="Hay alguien aquí"
            />
          ) : (
            <Avatar
              position={new THREE.Vector3(0, 0, 0)}
              config={user.avatarConfig}
              name={user.name}
              status={user.status}
              isCurrentUser={false}
              animationState={(remoteAnimState || (isMoving ? 'walk' : 'idle')) as AnimationState}
              direction={remoteStateRef.current.direction || user.direction}
              reaction={reaction}
              videoStream={remoteStream}
              camOn={shouldShowCamera}
              showVideoBubble={showVideoBubble}
              message={message}
              lodLevel={isVisible ? lodLevel : 'low'}
              esFantasma={!!user.esFantasma}
              remoteAvatar3DConfig={user.avatar3DConfig}
              onClickRemoteAvatar={onClickRemoteAvatar}
              avatarInteractions={avatarInteractions ? { ...avatarInteractions, profilePhoto: user.profilePhoto || null } : undefined}
              userId={user.id}
            />
          )
        )}
      </group>
      {isVisible && remoteTeleport?.phase === 'out' && (
        <TeleportEffect position={remoteTeleport.origin} phase="out" />
      )}
      {isVisible && remoteTeleport?.phase === 'in' && (
        <TeleportEffect position={remoteTeleport.dest} phase="in" />
      )}
    </>
  );
};

// --- RemoteUsers ---
// ============== COMPONENTE USUARIOS REMOTOS ==============
export interface RemoteUsersProps {
  users: User[];
  remoteStreams: Map<string, MediaStream>;
  showVideoBubble?: boolean;
  usersInCallIds?: Set<string>;
  usersInAudioRangeIds?: Set<string>;
  remoteMessages: Map<string, string>;
  remoteReaction: { emoji: string; from: string; fromName: string } | null;
  realtimePositionsRef?: React.MutableRefObject<Map<string, any>>;
  interpolacionWorkerRef?: React.MutableRefObject<Worker | null>;
  posicionesInterpoladasRef?: React.MutableRefObject<Map<string, { x: number; z: number; direction?: DireccionAvatar; isMoving?: boolean }>>;
  ecsStateRef?: React.MutableRefObject<EstadoEcsEspacio>;
  frustumRef?: React.MutableRefObject<THREE.Frustum>;
  onClickRemoteAvatar?: (userId: string) => void;
  avatarInteractions?: AvatarProps['avatarInteractions'];
}

export const RemoteUsers: React.FC<RemoteUsersProps> = ({ users, remoteStreams, showVideoBubble, usersInCallIds, usersInAudioRangeIds, remoteMessages, remoteReaction, realtimePositionsRef, interpolacionWorkerRef, posicionesInterpoladasRef, ecsStateRef, frustumRef, onClickRemoteAvatar, avatarInteractions }) => {
  const { currentUser } = useStore();

  const obtenerPosicionEcs = useCallback((usuario: User) => {
    const ecsData = ecsStateRef?.current ? obtenerEstadoUsuarioEcs(ecsStateRef.current, usuario.id) : null;
    if (ecsData && Date.now() - (ecsData.timestamp ?? 0) <= 2000) {
      return { x: ecsData.x, z: ecsData.z };
    }
    return { x: usuario.x / 16, z: usuario.y / 16 };
  }, [ecsStateRef]);

  const calcularLod = useCallback((usuario: User): AvatarLodLevel => {
    const usuarioPos = obtenerPosicionEcs(usuario);
    const currentPos = obtenerPosicionEcs(currentUser);
    const dx = usuarioPos.x - currentPos.x;
    const dz = usuarioPos.z - currentPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < LOD_NEAR_DISTANCE) return 'high';
    if (dist < LOD_MID_DISTANCE) return 'mid';
    return 'low';
  }, [currentUser, obtenerPosicionEcs]);

  return (
    <>
      {users.filter(u => u.id !== currentUser.id).map(u => (
        <RemoteAvatarInterpolated
          key={u.id}
          user={u}
          remoteStream={remoteStreams.get(u.id) || null}
          showVideoBubble={showVideoBubble && !usersInCallIds?.has(u.id) && !!usersInAudioRangeIds?.has(u.id)}
          message={remoteMessages.get(u.id)}
          reaction={remoteReaction?.from === u.id ? remoteReaction.emoji : null}
          realtimePositionsRef={realtimePositionsRef}
          interpolacionWorkerRef={interpolacionWorkerRef}
          posicionesInterpoladasRef={posicionesInterpoladasRef}
          ecsStateRef={ecsStateRef}
          lodLevel={calcularLod(u)}
          frustumRef={frustumRef}
          onClickRemoteAvatar={onClickRemoteAvatar}
          avatarInteractions={avatarInteractions}
        />
      ))}
    </>
  );
};

// --- CameraFollow ---
// ============== CAMERA FOLLOW (CameraControls API) ==============
// Usa CameraControls de drei (basado en camera-controls de yomotsu).
// setTarget + setPosition con enableTransition=false preserva el ángulo/zoom del usuario
// mientras desplaza cámara y target por el delta de movimiento del jugador.
export const CameraFollow: React.FC<{ controlsRef: React.MutableRefObject<any> }> = ({ controlsRef }) => {
  const { camera } = useThree();
  const lastPlayerPos = useRef<{ x: number; z: number } | null>(null);
  const initialized = useRef(false);
  const targetVec = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const playerPos = (camera as any).userData?.playerPosition;
    const controls = controlsRef.current;
    if (!playerPos || !controls) return;

    // Primera vez: posicionar cámara detrás y arriba del jugador
    if (!initialized.current) {
      controls.setLookAt(
        playerPos.x, 15, playerPos.z + 15,  // posición cámara
        playerPos.x, 0, playerPos.z,         // target (jugador)
        false                                 // sin transición
      );
      lastPlayerPos.current = { x: playerPos.x, z: playerPos.z };
      initialized.current = true;
      return;
    }

    if (!lastPlayerPos.current) {
      lastPlayerPos.current = { x: playerPos.x, z: playerPos.z };
      return;
    }

    const deltaX = playerPos.x - lastPlayerPos.current.x;
    const deltaZ = playerPos.z - lastPlayerPos.current.z;
    const moved = Math.abs(deltaX) > 0.001 || Math.abs(deltaZ) > 0.001;

    if (moved) {
      // Obtener target actual y calcular offset cámara→target
      controls.getTarget(targetVec);
      // Mover target y cámara por el mismo delta (preserva rotación/zoom del usuario)
      controls.setTarget(targetVec.x + deltaX, targetVec.y, targetVec.z + deltaZ, false);
      controls.setPosition(camera.position.x + deltaX, camera.position.y, camera.position.z + deltaZ, false);
      lastPlayerPos.current = { x: playerPos.x, z: playerPos.z };
    }
  });

  return null;
};

// --- AvatarScreenProjector ---
// ============== BRIDGE: Proyectar posición 3D → screen coords para card screen-space ==============
export const AvatarScreenProjector: React.FC<{
  selectedUserId: string | null;
  ecsStateRef: React.MutableRefObject<EstadoEcsEspacio>;
  screenPosRef: React.MutableRefObject<{ x: number; y: number } | null>;
  onlineUsers: User[];
}> = ({ selectedUserId, ecsStateRef, screenPosRef, onlineUsers }) => {
  const { camera, gl } = useThree();
  const vec3 = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    if (!selectedUserId) { screenPosRef.current = null; return; }
    const ecsData = obtenerEstadoUsuarioEcs(ecsStateRef.current, selectedUserId);
    let wx: number, wz: number;
    if (ecsData && Date.now() - (ecsData.timestamp ?? 0) <= 3000) {
      wx = ecsData.x; wz = ecsData.z;
    } else {
      const u = onlineUsers.find(u => u.id === selectedUserId);
      if (!u) { screenPosRef.current = null; return; }
      wx = u.x / 16; wz = u.y / 16;
    }
    vec3.set(wx, 3.5, wz);
    vec3.project(camera);
    const canvas = gl.domElement;
    const x = (vec3.x * 0.5 + 0.5) * canvas.clientWidth;
    const y = (-vec3.y * 0.5 + 0.5) * canvas.clientHeight;
    screenPosRef.current = { x, y };
  });

  return null;
};

// --- TeleportEffect ---
// ============== EFECTO VISUAL TELETRANSPORTACIÓN ==============
export const TeleportEffect: React.FC<{ position: [number, number, number]; phase: 'out' | 'in' }> = ({ position, phase }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const startTime = useRef(Date.now());

  useFrame(() => {
    if (!meshRef.current || !materialRef.current) return;
    const elapsed = (Date.now() - startTime.current) / 1000;
    const duration = 0.35;
    const t = Math.min(elapsed / duration, 1);

    if (phase === 'out') {
      // Anillo que se expande y desvanece
      meshRef.current.scale.setScalar(1 + t * 3);
      materialRef.current.opacity = 0.8 * (1 - t);
    } else {
      // Anillo que se contrae y aparece
      meshRef.current.scale.setScalar(4 - t * 3);
      materialRef.current.opacity = 0.8 * t * (1 - t * 0.5);
    }
  });

  return (
    <group position={position}>
      <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]}>
        <ringGeometry args={[0.5, 1.2, 32]} />
        <meshBasicMaterial ref={materialRef} color="#818cf8" transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>
      <pointLight color="#818cf8" intensity={phase === 'out' ? 5 : 8} distance={6} />
    </group>
  );
};

