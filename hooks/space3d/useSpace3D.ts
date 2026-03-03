/**
 * @module hooks/space3d/useSpace3D
 * Hook facade que orquesta todos los domain hooks de Space3D.
 * Conecta las dependencias entre hooks y expone una API unificada
 * al componente VirtualSpace3D.
 */

import { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import { useStore } from '@/store/useStore';
import type { User } from '@/types';
import { isTouchDevice, hapticFeedback } from '@/lib/mobileDetect';
import { registrarLoginDiario, otorgarXP, XP_POR_ACCION } from '@/lib/gamificacion';
import { supabase } from '@/lib/supabase';
import type { JoystickInput } from '@/components/3d/MobileJoystick';
import { USAR_LIVEKIT } from './types';
import { useUserSettings } from './useUserSettings';
import { useRecording } from './useRecording';
import { useNotifications } from './useNotifications';
import { useChunkSystem } from './useChunkSystem';
import { useMediaStream } from './useMediaStream';
import { useLiveKit } from './useLiveKit';
import { useWebRTC } from './useWebRTC';
import { useProximity } from './useProximity';
import { useBroadcast, setBroadcastSoundFunctions } from './useBroadcast';
import { useGatherInteractions } from './useGatherInteractions';

export function useSpace3D(props: {
  theme?: string;
  isGameHubOpen?: boolean;
  isPlayingGame?: boolean;
  showroomMode?: boolean;
  showroomDuracionMin?: number;
  showroomNombreVisitante?: string;
}) {
  const { theme = 'dark', isGameHubOpen = false, isPlayingGame = false, showroomMode = false, showroomDuracionMin = 5, showroomNombreVisitante } = props;

  // ========== Store ==========
  const {
    currentUser, onlineUsers, setPosition, activeWorkspace,
    toggleMic, toggleCamera, toggleScreenShare, togglePrivacy, setPrivacy,
    session, setActiveSubTab, setActiveChatGroupId, activeSubTab,
    empresasAutorizadas, setEmpresasAutorizadas,
  } = useStore();

  // ========== Top-level state ==========
  const [moveTarget, setMoveTarget] = useState<{ x: number; z: number } | null>(null);
  const [teleportTarget, setTeleportTarget] = useState<{ x: number; z: number } | null>(null);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [showEmoteWheel, setShowEmoteWheel] = useState(false);
  const [showGamificacion, setShowGamificacion] = useState(false);
  const [cargoUsuario, setCargoUsuario] = useState<string>('colaborador');
  const [incomingNudge, setIncomingNudge] = useState<{ from: string; fromName: string } | null>(null);
  const [incomingInvite, setIncomingInvite] = useState<{ from: string; fromName: string; x: number; y: number } | null>(null);
  const mobileInputRef = useRef<JoystickInput>({ dx: 0, dz: 0, magnitude: 0, isRunning: false, active: false });
  const isMobile = useMemo(() => isTouchDevice(), []);
  const cardScreenPosRef = useRef<{ x: number; y: number } | null>(null);
  const proximidadNotificadaRef = useRef(false);
  const realtimePositionsRef = useRef<Map<string, any>>(new Map());
  const hasActiveCallRef = useRef(false);

  // ========== XP tracking ==========
  const xpThrottleRef = useRef<Record<string, number>>({});
  const xpLoginRegisteredRef = useRef(false);
  const grantXP = useCallback((accion: keyof typeof XP_POR_ACCION, cooldownMs: number = 10000) => {
    if (!session?.user?.id || !activeWorkspace?.id) return;
    const now = Date.now();
    if (xpThrottleRef.current[accion] && now - xpThrottleRef.current[accion] < cooldownMs) return;
    xpThrottleRef.current[accion] = now;
    otorgarXP(session.user.id, activeWorkspace.id, XP_POR_ACCION[accion], accion).then();
  }, [session?.user?.id, activeWorkspace?.id]);

  // ========== Service Worker ==========
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  // ========== 1. User Settings ==========
  const settings = useUserSettings({
    livekitRoomRef: { current: null } as any, // Se actualiza abajo
    hasActiveCallRef,
    toggleMic,
    toggleCamera,
  });

  // ========== 2. Chunk System ==========
  const chunks = useChunkSystem({
    currentUser,
    onlineUsers,
    empresasAutorizadas,
    radioInteresChunks: settings.radioInteresChunks,
    setPosition,
  });

  // ========== 3. Recording ==========
  const recording = useRecording(session?.user?.id);

  // ========== 4. Notifications ==========
  const notifications = useNotifications({
    session,
    activeWorkspace,
    currentUser,
    empresasAutorizadas,
    setEmpresasAutorizadas,
    currentUserEcs: chunks.currentUserEcs,
    notifSettings: settings.notifSettings,
  });

  // ========== 5. Media Stream ==========
  // Necesita peerConnections y webrtcChannel — creamos refs temporales
  const tempPeerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const tempWebrtcChannelRef = useRef<any>(null);

  const media = useMediaStream({
    currentUser,
    cameraSettings: settings.cameraSettings,
    toggleScreenShare,
    peerConnectionsRef: tempPeerConnectionsRef,
    webrtcChannelRef: tempWebrtcChannelRef,
    session,
  });

  // ========== 6. LiveKit ==========
  // Necesita hasActiveCall y usersInCall que vienen de proximity
  // Pero proximity necesita remoteStreams de livekit → dependencia circular
  // Solución: usar refs para romper el ciclo
  const hasActiveCallComputed = useRef(false);
  const usersInCallRef = useRef<User[]>([]);
  const usersInAudioRangeRef = useRef<User[]>([]);

  const livekit = useLiveKit({
    activeWorkspace,
    session,
    currentUser,
    empresasAutorizadas,
    onlineUsers,
    activeStreamRef: media.activeStreamRef,
    activeScreenRef: media.activeScreenRef,
    effectiveStreamRef: media.effectiveStreamRef,
    stream: media.stream,
    screenStream: media.screenStream,
    processedStream: media.processedStream,
    cameraSettings: settings.cameraSettings,
    hasActiveCall: hasActiveCallComputed.current,
    usersInCall: usersInCallRef.current,
    usersInAudioRange: usersInAudioRangeRef.current,
    conversacionesBloqueadasRemoto: new Map(), // Se sincroniza abajo
  });

  // Patch livekitRoomRef en settings
  (settings as any)._livekitRoomRef = livekit.livekitRoomRef;

  // ========== 7. Proximity ==========
  // Ahora tenemos remoteStreams de livekit
  const [selectedRemoteUserState, setSelectedRemoteUserState] = useState<User | null>(null);

  const proximity = useProximity({
    currentUserEcs: chunks.currentUserEcs,
    usuariosEnChunks: chunks.usuariosEnChunks,
    session,
    currentUser,
    userProximityRadius: settings.userProximityRadius,
    remoteStreams: livekit.remoteStreams,
    remoteScreenStreams: livekit.remoteScreenStreams,
    speakingUsers: livekit.speakingUsers,
    performanceSettings: settings.performanceSettings,
    selectedRemoteUser: selectedRemoteUserState,
    setSelectedRemoteUser: setSelectedRemoteUserState,
    handleToggleScreenShare: media.handleToggleScreenShare,
  });

  // Sync refs para LiveKit
  hasActiveCallComputed.current = proximity.hasActiveCall;
  hasActiveCallRef.current = proximity.hasActiveCall;
  usersInCallRef.current = proximity.usersInCall;
  usersInAudioRangeRef.current = proximity.usersInAudioRange;

  // ========== 8. Broadcast ==========
  const broadcast = useBroadcast({
    session,
    currentUser,
    currentUserEcs: chunks.currentUserEcs,
    activeWorkspace,
    usersInCall: proximity.usersInCall,
    enviarDataLivekit: livekit.enviarDataLivekit,
    webrtcChannelRef: tempWebrtcChannelRef,
    ecsStateRef: chunks.ecsStateRef,
    usuariosVisiblesRef: chunks.usuariosVisiblesRef,
    realtimePositionsRef,
    livekitRoomRef: livekit.livekitRoomRef,
    livekitConnected: livekit.livekitConnected,
    conversacionBloqueada: proximity.conversacionBloqueada,
    setConversacionBloqueada: proximity.setConversacionBloqueada,
    setConversacionesBloqueadasRemoto: proximity.setConversacionesBloqueadasRemoto,
    grantXP,
    notifSettings: settings.notifSettings,
    setPrivacy,
    hasActiveCall: proximity.hasActiveCall,
    proximidadNotificadaRef,
  });

  // ========== 9. WebRTC ==========
  const webrtc = useWebRTC({
    activeWorkspace,
    session,
    activeStreamRef: media.activeStreamRef,
    activeScreenRef: media.activeScreenRef,
    usuariosParaConexion: chunks.usuariosParaConexion,
    stream: media.stream,
    screenStream: media.screenStream,
    hasActiveCall: proximity.hasActiveCall,
    ecsStateRef: chunks.ecsStateRef,
    usuariosVisiblesRef: chunks.usuariosVisiblesRef,
    radioInteresChunks: settings.radioInteresChunks,
    currentUserEcs: chunks.currentUserEcs,
    setRemoteStreams: (val) => {}, // LiveKit maneja streams en USAR_LIVEKIT=true
    setRemoteScreenStreams: (val) => {},
    manejarEventoInstantaneo: broadcast.manejarEventoInstantaneo,
  });

  // Sync refs de media con webrtc
  tempPeerConnectionsRef.current = webrtc.peerConnectionsRef.current;
  tempWebrtcChannelRef.current = webrtc.webrtcChannelRef.current;

  // ========== 10. Gather Interactions ==========
  const interactions = useGatherInteractions({
    session,
    currentUser,
    currentUserEcs: chunks.currentUserEcs,
    usuariosEnChunks: chunks.usuariosEnChunks,
    ecsStateRef: chunks.ecsStateRef,
    enviarDataLivekit: livekit.enviarDataLivekit,
    webrtcChannelRef: webrtc.webrtcChannelRef,
    grantXP,
    setTeleportTarget,
    setMoveTarget,
    setIncomingNudge,
    setIncomingInvite,
  });

  // ========== Cargar cargo del usuario ==========
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
      if (clave) setCargoUsuario(clave);
    };
    cargarCargo();

    if (!xpLoginRegisteredRef.current && session?.user?.id && activeWorkspace?.id) {
      xpLoginRegisteredRef.current = true;
      registrarLoginDiario(session.user.id, activeWorkspace.id).then();
    }
  }, [session?.user?.id, activeWorkspace?.id]);

  // ========== Accept invite handler ==========
  const handleAcceptInvite = useCallback(() => {
    if (!incomingInvite) return;
    setMoveTarget(null);
    setTeleportTarget({ x: incomingInvite.x, z: incomingInvite.y });
    setIncomingInvite(null);
    hapticFeedback('medium');
  }, [incomingInvite]);

  return {
    // Store
    currentUser, onlineUsers, setPosition, activeWorkspace,
    toggleMic, toggleCamera, toggleScreenShare, togglePrivacy, setPrivacy,
    session, setActiveSubTab, setActiveChatGroupId, activeSubTab,
    empresasAutorizadas, setEmpresasAutorizadas,

    // Top-level state
    theme, isGameHubOpen, isPlayingGame, showroomMode, showroomDuracionMin, showroomNombreVisitante,
    moveTarget, setMoveTarget,
    teleportTarget, setTeleportTarget,
    showAvatarModal, setShowAvatarModal,
    showEmoteWheel, setShowEmoteWheel,
    showGamificacion, setShowGamificacion,
    cargoUsuario,
    incomingNudge, setIncomingNudge,
    incomingInvite, setIncomingInvite,
    mobileInputRef, isMobile,
    cardScreenPosRef,
    realtimePositionsRef,
    grantXP,
    handleAcceptInvite,

    // Domain hooks
    settings,
    chunks,
    recording,
    notifications,
    media,
    livekit,
    proximity,
    broadcast,
    webrtc,
    interactions,
  };
}
