'use client';

import React, { useRef, useEffect, useMemo, Suspense, useState, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrthographicCamera, PerspectiveCamera, Grid, Text, OrbitControls, Html, PerformanceMonitor } from '@react-three/drei';
import { Physics, RigidBody, CuboidCollider } from '@react-three/rapier';
import * as THREE from 'three';
import { Room, RoomEvent, Track, VideoPresets, ScreenSharePresets, LocalAudioTrack, LocalVideoTrack, RemoteTrackPublication } from 'livekit-client';
import { useStore } from '@/store/useStore';
import { AutorizacionEmpresa, User, PresenceStatus, ZonaEmpresa } from '@/types';
import { supabase } from '@/lib/supabase';
import { GLTFAvatar, useAvatarControls, AnimationState } from './Avatar3DGLTF';
import { RecordingManager } from './meetings/recording/RecordingManager';
import { ConsentimientoPendiente } from './meetings/recording/ConsentimientoPendiente';
import { BottomControlBar } from './BottomControlBar';
import { ChatService } from '../services/chatService';
import { CameraSettingsMenu, loadCameraSettings, saveCameraSettings, type CameraSettings } from './CameraSettingsMenu';
import { VideoWithBackground } from './VideoWithBackground';
import { loadAudioSettings, saveAudioSettings, type AudioSettings } from './BottomControlBar';
import { AvatarCustomizer3D } from './AvatarCustomizer3D';
import { SpatialAudio } from './3d/SpatialAudio';
import { GhostAvatar } from './3d/GhostAvatar';
import { ZonaEmpresa as ZonaEmpresa3D } from './3d/ZonaEmpresa';
import { getUserSettings, getSettingsSection, sendDesktopNotification, requestDesktopNotificationPermission } from '../lib/userSettings';
import { obtenerChunk, obtenerChunksVecinos } from '../lib/chunkSystem';
import { filtrarUsuariosPorChunks, aplicarInteresEmpresa } from '../lib/interestManager';
import { crearSalaLivekitPorEspacio, obtenerTokenLivekitEspacio } from '../lib/livekitService';
import { cargarAutorizacionesActivas, cargarSolicitudesEnviadas, cargarZonasEmpresa, solicitarAccesoEmpresa } from '../lib/autorizacionesEmpresa';
import { RealtimeChunkManager, crearRealtimeChunkManager, type EventoRealtime } from '../lib/realtimeChunkManager';
import { actualizarEstadoUsuarioEcs, crearEstadoEcsEspacio, limpiarEstadoEcs, obtenerEstadoUsuarioEcs, sincronizarUsuariosEcs, type EstadoEcsEspacio } from '@/lib/ecs/espacioEcs';
import { detectGpuCapabilities, adaptiveConfigFromTier, type GpuInfo } from '@/lib/gpuCapabilities';
import { MobileJoystick, type JoystickInput } from './3d/MobileJoystick';
import { EmoteWheel } from './3d/EmoteWheel';
import { DayNightCycle } from './3d/DayNightCycle';
import { isTouchDevice, isMobileDevice, hapticFeedback } from '@/lib/mobileDetect';
import { GamificacionPanel } from './GamificacionPanel';
import { registrarLoginDiario, otorgarXP, XP_POR_ACCION } from '@/lib/gamificacion';
import { ObjetosInteractivos } from './3d/ObjetosInteractivos';
import { ParticulasClima } from './3d/ParticulasClima';
import { EmoteSync, useSyncEffects } from './3d/EmoteSync';
// GameHub ahora se importa en WorkspaceLayout

// Constantes (defaults, pueden ser sobreescritas por settings del usuario en VirtualSpace3D)
const MOVE_SPEED = 4;
const RUN_SPEED = 8;
const WORLD_SIZE = 100;
const PROXIMITY_RADIUS = 180; // 180px para detectar proximidad
const AUDIO_SPATIAL_RADIUS_FACTOR = 2; // Audio espacial se escucha hasta 2x el radio de proximidad
const TELEPORT_DISTANCE = 15; // Distancia 3D para activar teletransportación
const CHAIR_SIT_RADIUS = 1.5; // Radio en unidades 3D para activar sit contextual cerca de sillas
const CHAIR_POSITIONS_3D = [[8, 8], [12, 8], [8, 12], [12, 12], [8, 10], [12, 10]]; // [x, z] en world units
const ZONA_SOLICITUD_RADIO = 140; // Distancia en px para solicitar acceso a una zona privada
const LOD_NEAR_DISTANCE = 25;
const LOD_MID_DISTANCE = 60;
const MOVEMENT_BROADCAST_MS = 100;
const USAR_LIVEKIT = true;

type AvatarLodLevel = 'high' | 'mid' | 'low';
type DireccionAvatar = User['direction'] | 'up' | 'down' | 'front-left' | 'front-right' | 'up-left' | 'up-right';

// === AudioContext compartido (fix: navegador bloquea audio hasta primer gesto) ===
// Se crea una vez y se resume al primer clic/teclado del usuario
let _sharedAudioCtx: AudioContext | null = null;
let _audioResumed = false;
const getAudioCtx = (): AudioContext => {
  if (!_sharedAudioCtx || _sharedAudioCtx.state === 'closed') {
    _sharedAudioCtx = new AudioContext();
  }
  if (_sharedAudioCtx.state === 'suspended') {
    _sharedAudioCtx.resume();
  }
  return _sharedAudioCtx;
};
// Registrar listener global para desbloquear audio al primer gesto del usuario
if (typeof window !== 'undefined') {
  const resumeAudio = () => {
    if (_audioResumed) return;
    _audioResumed = true;
    if (_sharedAudioCtx && _sharedAudioCtx.state === 'suspended') {
      _sharedAudioCtx.resume();
    } else if (!_sharedAudioCtx) {
      _sharedAudioCtx = new AudioContext();
    }
    window.removeEventListener('click', resumeAudio, true);
    window.removeEventListener('keydown', resumeAudio, true);
    window.removeEventListener('touchstart', resumeAudio, true);
  };
  window.addEventListener('click', resumeAudio, true);
  window.addEventListener('keydown', resumeAudio, true);
  window.addEventListener('touchstart', resumeAudio, true);
}

// Sonido de teletransportación (estilo LOL - mágico/etéreo)
const playTeleportSound = () => {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    
    // Tono mágico ascendente (shimmer)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(400, now);
    osc1.frequency.exponentialRampToValueAtTime(1200, now + 0.25);
    gain1.gain.setValueAtTime(0.2, now);
    gain1.gain.linearRampToValueAtTime(0.3, now + 0.1);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
    osc1.connect(gain1).connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    // Armónico (octava superior para brillo mágico)
    const osc1b = ctx.createOscillator();
    const gain1b = ctx.createGain();
    osc1b.type = 'sine';
    osc1b.frequency.setValueAtTime(800, now);
    osc1b.frequency.exponentialRampToValueAtTime(2400, now + 0.25);
    gain1b.gain.setValueAtTime(0.08, now);
    gain1b.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc1b.connect(gain1b).connect(ctx.destination);
    osc1b.start(now);
    osc1b.stop(now + 0.3);

    // Whoosh suave (ruido filtrado)
    const bufferSize = ctx.sampleRate * 0.5;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.1;
    const noise = ctx.createBufferSource();
    const noiseGain = ctx.createGain();
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(2000, now);
    noiseFilter.Q.setValueAtTime(1.5, now);
    noise.buffer = noiseBuffer;
    noiseGain.gain.setValueAtTime(0.15, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
    noise.connect(noiseFilter).connect(noiseGain).connect(ctx.destination);
    noise.start(now + 0.05);

    // Tono descendente de llegada (resolución mágica)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(1500, now + 0.3);
    osc2.frequency.exponentialRampToValueAtTime(500, now + 0.55);
    gain2.gain.setValueAtTime(0.01, now + 0.3);
    gain2.gain.linearRampToValueAtTime(0.2, now + 0.35);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
    osc2.connect(gain2).connect(ctx.destination);
    osc2.start(now + 0.3);
    osc2.stop(now + 0.6);

    // Nota final de "aterrizaje" (impacto suave)
    const osc3 = ctx.createOscillator();
    const gain3 = ctx.createGain();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(250, now + 0.5);
    osc3.frequency.exponentialRampToValueAtTime(150, now + 0.7);
    gain3.gain.setValueAtTime(0.15, now + 0.5);
    gain3.gain.exponentialRampToValueAtTime(0.01, now + 0.75);
    osc3.connect(gain3).connect(ctx.destination);
    osc3.start(now + 0.5);
    osc3.stop(now + 0.75);

  } catch (e) { /* Audio no disponible */ }
};

// === Sonidos de notificación (tendencia 2026: soft, minimal, no-intrusivos) ===
// Inspirados en Slack (beep suave), Discord (pop), Tinder (tada celebratorio)

// Wave/saludo: soft double-pop (estilo Slack beep — cálido, amigable)
const playWaveSound = () => {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(740, now);
    osc1.frequency.exponentialRampToValueAtTime(680, now + 0.12);
    gain1.gain.setValueAtTime(0.15, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc1.connect(gain1).connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.15);
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.12);
    osc2.frequency.exponentialRampToValueAtTime(830, now + 0.27);
    gain2.gain.setValueAtTime(0, now);
    gain2.gain.linearRampToValueAtTime(0.12, now + 0.13);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc2.connect(gain2).connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.3);
  } catch (e) { /* Audio no disponible */ }
};

// Nudge/atención: gentle resonant ding (urgente pero no agresivo)
const playNudgeSound = () => {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1046, now);
    osc.frequency.exponentialRampToValueAtTime(988, now + 0.25);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(523, now);
    subGain.gain.setValueAtTime(0.06, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    sub.connect(subGain).connect(ctx.destination);
    sub.start(now);
    sub.stop(now + 0.2);
  } catch (e) { /* Audio no disponible */ }
};

// Invite/invitación: ascending soft chime (positivo, tipo Tinder "tada")
const playInviteSound = () => {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const notes = [
      { freq: 659, start: 0, dur: 0.18, vol: 0.1 },
      { freq: 784, start: 0.1, dur: 0.18, vol: 0.12 },
      { freq: 1047, start: 0.2, dur: 0.25, vol: 0.14 },
    ];
    notes.forEach(({ freq, start, dur, vol }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(vol, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur);
    });
  } catch (e) { /* Audio no disponible */ }
};

// --- Iconos ---

const IconPrivacy = ({ on }: { on: boolean }) => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    {on && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 11v4" />}
  </svg>
);

const IconExpand = ({ on }: { on: boolean }) => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    {on ? (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
    ) : (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
    )}
  </svg>
);

// --- Minimap Component (tap-to-teleport) ---
const Minimap: React.FC<{ currentUser: User; users: User[]; workspace: any; onTeleport?: (x: number, z: number) => void }> = ({ currentUser, users, workspace, onTeleport }) => {
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
const themeColors: Record<string, string> = {
  dark: '#0a0a0f',
  light: '#e8e8ec',
  space: '#020617',
  arcade: '#000000',
};

// Colores de estado
const statusColors: Record<PresenceStatus, string> = {
  [PresenceStatus.AVAILABLE]: '#22c55e',
  [PresenceStatus.BUSY]: '#ef4444',
  [PresenceStatus.AWAY]: '#eab308',
  [PresenceStatus.DND]: '#a855f7',
};

// ============== COMPONENTE VIDEO ESTABLE ==============
interface StableVideoProps {
  stream: MediaStream | null;
  muted?: boolean;
  muteAudio?: boolean; // Silenciar solo audio (para modo DND/Away/Busy)
  className?: string;
}

const StableVideo: React.FC<StableVideoProps> = ({ stream, muted = false, muteAudio = false, className = '' }) => {
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
interface AvatarProps {
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

const Avatar: React.FC<AvatarProps> = ({ position, config, name, status, isCurrentUser, animationState = 'idle', direction, reaction, videoStream, camOn, showVideoBubble = true, message, onClickAvatar, onClickRemoteAvatar, userId, mirrorVideo: mirrorVideoProp, hideSelfView: hideSelfViewProp, showName: showNameProp, lodLevel: lodLevelProp, esFantasma = false, remoteAvatar3DConfig, avatarInteractions }) => {
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
const RemoteAvatarInterpolated: React.FC<{
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
interface RemoteUsersProps {
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

const RemoteUsers: React.FC<RemoteUsersProps> = ({ users, remoteStreams, showVideoBubble, usersInCallIds, usersInAudioRangeIds, remoteMessages, remoteReaction, realtimePositionsRef, interpolacionWorkerRef, posicionesInterpoladasRef, ecsStateRef, frustumRef, onClickRemoteAvatar, avatarInteractions }) => {
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

const CameraFollow: React.FC<{ orbitControlsRef: React.MutableRefObject<any> }> = ({ orbitControlsRef }) => {
  const { camera } = useThree();
  const lastPlayerPos = useRef<{ x: number; z: number } | null>(null);
  const initialized = useRef(false);

  // NOTA: este componente debe montarse DESPUÉS de Player en el JSX para que su useFrame lea la posición actualizada del mismo frame
  useFrame(() => {
    const playerPos = (camera as any).userData?.playerPosition;
    if (!playerPos || !orbitControlsRef.current) return;

    const controls = orbitControlsRef.current;

    // Primera vez: centrar cámara en el jugador
    if (!initialized.current) {
      controls.target.set(playerPos.x, 0, playerPos.z);
      camera.position.set(playerPos.x, 15, playerPos.z + 15);
      lastPlayerPos.current = { x: playerPos.x, z: playerPos.z };
      initialized.current = true;
      return;
    }

    // Detectar si el jugador se movió
    if (!lastPlayerPos.current) {
      lastPlayerPos.current = { x: playerPos.x, z: playerPos.z };
      return;
    }

    const deltaX = playerPos.x - lastPlayerPos.current.x;
    const deltaZ = playerPos.z - lastPlayerPos.current.z;
    const moved = Math.abs(deltaX) > 0.001 || Math.abs(deltaZ) > 0.001;

    if (moved) {
      // Mover target y cámara juntos (mantiene la rotación actual)
      controls.target.x += deltaX;
      controls.target.z += deltaZ;
      camera.position.x += deltaX;
      camera.position.z += deltaZ;

      lastPlayerPos.current = { x: playerPos.x, z: playerPos.z };
    }
  });

  return null;
};

// ============== BRIDGE: Proyectar posición 3D → screen coords para card screen-space ==============
const AvatarScreenProjector: React.FC<{
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
const TeleportEffect: React.FC<{ position: [number, number, number]; phase: 'out' | 'in' }> = ({ position, phase }) => {
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

interface PlayerProps {
  currentUser: User;
  setPosition: (x: number, y: number, direction: string, isSitting: boolean, isMoving: boolean) => void;
  stream: MediaStream | null;
  showVideoBubble?: boolean;
  message?: string | null;
  orbitControlsRef: React.MutableRefObject<any>;
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

const Player: React.FC<PlayerProps> = ({ currentUser, setPosition, stream, showVideoBubble = true, message, orbitControlsRef, reactions = [], onClickAvatar, moveTarget, onReachTarget, teleportTarget, onTeleportDone, broadcastMovement, moveSpeed, runSpeed, ecsStateRef, onPositionUpdate, zonasEmpresa = [], empresasAutorizadas = [], usersInCallIds, mobileInputRef, onXPEvent }) => {
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

    if (hasKeyboardInput) {
      // Teclado cancela cualquier movimiento por doble clic
      if (moveTarget && onReachTarget) { autoMoveTimeRef.current = 0; onReachTarget(); }

      if (keyW) { dy = speed * delta; newDirection = 'up'; }
      if (keyS) { dy = -speed * delta; newDirection = 'front'; }
      if (keyA) { dx = -speed * delta; newDirection = 'left'; }
      if (keyD) { dx = speed * delta; newDirection = 'right'; }

      // Normalizar diagonal
      if (dx !== 0 && dy !== 0) {
        dx *= 0.707;
        dy *= 0.707;
      }
    } else if (hasJoystickInput && joystick) {
      // Joystick mobile cancela moveTarget igual que teclado
      if (moveTarget && onReachTarget) { autoMoveTimeRef.current = 0; onReachTarget(); }

      const joySpeed = joystick.isRunning ? baseRunSpeed : (baseMoveSpeed * joystick.magnitude);
      dx = joystick.dx * joySpeed * delta;
      dy = joystick.dz * joySpeed * delta; // dz del joystick = forward/back (Y en mundo)

      // Determinar dirección visual del avatar según ángulo del joystick
      const absJx = Math.abs(joystick.dx);
      const absJz = Math.abs(joystick.dz);
      const joyRatio = Math.min(absJx, absJz) / Math.max(absJx, absJz || 0.001);
      const joyDiag = joyRatio > 0.4;

      if (joyDiag) {
        const fb = joystick.dz > 0 ? 'up' : 'front';
        const lr = joystick.dx > 0 ? 'right' : 'left';
        newDirection = `${fb}-${lr}`;
      } else if (absJx > absJz) {
        newDirection = joystick.dx > 0 ? 'right' : 'left';
      } else {
        newDirection = joystick.dz > 0 ? 'up' : 'front';
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
      // Calcular nueva posición propuesta
      const nextX = Math.max(0, Math.min(WORLD_SIZE, positionRef.current.x + dx));
      const nextZ = Math.max(0, Math.min(WORLD_SIZE, positionRef.current.z - dy));

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

interface SceneProps {
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
}

const Scene: React.FC<SceneProps> = ({ currentUser, onlineUsers, setPosition, theme, orbitControlsRef, stream, remoteStreams, showVideoBubbles = true, localMessage, remoteMessages, localReactions, remoteReaction, onClickAvatar, moveTarget, onReachTarget, onDoubleClickFloor, onTapFloor, teleportTarget, onTeleportDone, showFloorGrid = true, showNamesAboveAvatars = true, cameraSensitivity = 5, invertYAxis = false, cameraMode = 'free', realtimePositionsRef, interpolacionWorkerRef, posicionesInterpoladasRef, ecsStateRef, broadcastMovement, moveSpeed, runSpeed, zonasEmpresa = [], onZoneCollision, usersInCallIds, usersInAudioRangeIds, empresasAutorizadas = [], mobileInputRef, enableDayNightCycle = false, onXPEvent, onClickRemoteAvatar, avatarInteractions }) => {
  const gridColor = theme === 'arcade' ? '#00ff41' : '#6366f1';
  const { camera } = useThree();
  const frustumRef = useRef(new THREE.Frustum());
  const projectionRef = useRef(new THREE.Matrix4());
  const chairMeshRef = useRef<THREE.InstancedMesh>(null);
  const chairDummy = useMemo(() => new THREE.Object3D(), []);
  const playerColliderRef = useRef<any>(null);
  const playerColliderPositionRef = useRef({ x: (currentUser.x || 400) / 16, z: (currentUser.y || 400) / 16 });
  const zonaColisionRef = useRef<string | null>(null);
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
      
      {/* Cámara Perspectiva para rotación 3D */}
      <PerspectiveCamera
        makeDefault
        position={[WORLD_SIZE/2, 15, WORLD_SIZE/2 + 20]}
        fov={50}
        near={0.1}
        far={1000}
      />
      
      {/* OrbitControls para rotación, zoom y pan */}
      <OrbitControls
        ref={orbitControlsRef}
        enableDamping={true}
        dampingFactor={0.05}
        minDistance={5}
        maxDistance={50}
        maxPolarAngle={Math.PI / 2 - 0.1}
        minPolarAngle={Math.PI / 6}
        enablePan={cameraMode === 'free'}
        enableRotate={cameraMode !== 'fixed'}
        panSpeed={0.5}
        rotateSpeed={cameraSensitivity / 10}
        zoomSpeed={0.8}
        reverseOrbit={invertYAxis}
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
      
      {/* Piso sólido */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[WORLD_SIZE / 2, -0.01, WORLD_SIZE / 2]} receiveShadow>
        <planeGeometry args={[WORLD_SIZE * 2, WORLD_SIZE * 2]} />
        <meshStandardMaterial color={themeColors[theme] || themeColors.dark} />
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
      
      {/* Suelo base: double-click (desktop) o single-tap (mobile) para mover */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]}
        onClick={(e) => {
          e.stopPropagation();
          if (onTapFloor) onTapFloor(e.point);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (onDoubleClickFloor) onDoubleClickFloor(e.point);
        }}
      >
        <planeGeometry args={[1000, 1000]} />
        <meshBasicMaterial visible={false} />
      </mesh>

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
        orbitControlsRef={orbitControlsRef}
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
      <CameraFollow orbitControlsRef={orbitControlsRef} />
      
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
const AdaptiveFrameloop: React.FC = () => {
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
interface VideoHUDProps {
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

const VideoHUD: React.FC<VideoHUDProps> = ({
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
interface VirtualSpace3DProps {
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
const ScreenSpaceProfileCard: React.FC<{
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

const VirtualSpace3D: React.FC<VirtualSpace3DProps> = ({ theme = 'dark', isGameHubOpen = false, isPlayingGame = false, showroomMode = false, showroomDuracionMin = 5, showroomNombreVisitante }) => {
  const { currentUser, onlineUsers, setPosition, activeWorkspace, toggleMic, toggleCamera, toggleScreenShare, togglePrivacy, setPrivacy, session, setActiveSubTab, setActiveChatGroupId, activeSubTab, empresasAutorizadas, setEmpresasAutorizadas } = useStore();
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [processedStream, setProcessedStream] = useState<MediaStream | null>(null); // Stream con efectos de fondo
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [cargoUsuario, setCargoUsuario] = useState<string>('colaborador');
  const [moveTarget, setMoveTarget] = useState<{ x: number; z: number } | null>(null);
  const [teleportTarget, setTeleportTarget] = useState<{ x: number; z: number } | null>(null);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  // === INTERACCIÓN AVATAR GATHER-STYLE (Fases 1-5) ===
  const [selectedRemoteUser, setSelectedRemoteUser] = useState<User | null>(null);
  const [followTargetId, setFollowTargetId] = useState<string | null>(null);
  const followTargetIdRef = useRef<string | null>(null);
  const [incomingNudge, setIncomingNudge] = useState<{ from: string; fromName: string } | null>(null);
  const [incomingInvite, setIncomingInvite] = useState<{ from: string; fromName: string; x: number; y: number } | null>(null);
  // === MOBILE GAME CONTROLS ===
  const mobileInputRef = useRef<JoystickInput>({ dx: 0, dz: 0, magnitude: 0, isRunning: false, active: false });
  const [showEmoteWheel, setShowEmoteWheel] = useState(false);
  const [showGamificacion, setShowGamificacion] = useState(false);
  const isMobile = useMemo(() => isTouchDevice(), []);
  // === XP TRACKING EN TIEMPO REAL (throttled, fire-and-forget) ===
  const xpThrottleRef = useRef<Record<string, number>>({});
  const xpLoginRegisteredRef = useRef(false);
  const grantXP = useCallback((accion: keyof typeof XP_POR_ACCION, cooldownMs: number = 10000) => {
    if (!session?.user?.id || !activeWorkspace?.id) return;
    const now = Date.now();
    if (xpThrottleRef.current[accion] && now - xpThrottleRef.current[accion] < cooldownMs) return;
    xpThrottleRef.current[accion] = now;
    otorgarXP(session.user.id, activeWorkspace.id, XP_POR_ACCION[accion], accion).then();
  }, [session?.user?.id, activeWorkspace?.id]);
  // Registrar Service Worker para PWA
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);
  const [solicitudesEnviadas, setSolicitudesEnviadas] = useState<AutorizacionEmpresa[]>([]);
  const [solicitandoAcceso, setSolicitandoAcceso] = useState(false);
  const [notificacionAutorizacion, setNotificacionAutorizacion] = useState<{
    id: string;
    titulo: string;
    mensaje?: string | null;
    tipo: string;
    datos_extra?: Record<string, any> | null;
  } | null>(null);
  const notificacionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chunkWorkerRef = useRef<Worker | null>(null);
  const [chunkWorkerReady, setChunkWorkerReady] = useState(false);
  const [chunkWorkerHasData, setChunkWorkerHasData] = useState(false);
  const [chunkWorkerData, setChunkWorkerData] = useState<{ usuariosIds: string[]; chunksVecinos: string[] }>({
    usuariosIds: [],
    chunksVecinos: [],
  });
  const [chunkWorkerError, setChunkWorkerError] = useState<string | null>(null);
  const interpolacionWorkerRef = useRef<Worker | null>(null);
  const posicionesInterpoladasRef = useRef<Map<string, { x: number; z: number; direction?: DireccionAvatar; isMoving?: boolean }>>(new Map());
  const [interpolacionWorkerError, setInterpolacionWorkerError] = useState<string | null>(null);
  const ecsStateRef = useRef(crearEstadoEcsEspacio());
  
  // ========== Settings del usuario (leídos de localStorage/SettingsModal) ==========
  const [userSettingsVersion, setUserSettingsVersion] = useState(0);
  const space3dSettings = useMemo(() => getSettingsSection('space3d'), [userSettingsVersion]);
  const enableDayNightCycle = space3dSettings.enableDayNightCycle ?? false;
  const meetingsSettings = useMemo(() => getSettingsSection('meetings'), [userSettingsVersion]);
  const notifSettings = useMemo(() => getSettingsSection('notifications'), [userSettingsVersion]);
  const performanceSettings = useMemo(() => getSettingsSection('performance'), [userSettingsVersion]);
  const [gpuInfo, setGpuInfo] = useState<GpuInfo | null>(null);

  useEffect(() => {
    detectGpuCapabilities().then(setGpuInfo);
  }, []);

  const gpuRenderConfig = useMemo(() => {
    if (!gpuInfo) return null;
    return adaptiveConfigFromTier(
      gpuInfo.tier,
      performanceSettings.graphicsQuality === 'auto' ? undefined : performanceSettings.graphicsQuality,
      performanceSettings.batterySaver,
    );
  }, [gpuInfo, performanceSettings.graphicsQuality, performanceSettings.batterySaver]);

  const radioInteresChunks = useMemo(() => {
    const radio = Number(space3dSettings.radioInteresChunks ?? 1);
    if (!Number.isFinite(radio)) return 1;
    return Math.max(1, Math.min(3, Math.round(radio)));
  }, [space3dSettings.radioInteresChunks]);
  const usuariosEcs = useMemo(() => {
    const mapa = new Map<string, User>();
    [currentUser, ...onlineUsers].forEach((usuario) => {
      mapa.set(usuario.id, usuario);
    });
    return Array.from(mapa.values());
  }, [currentUser, onlineUsers]);
  const usuariosEcsSnapshot = useMemo(() => {
    const ahora = Date.now();
    const mapa = new Map<string, { x: number; y: number; direction?: User['direction']; isMoving?: boolean }>();
    usuariosEcs.forEach((usuario) => {
      const ecsData = obtenerEstadoUsuarioEcs(ecsStateRef.current, usuario.id);
      if (ecsData && ahora - (ecsData.timestamp ?? 0) <= 2000) {
        mapa.set(usuario.id, {
          x: ecsData.x * 16,
          y: ecsData.z * 16,
          direction: ecsData.direction as User['direction'],
          isMoving: ecsData.isMoving,
        });
      }
    });
    return mapa;
  }, [usuariosEcs]);
  const currentUserEcs = useMemo(() => {
    const ecsData = usuariosEcsSnapshot.get(currentUser.id);
    if (!ecsData) return currentUser;
    return {
      ...currentUser,
      x: ecsData.x,
      y: ecsData.y,
      direction: ecsData.direction ?? currentUser.direction,
      isMoving: ecsData.isMoving ?? currentUser.isMoving,
    };
  }, [currentUser, usuariosEcsSnapshot]);
  const onlineUsersEcs = useMemo(() => {
    return onlineUsers.map((usuario) => {
      const ecsData = usuariosEcsSnapshot.get(usuario.id);
      if (!ecsData) return usuario;
      return {
        ...usuario,
        x: ecsData.x,
        y: ecsData.y,
        direction: ecsData.direction ?? usuario.direction,
        isMoving: ecsData.isMoving ?? usuario.isMoving,
      };
    });
  }, [onlineUsers, usuariosEcsSnapshot]);
  const usuariosEnChunks = useMemo(() => {
    let filtrados = onlineUsersEcs;
    if (chunkWorkerReady && chunkWorkerHasData) {
      const ids = new Set(chunkWorkerData.usuariosIds);
      filtrados = onlineUsersEcs.filter((usuario) => ids.has(usuario.id));
    } else {
      filtrados = filtrarUsuariosPorChunks(onlineUsersEcs, currentUserEcs.x, currentUserEcs.y, radioInteresChunks);
    }
    // Siempre incluir usuarios de la misma empresa o empresas autorizadas (no desaparecen por distancia)
    if (currentUserEcs.empresa_id) {
      const filtradosIds = new Set(filtrados.map(u => u.id));
      const faltantes = onlineUsersEcs.filter(u =>
        !filtradosIds.has(u.id) && (
          u.empresa_id === currentUserEcs.empresa_id ||
          (u.empresa_id && empresasAutorizadas.includes(u.empresa_id))
        )
      );
      if (faltantes.length > 0) filtrados = [...filtrados, ...faltantes];
    }
    return aplicarInteresEmpresa(filtrados, currentUserEcs.empresa_id, currentUserEcs.role, currentUserEcs.departamento_id, empresasAutorizadas);
  }, [onlineUsersEcs, currentUserEcs.empresa_id, currentUserEcs.role, currentUserEcs.departamento_id, currentUserEcs.x, currentUserEcs.y, radioInteresChunks, empresasAutorizadas, chunkWorkerData.usuariosIds, chunkWorkerHasData, chunkWorkerReady]);
  const usuariosParaConexion = useMemo(() => usuariosEnChunks.filter(u => !u.esFantasma), [usuariosEnChunks]);
  const usuariosParaMinimapa = useMemo(() => usuariosEnChunks.filter(u => !u.esFantasma), [usuariosEnChunks]);
  const chunkActual = useMemo(() => obtenerChunk(currentUserEcs.x, currentUserEcs.y), [currentUserEcs.x, currentUserEcs.y]);
  const maxDpr = useMemo(() => {
    if (gpuRenderConfig) return gpuRenderConfig.maxDpr;
    if (performanceSettings.graphicsQuality === 'low') return 1;
    if (performanceSettings.graphicsQuality === 'medium') return 1.5;
    return window.devicePixelRatio;
  }, [performanceSettings.graphicsQuality, gpuRenderConfig]);
  const minDpr = useMemo(() => {
    if (gpuRenderConfig) return gpuRenderConfig.minDpr;
    return performanceSettings.graphicsQuality === 'low' ? 1 : 0.75;
  }, [performanceSettings.graphicsQuality, gpuRenderConfig]);
  const [adaptiveDpr, setAdaptiveDpr] = useState(maxDpr);

  useEffect(() => {
    setAdaptiveDpr(maxDpr);
  }, [maxDpr]);

  useEffect(() => {
    if (chunkWorkerReady && chunkWorkerHasData && chunkWorkerData.chunksVecinos.length > 0) {
      chunkVecinosRef.current = new Set(chunkWorkerData.chunksVecinos);
      return;
    }
    const chunkActual = obtenerChunk(currentUserEcs.x, currentUserEcs.y);
    chunkVecinosRef.current = new Set(obtenerChunksVecinos(chunkActual, radioInteresChunks));
  }, [currentUserEcs.x, currentUserEcs.y, radioInteresChunks, chunkWorkerData.chunksVecinos, chunkWorkerHasData, chunkWorkerReady]);

  useEffect(() => {
    sincronizarUsuariosEcs(ecsStateRef.current, usuariosEcs);
  }, [usuariosEcs]);

  useEffect(() => {
    return () => {
      limpiarEstadoEcs(ecsStateRef.current);
    };
  }, []);

  useEffect(() => {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('../workers/chunkWorker.ts', import.meta.url), { type: 'module' });
      chunkWorkerRef.current = worker;
      setChunkWorkerReady(true);
      worker.onmessage = (event: MessageEvent) => {
        const { type, payload } = event.data || {};
        if (type === 'result') {
          setChunkWorkerData({
            usuariosIds: payload?.usuariosIds ?? [],
            chunksVecinos: payload?.chunksVecinos ?? [],
          });
          setChunkWorkerHasData(true);
        }
        if (type === 'error') {
          setChunkWorkerError(payload?.message || 'Error en worker de chunks');
        }
      };
      worker.onerror = (error) => {
        setChunkWorkerError(error.message || 'Error inicializando worker de chunks');
      };
    } catch (error) {
      setChunkWorkerError('No se pudo iniciar el worker de chunks');
    }

    return () => {
      if (worker) worker.terminate();
      chunkWorkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('../workers/interpolacionWorker.ts', import.meta.url), { type: 'module' });
      interpolacionWorkerRef.current = worker;
      worker.onmessage = (event: MessageEvent) => {
        const { type, payload } = event.data || {};
        if (type === 'update') {
          const positions = payload?.positions ?? [];
          if (positions.length === 0) return;
          const mapa = posicionesInterpoladasRef.current;
          positions.forEach((pos: { id: string; x: number; z: number; direction?: DireccionAvatar; isMoving?: boolean }) => {
            mapa.set(pos.id, { x: pos.x, z: pos.z, direction: pos.direction, isMoving: pos.isMoving });
          });
        }
        if (type === 'error') {
          setInterpolacionWorkerError(payload?.message || 'Error en worker de interpolación');
        }
      };
      worker.onerror = (error) => {
        setInterpolacionWorkerError(error.message || 'Error inicializando worker de interpolación');
      };
    } catch (error) {
      setInterpolacionWorkerError('No se pudo iniciar el worker de interpolación');
    }

    return () => {
      if (worker) worker.terminate();
      interpolacionWorkerRef.current = null;
      posicionesInterpoladasRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!chunkWorkerRef.current || !chunkWorkerReady) return;
    if (!Number.isFinite(currentUserEcs.x) || !Number.isFinite(currentUserEcs.y)) return;
    chunkWorkerRef.current.postMessage({
      type: 'compute',
      payload: {
        current: { x: currentUserEcs.x, y: currentUserEcs.y },
        radio: radioInteresChunks,
        users: onlineUsers.map((usuario) => ({
          id: usuario.id,
          x: usuariosEcsSnapshot.get(usuario.id)?.x ?? usuario.x,
          y: usuariosEcsSnapshot.get(usuario.id)?.y ?? usuario.y,
        })),
      }
    });
  }, [onlineUsers, currentUserEcs.x, currentUserEcs.y, radioInteresChunks, chunkWorkerReady, usuariosEcsSnapshot]);

  useEffect(() => {
    usuariosVisiblesRef.current = new Set(usuariosParaConexion.map(usuario => usuario.id));
  }, [USAR_LIVEKIT, usuariosParaConexion]);
  
  // Velocidades y radios basados en settings del usuario (factor sobre las constantes globales)
  const userMoveSpeed = useMemo(() => {
    const factor = space3dSettings.movementSpeed / 5; // 5 es el default, escala lineal
    return MOVE_SPEED * factor;
  }, [space3dSettings.movementSpeed]);
  
  const userRunSpeed = useMemo(() => {
    const factor = space3dSettings.movementSpeed / 5;
    return RUN_SPEED * factor;
  }, [space3dSettings.movementSpeed]);

  const normalizarDireccion = useCallback((direccion?: string): User['direction'] | undefined => {
    if (!direccion) return undefined;
    if (direccion === 'front' || direccion === 'back' || direccion === 'left' || direccion === 'right') {
      return direccion as User['direction'];
    }
    if (direccion.startsWith('up')) return 'back';
    if (direccion.startsWith('front') || direccion === 'down') return 'front';
    return 'front';
  }, []);

  const setPositionEcs = useCallback((x: number, y: number, direction?: string, isSitting?: boolean, isMoving?: boolean) => {
    setPosition(x, y, normalizarDireccion(direction), isSitting, isMoving);
    if (currentUser?.id) {
      actualizarEstadoUsuarioEcs(
        ecsStateRef.current,
        currentUser.id,
        x / 16,
        y / 16,
        direction,
        isMoving
      );
    }
  }, [currentUser?.id, normalizarDireccion, setPosition]);
  
  const userProximityRadius = useMemo(() => {
    return space3dSettings.proximityRadius || PROXIMITY_RADIUS;
  }, [space3dSettings.proximityRadius]);
  
  // Escuchar cambios de settings (cuando el usuario cambia algo en SettingsModal)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'user_settings') {
        setUserSettingsVersion(v => v + 1);
      }
    };
    window.addEventListener('storage', handleStorageChange);
    
    // También escuchar cambios en el mismo tab via intervalo corto
    const interval = setInterval(() => {
      const current = localStorage.getItem('user_settings');
      if (current) {
        const hash = current.length; // Simple change detection
        setUserSettingsVersion(prev => {
          if (prev !== hash) return hash;
          return prev;
        });
      }
    }, 2000);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);
  
  // Auto-mute idle: detectar inactividad y apagar mic/cam automáticamente
  const idleTimerRef = useRef<any>(null);
  const wasIdleMutedRef = useRef(false);
  const micOnRef = useRef(currentUser.isMicOn);
  const camOnRef = useRef(currentUser.isCameraOn);
  const hasActiveCallRef = useRef(false);
  micOnRef.current = currentUser.isMicOn;
  camOnRef.current = currentUser.isCameraOn;

  // Función estable para verificar si hay llamada activa (doble check: ref de proximidad + LiveKit directo)
  const isInActiveCall = useCallback(() => {
    // Check 1: ref actualizada por usersInCall memo
    if (hasActiveCallRef.current) return true;
    // Check 2: verificación directa contra la API de LiveKit (siempre actual, no depende del render cycle)
    const room = livekitRoomRef.current;
    if (room && room.state === 'connected' && room.remoteParticipants.size > 0) return true;
    return false;
  }, []);

  useEffect(() => {
    const videoS = getSettingsSection('video');
    if (!videoS.autoIdleMuting) return;
    
    const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutos de inactividad
    
    const resetIdleTimer = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      wasIdleMutedRef.current = false;
      idleTimerRef.current = setTimeout(() => {
        // No apagar mic/cam si el usuario está en conversación activa (best practice: Gather/Zoom/Meet)
        // Doble check: hasActiveCallRef (proximidad) + LiveKit remoteParticipants (directo)
        if (isInActiveCall()) {
          console.log('[AutoIdleMute] Inactivo pero en conversación activa — no se apaga mic/cam');
          return;
        }
        if (micOnRef.current) { toggleMic(); wasIdleMutedRef.current = true; }
        if (camOnRef.current) { toggleCamera(); wasIdleMutedRef.current = true; }
        if (micOnRef.current || camOnRef.current) {
          console.log('[AutoIdleMute] Usuario inactivo y sin conversación, mic/cam apagados');
        }
      }, IDLE_TIMEOUT);
    };
    
    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'click'];
    events.forEach(e => window.addEventListener(e, resetIdleTimer, { passive: true }));
    resetIdleTimer();
    
    return () => {
      events.forEach(e => window.removeEventListener(e, resetIdleTimer));
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [isInActiveCall]); // isInActiveCall es estable (useCallback sin deps)
  
  // Solicitar permiso de notificaciones desktop al montar
  useEffect(() => {
    if (notifSettings.desktopNotifications) {
      requestDesktopNotificationPermission();
    }
  }, [notifSettings.desktopNotifications]);
  
  // Estado de configuración de cámara (compartido entre BottomControlBar y VideoHUD)
  const [cameraSettings, setCameraSettings] = useState<CameraSettings>(loadCameraSettings);
  
  // Estado de configuración de audio
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(loadAudioSettings);
  const audioProcesadoRef = useRef<{
    context: AudioContext;
    source: MediaStreamAudioSourceNode;
    destination: MediaStreamAudioDestinationNode;
    nodes: AudioNode[];
    track: MediaStreamTrack;
  } | null>(null);

  const limpiarAudioProcesado = useCallback(() => {
    const actual = audioProcesadoRef.current;
    if (!actual) return;
    actual.track.stop();
    actual.nodes.forEach((node) => {
      try {
        node.disconnect();
      } catch {
        // noop
      }
    });
    actual.source.disconnect();
    actual.destination.disconnect();
    actual.context.close().catch(() => undefined);
    audioProcesadoRef.current = null;
  }, []);

  const crearAudioProcesado = useCallback(async (track: MediaStreamTrack, nivel: 'standard' | 'enhanced') => {
    limpiarAudioProcesado();
    const context = new AudioContext();
    const stream = new MediaStream([track]);
    const source = context.createMediaStreamSource(stream);

    const highpass = context.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = nivel === 'enhanced' ? 120 : 80;

    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = nivel === 'enhanced' ? -35 : -28;
    compressor.knee.value = 30;
    compressor.ratio.value = nivel === 'enhanced' ? 12 : 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    const gain = context.createGain();
    gain.gain.value = nivel === 'enhanced' ? 1.1 : 1.0;

    const destination = context.createMediaStreamDestination();
    source.connect(highpass).connect(compressor).connect(gain).connect(destination);

    const processedTrack = destination.stream.getAudioTracks()[0];
    if (!processedTrack) {
      context.close().catch(() => undefined);
      return null;
    }

    audioProcesadoRef.current = {
      context,
      source,
      destination,
      nodes: [highpass, compressor, gain],
      track: processedTrack,
    };

    return processedTrack;
  }, [limpiarAudioProcesado]);

  // Stream efectivo para transmitir (procesado si hay efectos, original si no)
  const effectiveStream = (cameraSettings.backgroundEffect !== 'none' && processedStream) ? processedStream : stream;
  const effectiveStreamRef = useRef<MediaStream | null>(null);
  effectiveStreamRef.current = effectiveStream;

  // Cargar cargo del usuario desde miembros_espacio
  useEffect(() => {
    const cargarCargo = async () => {
      if (!session?.user?.id || !activeWorkspace?.id) return;
      
      const { data } = await supabase
        .from('miembros_espacio')
        .select('cargo_id, cargo_ref:cargos!cargo_id(clave)')
        .eq('usuario_id', session.user.id)
        .eq('espacio_id', activeWorkspace.id)
        .single();
      
      const clave = (data?.cargo_ref as any)?.clave;
      if (clave) {
        console.log('📋 Cargo del usuario cargado:', clave);
        setCargoUsuario(clave);
      }
    };
    
    cargarCargo();

    // XP: registrar login diario al entrar al espacio (una sola vez por sesión)
    if (!xpLoginRegisteredRef.current && session?.user?.id && activeWorkspace?.id) {
      xpLoginRegisteredRef.current = true;
      registrarLoginDiario(session.user.id, activeWorkspace.id).then();
    }
  }, [session?.user?.id, activeWorkspace?.id]);

  useEffect(() => {
    const cargarZonas = async () => {
      if (!activeWorkspace?.id) {
        setZonasEmpresa([]);
        return;
      }

      const zonas = await cargarZonasEmpresa(activeWorkspace.id);
      setZonasEmpresa(zonas);
    };

    cargarZonas();
  }, [activeWorkspace?.id]);

  const cargarAutorizaciones = useCallback(async () => {
    if (!activeWorkspace?.id || !currentUser.empresa_id) {
      setEmpresasAutorizadas([]);
      return;
    }

    const autorizaciones = await cargarAutorizacionesActivas(activeWorkspace.id, currentUser.empresa_id);
    const empresas = new Set<string>();

    autorizaciones.forEach((autorizacion) => {
      if (autorizacion.empresa_origen_id === currentUser.empresa_id) {
        empresas.add(autorizacion.empresa_destino_id);
      } else if (autorizacion.empresa_destino_id === currentUser.empresa_id) {
        empresas.add(autorizacion.empresa_origen_id);
      }
    });

    setEmpresasAutorizadas(Array.from(empresas));
  }, [activeWorkspace?.id, currentUser.empresa_id, setEmpresasAutorizadas]);

  const cargarSolicitudesPendientes = useCallback(async () => {
    if (!activeWorkspace?.id || !currentUser.empresa_id) {
      setSolicitudesEnviadas([]);
      return;
    }

    const pendientes = await cargarSolicitudesEnviadas(activeWorkspace.id, currentUser.empresa_id);
    setSolicitudesEnviadas(pendientes);
  }, [activeWorkspace?.id, currentUser.empresa_id]);

  useEffect(() => {
    cargarAutorizaciones();
  }, [cargarAutorizaciones]);

  useEffect(() => {
    cargarSolicitudesPendientes();
  }, [cargarSolicitudesPendientes]);

  useEffect(() => {
    if (!session?.user?.id) return;
    const channel = supabase
      .channel(`notificaciones-${session.user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notificaciones',
        filter: `usuario_id=eq.${session.user.id}`
      }, (payload) => {
        const nueva = payload.new as any;
        if (activeWorkspace?.id && nueva?.espacio_id && nueva.espacio_id !== activeWorkspace.id) return;
        setNotificacionAutorizacion({
          id: nueva.id,
          titulo: nueva.titulo || 'Notificación',
          mensaje: nueva.mensaje,
          tipo: nueva.tipo,
          datos_extra: nueva.datos_extra,
        });
        if (String(nueva.tipo || '').includes('autorizacion_empresa')) {
          cargarAutorizaciones();
          cargarSolicitudesPendientes();
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeWorkspace?.id, cargarAutorizaciones, cargarSolicitudesPendientes, session?.user?.id]);

  useEffect(() => {
    if (!notificacionAutorizacion) return;
    if (notificacionTimeoutRef.current) {
      clearTimeout(notificacionTimeoutRef.current);
    }
    notificacionTimeoutRef.current = setTimeout(() => {
      setNotificacionAutorizacion(null);
    }, 6500);
    return () => {
      if (notificacionTimeoutRef.current) clearTimeout(notificacionTimeoutRef.current);
    };
  }, [notificacionAutorizacion]);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [remoteScreenStreams, setRemoteScreenStreams] = useState<Map<string, MediaStream>>(new Map());
  const [remoteAudioTracks, setRemoteAudioTracks] = useState<Map<string, MediaStreamTrack>>(new Map());
  const livekitRoomRef = useRef<Room | null>(null);
  const livekitRoomNameRef = useRef<string | null>(null);
  const livekitConnectingRef = useRef(false);
  const [livekitConnected, setLivekitConnected] = useState(false);
  const livekitLocalTracksRef = useRef<Partial<Record<'audio' | 'video' | 'screen', LocalAudioTrack | LocalVideoTrack>>>({});
  const activeStreamRef = useRef<MediaStream | null>(null);
  const activeScreenRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const peerVideoTrackCountRef = useRef<Map<string, number>>(new Map()); // Rastrear video tracks por peer
  const webrtcChannelRef = useRef<any>(null);
  const realtimeChunkManagerRef = useRef<RealtimeChunkManager | null>(null);
  const selectedCameraIdRef = useRef<string>(loadCameraSettings().selectedCameraId); // Cámara seleccionada por usuario
  const [localReactions, setLocalReactions] = useState<Array<{ id: string; emoji: string }>>([]);
  const [remoteReaction, setRemoteReaction] = useState<{ emoji: string; from: string; fromName: string } | null>(null);
  const orbitControlsRef = useRef<any>(null);
  const cardScreenPosRef = useRef<{ x: number; y: number } | null>(null);
  const realtimePositionsRef = useRef<Map<string, any>>(new Map());
  const chunkVecinosRef = useRef<Set<string>>(new Set());
  const usuariosVisiblesRef = useRef<Set<string>>(new Set());
  const [zonasEmpresa, setZonasEmpresa] = useState<ZonaEmpresa[]>([]);
  const [zonaColisionadaId, setZonaColisionadaId] = useState<string | null>(null);
  const solicitudesPendientesPorEmpresa = useMemo(() => {
    return new Set(solicitudesEnviadas.map((solicitud) => solicitud.empresa_destino_id));
  }, [solicitudesEnviadas]);
  const zonaAccesoProxima = useMemo(() => {
    if (!currentUserEcs.empresa_id) return null;
    if (!Number.isFinite(currentUserEcs.x) || !Number.isFinite(currentUserEcs.y)) return null;

    const zonaColisionada = zonaColisionadaId
      ? zonasEmpresa.find((zona) => zona.id === zonaColisionadaId)
      : null;

    if (zonaColisionada) {
      if (
        zonaColisionada.estado === 'activa' &&
        !zonaColisionada.es_comun &&
        zonaColisionada.empresa_id &&
        zonaColisionada.empresa_id !== currentUserEcs.empresa_id &&
        !empresasAutorizadas.includes(zonaColisionada.empresa_id)
      ) {
        const pendiente = solicitudesPendientesPorEmpresa.has(zonaColisionada.empresa_id);
        return { zona: zonaColisionada, distancia: 0, pendiente };
      }
    }

    let mejor: { zona: ZonaEmpresa; distancia: number; pendiente: boolean } | null = null;
    zonasEmpresa.forEach((zona) => {
      if (zona.estado !== 'activa') return;
      if (zona.es_comun) return;
      if (!zona.empresa_id || zona.empresa_id === currentUserEcs.empresa_id) return;
      if (empresasAutorizadas.includes(zona.empresa_id)) return;

      const halfAncho = Number(zona.ancho) / 2;
      const halfAlto = Number(zona.alto) / 2;
      const dx = Math.max(Math.abs(currentUserEcs.x - Number(zona.posicion_x)) - halfAncho, 0);
      const dy = Math.max(Math.abs(currentUserEcs.y - Number(zona.posicion_y)) - halfAlto, 0);
      const distancia = Math.sqrt(dx * dx + dy * dy);

      if (distancia > ZONA_SOLICITUD_RADIO) return;

      const pendiente = solicitudesPendientesPorEmpresa.has(zona.empresa_id);
      if (!mejor || distancia < mejor.distancia) {
        mejor = { zona, distancia, pendiente };
      }
    });

    return mejor;
  }, [currentUserEcs.empresa_id, currentUserEcs.x, currentUserEcs.y, empresasAutorizadas, solicitudesPendientesPorEmpresa, zonasEmpresa, zonaColisionadaId]);

  const handleSolicitarAccesoZona = useCallback(async () => {
    if (!zonaAccesoProxima?.zona || solicitandoAcceso) return;
    if (!activeWorkspace?.id || !currentUser.empresa_id || !session?.user?.id) return;
    if (zonaAccesoProxima.pendiente) return;

    setSolicitandoAcceso(true);
    const solicitudId = await solicitarAccesoEmpresa({
      espacioId: activeWorkspace.id,
      empresaOrigenId: currentUser.empresa_id,
      empresaDestinoId: zonaAccesoProxima.zona.empresa_id,
      usuarioId: session.user.id,
    });
    if (solicitudId) {
      await cargarSolicitudesPendientes();
      setNotificacionAutorizacion({
        id: solicitudId,
        titulo: 'Solicitud enviada',
        mensaje: 'La empresa recibirá tu solicitud en instantes.',
        tipo: 'solicitud_autorizacion_empresa',
        datos_extra: { empresa_destino_id: zonaAccesoProxima.zona.empresa_id },
      });
    }
    setSolicitandoAcceso(false);
  }, [activeWorkspace?.id, cargarSolicitudesPendientes, currentUser.empresa_id, session?.user?.id, solicitandoAcceso, zonaAccesoProxima]);

  const limpiarLivekit = useCallback(async () => {
    const room = livekitRoomRef.current;
    if (room) {
      room.removeAllListeners();
      await room.disconnect();
    }
    if (livekitLocalTracksRef.current.audio) {
      livekitLocalTracksRef.current.audio.stop();
    }
    if (livekitLocalTracksRef.current.video) {
      livekitLocalTracksRef.current.video.stop();
    }
    if (livekitLocalTracksRef.current.screen) {
      livekitLocalTracksRef.current.screen.stop();
    }
    livekitRoomRef.current = null;
    livekitRoomNameRef.current = null;
    setLivekitConnected(false);
    setRemoteStreams(new Map());
    setRemoteScreenStreams(new Map());
    setRemoteAudioTracks(new Map());
    livekitLocalTracksRef.current = {};
  }, []);

  const obtenerEmpresaParticipante = useCallback((metadata?: string | null) => {
    if (!metadata) return null;
    try {
      const data = JSON.parse(metadata);
      return data?.empresa_id ?? null;
    } catch (error) {
      return null;
    }
  }, []);

  const permitirMediaParticipante = useCallback((metadata?: string | null) => {
    if (!currentUser.empresa_id) return true;
    const empresaParticipante = obtenerEmpresaParticipante(metadata);
    if (!empresaParticipante) return true;
    if (empresaParticipante === currentUser.empresa_id) return true;
    return empresasAutorizadas.includes(empresaParticipante);
  }, [currentUser.empresa_id, obtenerEmpresaParticipante, empresasAutorizadas]);

  const despublicarTrackLocal = useCallback(async (tipo: 'audio' | 'video' | 'screen') => {
    const room = livekitRoomRef.current;
    const existing = livekitLocalTracksRef.current[tipo];
    if (!room || !existing) return;
    try {
      room.localParticipant.unpublishTrack(existing);
    } catch (error) {
      console.warn('Error despublicando track LiveKit:', error);
    }
    existing.stop();
    livekitLocalTracksRef.current[tipo] = undefined;
  }, []);

  const publicarTrackLocal = useCallback(async (track: MediaStreamTrack, tipo: 'audio' | 'video' | 'screen') => {
    const room = livekitRoomRef.current;
    if (!room || room.state !== 'connected') return;
    const existing = livekitLocalTracksRef.current[tipo];
    if (existing?.mediaStreamTrack?.id === track.id) return;
    // Si ya hay un track publicado del mismo tipo, usar replaceTrack (sin interrupción)
    if (existing && existing.mediaStreamTrack) {
      try {
        await existing.replaceTrack(track);
        console.log(`[LIVEKIT] Track ${tipo} reemplazado sin interrupción (replaceTrack)`);
        return;
      } catch (error) {
        console.warn(`[LIVEKIT] replaceTrack falló para ${tipo}, re-publicando:`, error);
        try { room.localParticipant.unpublishTrack(existing); } catch (_) {}
        existing.stop();
      }
    }
    // Primera publicación o fallback tras error de replaceTrack
    const localTrack = tipo === 'audio' ? new LocalAudioTrack(track) : new LocalVideoTrack(track);
    livekitLocalTracksRef.current[tipo] = localTrack;
    const publishOptions: any = {
      source: tipo === 'screen' ? Track.Source.ScreenShare : tipo === 'video' ? Track.Source.Camera : Track.Source.Microphone,
    };
    if (tipo === 'screen') {
      publishOptions.simulcast = false;
      publishOptions.videoEncoding = { maxBitrate: 2_500_000, maxFramerate: 15 };
      publishOptions.scalabilityMode = 'L1T3';
    }
    await room.localParticipant.publishTrack(localTrack, publishOptions);
    console.log(`[LIVEKIT] Track ${tipo} publicado por primera vez`);
  }, []);

  const sincronizarTracksLocales = useCallback(async () => {
    if (!USAR_LIVEKIT) return;
    const room = livekitRoomRef.current;
    if (!room || room.state !== 'connected') {
      console.log('[LIVEKIT] sincronizarTracks skipped — room state:', room?.state);
      return;
    }

    const streamActual = activeStreamRef.current;
    const audioTrack = streamActual?.getAudioTracks()[0];
    if (audioTrack) {
      await publicarTrackLocal(audioTrack, 'audio');
      audioTrack.enabled = !!currentUser.isMicOn;
    } else {
      await despublicarTrackLocal('audio');
    }

    if (currentUser.isCameraOn) {
      // Buscar un video track VIVO (readyState === 'live'), preferir effectiveStream
      let videoTrack = effectiveStreamRef.current?.getVideoTracks().find(t => t.readyState === 'live');
      if (!videoTrack) {
        videoTrack = streamActual?.getVideoTracks().find(t => t.readyState === 'live');
      }
      if (videoTrack) {
        await publicarTrackLocal(videoTrack, 'video');
      } else {
        console.log('[LIVEKIT] No live video track available yet');
        await despublicarTrackLocal('video');
      }
    } else {
      await despublicarTrackLocal('video');
    }

    if (currentUser.isScreenSharing) {
      const screenTrack = activeScreenRef.current?.getVideoTracks()[0];
      if (screenTrack) {
        await publicarTrackLocal(screenTrack, 'screen');
      } else {
        await despublicarTrackLocal('screen');
      }
    } else {
      await despublicarTrackLocal('screen');
    }
  }, [USAR_LIVEKIT, currentUser.isMicOn, currentUser.isCameraOn, currentUser.isScreenSharing, publicarTrackLocal, despublicarTrackLocal]);

  const conectarLivekit = useCallback(async (roomName: string) => {
    if (!USAR_LIVEKIT || !activeWorkspace?.id || !session?.access_token) return;
    if (livekitRoomNameRef.current === roomName) return;
    if (livekitConnectingRef.current) {
      console.log('[LIVEKIT] Already connecting, skipping duplicate attempt');
      return;
    }

    try {
    livekitConnectingRef.current = true;
    await limpiarLivekit();

    const tokenData = await obtenerTokenLivekitEspacio({
      roomName,
      espacioId: activeWorkspace.id,
      accessToken: session.access_token,
      empresaId: currentUser.empresa_id,
      departamentoId: currentUser.departamento_id,
    });
    console.log('[LIVEKIT] Connecting to:', tokenData.url, 'room:', roomName);

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      reconnectPolicy: {
        nextRetryDelayInMs: (context) => {
          if (context.retryCount > 5) return null;
          return Math.min(1000 * Math.pow(2, context.retryCount), 16000);
        },
      },
      publishDefaults: {
        simulcast: true,
        videoSimulcastLayers: [VideoPresets.h90, VideoPresets.h216, VideoPresets.h540],
        screenShareSimulcastLayers: [],
        screenShareEncoding: {
          maxBitrate: 2_500_000,
          maxFramerate: 15,
        },
      },
    });

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      console.log(`[LIVEKIT TrackSubscribed] from=${participant?.identity} kind=${track?.kind} source=${track?.source} trackId=${track?.mediaStreamTrack?.id} allowed=${permitirMediaParticipante(participant?.metadata)}`);
      if (!participant || !track || !permitirMediaParticipante(participant.metadata)) return;
      if (track.kind === Track.Kind.Video) {
        const stream = new MediaStream([track.mediaStreamTrack]);
        if (track.source === Track.Source.ScreenShare) {
          setRemoteScreenStreams(prev => new Map(prev).set(participant.identity, stream));
        } else {
          setRemoteStreams(prev => new Map(prev).set(participant.identity, stream));
          console.log(`[LIVEKIT] Remote video stream set for ${participant.identity}, track.readyState=${track.mediaStreamTrack.readyState}`);
        }
      }
      if (track.kind === Track.Kind.Audio) {
        setRemoteAudioTracks(prev => new Map(prev).set(participant.identity, track.mediaStreamTrack));
      }
    });

    room.on(RoomEvent.TrackPublished, (_publication, _participant) => {
      // Suscripción controlada por proximidad — ver useEffect de suscripción selectiva
    });

    room.on(RoomEvent.ParticipantConnected, (_participant) => {
      // Suscripción controlada por proximidad — ver useEffect de suscripción selectiva
    });

    room.on(RoomEvent.ParticipantMetadataChanged, (_metadata, _participant) => {
      // Suscripción controlada por proximidad — ver useEffect de suscripción selectiva
    });

    room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      if (!participant || !track) return;
      console.log(`[LIVEKIT TrackUnsubscribed] from=${participant.identity} kind=${track.kind} source=${track.source} trackId=${track.mediaStreamTrack?.id}`);
      if (track.kind === Track.Kind.Video) {
        if (track.source === Track.Source.ScreenShare) {
          setRemoteScreenStreams(prev => {
            const existing = prev.get(participant.identity);
            // Solo borrar si el stream actual usa el MISMO track (evita race condition unpublish/republish)
            if (existing) {
              const existingTrackId = existing.getVideoTracks()[0]?.id;
              if (existingTrackId && existingTrackId !== track.mediaStreamTrack?.id) {
                console.log(`[LIVEKIT] TrackUnsubscribed ignorado para screen ${participant.identity} — stream actual tiene track diferente (race condition resuelta)`);
                return prev;
              }
            }
            const next = new Map(prev);
            next.delete(participant.identity);
            return next;
          });
        } else {
          setRemoteStreams(prev => {
            const existing = prev.get(participant.identity);
            // Solo borrar si el stream actual usa el MISMO track (evita race condition unpublish/republish)
            if (existing) {
              const existingTrackId = existing.getVideoTracks()[0]?.id;
              if (existingTrackId && existingTrackId !== track.mediaStreamTrack?.id) {
                console.log(`[LIVEKIT] TrackUnsubscribed ignorado para ${participant.identity} — stream actual tiene track diferente (race condition resuelta)`);
                return prev;
              }
            }
            const next = new Map(prev);
            next.delete(participant.identity);
            return next;
          });
        }
      }
      if (track.kind === Track.Kind.Audio) {
        setRemoteAudioTracks(prev => {
          const existing = prev.get(participant.identity);
          if (existing && existing.id !== track.mediaStreamTrack?.id) {
            return prev;
          }
          const next = new Map(prev);
          next.delete(participant.identity);
          return next;
        });
      }
    });

    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      setRemoteStreams(prev => {
        const next = new Map(prev);
        next.delete(participant.identity);
        return next;
      });
      setRemoteScreenStreams(prev => {
        const next = new Map(prev);
        next.delete(participant.identity);
        return next;
      });
      setRemoteAudioTracks(prev => {
        const next = new Map(prev);
        next.delete(participant.identity);
        return next;
      });
    });

    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const active = new Set(speakers.map((p) => p.identity));
      if (room.localParticipant.isSpeaking) {
        active.add(room.localParticipant.identity);
      }
      setSpeakingUsers(active);
    });

    room.on(RoomEvent.Disconnected, () => {
      console.log('[LIVEKIT] Disconnected — limpiando para permitir reconexión');
      livekitRoomNameRef.current = null;
      livekitRoomRef.current = null;
      setLivekitConnected(false);
    });

    room.on(RoomEvent.Reconnecting, () => {
      console.log('[LIVEKIT] Reconnecting...');
    });
    room.on(RoomEvent.Reconnected, () => {
      console.log('[LIVEKIT] Reconnected successfully');
    });

    await room.connect(tokenData.url, tokenData.token, { autoSubscribe: false });
    console.log('[LIVEKIT] Connected successfully to room:', roomName);
    livekitRoomRef.current = room;
    livekitRoomNameRef.current = roomName;
    livekitConnectingRef.current = false;
    setLivekitConnected(true);

    } catch (err: any) {
      console.error('[LIVEKIT] Connection failed:', err.message);
      livekitRoomNameRef.current = null;
      livekitRoomRef.current = null;
      livekitConnectingRef.current = false;
      setLivekitConnected(false);
    }
  }, [USAR_LIVEKIT, activeWorkspace?.id, session?.access_token, currentUser.empresa_id, currentUser.departamento_id, limpiarLivekit, permitirMediaParticipante]);

  const hayOtrosUsuariosOnline = onlineUsers.length > 0;
  const hayOtrosUsuariosRef = useRef(hayOtrosUsuariosOnline);
  hayOtrosUsuariosRef.current = hayOtrosUsuariosOnline;

  useEffect(() => {
    if (!USAR_LIVEKIT || !activeWorkspace?.id) return;

    if (hayOtrosUsuariosOnline) {
      // Hay otros usuarios → conectar a LiveKit inmediatamente (si no estamos ya conectados)
      const roomName = crearSalaLivekitPorEspacio(activeWorkspace.id);
      conectarLivekit(roomName).catch((error) => {
        console.error('Error conectando LiveKit:', error);
      });
    } else {
      // Debounce disconnect: esperar 5s para confirmar que realmente no hay usuarios
      // (Supabase Presence puede parpadear brevemente a vacío durante refreshes)
      const timer = setTimeout(() => {
        if (!hayOtrosUsuariosRef.current && livekitRoomRef.current) {
          console.log('[LIVEKIT] Sin otros usuarios online (confirmado tras 5s) — desconectando');
          limpiarLivekit().catch(() => {});
        }
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [USAR_LIVEKIT, activeWorkspace?.id, hayOtrosUsuariosOnline, conectarLivekit, limpiarLivekit]);

  useEffect(() => {
    if (!USAR_LIVEKIT) return;
    return () => {
      limpiarLivekit().catch(() => {});
    };
  }, [USAR_LIVEKIT, limpiarLivekit]);

  // NOTA: useEffect de sincronización de tracks movido después de hasActiveCall (línea ~2990)

  // Estado de grabación
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [consentimientoAceptado, setConsentimientoAceptado] = useState(false); // Para tipos con disclaimer
  const [tipoGrabacionActual, setTipoGrabacionActual] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  
  // Estado para speaker detection
  const [speakingUsers, setSpeakingUsers] = useState<Set<string>>(new Set());
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserNodesRef = useRef<Map<string, AnalyserNode>>(new Map());
  
  // Estado para wave/invite
  const [incomingWave, setIncomingWave] = useState<{ from: string; fromName: string } | null>(null);
  const lastInteractionRef = useRef<Map<string, number>>(new Map()); // Dedup wave/nudge/invite dual-channel
  
  // Coordenadas estabilizadas para cálculo de proximidad — evita recálculos en cada pixel de movimiento
  // Solo se actualiza cuando el usuario se mueve más de 8px (medio tile), reduciendo re-renders masivos
  const PROXIMITY_COORD_THRESHOLD = 8;
  const [stableProximityCoords, setStableProximityCoords] = useState({ x: currentUserEcs.x, y: currentUserEcs.y });
  const stableProximityCoordsRef = useRef({ x: currentUserEcs.x, y: currentUserEcs.y });
  useEffect(() => {
    const dx = currentUserEcs.x - stableProximityCoordsRef.current.x;
    const dy = currentUserEcs.y - stableProximityCoordsRef.current.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= PROXIMITY_COORD_THRESHOLD) {
      stableProximityCoordsRef.current = { x: currentUserEcs.x, y: currentUserEcs.y };
      setStableProximityCoords({ x: currentUserEcs.x, y: currentUserEcs.y });
    }
  }, [currentUserEcs.x, currentUserEcs.y]);

  // Ref para tracking de histéresis (evitar parpadeo en el límite de proximidad)
  const connectedUsersRef = useRef<Set<string>>(new Set());

  // === ESTADOS DE PRIVACIDAD DE PROXIMIDAD (patrón Gather) — declarados antes de usersInCall ===
  const [conversacionBloqueada, setConversacionBloqueada] = useState(false);
  const [conversacionesBloqueadasRemoto, setConversacionesBloqueadasRemoto] = useState<Map<string, string[]>>(new Map());
  const [proximidadNotificada, setProximidadNotificada] = useState(false);
  const proximidadNotificadaRef = useRef(false);

  // Detectar usuarios en proximidad (excluyendo al usuario actual)
  const usersInCall = useMemo(() => {
    const nextConnectedUsers = new Set<string>();

    // Construir set de IDs bloqueados por conversaciones remotas
    const idsBloqueadosProximidad = new Set<string>();
    conversacionesBloqueadasRemoto.forEach((participants, lockerId) => {
      if (!session?.user?.id || participants.includes(session.user.id)) return;
      participants.forEach(pid => idsBloqueadosProximidad.add(pid));
      idsBloqueadosProximidad.add(lockerId);
    });
    
    const users = usuariosEnChunks.filter(u => {
      // Excluir al usuario actual
      if (u.id === session?.user?.id) return false;
      if (u.esFantasma) return false;

      // Bloquear entrada si el usuario pertenece a una conversación bloqueada
      if (idsBloqueadosProximidad.has(u.id)) return false;
      
      // Validar coordenadas (ignorar 0,0 que suele ser inicialización)
      if ((u.x === 0 && u.y === 0) || typeof u.x !== 'number' || typeof u.y !== 'number' || typeof stableProximityCoords.x !== 'number' || typeof stableProximityCoords.y !== 'number') {
        return false;
      }

      const dist = Math.sqrt(Math.pow(u.x - stableProximityCoords.x, 2) + Math.pow(u.y - stableProximityCoords.y, 2));
      
      const wasInCall = connectedUsersRef.current.has(u.id);
      
      // HISTÉRESIS: 
      // Si ya estaba conectado, usamos un radio mayor (1.5x) para desconectar.
      // Esto evita que la conexión oscile cuando se está en el borde.
      const threshold = wasInCall ? userProximityRadius * 1.5 : userProximityRadius;
      
      const inProximity = dist < threshold;
      
      if (inProximity) {
         nextConnectedUsers.add(u.id);
         // Log solo al entrar
         if (!wasInCall) {
           console.log(`[PROXIMITY ENTER] User ${u.name} entered. Dist: ${dist.toFixed(1)} < ${userProximityRadius}`);
           // Cerrar card flotante si el usuario seleccionado entra en proximidad
           if (selectedRemoteUser?.id === u.id) setSelectedRemoteUser(null);
         }
      } else if (wasInCall) {
         console.log(`[PROXIMITY EXIT] User ${u.name} exited. Dist: ${dist.toFixed(1)} > ${threshold.toFixed(1)} (Radius: ${userProximityRadius})`);
      }
      
      return inProximity;
    });
    
    // Si no hay nadie cerca y estoy compartiendo pantalla, detener
    if (users.length === 0 && currentUser.isScreenSharing) {
       console.log('No users in proximity, stopping screen share automatically');
       // Usamos setTimeout para no bloquear el render actual
       setTimeout(() => {
          handleToggleScreenShare();
       }, 0);
    }
    
    connectedUsersRef.current = nextConnectedUsers;
    return users;
  }, [usuariosEnChunks, stableProximityCoords.x, stableProximityCoords.y, session?.user?.id, currentUser.isScreenSharing, userProximityRadius, conversacionesBloqueadasRemoto]);

  const hasActiveCall = usersInCall.length > 0;
  hasActiveCallRef.current = hasActiveCall;
  // Set de IDs en proximidad — para controlar bubbles per-user (no bubble en proximidad, sí en rango espacial)
  const usersInCallIds = useMemo(() => new Set(usersInCall.map(u => u.id)), [usersInCall]);

  // Usuarios dentro del radio de audio espacial (más amplio que proximidad)
  // Permite que el audio se escuche por el pasillo hasta distancia media (estilo Gather)
  // NOTA: NO vaciar cuando spatialAudio está off — este array se usa para suscripciones LiveKit y routing de streams
  const usersInAudioRange = useMemo(() => {
    const audioRadius = userProximityRadius * AUDIO_SPATIAL_RADIUS_FACTOR;
    const idsEnProximidad = new Set(usersInCall.map(u => u.id));
    return usuariosEnChunks.filter(u => {
      if (u.id === session?.user?.id) return false;
      if (u.esFantasma) return false;
      if (idsEnProximidad.has(u.id)) return false; // Ya están en usersInCall
      if ((u.x === 0 && u.y === 0) || typeof u.x !== 'number' || typeof u.y !== 'number') return false;
      const dist = Math.sqrt(Math.pow(u.x - stableProximityCoords.x, 2) + Math.pow(u.y - stableProximityCoords.y, 2));
      return dist < audioRadius;
    });
  }, [usuariosEnChunks, stableProximityCoords.x, stableProximityCoords.y, session?.user?.id, userProximityRadius, usersInCall]);
  // Set de IDs en rango de audio espacial — cam bubbles SOLO para estos usuarios
  const usersInAudioRangeIds = useMemo(() => new Set(usersInAudioRange.map(u => u.id)), [usersInAudioRange]);

  // Sincronizar tracks locales cuando cambian mic/cam/screen (si hay alguien en proximidad O rango espacial)
  const hasAnyoneNearbyForSync = hasActiveCall || usersInAudioRange.length > 0;
  useEffect(() => {
    if (!USAR_LIVEKIT || !livekitConnected || !hasAnyoneNearbyForSync) return;
    console.log(`[LIVEKIT] Sincronizando tracks por cambio de estado — mic=${currentUser.isMicOn} cam=${currentUser.isCameraOn} screen=${currentUser.isScreenSharing} proximidad=${hasActiveCall} rangoEspacial=${usersInAudioRange.length > 0}`);
    sincronizarTracksLocales().catch((error) => {
      console.warn('Error sincronizando tracks LiveKit:', error);
    });
  }, [USAR_LIVEKIT, livekitConnected, hasAnyoneNearbyForSync, hasActiveCall, currentUser.isMicOn, currentUser.isCameraOn, currentUser.isScreenSharing, stream, screenStream, sincronizarTracksLocales]);

  // Calcular distancias de usuarios para audio espacial
  const userDistances = useMemo(() => {
    const distances = new Map<string, number>();
    usersInCall.forEach(u => {
      const dist = Math.sqrt(Math.pow(u.x - currentUserEcs.x, 2) + Math.pow(u.y - currentUserEcs.y, 2));
      distances.set(u.id, dist);
    });
    return distances;
  }, [usersInCall, currentUserEcs.x, currentUserEcs.y]);

  const maxVideoStreams = useMemo(() => {
    const limite = Number(performanceSettings.maxVideoStreams ?? 8);
    return Number.isFinite(limite) ? Math.max(1, limite) : 8;
  }, [performanceSettings.maxVideoStreams]);

  const prioritizedVideoIds = useMemo(() => {
    const inCallIds = usersInCall.map((u) => u.id);
    const audioRangeIds = usersInAudioRange.map((u) => u.id);
    const speakingFirst = inCallIds.filter((id) => speakingUsers.has(id));
    const rest = inCallIds.filter((id) => !speakingUsers.has(id));

    rest.sort((a, b) => {
      const distA = userDistances.get(a) ?? Number.MAX_SAFE_INTEGER;
      const distB = userDistances.get(b) ?? Number.MAX_SAFE_INTEGER;
      return distA - distB;
    });

    // Incluir usuarios en rango espacial (cam bubble + audio a distancia media)
    return Array.from(new Set([...speakingFirst, ...rest, ...audioRangeIds]));
  }, [usersInCall, usersInAudioRange, speakingUsers, userDistances]);

  const allowedVideoIds = useMemo(() => {
    const screenIds = new Set<string>();
    remoteScreenStreams.forEach((stream, id) => {
      if (stream?.getVideoTracks().length) {
        screenIds.add(id);
      }
    });

    const allowed = new Set<string>(screenIds);
    // Límite base + rango espacial (cam bubbles a distancia no cuentan contra el límite principal)
    const limite = maxVideoStreams + screenIds.size + usersInAudioRange.length;
    prioritizedVideoIds.forEach((id) => {
      if (allowed.size >= limite) return;
      allowed.add(id);
    });
    return allowed;
  }, [maxVideoStreams, prioritizedVideoIds, remoteScreenStreams, usersInAudioRange.length]);

  const remoteStreamsRouted = useMemo(() => {
    const next = new Map<string, MediaStream>();
    remoteStreams.forEach((stream, id) => {
      if (allowedVideoIds.has(id)) {
        next.set(id, stream);
      }
    });
    return next;
  }, [remoteStreams, allowedVideoIds]);

  const remoteScreenStreamsRouted = useMemo(() => {
    const next = new Map<string, MediaStream>();
    remoteScreenStreams.forEach((stream, id) => {
      if (allowedVideoIds.has(id)) {
        next.set(id, stream);
      }
    });
    return next;
  }, [remoteScreenStreams, allowedVideoIds]);

  // (Estados de privacidad movidos antes de usersInCall — ver línea ~3697)

  // === SUSCRIPCIÓN SELECTIVA — PATRÓN LIVEKIT BEST PRACTICE (setEnabled vs setSubscribed) ===
  // Docs: https://docs.livekit.io/transport/media/subscribe/#enabling-disabling-tracks
  // "Subscribing requires a negotiation handshake with the LiveKit server, while enable/disable does not.
  //  This can make enable/disable more efficient, especially when a track may be turned on or off frequently."
  //
  // Patrón (estilo Gather/LiveKit HQ):
  //   SUBSCRIBE (1 vez) al entrar en rango amplio → negociación SDP única
  //   setEnabled(true/false) al cruzar bordes de proximidad → instantáneo, sin negociación
  //   UNSUBSCRIBE solo al salir de TODOS los rangos (con 5s debounce) → raro
  //
  // Nivel 1: Proximidad (usersInCall) → ALL tracks enabled (conversación completa)
  // Nivel 2: Audio range (usersInAudioRange) → ALL tracks enabled (cam bubble + spatial audio)
  // Fuera de rangos → tracks disabled → luego unsubscribe tras 5s
  const livekitSubscribedIdsRef = useRef<Set<string>>(new Set());
  const livekitAudioOnlyIdsRef = useRef<Set<string>>(new Set());
  const pendingUnsubscribeTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  // Set de IDs que están suscritos a nivel de transporte (setSubscribed), independiente de enabled/disabled
  const livekitTransportSubscribedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!USAR_LIVEKIT || !livekitConnected) return;
    const room = livekitRoomRef.current;
    if (!room) return;

    const idsEnProximidad = new Set(usersInCall.map(u => u.id));
    const idsEnAudioRange = new Set(usersInAudioRange.map(u => u.id));
    const idsPreviosProximidad = livekitSubscribedIdsRef.current;
    const idsPreviosAudio = livekitAudioOnlyIdsRef.current;
    const idsTransportSuscritos = livekitTransportSubscribedRef.current;

    // Check: ¿Hay alguna conversación bloqueada que me excluya?
    const idsBloqueados = new Set<string>();
    conversacionesBloqueadasRemoto.forEach((participants, lockerId) => {
      if (!session?.user?.id || participants.includes(session.user.id)) return;
      participants.forEach(pid => idsBloqueados.add(pid));
      idsBloqueados.add(lockerId);
    });

    // Todos los IDs actualmente en algún rango
    const idsEnAlgunRango = new Set([...idsEnProximidad, ...idsEnAudioRange]);

    // === PASO 1: SUBSCRIBE nuevos (solo 1 vez por usuario — negociación SDP) ===
    idsEnAlgunRango.forEach(userId => {
      if (idsBloqueados.has(userId)) return;
      const participant = room.getParticipantByIdentity(userId);
      if (!participant) return;

      // Cancelar pending unsubscribe si existe
      const pendingTimer = pendingUnsubscribeTimersRef.current.get(userId);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingUnsubscribeTimersRef.current.delete(userId);
        console.log(`[LIVEKIT] Cancelado unsubscribe pendiente de ${userId} (volvió a rango)`);
      }

      // Subscribe tracks que no están suscritos (SDP negociación — solo la primera vez)
      let subsCount = 0;
      participant.trackPublications.forEach(pub => {
        if (pub instanceof RemoteTrackPublication && !pub.isSubscribed) {
          pub.setSubscribed(true);
          subsCount++;
        }
      });

      // Enable ALL tracks para usuarios en rango (rápido, sin negociación)
      participant.trackPublications.forEach(pub => {
        if (pub instanceof RemoteTrackPublication && pub.isSubscribed && !pub.isEnabled) {
          pub.setEnabled(true);
        }
      });

      if (subsCount > 0 || !idsTransportSuscritos.has(userId)) {
        const isNewEntry = !idsPreviosProximidad.has(userId) && !idsPreviosAudio.has(userId);
        console.log(`[LIVEKIT SUBSCRIBE] ${userId} — ${subsCount} tracks${isNewEntry ? ' (nueva entrada)' : ' (re-check)'}${idsEnProximidad.has(userId) ? ' [proximidad]' : ' [rango espacial]'}`);
      }
      idsTransportSuscritos.add(userId);
    });

    // === PASO 2: DISABLE/ENABLE por nivel (sin negociación SDP — instantáneo) ===
    // Downgrade: estaba en proximidad, ahora solo en audio range → video sigue enabled (cam bubble)
    // En nuestro diseño, ambos niveles mantienen todos los tracks enabled (cam bubble visible a distancia)
    // Solo se diferencian en la lógica del HUD/VideoHUD, no en el transporte

    // === PASO 3: Salió de TODOS los rangos → disable inmediato + unsubscribe diferido ===
    idsTransportSuscritos.forEach(userId => {
      if (idsEnAlgunRango.has(userId)) return; // Aún en rango, no tocar

      const participant = room.getParticipantByIdentity(userId);
      if (participant) {
        // DISABLE inmediato — sin negociación, corta el flujo de datos al instante
        participant.trackPublications.forEach(pub => {
          if (pub instanceof RemoteTrackPublication && pub.isSubscribed && pub.isEnabled) {
            pub.setEnabled(false);
          }
        });
      }

      // Programar UNSUBSCRIBE con 5s de gracia (la negociación SDP es costosa)
      if (!pendingUnsubscribeTimersRef.current.has(userId)) {
        console.log(`[LIVEKIT] ${userId} fuera de rango — disabled (instantáneo), unsubscribe en 5s`);
        const timer = setTimeout(() => {
          pendingUnsubscribeTimersRef.current.delete(userId);
          // Re-verificar: si volvió a entrar durante los 5s, no desuscribir
          if (livekitSubscribedIdsRef.current.has(userId) || livekitAudioOnlyIdsRef.current.has(userId)) {
            console.log(`[LIVEKIT] Unsubscribe cancelado — ${userId} volvió a rango durante gracia`);
            // Re-enable tracks
            const p = room.getParticipantByIdentity(userId);
            if (p) {
              p.trackPublications.forEach(pub => {
                if (pub instanceof RemoteTrackPublication && pub.isSubscribed && !pub.isEnabled) {
                  pub.setEnabled(true);
                }
              });
            }
            return;
          }
          // Confirmar unsubscribe (negociación SDP — pero es raro llegar aquí)
          const p = room.getParticipantByIdentity(userId);
          if (p) {
            p.trackPublications.forEach(pub => {
              if (pub instanceof RemoteTrackPublication && pub.isSubscribed) {
                pub.setSubscribed(false);
              }
            });
            console.log(`[LIVEKIT UNSUBSCRIBE] ${userId} — tracks desuscritos (confirmado fuera de rangos tras 5s)`);
          }
          idsTransportSuscritos.delete(userId);
        }, 5000);
        pendingUnsubscribeTimersRef.current.set(userId, timer);
      }
    });

    livekitSubscribedIdsRef.current = idsEnProximidad;
    livekitAudioOnlyIdsRef.current = idsEnAudioRange;
  }, [USAR_LIVEKIT, livekitConnected, usersInCall, usersInAudioRange, conversacionesBloqueadasRemoto]);

  // Suscribir tracks nuevos de participantes ya en proximidad o rango de audio
  useEffect(() => {
    if (!USAR_LIVEKIT || !livekitConnected) return;
    const room = livekitRoomRef.current;
    if (!room) return;

    const handleTrackPublished = (publication: any, participant: any) => {
      if (!participant) return;
      const enProximidad = livekitSubscribedIdsRef.current.has(participant.identity);
      const enAudioRange = livekitAudioOnlyIdsRef.current.has(participant.identity);
      if ((enProximidad || enAudioRange) && !publication.isSubscribed) {
        publication.setSubscribed(true);
        livekitTransportSubscribedRef.current.add(participant.identity);
        console.log(`[LIVEKIT SUBSCRIBE] Nuevo track de ${participant.identity} suscrito${enProximidad ? ' (proximidad)' : ' (rango espacial)'}`);
      }
    };

    room.on(RoomEvent.TrackPublished, handleTrackPublished);
    return () => {
      room.off(RoomEvent.TrackPublished, handleTrackPublished);
    };
  }, [USAR_LIVEKIT, livekitConnected]);

  // Despublicar tracks locales cuando no hay nadie en proximidad NI en rango de audio
  const hasAnyoneNearby = hasActiveCall || usersInAudioRange.length > 0;
  const prevHasAnyoneNearbyRef = useRef(false);
  const prevHasActiveCallRef = useRef(false);
  const publishDelayTimerRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!USAR_LIVEKIT || !livekitConnected) return;
    const room = livekitRoomRef.current;
    if (!room) return;

    // Capturar valores previos ANTES de actualizar refs (evita early-return bug)
    const prevHasAnyoneNearby = prevHasAnyoneNearbyRef.current;
    const prevHasActiveCall = prevHasActiveCallRef.current;
    prevHasAnyoneNearbyRef.current = hasAnyoneNearby;
    prevHasActiveCallRef.current = hasActiveCall;

    if (!hasAnyoneNearby && prevHasAnyoneNearby) {
      // Salieron todos de proximidad Y rango de audio → despublicar todo
      if (publishDelayTimerRef.current) { clearTimeout(publishDelayTimerRef.current); publishDelayTimerRef.current = null; }
      ['audio', 'video', 'screen'].forEach(tipo => {
        despublicarTrackLocal(tipo as 'audio' | 'video' | 'screen').catch(() => {});
      });
      console.log('[LIVEKIT] Sin usuarios cercanos — tracks locales despublicados');
    } else if (!hasActiveCall && prevHasActiveCall && usersInAudioRange.length > 0) {
      // Salieron de proximidad pero quedan en rango audio → mantener video (cam bubble) + audio
      // Solo despublicar screen share (no tiene sentido a distancia)
      if (publishDelayTimerRef.current) { clearTimeout(publishDelayTimerRef.current); publishDelayTimerRef.current = null; }
      despublicarTrackLocal('screen').catch(() => {});
      console.log('[LIVEKIT] Sin proximidad pero con rango audio — video+audio mantenidos (cam bubble), screen despublicado');
    } else if (hasActiveCall && !prevHasActiveCall) {
      // Alguien entró en proximidad → publicar tracks locales con delay corto para estabilidad
      if (publishDelayTimerRef.current) clearTimeout(publishDelayTimerRef.current);
      publishDelayTimerRef.current = setTimeout(() => {
        publishDelayTimerRef.current = null;
        if (livekitRoomRef.current?.state === 'connected') {
          sincronizarTracksLocales().catch(() => {});
          console.log('[LIVEKIT] Usuario en proximidad — sincronizando tracks locales (post-delay)');
        } else {
          console.log('[LIVEKIT] Room no está connected, esperando...');
        }
      }, 500);
    } else if (hasAnyoneNearby && !prevHasAnyoneNearby && !hasActiveCall) {
      // Alguien entró en rango espacial → publicar audio + video (cam bubble + audio espacial)
      if (publishDelayTimerRef.current) clearTimeout(publishDelayTimerRef.current);
      publishDelayTimerRef.current = setTimeout(() => {
        publishDelayTimerRef.current = null;
        if (livekitRoomRef.current?.state === 'connected') {
          sincronizarTracksLocales().catch(() => {});
          console.log('[LIVEKIT] Usuario en rango espacial — sincronizando tracks (cam bubble + audio espacial)');
        }
      }, 500);
    }

    return () => {
      if (publishDelayTimerRef.current) { clearTimeout(publishDelayTimerRef.current); publishDelayTimerRef.current = null; }
    };
  }, [USAR_LIVEKIT, livekitConnected, hasActiveCall, hasAnyoneNearby, usersInAudioRange.length, despublicarTrackLocal, sincronizarTracksLocales, stream, publicarTrackLocal]);

  // Re-publicar video cuando effectiveStream cambia (blur, fondo, etc.)
  const prevEffectiveStreamRef = useRef<MediaStream | null>(null);
  useEffect(() => {
    if (!USAR_LIVEKIT || !livekitConnected || !hasActiveCall || !currentUser.isCameraOn) return;
    const room = livekitRoomRef.current;
    if (!room || room.state !== 'connected') return;
    // Evitar republicar si el stream no cambió realmente
    if (effectiveStream === prevEffectiveStreamRef.current) return;
    // Si hay efecto activo pero processedStream aún no está listo, esperar
    if (cameraSettings.backgroundEffect !== 'none' && !processedStream) {
      console.log('[LIVEKIT] Esperando processedStream para efecto:', cameraSettings.backgroundEffect);
      return;
    }

    const debounce = setTimeout(async () => {
      const videoTrack = effectiveStream?.getVideoTracks().find(t => t.readyState === 'live');
      if (videoTrack) {
        try {
          await publicarTrackLocal(videoTrack, 'video');
          prevEffectiveStreamRef.current = effectiveStream;
          console.log('[LIVEKIT] Video track re-publicado tras cambio de efecto');
        } catch (e) {
          console.error('[LIVEKIT] Error re-publicando video track:', e);
        }
      } else {
        console.log('[LIVEKIT] effectiveStream no tiene video track live, skipping');
      }
    }, 800);
    return () => clearTimeout(debounce);
  }, [USAR_LIVEKIT, livekitConnected, effectiveStream, processedStream, hasActiveCall, currentUser.isCameraOn, cameraSettings.backgroundEffect, publicarTrackLocal]);

  // Speaker detection - analizar nivel de audio
  useEffect(() => {
    if (USAR_LIVEKIT || !stream) return;
    
    // Crear AudioContext si no existe
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    
    const audioContext = audioContextRef.current;
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    const checkAudioLevel = () => {
      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      
      // Si el promedio es mayor a 30, el usuario local está hablando
      setSpeakingUsers(prev => {
        const newSet = new Set(prev);
        if (average > 30 && session?.user?.id) {
          newSet.add(session.user.id);
        } else if (session?.user?.id) {
          newSet.delete(session.user.id);
        }
        return newSet;
      });
    };
    
    const intervalId = setInterval(checkAudioLevel, 100);
    
    return () => {
      clearInterval(intervalId);
      source.disconnect();
    };
  }, [stream, session?.user?.id]);
  
  // Audio espacial - ajustar volumen según distancia (solo si spatialAudio está activado)
  useEffect(() => {
    if (USAR_LIVEKIT) return;
    remoteStreams.forEach((remoteStream, oderId) => {
      let volume = 1;
      if (space3dSettings.spatialAudio) {
        const distance = userDistances.get(oderId) || PROXIMITY_RADIUS;
        volume = Math.max(0.1, 1 - (distance / userProximityRadius));
      }
      
      // Aplicar volumen a los elementos de audio
      const audioElements = document.querySelectorAll(`video[data-user-id="${oderId}"]`);
      audioElements.forEach(el => {
        (el as HTMLVideoElement).volume = volume;
      });
    });
  }, [USAR_LIVEKIT, remoteStreams, userDistances, userProximityRadius, space3dSettings.spatialAudio]);
  
  const enviarDataLivekit = useCallback((mensaje: { type: string; payload: Record<string, any> }, reliable = true) => {
    if (!USAR_LIVEKIT) return false;
    const room = livekitRoomRef.current;
    if (!room) return false;
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(mensaje));
    room.localParticipant.publishData(data, { reliable }).catch((error) => {
      console.warn('Error enviando data LiveKit:', error);
    });
    return true;
  }, [USAR_LIVEKIT]);

  const manejarEventoInstantaneo = useCallback((mensaje: { type: string; payload: any }) => {
    if (!mensaje?.type || !mensaje.payload || !session?.user?.id) return;

    if (mensaje.type === 'reaction') {
      if (mensaje.payload.from === session.user.id) return;
      setRemoteReaction({ emoji: mensaje.payload.emoji, from: mensaje.payload.from, fromName: mensaje.payload.fromName });
      setTimeout(() => setRemoteReaction(null), 2000);
      return;
    }

    if (mensaje.type === 'wave') {
      if (mensaje.payload.from === session.user.id) return;
      if (mensaje.payload.to && mensaje.payload.to !== session.user.id) return;
      // Dedup: ignorar si ya recibimos un wave del mismo usuario en los últimos 500ms (dual-channel)
      const dedupKey = `wave_${mensaje.payload.from}`;
      const now = Date.now();
      if (now - (lastInteractionRef.current.get(dedupKey) || 0) < 500) return;
      lastInteractionRef.current.set(dedupKey, now);
      playWaveSound();
      setIncomingWave({ from: mensaje.payload.from, fromName: mensaje.payload.fromName });
      setTimeout(() => setIncomingWave(null), 4000);
      sendDesktopNotification(`👋 ${mensaje.payload.fromName}`, 'te está saludando');
      return;
    }

    if (mensaje.type === 'chat') {
      if (mensaje.payload.from === session.user.id) return;
      setRemoteMessages(prev => {
        const newMap = new Map(prev);
        newMap.set(mensaje.payload.from, mensaje.payload.message);
        return newMap;
      });

      const ns = getSettingsSection('notifications');
      if (ns.newMessageSound) {
        sendDesktopNotification(`💬 ${mensaje.payload.fromName}`, mensaje.payload.message);
      }
      if (ns.mentionNotifications && mensaje.payload.message?.includes(`@${currentUser.name}`)) {
        sendDesktopNotification(`📢 Mención de ${mensaje.payload.fromName}`, mensaje.payload.message);
      }

      setTimeout(() => {
        setRemoteMessages(prev => {
          const newMap = new Map(prev);
          newMap.delete(mensaje.payload.from);
          return newMap;
        });
      }, 5000);
      return;
    }

    if (mensaje.type === 'nudge') {
      if (mensaje.payload.from === session.user.id) return;
      if (mensaje.payload.to && mensaje.payload.to !== session.user.id) return;
      const dedupKey = `nudge_${mensaje.payload.from}`;
      const now = Date.now();
      if (now - (lastInteractionRef.current.get(dedupKey) || 0) < 500) return;
      lastInteractionRef.current.set(dedupKey, now);
      playNudgeSound();
      setIncomingNudge({ from: mensaje.payload.from, fromName: mensaje.payload.fromName });
      setTimeout(() => setIncomingNudge(null), 4000);
      sendDesktopNotification(`👋 ${mensaje.payload.fromName}`, 'quiere tu atención');
      return;
    }

    if (mensaje.type === 'invite') {
      if (mensaje.payload.from === session.user.id) return;
      if (mensaje.payload.to && mensaje.payload.to !== session.user.id) return;
      const dedupKey = `invite_${mensaje.payload.from}`;
      const now = Date.now();
      if (now - (lastInteractionRef.current.get(dedupKey) || 0) < 500) return;
      lastInteractionRef.current.set(dedupKey, now);
      playInviteSound();
      setIncomingInvite({
        from: mensaje.payload.from,
        fromName: mensaje.payload.fromName,
        x: mensaje.payload.x,
        y: mensaje.payload.y,
      });
      sendDesktopNotification(`📍 ${mensaje.payload.fromName}`, 'te invita a unirte');
      return;
    }

    if (mensaje.type === 'lock_conversation') {
      if (mensaje.payload.by === session.user.id) return;
      const soyParticipante = mensaje.payload.participants?.includes(session.user.id);
      if (mensaje.payload.locked) {
        // Si soy participante de la conversación, espejar el lock en mi UI
        if (soyParticipante) setConversacionBloqueada(true);
        setConversacionesBloqueadasRemoto(prev => {
          const next = new Map(prev);
          next.set(mensaje.payload.by, mensaje.payload.participants || []);
          return next;
        });
      } else {
        if (soyParticipante) setConversacionBloqueada(false);
        setConversacionesBloqueadasRemoto(prev => {
          const next = new Map(prev);
          next.delete(mensaje.payload.by);
          return next;
        });
      }
      return;
    }

    if (mensaje.type === 'movement') {
      if (mensaje.payload.id === session.user.id) return;
      if (!usuariosVisiblesRef.current.has(mensaje.payload.id)) return;
      // No filtrar por chunk — usuarios de misma empresa ya están en usuariosEnChunks
      // El chunk filter aquí bloqueaba datos de movimiento de compañeros lejanos
      realtimePositionsRef.current.set(mensaje.payload.id, {
        x: mensaje.payload.x,
        y: mensaje.payload.y,
        direction: mensaje.payload.direction,
        isMoving: mensaje.payload.isMoving,
        animState: mensaje.payload.animState || (mensaje.payload.isMoving ? 'walk' : 'idle'),
        timestamp: Date.now(), // Usar hora de recepción para evitar problemas de clock skew
      });
      actualizarEstadoUsuarioEcs(
        ecsStateRef.current,
        mensaje.payload.id,
        mensaje.payload.x / 16,
        mensaje.payload.y / 16,
        mensaje.payload.direction,
        mensaje.payload.isMoving
      );
    }
  }, [session?.user?.id, currentUser.name]);

  useEffect(() => {
    if (!USAR_LIVEKIT || !livekitConnected) return;
    const room = livekitRoomRef.current;
    if (!room) return;

    const manejarData = (payload: Uint8Array) => {
      try {
        const decoder = new TextDecoder();
        const mensaje = JSON.parse(decoder.decode(payload));
        manejarEventoInstantaneo(mensaje);
      } catch (error) {
        console.warn('Error parseando DataChannel LiveKit:', error);
      }
    };

    room.on(RoomEvent.DataReceived, manejarData);
    return () => {
      room.off(RoomEvent.DataReceived, manejarData);
    };
  }, [USAR_LIVEKIT, livekitConnected, manejarEventoInstantaneo]);

  // Función para bloquear/desbloquear conversación de proximidad (patrón Gather: locked conversation)
  const bloquearConversacion = useCallback(() => {
    const newLocked = !conversacionBloqueada;
    setConversacionBloqueada(newLocked);
    const participantIds = [session?.user?.id, ...usersInCall.map(u => u.id)].filter(Boolean) as string[];
    const payload = { locked: newLocked, by: session?.user?.id, participants: participantIds };
    // Broadcast via LiveKit data channel
    enviarDataLivekit({ type: 'lock_conversation', payload });
    // Fallback: broadcast via Realtime
    if (webrtcChannelRef.current) {
      webrtcChannelRef.current.send({ type: 'broadcast', event: 'lock_conversation', payload });
    }
    console.log(`[LOCK] Conversación ${newLocked ? 'bloqueada' : 'desbloqueada'} — participantes:`, participantIds);
  }, [conversacionBloqueada, session?.user?.id, usersInCall, enviarDataLivekit]);

  // Check: ¿El usuario actual está intentando acercarse a una conversación bloqueada?
  const conversacionProximaBloqueada = useMemo(() => {
    if (!session?.user?.id || conversacionesBloqueadasRemoto.size === 0) return null;
    for (const [lockerId, participants] of conversacionesBloqueadasRemoto) {
      // Si yo soy participante, no estoy bloqueado
      if (participants.includes(session.user.id)) continue;
      // Si alguno de los usuarios en mi proximidad es participante de esta conversación bloqueada
      const usuarioBloqueado = usersInCall.find(u => participants.includes(u.id) || u.id === lockerId);
      if (usuarioBloqueado) {
        return { lockerId, participants, nombre: usuarioBloqueado.name };
      }
    }
    return null;
  }, [conversacionesBloqueadasRemoto, usersInCall, session?.user?.id]);

  // Función para enviar wave a un usuario
  const handleWaveUser = useCallback((userId: string) => {
    const payload = { to: userId, from: session?.user?.id, fromName: currentUser.name };
    // Enviar por LiveKit (si hay conexión activa)
    enviarDataLivekit({ type: 'wave', payload });
    // SIEMPRE enviar por Realtime (canal global) para garantizar entrega
    if (webrtcChannelRef.current && session?.user?.id) {
      webrtcChannelRef.current.send({ type: 'broadcast', event: 'wave', payload });
    }
  }, [enviarDataLivekit, session?.user?.id, currentUser.name]);

  // === INTERACCIONES GATHER-STYLE (Fases 1-5) ===

  // Fase 1: Clic en avatar remoto → abrir Profile Popup
  const handleClickRemoteAvatar = useCallback((userId: string) => {
    const user = usuariosEnChunks.find(u => u.id === userId);
    if (user) setSelectedRemoteUser(user);
  }, [usuariosEnChunks]);

  // Fase 2: Go to — Teleport al usuario seleccionado
  const handleGoToUser = useCallback((userId: string) => {
    const ecsData = obtenerEstadoUsuarioEcs(ecsStateRef.current, userId);
    let targetX: number, targetZ: number;
    if (ecsData && Date.now() - (ecsData.timestamp ?? 0) <= 3000) {
      targetX = ecsData.x;
      targetZ = ecsData.z;
    } else {
      const user = usuariosEnChunks.find(u => u.id === userId);
      if (!user) return;
      targetX = user.x / 16;
      targetZ = user.y / 16;
    }
    // Teleport a 2 unidades al lado del usuario (no encima)
    setTeleportTarget({ x: targetX + 1.5, z: targetZ + 1.5 });
    setSelectedRemoteUser(null);
    grantXP('teleport', 5000);
  }, [usuariosEnChunks, grantXP]);

  // Fase 3: Nudge — Enviar notificación sonora al usuario
  const handleNudgeUser = useCallback((userId: string) => {
    const payload = { to: userId, from: session?.user?.id, fromName: currentUser.name };
    enviarDataLivekit({ type: 'nudge', payload });
    if (webrtcChannelRef.current && session?.user?.id) {
      webrtcChannelRef.current.send({ type: 'broadcast', event: 'nudge', payload });
    }
  }, [enviarDataLivekit, session?.user?.id, currentUser.name]);

  // Fase 4: Invite to join me — Enviar invitación para que el otro se teleporte a mi posición
  const handleInviteUser = useCallback((userId: string) => {
    const payload = {
      to: userId,
      from: session?.user?.id,
      fromName: currentUser.name,
      x: currentUserEcs.x,
      y: currentUserEcs.y,
    };
    enviarDataLivekit({ type: 'invite', payload });
    if (webrtcChannelRef.current && session?.user?.id) {
      webrtcChannelRef.current.send({ type: 'broadcast', event: 'invite', payload });
    }
  }, [enviarDataLivekit, session?.user?.id, currentUser.name, currentUserEcs.x, currentUserEcs.y]);

  // Fase 4b: Aceptar invitación recibida
  const handleAcceptInvite = useCallback(() => {
    if (!incomingInvite) return;
    setTeleportTarget({ x: incomingInvite.x / 16 + 1.5, z: incomingInvite.y / 16 + 1.5 });
    setIncomingInvite(null);
    grantXP('teleport', 5000);
  }, [incomingInvite, grantXP]);

  // Fase 5: Follow mode — Seguir automáticamente al usuario
  const handleFollowUser = useCallback((userId: string) => {
    if (followTargetId === userId) {
      // Ya lo estoy siguiendo → dejar de seguir
      setFollowTargetId(null);
      followTargetIdRef.current = null;
    } else {
      setFollowTargetId(userId);
      followTargetIdRef.current = userId;
    }
    setSelectedRemoteUser(null);
  }, [followTargetId]);

  // Fase 5: Follow mode — useEffect que mueve al jugador hacia el target
  useEffect(() => {
    if (!followTargetId) return;
    const interval = setInterval(() => {
      const targetId = followTargetIdRef.current;
      if (!targetId) return;
      const ecsData = obtenerEstadoUsuarioEcs(ecsStateRef.current, targetId);
      if (!ecsData || Date.now() - (ecsData.timestamp ?? 0) > 5000) {
        // Target desconectado o sin datos frescos → dejar de seguir
        setFollowTargetId(null);
        followTargetIdRef.current = null;
        return;
      }
      const myX = (currentUserEcs.x || 400) / 16;
      const myZ = (currentUserEcs.y || 400) / 16;
      const dx = ecsData.x - myX;
      const dz = ecsData.z - myZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
      // Solo mover si estamos a más de 3 unidades de distancia (no pegarse encima)
      if (dist > 3) {
        // Mover hacia el target pero quedarse a 2 unidades de distancia
        const ratio = (dist - 2) / dist;
        setMoveTarget({ x: myX + dx * ratio, z: myZ + dz * ratio });
      }
    }, 800);
    return () => clearInterval(interval);
  }, [followTargetId, currentUserEcs.x, currentUserEcs.y]);

  // Sync followTargetIdRef
  useEffect(() => {
    followTargetIdRef.current = followTargetId;
  }, [followTargetId]);

  // Cancelar follow si el usuario se mueve manualmente (teclas WASD)
  useEffect(() => {
    if (!followTargetId) return;
    const cancelFollow = (e: KeyboardEvent) => {
      if (['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        setFollowTargetId(null);
        followTargetIdRef.current = null;
      }
    };
    window.addEventListener('keydown', cancelFollow);
    return () => window.removeEventListener('keydown', cancelFollow);
  }, [followTargetId]);

  // Objeto de interacciones Gather-style para pasar a avatares remotos (Fases A-C)
  const avatarInteractionsMemo = useMemo(() => ({
    onGoTo: handleGoToUser,
    onNudge: handleNudgeUser,
    onInvite: handleInviteUser,
    onFollow: handleFollowUser,
    onWave: handleWaveUser,
    followTargetId,
    profilePhoto: null as string | null,
  }), [handleGoToUser, handleNudgeUser, handleInviteUser, handleFollowUser, handleWaveUser, followTargetId]);

  // Función para broadcast de movimiento (alta frecuencia)
  const webrtcChannelSubscribedRef = useRef(false);
  const lastMovementSentRef = useRef(0);
  const broadcastMovement = useCallback((x: number, y: number, direction: string, isMoving: boolean, animState?: string, reliable: boolean = false) => {
    const now = Date.now();
    // Permitir broadcast inmediato si es reliable (cambio de estado importante), sino respetar throttle
    if (!reliable && now - lastMovementSentRef.current < MOVEMENT_BROADCAST_MS) return;
    
    lastMovementSentRef.current = now;
    if (session?.user?.id) {
      actualizarEstadoUsuarioEcs(ecsStateRef.current, session.user.id, x / 16, y / 16, direction, isMoving);
    }
    if (enviarDataLivekit({
      type: 'movement',
      payload: {
        id: session?.user?.id,
        x,
        y,
        direction,
        isMoving,
        animState: animState || (isMoving ? 'walk' : 'idle'),
        chunk: obtenerChunk(x, y).clave,
        timestamp: Date.now(),
      }
    }, reliable)) {
      return;
    }
    if (webrtcChannelRef.current && session?.user?.id && webrtcChannelSubscribedRef.current) {
      webrtcChannelRef.current.send({
        type: 'broadcast',
        event: 'movement',
        payload: { 
          id: session.user.id,
          x, 
          y, 
          direction, 
          isMoving,
          animState: animState || (isMoving ? 'walk' : 'idle'),
          chunk: obtenerChunk(x, y).clave,
          timestamp: Date.now()
        }
      });
    }
  }, [enviarDataLivekit, session?.user?.id]);

  useEffect(() => {
    if (!USAR_LIVEKIT) return;
    if (realtimeChunkManagerRef.current) {
      realtimeChunkManagerRef.current.destruir();
      realtimeChunkManagerRef.current = null;
    }
    webrtcChannelRef.current = null;
    webrtcChannelSubscribedRef.current = false;
    peerConnectionsRef.current.forEach(pc => pc.close());
    peerConnectionsRef.current.clear();
    peerVideoTrackCountRef.current.clear();
  }, [USAR_LIVEKIT]);

  // Proximidad: NO auto-activar mic/cam (patrón Gather — privacidad por defecto)
  // El usuario debe activar mic/cam manualmente para hablar
  useEffect(() => {
    if (hasActiveCall) {
      // Notificación desktop cuando alguien se acerca (sin auto-activar mic/cam)
      if (!proximidadNotificadaRef.current) {
        proximidadNotificadaRef.current = true;
        setProximidadNotificada(true);
        if (notifSettings.nearbyUserSound) {
          sendDesktopNotification('Usuario cercano', `${usersInCall[0]?.name || 'Alguien'} está cerca — activa mic/cam para hablar`);
        }
      }
    } else {
      if (currentUser.isPrivate) setPrivacy(false);
      if (conversacionBloqueada) setConversacionBloqueada(false);
      proximidadNotificadaRef.current = false;
      setProximidadNotificada(false);
      setConversacionesBloqueadasRemoto(new Map());
    }
  }, [hasActiveCall]);

  // Escuchar notificaciones de consentimiento aceptado (para el grabador)
  useEffect(() => {
    if (!session?.user?.id) return;

    const channel = supabase
      .channel('consentimiento_respuesta_grabador')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notificaciones',
          filter: `usuario_id=eq.${session.user.id}`,
        },
        (payload) => {
          const notif = payload.new as any;
          if (notif.tipo === 'consentimiento_respuesta' && notif.titulo?.includes('Aceptado')) {
            console.log('✅ Consentimiento aceptado por el evaluado');
            setConsentimientoAceptado(true);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id]);

  // Estado para trigger externo de grabación
  const [recordingTrigger, setRecordingTrigger] = useState(false);
  
  // Estado para UI
  const [showEmojis, setShowEmojis] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const [remoteMessages, setRemoteMessages] = useState<Map<string, string>>(new Map());

  // Manejar tecla Escape global para cerrar chat y emojis
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // No activar si está escribiendo
      const activeEl = document.activeElement;
      const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
      if (isTyping) return;
      
      // Escape cierra chat, emojis y status picker
      if (e.key === 'Escape') {
        setShowChat(false);
        setShowEmojis(false);
        setShowStatusPicker(false);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [showChat, showEmojis, showStatusPicker]);

  // Enviar mensaje de chat
  const handleSendMessage = useCallback(async () => {
    if (!chatInput.trim() || !session?.user?.id) return;
    
    const content = chatInput.trim();
    
    // 1. Mostrar mensaje localmente (burbuja)
    setLocalMessage(content);
    setTimeout(() => setLocalMessage(null), 5000);
    
    // 2. Broadcast a otros usuarios para burbuja
    if (!enviarDataLivekit({ type: 'chat', payload: { message: content, from: session.user.id, fromName: currentUser.name } })) {
      if (webrtcChannelRef.current) {
        webrtcChannelRef.current.send({
          type: 'broadcast',
          event: 'chat',
          payload: { message: content, from: session.user.id, fromName: currentUser.name }
        });
      }
    }
    
    // 3. Persistir mensaje (solo a usuarios cercanos en llamada)
    if (usersInCall.length > 0) {
      const recipientIds = usersInCall.map(u => u.id);
      await ChatService.sendMessage(content, session.user.id, activeWorkspace?.id || '', recipientIds);
    }
    
    // 4. XP por mensaje de chat (throttle 5s)
    grantXP('mensaje_chat', 5000);
    
    setChatInput('');
    setShowChat(false);
  }, [chatInput, session?.user?.id, currentUser.name, usersInCall, activeWorkspace?.id, enviarDataLivekit, grantXP]);

  // Toggle grabación
  const handleToggleRecording = useCallback(async () => {
    // Si estamos en modo headless, usamos el trigger
    if (!isRecording) {
      setRecordingTrigger(true);
    } else {
      setRecordingTrigger(true); // El mismo trigger sirve para toggle en el manager
    }
  }, [isRecording]);

  // Trigger reaction - permite múltiples emojis rápidos (estilo Gather)
  const handleTriggerReaction = useCallback((emoji: string) => {
    const reactionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Agregar nueva reacción al array
    setLocalReactions(prev => [...prev, { id: reactionId, emoji }]);
    
    // Remover esta reacción específica después de 1.5s (más snappy)
    setTimeout(() => {
      setLocalReactions(prev => prev.filter(r => r.id !== reactionId));
    }, 1500);
    
    // Enviar reacción a otros usuarios por el canal WebRTC
    if (!enviarDataLivekit({ type: 'reaction', payload: { emoji, from: session.user.id, fromName: currentUser.name } })) {
      if (webrtcChannelRef.current && session?.user?.id) {
        webrtcChannelRef.current.send({
          type: 'broadcast',
          event: 'reaction',
          payload: { emoji, from: session.user.id, fromName: currentUser.name }
        });
      }
    }
  }, [session?.user?.id, currentUser.name, enviarDataLivekit]);

  // Atajos de teclado numérico 1-8 para emojis rápidos
  useEffect(() => {
    const emojiKeys = ['👍', '🔥', '❤️', '👏', '😂', '😮', '🚀', '✨'];
    
    const handleNumericKeys = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
      if (isTyping) return;
      
      const num = parseInt(e.key);
      if (num >= 1 && num <= 8) {
        handleTriggerReaction(emojiKeys[num - 1]);
      }
    };
    
    window.addEventListener('keydown', handleNumericKeys);
    return () => window.removeEventListener('keydown', handleNumericKeys);
  }, [handleTriggerReaction]);

  // ========== WebRTC para video remoto ==========
  const createPeerConnection = useCallback((peerId: string) => {
    if (peerConnectionsRef.current.has(peerId)) return peerConnectionsRef.current.get(peerId)!;
    
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peerConnectionsRef.current.set(peerId, pc);

    pc.onicecandidate = (event) => {
      if (event.candidate && webrtcChannelRef.current) {
        webrtcChannelRef.current.send({
          type: 'broadcast', event: 'ice-candidate',
          payload: { candidate: event.candidate, to: peerId, from: session?.user?.id }
        });
      }
    };

    // Inicializar contador de video tracks para este peer
    peerVideoTrackCountRef.current.set(peerId, 0);
    
    pc.ontrack = (event) => {
      console.log('Received remote track from', peerId, 'kind:', event.track.kind, 'label:', event.track.label, 'streamId:', event.streams[0]?.id);
      const remoteStream = event.streams[0];
      const trackLabel = event.track.label.toLowerCase();
      
      // Detectar si es screen share por label (más confiable que contador)
      const isScreenShareByLabel = trackLabel.includes('screen') || 
         trackLabel.includes('display') ||
         trackLabel.includes('window') ||
         trackLabel.includes('monitor') ||
         trackLabel.includes('entire') ||
         trackLabel.includes('tab');
      
      if (event.track.kind === 'video') {
        // Usar detección por label como método principal
        if (isScreenShareByLabel) {
          console.log('Detected SCREEN SHARE from', peerId, '(by label)');
          setRemoteScreenStreams(prev => {
            const newMap = new Map(prev);
            newMap.set(peerId, remoteStream);
            return newMap;
          });
        } else {
          // Es cámara normal
          console.log('Detected CAMERA from', peerId);
          setRemoteStreams(prev => {
            const newMap = new Map(prev);
            newMap.set(peerId, remoteStream);
            return newMap;
          });
        }
      } else if (event.track.kind === 'audio') {
        // Audio track - agregar al stream existente o crear nuevo
        console.log('Detected AUDIO from', peerId);
        setRemoteStreams(prev => {
          const newMap = new Map(prev);
          const existingStream = newMap.get(peerId);
          if (existingStream) {
            return prev;
          }
          newMap.set(peerId, remoteStream);
          return newMap;
        });
      }
    };

    // Ref local para timeout de disconnected
    let disconnectTimeout: NodeJS.Timeout | null = null;
    
    pc.onconnectionstatechange = () => {
      console.log('Connection state with', peerId, ':', pc.connectionState);
      
      if (pc.connectionState === 'connected') {
        // Limpiar timeout si se reconectó
        if (disconnectTimeout) { clearTimeout(disconnectTimeout); disconnectTimeout = null; }
      } else if (pc.connectionState === 'disconnected') {
        // 'disconnected' es transitorio - dar 5s para recuperar antes de cerrar
        if (!disconnectTimeout) {
          disconnectTimeout = setTimeout(() => {
            if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
              console.log('Peer', peerId, 'still disconnected after 5s, closing');
              pc.close();
              peerConnectionsRef.current.delete(peerId);
              peerVideoTrackCountRef.current.delete(peerId);
              setRemoteStreams(prev => { const m = new Map(prev); m.delete(peerId); return m; });
              setRemoteScreenStreams(prev => { const m = new Map(prev); m.delete(peerId); return m; });
            }
            disconnectTimeout = null;
          }, 5000);
        }
      } else if (pc.connectionState === 'failed') {
        // 'failed' es definitivo - cerrar inmediatamente
        if (disconnectTimeout) { clearTimeout(disconnectTimeout); disconnectTimeout = null; }
        pc.close();
        peerConnectionsRef.current.delete(peerId);
        peerVideoTrackCountRef.current.delete(peerId);
        setRemoteStreams(prev => { const m = new Map(prev); m.delete(peerId); return m; });
        setRemoteScreenStreams(prev => { const m = new Map(prev); m.delete(peerId); return m; });
      }
    };

    if (activeStreamRef.current) {
      activeStreamRef.current.getTracks().forEach(track => pc.addTrack(track, activeStreamRef.current!));
    }
    // Agregar screen share si está activo
    if (activeScreenRef.current) {
      activeScreenRef.current.getTracks().forEach(track => pc.addTrack(track, activeScreenRef.current!));
    }

    return pc;
  }, [session?.user?.id]);

  const handleOffer = useCallback(async (offer: RTCSessionDescriptionInit, fromId: string) => {
    // Reutilizar conexión existente si existe (para renegociaciones)
    let pc = peerConnectionsRef.current.get(fromId);
    const isRenegotiation = !!pc;
    
    if (!pc) {
      pc = createPeerConnection(fromId);
    } else {
      // Si es renegociación, verificar que los tracks locales estén agregados
      const senders = pc.getSenders();
      const hasVideoSender = senders.some(s => s.track?.kind === 'video');
      const hasAudioSender = senders.some(s => s.track?.kind === 'audio');
      
      if (activeStreamRef.current && (!hasVideoSender || !hasAudioSender)) {
        console.log('Adding local tracks to existing connection for renegotiation with', fromId);
        activeStreamRef.current.getTracks().forEach(track => {
          const existingSender = senders.find(s => s.track?.kind === track.kind);
          if (!existingSender) {
            pc!.addTrack(track, activeStreamRef.current!);
          }
        });
      }
    }
    
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    if (webrtcChannelRef.current) {
      webrtcChannelRef.current.send({ type: 'broadcast', event: 'answer', payload: { answer, to: fromId, from: session?.user?.id } });
    }
    
    console.log(isRenegotiation ? 'Renegotiation completed with' : 'New connection established with', fromId);
  }, [createPeerConnection, session?.user?.id]);

  const handleAnswer = useCallback(async (answer: RTCSessionDescriptionInit, fromId: string) => {
    const pc = peerConnectionsRef.current.get(fromId);
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }, []);

  const handleIceCandidate = useCallback(async (candidate: RTCIceCandidateInit, fromId: string) => {
    const pc = peerConnectionsRef.current.get(fromId);
    if (pc) await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }, []);

  const initiateCall = useCallback(async (peerId: string) => {
    const pc = createPeerConnection(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (webrtcChannelRef.current) {
      webrtcChannelRef.current.send({ type: 'broadcast', event: 'offer', payload: { offer, to: peerId, from: session?.user?.id } });
    }
  }, [createPeerConnection, session?.user?.id]);

  // Broadcast por chunks (reemplaza canal global webrtc:workspaceId)
  useEffect(() => {
    if (USAR_LIVEKIT || !activeWorkspace?.id || !session?.user?.id) return;

    const manager = crearRealtimeChunkManager({
      espacioId: activeWorkspace.id,
      userId: session.user.id,
      onMessage: (evento: EventoRealtime, payload: Record<string, unknown>) => {
        const p = payload as any;
        if (evento === 'offer' && p.to === session.user.id) { handleOffer(p.offer, p.from); return; }
        if (evento === 'answer' && p.to === session.user.id) { handleAnswer(p.answer, p.from); return; }
        if (evento === 'ice-candidate' && p.to === session.user.id) { handleIceCandidate(p.candidate, p.from); return; }
        manejarEventoInstantaneo({ type: evento, payload: p });
      },
      onSubscriptionChange: (activos) => {
        webrtcChannelSubscribedRef.current = activos > 0;
      },
    });

    realtimeChunkManagerRef.current = manager;

    // Proxy para compatibilidad con webrtcChannelRef.current.send()
    webrtcChannelRef.current = {
      send: ({ event, payload }: { type?: string; event: string; payload: any }) => {
        manager.broadcast(event as EventoRealtime, payload);
      },
    };

    // Suscripción inicial al chunk actual + vecinos
    const chunk = obtenerChunk(currentUserEcs.x, currentUserEcs.y);
    const vecinos = obtenerChunksVecinos(chunk, radioInteresChunks);
    manager.actualizarChunk(chunk.clave, vecinos);

    return () => {
      manager.destruir();
      realtimeChunkManagerRef.current = null;
      webrtcChannelRef.current = null;
      webrtcChannelSubscribedRef.current = false;
      peerConnectionsRef.current.forEach(pc => pc.close());
      peerConnectionsRef.current.clear();
    };
  }, [USAR_LIVEKIT, activeWorkspace?.id, session?.user?.id, handleOffer, handleAnswer, handleIceCandidate, manejarEventoInstantaneo]);

  // Sincronizar suscripciones de chunk cuando el usuario se mueve
  useEffect(() => {
    if (!realtimeChunkManagerRef.current) return;
    const chunk = obtenerChunk(currentUserEcs.x, currentUserEcs.y);
    const vecinos = obtenerChunksVecinos(chunk, radioInteresChunks);
    realtimeChunkManagerRef.current.actualizarChunk(chunk.clave, vecinos);
  }, [currentUserEcs.x, currentUserEcs.y, radioInteresChunks]);

  // Ref para tracking de usuarios que deben ser desconectados (con debounce)
  const pendingDisconnectsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Limpiar conexiones cuando usuarios SALEN del espacio (con debounce de 3s para evitar cierres prematuros)
  useEffect(() => {
    if (USAR_LIVEKIT) return;
    const onlineUserIds = new Set(usuariosParaConexion.map(u => u.id));
    
    // Cancelar desconexiones pendientes para usuarios que volvieron a aparecer
    onlineUserIds.forEach(userId => {
      const timeout = pendingDisconnectsRef.current.get(userId);
      if (timeout) {
        clearTimeout(timeout);
        pendingDisconnectsRef.current.delete(userId);
        console.log('Cancelled pending disconnect for user who came back:', userId);
      }
    });
    
    // Programar desconexiones para usuarios que ya no están ONLINE
    peerConnectionsRef.current.forEach((pc, peerId) => {
      if (!onlineUserIds.has(peerId) && !pendingDisconnectsRef.current.has(peerId)) {
        console.log('Scheduling disconnect for user (5s delay):', peerId);
        const timeout = setTimeout(() => {
          // Verificar de nuevo si el usuario sigue sin estar online
          const stillMissing = !usuariosParaConexion.some(u => u.id === peerId);
          if (stillMissing && peerConnectionsRef.current.has(peerId)) {
            console.log('Closing connection with user who left space:', peerId);
            pc.close();
            peerConnectionsRef.current.delete(peerId);
            peerVideoTrackCountRef.current.delete(peerId);
            setRemoteStreams(prev => { const m = new Map(prev); m.delete(peerId); return m; });
            setRemoteScreenStreams(prev => { const m = new Map(prev); m.delete(peerId); return m; });
          }
          pendingDisconnectsRef.current.delete(peerId);
        }, 5000);
        pendingDisconnectsRef.current.set(peerId, timeout);
      }
    });
  }, [usuariosParaConexion]);

  // Iniciar llamadas con TODOS los usuarios online (no solo proximidad) - estilo Gather
  useEffect(() => {
    if (USAR_LIVEKIT || !session?.user?.id || !activeStreamRef.current || usuariosParaConexion.length === 0) return;
    
    usuariosParaConexion.forEach(user => {
      if (user.id === session.user.id) return; // No conectar consigo mismo
      
      // Usar hash numérico para comparación consistente
      const myIdHash = session.user.id.split('').reduce((a: number, b: string) => a + b.charCodeAt(0), 0);
      const theirIdHash = user.id.split('').reduce((a: number, b: string) => a + b.charCodeAt(0), 0);
      const shouldInitiate = myIdHash < theirIdHash || (myIdHash === theirIdHash && session.user.id < user.id);
      
      const existingPc = peerConnectionsRef.current.get(user.id);
      
      if (!existingPc && shouldInitiate) {
        // No hay conexión → iniciar nueva
        console.log('Initiating call to (global):', user.id, user.name);
        initiateCall(user.id);
      } else if (existingPc && shouldInitiate) {
        // Conexión existe → verificar si está en estado zombie (no connected/connecting)
        const state = existingPc.connectionState;
        if (state !== 'connected' && state !== 'connecting') {
          console.log(`Re-initiating call to ${user.name} (state: ${state})`);
          // Cerrar la conexión zombie y crear una nueva
          existingPc.close();
          peerConnectionsRef.current.delete(user.id);
          peerVideoTrackCountRef.current.delete(user.id);
          initiateCall(user.id);
        }
      }
    });
  }, [USAR_LIVEKIT, usuariosParaConexion, initiateCall, session?.user?.id, stream]);

  // Agregar screen share a conexiones existentes cuando se inicia
  useEffect(() => {
    if (USAR_LIVEKIT || !screenStream || !hasActiveCall) return;
    
    console.log('Adding screen share to existing peer connections');
    
    peerConnectionsRef.current.forEach(async (pc, peerId) => {
      // Verificar si ya tiene el track de screen
      const senders = pc.getSenders();
      const hasScreenTrack = senders.some(s => s.track?.label?.toLowerCase().includes('screen') || s.track?.label?.toLowerCase().includes('display'));
      
      if (!hasScreenTrack && screenStream) {
        // Agregar tracks de screen share
        screenStream.getTracks().forEach(track => {
          console.log('Adding screen track to peer:', peerId, track.label);
          pc.addTrack(track, screenStream);
        });
        
        // Renegociar la conexión
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          if (webrtcChannelRef.current) {
            webrtcChannelRef.current.send({
              type: 'broadcast',
              event: 'offer',
              payload: { offer, to: peerId, from: session?.user?.id }
            });
          }
        } catch (err) {
          console.error('Error renegotiating after adding screen share:', err);
        }
      }
    });
  }, [USAR_LIVEKIT, screenStream, hasActiveCall, session?.user?.id]);

  // NOTA: La renegociación automática cuando el stream cambia fue removida
  // porque causaba conflictos de SDP (m-lines order mismatch).
  // Los tracks se agregan al crear la conexión inicial en createPeerConnection.

  // Flag para evitar condiciones de carrera en getUserMedia
  const isProcessingStreamRef = useRef(false);
  // Ref para re-ejecutar manageStream si hubo un cambio mientras procesaba
  const pendingUpdateRef = useRef(false);
  // Ref para acceder al estado actual dentro de la función asíncrona
  const shouldHaveStreamRef = useRef(false);
  // En mini mode (no space tab): solo activar stream si hay llamada activa (proximidad) o rango audio
  // En space tab: activar si hay llamada/audio-range O el usuario tiene cam/mic/screen encendido
  const isOnSpaceTab = activeSubTab === 'space';
  // Patrón Gather: stream solo cuando el usuario tiene mic/cam/screen activos (no por proximidad)
  shouldHaveStreamRef.current = currentUser.isMicOn || currentUser.isCameraOn || currentUser.isScreenSharing;

  // Manejar stream de video - encender/apagar según proximidad
  useEffect(() => {
    let mounted = true;

    const manageStream = async () => {
      // Si ya está procesando, marcar que necesitamos una actualización al terminar
      if (isProcessingStreamRef.current) {
        console.log('ManageStream busy, marking pending update...');
        pendingUpdateRef.current = true;
        return;
      }
      
      const shouldHaveStream = shouldHaveStreamRef.current;
      console.log('ManageStream starting - shouldHaveStream:', shouldHaveStream);
      
      try {
        isProcessingStreamRef.current = true;

        if (shouldHaveStream) {
          if (!activeStreamRef.current) {
            // Usar cámara seleccionada si está disponible
            const cameraSettings = loadCameraSettings();
            const videoConstraints: MediaTrackConstraints = { 
              width: 640, 
              height: 480 
            };
            if (cameraSettings.selectedCameraId) {
              videoConstraints.deviceId = { exact: cameraSettings.selectedCameraId };
              console.log('Using selected camera:', cameraSettings.selectedCameraId);
            }
            
            // Configuración de audio con reducción de ruido y cancelación de eco
            const currentAudioSettings = loadAudioSettings();
            const audioConstraints: MediaTrackConstraints = {
              noiseSuppression: currentAudioSettings.noiseReduction,
              echoCancellation: currentAudioSettings.echoCancellation,
              autoGainControl: currentAudioSettings.autoGainControl,
            };
            if (currentAudioSettings.selectedMicrophoneId) {
              audioConstraints.deviceId = { exact: currentAudioSettings.selectedMicrophoneId };
              console.log('Using selected microphone:', currentAudioSettings.selectedMicrophoneId);
            }
            console.log('🎤 Audio constraints:', audioConstraints);
            
            // Pedir solo los dispositivos que el usuario tiene activos (evita "Device in use" innecesario)
            const wantVideo = currentUser.isCameraOn || currentUser.isScreenSharing;
            const wantAudio = currentUser.isMicOn;
            const mediaConstraints: MediaStreamConstraints = {};
            if (wantVideo) mediaConstraints.video = videoConstraints;
            if (wantAudio) mediaConstraints.audio = audioConstraints;
            if (!wantVideo && !wantAudio) mediaConstraints.audio = audioConstraints; // fallback: al menos audio
            
            console.log('Requesting media access...', { wantVideo, wantAudio });
            const newStream = await navigator.mediaDevices.getUserMedia(mediaConstraints).catch(async (err) => {
              // Si falla con dispositivos específicos, intentar con defaults
              if (cameraSettings.selectedCameraId || currentAudioSettings.selectedMicrophoneId) {
                console.warn('Selected device not available, using default:', err.message);
                const fallbackConstraints: MediaStreamConstraints = {};
                if (wantVideo) fallbackConstraints.video = { width: 640, height: 480 };
                if (wantAudio || !wantVideo) fallbackConstraints.audio = {
                  noiseSuppression: currentAudioSettings.noiseReduction,
                  echoCancellation: currentAudioSettings.echoCancellation,
                  autoGainControl: currentAudioSettings.autoGainControl,
                };
                return navigator.mediaDevices.getUserMedia(fallbackConstraints);
              }
              // Si video falla con Device in use, intentar solo audio
              if (wantVideo && err.name === 'NotReadableError') {
                console.warn('Camera in use, falling back to audio-only:', err.message);
                return navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
              }
              throw err;
            });
            
            if (!mounted) {
              newStream.getTracks().forEach(t => t.stop());
              return;
            }

            // Verificar si el estado cambió mientras esperábamos
            if (!shouldHaveStreamRef.current) {
              console.log('Stream loaded but no longer needed (state changed), stopping...');
              newStream.getTracks().forEach(t => t.stop());
              return; // Terminará en finally y disparará pending update si es necesario
            }

            let streamToUse = newStream;
            const audioTrack = newStream.getAudioTracks()[0];
            if (audioTrack && currentAudioSettings.noiseReduction) {
              const nivel = currentAudioSettings.noiseReductionLevel === 'enhanced' ? 'enhanced' : 'standard';
              const processedTrack = await crearAudioProcesado(audioTrack, nivel);
              if (processedTrack) {
                const mixed = new MediaStream([processedTrack, ...newStream.getVideoTracks()]);
                streamToUse = mixed;
              }
            } else {
              limpiarAudioProcesado();
            }

            activeStreamRef.current = streamToUse;
            setStream(streamToUse);
            console.log('Camera/mic stream started');
            
            // IMPORTANTE: Agregar tracks a conexiones peer EXISTENTES y renegociar
            if (!USAR_LIVEKIT && peerConnectionsRef.current.size > 0) {
              console.log('Adding new stream tracks to', peerConnectionsRef.current.size, 'existing peer connections');
              peerConnectionsRef.current.forEach(async (pc, peerId) => {
                // Verificar qué tracks ya tiene el peer
                const senders = pc.getSenders();
                const hasAudio = senders.some(s => s.track?.kind === 'audio');
                const hasVideo = senders.some(s => s.track?.kind === 'video');
                
                newStream.getTracks().forEach(track => {
                  const alreadyHas = (track.kind === 'audio' && hasAudio) || (track.kind === 'video' && hasVideo);
                  if (!alreadyHas) {
                    console.log('Adding', track.kind, 'track to peer', peerId);
                    pc.addTrack(track, newStream);
                  }
                });
                
                // Renegociar para que el peer reciba los nuevos tracks
                try {
                  const offer = await pc.createOffer();
                  await pc.setLocalDescription(offer);
                  if (webrtcChannelRef.current) {
                    console.log('Sending renegotiation offer to', peerId);
                    webrtcChannelRef.current.send({
                      type: 'broadcast',
                      event: 'offer',
                      payload: { offer, to: peerId, from: session?.user?.id }
                    });
                  }
                } catch (err) {
                  console.error('Error renegotiating with peer', peerId, err);
                }
              });
            }
          }
          
          // Actualizar estado de tracks
          if (activeStreamRef.current) {
            // Audio: solo habilitar/deshabilitar
            activeStreamRef.current.getAudioTracks().forEach(track => track.enabled = !!currentUser.isMicOn);
            
            // Video: DETENER el track completamente si cámara OFF (libera hardware)
            const videoTracks = activeStreamRef.current.getVideoTracks();
            if (!currentUser.isCameraOn && videoTracks.length > 0) {
              console.log('Camera OFF - stopping video track to release hardware');
              videoTracks.forEach(track => {
                track.stop();
                activeStreamRef.current?.removeTrack(track);
              });
              // Notificar a los peers que el video track se removió
              if (!USAR_LIVEKIT) {
                peerConnectionsRef.current.forEach((pc) => {
                  pc.getSenders().forEach(sender => {
                    if (sender.track?.kind === 'video') {
                      try { pc.removeTrack(sender); } catch (e) { /* ignore */ }
                    }
                  });
                });
              }
            } else if (currentUser.isCameraOn && videoTracks.length === 0 && activeStreamRef.current) {
              // Cámara ON pero no hay video track - obtener nuevo stream de video
              console.log('Camera ON - requesting new video track');
              try {
                const videoStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
                const newVideoTrack = videoStream.getVideoTracks()[0];
                if (newVideoTrack && activeStreamRef.current) {
                  activeStreamRef.current.addTrack(newVideoTrack);
                  // Agregar a peers existentes y RENEGOCIAR
                  if (!USAR_LIVEKIT) {
                    peerConnectionsRef.current.forEach(async (pc, peerId) => {
                      pc.addTrack(newVideoTrack, activeStreamRef.current!);
                      
                      // Renegociar para notificar el nuevo track
                      try {
                        const offer = await pc.createOffer();
                        await pc.setLocalDescription(offer);
                        if (webrtcChannelRef.current) {
                          console.log('Sending renegotiation offer (video ON) to', peerId);
                          webrtcChannelRef.current.send({
                            type: 'broadcast',
                            event: 'offer',
                            payload: { offer, to: peerId, from: session?.user?.id }
                          });
                        }
                      } catch (err) {
                        console.error('Error renegotiating video ON with peer', peerId, err);
                      }
                    });
                  }
                  setStream(new MediaStream(activeStreamRef.current.getTracks()));
                }
              } catch (e) {
                console.error('Error getting video track:', e);
              }
            }
          }
        } else {
          // Re-check: el ref pudo actualizarse desde que leímos shouldHaveStream al inicio
          // (evita destruir stream por un render transitorio con valor stale)
          await new Promise(r => setTimeout(r, 300));
          if (shouldHaveStreamRef.current) {
            console.log('ManageStream: stop cancelado — shouldHaveStream cambió a true durante wait');
            return;
          }
          // Confirmar: realmente no se necesita stream
          if (activeStreamRef.current) {
            console.log('Stopping camera/mic - user disabled all media');
            
            const tracks = activeStreamRef.current.getTracks();
            
            // Remover tracks de conexiones activas
            if (!USAR_LIVEKIT) {
              peerConnectionsRef.current.forEach((pc, peerId) => {
                pc.getSenders().forEach(sender => {
                  if (sender.track && tracks.some(t => t.id === sender.track!.id)) {
                    try {
                      pc.removeTrack(sender);
                    } catch (e) {
                      console.warn('Error removing track from PC:', e);
                    }
                  }
                });
              });
            }

            // Detener tracks
            tracks.forEach(track => {
              console.log('Stopping track:', track.kind, track.label);
              track.stop();
            });
            activeStreamRef.current = null;
            setStream(null);
          }
        }
      } catch (err) {
        console.error("Media error:", err);
      } finally {
        if (mounted) {
          isProcessingStreamRef.current = false;
          // Si hubo cambios pendientes mientras procesábamos, ejecutar de nuevo
          if (pendingUpdateRef.current) {
            console.log('Executing pending manageStream update...');
            pendingUpdateRef.current = false;
            manageStream();
          }
        }
      }
    };

    // Debounce de 500ms para evitar parpadeos rápidos
    const timer = setTimeout(() => {
      manageStream();
    }, 500);

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [currentUser.isMicOn, currentUser.isCameraOn, currentUser.isScreenSharing]);

  // Actualizar conexiones WebRTC cuando cambie el stream procesado (efectos de fondo)
  useEffect(() => {
    if (USAR_LIVEKIT || !processedStream || cameraSettings.backgroundEffect === 'none') return;
    
    const videoTrack = processedStream.getVideoTracks()[0];
    if (!videoTrack) return;

    console.log('🎨 Updating peer connections with processed video (background effect)');
    
    peerConnectionsRef.current.forEach(async (pc, peerId) => {
      const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
      if (videoSender) {
        try {
          await videoSender.replaceTrack(videoTrack);
          console.log('🎨 Replaced video track for peer', peerId);
        } catch (err) {
          console.error('Error replacing video track:', err);
        }
      }
    });
  }, [USAR_LIVEKIT, processedStream, cameraSettings.backgroundEffect]);

  // Limpiar processed stream cuando se desactiva el efecto o la cámara se apaga
  useEffect(() => {
    // Si no hay stream base (cámara apagada), limpiar processedStream
    if (!stream && processedStream) {
      console.log('[LIVEKIT] Limpiando processedStream — stream base es null (cámara apagada)');
      setProcessedStream(null);
      return;
    }
    if (USAR_LIVEKIT) return;
    if (cameraSettings.backgroundEffect === 'none' && processedStream) {
      setProcessedStream(null);
      
      // Restaurar video track original a los peers
      const originalVideoTrack = stream?.getVideoTracks()[0];
      if (originalVideoTrack) {
        console.log('🎨 Restoring original video track to peers');
        peerConnectionsRef.current.forEach(async (pc, peerId) => {
          const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
          if (videoSender) {
            try {
              await videoSender.replaceTrack(originalVideoTrack);
              console.log('🎨 Restored original video for peer', peerId);
            } catch (err) {
              console.error('Error restoring video track:', err);
            }
          }
        });
      }
    }
  }, [USAR_LIVEKIT, cameraSettings.backgroundEffect, stream, processedStream]);

  // ============== AUDIO/VIDEO ESTABILIDAD - Page Visibility API ==============
  // Mantiene el audio estable y cambia a video original cuando la página está oculta
  useEffect(() => {
    if (USAR_LIVEKIT) return;
    let audioContext: AudioContext | null = null;
    let silentSource: AudioBufferSourceNode | null = null;
    let wasUsingProcessedStream = false;

    const handleVisibilityChange = async () => {
      if (document.hidden) {
        // Página oculta: crear AudioContext para mantener audio activo
        console.log('🔊 Page hidden - activating audio keepalive');
        try {
          audioContext = new AudioContext();
          const buffer = audioContext.createBuffer(1, 1, 22050);
          silentSource = audioContext.createBufferSource();
          silentSource.buffer = buffer;
          silentSource.connect(audioContext.destination);
          silentSource.loop = true;
          silentSource.start();
        } catch (e) {
          console.warn('Could not create audio keepalive:', e);
        }

        // VIDEO: Cambiar al stream original para evitar congelamiento del canvas
        if (processedStream && stream && cameraSettings.backgroundEffect !== 'none') {
          wasUsingProcessedStream = true;
          const originalVideoTrack = stream.getVideoTracks()[0];
          if (originalVideoTrack) {
            console.log('📹 Page hidden - switching to original video (avoiding canvas freeze)');
            peerConnectionsRef.current.forEach(async (pc, peerId) => {
              const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
              if (videoSender) {
                try {
                  await videoSender.replaceTrack(originalVideoTrack);
                  console.log('📹 Switched to original video for peer', peerId);
                } catch (err) {
                  console.error('Error switching video:', err);
                }
              }
            });
          }
        }
      } else {
        // Página visible: limpiar AudioContext
        console.log('🔊 Page visible - deactivating audio keepalive');
        if (silentSource) {
          try { silentSource.stop(); } catch (e) {}
          silentSource = null;
        }
        if (audioContext) {
          try { audioContext.close(); } catch (e) {}
          audioContext = null;
        }

        // VIDEO: Restaurar stream procesado si estaba activo
        if (wasUsingProcessedStream && processedStream) {
          const processedVideoTrack = processedStream.getVideoTracks()[0];
          if (processedVideoTrack) {
            console.log('📹 Page visible - restoring processed video');
            peerConnectionsRef.current.forEach(async (pc, peerId) => {
              const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
              if (videoSender) {
                try {
                  await videoSender.replaceTrack(processedVideoTrack);
                  console.log('📹 Restored processed video for peer', peerId);
                } catch (err) {
                  console.error('Error restoring video:', err);
                }
              }
            });
          }
          wasUsingProcessedStream = false;
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (silentSource) {
        try { silentSource.stop(); } catch (e) {}
      }
      if (audioContext) {
        try { audioContext.close(); } catch (e) {}
      }
    };
  }, [processedStream, stream, cameraSettings.backgroundEffect]);

  // Manejar screen share
  const handleToggleScreenShare = async () => {
    if (!currentUser.isScreenSharing) {
      try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 15 } },
          audio: false,
        });
        displayStream.getVideoTracks()[0].onended = () => {
          toggleScreenShare(false);
          if (activeScreenRef.current) {
            activeScreenRef.current.getTracks().forEach(t => t.stop());
            activeScreenRef.current = null;
            setScreenStream(null);
          }
        };
        activeScreenRef.current = displayStream;
        setScreenStream(displayStream);
        toggleScreenShare(true);
      } catch (err) { 
        console.error("Screen Share Error:", err); 
        toggleScreenShare(false); 
      }
    } else {
      if (activeScreenRef.current) { 
        activeScreenRef.current.getTracks().forEach(t => t.stop()); 
        activeScreenRef.current = null; 
        setScreenStream(null); 
      }
      toggleScreenShare(false);
    }
  };

  // Función para resetear la vista de la cámara
  const handleResetView = useCallback(() => {
    if (orbitControlsRef.current) {
      const controls = orbitControlsRef.current;
      const playerX = (currentUser.x || 400) / 16;
      const playerZ = (currentUser.y || 400) / 16;
      
      // Resetear target al jugador
      controls.target.set(playerX, 0, playerZ);
      
      // Resetear posición de cámara a vista isométrica por defecto
      controls.object.position.set(playerX, 15, playerZ + 15);
      
      controls.update();
    }
  }, [currentUser.x, currentUser.y]);

  // Cerrar chat, emojis y status picker al hacer clic en el canvas
  const handleCanvasClick = useCallback(() => {
    setShowChat(false);
    setShowEmojis(false);
    setShowStatusPicker(false);
  }, []);

  return (
    <div className="w-full h-full relative bg-black" onClick={handleCanvasClick}>
      {USAR_LIVEKIT && (
        <SpatialAudio
          tracks={remoteAudioTracks}
          usuarios={[...usersInCall, ...usersInAudioRange]}
          currentUser={currentUserEcs}
          enabled={!!space3dSettings.spatialAudio}
          silenciarAudio={currentUser.status !== PresenceStatus.AVAILABLE}
        />
      )}
      <Canvas
        frameloop="demand"
        shadows={gpuRenderConfig ? gpuRenderConfig.shadows : performanceSettings.graphicsQuality !== 'low'}
        dpr={adaptiveDpr}
        gl={{ 
          antialias: gpuRenderConfig ? gpuRenderConfig.antialias : performanceSettings.graphicsQuality !== 'low',
          powerPreference: gpuRenderConfig ? gpuRenderConfig.powerPreference : (performanceSettings.batterySaver ? 'low-power' : 'default'),
          failIfMajorPerformanceCaveat: false
        }}
        onCreated={({ gl }) => {
          console.log(`Canvas created | GPU Tier: ${gpuInfo?.tier ?? '?'} | API: ${gpuInfo?.api ?? '?'} | Renderer: ${gpuInfo?.renderer ?? '?'}`);
          gl.setClearColor(themeColors[theme] || '#000000');
          if (gpuRenderConfig) {
            gl.toneMappingExposure = gpuRenderConfig.toneMappingExposure;
          }
        }}
      >
        <AdaptiveFrameloop />
        <AvatarScreenProjector
          selectedUserId={selectedRemoteUser?.id || null}
          ecsStateRef={ecsStateRef}
          screenPosRef={cardScreenPosRef}
          onlineUsers={usuariosEnChunks}
        />
        <PerformanceMonitor
          onDecline={() => {
            setAdaptiveDpr((prev) => Math.max(minDpr, prev - 0.25));
          }}
          onIncline={() => {
            setAdaptiveDpr((prev) => Math.min(maxDpr, prev + 0.25));
          }}
        />
        <Suspense fallback={null}>
          <Scene
            currentUser={currentUserEcs}
            onlineUsers={usuariosEnChunks}
            setPosition={setPositionEcs}
            theme={theme}
            orbitControlsRef={orbitControlsRef}
            stream={stream}
            remoteStreams={remoteStreamsRouted}
            showVideoBubbles={true}
            localMessage={localMessage}
            remoteMessages={remoteMessages}
            localReactions={localReactions}
            remoteReaction={remoteReaction}
            onClickAvatar={() => setShowAvatarModal(true)}
            moveTarget={moveTarget}
            onReachTarget={() => setMoveTarget(null)}
            teleportTarget={teleportTarget}
            onTeleportDone={() => {
              setTeleportTarget(null);
              // Forzar re-sincronización de tracks LiveKit tras teleport
              // El teleport mueve al usuario lejos → sale de proximidad → tracks se despublican
              // Al llegar al destino, necesitamos re-publicar inmediatamente
              if (USAR_LIVEKIT && livekitConnected) {
                setTimeout(() => {
                  sincronizarTracksLocales().catch(() => {});
                  console.log('[LIVEKIT] Re-sincronizando tracks tras teleport');
                }, 800);
              }
            }}
            showFloorGrid={space3dSettings.showFloorGrid}
            showNamesAboveAvatars={space3dSettings.showNamesAboveAvatars}
            cameraSensitivity={space3dSettings.cameraSensitivity}
            invertYAxis={space3dSettings.invertYAxis}
            cameraMode={space3dSettings.cameraMode}
            realtimePositionsRef={realtimePositionsRef}
            interpolacionWorkerRef={interpolacionWorkerRef}
            posicionesInterpoladasRef={posicionesInterpoladasRef}
            ecsStateRef={ecsStateRef}
            broadcastMovement={broadcastMovement}
            moveSpeed={userMoveSpeed}
            runSpeed={userRunSpeed}
            zonasEmpresa={zonasEmpresa}
            onZoneCollision={setZonaColisionadaId}
            usersInCallIds={usersInCallIds}
            usersInAudioRangeIds={usersInAudioRangeIds}
            empresasAutorizadas={empresasAutorizadas}
            mobileInputRef={mobileInputRef}
            enableDayNightCycle={enableDayNightCycle}
            onXPEvent={grantXP}
            onClickRemoteAvatar={handleClickRemoteAvatar}
            avatarInteractions={avatarInteractionsMemo}
            onTapFloor={isMobile ? (point) => {
              // Mobile: single tap = walk/teleport (misma lógica que double-click en desktop)
              const playerX = (currentUserEcs.x || 400) / 16;
              const playerZ = (currentUserEcs.y || 400) / 16;
              const dx = point.x - playerX;
              const dz = point.z - playerZ;
              const dist = Math.sqrt(dx * dx + dz * dz);
              if (dist > TELEPORT_DISTANCE) {
                setMoveTarget(null);
                setTeleportTarget({ x: point.x, z: point.z });
              } else if (dist > 0.5) {
                setTeleportTarget(null);
                setMoveTarget({ x: point.x, z: point.z });
              }
              hapticFeedback('light');
            } : undefined}
            onDoubleClickFloor={(point) => {
              // Calcular distancia desde posición actual del avatar
              const playerX = (currentUserEcs.x || 400) / 16;
              const playerZ = (currentUserEcs.y || 400) / 16;
              const dx = point.x - playerX;
              const dz = point.z - playerZ;
              const dist = Math.sqrt(dx * dx + dz * dz);

              if (dist > TELEPORT_DISTANCE) {
                // Distancia larga → teletransportación estilo Goku
                setMoveTarget(null);
                setTeleportTarget({ x: point.x, z: point.z });
              } else {
                // Distancia corta → caminar/correr
                setTeleportTarget(null);
                setMoveTarget({ x: point.x, z: point.z });
              }
            }}
          />
        </Suspense>
      </Canvas>
      
      {/* Indicador discreto de grabación para otros usuarios (no el grabador) */}
      {isRecording && (tipoGrabacionActual === null || !['rrhh_entrevista', 'rrhh_one_to_one'].includes(tipoGrabacionActual) || consentimientoAceptado) && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] pointer-events-none">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-red-500/30">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
            </span>
            <span className="text-red-400 text-xs font-medium">Grabando</span>
          </div>
        </div>
      )}
      
      {/* Botón de resetear vista */}
      <button
        onClick={handleResetView}
        className="absolute bottom-4 left-4 bg-gray-800/80 hover:bg-gray-700 text-white px-3 py-2 rounded-lg flex items-center gap-2 text-sm backdrop-blur-sm transition-colors z-10"
        title="Resetear vista (centrar cámara en tu avatar)"
        data-tour-step="avatar-area"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
          <path d="M3 3v5h5"/>
        </svg>
        Centrar
      </button>
      
      {/* VideoHUD - solo se muestra cuando hay usuarios cerca (burbuja local ahora está en el avatar) */}
      {usersInCall.length > 0 && (
        <VideoHUD
          userName={currentUser.name}
          userAvatar={currentUser.profilePhoto}
          visitorId={session?.user?.id || 'visitor'}
          camOn={currentUser.isCameraOn}
          sharingOn={currentUser.isScreenSharing}
          isPrivate={currentUser.isPrivate}
          usersInCall={usersInCall}
          stream={stream}
          screenStream={screenStream}
          remoteStreams={remoteStreamsRouted}
          remoteScreenStreams={remoteScreenStreamsRouted}
          remoteReaction={remoteReaction}
          onWaveUser={handleWaveUser}
          currentReaction={localReactions.length > 0 ? localReactions[localReactions.length - 1].emoji : null}
          theme={theme}
          speakingUsers={speakingUsers}
          userDistances={userDistances}
          muteRemoteAudio={currentUser.status !== PresenceStatus.AVAILABLE}
          cameraSettings={cameraSettings}
          onProcessedStreamReady={setProcessedStream}
        />
      )}

      {/* Banner Showroom Mode */}
      {showroomMode && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-2.5 rounded-2xl bg-gradient-to-r from-purple-600/90 to-indigo-600/90 backdrop-blur-xl border border-white/20 shadow-2xl">
          <span className="text-lg">🏢</span>
          <div>
            <p className="text-white text-sm font-bold">Modo Demo{showroomNombreVisitante ? ` — ${showroomNombreVisitante}` : ''}</p>
            <p className="text-white/60 text-[10px]">Exploración del espacio virtual ({showroomDuracionMin} min)</p>
          </div>
        </div>
      )}

      {/* Banner de proximidad: solo notificación de conversación bloqueada por otro usuario */}
      {hasActiveCall && !showroomMode && conversacionProximaBloqueada && (
        <div className="absolute top-4 right-4 z-[201] animate-slide-in">
          <div className="backdrop-blur-xl rounded-2xl border shadow-2xl overflow-hidden bg-red-950/80 border-red-500/40">
            <div className="flex items-center gap-2 px-3.5 py-2">
              <span className="text-sm">🔒</span>
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs font-bold truncate">Conversación bloqueada</p>
                <p className="text-white/50 text-[9px]">{conversacionProximaBloqueada.nombre} está en conversación privada</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Barra de Controles Inferior (Estilo 2026) — oculta en showroom */}
      {!showroomMode && <BottomControlBar
        onToggleMic={toggleMic}
        onToggleCam={toggleCamera}
        onToggleShare={handleToggleScreenShare}
        onToggleRecording={handleToggleRecording}
        onToggleEmojis={() => { setShowEmojis(!showEmojis); setShowChat(false); setShowStatusPicker(false); }}
        onToggleChat={() => { setShowChat(!showChat); setShowEmojis(false); setShowStatusPicker(false); }}
        isMicOn={currentUser.isMicOn}
        isCamOn={currentUser.isCameraOn}
        isSharing={currentUser.isScreenSharing}
        isRecording={isRecording}
        recordingDuration={recordingDuration}
        showEmojis={showEmojis}
        showChat={showChat}
        showStatusPicker={showStatusPicker}
        onToggleStatusPicker={() => { setShowStatusPicker(!showStatusPicker); setShowEmojis(false); setShowChat(false); }}
        onTriggerReaction={handleTriggerReaction}
        avatarConfig={currentUser.avatarConfig!}
        showShareButton={usersInCall.length > 0}
        showRecordingButton={usersInCall.length > 0}
        onToggleLock={bloquearConversacion}
        isLocked={conversacionBloqueada}
        showLockButton={usersInCall.length > 0 && !conversacionProximaBloqueada}
        currentStream={stream}
        onCameraSettingsChange={(newSettings) => {
          setCameraSettings(newSettings);
          saveCameraSettings(newSettings);
        }}
        onAudioSettingsChange={async (newSettings) => {
          setAudioSettings(newSettings);
          saveAudioSettings(newSettings);
          
          // Aplicar cambios de micrófono en tiempo real si hay stream activo
          if (activeStreamRef.current && newSettings.selectedMicrophoneId) {
            try {
              console.log('🎤 Applying new microphone:', newSettings.selectedMicrophoneId);
              const newAudioStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                  deviceId: { exact: newSettings.selectedMicrophoneId },
                  noiseSuppression: newSettings.noiseReduction,
                  echoCancellation: newSettings.echoCancellation,
                  autoGainControl: newSettings.autoGainControl,
                }
              });
              
              const newAudioTrack = newAudioStream.getAudioTracks()[0];
              const oldAudioTrack = activeStreamRef.current.getAudioTracks()[0];
              
              if (oldAudioTrack && newAudioTrack) {
                // Reemplazar track en el stream local
                activeStreamRef.current.removeTrack(oldAudioTrack);
                activeStreamRef.current.addTrack(newAudioTrack);
                oldAudioTrack.stop();
                
                // Reemplazar en LiveKit si está conectado
                if (USAR_LIVEKIT && livekitRoomRef.current?.state === 'connected') {
                  const finalTrack = newSettings.noiseReduction
                    ? (await crearAudioProcesado(newAudioTrack, newSettings.noiseReductionLevel === 'enhanced' ? 'enhanced' : 'standard')) || newAudioTrack
                    : newAudioTrack;
                  await publicarTrackLocal(finalTrack, 'audio');
                  finalTrack.enabled = currentUser.isMicOn;
                  console.log('🎤 LiveKit audio track updated with new settings');
                }
                // Reemplazar en conexiones peer (path non-LiveKit)
                peerConnectionsRef.current.forEach(async (pc, peerId) => {
                  const audioSender = pc.getSenders().find(s => s.track?.kind === 'audio');
                  if (audioSender) {
                    await audioSender.replaceTrack(newAudioTrack);
                    console.log('🎤 Replaced audio track for peer', peerId);
                  }
                });
                
                // Aplicar procesamiento de audio para stream local (path non-LiveKit)
                if (!USAR_LIVEKIT) {
                  const nivel = newSettings.noiseReductionLevel === 'enhanced' ? 'enhanced' : 'standard';
                  if (newSettings.noiseReduction) {
                    const processedTrack = await crearAudioProcesado(newAudioTrack, nivel);
                    if (processedTrack) {
                      activeStreamRef.current.removeTrack(newAudioTrack);
                      activeStreamRef.current.addTrack(processedTrack);
                    }
                  } else {
                    limpiarAudioProcesado();
                  }
                }
                newAudioTrack.enabled = currentUser.isMicOn;
                console.log('🎤 New microphone applied successfully');
              }
            } catch (err) {
              console.error('Error applying new microphone:', err);
            }
          }
        }}
        isGameActive={isPlayingGame}
        isGameHubOpen={isGameHubOpen}
      />}

      {/* Input de Chat Flotante - Minimalista */}
      {showChat && (
        <div className="absolute bottom-[88px] left-1/2 -translate-x-1/2 z-[201] animate-slide-up" onClick={(e) => e.stopPropagation()}>
          <div className="bg-black/60 backdrop-blur-md px-1 py-1 rounded-2xl border border-white/10 flex gap-1 items-center">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') handleSendMessage();
                if (e.key === 'Escape') setShowChat(false);
              }}
              onKeyUp={(e) => e.stopPropagation()}
              placeholder="Mensaje..."
              className="w-40 bg-transparent border-none px-2 py-1 text-xs text-white placeholder-white/40 focus:outline-none"
              autoFocus
              maxLength={100}
            />
            <button
              onClick={handleSendMessage}
              disabled={!chatInput.trim()}
              className="w-7 h-7 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs flex items-center justify-center transition-colors"
            >
              ➤
            </button>
          </div>
        </div>
      )}

      {/* Minimapa */}
      <Minimap currentUser={currentUserEcs} users={usuariosParaMinimapa} workspace={activeWorkspace} onTeleport={(x, z) => {
        setMoveTarget(null);
        setTeleportTarget({ x, z });
        hapticFeedback('medium');
      }} />
      
      {/* Notificación de Wave entrante */}
      {incomingWave && (
        <div className="fixed top-16 right-4 z-[201] animate-slide-in">
          <div className="backdrop-blur-xl rounded-2xl border shadow-2xl overflow-hidden bg-slate-950/80 border-slate-600/40">
            <div className="flex items-center gap-2 px-3.5 py-2">
              <div className="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center flex-shrink-0">
                <svg className="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" /></svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs font-bold truncate">{incomingWave.fromName}</p>
                <p className="text-white/50 text-[9px]">te está saludando 👋</p>
              </div>
              <button
                onClick={() => setIncomingWave(null)}
                className="w-5 h-5 rounded-md bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors flex-shrink-0"
              >
                <svg className="w-2.5 h-2.5 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === FASE A: Card flotante screen-space (tamaño fijo, posición proyectada desde 3D) === */}
      {selectedRemoteUser && (
        <ScreenSpaceProfileCard
          user={selectedRemoteUser}
          screenPosRef={cardScreenPosRef}
          onClose={() => setSelectedRemoteUser(null)}
          onWave={(id) => { handleWaveUser(id); }}
          onInvite={(id) => { handleInviteUser(id); }}
          onFollow={(id) => { handleFollowUser(id); }}
          followTargetId={followTargetId}
        />
      )}

      {/* Notificación de Nudge entrante */}
      {incomingNudge && (
        <div className="fixed top-16 right-4 z-[201] animate-slide-in">
          <div className="backdrop-blur-xl rounded-2xl border shadow-2xl overflow-hidden bg-slate-950/80 border-slate-600/40">
            <div className="flex items-center gap-2 px-3.5 py-2">
              <div className="w-7 h-7 rounded-lg bg-pink-500/15 flex items-center justify-center flex-shrink-0">
                <svg className="w-3.5 h-3.5 text-pink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs font-bold truncate">{incomingNudge.fromName}</p>
                <p className="text-white/50 text-[9px]">quiere tu atención 🔔</p>
              </div>
              <button
                onClick={() => setIncomingNudge(null)}
                className="w-5 h-5 rounded-md bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors flex-shrink-0"
              >
                <svg className="w-2.5 h-2.5 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notificación de Invite entrante */}
      {incomingInvite && (
        <div className="fixed top-16 right-4 z-[201] animate-slide-in">
          <div className="backdrop-blur-xl rounded-2xl border shadow-2xl overflow-hidden bg-slate-950/80 border-slate-600/40">
            <div className="flex items-center gap-2 px-3.5 py-2">
              <div className="w-7 h-7 rounded-lg bg-indigo-500/15 flex items-center justify-center flex-shrink-0">
                <svg className="w-3.5 h-3.5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs font-bold truncate">{incomingInvite.fromName}</p>
                <p className="text-white/50 text-[9px]">te invita a unirte 📍</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={handleAcceptInvite}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 border border-indigo-500/30"
                >
                  Ir
                </button>
                <button
                  onClick={() => setIncomingInvite(null)}
                  className="w-5 h-5 rounded-md bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors flex-shrink-0"
                >
                  <svg className="w-2.5 h-2.5 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Banner de Follow Mode activo */}
      {followTargetId && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[201]">
          <div className="bg-violet-600/80 backdrop-blur-xl text-white px-4 py-2 rounded-xl shadow-lg flex items-center gap-2 border border-violet-400/30">
            <svg className="w-4 h-4 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
            <span className="text-xs font-bold">Siguiendo a {usuariosEnChunks.find(u => u.id === followTargetId)?.name || 'usuario'}</span>
            <button
              onClick={() => { setFollowTargetId(null); followTargetIdRef.current = null; }}
              className="ml-1 px-2 py-0.5 rounded-lg bg-white/20 hover:bg-white/30 text-[10px] font-bold transition-colors"
            >
              Dejar de seguir
            </button>
          </div>
        </div>
      )}

      {/* CTA: Solicitar acceso a zona privada */}
      {zonaAccesoProxima && (
        <div className="fixed bottom-32 right-4 z-[201] animate-slide-in">
          <div className="bg-slate-950/80 border border-slate-700/50 backdrop-blur-xl px-4 py-3 rounded-xl shadow-2xl w-64">
            <div className="text-xs text-slate-300">
              Estás cerca de una zona privada
            </div>
            <div className="text-sm text-white font-semibold">
              {zonaAccesoProxima.zona.nombre_zona || zonaAccesoProxima.zona.empresa?.nombre || 'Zona privada'}
            </div>
            <button
              onClick={handleSolicitarAccesoZona}
              disabled={zonaAccesoProxima.pendiente || solicitandoAcceso}
              className="mt-2 w-full rounded-lg bg-emerald-500/90 text-white text-xs py-2 font-semibold disabled:opacity-50"
            >
              {zonaAccesoProxima.pendiente ? 'Solicitud pendiente' : solicitandoAcceso ? 'Enviando...' : 'Solicitar acceso'}
            </button>
          </div>
        </div>
      )}

      {/* Toast notificaciones de autorizaciones */}
      {notificacionAutorizacion && (
        <div className="fixed top-36 right-4 z-[202] animate-slide-in">
          <div className="bg-slate-900/90 border border-slate-700/60 backdrop-blur-xl px-4 py-3 rounded-xl shadow-2xl w-72">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">{notificacionAutorizacion.titulo}</p>
                {notificacionAutorizacion.mensaje && (
                  <p className="text-xs text-slate-300 mt-1">{notificacionAutorizacion.mensaje}</p>
                )}
              </div>
              <button
                onClick={() => setNotificacionAutorizacion(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            {notificacionAutorizacion.datos_extra?.canal_compartido_id && (
              <button
                onClick={() => {
                  setActiveChatGroupId(notificacionAutorizacion.datos_extra?.canal_compartido_id || null);
                  setActiveSubTab('chat');
                }}
                className="mt-2 w-full rounded-lg bg-sky-500/80 text-white text-xs py-2 font-semibold"
              >
                Abrir canal compartido
              </button>
            )}
          </div>
        </div>
      )}
      
      {/* Controles de ayuda — desktop: WASD, mobile: oculto (tiene joystick) */}
      {!isMobile && (
        <div className="absolute bottom-4 right-4 bg-black/50 backdrop-blur-sm px-3 py-2 rounded-lg text-white text-xs">
          <div className="flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 bg-white/20 rounded text-[10px]">WASD</kbd>
            <span className="opacity-70">o flechas para mover</span>
          </div>
        </div>
      )}

      {/* === MOBILE GAME HUD === */}
      {isMobile && (
        <>
          {/* Joystick virtual — esquina inferior izquierda */}
          <MobileJoystick inputRef={mobileInputRef} size={120} deadZone={0.15} runThreshold={0.7} />

          {/* Botón de emotes — esquina inferior derecha */}
          <button
            className="absolute z-[150] select-none touch-none flex items-center justify-center rounded-full"
            style={{
              bottom: 140,
              right: 24,
              width: 52,
              height: 52,
              backgroundColor: 'rgba(15, 23, 42, 0.7)',
              border: '2px solid rgba(99, 102, 241, 0.4)',
              backdropFilter: 'blur(4px)',
            }}
            onClick={(e) => { e.stopPropagation(); setShowEmoteWheel(true); }}
          >
            <span className="text-xl">😄</span>
          </button>

          {/* Botón de chat — encima de emotes */}
          <button
            className="absolute z-[150] select-none touch-none flex items-center justify-center rounded-full"
            style={{
              bottom: 200,
              right: 24,
              width: 44,
              height: 44,
              backgroundColor: 'rgba(15, 23, 42, 0.7)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              backdropFilter: 'blur(4px)',
            }}
            onClick={(e) => { e.stopPropagation(); setShowChat(!showChat); setShowEmojis(false); }}
          >
            <span className="text-base">💬</span>
          </button>
        </>
      )}

      {/* Botón XP / Gamificación — esquina superior izquierda */}
      <button
        className="absolute top-4 left-4 z-[60] flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-black/50 backdrop-blur-sm border border-indigo-500/30 hover:border-indigo-500/60 transition-colors cursor-pointer"
        onClick={() => setShowGamificacion(true)}
        title="Gamificación"
      >
        <span className="text-sm">⭐</span>
        <span className="text-[10px] font-bold text-indigo-400">XP</span>
      </button>

      {/* Panel de Gamificación */}
      <GamificacionPanel
        usuarioId={session?.user?.id || ''}
        espacioId={activeWorkspace?.id || ''}
        visible={showGamificacion}
        onClose={() => setShowGamificacion(false)}
      />

      {/* Emote Wheel overlay — funciona en mobile y desktop */}
      <EmoteWheel
        visible={showEmoteWheel}
        onClose={() => setShowEmoteWheel(false)}
        onSelect={(emoteId) => {
          setShowEmoteWheel(false);
          // Mapear emoteId a animación del avatar o emoji reaction
          if (['wave', 'dance', 'cheer', 'victory', 'jump', 'sit'].includes(emoteId)) {
            // Broadcast como emote trigger via moveTarget pattern
            // El Player captará esto via su contextual animation system
            if (broadcastMovement) {
              const px = (currentUserEcs.x || 400);
              const py = (currentUserEcs.y || 400);
              broadcastMovement(px, py, currentUserEcs.direction || 'front', false, emoteId, true);
            }
          }
          // XP por emote enviado (throttle 10s)
          grantXP('emote_enviado', 10000);
          hapticFeedback('medium');
        }}
      />
      
      {/* Recording Manager V2 con análisis conductual avanzado */}
      {hasActiveCall && (
        <RecordingManager
          espacioId={activeWorkspace?.id || ''}
          userId={session?.user?.id || ''}
          userName={currentUser.name}
          reunionTitulo={`Reunión ${new Date().toLocaleDateString()}`}
          stream={stream}
          cargoUsuario={cargoUsuario as any}
          usuariosEnLlamada={usersInCall.map(u => ({ id: u.id, nombre: u.name }))}
          onRecordingStateChange={(recording) => {
            setIsRecording(recording);
            if (!recording) {
              setRecordingDuration(0);
              setConsentimientoAceptado(false);
              setTipoGrabacionActual(null);
            }
          }}
          onDurationChange={(duration) => setRecordingDuration(duration)}
          onTipoGrabacionChange={(tipo) => setTipoGrabacionActual(tipo)}
          onProcessingComplete={(resultado) => {
            console.log('✅ Análisis conductual completado:', resultado?.tipo_grabacion, resultado?.analisis);
          }}
          headlessMode={true}
          externalTrigger={recordingTrigger}
          onExternalTriggerHandled={() => setRecordingTrigger(false)}
        />
      )}

      {/* Modal de consentimiento para usuarios evaluados */}
      <ConsentimientoPendiente
        onConsentimientoRespondido={(grabacionId, acepto) => {
          console.log(`📝 Consentimiento ${acepto ? 'aceptado' : 'rechazado'} para grabación:`, grabacionId);
        }}
      />
      
      {/* GameHub ahora se controla desde la barra superior en WorkspaceLayout */}

      {/* Modal de Avatar/Perfil (estilo Gather - glassmorphism) */}
      {showAvatarModal && (
        <div 
          className="fixed inset-0 z-[300] flex items-center justify-center"
          onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) setShowAvatarModal(false); }}
          onKeyDown={(e) => { if (e.key === 'Escape') setShowAvatarModal(false); }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowAvatarModal(false)} />
          
          {/* Modal */}
          <div className="relative w-[95vw] max-w-[900px] h-[85vh] max-h-[680px] bg-zinc-900/95 backdrop-blur-xl rounded-3xl border border-white/10 shadow-2xl shadow-black/50 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-indigo-600/20 flex items-center justify-center">
                  <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white">Mi Perfil y Avatar</h2>
                  <p className="text-[10px] text-white/40">Personaliza tu apariencia en el espacio</p>
                </div>
              </div>
              <button
                onClick={() => setShowAvatarModal(false)}
                className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors group"
              >
                <svg className="w-4 h-4 text-white/40 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body - AvatarCustomizer3D */}
            <div className="flex-1 overflow-hidden">
              <AvatarCustomizer3D compact={false} onClose={() => setShowAvatarModal(false)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VirtualSpace3D;
