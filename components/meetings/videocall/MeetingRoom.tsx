'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useTracks,
  useRoomContext,
  useLocalParticipant,
  Chat,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { Room, Track, RoomEvent } from 'livekit-client';
import { useStore } from '@/store/useStore';
import { supabase } from '@/lib/supabase';
import { otorgarXP, XP_POR_ACCION } from '@/lib/gamificacion';
import { MeetingControlBar, TipoReunion } from './MeetingControlBar';
import { TipoReunionUnificado, InvitadoExterno } from '@/types/meeting-types';
import { CargoLaboral, TipoGrabacionDetallado } from '../recording/types/analysis';
import { CustomParticipantTile } from './CustomParticipantTile';
import { ScreenShareViewer } from './ScreenShareViewer';
import { ViewModeSelector, ViewMode } from './ViewModeSelector';
import { RecordingManager } from '../recording/RecordingManager';

interface MeetingRoomProps {
  salaId: string;
  tokenInvitacion?: string;
  nombreInvitado?: string;
  tipoReunion?: TipoReunion;
  reunionId?: string;
  onLeave?: () => void;
  onError?: (error: string) => void;
}

interface TokenData {
  token: string;
  url: string;
  sala_nombre: string;
  sala_id?: string;
  participante_id: string;
  permisos: {
    canPublish: boolean;
    canSubscribe: boolean;
    roomAdmin: boolean;
  };
  tipo_reunion?: TipoReunionUnificado;
  tipo_grabacion?: string;
  reunion_id?: string;
  invitado_externo?: InvitadoExterno;
}

// Estilos por tema
const themeStyles = {
  dark: {
    bg: 'bg-[#0f0f1a]',
    card: 'bg-white/5 border-white/10',
    text: 'text-white',
    accent: 'bg-indigo-600 hover:bg-indigo-500',
    danger: 'bg-red-600 hover:bg-red-500',
  },
  arcade: {
    bg: 'bg-black',
    card: 'bg-black border-[#00ff41]/30',
    text: 'text-[#00ff41]',
    accent: 'bg-[#00ff41] text-black hover:bg-white',
    danger: 'bg-red-600 hover:bg-red-500',
  },
};

export const MeetingRoom: React.FC<MeetingRoomProps> = ({
  salaId,
  tokenInvitacion,
  nombreInvitado,
  tipoReunion: propTipoReunion,
  reunionId: propReunionId,
  onLeave,
  onError,
}) => {
  const { theme, currentUser, session, activeWorkspace } = useStore();
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const tokenFetchedRef = useRef(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  
  // Estados para tipo de reunión
  const [tipoReunion, setTipoReunion] = useState<TipoReunion>(propTipoReunion || 'equipo');
  const [reunionId, setReunionId] = useState<string | undefined>(propReunionId);
  const [showChat, setShowChat] = useState(false);
  const [cargoUsuario, setCargoUsuario] = useState<CargoLaboral>('colaborador');

  const s = themeStyles[theme as keyof typeof themeStyles] || themeStyles.dark;

  // Cargar cargo del usuario desde miembros_espacio
  useEffect(() => {
    const cargarCargo = async () => {
      if (!currentUser?.id || !activeWorkspace?.id) return;
      
      const { data } = await supabase
        .from('miembros_espacio')
        .select('cargo_id, cargo_ref:cargos!cargo_id(clave)')
        .eq('usuario_id', currentUser.id)
        .eq('espacio_id', activeWorkspace.id)
        .single();
      
      const clave = (data?.cargo_ref as any)?.clave;
      if (clave) {
        console.log('📋 Cargo del usuario (MeetingRoom):', clave);
        setCargoUsuario(clave as CargoLaboral);
      }
    };
    
    cargarCargo();
  }, [currentUser?.id, activeWorkspace?.id]);

  // Obtener token de LiveKit
  const fetchToken = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Si es usuario autenticado, agregar token de auth
      if (session?.access_token && !tokenInvitacion) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      const body: Record<string, any> = {};
      
      if (tokenInvitacion) {
        body.token_invitacion = tokenInvitacion;
        if (nombreInvitado) {
          body.nombre_invitado = nombreInvitado;
        }
      } else {
        body.sala_id = salaId;
      }

      const SUPABASE_URL = 'https://lcryrsdyrzotjqdxcwtp.supabase.co';
      console.log('🔵 Llamando Edge Function livekit-token...', { body });
      
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/livekit-token`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        }
      );

      console.log('📡 Response status:', response.status, response.statusText);

      const text = await response.text();
      console.log('📡 Response text:', text);

      if (!text) {
        throw new Error('Respuesta vacía del servidor. Verifica que LiveKit esté configurado.');
      }

      let data: TokenData;
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error(`Error parseando respuesta: ${text.substring(0, 200)}`);
      }

      if (!response.ok) {
        throw new Error((data as any).error || `Error ${response.status}: ${response.statusText}`);
      }

      setTokenData(data);
      
      // Usar tipo_reunion del token si viene (para invitados)
      if (data.tipo_reunion) {
        const tipoMap: Record<string, TipoReunion> = {
          'equipo': 'equipo',
          'deal': 'deal',
          'entrevista': 'entrevista'
        };
        setTipoReunion(tipoMap[data.tipo_reunion] || 'equipo');
      }
      if (data.reunion_id) {
        setReunionId(data.reunion_id);
      }
    } catch (err: any) {
      console.error('Error fetching token:', err);
      setError(err.message);
      onErrorRef.current?.(err.message);
    } finally {
      setLoading(false);
    }
  }, [salaId, tokenInvitacion, nombreInvitado, session?.access_token]);

  useEffect(() => {
    if (tokenFetchedRef.current) return;
    tokenFetchedRef.current = true;
    fetchToken();
  }, [fetchToken]);

  // Obtener tipo de reunión de la sala (para usuarios autenticados o invitados)
  // Solo se ejecuta una vez cuando tokenData está listo
  const [salaInfoFetched, setSalaInfoFetched] = useState(false);
  const [invitadoExterno, setInvitadoExterno] = useState<InvitadoExterno | null>(null);
  const [guestPermissions, setGuestPermissions] = useState<{ allowChat: boolean; allowVideo: boolean }>({ allowChat: true, allowVideo: true });
  
  useEffect(() => {
    if (propTipoReunion || salaInfoFetched || !tokenData) return;
    
    const fetchSalaInfo = async () => {
      // Mapeo de tipo BD a TipoReunion del ControlBar
      const tipoMapBD: Record<string, TipoReunion> = {
        'general': 'equipo',
        'deal': 'deal',
        'entrevista': 'entrevista'
      };
      // Mapeo de tipo unificado a TipoReunion del ControlBar
      const tipoMapUnificado: Record<TipoReunionUnificado, TipoReunion> = {
        'equipo': 'equipo',
        'one_to_one': 'equipo',
        'cliente': 'deal',
        'candidato': 'entrevista'
      };
      
      try {
        // Si es invitado, obtener tipo desde la invitación
        if (tokenInvitacion) {
          const { data, error: fnError } = await supabase.functions.invoke('validar-invitacion-reunion', {
            body: { token: tokenInvitacion }
          });

          if (fnError || data?.error) {
            throw new Error(fnError?.message || data?.error || 'Invitación no válida');
          }

          const salaData = data?.invitacion?.sala as any;
          if (salaData) {
            const config = salaData.configuracion;

            // Usar tipo_reunion de configuración si existe (nuevo sistema unificado)
            if (config?.tipo_reunion) {
              setTipoReunion(tipoMapUnificado[config.tipo_reunion as TipoReunionUnificado] || 'equipo');
            } else {
              setTipoReunion(tipoMapBD[salaData.tipo] || 'equipo');
            }

            if (config?.reunion_id) {
              setReunionId(config.reunion_id);
            }
            // Obtener info del invitado externo si existe
            if (config?.invitados_externos?.[0]) {
              setInvitadoExterno(config.invitados_externos[0]);
            }
          }
        }
        // Si es usuario autenticado con salaId
        else if (salaId) {
          const { data: sala } = await supabase
            .from('salas_reunion')
            .select('tipo, configuracion, espacio_id')
            .eq('id', salaId)
            .single();
          
          if (sala) {
            const config = sala.configuracion as any;
            
            // Usar tipo_reunion de configuración si existe (nuevo sistema unificado)
            if (config?.tipo_reunion) {
              setTipoReunion(tipoMapUnificado[config.tipo_reunion as TipoReunionUnificado] || 'equipo');
            } else {
              setTipoReunion(tipoMapBD[sala.tipo] || 'equipo');
            }
            
            if (config?.reunion_id) {
              setReunionId(config.reunion_id);
            }
            // Obtener info del invitado externo si existe
            if (config?.invitados_externos?.[0]) {
              setInvitadoExterno(config.invitados_externos[0]);
            }

            // Cargar guest permissions desde configuración del espacio
            if (sala.espacio_id) {
              const { data: espacio } = await supabase
                .from('espacios_trabajo')
                .select('configuracion')
                .eq('id', sala.espacio_id)
                .single();
              if (espacio?.configuracion?.guests) {
                setGuestPermissions({
                  allowChat: espacio.configuracion.guests.allowChat ?? true,
                  allowVideo: espacio.configuracion.guests.allowVideo ?? true,
                });
              }
            }
          }
        }
      } catch (err) {
        console.warn('No se pudo obtener info de la sala:', err);
      } finally {
        setSalaInfoFetched(true);
      }
    };
    
    fetchSalaInfo();
  }, [salaId, tokenInvitacion, propTipoReunion, tokenData, salaInfoFetched]);

  // La grabación ahora la maneja RecordingManager dentro de MeetingRoomContent

  // ============== HEARTBEAT (best practice: Zoom/Gather/LiveKit) ==============
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const HEARTBEAT_INTERVAL_MS = 60_000; // Ping cada 60s

  const startHeartbeat = useCallback(() => {
    if (tokenInvitacion || !currentUser) return; // No heartbeat para invitados externos
    // Heartbeat inmediato
    supabase.rpc('heartbeat_participante', { p_sala_id: salaId, p_usuario_id: currentUser.id }).then();
    // Intervalo
    heartbeatRef.current = setInterval(() => {
      supabase.rpc('heartbeat_participante', { p_sala_id: salaId, p_usuario_id: currentUser.id }).then();
    }, HEARTBEAT_INTERVAL_MS);
  }, [salaId, currentUser, tokenInvitacion]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  // Cleanup heartbeat al desmontar
  useEffect(() => {
    return () => stopHeartbeat();
  }, [stopHeartbeat]);

  // Manejar eventos de la sala
  const handleRoomConnected = useCallback(() => {
    console.log('Conectado a la sala');

    // Actualizar estado en Supabase
    if (!tokenInvitacion && currentUser) {
      supabase
        .from('participantes_sala')
        .update({ estado_participante: 'en_sala', ultima_actividad: new Date().toISOString() })
        .eq('sala_id', salaId)
        .eq('usuario_id', currentUser.id);
    }

    // Iniciar heartbeat
    startHeartbeat();

    // XP por reunión asistida (fire-and-forget, una sola vez al conectar)
    if (currentUser?.id && activeWorkspace?.id) {
      otorgarXP(currentUser.id, activeWorkspace.id, XP_POR_ACCION.reunion_asistida, 'reunion_asistida').then();
    }
  }, [salaId, currentUser, tokenInvitacion, startHeartbeat, activeWorkspace?.id]);

  const userInitiatedLeaveRef = useRef(false);

  const handleUserLeave = useCallback(() => {
    userInitiatedLeaveRef.current = true;
    onLeave?.();
  }, [onLeave]);

  const handleLiveKitError = useCallback((err: Error) => {
    console.error('LiveKit error:', err);
    const msg = err.message || '';
    const isRecoverable = msg.includes('Device in use') || msg.includes('NotReadableError') || msg.includes('NotAllowedError') || msg.includes('PC manager') || msg.includes('UnexpectedConnectionState') || msg.includes('already connected');
    if (!isRecoverable) {
      setError(msg);
    } else {
      console.warn('⚠️ Error recuperable de LiveKit (ignorado):', msg);
    }
  }, []);

  const handleToggleChat = useCallback(() => {
    setShowChat(prev => !prev);
  }, []);

  const handleRoomDisconnected = useCallback(() => {
    console.log('Desconectado de la sala');
    
    // Detener heartbeat
    stopHeartbeat();

    // Actualizar estado en Supabase
    if (!tokenInvitacion && currentUser) {
      supabase
        .from('participantes_sala')
        .update({ 
          estado_participante: 'desconectado',
          salido_en: new Date().toISOString()
        })
        .eq('sala_id', salaId)
        .eq('usuario_id', currentUser.id);
    }

    // Solo llamar onLeave si fue una desconexión intencional del usuario
    if (userInitiatedLeaveRef.current) {
      onLeave?.();
    }
  }, [salaId, currentUser, tokenInvitacion, onLeave, stopHeartbeat]);

  // Loading state
  if (loading) {
    return (
      <div className={`h-full w-full flex items-center justify-center ${s.bg}`}>
        <div className="text-center">
          <div className={`w-12 h-12 border-4 ${theme === 'arcade' ? 'border-[#00ff41]' : 'border-indigo-500'} border-t-transparent rounded-full animate-spin mx-auto mb-4`} />
          <p className={`${s.text} opacity-60`}>Conectando a la sala...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !tokenData) {
    return (
      <div className={`h-full w-full flex items-center justify-center ${s.bg}`}>
        <div className={`${s.card} border rounded-2xl p-8 max-w-md text-center`}>
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 className={`text-lg font-bold ${s.text} mb-2`}>Error de conexión</h3>
          <p className="text-sm opacity-60 mb-6">{error || 'No se pudo obtener acceso a la sala'}</p>
          <button
            onClick={fetchToken}
            className={`px-6 py-2.5 ${s.accent} rounded-xl text-sm font-bold transition-all`}
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`h-full w-full ${s.bg}`}>
      <LiveKitRoom
        serverUrl={tokenData.url}
        token={tokenData.token}
        connect={true}
        audio={true}
        video={true}
        onConnected={handleRoomConnected}
        onDisconnected={handleRoomDisconnected}
        onError={handleLiveKitError}
        data-lk-theme="default"
        style={{ height: '100%' }}
      >
        <MeetingRoomContent 
          theme={theme}
          isHost={tokenData.permisos.roomAdmin}
          isExternalGuest={!!tokenInvitacion}
          onLeave={handleUserLeave}
          tipoReunion={tipoReunion}
          salaId={salaId}
          reunionId={reunionId}
          showChat={showChat}
          onToggleChat={handleToggleChat}
          espacioId={activeWorkspace?.id || ''}
          userId={currentUser?.id || ''}
          userName={currentUser?.name || nombreInvitado || 'Participante'}
          userAvatar={currentUser?.profilePhoto}
          cargoUsuario={cargoUsuario}
          invitadosExternos={invitadoExterno ? [invitadoExterno] : []}
          guestPermissions={guestPermissions}
        />
        <RoomAudioRenderer />
      </LiveKitRoom>
    </div>
  );
};

// Componente interno con layout personalizado y MeetingControlBar
interface MeetingRoomContentProps {
  theme: string;
  isHost: boolean;
  isExternalGuest?: boolean;
  onLeave?: () => void;
  tipoReunion: TipoReunion;
  salaId: string;
  reunionId?: string;
  showChat: boolean;
  onToggleChat: () => void;
  espacioId: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  cargoUsuario: CargoLaboral;
  invitadosExternos?: InvitadoExterno[];
  guestPermissions?: { allowChat: boolean; allowVideo: boolean };
}

const MeetingRoomContent: React.FC<MeetingRoomContentProps> = ({ 
  theme, 
  isHost, 
  isExternalGuest = false,
  onLeave,
  tipoReunion,
  salaId,
  reunionId,
  showChat,
  onToggleChat,
  espacioId,
  userId,
  userName,
  userAvatar,
  cargoUsuario,
  invitadosExternos = [],
  guestPermissions = { allowChat: true, allowVideo: true },
}) => {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const [remoteRecording, setRemoteRecording] = useState<{isRecording: boolean; by: string} | null>(null);
  const [reactions, setReactions] = useState<{id: string; emoji: string; by: string}[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('gallery');

  // Publicar metadata del usuario (avatar)
  useEffect(() => {
    if (room.state === 'connected' && localParticipant && userAvatar) {
      const updateMetadata = async () => {
        try {
          const currentMeta = localParticipant.metadata ? JSON.parse(localParticipant.metadata) : {};
          // Solo actualizar si cambiÃ³ o no existe
          if (currentMeta.avatarUrl !== userAvatar) {
            const newMeta = { ...currentMeta, avatarUrl: userAvatar };
            await localParticipant.setMetadata(JSON.stringify(newMeta));
            console.log('📸 Avatar publicado en metadata:', userAvatar);
          }
        } catch (e) {
          console.error('Error actualizando metadata:', e);
        }
      };
      updateMetadata();
    }
  }, [room.state, localParticipant, userAvatar]);

  // Estados de grabación internos (manejados por RecordingManager)
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordingTrigger, setRecordingTrigger] = useState(false);

  // Estado para modal de consentimiento (invitado externo)
  const [guestConsentRequest, setGuestConsentRequest] = useState<{
    by: string;
    grabacionId: string;
  } | null>(null);

  // Extraer MediaStream local de LiveKit para RecordingManager
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  
  useEffect(() => {
    if (!localParticipant) return;
    
    const buildStream = () => {
      const tracks: MediaStreamTrack[] = [];
      
      // Obtener track de cámara
      const cameraPublication = localParticipant.getTrackPublication(Track.Source.Camera);
      if (cameraPublication?.track?.mediaStreamTrack) {
        tracks.push(cameraPublication.track.mediaStreamTrack);
      }
      
      // Obtener track de micrófono
      const micPublication = localParticipant.getTrackPublication(Track.Source.Microphone);
      if (micPublication?.track?.mediaStreamTrack) {
        tracks.push(micPublication.track.mediaStreamTrack);
      }
      
      if (tracks.length > 0) {
        setLocalStream(new MediaStream(tracks));
      }
    };
    
    buildStream();
    
    // Reconstruir cuando cambian los tracks
    const handleTrackChange = () => setTimeout(buildStream, 500);
    room?.on(RoomEvent.LocalTrackPublished, handleTrackChange);
    room?.on(RoomEvent.LocalTrackUnpublished, handleTrackChange);
    
    return () => {
      room?.off(RoomEvent.LocalTrackPublished, handleTrackChange);
      room?.off(RoomEvent.LocalTrackUnpublished, handleTrackChange);
    };
  }, [localParticipant, room]);

  // Toggle grabación via RecordingManager
  const handleToggleRecording = useCallback(() => {
    setRecordingTrigger(true);
  }, []);

  // Obtener tracks de video de todos los participantes
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );

  // Separar tracks de video y screen share
  const videoTracks = tracks.filter(track => 
    track.participant && 
    track.source === Track.Source.Camera
  );
  
  const screenShareTrack = tracks.find(track => 
    track.source === Track.Source.ScreenShare && 
    track.publication?.track
  );

  // Filtrar tracks válidos para evitar pantallas negras
  const validTracks = tracks.filter(track => 
    track.participant && 
    (track.publication?.track || track.source === Track.Source.Camera)
  );

  // Cambiar a modo sidebar cuando hay screen share
  useEffect(() => {
    if (screenShareTrack && viewMode === 'gallery') {
      setViewMode('sidebar');
    } else if (!screenShareTrack && viewMode === 'sidebar') {
      setViewMode('gallery');
    }
  }, [screenShareTrack, viewMode]);

  // Obtener hablante activo
  const activeSpeaker = room?.activeSpeakers?.[0]?.identity;

  // Broadcast estado de grabación a todos los participantes
  const prevRecordingRef = useRef(isRecording);
  useEffect(() => {
    if (!room || room.state !== 'connected') return;
    // No broadcast el estado inicial false (nadie necesita saber que NO se graba al entrar)
    if (!isRecording && !prevRecordingRef.current) return;
    prevRecordingRef.current = isRecording;
    
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify({
      type: 'recording_status',
      isRecording,
      by: room.localParticipant?.name || 'Anfitrión'
    }));
    
    room.localParticipant?.publishData(data, { reliable: true }).catch(() => {
      console.warn('⚠️ No se pudo enviar estado de grabación (room no lista)');
    });
  }, [isRecording, room]);

  // Enviar solicitud de consentimiento a invitado externo via DataChannel
  const handleRequestGuestConsent = useCallback((guestName: string, guestEmail: string, grabacionId: string) => {
    if (!room || room.state !== 'connected') return;
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify({
      type: 'consent_request',
      by: room.localParticipant?.name || 'Anfitrión',
      grabacionId,
      guestName,
      guestEmail,
    }));
    room.localParticipant?.publishData(data, { reliable: true }).catch(() => {
      console.warn('⚠️ No se pudo enviar solicitud de consentimiento');
    });
    console.log('📨 Solicitud de consentimiento enviada via DataChannel a:', guestName);
  }, [room]);

  // Responder a solicitud de consentimiento (desde el guest)
  const handleGuestConsentResponse = useCallback((accepted: boolean) => {
    if (!room || room.state !== 'connected' || !guestConsentRequest) return;
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify({
      type: 'consent_response',
      accepted,
      grabacionId: guestConsentRequest.grabacionId,
      by: room.localParticipant?.name || 'Invitado',
    }));
    room.localParticipant?.publishData(data, { reliable: true }).catch(() => {
      console.warn('⚠️ No se pudo enviar respuesta de consentimiento');
    });
    console.log(accepted ? '✅ Consentimiento aceptado' : '❌ Consentimiento rechazado');
    setGuestConsentRequest(null);
  }, [room, guestConsentRequest]);

  // Escuchar mensajes DataChannel (grabación, reacciones, consentimiento)
  useEffect(() => {
    if (!room) return;

    const handleDataReceived = (payload: Uint8Array, participant: any) => {
      try {
        const decoder = new TextDecoder();
        const message = JSON.parse(decoder.decode(payload));
        
        if (message.type === 'recording_status') {
          if (message.isRecording) {
            setRemoteRecording({ isRecording: true, by: message.by });
          } else {
            setRemoteRecording(null);
          }
        }
        
        // Manejar reacciones
        if (message.type === 'reaction') {
          const reactionId = `${Date.now()}-${Math.random()}`;
          const participantName = participant?.name || participant?.identity || 'Participante';
          setReactions(prev => [...prev, { id: reactionId, emoji: message.emoji, by: participantName }]);
          
          // Auto-remover después de 3 segundos
          setTimeout(() => {
            setReactions(prev => prev.filter(r => r.id !== reactionId));
          }, 3000);
        }

        // Invitado externo recibe solicitud de consentimiento
        if (message.type === 'consent_request' && isExternalGuest) {
          console.log('📋 Solicitud de consentimiento recibida de:', message.by);
          setGuestConsentRequest({
            by: message.by,
            grabacionId: message.grabacionId,
          });
        }

        // Host recibe respuesta de consentimiento del invitado
        if (message.type === 'consent_response' && !isExternalGuest) {
          const participantName = participant?.name || participant?.identity || 'Invitado';
          console.log(`📋 Respuesta consentimiento de ${participantName}: ${message.accepted ? 'ACEPTADO' : 'RECHAZADO'}`);
          // Actualizar en BD
          if (message.grabacionId) {
            supabase.from('grabaciones').update({
              consentimiento_evaluado: message.accepted,
              consentimiento_evaluado_fecha: new Date().toISOString(),
            }).eq('id', message.grabacionId).then(({ error }) => {
              if (error) console.warn('⚠️ Error actualizando consentimiento:', error);
              else console.log('✅ Consentimiento actualizado en BD');
            });
          }
        }
      } catch (e) {
        // Ignorar mensajes no JSON
      }
    };

    room.on(RoomEvent.DataReceived, handleDataReceived);
    return () => {
      room.off(RoomEvent.DataReceived, handleDataReceived);
    };
  }, [room, isExternalGuest]);

  return (
    <div className="relative h-full w-full bg-zinc-950 overflow-hidden">
      {/* Estilos globales para LiveKit */}
      <style>{`
        .lk-grid-layout {
          height: 100% !important;
          padding: 8px !important;
          gap: 8px !important;
          background: transparent !important;
        }
        .lk-participant-tile {
          border-radius: 12px !important;
          overflow: hidden !important;
          background: #18181b !important;
        }
        .lk-participant-placeholder {
          background: linear-gradient(135deg, #27272a 0%, #18181b 100%) !important;
        }
        .lk-participant-name {
          background: rgba(0,0,0,0.6) !important;
          backdrop-filter: blur(8px) !important;
          padding: 4px 10px !important;
          border-radius: 6px !important;
          font-size: 12px !important;
        }
        /* Chat estilos */
        .lk-chat-custom .lk-chat {
          height: 100% !important;
          display: flex !important;
          flex-direction: column !important;
          background: transparent !important;
        }
        .lk-chat-custom .lk-message-list,
        .lk-chat-custom .lk-chat-messages {
          flex: 1 !important;
          overflow-y: auto !important;
          padding: 12px !important;
        }
        .lk-chat-custom .lk-message,
        .lk-chat-custom .lk-chat-entry {
          margin-bottom: 12px !important;
          display: flex !important;
          flex-direction: column !important;
        }
        .lk-chat-custom .lk-message-sender,
        .lk-chat-custom .lk-chat-entry__name,
        .lk-chat-custom .lk-participant-name {
          font-weight: 600 !important;
          color: #a5b4fc !important;
          font-size: 11px !important;
          margin-bottom: 4px !important;
          display: block !important;
        }
        .lk-chat-custom .lk-message-body,
        .lk-chat-custom .lk-chat-entry__message,
        .lk-chat-custom .lk-message-text {
          background: rgba(255,255,255,0.08) !important;
          padding: 10px 14px !important;
          border-radius: 12px !important;
          color: white !important;
          font-size: 14px !important;
          word-break: break-word !important;
          line-height: 1.4 !important;
        }
        .lk-chat-custom .lk-chat-form,
        .lk-chat-custom .lk-message-form {
          padding: 12px !important;
          border-top: 1px solid rgba(255,255,255,0.1) !important;
          background: transparent !important;
        }
        .lk-chat-custom .lk-chat-form input,
        .lk-chat-custom .lk-message-form input,
        .lk-chat-custom .lk-form-control {
          width: 100% !important;
          background: rgba(255,255,255,0.08) !important;
          border: 1px solid rgba(255,255,255,0.1) !important;
          border-radius: 10px !important;
          padding: 12px 14px !important;
          color: white !important;
          font-size: 14px !important;
        }
        .lk-chat-custom input::placeholder {
          color: rgba(255,255,255,0.4) !important;
        }
        .lk-chat-custom input:focus {
          outline: none !important;
          border-color: rgba(99, 102, 241, 0.5) !important;
        }
        .lk-chat-custom .lk-button,
        .lk-chat-custom .lk-chat-form button {
          display: none !important;
        }
      `}</style>

      {/* Selector de vista */}
      <div className="absolute top-4 left-4 z-[100]">
        <ViewModeSelector
          currentMode={viewMode}
          onChange={setViewMode}
          hasScreenShare={!!screenShareTrack}
          participantCount={videoTracks.length}
        />
      </div>

      {/* Grid de participantes con nuevo layout */}
      <div className={`h-full w-full ${showChat ? 'pr-80' : ''} transition-all duration-300 pb-20`}>
        {screenShareTrack ? (
          // Layout con screen share
          <div className="h-full w-full flex flex-col lg:flex-row gap-2 p-2">
            {/* Pantalla compartida principal */}
            <div className={`${viewMode === 'sidebar' ? 'lg:flex-1' : 'flex-1'} min-h-0`}>
              <ScreenShareViewer
                isActive={true}
                sharerName={screenShareTrack.participant?.name || screenShareTrack.participant?.identity}
              >
                <video
                  ref={(el) => {
                    if (el && screenShareTrack.publication?.track) {
                      screenShareTrack.publication.track.attach(el);
                    }
                  }}
                  autoPlay
                  playsInline
                  className="w-full h-full object-contain"
                />
              </ScreenShareViewer>
            </div>
            
            {/* Strip de participantes */}
            <div className={`${viewMode === 'sidebar' ? 'lg:w-56' : 'h-28'} flex ${viewMode === 'sidebar' ? 'lg:flex-col' : 'flex-row'} gap-2 overflow-auto`}>
              {videoTracks.map((track, index) => (
                <div
                  key={track.participant?.identity || index}
                  className={`${viewMode === 'sidebar' ? 'aspect-video w-full' : 'aspect-video h-full'} rounded-lg overflow-hidden bg-zinc-900 shrink-0`}
                >
                  <CustomParticipantTile trackRef={track} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          // Layout normal (gallery o speaker)
          <div className={`h-full w-full p-2 ${
            viewMode === 'speaker' && videoTracks.length > 1
              ? 'flex flex-col gap-2'
              : `grid gap-2 auto-rows-fr ${
                  videoTracks.length <= 1 ? 'grid-cols-1' :
                  videoTracks.length <= 2 ? 'grid-cols-2' :
                  videoTracks.length <= 4 ? 'grid-cols-2' :
                  videoTracks.length <= 6 ? 'grid-cols-3' :
                  'grid-cols-3 lg:grid-cols-4'
                }`
          }`}>
            {viewMode === 'speaker' && videoTracks.length > 1 ? (
              <>
                {/* Speaker principal */}
                <div className="flex-1 min-h-0 rounded-xl overflow-hidden bg-zinc-900">
                  <CustomParticipantTile 
                    trackRef={videoTracks.find(t => t.participant?.identity === activeSpeaker) || videoTracks[0]} 
                  />
                </div>
                {/* Otros participantes */}
                <div className="h-24 lg:h-28 flex gap-2 overflow-x-auto justify-center">
                  {videoTracks
                    .filter(t => t.participant?.identity !== activeSpeaker)
                    .map((track, index) => (
                      <div
                        key={track.participant?.identity || index}
                        className="aspect-video h-full rounded-lg overflow-hidden bg-zinc-900 shrink-0"
                      >
                        <CustomParticipantTile trackRef={track} />
                      </div>
                    ))}
                </div>
              </>
            ) : (
              // Gallery view
              videoTracks.map((track, index) => (
                <div
                  key={track.participant?.identity || index}
                  className="rounded-xl overflow-hidden bg-zinc-900 min-h-0"
                >
                  <CustomParticipantTile trackRef={track} />
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Panel de Chat - Estilos mejorados (oculto si invitado externo sin permiso) */}
      {showChat && !(isExternalGuest && !guestPermissions.allowChat) && (
        <div className="absolute top-0 right-0 bottom-0 w-80 bg-zinc-900/98 backdrop-blur-xl border-l border-white/10 flex flex-col z-[100]">
          <div className="p-4 border-b border-white/10 flex items-center justify-between shrink-0">
            <h3 className="text-white font-bold text-sm">Chat de la reunión</h3>
            <button 
              onClick={onToggleChat}
              className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
            >
              <svg className="w-4 h-4 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-hidden min-h-0 pb-20">
            <style>{`
              .lk-chat {
                height: 100% !important;
                display: flex !important;
                flex-direction: column !important;
                background: transparent !important;
              }
              .lk-chat-messages, .lk-message-list {
                flex: 1 !important;
                overflow-y: auto !important;
                padding: 16px !important;
                display: flex !important;
                flex-direction: column !important;
                gap: 12px !important;
              }
              .lk-chat-entry, .lk-message {
                display: flex !important;
                flex-direction: column !important;
                gap: 4px !important;
              }
              .lk-chat-entry__name, .lk-message-sender, .lk-participant-name {
                font-weight: 600 !important;
                color: #a5b4fc !important;
                font-size: 12px !important;
              }
              .lk-chat-entry__message, .lk-message-body, .lk-message-text {
                background: rgba(255,255,255,0.08) !important;
                padding: 10px 14px !important;
                border-radius: 12px !important;
                color: white !important;
                font-size: 14px !important;
                line-height: 1.5 !important;
                word-break: break-word !important;
              }
              .lk-chat-form, .lk-message-form {
                padding: 16px !important;
                border-top: 1px solid rgba(255,255,255,0.1) !important;
                background: rgba(24,24,27,0.95) !important;
                position: absolute !important;
                bottom: 0 !important;
                left: 0 !important;
                right: 0 !important;
              }
              .lk-chat-form input, .lk-message-form input, .lk-form-control {
                width: 100% !important;
                background: rgba(255,255,255,0.08) !important;
                border: 1px solid rgba(255,255,255,0.15) !important;
                border-radius: 10px !important;
                padding: 12px 16px !important;
                color: white !important;
                font-size: 14px !important;
              }
              .lk-chat-form input::placeholder, .lk-message-form input::placeholder {
                color: rgba(255,255,255,0.4) !important;
              }
              .lk-chat-form input:focus, .lk-message-form input:focus {
                outline: none !important;
                border-color: #6366f1 !important;
              }
              .lk-chat-form button, .lk-button {
                display: none !important;
              }
            `}</style>
            <Chat style={{ height: '100%' }} />
          </div>
        </div>
      )}

      {/* Reacciones flotantes */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-[300]">
        {reactions.map((reaction, index) => (
          <div
            key={reaction.id}
            className="absolute animate-bounce text-6xl"
            style={{
              left: `${(index % 3 - 1) * 80}px`,
              animation: 'floatUp 3s ease-out forwards',
            }}
          >
            {reaction.emoji}
          </div>
        ))}
      </div>
      <style>{`
        @keyframes floatUp {
          0% { opacity: 1; transform: translateY(0) scale(1); }
          50% { opacity: 1; transform: translateY(-50px) scale(1.2); }
          100% { opacity: 0; transform: translateY(-120px) scale(0.8); }
        }
      `}</style>

      {/* Barra de controles - indicador de grabación integrado inline */}
      <MeetingControlBar
        onLeave={onLeave || (() => {})}
        onToggleChat={onToggleChat}
        showChat={showChat}
        tipoReunion={tipoReunion}
        salaId={salaId}
        reunionId={reunionId}
        isRecording={isRecording}
        recordingDuration={recordingDuration}
        onStartRecording={handleToggleRecording}
        onStopRecording={handleToggleRecording}
        showRecordingButton={isHost || !isExternalGuest}
        remoteRecordingBy={!isRecording && remoteRecording?.isRecording ? remoteRecording.by : null}
      />

      {/* RecordingManager con análisis conductual - headless mode (UI via MeetingControlBar) */}
      {(isHost || !isExternalGuest) && (
        <RecordingManager
          espacioId={espacioId}
          userId={userId}
          userName={userName}
          cargoUsuario={cargoUsuario}
          reunionTitulo={`Videollamada ${tipoReunion} - ${new Date().toLocaleDateString('es-ES')}`}
          stream={localStream}
          usuariosEnLlamada={
            room?.remoteParticipants 
              ? Array.from(room.remoteParticipants.values()).map(p => {
                  // Buscar si este participante coincide con un invitado externo (por nombre o identity)
                  const externo = invitadosExternos.find(inv => 
                    p.name?.toLowerCase().includes(inv.nombre.toLowerCase()) ||
                    p.identity.startsWith('guest_')
                  );
                  return {
                    id: p.identity,
                    nombre: p.name || p.identity,
                    email: externo?.email,
                  };
                })
              : []
          }
          onRecordingStateChange={(recording) => {
            setIsRecording(recording);
            if (!recording) {
              setRecordingDuration(0);
            }
          }}
          onDurationChange={(duration) => setRecordingDuration(duration)}
          onProcessingComplete={(resultado) => {
            console.log('✅ Análisis conductual completado en videollamada:', resultado?.tipo_grabacion);
          }}
          preselectedTipoGrabacion={{
            equipo: 'equipo' as TipoGrabacionDetallado,
            deal: 'deals' as TipoGrabacionDetallado,
            entrevista: 'rrhh_entrevista' as TipoGrabacionDetallado,
          }[tipoReunion] || undefined}
          headlessMode={true}
          externalTrigger={recordingTrigger}
          onExternalTriggerHandled={() => setRecordingTrigger(false)}
          onRequestGuestConsent={handleRequestGuestConsent}
        />
      )}

      {/* Modal de consentimiento para invitado externo */}
      {guestConsentRequest && isExternalGuest && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 max-w-md mx-4 shadow-2xl">
            <div className="text-center mb-4">
              <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-amber-500/20 flex items-center justify-center">
                <svg className="w-7 h-7 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-white mb-1">Solicitud de grabaci\u00F3n</h3>
              <p className="text-sm text-zinc-400">
                <span className="text-indigo-400 font-semibold">{guestConsentRequest.by}</span> desea grabar esta reuni\u00F3n con an\u00E1lisis conductual.
              </p>
            </div>
            <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-4 mb-5 text-xs text-zinc-400 space-y-2">
              <p>\u2022 Se analizar\u00E1n expresiones faciales, tono de voz y lenguaje corporal</p>
              <p>\u2022 Los datos se usan exclusivamente para evaluaci\u00F3n profesional</p>
              <p>\u2022 Puedes rechazar sin afectar tu participaci\u00F3n en la reuni\u00F3n</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => handleGuestConsentResponse(false)}
                className="flex-1 px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-sm font-medium transition-colors"
              >
                Rechazar
              </button>
              <button
                onClick={() => handleGuestConsentResponse(true)}
                className="flex-1 px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-emerald-500/20"
              >
                Aceptar grabaci\u00F3n
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MeetingRoom;
