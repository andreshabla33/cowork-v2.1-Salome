/**
 * @module hooks/space3d/useGatherInteractions
 * Hook para interacciones estilo Gather: click en avatar remoto,
 * wave, nudge, invite, follow, go-to, y accept invite.
 */

import { useState, useCallback, useMemo, useRef } from 'react';
import type { User } from '@/types';
import type { EstadoEcsEspacio } from '@/lib/ecs/espacioEcs';
import { obtenerEstadoUsuarioEcs } from '@/lib/ecs/espacioEcs';
import { hapticFeedback } from '@/lib/mobileDetect';
import { type UseGatherInteractionsReturn } from './types';

export function useGatherInteractions(params: {
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
  setIncomingNudge: React.Dispatch<React.SetStateAction<{ from: string; fromName: string } | null>>;
  setIncomingInvite: React.Dispatch<React.SetStateAction<{ from: string; fromName: string; x: number; y: number } | null>>;
}): UseGatherInteractionsReturn {
  const {
    session, currentUser, currentUserEcs, usuariosEnChunks,
    ecsStateRef, enviarDataLivekit, webrtcChannelRef, grantXP,
    setTeleportTarget, setMoveTarget, setIncomingNudge, setIncomingInvite,
  } = params;

  // ========== State ==========
  const [selectedRemoteUser, setSelectedRemoteUser] = useState<User | null>(null);
  const [followTargetId, setFollowTargetId] = useState<string | null>(null);
  const followTargetIdRef = useRef<string | null>(null);
  const cardScreenPosRef = useRef<{ x: number; y: number } | null>(null);

  // ========== Click on remote avatar ==========
  const handleClickRemoteAvatar = useCallback((userId: string) => {
    const user = usuariosEnChunks.find(u => u.id === userId);
    if (!user) return;
    setSelectedRemoteUser(prev => prev?.id === userId ? null : user);
    hapticFeedback('light');
  }, [usuariosEnChunks]);

  // ========== Go to user ==========
  const handleGoToUser = useCallback((userId: string) => {
    const ecsData = obtenerEstadoUsuarioEcs(ecsStateRef.current, userId);
    if (ecsData) {
      setMoveTarget(null);
      setTeleportTarget({ x: ecsData.x * 16, z: ecsData.z * 16 });
      hapticFeedback('medium');
    }
    setSelectedRemoteUser(null);
  }, [ecsStateRef, setTeleportTarget, setMoveTarget]);

  // ========== Wave ==========
  const handleWaveUser = useCallback((userId: string) => {
    const payload = {
      from: session?.user?.id,
      fromName: currentUser.name,
      to: userId,
    };
    enviarDataLivekit({ type: 'wave', payload });
    if (webrtcChannelRef.current) {
      webrtcChannelRef.current.send({ type: 'broadcast', event: 'wave', payload });
    }
    grantXP('interaccion_social', 15000);
    hapticFeedback('medium');
    setSelectedRemoteUser(null);
  }, [session?.user?.id, currentUser.name, enviarDataLivekit, grantXP]);

  // ========== Nudge ==========
  const handleNudgeUser = useCallback((userId: string) => {
    const payload = {
      from: session?.user?.id,
      fromName: currentUser.name,
      to: userId,
    };
    enviarDataLivekit({ type: 'nudge', payload });
    if (webrtcChannelRef.current) {
      webrtcChannelRef.current.send({ type: 'broadcast', event: 'nudge', payload });
    }
    grantXP('interaccion_social', 15000);
    hapticFeedback('heavy');
    setSelectedRemoteUser(null);
  }, [session?.user?.id, currentUser.name, enviarDataLivekit, grantXP]);

  // ========== Invite ==========
  const handleInviteUser = useCallback((userId: string) => {
    const payload = {
      from: session?.user?.id,
      fromName: currentUser.name,
      to: userId,
      x: currentUserEcs.x,
      y: currentUserEcs.y,
    };
    enviarDataLivekit({ type: 'invite', payload });
    if (webrtcChannelRef.current) {
      webrtcChannelRef.current.send({ type: 'broadcast', event: 'invite', payload });
    }
    grantXP('interaccion_social', 15000);
    hapticFeedback('medium');
    setSelectedRemoteUser(null);
  }, [session?.user?.id, currentUser.name, currentUserEcs.x, currentUserEcs.y, enviarDataLivekit, grantXP]);

  // ========== Follow ==========
  const handleFollowUser = useCallback((userId: string) => {
    if (followTargetId === userId) {
      setFollowTargetId(null);
      followTargetIdRef.current = null;
    } else {
      setFollowTargetId(userId);
      followTargetIdRef.current = userId;
    }
    hapticFeedback('medium');
    setSelectedRemoteUser(null);
  }, [followTargetId]);

  // ========== Accept invite ==========
  const handleAcceptInvite = useCallback(() => {
    // incomingInvite se lee desde el estado padre
    // El componente padre llama a setTeleportTarget directamente
    hapticFeedback('medium');
  }, []);

  // ========== Memoized interactions for Scene ==========
  const avatarInteractionsMemo = useMemo(() => ({
    onGoTo: handleGoToUser,
    onNudge: handleNudgeUser,
    onInvite: handleInviteUser,
    onFollow: handleFollowUser,
    onWave: handleWaveUser,
    followTargetId,
    profilePhoto: currentUser.profilePhoto || null,
  }), [handleGoToUser, handleNudgeUser, handleInviteUser, handleFollowUser, handleWaveUser, followTargetId, currentUser.profilePhoto]);

  return {
    selectedRemoteUser,
    setSelectedRemoteUser,
    followTargetId,
    setFollowTargetId,
    followTargetIdRef,
    incomingNudge: null, // Gestionado externamente
    setIncomingNudge,
    incomingInvite: null, // Gestionado externamente
    setIncomingInvite,
    handleClickRemoteAvatar,
    handleGoToUser,
    handleNudgeUser,
    handleInviteUser,
    handleFollowUser,
    handleWaveUser,
    handleAcceptInvite,
    avatarInteractionsMemo,
  };
}
