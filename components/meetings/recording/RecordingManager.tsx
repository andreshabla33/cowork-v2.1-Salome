/**
 * RecordingManager - Componente de grabación con análisis conductual avanzado
 * 
 * Características:
 * - Selector de tipo: RRHH, Deals, Equipo
 * - Disclaimer condicional (solo RRHH)
 * - Análisis facial avanzado con microexpresiones
 * - Análisis de lenguaje corporal
 * - Predicciones de comportamiento
 * - Dashboard específico por tipo
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { useTranscription } from './useTranscription';
import { useCombinedAnalysis, AnalisisResumenTiempoReal } from './useCombinedAnalysis';
import { RecordingTypeSelectorV2 } from './RecordingTypeSelectorV2';
import { AnalysisDashboard } from './AnalysisDashboard';
import { 
  TipoGrabacionDetallado,
  CargoLaboral,
  CONFIGURACIONES_GRABACION_DETALLADO,
  getConfiguracionConMetricasCustom,
  ResultadoAnalisis,
  tienePermisoAnalisis,
} from './types/analysis';

interface UsuarioEnLlamada {
  id: string;
  nombre: string;
}

interface RecordingManagerProps {
  espacioId: string;
  userId: string;
  userName: string;
  reunionTitulo?: string;
  stream: MediaStream | null;
  cargoUsuario?: CargoLaboral;
  usuariosEnLlamada?: UsuarioEnLlamada[]; // Usuarios en la llamada para seleccionar evaluado
  onRecordingStateChange?: (isRecording: boolean) => void;
  onProcessingComplete?: (resultado: ResultadoAnalisis | null) => void;
  onDurationChange?: (duration: number) => void;
  onTipoGrabacionChange?: (tipo: string | null) => void;
  headlessMode?: boolean;
  externalTrigger?: boolean;
  onExternalTriggerHandled?: () => void;
  preselectedTipoGrabacion?: TipoGrabacionDetallado; // Auto-seleccionar tipo (saltar selector)
  onRequestGuestConsent?: (guestName: string, guestEmail: string, grabacionId: string) => void;
}

interface ProcessingState {
  step: 'idle' | 'selecting_type' | 'recording' | 'stopping' | 'processing' | 'complete' | 'error';
  progress: number;
  message: string;
  duration: number;
}

export const RecordingManager: React.FC<RecordingManagerProps> = ({
  espacioId,
  userId,
  userName,
  reunionTitulo,
  stream,
  cargoUsuario = 'colaborador',
  usuariosEnLlamada = [],
  onRecordingStateChange,
  onExternalTriggerHandled,
  headlessMode,
  externalTrigger,
  onProcessingComplete,
  onDurationChange,
  onTipoGrabacionChange,
  preselectedTipoGrabacion,
  onRequestGuestConsent,
}) => {
  // Estados principales
  const [processingState, setProcessingState] = useState<ProcessingState>({
    step: 'idle',
    progress: 0,
    message: '',
    duration: 0,
  });
  const [tipoGrabacion, setTipoGrabacion] = useState<TipoGrabacionDetallado | null>(null);
  const [conAnalisis, setConAnalisis] = useState<boolean>(true);
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [resultado, setResultado] = useState<ResultadoAnalisis | null>(null);
  const [resumenTiempoReal, setResumenTiempoReal] = useState<AnalisisResumenTiempoReal | null>(null);

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const grabacionIdRef = useRef<string>('');
  const transcriptRef = useRef<string>('');
  const videoElementRef = useRef<HTMLVideoElement | null>(null);

  const isRecording = processingState.step === 'recording';
  const config = tipoGrabacion ? getConfiguracionConMetricasCustom(tipoGrabacion) : null;

  // Hook de transcripción
  const {
    startTranscription,
    stopTranscription,
    transcribeAudioBlob,
    fullTranscript,
    segments,
  } = useTranscription({
    grabacionId: grabacionIdRef.current || 'pending',
    idioma: 'es',
    onFullTranscriptUpdate: (text) => {
      transcriptRef.current = text;
    },
  });

  // Obtener tipo base para el hook de análisis (rrhh_entrevista y rrhh_one_to_one -> rrhh)
  const tipoBase = tipoGrabacion 
    ? CONFIGURACIONES_GRABACION_DETALLADO[tipoGrabacion].tipoBase 
    : 'equipo';

  // Hook de análisis combinado (se inicializa cuando se selecciona tipo)
  const combinedAnalysis = useCombinedAnalysis({
    tipoGrabacion: tipoBase,
    grabacionId: grabacionIdRef.current || 'pending',
    participantes: [{ id: userId, nombre: userName }],
    onAnalisisUpdate: (resumen) => {
      setResumenTiempoReal(resumen);
    },
  });

  // Actualizar estado
  const updateState = useCallback((updates: Partial<ProcessingState>) => {
    setProcessingState(prev => ({ ...prev, ...updates }));
  }, []);

  // Limpiar error automáticamente después de 5 segundos o cuando el stream esté disponible
  useEffect(() => {
    if (processingState.step === 'error') {
      const timer = setTimeout(() => {
        updateState({ step: 'idle', message: '' });
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [processingState.step, updateState]);

  // Limpiar error cuando el stream esté disponible
  useEffect(() => {
    if (stream && processingState.step === 'error' && processingState.message.includes('stream')) {
      updateState({ step: 'idle', message: '' });
    }
  }, [stream, processingState.step, processingState.message, updateState]);

  // Buscar o crear elemento de video para análisis conductual
  const hiddenVideoRef = useRef<HTMLVideoElement | null>(null);
  
  const findVideoElement = useCallback((): HTMLVideoElement | null => {
    if (!stream) return null;
    
    // Primero buscar en el DOM un video con nuestro stream
    const videoElements = document.querySelectorAll('video');
    for (const video of videoElements) {
      if (video.srcObject === stream) {
        return video as HTMLVideoElement;
      }
    }
    
    // En LiveKit los videos se renderizan internamente,
    // así que creamos un video oculto para el análisis facial/corporal
    if (!hiddenVideoRef.current) {
      const hiddenVideo = document.createElement('video');
      hiddenVideo.style.position = 'absolute';
      hiddenVideo.style.width = '1px';
      hiddenVideo.style.height = '1px';
      hiddenVideo.style.opacity = '0.01';
      hiddenVideo.style.pointerEvents = 'none';
      hiddenVideo.style.zIndex = '-1';
      hiddenVideo.setAttribute('playsinline', 'true');
      hiddenVideo.setAttribute('autoplay', 'true');
      hiddenVideo.muted = true;
      document.body.appendChild(hiddenVideo);
      hiddenVideoRef.current = hiddenVideo;
    }
    
    // Asignar el stream al video oculto
    if (hiddenVideoRef.current.srcObject !== stream) {
      hiddenVideoRef.current.srcObject = stream;
      hiddenVideoRef.current.play().catch(() => {});
    }
    
    console.log('🎥 Video oculto creado para análisis conductual');
    return hiddenVideoRef.current;
  }, [stream]);

  // Limpiar video oculto al desmontar
  useEffect(() => {
    return () => {
      if (hiddenVideoRef.current) {
        hiddenVideoRef.current.srcObject = null;
        hiddenVideoRef.current.remove();
        hiddenVideoRef.current = null;
      }
    };
  }, []);

  // Validar si es UUID válido
  const isValidUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

  // Iniciar grabación
  const startRecording = useCallback(async (tipo: TipoGrabacionDetallado, analisis: boolean = true, evaluadoId?: string, evaluadoNombre?: string, evaluadoEmail?: string) => {
    if (!stream) {
      updateState({ step: 'error', message: 'No hay stream de audio/video disponible' });
      return;
    }

    try {
      // Inicializar refs
      chunksRef.current = [];
      transcriptRef.current = '';
      grabacionIdRef.current = crypto.randomUUID();

      // Buscar video element
      const videoEl = findVideoElement();
      if (videoEl) {
        videoElementRef.current = videoEl;
      }

      // Configurar MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : 'video/webm';

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 2500000,
        audioBitsPerSecond: 128000,
      });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        processRecording();
      };

      mediaRecorderRef.current = recorder;
      startTimeRef.current = Date.now();

      // Registrar en Supabase
      console.log('💾 Insertando grabación en BD...', { espacio_id: espacioId, creado_por: userId });
      const { error: insertError } = await supabase.from('grabaciones').insert({
        id: grabacionIdRef.current,
        espacio_id: espacioId,
        creado_por: userId,
        estado: 'grabando',
        inicio_grabacion: new Date().toISOString(),
        tipo: tipo,
        tiene_video: true,
        tiene_audio: true,
        formato: 'webm',
        evaluado_id: (evaluadoId && isValidUUID(evaluadoId)) ? evaluadoId : null,
        evaluado_nombre: evaluadoNombre || null,
        evaluado_email: evaluadoEmail || null,
      });
      
      if (insertError) {
        console.error('❌ Error insertando grabación:', insertError);
        updateState({ step: 'error', message: `Error creando grabación: ${insertError.message}` });
        return;
      }
      console.log('✅ Grabación insertada en BD');

      // Si hay evaluado con UUID válido, enviar solicitud de consentimiento
      if (evaluadoId && isValidUUID(evaluadoId)) {
        console.log('📨 Enviando solicitud de consentimiento a:', evaluadoId);
        const { error: consentError } = await supabase.rpc('solicitar_consentimiento_grabacion', {
          p_grabacion_id: grabacionIdRef.current,
          p_evaluado_id: evaluadoId,
          p_tipo_grabacion: tipo,
        });
        if (consentError) {
          console.warn('⚠️ Error enviando solicitud de consentimiento:', consentError);
        } else {
          console.log('✅ Solicitud de consentimiento enviada');
        }
      } else if (evaluadoId && evaluadoNombre) {
        // Invitado externo: solicitar consentimiento via DataChannel
        console.log('👤 Evaluado es invitado externo, solicitando consentimiento via DataChannel:', evaluadoNombre, evaluadoEmail);
        onRequestGuestConsent?.(evaluadoNombre, evaluadoEmail || '', grabacionIdRef.current);
      }

      // Registrar al grabador como participante
      await supabase.from('participantes_grabacion').insert({
        grabacion_id: grabacionIdRef.current,
        usuario_id: userId,
        nombre_mostrado: userName,
        es_evaluado: false,
        consentimiento_dado: true,
        consentimiento_fecha: new Date().toISOString(),
      });

      // Iniciar grabación
      recorder.start(1000);

      // Timer de duración
      durationIntervalRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        updateState({ duration: elapsed });
        onDurationChange?.(elapsed); // Notificar al padre
      }, 1000);

      updateState({ 
        step: 'recording', 
        progress: 0, 
        message: `Grabando ${CONFIGURACIONES_GRABACION_DETALLADO[tipo].titulo}...`, 
        duration: 0 
      });
      onRecordingStateChange?.(true);
      onTipoGrabacionChange?.(tipo); // Notificar el tipo para el banner

      // Iniciar transcripción
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
        const audioStream = new MediaStream(audioTracks);
        startTranscription(audioStream).catch(err => {
          console.warn('⚠️ Transcripción en tiempo real no disponible:', err.message);
        });
      }

      // Iniciar análisis combinado (facial + corporal)
      if (videoElementRef.current) {
        await combinedAnalysis.startAnalysis(videoElementRef.current);
      }

      console.log(`🔴 Grabación iniciada: ${tipo.toUpperCase()}`);

    } catch (err: any) {
      console.error('Error iniciando grabación:', err);
      updateState({ step: 'error', message: err.message || 'Error al iniciar grabación' });
    }
  }, [stream, espacioId, userId, updateState, onRecordingStateChange, startTranscription, findVideoElement, combinedAnalysis]);

  // Detener grabación
  const stopRecording = useCallback(async () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      updateState({ step: 'stopping', message: 'Deteniendo grabación...' });

      // Limpiar timer
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }

      // Detener transcripción y capturar resultado
      const finalTranscript = await stopTranscription();
      if (finalTranscript && finalTranscript.length > 0) {
        transcriptRef.current = finalTranscript;
        console.log('📝 Transcripción final capturada:', finalTranscript.length, 'caracteres');
      }

      // Detener análisis combinado
      combinedAnalysis.stopAnalysis();

      // Forzar último dataavailable antes de stop (fix: chunks vacíos)
      try {
        if (mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.requestData();
        }
      } catch (e) {
        console.warn('⚠️ requestData falló (normal si ya se detuvo):', e);
      }

      // Esperar un tick para que el último chunk se procese antes de stop
      await new Promise(resolve => setTimeout(resolve, 200));

      // Detener MediaRecorder (dispara processRecording via onstop)
      if (mediaRecorderRef.current && (mediaRecorderRef.current.state === 'recording' || mediaRecorderRef.current.state === 'paused')) {
        mediaRecorderRef.current.stop();
      }
      onRecordingStateChange?.(false);

      console.log('⏹️ Grabación detenida');
    }
  }, [updateState, onRecordingStateChange, stopTranscription, combinedAnalysis]);

  // Manejar selección de tipo
  const handleTypeSelect = useCallback(async (tipo: TipoGrabacionDetallado, analisis: boolean, evaluadoId?: string, evaluadoNombre?: string, evaluadoEmail?: string) => {
    console.log('🎬 Tipo seleccionado:', tipo, 'con análisis:', analisis, 'evaluado:', evaluadoId, 'nombre:', evaluadoNombre, 'email:', evaluadoEmail);
    setTipoGrabacion(tipo);
    setConAnalisis(analisis);
    setShowTypeSelector(false);
    await startRecording(tipo, analisis, evaluadoId, evaluadoNombre, evaluadoEmail);
  }, [startRecording]);

  // Manejar trigger externo
  useEffect(() => {
    if (externalTrigger && onExternalTriggerHandled) {
      if (isRecording) {
        stopRecording();
      } else if (preselectedTipoGrabacion) {
        // Si requiere disclaimer (RRHH), mostrar selector para elegir evaluado y aceptar
        const preConfig = CONFIGURACIONES_GRABACION_DETALLADO[preselectedTipoGrabacion];
        if (preConfig?.requiereDisclaimer) {
          console.log('🎬 Tipo predefinido requiere disclaimer, mostrando selector:', preselectedTipoGrabacion);
          setShowTypeSelector(true);
        } else {
          console.log('🎬 Auto-inicio con tipo predefinido:', preselectedTipoGrabacion);
          handleTypeSelect(preselectedTipoGrabacion, true);
        }
      } else {
        setShowTypeSelector(true);
      }
      onExternalTriggerHandled();
    }
  }, [externalTrigger, onExternalTriggerHandled, isRecording, stopRecording, preselectedTipoGrabacion, handleTypeSelect]);

  // Manejar selección de tipo de grabar
  const handleRecordClick = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else if (preselectedTipoGrabacion) {
      // Si requiere disclaimer (RRHH), mostrar selector para elegir evaluado
      const preConfig = CONFIGURACIONES_GRABACION_DETALLADO[preselectedTipoGrabacion];
      if (preConfig?.requiereDisclaimer) {
        setShowTypeSelector(true);
      } else {
        handleTypeSelect(preselectedTipoGrabacion, true);
      }
    } else {
      setShowTypeSelector(true);
    }
  }, [isRecording, stopRecording, preselectedTipoGrabacion, handleTypeSelect]);

  // Procesar grabación
  const processRecording = useCallback(async () => {
    try {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      // Calcular duración desde startTimeRef (más confiable que el estado)
      const duration = Math.floor((Date.now() - startTimeRef.current) / 1000);
      console.log('📊 Duración calculada:', duration, 'segundos');

      updateState({ step: 'processing', progress: 20, message: 'Procesando transcripción...' });

      // Obtener transcripción - intentar múltiples fuentes
      let transcript = transcriptRef.current;
      console.log('📝 Transcripción desde ref:', transcript?.length || 0, 'caracteres');
      
      // Si el ref está vacío, intentar desde fullTranscript del hook
      if (!transcript || transcript.trim().length < 20) {
        transcript = fullTranscript;
        console.log('📝 Transcripción desde fullTranscript:', transcript?.length || 0, 'caracteres');
      }
      
      // Si aún está vacío, intentar concatenar segments
      if (!transcript || transcript.trim().length < 20) {
        if (segments && segments.length > 0) {
          transcript = segments.map(s => s.texto).join(' ');
          console.log('📝 Transcripción desde segments:', transcript?.length || 0, 'caracteres');
        }
      }
      
      // Último recurso: transcribir el blob de audio
      if (!transcript || transcript.trim().length < 20) {
        console.log('📝 Intentando transcribir blob de audio...');
        try {
          transcript = await transcribeAudioBlob(blob) || '';
          console.log('📝 Transcripción desde blob:', transcript?.length || 0, 'caracteres');
        } catch (err) {
          console.warn('⚠️ Error transcribiendo blob:', err);
        }
      }
      
      // Si todo falla, usar placeholder informativo
      if (!transcript || transcript.trim().length < 10) {
        transcript = `[Grabación de ${Math.round(duration / 60)} minutos - transcripción no disponible]`;
        console.warn('⚠️ Usando placeholder para transcripción');
      }

      updateState({ progress: 40, message: 'Generando análisis conductual...' });

      // Obtener resultado de análisis combinado
      const resultadoAnalisis = combinedAnalysis.getResultadoCompleto();

      updateState({ progress: 50, message: 'Guardando transcripción...' });

      // Guardar transcripción en Supabase
      if (transcript && transcript.trim().length > 0) {
        console.log('📝 Guardando transcripción en BD...');
        try {
          const transcripcionRecord = {
            grabacion_id: grabacionIdRef.current,
            texto: transcript,
            inicio_segundos: 0,
            fin_segundos: duration,
            speaker_id: userId,
            speaker_nombre: userName,
            confianza: 0.9,
            idioma: 'es',
          };
          
          const { error: transcError } = await supabase
            .from('transcripciones')
            .insert(transcripcionRecord);
          
          if (transcError) {
            console.error('❌ Error guardando transcripción:', transcError);
          } else {
            console.log('✅ Transcripción guardada en Supabase');
          }
        } catch (err) {
          console.error('❌ Error inesperado guardando transcripción:', err);
        }
      } else {
        console.log('⚠️ Sin transcripción que guardar');
      }

      updateState({ progress: 70, message: 'Guardando análisis conductual...' });

      // Guardar análisis en Supabase
      const emotionFrames = resultadoAnalisis.frames_faciales;
      if (emotionFrames.length > 0) {
        const emotionRecords = emotionFrames
          .filter((_, i) => i % 2 === 0) // Cada 2 frames para mejor resolución
          .map((e) => ({
            id: crypto.randomUUID(),
            grabacion_id: grabacionIdRef.current,
            timestamp_segundos: e.timestamp_segundos,
            emocion_dominante: e.emocion_dominante,
            engagement_score: e.engagement_score,
            participante_id: userId,
            participante_nombre: userName,
          }));

        // Insertar en lotes
        for (let i = 0; i < emotionRecords.length; i += 50) {
          const batch = emotionRecords.slice(i, i + 50);
          const { error: analisisError } = await supabase.from('analisis_comportamiento').insert(batch);
          if (analisisError) {
            console.error('Error guardando análisis:', analisisError);
          }
        }
        console.log(`✅ ${emotionRecords.length} registros de análisis guardados`);
      } else {
        console.warn('⚠️ No hay frames de análisis para guardar');
      }

      updateState({ progress: 80, message: 'Generando resumen AI...' });

      // Generar resumen AI (con timeout para no bloquear)
      const avgEngagement = emotionFrames.length > 0
        ? emotionFrames.reduce((sum, f) => sum + f.engagement_score, 0) / emotionFrames.length
        : 0.5;

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData?.session?.access_token;
        
        if (accessToken) {
          console.log('🤖 Llamando a generar-resumen-ai...');
          // Muestrear emociones uniformemente (máx 100 frames distribuidos en toda la grabación)
          const maxEmotionFrames = 100;
          const sampledEmotions = emotionFrames.length <= maxEmotionFrames
            ? emotionFrames
            : emotionFrames.filter((_, i) => i % Math.ceil(emotionFrames.length / maxEmotionFrames) === 0);
          
          // Usar Promise.race con timeout de 60 segundos (reuniones largas necesitan más)
          const aiPromise = supabase.functions.invoke('generar-resumen-ai', {
            headers: { Authorization: `Bearer ${accessToken}` },
            body: {
              grabacion_id: grabacionIdRef.current,
              espacio_id: espacioId,
              creador_id: userId,
              transcripcion: transcript,
              emociones: sampledEmotions,
              duracion_segundos: duration,
              participantes: [userName],
              reunion_titulo: reunionTitulo,
              tipo_grabacion: tipoGrabacion,
              metricas_adicionales: {
                engagement_promedio: avgEngagement,
                microexpresiones_detectadas: resultadoAnalisis.microexpresiones.length,
                tipo_analisis: tipoGrabacion,
                total_emotion_frames: emotionFrames.length,
              },
            },
          });
          
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), 60000)
          );
          
          try {
            const { error: aiError } = await Promise.race([aiPromise, timeoutPromise]) as any;
            if (aiError) {
              console.warn('⚠️ Error generando resumen AI:', aiError.message);
            } else {
              console.log('✅ Resumen AI generado');
            }
          } catch (timeoutErr) {
            console.warn('⚠️ Timeout generando resumen AI, continuando...');
          }
        } else {
          console.warn('⚠️ No hay sesión activa para generar resumen AI');
        }
      } catch (aiErr) {
        console.warn('⚠️ Error en proceso AI, continuando:', aiErr);
      }

      // Actualizar grabación en Supabase (metadatos sin archivo de video)
      await supabase.from('grabaciones').update({
        estado: 'completado',
        duracion_segundos: duration,
        fin_grabacion: new Date().toISOString(),
        archivo_nombre: reunionTitulo || `Reunión ${new Date().toLocaleDateString('es-ES')}`,
      }).eq('id', grabacionIdRef.current);

      // Video procesado localmente - no se sube a storage por privacidad
      console.log('📹 Video procesado localmente (no subido a storage)');

      // Guardar resultado
      setResultado(resultadoAnalisis);
      setShowDashboard(true);
      updateState({ step: 'complete', progress: 100, message: '¡Análisis completado!' });
      onProcessingComplete?.(resultadoAnalisis);

      // Notificación
      await supabase.from('notificaciones').insert({
        usuario_id: userId,
        espacio_id: espacioId,
        tipo: 'analisis_listo',
        titulo: `📊 Análisis de ${config?.titulo || 'reunión'} listo`,
        mensaje: reunionTitulo
          ? `El análisis de "${reunionTitulo}" está disponible`
          : 'El análisis de tu reunión está disponible',
        entidad_tipo: 'grabacion',
        entidad_id: grabacionIdRef.current,
      });

      console.log('✅ Procesamiento completo');

    } catch (err: any) {
      console.error('Error procesando grabación:', err);
      updateState({ step: 'error', message: err.message || 'Error en el procesamiento' });

      // Marcar grabación como error
      await supabase.from('grabaciones').update({
        estado: 'error',
        error_mensaje: err.message || 'Error en procesamiento',
      }).eq('id', grabacionIdRef.current);
    }
  }, [
    processingState.duration, 
    updateState, 
    onProcessingComplete, 
    combinedAnalysis, 
    transcribeAudioBlob,
    fullTranscript,
    segments,
    userId, 
    userName, 
    espacioId, 
    reunionTitulo, 
    tipoGrabacion,
    config,
  ]);

  // Formatear duración
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Cleanup
  useEffect(() => {
    return () => {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
      if (mediaRecorderRef.current?.state !== 'inactive') {
        mediaRecorderRef.current?.stop();
      }
    };
  }, []);

  return (
    <>
      {/* Selector de tipo con permisos por cargo */}
      <RecordingTypeSelectorV2
        isOpen={showTypeSelector}
        onClose={() => setShowTypeSelector(false)}
        onSelect={handleTypeSelect}
        cargoUsuario={cargoUsuario}
        usuariosEnLlamada={usuariosEnLlamada}
        currentUserId={userId}
        preselectedType={preselectedTipoGrabacion}
      />

      {/* Dashboard de resultados */}
      {showDashboard && resultado && (
        <AnalysisDashboard
          resultado={resultado}
          onClose={() => {
            setShowDashboard(false);
            setResultado(null);
            setTipoGrabacion(null);
            updateState({ step: 'idle', progress: 0, message: '', duration: 0 });
          }}
          onExport={() => {
            const json = JSON.stringify(resultado, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `analisis_${resultado.tipo_grabacion}_${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        />
      )}

      {/* Modal de procesamiento */}
      {(processingState.step === 'stopping' || processingState.step === 'processing') && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[300] flex items-center justify-center">
          <div className="bg-zinc-900 rounded-2xl p-6 max-w-md w-full mx-4 border border-white/10 shadow-2xl">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 relative">
                <div className="absolute inset-0 border-4 border-indigo-500/30 rounded-full"></div>
                <div 
                  className="absolute inset-0 border-4 border-indigo-500 rounded-full border-t-transparent animate-spin"
                  style={{ animationDuration: '1s' }}
                ></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-2xl">🧠</span>
                </div>
              </div>
              
              <h3 className="text-white font-bold text-lg mb-2">Procesando Análisis</h3>
              <p className="text-white/70 text-sm mb-4">{processingState.message}</p>
              
              <div className="w-full bg-white/10 rounded-full h-2 mb-2">
                <div 
                  className="bg-indigo-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${processingState.progress}%` }}
                ></div>
              </div>
              <p className="text-white/50 text-xs">{processingState.progress}% completado</p>
            </div>
          </div>
        </div>
      )}

      {/* Error toast */}
      {processingState.step === 'error' && (
        <div className="fixed top-24 right-4 z-[301] animate-slide-in">
          <div className="bg-red-600 text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <p className="font-bold text-sm">Error en procesamiento</p>
              <p className="text-xs opacity-80">{processingState.message}</p>
            </div>
            <button 
              onClick={() => updateState({ step: 'idle', message: '' })}
              className="ml-2 w-6 h-6 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Indicadores en tiempo real durante grabación */}
      {isRecording && resumenTiempoReal && (
        <div className="fixed bottom-24 left-4 z-[200] space-y-2">
          {/* Badge de tipo */}
          {config && (
            <div className={`px-3 py-1.5 rounded-full bg-gradient-to-r ${config.color} text-white text-sm font-medium flex items-center gap-2 shadow-lg`}>
              <span>{config.icono}</span>
              <span>{config.titulo}</span>
            </div>
          )}

          {/* Métricas en tiempo real */}
          <div className="bg-zinc-900/90 backdrop-blur rounded-xl p-3 border border-white/10 shadow-lg space-y-2 min-w-[200px]">
            <div className="flex items-center justify-between">
              <span className="text-white/60 text-xs">Engagement</span>
              <div className="flex items-center gap-2">
                <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all ${
                      resumenTiempoReal.engagementActual > 0.6 ? 'bg-green-500' :
                      resumenTiempoReal.engagementActual > 0.4 ? 'bg-yellow-500' : 'bg-red-500'
                    }`}
                    style={{ width: `${resumenTiempoReal.engagementActual * 100}%` }}
                  />
                </div>
                <span className="text-white text-xs font-mono">
                  {Math.round(resumenTiempoReal.engagementActual * 100)}%
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-white/60 text-xs">Emoción</span>
              <span className="text-white text-sm">
                {resumenTiempoReal.emocionActual === 'happy' && '😊'}
                {resumenTiempoReal.emocionActual === 'sad' && '😢'}
                {resumenTiempoReal.emocionActual === 'angry' && '😠'}
                {resumenTiempoReal.emocionActual === 'surprised' && '😲'}
                {resumenTiempoReal.emocionActual === 'neutral' && '😐'}
                {resumenTiempoReal.emocionActual === 'fearful' && '😨'}
                {resumenTiempoReal.emocionActual === 'disgusted' && '🤢'}
                {' '}{resumenTiempoReal.emocionActual}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-white/60 text-xs">Postura</span>
              <span className="text-white text-xs capitalize">
                {resumenTiempoReal.posturaActual.replace(/_/g, ' ')}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-white/60 text-xs">Microexpr.</span>
              <span className="text-indigo-400 text-xs font-mono">
                {resumenTiempoReal.microexpresionesCount}
              </span>
            </div>

            {/* Alertas */}
            {resumenTiempoReal.alertas.length > 0 && (
              <div className="pt-2 border-t border-white/10">
                {resumenTiempoReal.alertas.slice(0, 2).map((alerta, i) => (
                  <p key={i} className="text-amber-400 text-xs">{alerta}</p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Botón flotante para iniciar grabación con análisis (Solo si NO es headless) */}
      {processingState.step === 'idle' && !isRecording && !headlessMode && (
        <div className="fixed bottom-6 right-6 z-[200]">
          {stream ? (
            <button
              onClick={() => setShowTypeSelector(true)}
              className="group relative flex items-center gap-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white px-5 py-3 rounded-2xl shadow-2xl transition-all hover:scale-105"
            >
              <span className="w-4 h-4 bg-red-500 rounded-full animate-pulse"></span>
              <span className="font-bold text-sm">Grabar con Análisis</span>
              <span className="text-xl">🧠</span>
              
              {/* Tooltip */}
              <div className="absolute bottom-full mb-2 right-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                <div className="bg-black text-white text-xs px-3 py-2 rounded-lg whitespace-nowrap">
                  Grabación con análisis conductual
                </div>
              </div>
            </button>
          ) : (
            <div className="flex items-center gap-3 bg-zinc-800 text-zinc-400 px-5 py-3 rounded-2xl shadow-lg cursor-not-allowed">
              <span className="w-4 h-4 bg-zinc-600 rounded-full"></span>
              <span className="font-bold text-sm">Esperando cámara...</span>
              <span className="text-xl animate-spin">⏳</span>
            </div>
          )}
        </div>
      )}

      {/* Indicador de grabación activa (esquina) - Solo si NO es headless */}
      {isRecording && !headlessMode && (
        <div className="fixed top-4 left-4 z-[200]">
          <div className="flex items-center gap-3 bg-red-600 px-4 py-2 rounded-full shadow-lg">
            <span className="w-3 h-3 bg-white rounded-full animate-pulse"></span>
            <span className="text-white font-mono font-bold">
              {formatDuration(processingState.duration)}
            </span>
            <button
              onClick={stopRecording}
              className="ml-2 bg-white/20 hover:bg-white/30 px-2 py-1 rounded text-xs font-medium transition-colors"
            >
              Detener
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default RecordingManager;
