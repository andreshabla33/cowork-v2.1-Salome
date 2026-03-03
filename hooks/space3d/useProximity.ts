/**
 * @module hooks/space3d/useProximity
 * Hook para detección de proximidad con histéresis, cálculo de usersInCall,
 * usersInAudioRange, distancias, y routing de streams remotos.
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import type { User } from '@/types';
import { AUDIO_SPATIAL_RADIUS_FACTOR, PROXIMITY_COORD_THRESHOLD, type UseProximityReturn } from './types';

export function useProximity(params: {
  currentUserEcs: User;
  usuariosEnChunks: User[];
  session: any;
  currentUser: User;
  userProximityRadius: number;
  remoteStreams: Map<string, MediaStream>;
  remoteScreenStreams: Map<string, MediaStream>;
  speakingUsers: Set<string>;
  performanceSettings: any;
  selectedRemoteUser: User | null;
  setSelectedRemoteUser: React.Dispatch<React.SetStateAction<User | null>>;
  handleToggleScreenShare: () => Promise<void>;
}): UseProximityReturn {
  const {
    currentUserEcs, usuariosEnChunks, session, currentUser,
    userProximityRadius, remoteStreams, remoteScreenStreams,
    speakingUsers, performanceSettings,
    selectedRemoteUser, setSelectedRemoteUser, handleToggleScreenShare,
  } = params;

  // ========== Coordenadas estabilizadas para cálculo de proximidad ==========
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

  // ========== Histéresis refs ==========
  const connectedUsersRef = useRef<Set<string>>(new Set());

  // ========== Estados de privacidad (patrón Gather) ==========
  const [conversacionBloqueada, setConversacionBloqueada] = useState(false);
  const [conversacionesBloqueadasRemoto, setConversacionesBloqueadasRemoto] = useState<Map<string, string[]>>(new Map());

  // ========== usersInCall con histéresis ==========
  const usersInCall = useMemo(() => {
    const nextConnectedUsers = new Set<string>();

    const idsBloqueadosProximidad = new Set<string>();
    conversacionesBloqueadasRemoto.forEach((participants, lockerId) => {
      if (!session?.user?.id || participants.includes(session.user.id)) return;
      participants.forEach(pid => idsBloqueadosProximidad.add(pid));
      idsBloqueadosProximidad.add(lockerId);
    });

    const users = usuariosEnChunks.filter(u => {
      if (u.id === session?.user?.id) return false;
      if (u.esFantasma) return false;
      if (idsBloqueadosProximidad.has(u.id)) return false;
      if ((u.x === 0 && u.y === 0) || typeof u.x !== 'number' || typeof u.y !== 'number' ||
          typeof stableProximityCoords.x !== 'number' || typeof stableProximityCoords.y !== 'number') {
        return false;
      }

      const dist = Math.sqrt(Math.pow(u.x - stableProximityCoords.x, 2) + Math.pow(u.y - stableProximityCoords.y, 2));
      const wasInCall = connectedUsersRef.current.has(u.id);
      const threshold = wasInCall ? userProximityRadius * 1.5 : userProximityRadius;
      const inProximity = dist < threshold;

      if (inProximity) {
        nextConnectedUsers.add(u.id);
        if (!wasInCall) {
          console.log(`[PROXIMITY ENTER] User ${u.name} entered. Dist: ${dist.toFixed(1)} < ${userProximityRadius}`);
          if (selectedRemoteUser?.id === u.id) setSelectedRemoteUser(null);
        }
      } else if (wasInCall) {
        console.log(`[PROXIMITY EXIT] User ${u.name} exited. Dist: ${dist.toFixed(1)} > ${threshold.toFixed(1)}`);
      }

      return inProximity;
    });

    // Auto-stop screen share si no hay nadie
    if (users.length === 0 && currentUser.isScreenSharing) {
      setTimeout(() => { handleToggleScreenShare(); }, 0);
    }

    connectedUsersRef.current = nextConnectedUsers;
    return users;
  }, [usuariosEnChunks, stableProximityCoords.x, stableProximityCoords.y, session?.user?.id, currentUser.isScreenSharing, userProximityRadius, conversacionesBloqueadasRemoto]);

  const hasActiveCall = usersInCall.length > 0;
  const usersInCallIds = useMemo(() => new Set(usersInCall.map(u => u.id)), [usersInCall]);

  // ========== Usuarios en rango de audio espacial ==========
  const usersInAudioRange = useMemo(() => {
    const audioRadius = userProximityRadius * AUDIO_SPATIAL_RADIUS_FACTOR;
    const idsEnProximidad = new Set(usersInCall.map(u => u.id));
    return usuariosEnChunks.filter(u => {
      if (u.id === session?.user?.id) return false;
      if (u.esFantasma) return false;
      if (idsEnProximidad.has(u.id)) return false;
      if ((u.x === 0 && u.y === 0) || typeof u.x !== 'number' || typeof u.y !== 'number') return false;
      const dist = Math.sqrt(Math.pow(u.x - stableProximityCoords.x, 2) + Math.pow(u.y - stableProximityCoords.y, 2));
      return dist < audioRadius;
    });
  }, [usuariosEnChunks, stableProximityCoords.x, stableProximityCoords.y, session?.user?.id, userProximityRadius, usersInCall]);

  const usersInAudioRangeIds = useMemo(() => new Set(usersInAudioRange.map(u => u.id)), [usersInAudioRange]);

  // ========== Distancias ==========
  const userDistances = useMemo(() => {
    const distances = new Map<string, number>();
    usersInCall.forEach(u => {
      const dist = Math.sqrt(Math.pow(u.x - currentUserEcs.x, 2) + Math.pow(u.y - currentUserEcs.y, 2));
      distances.set(u.id, dist);
    });
    return distances;
  }, [usersInCall, currentUserEcs.x, currentUserEcs.y]);

  // ========== Video stream routing ==========
  const maxVideoStreams = useMemo(() => {
    const limite = Number(performanceSettings.maxVideoStreams ?? 8);
    return Number.isFinite(limite) ? Math.max(1, limite) : 8;
  }, [performanceSettings.maxVideoStreams]);

  const prioritizedVideoIds = useMemo(() => {
    const inCallIds = usersInCall.map(u => u.id);
    const audioRangeIds = usersInAudioRange.map(u => u.id);
    const speakingFirst = inCallIds.filter(id => speakingUsers.has(id));
    const rest = inCallIds.filter(id => !speakingUsers.has(id));
    rest.sort((a, b) => {
      const distA = userDistances.get(a) ?? Number.MAX_SAFE_INTEGER;
      const distB = userDistances.get(b) ?? Number.MAX_SAFE_INTEGER;
      return distA - distB;
    });
    return Array.from(new Set([...speakingFirst, ...rest, ...audioRangeIds]));
  }, [usersInCall, usersInAudioRange, speakingUsers, userDistances]);

  const allowedVideoIds = useMemo(() => {
    const screenIds = new Set<string>();
    remoteScreenStreams.forEach((s, id) => {
      if (s?.getVideoTracks().length) screenIds.add(id);
    });
    const allowed = new Set<string>(screenIds);
    const limite = maxVideoStreams + screenIds.size + usersInAudioRange.length;
    prioritizedVideoIds.forEach(id => {
      if (allowed.size >= limite) return;
      allowed.add(id);
    });
    return allowed;
  }, [maxVideoStreams, prioritizedVideoIds, remoteScreenStreams, usersInAudioRange.length]);

  const remoteStreamsRouted = useMemo(() => {
    const next = new Map<string, MediaStream>();
    remoteStreams.forEach((s, id) => {
      if (allowedVideoIds.has(id)) next.set(id, s);
    });
    return next;
  }, [remoteStreams, allowedVideoIds]);

  const remoteScreenStreamsRouted = useMemo(() => {
    const next = new Map<string, MediaStream>();
    remoteScreenStreams.forEach((s, id) => {
      if (allowedVideoIds.has(id)) next.set(id, s);
    });
    return next;
  }, [remoteScreenStreams, allowedVideoIds]);

  // ========== Conversación bloqueada cercana ==========
  const conversacionProximaBloqueada = useMemo(() => {
    if (!session?.user?.id || conversacionesBloqueadasRemoto.size === 0) return null;
    for (const [lockerId, participants] of conversacionesBloqueadasRemoto) {
      if (participants.includes(session.user.id)) continue;
      const usuarioBloqueado = usersInCall.find(u => participants.includes(u.id) || u.id === lockerId);
      if (usuarioBloqueado) {
        return { lockerId, participants, nombre: usuarioBloqueado.name };
      }
    }
    return null;
  }, [conversacionesBloqueadasRemoto, usersInCall, session?.user?.id]);

  return {
    stableProximityCoords,
    usersInCall,
    usersInCallIds,
    hasActiveCall,
    usersInAudioRange,
    usersInAudioRangeIds,
    userDistances,
    remoteStreamsRouted,
    remoteScreenStreamsRouted,
    conversacionBloqueada,
    setConversacionBloqueada,
    conversacionesBloqueadasRemoto,
    setConversacionesBloqueadasRemoto,
    conversacionProximaBloqueada,
  };
}
