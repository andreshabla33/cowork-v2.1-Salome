/**
 * @module hooks/space3d/useUserSettings
 * Hook para gestión de settings del usuario (localStorage), GPU detection,
 * DPR adaptivo, auto-idle muting, y configuración de cámara/audio.
 */

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { getUserSettings, getSettingsSection, requestDesktopNotificationPermission } from '@/lib/userSettings';
import { detectGpuCapabilities, adaptiveConfigFromTier, type GpuInfo } from '@/lib/gpuCapabilities';
import { loadCameraSettings, saveCameraSettings, type CameraSettings } from '@/components/CameraSettingsMenu';
import { loadAudioSettings, saveAudioSettings, type AudioSettings } from '@/components/BottomControlBar';
import { MOVE_SPEED, RUN_SPEED, PROXIMITY_RADIUS, type UseUserSettingsReturn, type UseUserSettingsParams } from './types';
import type { Room } from 'livekit-client';

export function useUserSettings(params: UseUserSettingsParams): UseUserSettingsReturn {
  const { livekitRoomRef, hasActiveCallRef, toggleMic, toggleCamera } = params;

  // ========== Settings del usuario (leídos de localStorage/SettingsModal) ==========
  const [userSettingsVersion, setUserSettingsVersion] = useState(0);
  const space3dSettings = useMemo(() => getSettingsSection('space3d'), [userSettingsVersion]);
  const enableDayNightCycle = space3dSettings.enableDayNightCycle ?? false;
  const meetingsSettings = useMemo(() => getSettingsSection('meetings'), [userSettingsVersion]);
  const notifSettings = useMemo(() => getSettingsSection('notifications'), [userSettingsVersion]);
  const performanceSettings = useMemo(() => getSettingsSection('performance'), [userSettingsVersion]);

  // ========== GPU Detection ==========
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

  // ========== Radio de interés para chunks ==========
  const radioInteresChunks = useMemo(() => {
    const radio = Number(space3dSettings.radioInteresChunks ?? 1);
    if (!Number.isFinite(radio)) return 1;
    return Math.max(1, Math.min(3, Math.round(radio)));
  }, [space3dSettings.radioInteresChunks]);

  // ========== Velocidades y radios ==========
  const userMoveSpeed = useMemo(() => {
    const factor = space3dSettings.movementSpeed / 5;
    return MOVE_SPEED * factor;
  }, [space3dSettings.movementSpeed]);

  const userRunSpeed = useMemo(() => {
    const factor = space3dSettings.movementSpeed / 5;
    return RUN_SPEED * factor;
  }, [space3dSettings.movementSpeed]);

  const userProximityRadius = useMemo(() => {
    return space3dSettings.proximityRadius || PROXIMITY_RADIUS;
  }, [space3dSettings.proximityRadius]);

  // ========== DPR adaptivo ==========
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

  // ========== Escuchar cambios de settings ==========
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
        const hash = current.length;
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

  // ========== Auto-mute idle ==========
  const idleTimerRef = useRef<any>(null);
  const wasIdleMutedRef = useRef(false);
  const micOnRef = useRef(false);
  const camOnRef = useRef(false);

  // Función estable para verificar si hay llamada activa
  const isInActiveCall = useCallback(() => {
    if (hasActiveCallRef.current) return true;
    const room = livekitRoomRef.current;
    if (room && room.state === 'connected' && room.remoteParticipants.size > 0) return true;
    return false;
  }, [livekitRoomRef, hasActiveCallRef]);

  useEffect(() => {
    const videoS = getSettingsSection('video');
    if (!videoS.autoIdleMuting) return;

    const IDLE_TIMEOUT = 5 * 60 * 1000;

    const resetIdleTimer = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      wasIdleMutedRef.current = false;
      idleTimerRef.current = setTimeout(() => {
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
  }, [isInActiveCall, toggleMic, toggleCamera]);

  // ========== Solicitar permiso de notificaciones desktop ==========
  useEffect(() => {
    if (notifSettings.desktopNotifications) {
      requestDesktopNotificationPermission();
    }
  }, [notifSettings.desktopNotifications]);

  // ========== Configuración de cámara y audio ==========
  const [cameraSettings, setCameraSettings] = useState<CameraSettings>(loadCameraSettings);
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(loadAudioSettings);

  // ========== Método público para actualizar refs de mic/cam ==========
  // Se llama desde el componente padre para sincronizar
  const updateMicCamRefs = useCallback((isMicOn: boolean, isCameraOn: boolean) => {
    micOnRef.current = isMicOn;
    camOnRef.current = isCameraOn;
  }, []);

  return {
    userSettingsVersion,
    space3dSettings,
    meetingsSettings,
    notifSettings,
    performanceSettings,
    gpuInfo,
    gpuRenderConfig,
    radioInteresChunks,
    userMoveSpeed,
    userRunSpeed,
    userProximityRadius,
    maxDpr,
    minDpr,
    adaptiveDpr,
    setAdaptiveDpr,
    enableDayNightCycle,
    cameraSettings,
    setCameraSettings,
    audioSettings,
    setAudioSettings,
    isInActiveCall,
  };
}
