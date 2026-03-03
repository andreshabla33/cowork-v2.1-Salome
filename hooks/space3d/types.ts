/**
 * @module hooks/space3d/types
 * Tipos e interfaces compartidas entre todos los hooks de Space3D.
 * Centraliza las definiciones para evitar duplicación y circular dependencies.
 */

import type { User, PresenceStatus, AutorizacionEmpresa, ZonaEmpresa } from '@/types';
import type { CameraSettings } from '@/components/CameraSettingsMenu';
import type { AudioSettings } from '@/components/BottomControlBar';
import type { JoystickInput } from '@/components/3d/MobileJoystick';
import type { EstadoEcsEspacio } from '@/lib/ecs/espacioEcs';
import type { RealtimeChunkManager, EventoRealtime } from '@/lib/realtimeChunkManager';
import type { GpuInfo } from '@/lib/gpuCapabilities';
import type { Room, LocalAudioTrack, LocalVideoTrack } from 'livekit-client';

// ========== Constantes globales ==========

export const MOVE_SPEED = 4;
export const RUN_SPEED = 8;
export const WORLD_SIZE = 100;
export const PROXIMITY_RADIUS = 180;
export const AUDIO_SPATIAL_RADIUS_FACTOR = 2;
export const TELEPORT_DISTANCE = 15;
export const CHAIR_SIT_RADIUS = 1.5;
export const CHAIR_POSITIONS_3D = [[8, 8], [12, 8], [8, 12], [12, 12], [8, 10], [12, 10]];
export const ZONA_SOLICITUD_RADIO = 140;
export const LOD_NEAR_DISTANCE = 25;
export const LOD_MID_DISTANCE = 60;
export const MOVEMENT_BROADCAST_MS = 100;
export const USAR_LIVEKIT = true;
export const PROXIMITY_COORD_THRESHOLD = 8;

// ICE Servers para WebRTC
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
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

// ========== Tipos auxiliares ==========

export type AvatarLodLevel = 'high' | 'mid' | 'low';
export type DireccionAvatar = User['direction'] | 'up' | 'down' | 'front-left' | 'front-right' | 'up-left' | 'up-right';

// ========== Interfaces de Props ==========

export interface VirtualSpace3DProps {
  theme?: string;
  isGameHubOpen?: boolean;
  isPlayingGame?: boolean;
  showroomMode?: boolean;
  showroomDuracionMin?: number;
  showroomNombreVisitante?: string;
}

// ========== Interfaces de retorno de hooks ==========

export interface UseUserSettingsReturn {
  userSettingsVersion: number;
  space3dSettings: ReturnType<typeof import('@/lib/userSettings').getSettingsSection>;
  meetingsSettings: ReturnType<typeof import('@/lib/userSettings').getSettingsSection>;
  notifSettings: ReturnType<typeof import('@/lib/userSettings').getSettingsSection>;
  performanceSettings: ReturnType<typeof import('@/lib/userSettings').getSettingsSection>;
  gpuInfo: GpuInfo | null;
  gpuRenderConfig: ReturnType<typeof import('@/lib/gpuCapabilities').adaptiveConfigFromTier> | null;
  radioInteresChunks: number;
  userMoveSpeed: number;
  userRunSpeed: number;
  userProximityRadius: number;
  maxDpr: number;
  minDpr: number;
  adaptiveDpr: number;
  setAdaptiveDpr: React.Dispatch<React.SetStateAction<number>>;
  enableDayNightCycle: boolean;
  cameraSettings: CameraSettings;
  setCameraSettings: React.Dispatch<React.SetStateAction<CameraSettings>>;
  audioSettings: AudioSettings;
  setAudioSettings: React.Dispatch<React.SetStateAction<AudioSettings>>;
  isInActiveCall: () => boolean;
}

export interface UseRecordingReturn {
  isRecording: boolean;
  setIsRecording: React.Dispatch<React.SetStateAction<boolean>>;
  recordingDuration: number;
  setRecordingDuration: React.Dispatch<React.SetStateAction<number>>;
  consentimientoAceptado: boolean;
  setConsentimientoAceptado: React.Dispatch<React.SetStateAction<boolean>>;
  tipoGrabacionActual: string | null;
  setTipoGrabacionActual: React.Dispatch<React.SetStateAction<string | null>>;
  recordingTrigger: boolean;
  setRecordingTrigger: React.Dispatch<React.SetStateAction<boolean>>;
  handleToggleRecording: () => void;
}

export interface UseNotificationsReturn {
  notificacionAutorizacion: {
    id: string;
    titulo: string;
    mensaje?: string | null;
    tipo: string;
    datos_extra?: Record<string, any> | null;
  } | null;
  setNotificacionAutorizacion: React.Dispatch<React.SetStateAction<UseNotificationsReturn['notificacionAutorizacion']>>;
  solicitudesEnviadas: AutorizacionEmpresa[];
  solicitandoAcceso: boolean;
  zonasEmpresa: ZonaEmpresa[];
  zonaAccesoProxima: { zona: ZonaEmpresa; distancia: number; pendiente: boolean } | null;
  handleSolicitarAccesoZona: () => Promise<void>;
  cargarAutorizaciones: () => Promise<void>;
  setZonaColisionadaId: React.Dispatch<React.SetStateAction<string | null>>;
}

export interface UseChunkSystemReturn {
  ecsStateRef: React.MutableRefObject<EstadoEcsEspacio>;
  chunkWorkerRef: React.MutableRefObject<Worker | null>;
  interpolacionWorkerRef: React.MutableRefObject<Worker | null>;
  posicionesInterpoladasRef: React.MutableRefObject<Map<string, { x: number; z: number; direction?: DireccionAvatar; isMoving?: boolean }>>;
  currentUserEcs: User;
  onlineUsersEcs: User[];
  usuariosEnChunks: User[];
  usuariosParaConexion: User[];
  usuariosParaMinimapa: User[];
  chunkActual: ReturnType<typeof import('@/lib/chunkSystem').obtenerChunk>;
  chunkVecinosRef: React.MutableRefObject<Set<string>>;
  usuariosVisiblesRef: React.MutableRefObject<Set<string>>;
  setPositionEcs: (x: number, y: number, direction?: string, isSitting?: boolean, isMoving?: boolean) => void;
  normalizarDireccion: (direccion?: string) => User['direction'] | undefined;
}

export interface UseMediaStreamReturn {
  stream: MediaStream | null;
  setStream: React.Dispatch<React.SetStateAction<MediaStream | null>>;
  processedStream: MediaStream | null;
  setProcessedStream: React.Dispatch<React.SetStateAction<MediaStream | null>>;
  screenStream: MediaStream | null;
  setScreenStream: React.Dispatch<React.SetStateAction<MediaStream | null>>;
  activeStreamRef: React.MutableRefObject<MediaStream | null>;
  activeScreenRef: React.MutableRefObject<MediaStream | null>;
  effectiveStream: MediaStream | null;
  effectiveStreamRef: React.MutableRefObject<MediaStream | null>;
  handleToggleScreenShare: () => Promise<void>;
  crearAudioProcesado: (track: MediaStreamTrack, nivel: 'standard' | 'enhanced') => Promise<MediaStreamTrack | null>;
  limpiarAudioProcesado: () => void;
}

export interface UseLiveKitReturn {
  livekitRoomRef: React.MutableRefObject<Room | null>;
  livekitConnected: boolean;
  remoteStreams: Map<string, MediaStream>;
  remoteScreenStreams: Map<string, MediaStream>;
  remoteAudioTracks: Map<string, MediaStreamTrack>;
  speakingUsers: Set<string>;
  setSpeakingUsers: React.Dispatch<React.SetStateAction<Set<string>>>;
  publicarTrackLocal: (track: MediaStreamTrack, tipo: 'audio' | 'video' | 'screen') => Promise<void>;
  despublicarTrackLocal: (tipo: 'audio' | 'video' | 'screen') => Promise<void>;
  sincronizarTracksLocales: () => Promise<void>;
  conectarLivekit: (roomName: string) => Promise<void>;
  limpiarLivekit: () => Promise<void>;
  enviarDataLivekit: (mensaje: { type: string; payload: Record<string, any> }, reliable?: boolean) => boolean;
  permitirMediaParticipante: (metadata?: string | null) => boolean;
}

export interface UseWebRTCReturn {
  peerConnectionsRef: React.MutableRefObject<Map<string, RTCPeerConnection>>;
  peerVideoTrackCountRef: React.MutableRefObject<Map<string, number>>;
  webrtcChannelRef: React.MutableRefObject<any>;
  realtimeChunkManagerRef: React.MutableRefObject<RealtimeChunkManager | null>;
  createPeerConnection: (peerId: string) => RTCPeerConnection;
  handleOffer: (offer: RTCSessionDescriptionInit, fromId: string) => Promise<void>;
  handleAnswer: (answer: RTCSessionDescriptionInit, fromId: string) => Promise<void>;
  handleIceCandidate: (candidate: RTCIceCandidateInit, fromId: string) => Promise<void>;
  initiateCall: (peerId: string) => Promise<void>;
}

export interface UseProximityReturn {
  stableProximityCoords: { x: number; y: number };
  usersInCall: User[];
  usersInCallIds: Set<string>;
  hasActiveCall: boolean;
  usersInAudioRange: User[];
  usersInAudioRangeIds: Set<string>;
  userDistances: Map<string, number>;
  remoteStreamsRouted: Map<string, MediaStream>;
  remoteScreenStreamsRouted: Map<string, MediaStream>;
  conversacionBloqueada: boolean;
  setConversacionBloqueada: React.Dispatch<React.SetStateAction<boolean>>;
  conversacionesBloqueadasRemoto: Map<string, string[]>;
  setConversacionesBloqueadasRemoto: React.Dispatch<React.SetStateAction<Map<string, string[]>>>;
  conversacionProximaBloqueada: { lockerId: string; participants: string[]; nombre: string } | null;
}

export interface UseBroadcastReturn {
  broadcastMovement: (x: number, y: number, direction: string, isMoving: boolean, animState?: string, reliable?: boolean) => void;
  manejarEventoInstantaneo: (mensaje: { type: string; payload: any }) => void;
  bloquearConversacion: () => void;
  handleSendMessage: () => Promise<void>;
  handleTriggerReaction: (emoji: string) => void;
  // UI state gestionado por broadcast (chat, emojis)
  showEmojis: boolean;
  setShowEmojis: React.Dispatch<React.SetStateAction<boolean>>;
  showChat: boolean;
  setShowChat: React.Dispatch<React.SetStateAction<boolean>>;
  showStatusPicker: boolean;
  setShowStatusPicker: React.Dispatch<React.SetStateAction<boolean>>;
  chatInput: string;
  setChatInput: React.Dispatch<React.SetStateAction<string>>;
  localMessage: string | null;
  remoteMessages: Map<string, string>;
  localReactions: Array<{ id: string; emoji: string }>;
  remoteReaction: { emoji: string; from: string; fromName: string } | null;
  incomingWave: { from: string; fromName: string } | null;
  setIncomingWave: React.Dispatch<React.SetStateAction<{ from: string; fromName: string } | null>>;
}

export interface UseGatherInteractionsReturn {
  selectedRemoteUser: User | null;
  setSelectedRemoteUser: React.Dispatch<React.SetStateAction<User | null>>;
  followTargetId: string | null;
  setFollowTargetId: React.Dispatch<React.SetStateAction<string | null>>;
  followTargetIdRef: React.MutableRefObject<string | null>;
  incomingNudge: { from: string; fromName: string } | null;
  setIncomingNudge: React.Dispatch<React.SetStateAction<{ from: string; fromName: string } | null>>;
  incomingInvite: { from: string; fromName: string; x: number; y: number } | null;
  setIncomingInvite: React.Dispatch<React.SetStateAction<{ from: string; fromName: string; x: number; y: number } | null>>;
  handleClickRemoteAvatar: (userId: string) => void;
  handleGoToUser: (userId: string) => void;
  handleNudgeUser: (userId: string) => void;
  handleInviteUser: (userId: string) => void;
  handleFollowUser: (userId: string) => void;
  handleWaveUser: (userId: string) => void;
  handleAcceptInvite: () => void;
  avatarInteractionsMemo: {
    onGoTo: (userId: string) => void;
    onNudge: (userId: string) => void;
    onInvite: (userId: string) => void;
    onFollow: (userId: string) => void;
    onWave: (userId: string) => void;
    followTargetId: string | null;
    profilePhoto: string | null;
  };
}

// ========== Interfaces de parámetros de hooks ==========

export interface UseUserSettingsParams {
  livekitRoomRef: React.MutableRefObject<Room | null>;
  hasActiveCallRef: React.MutableRefObject<boolean>;
  toggleMic: () => void;
  toggleCamera: () => void;
}

export interface UseChunkSystemParams {
  currentUser: User;
  onlineUsers: User[];
  empresasAutorizadas: string[];
  radioInteresChunks: number;
  setPosition: (x: number, y: number, direction?: User['direction'], isSitting?: boolean, isMoving?: boolean) => void;
}

export interface UseMediaStreamParams {
  currentUser: User;
  cameraSettings: CameraSettings;
  audioSettings: AudioSettings;
  toggleScreenShare: (value?: boolean) => void;
  peerConnectionsRef: React.MutableRefObject<Map<string, RTCPeerConnection>>;
  webrtcChannelRef: React.MutableRefObject<any>;
  livekitRoomRef: React.MutableRefObject<Room | null>;
  livekitConnected: boolean;
  publicarTrackLocal: (track: MediaStreamTrack, tipo: 'audio' | 'video' | 'screen') => Promise<void>;
  session: any;
}

export interface UseLiveKitParams {
  activeWorkspace: any;
  session: any;
  currentUser: User;
  empresasAutorizadas: string[];
  onlineUsers: User[];
  activeStreamRef: React.MutableRefObject<MediaStream | null>;
  activeScreenRef: React.MutableRefObject<MediaStream | null>;
  effectiveStreamRef: React.MutableRefObject<MediaStream | null>;
  stream: MediaStream | null;
  screenStream: MediaStream | null;
  processedStream: MediaStream | null;
  cameraSettings: CameraSettings;
  hasActiveCall: boolean;
  usersInCall: User[];
  usersInAudioRange: User[];
  conversacionesBloqueadasRemoto: Map<string, string[]>;
}

export interface UseWebRTCParams {
  activeWorkspace: any;
  session: any;
  currentUser: User;
  activeStreamRef: React.MutableRefObject<MediaStream | null>;
  activeScreenRef: React.MutableRefObject<MediaStream | null>;
  usuariosParaConexion: User[];
  stream: MediaStream | null;
  screenStream: MediaStream | null;
  hasActiveCall: boolean;
  ecsStateRef: React.MutableRefObject<EstadoEcsEspacio>;
  usuariosVisiblesRef: React.MutableRefObject<Set<string>>;
  radioInteresChunks: number;
  currentUserEcs: User;
  setRemoteStreams: React.Dispatch<React.SetStateAction<Map<string, MediaStream>>>;
  setRemoteScreenStreams: React.Dispatch<React.SetStateAction<Map<string, MediaStream>>>;
  manejarEventoInstantaneo: (mensaje: { type: string; payload: any }) => void;
}

export interface UseProximityParams {
  currentUserEcs: User;
  usuariosEnChunks: User[];
  session: any;
  currentUser: User;
  userProximityRadius: number;
  conversacionesBloqueadasRemoto: Map<string, string[]>;
  remoteStreams: Map<string, MediaStream>;
  remoteScreenStreams: Map<string, MediaStream>;
  speakingUsers: Set<string>;
  performanceSettings: any;
  usersInAudioRange: User[];
  selectedRemoteUser: User | null;
  setSelectedRemoteUser: React.Dispatch<React.SetStateAction<User | null>>;
  handleToggleScreenShare: () => Promise<void>;
}

export interface UseBroadcastParams {
  session: any;
  currentUser: User;
  currentUserEcs: User;
  activeWorkspace: any;
  usersInCall: User[];
  enviarDataLivekit: (mensaje: { type: string; payload: Record<string, any> }, reliable?: boolean) => boolean;
  webrtcChannelRef: React.MutableRefObject<any>;
  ecsStateRef: React.MutableRefObject<EstadoEcsEspacio>;
  usuariosVisiblesRef: React.MutableRefObject<Set<string>>;
  realtimePositionsRef: React.MutableRefObject<Map<string, any>>;
  conversacionBloqueada: boolean;
  setConversacionBloqueada: React.Dispatch<React.SetStateAction<boolean>>;
  setConversacionesBloqueadasRemoto: React.Dispatch<React.SetStateAction<Map<string, string[]>>>;
  grantXP: (accion: string, cooldownMs?: number) => void;
  notifSettings: any;
}

export interface UseGatherInteractionsParams {
  session: any;
  currentUser: User;
  currentUserEcs: User;
  usuariosEnChunks: User[];
  ecsStateRef: React.MutableRefObject<EstadoEcsEspacio>;
  enviarDataLivekit: (mensaje: { type: string; payload: Record<string, any> }, reliable?: boolean) => boolean;
  webrtcChannelRef: React.MutableRefObject<any>;
  grantXP: (accion: string, cooldownMs?: number) => void;
  setTeleportTarget: React.Dispatch<React.SetStateAction<{ x: number; z: number } | null>>;
  setMoveTarget: React.Dispatch<React.SetStateAction<{ x: number; z: number } | null>>;
}

export interface UseNotificationsParams {
  session: any;
  activeWorkspace: any;
  currentUser: User;
  empresasAutorizadas: string[];
  setEmpresasAutorizadas: (empresas: string[]) => void;
  currentUserEcs: User;
  notifSettings: any;
}
