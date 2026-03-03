/**
 * @module hooks/space3d/useWebRTC
 * Hook para gestión de conexiones WebRTC peer-to-peer (path non-LiveKit),
 * señalización via Realtime chunks, y ciclo de vida de peer connections.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { User } from '@/types';
import { obtenerChunk, obtenerChunksVecinos } from '@/lib/chunkSystem';
import { crearRealtimeChunkManager, type EventoRealtime } from '@/lib/realtimeChunkManager';
import { actualizarEstadoUsuarioEcs, type EstadoEcsEspacio } from '@/lib/ecs/espacioEcs';
import { USAR_LIVEKIT, ICE_SERVERS, type UseWebRTCReturn } from './types';

export function useWebRTC(params: {
  activeWorkspace: any;
  session: any;
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
}): UseWebRTCReturn {
  const {
    activeWorkspace, session, activeStreamRef, activeScreenRef,
    usuariosParaConexion, stream, screenStream, hasActiveCall,
    ecsStateRef, usuariosVisiblesRef, radioInteresChunks, currentUserEcs,
    setRemoteStreams, setRemoteScreenStreams, manejarEventoInstantaneo,
  } = params;

  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const peerVideoTrackCountRef = useRef<Map<string, number>>(new Map());
  const webrtcChannelRef = useRef<any>(null);
  const realtimeChunkManagerRef = useRef<any>(null);
  const webrtcChannelSubscribedRef = useRef(false);

  // ========== createPeerConnection ==========
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

    peerVideoTrackCountRef.current.set(peerId, 0);

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      const trackLabel = event.track.label.toLowerCase();
      const isScreenShareByLabel = trackLabel.includes('screen') || trackLabel.includes('display') ||
        trackLabel.includes('window') || trackLabel.includes('monitor') ||
        trackLabel.includes('entire') || trackLabel.includes('tab');

      if (event.track.kind === 'video') {
        if (isScreenShareByLabel) {
          setRemoteScreenStreams(prev => new Map(prev).set(peerId, remoteStream));
        } else {
          setRemoteStreams(prev => new Map(prev).set(peerId, remoteStream));
        }
      } else if (event.track.kind === 'audio') {
        setRemoteStreams(prev => {
          const newMap = new Map(prev);
          if (!newMap.has(peerId)) newMap.set(peerId, remoteStream);
          return newMap;
        });
      }
    };

    let disconnectTimeout: NodeJS.Timeout | null = null;
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        if (disconnectTimeout) { clearTimeout(disconnectTimeout); disconnectTimeout = null; }
      } else if (pc.connectionState === 'disconnected') {
        if (!disconnectTimeout) {
          disconnectTimeout = setTimeout(() => {
            if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
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
    if (activeScreenRef.current) {
      activeScreenRef.current.getTracks().forEach(track => pc.addTrack(track, activeScreenRef.current!));
    }

    return pc;
  }, [session?.user?.id]);

  // ========== Signaling ==========
  const handleOffer = useCallback(async (offer: RTCSessionDescriptionInit, fromId: string) => {
    let pc = peerConnectionsRef.current.get(fromId);
    if (!pc) {
      pc = createPeerConnection(fromId);
    } else {
      const senders = pc.getSenders();
      if (activeStreamRef.current) {
        activeStreamRef.current.getTracks().forEach(track => {
          if (!senders.find(s => s.track?.kind === track.kind)) {
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

  // ========== Cleanup when using LiveKit ==========
  useEffect(() => {
    if (!USAR_LIVEKIT) return;
    if (realtimeChunkManagerRef.current) { realtimeChunkManagerRef.current.destruir(); realtimeChunkManagerRef.current = null; }
    webrtcChannelRef.current = null;
    webrtcChannelSubscribedRef.current = false;
    peerConnectionsRef.current.forEach(pc => pc.close());
    peerConnectionsRef.current.clear();
    peerVideoTrackCountRef.current.clear();
  }, []);

  // ========== Realtime Chunk Manager (non-LiveKit path) ==========
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
    webrtcChannelRef.current = {
      send: ({ event, payload }: { type?: string; event: string; payload: any }) => {
        manager.broadcast(event as EventoRealtime, payload);
      },
    };

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
  }, [activeWorkspace?.id, session?.user?.id, handleOffer, handleAnswer, handleIceCandidate, manejarEventoInstantaneo]);

  // Sync chunk subscriptions on move
  useEffect(() => {
    if (!realtimeChunkManagerRef.current) return;
    const chunk = obtenerChunk(currentUserEcs.x, currentUserEcs.y);
    const vecinos = obtenerChunksVecinos(chunk, radioInteresChunks);
    realtimeChunkManagerRef.current.actualizarChunk(chunk.clave, vecinos);
  }, [currentUserEcs.x, currentUserEcs.y, radioInteresChunks]);

  // ========== Peer cleanup on user leave ==========
  const pendingDisconnectsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  useEffect(() => {
    if (USAR_LIVEKIT) return;
    const onlineUserIds = new Set(usuariosParaConexion.map(u => u.id));
    onlineUserIds.forEach(userId => {
      const timeout = pendingDisconnectsRef.current.get(userId);
      if (timeout) { clearTimeout(timeout); pendingDisconnectsRef.current.delete(userId); }
    });
    peerConnectionsRef.current.forEach((pc, peerId) => {
      if (!onlineUserIds.has(peerId) && !pendingDisconnectsRef.current.has(peerId)) {
        const timeout = setTimeout(() => {
          if (peerConnectionsRef.current.has(peerId)) {
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

  // ========== Initiate calls to all online users ==========
  useEffect(() => {
    if (USAR_LIVEKIT || !session?.user?.id || !activeStreamRef.current || usuariosParaConexion.length === 0) return;
    usuariosParaConexion.forEach(user => {
      if (user.id === session.user.id) return;
      const myIdHash = session.user.id.split('').reduce((a: number, b: string) => a + b.charCodeAt(0), 0);
      const theirIdHash = user.id.split('').reduce((a: number, b: string) => a + b.charCodeAt(0), 0);
      const shouldInitiate = myIdHash < theirIdHash || (myIdHash === theirIdHash && session.user.id < user.id);
      const existingPc = peerConnectionsRef.current.get(user.id);
      if (!existingPc && shouldInitiate) {
        initiateCall(user.id);
      } else if (existingPc && shouldInitiate) {
        const state = existingPc.connectionState;
        if (state !== 'connected' && state !== 'connecting') {
          existingPc.close();
          peerConnectionsRef.current.delete(user.id);
          peerVideoTrackCountRef.current.delete(user.id);
          initiateCall(user.id);
        }
      }
    });
  }, [usuariosParaConexion, initiateCall, session?.user?.id, stream]);

  // ========== Screen share to existing peers ==========
  useEffect(() => {
    if (USAR_LIVEKIT || !screenStream || !hasActiveCall) return;
    peerConnectionsRef.current.forEach(async (pc, peerId) => {
      const senders = pc.getSenders();
      const hasScreenTrack = senders.some(s => s.track?.label?.toLowerCase().includes('screen') || s.track?.label?.toLowerCase().includes('display'));
      if (!hasScreenTrack && screenStream) {
        screenStream.getTracks().forEach(track => pc.addTrack(track, screenStream));
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          if (webrtcChannelRef.current) {
            webrtcChannelRef.current.send({ type: 'broadcast', event: 'offer', payload: { offer, to: peerId, from: session?.user?.id } });
          }
        } catch (err) { console.error('Error renegotiating screen share:', err); }
      }
    });
  }, [screenStream, hasActiveCall, session?.user?.id]);

  return {
    peerConnectionsRef,
    peerVideoTrackCountRef,
    webrtcChannelRef,
    realtimeChunkManagerRef,
    createPeerConnection,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    initiateCall,
  };
}
