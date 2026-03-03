/**
 * @module hooks/space3d/useNotifications
 * Hook para notificaciones realtime, zonas de empresa, autorizaciones y solicitudes.
 * Maneja: canal de notificaciones Supabase, zonas privadas, solicitudes de acceso.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { cargarAutorizacionesActivas, cargarSolicitudesEnviadas, cargarZonasEmpresa, solicitarAccesoEmpresa } from '@/lib/autorizacionesEmpresa';
import type { AutorizacionEmpresa, ZonaEmpresa } from '@/types';
import { ZONA_SOLICITUD_RADIO, type UseNotificationsReturn, type UseNotificationsParams } from './types';

export function useNotifications(params: UseNotificationsParams): UseNotificationsReturn {
  const { session, activeWorkspace, currentUser, empresasAutorizadas, setEmpresasAutorizadas, currentUserEcs, notifSettings } = params;

  // ========== Zonas de empresa ==========
  const [zonasEmpresa, setZonasEmpresa] = useState<ZonaEmpresa[]>([]);

  useEffect(() => {
    const cargarZonas = async () => {
      if (!activeWorkspace?.id) {
        setZonasEmpresa([]);
        return;
      }
      const zonas = await cargarZonasEmpresa(activeWorkspace.id);
      setZonasEmpresa(zonas);
    };
    cargarZonas();
  }, [activeWorkspace?.id]);

  // ========== Autorizaciones ==========
  const cargarAutorizaciones = useCallback(async () => {
    if (!activeWorkspace?.id || !currentUser.empresa_id) {
      setEmpresasAutorizadas([]);
      return;
    }
    const autorizaciones = await cargarAutorizacionesActivas(activeWorkspace.id, currentUser.empresa_id);
    const empresas = new Set<string>();
    autorizaciones.forEach((autorizacion) => {
      if (autorizacion.empresa_origen_id === currentUser.empresa_id) {
        empresas.add(autorizacion.empresa_destino_id);
      } else if (autorizacion.empresa_destino_id === currentUser.empresa_id) {
        empresas.add(autorizacion.empresa_origen_id);
      }
    });
    setEmpresasAutorizadas(Array.from(empresas));
  }, [activeWorkspace?.id, currentUser.empresa_id, setEmpresasAutorizadas]);

  // ========== Solicitudes pendientes ==========
  const [solicitudesEnviadas, setSolicitudesEnviadas] = useState<AutorizacionEmpresa[]>([]);
  const [solicitandoAcceso, setSolicitandoAcceso] = useState(false);

  const cargarSolicitudesPendientes = useCallback(async () => {
    if (!activeWorkspace?.id || !currentUser.empresa_id) {
      setSolicitudesEnviadas([]);
      return;
    }
    const pendientes = await cargarSolicitudesEnviadas(activeWorkspace.id, currentUser.empresa_id);
    setSolicitudesEnviadas(pendientes);
  }, [activeWorkspace?.id, currentUser.empresa_id]);

  useEffect(() => {
    cargarAutorizaciones();
  }, [cargarAutorizaciones]);

  useEffect(() => {
    cargarSolicitudesPendientes();
  }, [cargarSolicitudesPendientes]);

  // ========== Notificación de autorización (toast) ==========
  const [notificacionAutorizacion, setNotificacionAutorizacion] = useState<UseNotificationsReturn['notificacionAutorizacion']>(null);
  const notificacionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Suscripción realtime a notificaciones
  useEffect(() => {
    if (!session?.user?.id) return;
    const channel = supabase
      .channel(`notificaciones-${session.user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notificaciones',
        filter: `usuario_id=eq.${session.user.id}`
      }, (payload) => {
        const nueva = payload.new as any;
        if (activeWorkspace?.id && nueva?.espacio_id && nueva.espacio_id !== activeWorkspace.id) return;
        setNotificacionAutorizacion({
          id: nueva.id,
          titulo: nueva.titulo || 'Notificación',
          mensaje: nueva.mensaje,
          tipo: nueva.tipo,
          datos_extra: nueva.datos_extra,
        });
        if (String(nueva.tipo || '').includes('autorizacion_empresa')) {
          cargarAutorizaciones();
          cargarSolicitudesPendientes();
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeWorkspace?.id, cargarAutorizaciones, cargarSolicitudesPendientes, session?.user?.id]);

  // Auto-dismiss de notificación
  useEffect(() => {
    if (!notificacionAutorizacion) return;
    if (notificacionTimeoutRef.current) {
      clearTimeout(notificacionTimeoutRef.current);
    }
    notificacionTimeoutRef.current = setTimeout(() => {
      setNotificacionAutorizacion(null);
    }, 6500);
    return () => {
      if (notificacionTimeoutRef.current) clearTimeout(notificacionTimeoutRef.current);
    };
  }, [notificacionAutorizacion]);

  // ========== Zona de acceso próxima ==========
  const solicitudesPendientesPorEmpresa = useMemo(() => {
    return new Set(solicitudesEnviadas.map((s) => s.empresa_destino_id));
  }, [solicitudesEnviadas]);

  const [zonaColisionadaId, setZonaColisionadaId] = useState<string | null>(null);

  const zonaAccesoProxima = useMemo(() => {
    if (!currentUserEcs.empresa_id) return null;
    if (!Number.isFinite(currentUserEcs.x) || !Number.isFinite(currentUserEcs.y)) return null;

    const zonaColisionada = zonaColisionadaId
      ? zonasEmpresa.find((zona) => zona.id === zonaColisionadaId)
      : null;

    if (zonaColisionada) {
      if (
        zonaColisionada.estado === 'activa' &&
        !zonaColisionada.es_comun &&
        zonaColisionada.empresa_id &&
        zonaColisionada.empresa_id !== currentUserEcs.empresa_id &&
        !empresasAutorizadas.includes(zonaColisionada.empresa_id)
      ) {
        const pendiente = solicitudesPendientesPorEmpresa.has(zonaColisionada.empresa_id);
        return { zona: zonaColisionada, distancia: 0, pendiente };
      }
    }

    let mejor: { zona: ZonaEmpresa; distancia: number; pendiente: boolean } | null = null;
    zonasEmpresa.forEach((zona) => {
      if (zona.estado !== 'activa') return;
      if (zona.es_comun) return;
      if (!zona.empresa_id || zona.empresa_id === currentUserEcs.empresa_id) return;
      if (empresasAutorizadas.includes(zona.empresa_id)) return;

      const halfAncho = Number(zona.ancho) / 2;
      const halfAlto = Number(zona.alto) / 2;
      const dx = Math.max(Math.abs(currentUserEcs.x - Number(zona.posicion_x)) - halfAncho, 0);
      const dy = Math.max(Math.abs(currentUserEcs.y - Number(zona.posicion_y)) - halfAlto, 0);
      const distancia = Math.sqrt(dx * dx + dy * dy);

      if (distancia > ZONA_SOLICITUD_RADIO) return;

      const pendiente = solicitudesPendientesPorEmpresa.has(zona.empresa_id);
      if (!mejor || distancia < mejor.distancia) {
        mejor = { zona, distancia, pendiente };
      }
    });

    return mejor;
  }, [currentUserEcs.empresa_id, currentUserEcs.x, currentUserEcs.y, empresasAutorizadas, solicitudesPendientesPorEmpresa, zonasEmpresa, zonaColisionadaId]);

  // ========== Solicitar acceso a zona ==========
  const handleSolicitarAccesoZona = useCallback(async () => {
    if (!zonaAccesoProxima?.zona || solicitandoAcceso) return;
    if (!activeWorkspace?.id || !currentUser.empresa_id || !session?.user?.id) return;
    if (zonaAccesoProxima.pendiente) return;

    setSolicitandoAcceso(true);
    const solicitudId = await solicitarAccesoEmpresa({
      espacioId: activeWorkspace.id,
      empresaOrigenId: currentUser.empresa_id,
      empresaDestinoId: zonaAccesoProxima.zona.empresa_id,
      usuarioId: session.user.id,
    });
    if (solicitudId) {
      await cargarSolicitudesPendientes();
      setNotificacionAutorizacion({
        id: solicitudId,
        titulo: 'Solicitud enviada',
        mensaje: 'La empresa recibirá tu solicitud en instantes.',
        tipo: 'solicitud_autorizacion_empresa',
        datos_extra: { empresa_destino_id: zonaAccesoProxima.zona.empresa_id },
      });
    }
    setSolicitandoAcceso(false);
  }, [activeWorkspace?.id, cargarSolicitudesPendientes, currentUser.empresa_id, session?.user?.id, solicitandoAcceso, zonaAccesoProxima]);

  return {
    notificacionAutorizacion,
    setNotificacionAutorizacion,
    solicitudesEnviadas,
    solicitandoAcceso,
    zonasEmpresa,
    zonaAccesoProxima,
    handleSolicitarAccesoZona,
    cargarAutorizaciones,
    setZonaColisionadaId,
  };
}
