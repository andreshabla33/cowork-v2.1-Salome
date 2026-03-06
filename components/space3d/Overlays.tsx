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

// --- Minimap ---
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

// --- StableVideo ---
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

// --- AdaptiveFrameloop ---
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

// --- ScreenSpaceProfileCard ---
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


