'use client';
import React, { useRef, useEffect, useMemo, Suspense, useState, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrthographicCamera, PerspectiveCamera, Grid, Text, CameraControls, Html, PerformanceMonitor, useGLTF } from '@react-three/drei';
import { Physics, RigidBody, CuboidCollider } from '@react-three/rapier';
import * as THREE from 'three';
import { User, PresenceStatus, ZonaEmpresa } from '@/types';
import { GLTFAvatar, useAvatarControls, AnimationState } from '../Avatar3DGLTF';
import { VideoWithBackground } from '../VideoWithBackground';
import { GhostAvatar } from '../3d/GhostAvatar';
import { ZonaEmpresa as ZonaEmpresa3D } from '../3d/ZonaEmpresa';
import { Escritorio3D } from '../3d/Escritorio3D';
import type { EspacioObjeto } from '@/hooks/space3d/useEspacioObjetos';
import { DayNightCycle } from '../3d/DayNightCycle';
import { ObjetosInteractivos } from '../3d/ObjetosInteractivos';
import { ParticulasClima } from '../3d/ParticulasClima';
import { EmoteSync, useSyncEffects } from '../3d/EmoteSync';
import { hapticFeedback, isMobileDevice } from '@/lib/mobileDetect';
import { useStore } from '@/store/useStore';
import { type CameraSettings } from '../CameraSettingsMenu';
import { obtenerEstadoUsuarioEcs, type EstadoEcsEspacio } from '@/lib/ecs/espacioEcs';
import { type JoystickInput } from '../3d/MobileJoystick';
import { getSettingsSection } from '@/lib/userSettings';
import {
  AvatarLodLevel, DireccionAvatar, themeColors,
  MOVE_SPEED, RUN_SPEED, WORLD_SIZE, TELEPORT_DISTANCE,
  CHAIR_SIT_RADIUS, CHAIR_POSITIONS_3D, LOD_NEAR_DISTANCE, LOD_MID_DISTANCE,
  USAR_LIVEKIT, playTeleportSound, IconPrivacy, IconExpand,
} from './shared';
import { statusColors, STATUS_LABELS, type VirtualSpace3DProps } from './spaceTypes';
import { Avatar, type AvatarProps } from './Avatar3DScene';
import { TeleportEffect } from './Avatar3DScene';

// --- Player ---
export interface PlayerProps {
  currentUser: User;
  setPosition: (x: number, y: number, direction: string, isSitting: boolean, isMoving: boolean) => void;
  stream: MediaStream | null;
  showVideoBubble?: boolean;
  message?: string | null;
  reactions?: Array<{ id: string; emoji: string }>;
  onClickAvatar?: () => void;
  moveTarget?: { x: number; z: number } | null;
  onReachTarget?: () => void;
  teleportTarget?: { x: number; z: number } | null;
  onTeleportDone?: () => void;
  broadcastMovement?: (x: number, y: number, direction: string, isMoving: boolean, animState?: string, reliable?: boolean) => void;
  moveSpeed?: number;
  runSpeed?: number;
  ecsStateRef?: React.MutableRefObject<EstadoEcsEspacio>;
  onPositionUpdate?: (x: number, z: number) => void;
  zonasEmpresa?: ZonaEmpresa[];
  empresasAutorizadas?: string[];
  usersInCallIds?: Set<string>;
  mobileInputRef?: React.MutableRefObject<JoystickInput>;
  onXPEvent?: (accion: string, cooldownMs?: number) => void;
}

export const Player: React.FC<PlayerProps> = ({ currentUser, setPosition, stream, showVideoBubble = true, message, reactions = [], onClickAvatar, moveTarget, onReachTarget, teleportTarget, onTeleportDone, broadcastMovement, moveSpeed, runSpeed, ecsStateRef, onPositionUpdate, zonasEmpresa = [], empresasAutorizadas = [], usersInCallIds, mobileInputRef, onXPEvent }) => {
  const groupRef = useRef<THREE.Group>(null);
  // Refs para acceso seguro dentro de useFrame
  const zonasRef = useRef(zonasEmpresa);
  const empresasAuthRef = useRef(empresasAutorizadas);

  // Sincronizar refs
  useEffect(() => { zonasRef.current = zonasEmpresa; }, [zonasEmpresa]);
  useEffect(() => { empresasAuthRef.current = empresasAutorizadas; }, [empresasAutorizadas]);

  const initialPosition = useMemo(() => {
    // 1. Persistencia ECS (prioridad si es reciente - < 2s)
    const ecsData = ecsStateRef?.current ? obtenerEstadoUsuarioEcs(ecsStateRef.current, currentUser.id) : null;
    if (ecsData && Date.now() - (ecsData.timestamp ?? 0) <= 2000) {
      return { x: ecsData.x, z: ecsData.z };
    }

    // 2. Spawn Point de Empresa (Gemelo Digital)
    if (currentUser.empresa_id && zonasEmpresa.length > 0) {
      // Buscar zona activa de mi empresa
      const miZona = zonasEmpresa.find(z => z.empresa_id === currentUser.empresa_id && z.estado === 'activa');
      // Si tiene spawn definido (y no es 0,0 que es el default si no se ha configurado)
      if (miZona && (Number(miZona.spawn_x) !== 0 || Number(miZona.spawn_y) !== 0)) {
        return { 
          x: Number(miZona.spawn_x) / 16, 
          z: Number(miZona.spawn_y) / 16 
        };
      }
    }

    // 3. Posición guardada o Default
    return { x: (currentUser.x || 400) / 16, z: (currentUser.y || 400) / 16 };
  }, [currentUser.id, currentUser.x, currentUser.y, currentUser.empresa_id, ecsStateRef, zonasEmpresa]);
  const initialDirection = useMemo(() => {
    const ecsData = ecsStateRef?.current ? obtenerEstadoUsuarioEcs(ecsStateRef.current, currentUser.id) : null;
    if (ecsData && Date.now() - (ecsData.timestamp ?? 0) <= 2000) {
      return ecsData.direction ?? 'front';
    }
    return currentUser.direction ?? 'front';
  }, [currentUser.direction, currentUser.id, ecsStateRef]);
  const positionRef = useRef({ ...initialPosition });
  const [animationState, setAnimationState] = useState<AnimationState>('idle');
  const animationStateRef = useRef<AnimationState>('idle');
  
  // === SISTEMA DE ANIMACIONES CONTEXTUALES ===
  const [contextualAnim, setContextualAnim] = useState<AnimationState | null>(null);
  const contextualTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousUsersInCallRef = useRef<Set<string>>(new Set());
  const wavedToUsersRef = useRef<Set<string>>(new Set());

  // Auto-wave: detectar nuevos usuarios que entran en proximidad
  useEffect(() => {
    if (!usersInCallIds || usersInCallIds.size === 0) {
      previousUsersInCallRef.current = new Set();
      return;
    }
    const prev = previousUsersInCallRef.current;
    const newEntries: string[] = [];
    usersInCallIds.forEach(id => {
      if (!prev.has(id) && !wavedToUsersRef.current.has(id)) {
        newEntries.push(id);
        wavedToUsersRef.current.add(id);
      }
    });
    previousUsersInCallRef.current = new Set(usersInCallIds);

    // Si hay nuevos usuarios y no estamos en movimiento → wave
    if (newEntries.length > 0 && animationStateRef.current !== 'walk' && animationStateRef.current !== 'run') {
      setContextualAnim('wave');
      // XP por saludo automático (throttle 30s)
      onXPEvent?.('saludo_wave', 30000);
      if (contextualTimerRef.current) clearTimeout(contextualTimerRef.current);
      contextualTimerRef.current = setTimeout(() => {
        setContextualAnim(null);
      }, 3000);
    }
    return () => {
      if (contextualTimerRef.current) clearTimeout(contextualTimerRef.current);
    };
  }, [usersInCallIds]);

  // Fase 2: Sit contextual — sentarse automáticamente al estar idle cerca de una silla
  const sitCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (sitCheckRef.current) clearInterval(sitCheckRef.current);
    sitCheckRef.current = setInterval(() => {
      if (animationStateRef.current !== 'idle' || contextualAnim) return;
      const px = positionRef.current?.x;
      const pz = positionRef.current?.z;
      if (px == null || pz == null) return;
      for (const [cx, cz] of CHAIR_POSITIONS_3D) {
        const dx = px - cx, dz = pz - cz;
        if (Math.sqrt(dx * dx + dz * dz) < CHAIR_SIT_RADIUS) {
          setContextualAnim('sit');
          return;
        }
      }
      // Si estaba sentado contextualmente y se alejó de la silla, cancelar
    }, 1000);
    return () => { if (sitCheckRef.current) clearInterval(sitCheckRef.current); };
  }, [contextualAnim]);

  // Fase 3: Reacciones desde chat — detectar emojis en mensajes y disparar animación
  const prevMessageRef = useRef<string | undefined>();
  useEffect(() => {
    if (!message || message === prevMessageRef.current) return;
    prevMessageRef.current = message;
    const EMOJI_ANIM_MAP: [RegExp, AnimationState][] = [
      [/👋|🤚|✋/, 'wave'],
      [/🎉|🥳|🎊/, 'cheer'],
      [/💃|🕺|🪩/, 'dance'],
      [/🏆|🥇|✌️/, 'victory'],
      [/🦘|⬆️|🚀/, 'jump'],
    ];
    for (const [pattern, anim] of EMOJI_ANIM_MAP) {
      if (pattern.test(message)) {
        setContextualAnim(anim);
        if (contextualTimerRef.current) clearTimeout(contextualTimerRef.current);
        contextualTimerRef.current = setTimeout(() => setContextualAnim(null), 3000);
        break;
      }
    }
  }, [message]);

  // Cancelar animación contextual si el usuario se mueve
  useEffect(() => {
    if ((animationState === 'walk' || animationState === 'run') && contextualAnim) {
      setContextualAnim(null);
      if (contextualTimerRef.current) clearTimeout(contextualTimerRef.current);
    }
  }, [animationState, contextualAnim]);

  // Estado efectivo: contextual > keyboard
  const effectiveAnimState = contextualAnim || animationState;
  
  // Sincronizar ref con state
  useEffect(() => {
    animationStateRef.current = effectiveAnimState;
  }, [effectiveAnimState]);

  const [direction, setDirection] = useState<string>(initialDirection);
  const [isRunning, setIsRunning] = useState(false);
  const keysPressed = useRef<Set<string>>(new Set());
  const lastSyncTime = useRef(0);
  const lastBroadcastTime = useRef(0);
  const autoMoveTimeRef = useRef(0);
  const lastBroadcastRef = useRef<{ x: number; y: number; direction: string; isMoving: boolean; animState?: string } | null>(null);
  const { camera } = useThree();

  // Vectores reutilizables para movimiento relativo a cámara (evita GC)
  const camForwardVec = useMemo(() => new THREE.Vector3(), []);
  const camRightVec = useMemo(() => new THREE.Vector3(), []);
  const upVec = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  // Teletransportación
  const [teleportPhase, setTeleportPhase] = useState<'none' | 'out' | 'in'>('none');
  const [teleportOrigin, setTeleportOrigin] = useState<[number, number, number] | null>(null);
  const [teleportDest, setTeleportDest] = useState<[number, number, number] | null>(null);
  const teleportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Manejar teleport cuando llega un teleportTarget
  useEffect(() => {
    if (!teleportTarget) return;

    const originPos: [number, number, number] = [positionRef.current.x, 0, positionRef.current.z];
    const destPos: [number, number, number] = [teleportTarget.x, 0, teleportTarget.z];

    // Fase 1: Desaparición
    setTeleportOrigin(originPos);
    setTeleportDest(destPos);
    setTeleportPhase('out');
    playTeleportSound();

    // Fase 2: Mover al destino después de 300ms
    teleportTimerRef.current = setTimeout(() => {
      positionRef.current.x = teleportTarget.x;
      positionRef.current.z = teleportTarget.z;
      if (groupRef.current) {
        groupRef.current.position.x = teleportTarget.x;
        groupRef.current.position.z = teleportTarget.z;
      }
      // Sincronizar posición inmediatamente
      setPosition(teleportTarget.x * 16, teleportTarget.z * 16, 'front', false, false);
      (camera as any).userData.playerPosition = { x: teleportTarget.x, z: teleportTarget.z };

      setTeleportPhase('in');

      // Fase 3: Limpiar efecto
      setTimeout(() => {
        setTeleportPhase('none');
        setTeleportOrigin(null);
        setTeleportDest(null);
        if (onTeleportDone) onTeleportDone();
        // XP por teleport (throttle 5s)
        onXPEvent?.('teleport', 5000);
      }, 400);
    }, 300);

    return () => {
      if (teleportTimerRef.current) clearTimeout(teleportTimerRef.current);
    };
  }, [teleportTarget]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || (activeEl as HTMLElement).isContentEditable);
      if (isTyping) return;

      keysPressed.current.add(e.code);

      // Shift para correr
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        setIsRunning(true);
      }

      // Teclas de acción especiales (dance/cheer manuales, sit es contextual)
      if (e.code === 'KeyE') setAnimationState('cheer');
      if (e.code === 'KeyQ') setAnimationState('dance');

      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressed.current.delete(e.code);

      // Soltar shift
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        setIsRunning(false);
      }

      // Volver a idle cuando se sueltan teclas de acción
      if (['KeyE', 'KeyQ'].includes(e.code)) {
        setAnimationState('idle');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useFrame((state, delta) => {
    let dx = 0, dy = 0;
    let newDirection = direction;

    // Velocidad según si corre o camina
    const baseMoveSpeed = moveSpeed ?? MOVE_SPEED;
    const baseRunSpeed = runSpeed ?? RUN_SPEED;
    const speed = isRunning ? baseRunSpeed : baseMoveSpeed;

    // Movimiento por teclado
    const keyW = keysPressed.current.has('KeyW') || keysPressed.current.has('ArrowUp');
    const keyS = keysPressed.current.has('KeyS') || keysPressed.current.has('ArrowDown');
    const keyA = keysPressed.current.has('KeyA') || keysPressed.current.has('ArrowLeft');
    const keyD = keysPressed.current.has('KeyD') || keysPressed.current.has('ArrowRight');
    const hasKeyboardInput = keyW || keyS || keyA || keyD;

    // Movimiento por joystick mobile (solo si no hay input de teclado)
    const joystick = mobileInputRef?.current;
    const hasJoystickInput = !hasKeyboardInput && joystick && joystick.active && joystick.magnitude > 0;

    // Función auxiliar para verificar colisión con zonas prohibidas
    const isPositionValid = (x: number, z: number) => {
      const zonas = zonasRef.current;
      const auth = empresasAuthRef.current;
      const myEmpresa = currentUser.empresa_id;

      for (const zona of zonas) {
        if (zona.estado !== 'activa') continue;
        if (zona.es_comun) continue;
        if (myEmpresa && zona.empresa_id === myEmpresa) continue;
        if (zona.empresa_id && auth.includes(zona.empresa_id)) continue;

        // Verificar bounding box
        const zX = Number(zona.posicion_x) / 16;
        const zZ = Number(zona.posicion_y) / 16;
        const halfW = (Number(zona.ancho) / 16) / 2;
        const halfH = (Number(zona.alto) / 16) / 2;

        // Padding pequeño para evitar entrar justo al borde
        const padding = 0.2; 
        
        if (x > zX - halfW - padding && x < zX + halfW + padding && 
            z > zZ - halfH - padding && z < zZ + halfH + padding) {
          return false; // Posición prohibida
        }
      }
      return true;
    };

    // ── Vectores de cámara proyectados en XZ (para movimiento relativo a la vista) ──
    camera.getWorldDirection(camForwardVec);
    camForwardVec.y = 0;
    camForwardVec.normalize();
    camRightVec.crossVectors(camForwardVec, upVec).normalize();

    if (hasKeyboardInput) {
      // Teclado cancela cualquier movimiento por doble clic
      if (moveTarget && onReachTarget) { autoMoveTimeRef.current = 0; onReachTarget(); }

      // Movimiento relativo a la cámara: W=adelante, S=atrás, A=izquierda, D=derecha
      // según la perspectiva actual de la vista 3D
      let moveX = 0, moveZ = 0;
      if (keyW) { moveX += camForwardVec.x; moveZ += camForwardVec.z; }
      if (keyS) { moveX -= camForwardVec.x; moveZ -= camForwardVec.z; }
      if (keyA) { moveX -= camRightVec.x; moveZ -= camRightVec.z; }
      if (keyD) { moveX += camRightVec.x; moveZ += camRightVec.z; }

      // Normalizar + aplicar velocidad
      const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
      if (len > 0) {
        dx = (moveX / len) * speed * delta;
        dy = (moveZ / len) * speed * delta;
      }

      // Determinar dirección visual del avatar desde el vector de movimiento en mundo
      if (len > 0) {
        const absWorldX = Math.abs(moveX);
        const absWorldZ = Math.abs(moveZ);
        const ratio = Math.min(absWorldX, absWorldZ) / Math.max(absWorldX, absWorldZ || 0.001);
        const isDiag = ratio > 0.4;

        if (isDiag) {
          const fb = moveZ < 0 ? 'up' : 'front';
          const lr = moveX > 0 ? 'right' : 'left';
          newDirection = `${fb}-${lr}`;
        } else if (absWorldX > absWorldZ) {
          newDirection = moveX > 0 ? 'right' : 'left';
        } else {
          newDirection = moveZ < 0 ? 'up' : 'front';
        }
      }
    } else if (hasJoystickInput && joystick) {
      // Joystick mobile cancela moveTarget igual que teclado
      if (moveTarget && onReachTarget) { autoMoveTimeRef.current = 0; onReachTarget(); }

      // Joystick relativo a cámara: dz=forward/back, dx=left/right en la vista actual
      const joySpeed = joystick.isRunning ? baseRunSpeed : (baseMoveSpeed * joystick.magnitude);
      let moveX = camForwardVec.x * joystick.dz + camRightVec.x * joystick.dx;
      let moveZ = camForwardVec.z * joystick.dz + camRightVec.z * joystick.dx;
      const joyLen = Math.sqrt(moveX * moveX + moveZ * moveZ);
      if (joyLen > 0) {
        dx = (moveX / joyLen) * joySpeed * delta;
        dy = (moveZ / joyLen) * joySpeed * delta;
      }

      // Dirección visual del avatar desde movimiento en mundo
      if (joyLen > 0) {
        const absJx = Math.abs(moveX);
        const absJz = Math.abs(moveZ);
        const joyRatio = Math.min(absJx, absJz) / Math.max(absJx, absJz || 0.001);
        const joyDiag = joyRatio > 0.4;

        if (joyDiag) {
          const fb = moveZ < 0 ? 'up' : 'front';
          const lr = moveX > 0 ? 'right' : 'left';
          newDirection = `${fb}-${lr}`;
        } else if (absJx > absJz) {
          newDirection = moveX > 0 ? 'right' : 'left';
        } else {
          newDirection = moveZ < 0 ? 'up' : 'front';
        }
      }
    } else if (moveTarget) {
      // Movimiento automático hacia el destino (doble clic estilo Gather)
      const tx = moveTarget.x;
      const tz = moveTarget.z;
      const cx = positionRef.current.x;
      const cz = positionRef.current.z;
      const distX = tx - cx;
      const distZ = tz - cz;
      const dist = Math.sqrt(distX * distX + distZ * distZ);

      if (dist < 0.15) {
        // Llegó al destino
        autoMoveTimeRef.current = 0;
        if (onReachTarget) onReachTarget();
      } else {
        // Transición walk -> run
        autoMoveTimeRef.current += delta;
        const isAutoRunning = autoMoveTimeRef.current > 0.4;
        const autoSpeed = isAutoRunning ? baseRunSpeed : baseMoveSpeed;
        const step = Math.min(autoSpeed * delta, dist);

        // Aplicar movimiento directamente en X/Z
        positionRef.current.x = Math.max(0, Math.min(WORLD_SIZE, cx + (distX / dist) * step));
        positionRef.current.z = Math.max(0, Math.min(WORLD_SIZE, cz + (distZ / dist) * step));

        // Determinar dirección visual del avatar
        const absX = Math.abs(distX);
        const absZ = Math.abs(distZ);
        const ratio = Math.min(absX, absZ) / Math.max(absX, absZ);
        const isDiagonal = ratio > 0.4;

        if (isDiagonal) {
          const fb = distZ > 0 ? 'front' : 'up';
          const lr = distX > 0 ? 'right' : 'left';
          newDirection = `${fb}-${lr}`;
        } else if (absX > absZ) {
          newDirection = distX > 0 ? 'right' : 'left';
        } else {
          newDirection = distZ > 0 ? 'front' : 'up';
        }

        // Animación: walk al inicio, run después (movimiento SIEMPRE cancela wave/contextual)
        if (animationState !== 'cheer' && animationState !== 'dance' && animationState !== 'sit') {
          if (contextualAnim) { setContextualAnim(null); if (contextualTimerRef.current) clearTimeout(contextualTimerRef.current); }
          setAnimationState(isAutoRunning ? 'run' : 'walk');
        }
      }
    }

    // Movimiento por teclado o joystick (ambos producen dx/dy)
    const movingByDirectInput = dx !== 0 || dy !== 0;

    if (movingByDirectInput) {
      // Calcular nueva posición propuesta (dx/dy ya son deltas en coordenadas mundo)
      const nextX = Math.max(0, Math.min(WORLD_SIZE, positionRef.current.x + dx));
      const nextZ = Math.max(0, Math.min(WORLD_SIZE, positionRef.current.z + dy));

      // Verificar colisión con zonas prohibidas
      // Intentar mover en ambos ejes
      if (isPositionValid(nextX, nextZ)) {
        positionRef.current.x = nextX;
        positionRef.current.z = nextZ;
      } else {
        // Si falla, intentar deslizamiento (solo X)
        if (isPositionValid(nextX, positionRef.current.z)) {
          positionRef.current.x = nextX;
        } 
        // O solo Z
        else if (isPositionValid(positionRef.current.x, nextZ)) {
          positionRef.current.z = nextZ;
        }
        // Si ambos fallan, se bloquea (pared)
      }

      // Actualizar animación según movimiento (movimiento SIEMPRE cancela wave/contextual)
      if (animationState !== 'cheer' && animationState !== 'dance' && animationState !== 'sit') {
        if (contextualAnim) { setContextualAnim(null); if (contextualTimerRef.current) clearTimeout(contextualTimerRef.current); }
        const shouldRun = hasKeyboardInput ? isRunning : (hasJoystickInput && joystick?.isRunning);
        setAnimationState(shouldRun ? 'run' : 'walk');
      }
    }

    // Detectar si hay movimiento (teclado, joystick o automático)
    const moving = movingByDirectInput || (moveTarget !== null && moveTarget !== undefined);

    if (!moving && (animationState === 'walk' || animationState === 'run')) {
      setAnimationState('idle');
    }

    if (newDirection !== direction) setDirection(newDirection);

    // Mover el grupo del avatar
    if (groupRef.current) {
      groupRef.current.position.x = positionRef.current.x;
      groupRef.current.position.z = positionRef.current.z;
    }

    // Actualizar posición para CameraFollow
    (camera as any).userData.playerPosition = { x: positionRef.current.x, z: positionRef.current.z };

    if (onPositionUpdate) {
      onPositionUpdate(positionRef.current.x, positionRef.current.z);
    }

        // Sincronizar posición con el store
    const now = state.clock.getElapsedTime();
    if (now - lastSyncTime.current > 0.1) {
      setPosition(
        positionRef.current.x * 16,
        positionRef.current.z * 16,
        newDirection,
        effectiveAnimState === 'sit',
        moving
      );
      lastSyncTime.current = now;
    }

    if (broadcastMovement) {
      // Usar ref para garantizar estado fresco en el loop
      const currentAnim = animationStateRef.current;
      
      // Optimización: Solo enviar si hay cambios significativos
      const payload = {
        x: Number((positionRef.current.x * 16).toFixed(1)),
        y: Number((positionRef.current.z * 16).toFixed(1)),
        direction: newDirection,
        isMoving: moving,
        animState: currentAnim,
      };
      
      const last = lastBroadcastRef.current;
      const now = Date.now();
      
      // Detectar cambios reales
      const changed =
        !last ||
        Math.abs(last.x - payload.x) > 0.5 ||
        Math.abs(last.y - payload.y) > 0.5 ||
        last.direction !== payload.direction ||
        last.isMoving !== payload.isMoving ||
        last.animState !== payload.animState;

      const animChanged = !last || last.animState !== currentAnim;
      // Si la animación cambió, enviar con fiabilidad (reliable) para evitar que se pierda el paquete de inicio
      const isReliable = animChanged;

      // Heartbeat para animaciones especiales (dance, cheer, etc.)
      // Si estamos en una animación especial y no nos movemos, necesitamos reenviar 
      // el estado periódicamente para que el otro cliente no haga timeout (y vuelva a idle)
      const isSpecialAnim = !['idle', 'walk', 'run'].includes(currentAnim);
      // Reducido a 200ms para mayor fluidez y evitar timeouts por jitter
      const shouldHeartbeat = isSpecialAnim && (now - lastBroadcastTime.current > 200);

      if (changed || shouldHeartbeat) {
        broadcastMovement(payload.x, payload.y, payload.direction, payload.isMoving, payload.animState, isReliable);
        lastBroadcastRef.current = payload;
        lastBroadcastTime.current = now;
      }
    }
  });

  return (
    <>
      <group ref={groupRef} position={[positionRef.current.x, 0, positionRef.current.z]}>
        {/* Ocultar avatar durante fase 'out' del teleport */}
        {teleportPhase !== 'out' && (
          <Avatar
            position={new THREE.Vector3(0, 0, 0)}
            config={currentUser.avatarConfig}
            name={currentUser.name}
            status={currentUser.status}
            isCurrentUser={true}
            animationState={effectiveAnimState}
            direction={direction}
            reaction={reactions.length > 0 ? reactions[reactions.length - 1].emoji : null}
            videoStream={stream}
            camOn={currentUser.isCameraOn}
            showVideoBubble={showVideoBubble}
            message={message}
            onClickAvatar={onClickAvatar}
          />
        )}
        {/* Múltiples emojis flotantes estilo Gather */}
        {reactions.map((r, idx) => (
          <Html key={r.id} position={[0.3 * (idx % 3 - 1), 3.2 + (idx * 0.3), 0]} center distanceFactor={8} zIndexRange={[200, 0]}>
            <div className="animate-emoji-float text-4xl drop-shadow-[0_4px_12px_rgba(0,0,0,0.4)]">
              {r.emoji}
            </div>
          </Html>
        ))}
      </group>

      {/* Efectos de teletransportación */}
      {teleportPhase === 'out' && teleportOrigin && (
        <TeleportEffect position={teleportOrigin} phase="out" />
      )}
      {teleportPhase === 'in' && teleportDest && (
        <TeleportEffect position={teleportDest} phase="in" />
      )}
    </>
  );
};

