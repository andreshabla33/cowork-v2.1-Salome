/**
 * @module hooks/space3d/useLiveKit
 * Hook para gestión completa de LiveKit: conexión, publicación/despublicación
 * de tracks, suscripción selectiva por proximidad, speaker detection, audio espacial.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Room, RoomEvent, Track, VideoPresets,
  LocalAudioTrack, LocalVideoTrack, RemoteTrackPublication,
} from 'livekit-client';
import type { User } from '@/types';
import { crearSalaLivekitPorEspacio, obtenerTokenLivekitEspacio } from '@/lib/livekitService';
import { USAR_LIVEKIT, PROXIMITY_RADIUS, type UseLiveKitReturn } from './types';

export function useLiveKit(params: {
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
  cameraSettings: { backgroundEffect: string };
  hasActiveCall: boolean;
  usersInCall: User[];
  usersInAudioRange: User[];
  conversacionesBloqueadasRemoto: Map<string, string[]>;
}): UseLiveKitReturn {
  const {
    activeWorkspace, session, currentUser, empresasAutorizadas, onlineUsers,
    activeStreamRef, activeScreenRef, effectiveStreamRef,
    stream, screenStream, processedStream, cameraSettings,
    hasActiveCall, usersInCall, usersInAudioRange, conversacionesBloqueadasRemoto,
  } = params;

  // ========== State ==========
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [remoteScreenStreams, setRemoteScreenStreams] = useState<Map<string, MediaStream>>(new Map());
  const [remoteAudioTracks, setRemoteAudioTracks] = useState<Map<string, MediaStreamTrack>>(new Map());
  const [livekitConnected, setLivekitConnected] = useState(false);
  const [speakingUsers, setSpeakingUsers] = useState<Set<string>>(new Set());

  // ========== Refs ==========
  const livekitRoomRef = useRef<Room | null>(null);
  const livekitRoomNameRef = useRef<string | null>(null);
  const livekitConnectingRef = useRef(false);
  const livekitLocalTracksRef = useRef<Partial<Record<'audio' | 'video' | 'screen', LocalAudioTrack | LocalVideoTrack>>>({});
  const selectedCameraIdRef = useRef<string>('');

  // ========== Helpers ==========
  const obtenerEmpresaParticipante = useCallback((metadata?: string | null) => {
    if (!metadata) return null;
    try { return JSON.parse(metadata)?.empresa_id ?? null; } catch { return null; }
  }, []);

  const permitirMediaParticipante = useCallback((metadata?: string | null) => {
    if (!currentUser.empresa_id) return true;
    const empresaParticipante = obtenerEmpresaParticipante(metadata);
    if (!empresaParticipante) return true;
    if (empresaParticipante === currentUser.empresa_id) return true;
    return empresasAutorizadas.includes(empresaParticipante);
  }, [currentUser.empresa_id, obtenerEmpresaParticipante, empresasAutorizadas]);

  // ========== Track management ==========
  const despublicarTrackLocal = useCallback(async (tipo: 'audio' | 'video' | 'screen') => {
    const room = livekitRoomRef.current;
    const existing = livekitLocalTracksRef.current[tipo];
    if (!room || !existing) return;
    try { room.localParticipant.unpublishTrack(existing); } catch (e) {
      console.warn('Error despublicando track LiveKit:', e);
    }
    existing.stop();
    livekitLocalTracksRef.current[tipo] = undefined;
  }, []);

  const publicarTrackLocal = useCallback(async (track: MediaStreamTrack, tipo: 'audio' | 'video' | 'screen') => {
    const room = livekitRoomRef.current;
    if (!room || room.state !== 'connected') return;
    const existing = livekitLocalTracksRef.current[tipo];
    if (existing?.mediaStreamTrack?.id === track.id) return;
    if (existing && existing.mediaStreamTrack) {
      try {
        await existing.replaceTrack(track);
        console.log(`[LIVEKIT] Track ${tipo} reemplazado sin interrupción`);
        return;
      } catch (error) {
        console.warn(`[LIVEKIT] replaceTrack falló para ${tipo}, re-publicando:`, error);
        try { room.localParticipant.unpublishTrack(existing); } catch (_) {}
        existing.stop();
      }
    }
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
    console.log(`[LIVEKIT] Track ${tipo} publicado`);
  }, []);

  const sincronizarTracksLocales = useCallback(async () => {
    if (!USAR_LIVEKIT) return;
    const room = livekitRoomRef.current;
    if (!room || room.state !== 'connected') return;

    const streamActual = activeStreamRef.current;
    const audioTrack = streamActual?.getAudioTracks()[0];
    if (audioTrack) {
      await publicarTrackLocal(audioTrack, 'audio');
      audioTrack.enabled = !!currentUser.isMicOn;
    } else {
      await despublicarTrackLocal('audio');
    }

    if (currentUser.isCameraOn) {
      let videoTrack = effectiveStreamRef.current?.getVideoTracks().find(t => t.readyState === 'live');
      if (!videoTrack) videoTrack = streamActual?.getVideoTracks().find(t => t.readyState === 'live');
      if (videoTrack) {
        await publicarTrackLocal(videoTrack, 'video');
      } else {
        await despublicarTrackLocal('video');
      }
    } else {
      await despublicarTrackLocal('video');
    }

    if (currentUser.isScreenSharing) {
      const screenTrack = activeScreenRef.current?.getVideoTracks()[0];
      if (screenTrack) await publicarTrackLocal(screenTrack, 'screen');
      else await despublicarTrackLocal('screen');
    } else {
      await despublicarTrackLocal('screen');
    }
  }, [currentUser.isMicOn, currentUser.isCameraOn, currentUser.isScreenSharing, publicarTrackLocal, despublicarTrackLocal]);

  // ========== Cleanup ==========
  const limpiarLivekit = useCallback(async () => {
    const room = livekitRoomRef.current;
    if (room) { room.removeAllListeners(); await room.disconnect(); }
    if (livekitLocalTracksRef.current.audio) livekitLocalTracksRef.current.audio.stop();
    if (livekitLocalTracksRef.current.video) livekitLocalTracksRef.current.video.stop();
    if (livekitLocalTracksRef.current.screen) livekitLocalTracksRef.current.screen.stop();
    livekitRoomRef.current = null;
    livekitRoomNameRef.current = null;
    setLivekitConnected(false);
    setRemoteStreams(new Map());
    setRemoteScreenStreams(new Map());
    setRemoteAudioTracks(new Map());
    livekitLocalTracksRef.current = {};
  }, []);

  // ========== Connect ==========
  const conectarLivekit = useCallback(async (roomName: string) => {
    if (!USAR_LIVEKIT || !activeWorkspace?.id || !session?.access_token) return;
    if (livekitRoomNameRef.current === roomName) return;
    if (livekitConnectingRef.current) return;

    try {
      livekitConnectingRef.current = true;
      await limpiarLivekit();

      const tokenData = await obtenerTokenLivekitEspacio({
        roomName, espacioId: activeWorkspace.id,
        accessToken: session.access_token,
        empresaId: currentUser.empresa_id,
        departamentoId: currentUser.departamento_id,
      });

      const room = new Room({
        adaptiveStream: true, dynacast: true,
        reconnectPolicy: {
          nextRetryDelayInMs: (ctx) => ctx.retryCount > 5 ? null : Math.min(1000 * Math.pow(2, ctx.retryCount), 16000),
        },
        publishDefaults: {
          simulcast: true,
          videoSimulcastLayers: [VideoPresets.h90, VideoPresets.h216, VideoPresets.h540],
          screenShareSimulcastLayers: [],
          screenShareEncoding: { maxBitrate: 2_500_000, maxFramerate: 15 },
        },
      });

      room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        if (!participant || !track || !permitirMediaParticipante(participant.metadata)) return;
        if (track.kind === Track.Kind.Video) {
          const s = new MediaStream([track.mediaStreamTrack]);
          if (track.source === Track.Source.ScreenShare) {
            setRemoteScreenStreams(prev => new Map(prev).set(participant.identity, s));
          } else {
            setRemoteStreams(prev => new Map(prev).set(participant.identity, s));
          }
        }
        if (track.kind === Track.Kind.Audio) {
          setRemoteAudioTracks(prev => new Map(prev).set(participant.identity, track.mediaStreamTrack));
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
        if (!participant || !track) return;
        if (track.kind === Track.Kind.Video) {
          const setter = track.source === Track.Source.ScreenShare ? setRemoteScreenStreams : setRemoteStreams;
          setter(prev => {
            const existing = prev.get(participant.identity);
            if (existing) {
              const existingId = existing.getVideoTracks()[0]?.id;
              if (existingId && existingId !== track.mediaStreamTrack?.id) return prev;
            }
            const next = new Map(prev); next.delete(participant.identity); return next;
          });
        }
        if (track.kind === Track.Kind.Audio) {
          setRemoteAudioTracks(prev => {
            const existing = prev.get(participant.identity);
            if (existing && existing.id !== track.mediaStreamTrack?.id) return prev;
            const next = new Map(prev); next.delete(participant.identity); return next;
          });
        }
      });

      room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        setRemoteStreams(prev => { const n = new Map(prev); n.delete(participant.identity); return n; });
        setRemoteScreenStreams(prev => { const n = new Map(prev); n.delete(participant.identity); return n; });
        setRemoteAudioTracks(prev => { const n = new Map(prev); n.delete(participant.identity); return n; });
      });

      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const active = new Set(speakers.map(p => p.identity));
        if (room.localParticipant.isSpeaking) active.add(room.localParticipant.identity);
        setSpeakingUsers(active);
      });

      room.on(RoomEvent.Disconnected, () => {
        livekitRoomNameRef.current = null; livekitRoomRef.current = null; setLivekitConnected(false);
      });
      room.on(RoomEvent.Reconnecting, () => console.log('[LIVEKIT] Reconnecting...'));
      room.on(RoomEvent.Reconnected, () => console.log('[LIVEKIT] Reconnected'));

      await room.connect(tokenData.url, tokenData.token, { autoSubscribe: false });
      livekitRoomRef.current = room;
      livekitRoomNameRef.current = roomName;
      livekitConnectingRef.current = false;
      setLivekitConnected(true);
    } catch (err: any) {
      console.error('[LIVEKIT] Connection failed:', err.message);
      livekitRoomNameRef.current = null; livekitRoomRef.current = null;
      livekitConnectingRef.current = false; setLivekitConnected(false);
    }
  }, [activeWorkspace?.id, session?.access_token, currentUser.empresa_id, currentUser.departamento_id, limpiarLivekit, permitirMediaParticipante]);

  // ========== Auto-connect/disconnect ==========
  const hayOtrosUsuariosOnline = onlineUsers.length > 0;
  const hayOtrosUsuariosRef = useRef(hayOtrosUsuariosOnline);
  hayOtrosUsuariosRef.current = hayOtrosUsuariosOnline;

  useEffect(() => {
    if (!USAR_LIVEKIT || !activeWorkspace?.id) return;
    if (hayOtrosUsuariosOnline) {
      const roomName = crearSalaLivekitPorEspacio(activeWorkspace.id);
      conectarLivekit(roomName).catch(console.error);
    } else {
      const timer = setTimeout(() => {
        if (!hayOtrosUsuariosRef.current && livekitRoomRef.current) {
          limpiarLivekit().catch(() => {});
        }
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [activeWorkspace?.id, hayOtrosUsuariosOnline, conectarLivekit, limpiarLivekit]);

  useEffect(() => {
    if (!USAR_LIVEKIT) return;
    return () => { limpiarLivekit().catch(() => {}); };
  }, [limpiarLivekit]);

  // ========== Sincronizar tracks por cambio de mic/cam/screen ==========
  const hasAnyoneNearbyForSync = hasActiveCall || usersInAudioRange.length > 0;
  useEffect(() => {
    if (!USAR_LIVEKIT || !livekitConnected || !hasAnyoneNearbyForSync) return;
    sincronizarTracksLocales().catch(console.warn);
  }, [livekitConnected, hasAnyoneNearbyForSync, hasActiveCall, currentUser.isMicOn, currentUser.isCameraOn, currentUser.isScreenSharing, stream, screenStream, sincronizarTracksLocales]);

  // ========== Suscripción selectiva (3-tier) ==========
  const livekitSubscribedIdsRef = useRef<Set<string>>(new Set());
  const livekitAudioOnlyIdsRef = useRef<Set<string>>(new Set());
  const pendingUnsubscribeTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const livekitTransportSubscribedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!USAR_LIVEKIT || !livekitConnected) return;
    const room = livekitRoomRef.current;
    if (!room) return;

    const idsEnProximidad = new Set(usersInCall.map(u => u.id));
    const idsEnAudioRange = new Set(usersInAudioRange.map(u => u.id));
    const idsTransportSuscritos = livekitTransportSubscribedRef.current;

    const idsBloqueados = new Set<string>();
    conversacionesBloqueadasRemoto.forEach((participants, lockerId) => {
      if (!session?.user?.id || participants.includes(session.user.id)) return;
      participants.forEach(pid => idsBloqueados.add(pid));
      idsBloqueados.add(lockerId);
    });

    const idsEnAlgunRango = new Set([...idsEnProximidad, ...idsEnAudioRange]);

    // SUBSCRIBE nuevos
    idsEnAlgunRango.forEach(userId => {
      if (idsBloqueados.has(userId)) return;
      const participant = room.getParticipantByIdentity(userId);
      if (!participant) return;

      const pendingTimer = pendingUnsubscribeTimersRef.current.get(userId);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingUnsubscribeTimersRef.current.delete(userId);
      }

      participant.trackPublications.forEach(pub => {
        if (pub instanceof RemoteTrackPublication && !pub.isSubscribed) pub.setSubscribed(true);
      });
      participant.trackPublications.forEach(pub => {
        if (pub instanceof RemoteTrackPublication && pub.isSubscribed && !pub.isEnabled) pub.setEnabled(true);
      });
      idsTransportSuscritos.add(userId);
    });

    // DISABLE + deferred UNSUBSCRIBE fuera de rangos
    idsTransportSuscritos.forEach(userId => {
      if (idsEnAlgunRango.has(userId)) return;
      const participant = room.getParticipantByIdentity(userId);
      if (participant) {
        participant.trackPublications.forEach(pub => {
          if (pub instanceof RemoteTrackPublication && pub.isSubscribed && pub.isEnabled) pub.setEnabled(false);
        });
      }
      if (!pendingUnsubscribeTimersRef.current.has(userId)) {
        const timer = setTimeout(() => {
          pendingUnsubscribeTimersRef.current.delete(userId);
          if (livekitSubscribedIdsRef.current.has(userId) || livekitAudioOnlyIdsRef.current.has(userId)) {
            const p = room.getParticipantByIdentity(userId);
            if (p) p.trackPublications.forEach(pub => {
              if (pub instanceof RemoteTrackPublication && pub.isSubscribed && !pub.isEnabled) pub.setEnabled(true);
            });
            return;
          }
          const p = room.getParticipantByIdentity(userId);
          if (p) p.trackPublications.forEach(pub => {
            if (pub instanceof RemoteTrackPublication && pub.isSubscribed) pub.setSubscribed(false);
          });
          idsTransportSuscritos.delete(userId);
        }, 5000);
        pendingUnsubscribeTimersRef.current.set(userId, timer);
      }
    });

    livekitSubscribedIdsRef.current = idsEnProximidad;
    livekitAudioOnlyIdsRef.current = idsEnAudioRange;
  }, [livekitConnected, usersInCall, usersInAudioRange, conversacionesBloqueadasRemoto]);

  // Suscribir tracks nuevos de participantes ya en rango
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
      }
    };
    room.on(RoomEvent.TrackPublished, handleTrackPublished);
    return () => { room.off(RoomEvent.TrackPublished, handleTrackPublished); };
  }, [livekitConnected]);

  // ========== Publish/unpublish por proximidad ==========
  const prevHasAnyoneNearbyRef = useRef(false);
  const prevHasActiveCallRef = useRef(false);
  const publishDelayTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasAnyoneNearby = hasActiveCall || usersInAudioRange.length > 0;

  useEffect(() => {
    if (!USAR_LIVEKIT || !livekitConnected) return;
    const prevHasAnyoneNearby = prevHasAnyoneNearbyRef.current;
    const prevHasActiveCall = prevHasActiveCallRef.current;
    prevHasAnyoneNearbyRef.current = hasAnyoneNearby;
    prevHasActiveCallRef.current = hasActiveCall;

    if (!hasAnyoneNearby && prevHasAnyoneNearby) {
      if (publishDelayTimerRef.current) { clearTimeout(publishDelayTimerRef.current); publishDelayTimerRef.current = null; }
      ['audio', 'video', 'screen'].forEach(t => despublicarTrackLocal(t as any).catch(() => {}));
    } else if (!hasActiveCall && prevHasActiveCall && usersInAudioRange.length > 0) {
      if (publishDelayTimerRef.current) { clearTimeout(publishDelayTimerRef.current); publishDelayTimerRef.current = null; }
      despublicarTrackLocal('screen').catch(() => {});
    } else if (hasActiveCall && !prevHasActiveCall) {
      if (publishDelayTimerRef.current) clearTimeout(publishDelayTimerRef.current);
      publishDelayTimerRef.current = setTimeout(() => {
        publishDelayTimerRef.current = null;
        if (livekitRoomRef.current?.state === 'connected') sincronizarTracksLocales().catch(() => {});
      }, 500);
    } else if (hasAnyoneNearby && !prevHasAnyoneNearby && !hasActiveCall) {
      if (publishDelayTimerRef.current) clearTimeout(publishDelayTimerRef.current);
      publishDelayTimerRef.current = setTimeout(() => {
        publishDelayTimerRef.current = null;
        if (livekitRoomRef.current?.state === 'connected') sincronizarTracksLocales().catch(() => {});
      }, 500);
    }
    return () => { if (publishDelayTimerRef.current) { clearTimeout(publishDelayTimerRef.current); publishDelayTimerRef.current = null; } };
  }, [livekitConnected, hasActiveCall, hasAnyoneNearby, usersInAudioRange.length, despublicarTrackLocal, sincronizarTracksLocales, stream]);

  // ========== Re-publicar video al cambiar effectiveStream ==========
  const prevEffectiveStreamRef = useRef<MediaStream | null>(null);
  useEffect(() => {
    if (!USAR_LIVEKIT || !livekitConnected || !hasActiveCall || !currentUser.isCameraOn) return;
    const room = livekitRoomRef.current;
    if (!room || room.state !== 'connected') return;
    const effectiveStream = effectiveStreamRef.current;
    if (effectiveStream === prevEffectiveStreamRef.current) return;
    if (cameraSettings.backgroundEffect !== 'none' && !processedStream) return;

    const debounce = setTimeout(async () => {
      const videoTrack = effectiveStream?.getVideoTracks().find(t => t.readyState === 'live');
      if (videoTrack) {
        try { await publicarTrackLocal(videoTrack, 'video'); prevEffectiveStreamRef.current = effectiveStream; }
        catch (e) { console.error('[LIVEKIT] Error re-publicando video:', e); }
      }
    }, 800);
    return () => clearTimeout(debounce);
  }, [livekitConnected, processedStream, hasActiveCall, currentUser.isCameraOn, cameraSettings.backgroundEffect, publicarTrackLocal]);

  // ========== Speaker detection (fallback non-LiveKit) ==========
  const audioContextRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    if (USAR_LIVEKIT || !stream) return;
    if (!audioContextRef.current) audioContextRef.current = new AudioContext();
    const audioContext = audioContextRef.current;
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const checkAudioLevel = () => {
      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      setSpeakingUsers(prev => {
        const newSet = new Set(prev);
        if (average > 30 && session?.user?.id) newSet.add(session.user.id);
        else if (session?.user?.id) newSet.delete(session.user.id);
        return newSet;
      });
    };
    const intervalId = setInterval(checkAudioLevel, 100);
    return () => { clearInterval(intervalId); source.disconnect(); };
  }, [stream, session?.user?.id]);

  // ========== DataChannel send ==========
  const enviarDataLivekit = useCallback((mensaje: { type: string; payload: Record<string, any> }, reliable = true) => {
    if (!USAR_LIVEKIT) return false;
    const room = livekitRoomRef.current;
    if (!room) return false;
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(mensaje));
    room.localParticipant.publishData(data, { reliable }).catch(console.warn);
    return true;
  }, []);

  return {
    livekitRoomRef,
    livekitConnected,
    remoteStreams,
    remoteScreenStreams,
    remoteAudioTracks,
    speakingUsers,
    setSpeakingUsers,
    publicarTrackLocal,
    despublicarTrackLocal,
    sincronizarTracksLocales,
    conectarLivekit,
    limpiarLivekit,
    enviarDataLivekit,
    permitirMediaParticipante,
  };
}
