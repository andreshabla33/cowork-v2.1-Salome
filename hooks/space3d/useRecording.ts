/**
 * @module hooks/space3d/useRecording
 * Hook para gestión de estado de grabación.
 * Maneja: recording trigger, isRecording, duration, consent, tipo.
 */

import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { UseRecordingReturn } from './types';

export function useRecording(
  sessionUserId: string | undefined
): UseRecordingReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [consentimientoAceptado, setConsentimientoAceptado] = useState(false);
  const [tipoGrabacionActual, setTipoGrabacionActual] = useState<string | null>(null);
  const [recordingTrigger, setRecordingTrigger] = useState(false);

  // Toggle grabación — dispara el trigger que RecordingManager consume
  const handleToggleRecording = useCallback(() => {
    setRecordingTrigger(true);
  }, []);

  // Escuchar notificaciones de consentimiento aceptado (para el grabador)
  useEffect(() => {
    if (!sessionUserId) return;

    const channel = supabase
      .channel('consentimiento_respuesta_grabador')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notificaciones',
          filter: `usuario_id=eq.${sessionUserId}`,
        },
        (payload) => {
          const notif = payload.new as any;
          if (notif.tipo === 'consentimiento_respuesta' && notif.titulo?.includes('Aceptado')) {
            console.log('✅ Consentimiento aceptado por el evaluado');
            setConsentimientoAceptado(true);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionUserId]);

  return {
    isRecording,
    setIsRecording,
    recordingDuration,
    setRecordingDuration,
    consentimientoAceptado,
    setConsentimientoAceptado,
    tipoGrabacionActual,
    setTipoGrabacionActual,
    recordingTrigger,
    setRecordingTrigger,
    handleToggleRecording,
  };
}
