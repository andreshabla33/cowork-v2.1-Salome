/**
 * @module hooks/space3d/useBroadcast
 * Hook para broadcast de movimiento, eventos instantáneos (chat, reactions,
 * wave, nudge, invite, lock), y gestión de UI de chat/emojis.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { User } from '@/types';
import { obtenerChunk } from '@/lib/chunkSystem';
import { actualizarEstadoUsuarioEcs, type EstadoEcsEspacio } from '@/lib/ecs/espacioEcs';
import { getSettingsSection, sendDesktopNotification } from '@/lib/userSettings';
import { ChatService } from '@/services/chatService';
import { USAR_LIVEKIT, MOVEMENT_BROADCAST_MS, type UseBroadcastReturn } from './types';
import { RoomEvent } from 'livekit-client';

// Sonidos (importados como funciones puras — se definen en VirtualSpace3D)
let playWaveSound: () => void = () => {};
let playNudgeSound: () => void = () => {};
let playInviteSound: () => void = () => {};

/** Permite al componente padre inyectar las funciones de sonido */
export function setBroadcastSoundFunctions(wave: () => void, nudge: () => void, invite: () => void) {
  playWaveSound = wave;
  playNudgeSound = nudge;
  playInviteSound = invite;
}

export function useBroadcast(params: {
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
  livekitRoomRef: React.MutableRefObject<any>;
  livekitConnected: boolean;
  conversacionBloqueada: boolean;
  setConversacionBloqueada: React.Dispatch<React.SetStateAction<boolean>>;
  setConversacionesBloqueadasRemoto: React.Dispatch<React.SetStateAction<Map<string, string[]>>>;
  grantXP: (accion: string, cooldownMs?: number) => void;
  notifSettings: any;
  setPrivacy: (value: boolean) => void;
  hasActiveCall: boolean;
  proximidadNotificadaRef: React.MutableRefObject<boolean>;
}): UseBroadcastReturn {
  const {
    session, currentUser, currentUserEcs, activeWorkspace, usersInCall,
    enviarDataLivekit, webrtcChannelRef, ecsStateRef,
    usuariosVisiblesRef, realtimePositionsRef,
    livekitRoomRef, livekitConnected,
    conversacionBloqueada, setConversacionBloqueada,
    setConversacionesBloqueadasRemoto, grantXP, notifSettings,
    setPrivacy, hasActiveCall, proximidadNotificadaRef,
  } = params;

  // ========== UI State ==========
  const [showEmojis, setShowEmojis] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const [remoteMessages, setRemoteMessages] = useState<Map<string, string>>(new Map());
  const [localReactions, setLocalReactions] = useState<Array<{ id: string; emoji: string }>>([]);
  const [remoteReaction, setRemoteReaction] = useState<{ emoji: string; from: string; fromName: string } | null>(null);
  const [incomingWave, setIncomingWave] = useState<{ from: string; fromName: string } | null>(null);
  const lastInteractionRef = useRef<Map<string, number>>(new Map());

  // ========== Escape global ==========
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;
      if (e.key === 'Escape') { setShowChat(false); setShowEmojis(false); setShowStatusPicker(false); }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [showChat, showEmojis, showStatusPicker]);

  // ========== manejarEventoInstantaneo ==========
  const manejarEventoInstantaneo = useCallback((mensaje: { type: string; payload: any }) => {
    if (!mensaje?.type || !mensaje.payload || !session?.user?.id) return;

    if (mensaje.type === 'reaction') {
      if (mensaje.payload.from === session.user.id) return;
      setRemoteReaction({ emoji: mensaje.payload.emoji, from: mensaje.payload.from, fromName: mensaje.payload.fromName });
      setTimeout(() => setRemoteReaction(null), 2000);
      return;
    }

    if (mensaje.type === 'wave') {
      if (mensaje.payload.from === session.user.id) return;
      if (mensaje.payload.to && mensaje.payload.to !== session.user.id) return;
      const dedupKey = `wave_${mensaje.payload.from}`;
      const now = Date.now();
      if (now - (lastInteractionRef.current.get(dedupKey) || 0) < 500) return;
      lastInteractionRef.current.set(dedupKey, now);
      playWaveSound();
      setIncomingWave({ from: mensaje.payload.from, fromName: mensaje.payload.fromName });
      setTimeout(() => setIncomingWave(null), 4000);
      sendDesktopNotification(`👋 ${mensaje.payload.fromName}`, 'te está saludando');
      return;
    }

    if (mensaje.type === 'chat') {
      if (mensaje.payload.from === session.user.id) return;
      setRemoteMessages(prev => new Map(prev).set(mensaje.payload.from, mensaje.payload.message));
      const ns = getSettingsSection('notifications');
      if (ns.newMessageSound) sendDesktopNotification(`💬 ${mensaje.payload.fromName}`, mensaje.payload.message);
      if (ns.mentionNotifications && mensaje.payload.message?.includes(`@${currentUser.name}`)) {
        sendDesktopNotification(`📢 Mención de ${mensaje.payload.fromName}`, mensaje.payload.message);
      }
      setTimeout(() => {
        setRemoteMessages(prev => { const m = new Map(prev); m.delete(mensaje.payload.from); return m; });
      }, 5000);
      return;
    }

    if (mensaje.type === 'nudge') {
      if (mensaje.payload.from === session.user.id) return;
      if (mensaje.payload.to && mensaje.payload.to !== session.user.id) return;
      const dedupKey = `nudge_${mensaje.payload.from}`;
      const now = Date.now();
      if (now - (lastInteractionRef.current.get(dedupKey) || 0) < 500) return;
      lastInteractionRef.current.set(dedupKey, now);
      playNudgeSound();
      // Nudge se maneja en useGatherInteractions
      return;
    }

    if (mensaje.type === 'invite') {
      if (mensaje.payload.from === session.user.id) return;
      if (mensaje.payload.to && mensaje.payload.to !== session.user.id) return;
      const dedupKey = `invite_${mensaje.payload.from}`;
      const now = Date.now();
      if (now - (lastInteractionRef.current.get(dedupKey) || 0) < 500) return;
      lastInteractionRef.current.set(dedupKey, now);
      playInviteSound();
      sendDesktopNotification(`📍 ${mensaje.payload.fromName}`, 'te invita a unirte');
      return;
    }

    if (mensaje.type === 'lock_conversation') {
      if (mensaje.payload.by === session.user.id) return;
      const soyParticipante = mensaje.payload.participants?.includes(session.user.id);
      if (mensaje.payload.locked) {
        if (soyParticipante) setConversacionBloqueada(true);
        setConversacionesBloqueadasRemoto(prev => new Map(prev).set(mensaje.payload.by, mensaje.payload.participants || []));
      } else {
        if (soyParticipante) setConversacionBloqueada(false);
        setConversacionesBloqueadasRemoto(prev => { const n = new Map(prev); n.delete(mensaje.payload.by); return n; });
      }
      return;
    }

    if (mensaje.type === 'movement') {
      if (mensaje.payload.id === session.user.id) return;
      if (!usuariosVisiblesRef.current.has(mensaje.payload.id)) return;
      realtimePositionsRef.current.set(mensaje.payload.id, {
        x: mensaje.payload.x, y: mensaje.payload.y,
        direction: mensaje.payload.direction, isMoving: mensaje.payload.isMoving,
        animState: mensaje.payload.animState || (mensaje.payload.isMoving ? 'walk' : 'idle'),
        timestamp: Date.now(),
      });
      actualizarEstadoUsuarioEcs(
        ecsStateRef.current, mensaje.payload.id,
        mensaje.payload.x / 16, mensaje.payload.y / 16,
        mensaje.payload.direction, mensaje.payload.isMoving
      );
    }
  }, [session?.user?.id, currentUser.name]);

  // ========== LiveKit DataChannel listener ==========
  useEffect(() => {
    if (!USAR_LIVEKIT || !livekitConnected) return;
    const room = livekitRoomRef.current;
    if (!room) return;
    const manejarData = (payload: Uint8Array) => {
      try {
        const decoder = new TextDecoder();
        const mensaje = JSON.parse(decoder.decode(payload));
        manejarEventoInstantaneo(mensaje);
      } catch (error) { console.warn('Error parseando DataChannel LiveKit:', error); }
    };
    room.on(RoomEvent.DataReceived, manejarData);
    return () => { room.off(RoomEvent.DataReceived, manejarData); };
  }, [livekitConnected, manejarEventoInstantaneo]);

  // ========== broadcastMovement ==========
  const webrtcChannelSubscribedRef = useRef(false);
  const lastMovementSentRef = useRef(0);

  const broadcastMovement = useCallback((x: number, y: number, direction: string, isMoving: boolean, animState?: string, reliable: boolean = false) => {
    const now = Date.now();
    if (!reliable && now - lastMovementSentRef.current < MOVEMENT_BROADCAST_MS) return;
    lastMovementSentRef.current = now;
    if (session?.user?.id) {
      actualizarEstadoUsuarioEcs(ecsStateRef.current, session.user.id, x / 16, y / 16, direction, isMoving);
    }
    if (enviarDataLivekit({
      type: 'movement',
      payload: {
        id: session?.user?.id, x, y, direction, isMoving,
        animState: animState || (isMoving ? 'walk' : 'idle'),
        chunk: obtenerChunk(x, y).clave, timestamp: Date.now(),
      }
    }, reliable)) return;
    if (webrtcChannelRef.current && session?.user?.id && webrtcChannelSubscribedRef.current) {
      webrtcChannelRef.current.send({
        type: 'broadcast', event: 'movement',
        payload: {
          id: session.user.id, x, y, direction, isMoving,
          animState: animState || (isMoving ? 'walk' : 'idle'),
          chunk: obtenerChunk(x, y).clave, timestamp: Date.now()
        }
      });
    }
  }, [enviarDataLivekit, session?.user?.id]);

  // ========== bloquearConversacion ==========
  const bloquearConversacion = useCallback(() => {
    const newLocked = !conversacionBloqueada;
    setConversacionBloqueada(newLocked);
    const participantIds = [session?.user?.id, ...usersInCall.map(u => u.id)].filter(Boolean) as string[];
    const payload = { locked: newLocked, by: session?.user?.id, participants: participantIds };
    enviarDataLivekit({ type: 'lock_conversation', payload });
    if (webrtcChannelRef.current) {
      webrtcChannelRef.current.send({ type: 'broadcast', event: 'lock_conversation', payload });
    }
  }, [conversacionBloqueada, session?.user?.id, usersInCall, enviarDataLivekit]);

  // ========== handleSendMessage ==========
  const handleSendMessage = useCallback(async () => {
    if (!chatInput.trim() || !session?.user?.id) return;
    const content = chatInput.trim();
    setLocalMessage(content);
    setTimeout(() => setLocalMessage(null), 5000);
    if (!enviarDataLivekit({ type: 'chat', payload: { message: content, from: session.user.id, fromName: currentUser.name } })) {
      if (webrtcChannelRef.current) {
        webrtcChannelRef.current.send({ type: 'broadcast', event: 'chat', payload: { message: content, from: session.user.id, fromName: currentUser.name } });
      }
    }
    if (usersInCall.length > 0) {
      const recipientIds = usersInCall.map(u => u.id);
      await ChatService.sendMessage(content, session.user.id, activeWorkspace?.id || '', recipientIds);
    }
    grantXP('mensaje_chat', 5000);
    setChatInput('');
    setShowChat(false);
  }, [chatInput, session?.user?.id, currentUser.name, usersInCall, activeWorkspace?.id, enviarDataLivekit, grantXP]);

  // ========== handleTriggerReaction ==========
  const handleTriggerReaction = useCallback((emoji: string) => {
    const reactionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setLocalReactions(prev => [...prev, { id: reactionId, emoji }]);
    setTimeout(() => { setLocalReactions(prev => prev.filter(r => r.id !== reactionId)); }, 1500);
    if (!enviarDataLivekit({ type: 'reaction', payload: { emoji, from: session?.user?.id, fromName: currentUser.name } })) {
      if (webrtcChannelRef.current && session?.user?.id) {
        webrtcChannelRef.current.send({ type: 'broadcast', event: 'reaction', payload: { emoji, from: session.user.id, fromName: currentUser.name } });
      }
    }
  }, [session?.user?.id, currentUser.name, enviarDataLivekit]);

  // ========== Atajos numéricos ==========
  useEffect(() => {
    const emojiKeys = ['👍', '🔥', '❤️', '👏', '😂', '😮', '🚀', '✨'];
    const handleNumericKeys = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;
      const num = parseInt(e.key);
      if (num >= 1 && num <= 8) handleTriggerReaction(emojiKeys[num - 1]);
    };
    window.addEventListener('keydown', handleNumericKeys);
    return () => window.removeEventListener('keydown', handleNumericKeys);
  }, [handleTriggerReaction]);

  // ========== Proximity notification ==========
  useEffect(() => {
    if (hasActiveCall) {
      if (!proximidadNotificadaRef.current) {
        proximidadNotificadaRef.current = true;
        if (notifSettings.nearbyUserSound) {
          sendDesktopNotification('Usuario cercano', `${usersInCall[0]?.name || 'Alguien'} está cerca — activa mic/cam para hablar`);
        }
      }
    } else {
      if (currentUser.isPrivate) setPrivacy(false);
      if (conversacionBloqueada) setConversacionBloqueada(false);
      proximidadNotificadaRef.current = false;
      setConversacionesBloqueadasRemoto(new Map());
    }
  }, [hasActiveCall]);

  return {
    broadcastMovement,
    manejarEventoInstantaneo,
    bloquearConversacion,
    handleSendMessage,
    handleTriggerReaction,
    showEmojis, setShowEmojis,
    showChat, setShowChat,
    showStatusPicker, setShowStatusPicker,
    chatInput, setChatInput,
    localMessage,
    remoteMessages,
    localReactions,
    remoteReaction,
    incomingWave, setIncomingWave,
  };
}
