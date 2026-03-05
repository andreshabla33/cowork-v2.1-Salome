'use client';
/**
 * @module components/space3d/InternalComponents
 * Subcomponentes internos extraídos de VirtualSpace3D.tsx
 * Minimap, StableVideo, Avatar, RemoteAvatarInterpolated, RemoteUsers,
 * CameraFollow, AvatarScreenProjector, TeleportEffect, Player, Scene,
 * AdaptiveFrameloop, VideoHUD, ScreenSpaceProfileCard
 */

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

// --- Minimap Component (tap-to-teleport) ---
export const Minimap: React.FC<{ currentUser: User; users: User[]; workspace: any; onTeleport?: (x: number, z: number) => void }> = ({ currentUser, users, workspace, onTeleport }) => {
  if (!workspace) return null;
  const size = 140;
  const mapWidth = workspace.width || 2000;
  const mapHeight = workspace.height || 2000;
  const scaleX = size / mapWidth;
  const scaleY = size / mapHeight;

  const handleMinimapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onTeleport) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    // Convertir coordenadas del minimap a coordenadas del mundo (px)
    const worldX = (clickX / size) * mapWidth;
    const worldY = (clickY / size) * mapHeight;
    // Convertir a coordenadas 3D (mundo 3D usa /16)
    onTeleport(worldX / 16, worldY / 16);
  };

  return (
    <div
      className="absolute bottom-6 left-6 w-[140px] h-[140px] bg-black/60 backdrop-blur-xl rounded-2xl border border-white/10 overflow-hidden shadow-2xl z-20 cursor-pointer hover:border-indigo-500/40 transition-colors hidden md:block"
      onClick={handleMinimapClick}
      title="Clic para teletransportarte"
    >
      <div className="absolute inset-0 opacity-10 pointer-events-none">
        <div className="w-full h-full" style={{ backgroundImage: 'radial-gradient(circle, #6366f1 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
      </div>
      <div className="relative w-full h-full pointer-events-none">
        <div 
          className="absolute w-2.5 h-2.5 bg-indigo-500 rounded-full shadow-[0_0_10px_rgba(99,102,241,1)] z-10"
          style={{ 
            left: `${currentUser.x * scaleX}px`, 
            top: `${currentUser.y * scaleY}px`,
            transform: 'translate(-50%, -50%)'
          }}
        />
        {users.map(u => (
          <div 
            key={u.id}
            className="absolute w-1.5 h-1.5 bg-white/50 rounded-full"
            style={{ 
              left: `${u.x * scaleX}px`, 
              top: `${u.y * scaleY}px`,
              transform: 'translate(-50%, -50%)'
            }}
          />
        ))}
      </div>
    </div>
  );
};

// Colores por tema

// Colores de estado
export const statusColors: Record<PresenceStatus, string> = {
  [PresenceStatus.AVAILABLE]: '#22c55e',
  [PresenceStatus.BUSY]: '#ef4444',
  [PresenceStatus.AWAY]: '#eab308',
  [PresenceStatus.DND]: '#a855f7',
};

// ============== COMPONENTE VIDEO ESTABLE ==============
export interface StableVideoProps {
  stream: MediaStream | null;
  muted?: boolean;
  muteAudio?: boolean; // Silenciar solo audio (para modo DND/Away/Busy)
  className?: string;
}

export const StableVideo: React.FC<StableVideoProps> = ({ stream, muted = false, muteAudio = false, className = '' }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamIdRef = useRef<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const newStreamId = stream?.id || null;
    
    // Solo actualizar si el stream realmente cambió
    if (streamIdRef.current !== newStreamId) {
      streamIdRef.current = newStreamId;
      
      if (stream) {
        video.srcObject = stream;
        video.play().catch(() => {});
      } else {
        video.srcObject = null;
      }
    }
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={muted || muteAudio}
      className={className}
    />
  );
};

// ============== AVATAR 3D GLTF (vista 2.5D isométrica) ==============
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
        <Html position={[0, camOn ? 5.8 : 3.2, 0]} center distanceFactor={10} zIndexRange={[100, 0]}>
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
        <Html position={[0, 3.5, 0]} center distanceFactor={12} zIndexRange={[100, 0]}>
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
        <Html position={[0, camOn ? 4.5 : 2.8, 0]} center distanceFactor={8} zIndexRange={[200, 0]}>
          <div className="animate-emoji-float text-5xl drop-shadow-[0_4px_12px_rgba(0,0,0,0.4)]">
            {reaction}
          </div>
        </Html>
      )}
      
      {/* Nombre flotante con indicador de estado - Clickeable para ver estado */}
      {!allowVideo && allowName && (
        <Html position={[0, 2.4, 0]} center distanceFactor={10} zIndexRange={[100, 0]} sprite>
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
        <Html position={[0, camOn ? 5.0 : 2.8, 0]} center distanceFactor={6} zIndexRange={[310, 0]}>
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

export interface PlayerProps {
  currentUser: User;
  setPosition: (x: number, y: number, direction: string, isSitting: boolean, isMoving: boolean) => void;
  stream: MediaStream | null;
  showVideoBubble?: boolean;
  message?: string | null;
  reactions?: Array<{ id: string; emoji: string }>;
  onClickAvatar?: () => void;
  moveTarget?: { x: number; z: number } | null;
  onReachTarget?: () => void;
  teleportTarget?: { x: number; z: number } | null;
  onTeleportDone?: () => void;
  broadcastMovement?: (x: number, y: number, direction: string, isMoving: boolean, animState?: string, reliable?: boolean) => void;
  moveSpeed?: number;
  runSpeed?: number;
  ecsStateRef?: React.MutableRefObject<EstadoEcsEspacio>;
  onPositionUpdate?: (x: number, z: number) => void;
  zonasEmpresa?: ZonaEmpresa[];
  empresasAutorizadas?: string[];
  usersInCallIds?: Set<string>;
  mobileInputRef?: React.MutableRefObject<JoystickInput>;
  onXPEvent?: (accion: string, cooldownMs?: number) => void;
}

export const Player: React.FC<PlayerProps> = ({ currentUser, setPosition, stream, showVideoBubble = true, message, reactions = [], onClickAvatar, moveTarget, onReachTarget, teleportTarget, onTeleportDone, broadcastMovement, moveSpeed, runSpeed, ecsStateRef, onPositionUpdate, zonasEmpresa = [], empresasAutorizadas = [], usersInCallIds, mobileInputRef, onXPEvent }) => {
  const groupRef = useRef<THREE.Group>(null);
  // Refs para acceso seguro dentro de useFrame
  const zonasRef = useRef(zonasEmpresa);
  const empresasAuthRef = useRef(empresasAutorizadas);

  // Sincronizar refs
  useEffect(() => { zonasRef.current = zonasEmpresa; }, [zonasEmpresa]);
  useEffect(() => { empresasAuthRef.current = empresasAutorizadas; }, [empresasAutorizadas]);

  const initialPosition = useMemo(() => {
    // 1. Persistencia ECS (prioridad si es reciente - < 2s)
    const ecsData = ecsStateRef?.current ? obtenerEstadoUsuarioEcs(ecsStateRef.current, currentUser.id) : null;
    if (ecsData && Date.now() - (ecsData.timestamp ?? 0) <= 2000) {
      return { x: ecsData.x, z: ecsData.z };
    }

    // 2. Spawn Point de Empresa (Gemelo Digital)
    if (currentUser.empresa_id && zonasEmpresa.length > 0) {
      // Buscar zona activa de mi empresa
      const miZona = zonasEmpresa.find(z => z.empresa_id === currentUser.empresa_id && z.estado === 'activa');
      // Si tiene spawn definido (y no es 0,0 que es el default si no se ha configurado)
      if (miZona && (Number(miZona.spawn_x) !== 0 || Number(miZona.spawn_y) !== 0)) {
        return { 
          x: Number(miZona.spawn_x) / 16, 
          z: Number(miZona.spawn_y) / 16 
        };
      }
    }

    // 3. Posición guardada o Default
    return { x: (currentUser.x || 400) / 16, z: (currentUser.y || 400) / 16 };
  }, [currentUser.id, currentUser.x, currentUser.y, currentUser.empresa_id, ecsStateRef, zonasEmpresa]);
  const initialDirection = useMemo(() => {
    const ecsData = ecsStateRef?.current ? obtenerEstadoUsuarioEcs(ecsStateRef.current, currentUser.id) : null;
    if (ecsData && Date.now() - (ecsData.timestamp ?? 0) <= 2000) {
      return ecsData.direction ?? 'front';
    }
    return currentUser.direction ?? 'front';
  }, [currentUser.direction, currentUser.id, ecsStateRef]);
  const positionRef = useRef({ ...initialPosition });
  const [animationState, setAnimationState] = useState<AnimationState>('idle');
  const animationStateRef = useRef<AnimationState>('idle');
  
  // === SISTEMA DE ANIMACIONES CONTEXTUALES ===
  const [contextualAnim, setContextualAnim] = useState<AnimationState | null>(null);
  const contextualTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousUsersInCallRef = useRef<Set<string>>(new Set());
  const wavedToUsersRef = useRef<Set<string>>(new Set());

  // Auto-wave: detectar nuevos usuarios que entran en proximidad
  useEffect(() => {
    if (!usersInCallIds || usersInCallIds.size === 0) {
      previousUsersInCallRef.current = new Set();
      return;
    }
    const prev = previousUsersInCallRef.current;
    const newEntries: string[] = [];
    usersInCallIds.forEach(id => {
      if (!prev.has(id) && !wavedToUsersRef.current.has(id)) {
        newEntries.push(id);
        wavedToUsersRef.current.add(id);
      }
    });
    previousUsersInCallRef.current = new Set(usersInCallIds);

    // Si hay nuevos usuarios y no estamos en movimiento → wave
    if (newEntries.length > 0 && animationStateRef.current !== 'walk' && animationStateRef.current !== 'run') {
      setContextualAnim('wave');
      // XP por saludo automático (throttle 30s)
      onXPEvent?.('saludo_wave', 30000);
      if (contextualTimerRef.current) clearTimeout(contextualTimerRef.current);
      contextualTimerRef.current = setTimeout(() => {
        setContextualAnim(null);
      }, 3000);
    }
    return () => {
      if (contextualTimerRef.current) clearTimeout(contextualTimerRef.current);
    };
  }, [usersInCallIds]);

  // Fase 2: Sit contextual — sentarse automáticamente al estar idle cerca de una silla
  const sitCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (sitCheckRef.current) clearInterval(sitCheckRef.current);
    sitCheckRef.current = setInterval(() => {
      if (animationStateRef.current !== 'idle' || contextualAnim) return;
      const px = positionRef.current?.x;
      const pz = positionRef.current?.z;
      if (px == null || pz == null) return;
      for (const [cx, cz] of CHAIR_POSITIONS_3D) {
        const dx = px - cx, dz = pz - cz;
        if (Math.sqrt(dx * dx + dz * dz) < CHAIR_SIT_RADIUS) {
          setContextualAnim('sit');
          return;
        }
      }
      // Si estaba sentado contextualmente y se alejó de la silla, cancelar
    }, 1000);
    return () => { if (sitCheckRef.current) clearInterval(sitCheckRef.current); };
  }, [contextualAnim]);

  // Fase 3: Reacciones desde chat — detectar emojis en mensajes y disparar animación
  const prevMessageRef = useRef<string | undefined>();
  useEffect(() => {
    if (!message || message === prevMessageRef.current) return;
    prevMessageRef.current = message;
    const EMOJI_ANIM_MAP: [RegExp, AnimationState][] = [
      [/👋|🤚|✋/, 'wave'],
      [/🎉|🥳|🎊/, 'cheer'],
      [/💃|🕺|🪩/, 'dance'],
      [/🏆|🥇|✌️/, 'victory'],
      [/🦘|⬆️|🚀/, 'jump'],
    ];
    for (const [pattern, anim] of EMOJI_ANIM_MAP) {
      if (pattern.test(message)) {
        setContextualAnim(anim);
        if (contextualTimerRef.current) clearTimeout(contextualTimerRef.current);
        contextualTimerRef.current = setTimeout(() => setContextualAnim(null), 3000);
        break;
      }
    }
  }, [message]);

  // Cancelar animación contextual si el usuario se mueve
  useEffect(() => {
    if ((animationState === 'walk' || animationState === 'run') && contextualAnim) {
      setContextualAnim(null);
      if (contextualTimerRef.current) clearTimeout(contextualTimerRef.current);
    }
  }, [animationState, contextualAnim]);

  // Estado efectivo: contextual > keyboard
  const effectiveAnimState = contextualAnim || animationState;
  
  // Sincronizar ref con state
  useEffect(() => {
    animationStateRef.current = effectiveAnimState;
  }, [effectiveAnimState]);

  const [direction, setDirection] = useState<string>(initialDirection);
  const [isRunning, setIsRunning] = useState(false);
  const keysPressed = useRef<Set<string>>(new Set());
  const lastSyncTime = useRef(0);
  const lastBroadcastTime = useRef(0);
  const autoMoveTimeRef = useRef(0);
  const lastBroadcastRef = useRef<{ x: number; y: number; direction: string; isMoving: boolean; animState?: string } | null>(null);
  const { camera } = useThree();

  // Vectores reutilizables para movimiento relativo a cámara (evita GC)
  const camForwardVec = useMemo(() => new THREE.Vector3(), []);
  const camRightVec = useMemo(() => new THREE.Vector3(), []);
  const upVec = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  // Teletransportación
  const [teleportPhase, setTeleportPhase] = useState<'none' | 'out' | 'in'>('none');
  const [teleportOrigin, setTeleportOrigin] = useState<[number, number, number] | null>(null);
  const [teleportDest, setTeleportDest] = useState<[number, number, number] | null>(null);
  const teleportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Manejar teleport cuando llega un teleportTarget
  useEffect(() => {
    if (!teleportTarget) return;

    const originPos: [number, number, number] = [positionRef.current.x, 0, positionRef.current.z];
    const destPos: [number, number, number] = [teleportTarget.x, 0, teleportTarget.z];

    // Fase 1: Desaparición
    setTeleportOrigin(originPos);
    setTeleportDest(destPos);
    setTeleportPhase('out');
    playTeleportSound();

    // Fase 2: Mover al destino después de 300ms
    teleportTimerRef.current = setTimeout(() => {
      positionRef.current.x = teleportTarget.x;
      positionRef.current.z = teleportTarget.z;
      if (groupRef.current) {
        groupRef.current.position.x = teleportTarget.x;
        groupRef.current.position.z = teleportTarget.z;
      }
      // Sincronizar posición inmediatamente
      setPosition(teleportTarget.x * 16, teleportTarget.z * 16, 'front', false, false);
      (camera as any).userData.playerPosition = { x: teleportTarget.x, z: teleportTarget.z };

      setTeleportPhase('in');

      // Fase 3: Limpiar efecto
      setTimeout(() => {
        setTeleportPhase('none');
        setTeleportOrigin(null);
        setTeleportDest(null);
        if (onTeleportDone) onTeleportDone();
        // XP por teleport (throttle 5s)
        onXPEvent?.('teleport', 5000);
      }, 400);
    }, 300);

    return () => {
      if (teleportTimerRef.current) clearTimeout(teleportTimerRef.current);
    };
  }, [teleportTarget]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || (activeEl as HTMLElement).isContentEditable);
      if (isTyping) return;

      keysPressed.current.add(e.code);

      // Shift para correr
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        setIsRunning(true);
      }

      // Teclas de acción especiales (dance/cheer manuales, sit es contextual)
      if (e.code === 'KeyE') setAnimationState('cheer');
      if (e.code === 'KeyQ') setAnimationState('dance');

      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressed.current.delete(e.code);

      // Soltar shift
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        setIsRunning(false);
      }

      // Volver a idle cuando se sueltan teclas de acción
      if (['KeyE', 'KeyQ'].includes(e.code)) {
        setAnimationState('idle');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useFrame((state, delta) => {
    let dx = 0, dy = 0;
    let newDirection = direction;

    // Velocidad según si corre o camina
    const baseMoveSpeed = moveSpeed ?? MOVE_SPEED;
    const baseRunSpeed = runSpeed ?? RUN_SPEED;
    const speed = isRunning ? baseRunSpeed : baseMoveSpeed;

    // Movimiento por teclado
    const keyW = keysPressed.current.has('KeyW') || keysPressed.current.has('ArrowUp');
    const keyS = keysPressed.current.has('KeyS') || keysPressed.current.has('ArrowDown');
    const keyA = keysPressed.current.has('KeyA') || keysPressed.current.has('ArrowLeft');
    const keyD = keysPressed.current.has('KeyD') || keysPressed.current.has('ArrowRight');
    const hasKeyboardInput = keyW || keyS || keyA || keyD;

    // Movimiento por joystick mobile (solo si no hay input de teclado)
    const joystick = mobileInputRef?.current;
    const hasJoystickInput = !hasKeyboardInput && joystick && joystick.active && joystick.magnitude > 0;

    // Función auxiliar para verificar colisión con zonas prohibidas
    const isPositionValid = (x: number, z: number) => {
      const zonas = zonasRef.current;
      const auth = empresasAuthRef.current;
      const myEmpresa = currentUser.empresa_id;

      for (const zona of zonas) {
        if (zona.estado !== 'activa') continue;
        if (zona.es_comun) continue;
        if (myEmpresa && zona.empresa_id === myEmpresa) continue;
        if (zona.empresa_id && auth.includes(zona.empresa_id)) continue;

        // Verificar bounding box
        const zX = Number(zona.posicion_x) / 16;
        const zZ = Number(zona.posicion_y) / 16;
        const halfW = (Number(zona.ancho) / 16) / 2;
        const halfH = (Number(zona.alto) / 16) / 2;

        // Padding pequeño para evitar entrar justo al borde
        const padding = 0.2; 
        
        if (x > zX - halfW - padding && x < zX + halfW + padding && 
            z > zZ - halfH - padding && z < zZ + halfH + padding) {
          return false; // Posición prohibida
        }
      }
      return true;
    };

    // ── Vectores de cámara proyectados en XZ (para movimiento relativo a la vista) ──
    camera.getWorldDirection(camForwardVec);
    camForwardVec.y = 0;
    camForwardVec.normalize();
    camRightVec.crossVectors(camForwardVec, upVec).normalize();

    if (hasKeyboardInput) {
      // Teclado cancela cualquier movimiento por doble clic
      if (moveTarget && onReachTarget) { autoMoveTimeRef.current = 0; onReachTarget(); }

      // Movimiento relativo a la cámara: W=adelante, S=atrás, A=izquierda, D=derecha
      // según la perspectiva actual de la vista 3D
      let moveX = 0, moveZ = 0;
      if (keyW) { moveX += camForwardVec.x; moveZ += camForwardVec.z; }
      if (keyS) { moveX -= camForwardVec.x; moveZ -= camForwardVec.z; }
      if (keyA) { moveX -= camRightVec.x; moveZ -= camRightVec.z; }
      if (keyD) { moveX += camRightVec.x; moveZ += camRightVec.z; }

      // Normalizar + aplicar velocidad
      const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
      if (len > 0) {
        dx = (moveX / len) * speed * delta;
        dy = (moveZ / len) * speed * delta;
      }

      // Determinar dirección visual del avatar desde el vector de movimiento en mundo
      if (len > 0) {
        const absWorldX = Math.abs(moveX);
        const absWorldZ = Math.abs(moveZ);
        const ratio = Math.min(absWorldX, absWorldZ) / Math.max(absWorldX, absWorldZ || 0.001);
        const isDiag = ratio > 0.4;

        if (isDiag) {
          const fb = moveZ < 0 ? 'up' : 'front';
          const lr = moveX > 0 ? 'right' : 'left';
          newDirection = `${fb}-${lr}`;
        } else if (absWorldX > absWorldZ) {
          newDirection = moveX > 0 ? 'right' : 'left';
        } else {
          newDirection = moveZ < 0 ? 'up' : 'front';
        }
      }
    } else if (hasJoystickInput && joystick) {
      // Joystick mobile cancela moveTarget igual que teclado
      if (moveTarget && onReachTarget) { autoMoveTimeRef.current = 0; onReachTarget(); }

      // Joystick relativo a cámara: dz=forward/back, dx=left/right en la vista actual
      const joySpeed = joystick.isRunning ? baseRunSpeed : (baseMoveSpeed * joystick.magnitude);
      let moveX = camForwardVec.x * joystick.dz + camRightVec.x * joystick.dx;
      let moveZ = camForwardVec.z * joystick.dz + camRightVec.z * joystick.dx;
      const joyLen = Math.sqrt(moveX * moveX + moveZ * moveZ);
      if (joyLen > 0) {
        dx = (moveX / joyLen) * joySpeed * delta;
        dy = (moveZ / joyLen) * joySpeed * delta;
      }

      // Dirección visual del avatar desde movimiento en mundo
      if (joyLen > 0) {
        const absJx = Math.abs(moveX);
        const absJz = Math.abs(moveZ);
        const joyRatio = Math.min(absJx, absJz) / Math.max(absJx, absJz || 0.001);
        const joyDiag = joyRatio > 0.4;

        if (joyDiag) {
          const fb = moveZ < 0 ? 'up' : 'front';
          const lr = moveX > 0 ? 'right' : 'left';
          newDirection = `${fb}-${lr}`;
        } else if (absJx > absJz) {
          newDirection = moveX > 0 ? 'right' : 'left';
        } else {
          newDirection = moveZ < 0 ? 'up' : 'front';
        }
      }
    } else if (moveTarget) {
      // Movimiento automático hacia el destino (doble clic estilo Gather)
      const tx = moveTarget.x;
      const tz = moveTarget.z;
      const cx = positionRef.current.x;
      const cz = positionRef.current.z;
      const distX = tx - cx;
      const distZ = tz - cz;
      const dist = Math.sqrt(distX * distX + distZ * distZ);

      if (dist < 0.15) {
        // Llegó al destino
        autoMoveTimeRef.current = 0;
        if (onReachTarget) onReachTarget();
      } else {
        // Transición walk -> run
        autoMoveTimeRef.current += delta;
        const isAutoRunning = autoMoveTimeRef.current > 0.4;
        const autoSpeed = isAutoRunning ? baseRunSpeed : baseMoveSpeed;
        const step = Math.min(autoSpeed * delta, dist);

        // Aplicar movimiento directamente en X/Z
        positionRef.current.x = Math.max(0, Math.min(WORLD_SIZE, cx + (distX / dist) * step));
        positionRef.current.z = Math.max(0, Math.min(WORLD_SIZE, cz + (distZ / dist) * step));

        // Determinar dirección visual del avatar
        const absX = Math.abs(distX);
        const absZ = Math.abs(distZ);
        const ratio = Math.min(absX, absZ) / Math.max(absX, absZ);
        const isDiagonal = ratio > 0.4;

        if (isDiagonal) {
          const fb = distZ > 0 ? 'front' : 'up';
          const lr = distX > 0 ? 'right' : 'left';
          newDirection = `${fb}-${lr}`;
        } else if (absX > absZ) {
          newDirection = distX > 0 ? 'right' : 'left';
        } else {
          newDirection = distZ > 0 ? 'front' : 'up';
        }

        // Animación: walk al inicio, run después (movimiento SIEMPRE cancela wave/contextual)
        if (animationState !== 'cheer' && animationState !== 'dance' && animationState !== 'sit') {
          if (contextualAnim) { setContextualAnim(null); if (contextualTimerRef.current) clearTimeout(contextualTimerRef.current); }
          setAnimationState(isAutoRunning ? 'run' : 'walk');
        }
      }
    }

    // Movimiento por teclado o joystick (ambos producen dx/dy)
    const movingByDirectInput = dx !== 0 || dy !== 0;

    if (movingByDirectInput) {
      // Calcular nueva posición propuesta (dx/dy ya son deltas en coordenadas mundo)
      const nextX = Math.max(0, Math.min(WORLD_SIZE, positionRef.current.x + dx));
      const nextZ = Math.max(0, Math.min(WORLD_SIZE, positionRef.current.z + dy));

      // Verificar colisión con zonas prohibidas
      // Intentar mover en ambos ejes
      if (isPositionValid(nextX, nextZ)) {
        positionRef.current.x = nextX;
        positionRef.current.z = nextZ;
      } else {
        // Si falla, intentar deslizamiento (solo X)
        if (isPositionValid(nextX, positionRef.current.z)) {
          positionRef.current.x = nextX;
        } 
        // O solo Z
        else if (isPositionValid(positionRef.current.x, nextZ)) {
          positionRef.current.z = nextZ;
        }
        // Si ambos fallan, se bloquea (pared)
      }

      // Actualizar animación según movimiento (movimiento SIEMPRE cancela wave/contextual)
      if (animationState !== 'cheer' && animationState !== 'dance' && animationState !== 'sit') {
        if (contextualAnim) { setContextualAnim(null); if (contextualTimerRef.current) clearTimeout(contextualTimerRef.current); }
        const shouldRun = hasKeyboardInput ? isRunning : (hasJoystickInput && joystick?.isRunning);
        setAnimationState(shouldRun ? 'run' : 'walk');
      }
    }

    // Detectar si hay movimiento (teclado, joystick o automático)
    const moving = movingByDirectInput || (moveTarget !== null && moveTarget !== undefined);

    if (!moving && (animationState === 'walk' || animationState === 'run')) {
      setAnimationState('idle');
    }

    if (newDirection !== direction) setDirection(newDirection);

    // Mover el grupo del avatar
    if (groupRef.current) {
      groupRef.current.position.x = positionRef.current.x;
      groupRef.current.position.z = positionRef.current.z;
    }

    // Actualizar posición para CameraFollow
    (camera as any).userData.playerPosition = { x: positionRef.current.x, z: positionRef.current.z };

    if (onPositionUpdate) {
      onPositionUpdate(positionRef.current.x, positionRef.current.z);
    }

        // Sincronizar posición con el store
    const now = state.clock.getElapsedTime();
    if (now - lastSyncTime.current > 0.1) {
      setPosition(
        positionRef.current.x * 16,
        positionRef.current.z * 16,
        newDirection,
        effectiveAnimState === 'sit',
        moving
      );
      lastSyncTime.current = now;
    }

    if (broadcastMovement) {
      // Usar ref para garantizar estado fresco en el loop
      const currentAnim = animationStateRef.current;
      
      // Optimización: Solo enviar si hay cambios significativos
      const payload = {
        x: Number((positionRef.current.x * 16).toFixed(1)),
        y: Number((positionRef.current.z * 16).toFixed(1)),
        direction: newDirection,
        isMoving: moving,
        animState: currentAnim,
      };
      
      const last = lastBroadcastRef.current;
      const now = Date.now();
      
      // Detectar cambios reales
      const changed =
        !last ||
        Math.abs(last.x - payload.x) > 0.5 ||
        Math.abs(last.y - payload.y) > 0.5 ||
        last.direction !== payload.direction ||
        last.isMoving !== payload.isMoving ||
        last.animState !== payload.animState;

      const animChanged = !last || last.animState !== currentAnim;
      // Si la animación cambió, enviar con fiabilidad (reliable) para evitar que se pierda el paquete de inicio
      const isReliable = animChanged;

      // Heartbeat para animaciones especiales (dance, cheer, etc.)
      // Si estamos en una animación especial y no nos movemos, necesitamos reenviar 
      // el estado periódicamente para que el otro cliente no haga timeout (y vuelva a idle)
      const isSpecialAnim = !['idle', 'walk', 'run'].includes(currentAnim);
      // Reducido a 200ms para mayor fluidez y evitar timeouts por jitter
      const shouldHeartbeat = isSpecialAnim && (now - lastBroadcastTime.current > 200);

      if (changed || shouldHeartbeat) {
        broadcastMovement(payload.x, payload.y, payload.direction, payload.isMoving, payload.animState, isReliable);
        lastBroadcastRef.current = payload;
        lastBroadcastTime.current = now;
      }
    }
  });

  return (
    <>
      <group ref={groupRef} position={[positionRef.current.x, 0, positionRef.current.z]}>
        {/* Ocultar avatar durante fase 'out' del teleport */}
        {teleportPhase !== 'out' && (
          <Avatar
            position={new THREE.Vector3(0, 0, 0)}
            config={currentUser.avatarConfig}
            name={currentUser.name}
            status={currentUser.status}
            isCurrentUser={true}
            animationState={effectiveAnimState}
            direction={direction}
            reaction={reactions.length > 0 ? reactions[reactions.length - 1].emoji : null}
            videoStream={stream}
            camOn={currentUser.isCameraOn}
            showVideoBubble={showVideoBubble}
            message={message}
            onClickAvatar={onClickAvatar}
          />
        )}
        {/* Múltiples emojis flotantes estilo Gather */}
        {reactions.map((r, idx) => (
          <Html key={r.id} position={[0.3 * (idx % 3 - 1), 3.2 + (idx * 0.3), 0]} center distanceFactor={8} zIndexRange={[200, 0]}>
            <div className="animate-emoji-float text-4xl drop-shadow-[0_4px_12px_rgba(0,0,0,0.4)]">
              {r.emoji}
            </div>
          </Html>
        ))}
      </group>

      {/* Efectos de teletransportación */}
      {teleportPhase === 'out' && teleportOrigin && (
        <TeleportEffect position={teleportOrigin} phase="out" />
      )}
      {teleportPhase === 'in' && teleportDest && (
        <TeleportEffect position={teleportDest} phase="in" />
      )}
    </>
  );
};

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

// ============== ADAPTIVE FRAMELOOP ==============
export const AdaptiveFrameloop: React.FC = () => {
  const { invalidate } = useThree();
  const lastActivityRef = useRef(Date.now());
  const IDLE_TIMEOUT = 3000;
  const MIN_FPS_INTERVAL = 1000 / 30; // 30fps mínimo para animaciones fluidas

  useEffect(() => {
    const mark = () => { lastActivityRef.current = Date.now(); invalidate(); };
    window.addEventListener('keydown', mark, { passive: true });
    window.addEventListener('pointerdown', mark, { passive: true });
    window.addEventListener('pointermove', mark, { passive: true });
    window.addEventListener('wheel', mark, { passive: true });
    return () => {
      window.removeEventListener('keydown', mark);
      window.removeEventListener('pointerdown', mark);
      window.removeEventListener('pointermove', mark);
      window.removeEventListener('wheel', mark);
    };
  }, [invalidate]);

  // Render loop mínimo a 30fps para que animaciones idle (respirar, mirar) sean fluidas
  useEffect(() => {
    let animId: number;
    let lastTime = 0;
    const tick = (time: number) => {
      if (time - lastTime >= MIN_FPS_INTERVAL) {
        invalidate();
        lastTime = time;
      }
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [invalidate]);

  // Durante actividad del usuario → full fps (60fps) por 3 segundos
  useFrame(() => {
    if (Date.now() - lastActivityRef.current < IDLE_TIMEOUT) invalidate();
  });

  return null;
};

// ============== VIDEO HUD COMPONENT ==============
export interface VideoHUDProps {
  userName: string;
  userAvatar?: string;
  visitorId: string;
  camOn: boolean;
  sharingOn: boolean;
  isPrivate: boolean;
  usersInCall: User[];
  stream: MediaStream | null;
  screenStream: MediaStream | null;
  remoteStreams: Map<string, MediaStream>;
  remoteScreenStreams: Map<string, MediaStream>;
  remoteReaction: { emoji: string; from: string; fromName: string } | null;
  onWaveUser: (userId: string) => void;
  currentReaction: string | null;
  theme: string;
  speakingUsers: Set<string>;
  userDistances: Map<string, number>;
  muteRemoteAudio: boolean;
  cameraSettings: CameraSettings;
  onProcessedStreamReady?: (stream: MediaStream) => void;
}

export const VideoHUD: React.FC<VideoHUDProps> = ({
  userName,
  userAvatar,
  visitorId,
  camOn,
  sharingOn,
  isPrivate,
  usersInCall,
  stream,
  screenStream,
  remoteStreams,
  remoteScreenStreams,
  remoteReaction,
  onWaveUser,
  currentReaction,
  theme,
  speakingUsers,
  userDistances,
  muteRemoteAudio,
  cameraSettings,
  onProcessedStreamReady,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panPosition, setPanPosition] = useState({ x: 0, y: 0 });
  const [waveAnimation, setWaveAnimation] = useState<string | null>(null);
  const [useGridLayout, setUseGridLayout] = useState(false);
  const expandedVideoRef = useRef<HTMLVideoElement>(null);
  
  // Detectar si el usuario local está hablando
  const isSpeakingLocal = speakingUsers.has(visitorId);

  useEffect(() => {
    if (!expandedVideoRef.current || !expandedId) return;
    let targetStream: MediaStream | null = null;
    if (expandedId === 'local') targetStream = stream;
    else if (expandedId === 'screen') targetStream = screenStream;
    else targetStream = remoteStreams.get(expandedId) || null;
    
    if (targetStream && expandedVideoRef.current.srcObject !== targetStream) {
      expandedVideoRef.current.srcObject = targetStream;
      expandedVideoRef.current.play().catch(() => {});
    }
  }, [expandedId, stream, screenStream, remoteStreams]);

  return (
    <>
      {/* Overlay expandido con zoom - UI 2026 Glassmorphism */}
      {expandedId && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-xl z-[100] flex items-center justify-center" onClick={() => { setExpandedId(null); setZoomLevel(1); setPanPosition({ x: 0, y: 0 }); }}>
          <div className="relative w-[90vw] h-[90vh] max-w-6xl bg-gradient-to-br from-zinc-900/80 to-black/90 rounded-[32px] overflow-hidden border border-white/5 shadow-[0_32px_64px_-12px_rgba(0,0,0,0.8)]" onClick={e => e.stopPropagation()}>
            {/* Video container con zoom y pan */}
            <div 
              className="w-full h-full overflow-hidden cursor-grab active:cursor-grabbing"
              style={{ 
                transform: `scale(${zoomLevel}) translate(${panPosition.x}px, ${panPosition.y}px)`,
                transition: 'transform 0.2s ease-out'
              }}
            >
              {(expandedId === 'local' && stream) || (expandedId === 'screen' && screenStream) || (expandedId?.startsWith('screen-') && remoteScreenStreams.get(expandedId.replace('screen-', ''))) || (expandedId && remoteStreams.get(expandedId)) ? (
                <StableVideo 
                  stream={expandedId === 'local' ? stream : expandedId === 'screen' ? screenStream : expandedId?.startsWith('screen-') ? remoteScreenStreams.get(expandedId.replace('screen-', '')) || null : remoteStreams.get(expandedId) || null}
                  muted={expandedId === 'local'}
                  className={`w-full h-full object-contain ${expandedId === 'local' ? 'mirror' : ''}`}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="w-32 h-32 rounded-full bg-zinc-800 flex items-center justify-center text-6xl font-black text-white">
                    {expandedId === 'local' ? userName.charAt(0) : usersInCall.find(u => u.id === expandedId)?.name.charAt(0) || '?'}
                  </div>
                </div>
              )}
            </div>

            {/* Header glassmorphism */}
            <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
              <div className="bg-white/5 backdrop-blur-2xl px-4 py-2 rounded-2xl border border-white/10">
                <span className="text-sm font-medium text-white/90">
                  {expandedId === 'local' ? 'Tu cámara' : expandedId === 'screen' ? 'Tu pantalla' : expandedId?.startsWith('screen-') ? `${usersInCall.find(u => u.id === expandedId?.replace('screen-', ''))?.name || 'Usuario'} - Pantalla` : usersInCall.find(u => u.id === expandedId)?.name || 'Usuario'}
                </span>
              </div>
              <button 
                onClick={() => { setExpandedId(null); setZoomLevel(1); setPanPosition({ x: 0, y: 0 }); }} 
                className="w-10 h-10 rounded-2xl bg-white/5 backdrop-blur-2xl border border-white/10 flex items-center justify-center text-white/70 hover:bg-white/10 hover:text-white transition-all"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Controles de zoom flotantes - estilo minimalista 2026 */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-white/5 backdrop-blur-2xl px-2 py-2 rounded-2xl border border-white/10 shadow-lg">
              {/* Zoom out */}
              <button 
                onClick={() => setZoomLevel(z => Math.max(0.5, z - 0.25))}
                disabled={zoomLevel <= 0.5}
                className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-white transition-all"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" /></svg>
              </button>
              
              {/* Zoom indicator */}
              <div className="px-3 py-1.5 min-w-[60px] text-center">
                <span className="text-sm font-mono text-white/90">{Math.round(zoomLevel * 100)}%</span>
              </div>
              
              {/* Zoom in */}
              <button 
                onClick={() => setZoomLevel(z => Math.min(3, z + 0.25))}
                disabled={zoomLevel >= 3}
                className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-white transition-all"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              </button>

              {/* Divider */}
              <div className="w-px h-6 bg-white/10"></div>
              
              {/* Reset zoom */}
              <button 
                onClick={() => { setZoomLevel(1); setPanPosition({ x: 0, y: 0 }); }}
                className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-white transition-all"
                title="Restablecer zoom"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
              </button>

              {/* Fullscreen */}
              <button 
                onClick={() => setZoomLevel(z => z === 1 ? 1.5 : 1)}
                className="w-10 h-10 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 flex items-center justify-center text-indigo-400 transition-all"
                title="Ajustar pantalla"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" /></svg>
              </button>
            </div>

            {/* Reacción en pantalla expandida */}
            {currentReaction && (
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-6xl pointer-events-none animate-fade-in-out">
                {currentReaction}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Contenedor de burbujas - Posicionado arriba centrado */}
      <div className={`absolute left-1/2 top-24 -translate-x-1/2 pointer-events-auto z-50 transition-all duration-500 ${
        usersInCall.length === 0 && !camOn ? 'opacity-0 pointer-events-none scale-95' : 'opacity-100 scale-100'
      } ${
        useGridLayout 
          ? 'grid grid-cols-2 gap-3 max-w-[600px]' 
          : 'flex flex-row flex-wrap justify-center gap-4 max-w-[800px]'
      }`}>
        {/* Indicador de privacidad */}
        {isPrivate && (
          <div className={`bg-amber-500 text-black px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 ${useGridLayout ? 'col-span-2' : ''}`}>
            <IconPrivacy on={true} /> Conversación privada
          </div>
        )}

        {/* Burbuja local (tu cámara) */}
        <div className={`relative bg-black rounded-[28px] overflow-hidden shadow-2xl group transition-all duration-300 ${
          useGridLayout ? 'w-[200px] h-[130px]' : 'w-52 h-36'
        } ${isSpeakingLocal ? 'border-2 border-green-500 ring-2 ring-green-500/30' : 'border border-white/10'}`}>
          {/* Indicador de speaking */}
          {isSpeakingLocal && (
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 flex gap-0.5 z-30">
              <div className="w-1 h-3 bg-green-500 rounded-full animate-sound-wave-1"></div>
              <div className="w-1 h-4 bg-green-500 rounded-full animate-sound-wave-2"></div>
              <div className="w-1 h-2 bg-green-500 rounded-full animate-sound-wave-3"></div>
              <div className="w-1 h-4 bg-green-500 rounded-full animate-sound-wave-2"></div>
              <div className="w-1 h-3 bg-green-500 rounded-full animate-sound-wave-1"></div>
            </div>
          )}
          {/* Reacción actual */}
          {currentReaction && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-2xl z-20 pointer-events-none animate-fade-in-out">
              {currentReaction}
            </div>
          )}
          <div className={`relative w-full h-full overflow-hidden flex items-center justify-center transition-opacity ${!camOn ? 'opacity-0' : 'opacity-100'} ${cameraSettings.mirrorVideo ? 'mirror' : ''}`}>
            {cameraSettings.backgroundEffect !== 'none' ? (
              <VideoWithBackground
                stream={stream}
                effectType={cameraSettings.backgroundEffect}
                backgroundImage={cameraSettings.backgroundImage}
                blurAmount={12}
                muted={true}
                className="w-full h-full object-cover block"
                onProcessedStreamReady={onProcessedStreamReady}
                mirrorVideo={cameraSettings.mirrorVideo}
              />
            ) : (
              <StableVideo stream={stream} muted={true} className="w-full h-full object-cover block" />
            )}
          </div>
          {!camOn && (
            <div className="absolute inset-0 bg-zinc-900 flex items-center justify-center">
              <div className="w-14 h-14 rounded-full border border-indigo-500/30 flex items-center justify-center text-indigo-400 font-black text-2xl bg-black/50 overflow-hidden">
                {userAvatar ? (
                  <img src={userAvatar} alt={userName} className="w-full h-full object-cover" />
                ) : (
                  userName.charAt(0)
                )}
              </div>
            </div>
          )}
          
          {/* Control de expandir */}
          <div className="absolute bottom-3 right-3 flex justify-end items-center gap-1 transition-all duration-300 opacity-0 group-hover:opacity-100">
            <button onClick={() => setExpandedId('local')} className="w-7 h-7 rounded-full flex items-center justify-center bg-indigo-600 backdrop-blur-md border border-white/10 text-white hover:bg-indigo-500 transition-all shadow-lg">
              <IconExpand on={false}/>
            </button>
          </div>
          
          {/* Nombre */}
          <div className="absolute top-3 left-3 bg-black/80 backdrop-blur-md px-2 py-1 rounded-lg border border-white/10">
            <span className="text-[10px] font-bold uppercase tracking-wide text-white">Tú</span>
          </div>

          {/* Indicador de hide self view */}
          {cameraSettings.hideSelfView && camOn && (
            <div className="absolute inset-0 bg-zinc-900/90 flex items-center justify-center rounded-[28px]">
              <div className="text-center">
                <svg className="w-8 h-8 text-white/40 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
                <span className="text-[10px] text-white/40">Vista oculta</span>
              </div>
            </div>
          )}
        </div>

        {/* Burbuja de screen share (separada) */}
        {sharingOn && screenStream && (
          <div className="relative bg-black rounded-[28px] overflow-hidden border border-indigo-500/50 shadow-2xl group w-52 h-36">
            <StableVideo stream={screenStream} className="w-full h-full object-cover" />
            <div className="absolute top-3 left-3 bg-indigo-600 backdrop-blur-md px-2 py-1 rounded-lg">
              <span className="text-[10px] font-bold uppercase tracking-wide text-white">Tu pantalla</span>
            </div>
            <button onClick={() => setExpandedId('screen')} className="absolute bottom-3 right-3 w-8 h-8 rounded-full flex items-center justify-center bg-indigo-600 text-white opacity-0 group-hover:opacity-100 transition-all">
              <IconExpand on={false}/>
            </button>
          </div>
        )}

        {/* Burbujas de usuarios cercanos */}
        {usersInCall.map((u) => {
          const remoteStream = remoteStreams.get(u.id);
          const remoteScreen = remoteScreenStreams.get(u.id);
          const isSpeaking = speakingUsers.has(u.id);
          const distance = userDistances.get(u.id) || 100;
          const isWaving = waveAnimation === u.id;
          
          // Si el usuario está compartiendo pantalla, no mostrar su cámara aquí (se muestra como PiP junto a la pantalla)
          const isScreenSharing = remoteScreen && remoteScreen.getVideoTracks().length > 0;
          if (isScreenSharing) return null;
          
          const hasRemoteStream = remoteStream && remoteStream.getVideoTracks().length > 0;
          const shouldShowRemoteCam = u.isCameraOn || hasRemoteStream;

          return (
            <div key={u.id} className={`relative bg-zinc-900 rounded-[28px] overflow-hidden shadow-2xl group transition-all duration-300 ${
              useGridLayout ? 'w-[200px] h-[130px]' : 'w-52 h-36'
            } ${isSpeaking ? 'border-2 border-green-500 ring-2 ring-green-500/30 scale-105' : 'border border-white/10'}`}>
              {/* Indicador de speaking remoto */}
              {isSpeaking && (
                <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 flex gap-0.5 z-30">
                  <div className="w-1 h-3 bg-green-500 rounded-full animate-sound-wave-1"></div>
                  <div className="w-1 h-4 bg-green-500 rounded-full animate-sound-wave-2"></div>
                  <div className="w-1 h-2 bg-green-500 rounded-full animate-sound-wave-3"></div>
                  <div className="w-1 h-4 bg-green-500 rounded-full animate-sound-wave-2"></div>
                  <div className="w-1 h-3 bg-green-500 rounded-full animate-sound-wave-1"></div>
                </div>
              )}
              {/* Wave animation overlay */}
              {isWaving && (
                <div className="absolute inset-0 bg-indigo-500/20 flex items-center justify-center z-20 animate-pulse">
                  <span className="text-4xl animate-bounce">👋</span>
                </div>
              )}
              {/* Prioridad: 1) Cámara OFF = foto, 2) Cámara ON + stream = video, 3) Cámara ON sin stream = conectando */}
              {!shouldShowRemoteCam ? (
                /* Usuario tiene cámara apagada - mostrar foto de perfil o inicial */
                <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
                  <div className="w-14 h-14 rounded-full border border-indigo-500/30 flex items-center justify-center bg-black/50 overflow-hidden">
                    {u.avatar ? (
                      <img src={u.avatar} alt={u.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-indigo-400 font-black text-2xl">{u.name.charAt(0)}</span>
                    )}
                  </div>
                </div>
              ) : hasRemoteStream ? (
                /* Usuario tiene cámara ON y hay stream disponible */
                <StableVideo 
                  stream={remoteStream} 
                  className="absolute inset-0 w-full h-full object-cover" 
                  muteAudio={muteRemoteAudio}
                />
              ) : (
                /* Usuario tiene cámara ON pero stream no disponible aún */
                <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
                  <div className="flex flex-col items-center">
                    <div className="w-12 h-12 rounded-full bg-indigo-500/20 flex items-center justify-center mb-1 animate-pulse">
                      <svg className="w-6 h-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <span className="text-[10px] text-white/50">Conectando...</span>
                  </div>
                </div>
              )}
              {/* Reacción remota recibida */}
              {remoteReaction && remoteReaction.from === u.id && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-3xl z-20 pointer-events-none animate-fade-in-out">
                  {remoteReaction.emoji}
                </div>
              )}
              {/* Header con nombre y estado */}
              <div className="absolute top-3 left-3 right-3 flex items-center justify-between">
                <div className="flex items-center gap-2 bg-black/80 backdrop-blur-md px-2 py-1 rounded-lg border border-white/10">
                  <div className={`w-2 h-2 rounded-full ${u.isMicOn ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                  <span className="text-[10px] font-bold uppercase tracking-wide text-white truncate max-w-[80px]">{u.name}</span>
                </div>
                {/* Indicador de distancia (audio espacial) */}
                <div className="bg-black/60 backdrop-blur-md px-1.5 py-0.5 rounded text-[9px] text-white/70">
                  {distance < 50 ? '🔊' : distance < 100 ? '🔉' : '🔈'}
                </div>
              </div>
              {/* Controles en hover */}
              <div className="absolute bottom-3 left-3 right-3 flex justify-between items-center opacity-0 group-hover:opacity-100 transition-all">
                {/* Botón Wave */}
                <button 
                  onClick={() => {
                    onWaveUser(u.id);
                    setWaveAnimation(u.id);
                    setTimeout(() => setWaveAnimation(null), 2000);
                  }} 
                  className="w-8 h-8 rounded-full flex items-center justify-center bg-amber-500 text-white hover:bg-amber-400 transition-all"
                  title={`Saludar a ${u.name}`}
                >
                  👋
                </button>
                <button onClick={() => setExpandedId(u.id)} className="w-8 h-8 rounded-full flex items-center justify-center bg-indigo-600 text-white hover:bg-indigo-500 transition-all">
                  <IconExpand on={false}/>
                </button>
              </div>
            </div>
          );
        })}

        {/* Burbujas de screen share de otros usuarios */}
        {usersInCall.map((u) => {
          const remoteScreen = remoteScreenStreams.get(u.id);
          const remoteStream = remoteStreams.get(u.id);
          const hasActiveScreen = remoteScreen && remoteScreen.getVideoTracks().length > 0;
          const hasActiveCamera = remoteStream && remoteStream.getVideoTracks().some(t => t.enabled && t.readyState === 'live');
          
          // Solo mostrar si hay un stream de pantalla con video tracks activos
          if (!hasActiveScreen) return null;
          
          return (
            <React.Fragment key={`screen-group-${u.id}`}>
              {/* Burbuja de pantalla compartida */}
              <div className="relative bg-black rounded-[28px] overflow-hidden border border-green-500/30 shadow-2xl group w-80 h-48">
                <StableVideo stream={remoteScreen} className="w-full h-full object-contain" />
                {/* Label minimalista y transparente */}
                <div className="absolute top-2 left-2 bg-black/30 backdrop-blur-sm px-1.5 py-0.5 rounded-md opacity-60 group-hover:opacity-100 transition-opacity">
                  <span className="text-[8px] font-medium text-white/80 truncate max-w-[80px] block">{u.name.split(' ')[0]}</span>
                </div>
                {/* Icono de pantalla pequeño */}
                <div className="absolute top-2 right-2 w-5 h-5 rounded-md bg-green-500/20 backdrop-blur-sm flex items-center justify-center opacity-60">
                  <svg className="w-3 h-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                </div>
                <button onClick={() => setExpandedId(`screen-${u.id}`)} className="absolute bottom-2 right-2 w-7 h-7 rounded-lg flex items-center justify-center bg-white/10 backdrop-blur-sm text-white/70 opacity-0 group-hover:opacity-100 hover:bg-white/20 transition-all">
                  <IconExpand on={false}/>
                </button>
              </div>
              
              {/* Burbuja de cámara pequeña (PiP) cuando también comparte pantalla */}
              {hasActiveCamera && (
                <div className="relative bg-black rounded-2xl overflow-hidden border border-indigo-500/40 shadow-xl group w-28 h-20">
                  <StableVideo 
                    stream={remoteStream} 
                    className="w-full h-full object-cover" 
                    muteAudio={muteRemoteAudio}
                  />
                  {/* Nombre pequeño */}
                  <div className="absolute bottom-1 left-1 bg-black/60 backdrop-blur-sm px-1 py-0.5 rounded">
                    <span className="text-[7px] font-medium text-white/80">{u.name.split(' ')[0]}</span>
                  </div>
                  {/* Icono de cámara */}
                  <div className="absolute top-1 right-1 w-4 h-4 rounded bg-indigo-500/30 backdrop-blur-sm flex items-center justify-center">
                    <svg className="w-2.5 h-2.5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  </div>
                  <button onClick={() => setExpandedId(u.id)} className="absolute inset-0 w-full h-full opacity-0 group-hover:opacity-100 bg-black/20 flex items-center justify-center transition-all">
                    <IconExpand on={false}/>
                  </button>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </>
  );
};

// ============== COMPONENTE PRINCIPAL ==============
export interface VirtualSpace3DProps {
  theme?: string;
  isGameHubOpen?: boolean;
  isPlayingGame?: boolean;
  showroomMode?: boolean;
  showroomDuracionMin?: number;
  showroomNombreVisitante?: string;
}

// ICE Servers para WebRTC - Servidores STUN/TURN actualizados
const ICE_SERVERS = [
  // STUN servers (gratuitos, solo para descubrir IP pública)
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  // TURN servers de Metered (gratuitos con límite)
  { 
    urls: 'turn:a.relay.metered.ca:80', 
    username: 'e8dd65c92c8d8d9e5c5f5c8a', 
    credential: 'kxLzJPjQ5+Oy5G6/' 
  },
  { 
    urls: 'turn:a.relay.metered.ca:80?transport=tcp', 
    username: 'e8dd65c92c8d8d9e5c5f5c8a', 
    credential: 'kxLzJPjQ5+Oy5G6/' 
  },
  { 
    urls: 'turn:a.relay.metered.ca:443', 
    username: 'e8dd65c92c8d8d9e5c5f5c8a', 
    credential: 'kxLzJPjQ5+Oy5G6/' 
  },
  { 
    urls: 'turns:a.relay.metered.ca:443?transport=tcp', 
    username: 'e8dd65c92c8d8d9e5c5f5c8a', 
    credential: 'kxLzJPjQ5+Oy5G6/' 
  },
];

// ============== PROFILE CARD — posición fija top-left (estilo panel config) ==============
export const ScreenSpaceProfileCard: React.FC<{
  user: User;
  screenPosRef: React.MutableRefObject<{ x: number; y: number } | null>;
  onClose: () => void;
  onWave: (id: string) => void;
  onInvite: (id: string) => void;
  onFollow: (id: string) => void;
  followTargetId: string | null;
}> = ({ user, screenPosRef, onClose, onWave, onInvite, onFollow, followTargetId }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const isFollowing = followTargetId === user.id;

  // Marcar como montado después del primer frame para evitar capturar el clic que abrió la card
  useEffect(() => {
    const raf = requestAnimationFrame(() => { mountedRef.current = true; });
    return () => { cancelAnimationFrame(raf); mountedRef.current = false; };
  }, []);

  // Cerrar con Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Cerrar al hacer clic fuera — usa capture phase para detectar clics en el canvas 3D
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!mountedRef.current) return;
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener('pointerdown', handleClickOutside, true);
    return () => window.removeEventListener('pointerdown', handleClickOutside, true);
  }, [onClose]);

  const dotClass = user.status === PresenceStatus.AVAILABLE ? 'bg-green-400' :
    user.status === PresenceStatus.BUSY ? 'bg-red-400' :
    user.status === PresenceStatus.AWAY ? 'bg-yellow-400' : 'bg-purple-400';
  const statusLabel = user.status === PresenceStatus.AVAILABLE ? 'Disponible' :
    user.status === PresenceStatus.BUSY ? 'Ocupado' :
    user.status === PresenceStatus.AWAY ? 'Ausente' : 'No molestar';
  const borderClass = user.status === PresenceStatus.AVAILABLE ? 'border-green-500/50' :
    user.status === PresenceStatus.BUSY ? 'border-red-500/50' :
    user.status === PresenceStatus.AWAY ? 'border-yellow-500/50' : 'border-purple-500/50';

  return (
    <div
      ref={cardRef}
      className="fixed z-[300] pointer-events-auto top-16 right-4 animate-slide-in"
    >
      <div className="backdrop-blur-xl rounded-2xl border shadow-2xl overflow-hidden bg-slate-950/80 border-slate-600/40">
        {/* Header con foto + nombre + estado */}
        <div className="flex items-center gap-2 px-3.5 py-2">
          <div className="relative flex-shrink-0">
            <div className={`w-8 h-8 rounded-full border-2 ${borderClass} flex items-center justify-center overflow-hidden bg-zinc-800`}>
              {user.profilePhoto ? (
                <img src={user.profilePhoto} alt={user.name} className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs font-bold text-white/80">{user.name.charAt(0).toUpperCase()}</span>
              )}
            </div>
            <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-slate-950 ${dotClass}`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-bold truncate">{user.name}</p>
            <p className="text-white/50 text-[9px]">{statusLabel}</p>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="w-5 h-5 rounded-md bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors flex-shrink-0"
          >
            <svg className="w-2.5 h-2.5 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        {/* Acciones — estilo idéntico al bubble de proximidad */}
        <div className="flex items-center gap-1.5 px-3 pb-2.5">
          <button
            onClick={(e) => { e.stopPropagation(); onWave(user.id); }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all bg-white/10 text-white/70 hover:bg-white/20 border border-white/10"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" /></svg>
            Saludar
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onInvite(user.id); }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all bg-white/10 text-white/70 hover:bg-white/20 border border-white/10"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
            Invitar
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onFollow(user.id); }}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
              isFollowing
                ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30'
                : 'bg-white/10 text-white/70 hover:bg-white/20 border border-white/10'
            }`}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
            {isFollowing ? 'Siguiendo' : 'Seguir'}
          </button>
        </div>
      </div>
    </div>
  );
};

