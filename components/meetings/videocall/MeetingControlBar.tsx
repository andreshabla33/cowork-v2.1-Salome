/**
 * MeetingControlBar - Barra de controles para videollamadas LiveKit
 * 
 * Estilo Glassmorphism 2026 - Consistente con BottomControlBar del espacio virtual
 * Incluye: Mic, Cámara, Compartir pantalla, Chat, Reacciones, Grabar, Salir
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  useLocalParticipant,
  useRoomContext,
  useTracks,
} from '@livekit/components-react';
import { Track, RoomEvent } from 'livekit-client';

// ============== TIPOS ==============
export type TipoReunion = 'equipo' | 'deal' | 'entrevista';

interface MeetingControlBarProps {
  onLeave: () => void;
  onToggleChat?: () => void;
  showChat?: boolean;
  tipoReunion?: TipoReunion;
  salaId?: string;
  reunionId?: string;
  // Grabación
  isRecording?: boolean;
  recordingDuration?: number;
  onStartRecording?: () => void;
  onStopRecording?: () => void;
  showRecordingButton?: boolean;
  remoteRecordingBy?: string | null;
  // Navegación
  onGoToVirtualSpace?: () => void;
}

// Configuración de tipos de reunión para mostrar badge
const TIPO_REUNION_CONFIG = {
  equipo: { label: 'Equipo', icon: '👥', color: 'from-blue-500 to-cyan-500' },
  deal: { label: 'Cliente', icon: '💼', color: 'from-emerald-500 to-teal-500' },
  entrevista: { label: 'Candidato', icon: '🎯', color: 'from-purple-500 to-pink-500' },
};

export const MeetingControlBar: React.FC<MeetingControlBarProps> = ({
  onLeave,
  onToggleChat,
  showChat = false,
  tipoReunion = 'equipo',
  salaId,
  reunionId,
  isRecording = false,
  recordingDuration = 0,
  onStartRecording,
  onStopRecording,
  showRecordingButton = true,
  remoteRecordingBy = null,
  onGoToVirtualSpace,
}) => {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  
  // Estados locales
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showEmojis, setShowEmojis] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  // Emojis para reacciones
  const emojis = ['👍', '🔥', '❤️', '👏', '😂', '😮', '🚀', '✨'];

  // Sincronizar estados con LiveKit (incluye re-sync al conectar)
  useEffect(() => {
    if (localParticipant) {
      setIsMicEnabled(localParticipant.isMicrophoneEnabled);
      setIsCameraEnabled(localParticipant.isCameraEnabled);
      setIsScreenSharing(localParticipant.isScreenShareEnabled);
    }
  }, [localParticipant]);

  // Escuchar cambios de tracks + re-sync al conectar (fix: botones desincronizados)
  useEffect(() => {
    if (!room) return;

    const syncState = () => {
      if (localParticipant) {
        setIsMicEnabled(localParticipant.isMicrophoneEnabled);
        setIsCameraEnabled(localParticipant.isCameraEnabled);
        setIsScreenSharing(localParticipant.isScreenShareEnabled);
      }
    };

    room.on(RoomEvent.TrackMuted, syncState);
    room.on(RoomEvent.TrackUnmuted, syncState);
    room.on(RoomEvent.LocalTrackPublished, syncState);
    room.on(RoomEvent.LocalTrackUnpublished, syncState);
    room.on(RoomEvent.Connected, syncState);

    // Re-sync después de 1s para capturar tracks que se publican con delay
    const delaySync = setTimeout(syncState, 1000);

    return () => {
      room.off(RoomEvent.TrackMuted, syncState);
      room.off(RoomEvent.TrackUnmuted, syncState);
      room.off(RoomEvent.LocalTrackPublished, syncState);
      room.off(RoomEvent.LocalTrackUnpublished, syncState);
      room.off(RoomEvent.Connected, syncState);
      clearTimeout(delaySync);
    };
  }, [room, localParticipant]);

  // Toggle micrófono
  const toggleMic = useCallback(async () => {
    if (!localParticipant) {
      console.warn('[MeetingControlBar] localParticipant no disponible para toggleMic');
      return;
    }
    try {
      await localParticipant.setMicrophoneEnabled(!isMicEnabled);
      setIsMicEnabled(!isMicEnabled);
    } catch (err) {
      console.error('[MeetingControlBar] Error toggling mic:', err);
      // Re-sync estado real
      setIsMicEnabled(localParticipant.isMicrophoneEnabled);
    }
  }, [localParticipant, isMicEnabled]);

  // Toggle cámara
  const toggleCamera = useCallback(async () => {
    if (!localParticipant) {
      console.warn('[MeetingControlBar] localParticipant no disponible para toggleCamera');
      return;
    }
    try {
      await localParticipant.setCameraEnabled(!isCameraEnabled);
      setIsCameraEnabled(!isCameraEnabled);
    } catch (err) {
      console.error('[MeetingControlBar] Error toggling camera:', err);
      // Re-sync estado real
      setIsCameraEnabled(localParticipant.isCameraEnabled);
    }
  }, [localParticipant, isCameraEnabled]);

  // Toggle compartir pantalla
  const toggleScreenShare = useCallback(async () => {
    if (localParticipant) {
      if (isScreenSharing) {
        await localParticipant.setScreenShareEnabled(false);
      } else {
        await localParticipant.setScreenShareEnabled(true);
      }
      setIsScreenSharing(!isScreenSharing);
    }
  }, [localParticipant, isScreenSharing]);

  // Enviar reacción via DataChannel
  const sendReaction = useCallback((emoji: string) => {
    if (room) {
      const encoder = new TextEncoder();
      const data = encoder.encode(JSON.stringify({ type: 'reaction', emoji }));
      room.localParticipant.publishData(data, { reliable: true });
    }
  }, [room]);

  // Manejar salida
  const handleLeave = useCallback(() => {
    if (isRecording) {
      setShowLeaveConfirm(true);
    } else {
      onLeave();
    }
  }, [isRecording, onLeave]);

  // Formatear duración de grabación
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const tipoConfig = TIPO_REUNION_CONFIG[tipoReunion];

  return (
    <>
      {/* Barra de controles - Glassmorphism 2026 */}
      <div className="absolute bottom-4 md:bottom-6 left-1/2 -translate-x-1/2 z-[200] flex items-end gap-1.5 md:gap-2 max-w-[95vw]">
        {/* Badge de tipo de reunión */}
        <div className={`px-3 py-1.5 rounded-full bg-gradient-to-r ${tipoConfig.color} text-white text-xs font-medium flex items-center gap-1.5 shadow-lg`}>
          <span>{tipoConfig.icon}</span>
          <span>{tipoConfig.label}</span>
        </div>

        {/* Barra Principal */}
        <div className="flex items-center gap-1.5 p-1.5 rounded-2xl bg-black/20 backdrop-blur-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.3)] transition-all duration-300 hover:bg-black/30 hover:border-white/20">
          
          {/* Micrófono */}
          <button
            onClick={toggleMic}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 ${
              isMicEnabled ? 'bg-zinc-700 text-white' : 'bg-red-500/90 text-white'
            }`}
            title={isMicEnabled ? "Silenciar" : "Activar micrófono"}
          >
            {isMicEnabled ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
            )}
          </button>

          {/* Cámara */}
          <button
            onClick={toggleCamera}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 ${
              isCameraEnabled ? 'bg-zinc-700 text-white' : 'bg-red-500/90 text-white'
            }`}
            title={isCameraEnabled ? "Apagar cámara" : "Activar cámara"}
          >
            {isCameraEnabled ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            )}
          </button>

          <div className="w-px h-6 bg-white/10 mx-0.5"></div>

          {/* Compartir Pantalla */}
          <button
            onClick={toggleScreenShare}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 ${
              isScreenSharing ? 'bg-indigo-500 text-white' : 'bg-transparent text-white/70 hover:bg-white/10 hover:text-white'
            }`}
            title={isScreenSharing ? "Dejar de compartir" : "Compartir pantalla"}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </button>

          <div className="w-px h-6 bg-white/10 mx-0.5"></div>

          {/* Chat */}
          {onToggleChat && (
            <button
              onClick={onToggleChat}
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 ${
                showChat ? 'bg-blue-500 text-white' : 'bg-transparent text-white/70 hover:bg-white/10 hover:text-white'
              }`}
              title="Chat"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </button>
          )}

          {/* Reacciones */}
          <div className="relative">
            <button
              onClick={() => setShowEmojis(!showEmojis)}
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 ${
                showEmojis ? 'bg-amber-500 text-white' : 'bg-transparent text-white/70 hover:bg-white/10 hover:text-white'
              }`}
              title="Reacciones"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>

            {/* Emoji Picker */}
            {showEmojis && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
                <div className="px-2 py-1.5 bg-black/80 backdrop-blur-xl rounded-xl border border-white/10 flex gap-0.5">
                  {emojis.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => {
                        sendReaction(emoji);
                        setShowEmojis(false);
                      }}
                      className="w-8 h-8 flex items-center justify-center text-lg rounded-lg transition-all duration-150 hover:bg-white/20 hover:scale-110 active:scale-90"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Separador antes de grabación */}
          {showRecordingButton && <div className="w-px h-6 bg-white/10 mx-0.5"></div>}

          {/* Grabación */}
          {showRecordingButton && (
            isRecording ? (
              <div className="flex items-center gap-2 pl-2 pr-1 py-1 rounded-xl bg-red-500/15 border border-red-500/30">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </span>
                <span className="text-xs font-mono text-red-400 tabular-nums min-w-[36px]">
                  {formatDuration(recordingDuration)}
                </span>
                <button
                  onClick={onStopRecording}
                  className="w-7 h-7 rounded-lg bg-red-500 hover:bg-red-600 flex items-center justify-center transition-colors"
                  title="Detener grabación"
                >
                  <div className="w-2.5 h-2.5 bg-white rounded-sm"></div>
                </button>
              </div>
            ) : remoteRecordingBy ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </span>
                <span className="text-xs font-medium text-red-400">Grabando</span>
              </div>
            ) : (
              <button
                onClick={onStartRecording}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white transition-all duration-300"
                title="Iniciar grabación"
              >
                <div className="w-3 h-3 rounded-full bg-red-500"></div>
                <span className="text-xs font-medium text-white/90">Grabar</span>
              </button>
            )
          )}

          {/* Indicador para quien NO tiene botón de grabar pero alguien graba */}
          {!showRecordingButton && remoteRecordingBy && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
              </span>
              <span className="text-xs font-medium text-red-400">Grabando</span>
            </div>
          )}

          <div className="w-px h-6 bg-white/10 mx-0.5"></div>

          {/* Botón Ir al Espacio Virtual */}
          {onGoToVirtualSpace && (
            <button
              onClick={onGoToVirtualSpace}
              className="w-10 h-10 rounded-xl bg-transparent text-white/70 hover:bg-indigo-500/20 hover:text-indigo-400 flex items-center justify-center transition-all duration-300"
              title="Ir al espacio virtual"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </button>
          )}

          {/* Botón Salir */}
          <button
            onClick={handleLeave}
            className="w-10 h-10 rounded-xl bg-red-500/80 hover:bg-red-500 text-white flex items-center justify-center transition-all duration-300"
            title="Salir de la reunión"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>

      {/* Modal de confirmación si hay grabación activa */}
      {showLeaveConfirm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[300] flex items-center justify-center p-4">
          <div className="bg-zinc-900 rounded-2xl p-6 max-w-sm w-full border border-white/10 shadow-2xl">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
                <span className="text-3xl">⚠️</span>
              </div>
              <h3 className="text-white font-bold text-lg mb-2">Grabación en curso</h3>
              <p className="text-white/70 text-sm mb-6">
                Si sales ahora, la grabación se detendrá y se guardará automáticamente.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowLeaveConfirm(false)}
                  className="flex-1 px-4 py-2.5 bg-white/10 hover:bg-white/20 rounded-xl text-white font-medium transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    onStopRecording?.();
                    setTimeout(onLeave, 500);
                  }}
                  className="flex-1 px-4 py-2.5 bg-red-500 hover:bg-red-600 rounded-xl text-white font-medium transition-colors"
                >
                  Salir
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default MeetingControlBar;
