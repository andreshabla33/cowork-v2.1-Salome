/**
 * @module hooks/space3d/useChunkSystem
 * Hook para gestión del sistema de chunks, ECS, workers de interpolación,
 * y filtrado de usuarios por visibilidad/chunks.
 */

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import type { User } from '@/types';
import { obtenerChunk, obtenerChunksVecinos } from '@/lib/chunkSystem';
import { filtrarUsuariosPorChunks, aplicarInteresEmpresa } from '@/lib/interestManager';
import {
  actualizarEstadoUsuarioEcs,
  crearEstadoEcsEspacio,
  limpiarEstadoEcs,
  obtenerEstadoUsuarioEcs,
  sincronizarUsuariosEcs,
} from '@/lib/ecs/espacioEcs';
import { USAR_LIVEKIT, type DireccionAvatar, type UseChunkSystemReturn, type UseChunkSystemParams } from './types';

export function useChunkSystem(params: UseChunkSystemParams): UseChunkSystemReturn {
  const { currentUser, onlineUsers, empresasAutorizadas, radioInteresChunks, setPosition } = params;

  // ========== Workers y ECS ==========
  const chunkWorkerRef = useRef<Worker | null>(null);
  const [chunkWorkerReady, setChunkWorkerReady] = useState(false);
  const [chunkWorkerHasData, setChunkWorkerHasData] = useState(false);
  const [chunkWorkerData, setChunkWorkerData] = useState<{ usuariosIds: string[]; chunksVecinos: string[] }>({
    usuariosIds: [],
    chunksVecinos: [],
  });
  const [chunkWorkerError, setChunkWorkerError] = useState<string | null>(null);
  const interpolacionWorkerRef = useRef<Worker | null>(null);
  const posicionesInterpoladasRef = useRef<Map<string, { x: number; z: number; direction?: DireccionAvatar; isMoving?: boolean }>>(new Map());
  const [interpolacionWorkerError, setInterpolacionWorkerError] = useState<string | null>(null);
  const ecsStateRef = useRef(crearEstadoEcsEspacio());
  const chunkVecinosRef = useRef<Set<string>>(new Set());
  const usuariosVisiblesRef = useRef<Set<string>>(new Set());

  // ========== Memoized user lists ==========
  const usuariosEcs = useMemo(() => {
    const mapa = new Map<string, User>();
    [currentUser, ...onlineUsers].forEach((usuario) => {
      mapa.set(usuario.id, usuario);
    });
    return Array.from(mapa.values());
  }, [currentUser, onlineUsers]);

  const usuariosEcsSnapshot = useMemo(() => {
    const ahora = Date.now();
    const mapa = new Map<string, { x: number; y: number; direction?: User['direction']; isMoving?: boolean }>();
    usuariosEcs.forEach((usuario) => {
      const ecsData = obtenerEstadoUsuarioEcs(ecsStateRef.current, usuario.id);
      if (ecsData && ahora - (ecsData.timestamp ?? 0) <= 2000) {
        mapa.set(usuario.id, {
          x: ecsData.x * 16,
          y: ecsData.z * 16,
          direction: ecsData.direction as User['direction'],
          isMoving: ecsData.isMoving,
        });
      }
    });
    return mapa;
  }, [usuariosEcs]);

  const currentUserEcs = useMemo(() => {
    const ecsData = usuariosEcsSnapshot.get(currentUser.id);
    if (!ecsData) return currentUser;
    return {
      ...currentUser,
      x: ecsData.x,
      y: ecsData.y,
      direction: ecsData.direction ?? currentUser.direction,
      isMoving: ecsData.isMoving ?? currentUser.isMoving,
    };
  }, [currentUser, usuariosEcsSnapshot]);

  const onlineUsersEcs = useMemo(() => {
    return onlineUsers.map((usuario) => {
      const ecsData = usuariosEcsSnapshot.get(usuario.id);
      if (!ecsData) return usuario;
      return {
        ...usuario,
        x: ecsData.x,
        y: ecsData.y,
        direction: ecsData.direction ?? usuario.direction,
        isMoving: ecsData.isMoving ?? usuario.isMoving,
      };
    });
  }, [onlineUsers, usuariosEcsSnapshot]);

  const usuariosEnChunks = useMemo(() => {
    let filtrados = onlineUsersEcs;
    if (chunkWorkerReady && chunkWorkerHasData) {
      const ids = new Set(chunkWorkerData.usuariosIds);
      filtrados = onlineUsersEcs.filter((usuario) => ids.has(usuario.id));
    } else {
      filtrados = filtrarUsuariosPorChunks(onlineUsersEcs, currentUserEcs.x, currentUserEcs.y, radioInteresChunks);
    }
    // Siempre incluir usuarios de la misma empresa o empresas autorizadas
    if (currentUserEcs.empresa_id) {
      const filtradosIds = new Set(filtrados.map(u => u.id));
      const faltantes = onlineUsersEcs.filter(u =>
        !filtradosIds.has(u.id) && (
          u.empresa_id === currentUserEcs.empresa_id ||
          (u.empresa_id && empresasAutorizadas.includes(u.empresa_id))
        )
      );
      if (faltantes.length > 0) filtrados = [...filtrados, ...faltantes];
    }
    return aplicarInteresEmpresa(filtrados, currentUserEcs.empresa_id, currentUserEcs.role, currentUserEcs.departamento_id, empresasAutorizadas);
  }, [onlineUsersEcs, currentUserEcs.empresa_id, currentUserEcs.role, currentUserEcs.departamento_id, currentUserEcs.x, currentUserEcs.y, radioInteresChunks, empresasAutorizadas, chunkWorkerData.usuariosIds, chunkWorkerHasData, chunkWorkerReady]);

  const usuariosParaConexion = useMemo(() => usuariosEnChunks.filter(u => !u.esFantasma), [usuariosEnChunks]);
  const usuariosParaMinimapa = useMemo(() => usuariosEnChunks.filter(u => !u.esFantasma), [usuariosEnChunks]);
  const chunkActual = useMemo(() => obtenerChunk(currentUserEcs.x, currentUserEcs.y), [currentUserEcs.x, currentUserEcs.y]);

  // ========== Chunk vecinos sync ==========
  useEffect(() => {
    if (chunkWorkerReady && chunkWorkerHasData && chunkWorkerData.chunksVecinos.length > 0) {
      chunkVecinosRef.current = new Set(chunkWorkerData.chunksVecinos);
      return;
    }
    const chunk = obtenerChunk(currentUserEcs.x, currentUserEcs.y);
    chunkVecinosRef.current = new Set(obtenerChunksVecinos(chunk, radioInteresChunks));
  }, [currentUserEcs.x, currentUserEcs.y, radioInteresChunks, chunkWorkerData.chunksVecinos, chunkWorkerHasData, chunkWorkerReady]);

  // ========== ECS sync ==========
  useEffect(() => {
    sincronizarUsuariosEcs(ecsStateRef.current, usuariosEcs);
  }, [usuariosEcs]);

  useEffect(() => {
    return () => {
      limpiarEstadoEcs(ecsStateRef.current);
    };
  }, []);

  // ========== Chunk Worker init ==========
  useEffect(() => {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('../../workers/chunkWorker.ts', import.meta.url), { type: 'module' });
      chunkWorkerRef.current = worker;
      setChunkWorkerReady(true);
      worker.onmessage = (event: MessageEvent) => {
        const { type, payload } = event.data || {};
        if (type === 'result') {
          setChunkWorkerData({
            usuariosIds: payload?.usuariosIds ?? [],
            chunksVecinos: payload?.chunksVecinos ?? [],
          });
          setChunkWorkerHasData(true);
        }
        if (type === 'error') {
          setChunkWorkerError(payload?.message || 'Error en worker de chunks');
        }
      };
      worker.onerror = (error) => {
        setChunkWorkerError(error.message || 'Error inicializando worker de chunks');
      };
    } catch (error) {
      setChunkWorkerError('No se pudo iniciar el worker de chunks');
    }

    return () => {
      if (worker) worker.terminate();
      chunkWorkerRef.current = null;
    };
  }, []);

  // ========== Interpolation Worker init ==========
  useEffect(() => {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('../../workers/interpolacionWorker.ts', import.meta.url), { type: 'module' });
      interpolacionWorkerRef.current = worker;
      worker.onmessage = (event: MessageEvent) => {
        const { type, payload } = event.data || {};
        if (type === 'update') {
          const positions = payload?.positions ?? [];
          if (positions.length === 0) return;
          const mapa = posicionesInterpoladasRef.current;
          positions.forEach((pos: { id: string; x: number; z: number; direction?: DireccionAvatar; isMoving?: boolean }) => {
            mapa.set(pos.id, { x: pos.x, z: pos.z, direction: pos.direction, isMoving: pos.isMoving });
          });
        }
        if (type === 'error') {
          setInterpolacionWorkerError(payload?.message || 'Error en worker de interpolación');
        }
      };
      worker.onerror = (error) => {
        setInterpolacionWorkerError(error.message || 'Error inicializando worker de interpolación');
      };
    } catch (error) {
      setInterpolacionWorkerError('No se pudo iniciar el worker de interpolación');
    }

    return () => {
      if (worker) worker.terminate();
      interpolacionWorkerRef.current = null;
      posicionesInterpoladasRef.current.clear();
    };
  }, []);

  // ========== Chunk Worker compute trigger ==========
  useEffect(() => {
    if (!chunkWorkerRef.current || !chunkWorkerReady) return;
    if (!Number.isFinite(currentUserEcs.x) || !Number.isFinite(currentUserEcs.y)) return;
    chunkWorkerRef.current.postMessage({
      type: 'compute',
      payload: {
        current: { x: currentUserEcs.x, y: currentUserEcs.y },
        radio: radioInteresChunks,
        users: onlineUsers.map((usuario) => ({
          id: usuario.id,
          x: usuariosEcsSnapshot.get(usuario.id)?.x ?? usuario.x,
          y: usuariosEcsSnapshot.get(usuario.id)?.y ?? usuario.y,
        })),
      }
    });
  }, [onlineUsers, currentUserEcs.x, currentUserEcs.y, radioInteresChunks, chunkWorkerReady, usuariosEcsSnapshot]);

  // ========== Visible users sync ==========
  useEffect(() => {
    usuariosVisiblesRef.current = new Set(usuariosParaConexion.map(usuario => usuario.id));
  }, [usuariosParaConexion]);

  // ========== Direction normalizer ==========
  const normalizarDireccion = useCallback((direccion?: string): User['direction'] | undefined => {
    if (!direccion) return undefined;
    if (direccion === 'front' || direccion === 'back' || direccion === 'left' || direccion === 'right') {
      return direccion as User['direction'];
    }
    if (direccion.startsWith('up')) return 'back';
    if (direccion.startsWith('front') || direccion === 'down') return 'front';
    return 'front';
  }, []);

  // ========== setPosition with ECS sync ==========
  const setPositionEcs = useCallback((x: number, y: number, direction?: string, isSitting?: boolean, isMoving?: boolean) => {
    setPosition(x, y, normalizarDireccion(direction), isSitting, isMoving);
    if (currentUser?.id) {
      actualizarEstadoUsuarioEcs(
        ecsStateRef.current,
        currentUser.id,
        x / 16,
        y / 16,
        direction,
        isMoving
      );
    }
  }, [currentUser?.id, normalizarDireccion, setPosition]);

  return {
    ecsStateRef,
    chunkWorkerRef,
    interpolacionWorkerRef,
    posicionesInterpoladasRef,
    currentUserEcs,
    onlineUsersEcs,
    usuariosEnChunks,
    usuariosParaConexion,
    usuariosParaMinimapa,
    chunkActual,
    chunkVecinosRef,
    usuariosVisiblesRef,
    setPositionEcs,
    normalizarDireccion,
  };
}
