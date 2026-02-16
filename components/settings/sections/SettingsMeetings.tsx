import React, { useState, useEffect, useCallback } from 'react';
import { SettingToggle } from '../components/SettingToggle';
import { SettingSection } from '../components/SettingSection';
import { Language, getCurrentLanguage, subscribeToLanguageChange } from '../../../lib/i18n';
import { useStore } from '../../../store/useStore';
import { supabase } from '../../../lib/supabase';
import {
  TipoAnalisis as TipoAnalisisService,
  getTodasMetricasCached,
  guardarMetricasEspacio,
  METRICAS_DEFAULT,
} from '../../../lib/metricasAnalisis';
import {
  CargoLaboral,
  PERMISOS_ANALISIS,
  INFO_CARGOS,
} from '../../meetings/recording/types/analysis';

// ==================== CATÁLOGO DE MÉTRICAS ====================

type TipoAnalisis = 'rrhh_entrevista' | 'rrhh_one_to_one' | 'deals' | 'equipo';

interface MetricaCatalogo {
  id: string;
  label: string;
  descripcion: string;
  ejemplo: string;
  icono: string;
}

const CATALOGO_METRICAS: Record<TipoAnalisis, MetricaCatalogo[]> = {
  rrhh_entrevista: [
    { id: 'congruencia_verbal_no_verbal', label: 'Congruencia verbal/no verbal', descripcion: 'Detecta si lo que dice el candidato coincide con su lenguaje corporal', ejemplo: 'Ej: Dice estar entusiasmado pero su postura es cerrada', icono: '🔍' },
    { id: 'nivel_nerviosismo', label: 'Nivel de nerviosismo', descripcion: 'Mide tensión corporal, microexpresiones de miedo y auto-toques', ejemplo: 'Ej: Timeline de nerviosismo durante preguntas difíciles', icono: '😰' },
    { id: 'confianza_percibida', label: 'Confianza percibida', descripcion: 'Evalúa postura abierta, contacto visual y fluidez gestual', ejemplo: 'Ej: Score 0.8 = candidato seguro y articulado', icono: '💪' },
    { id: 'engagement_por_pregunta', label: 'Engagement por pregunta', descripcion: 'Nivel de interés y atención del candidato en cada momento', ejemplo: 'Ej: Alto engagement al hablar de proyectos, bajo en salario', icono: '📊' },
    { id: 'momentos_incomodidad', label: 'Momentos de incomodidad', descripcion: 'Detecta microexpresiones de disgusto o miedo ante temas específicos', ejemplo: 'Ej: Incomodidad al preguntar por motivo de salida anterior', icono: '⚠️' },
    { id: 'prediccion_fit_cultural', label: 'Predicción fit cultural', descripcion: 'Estima compatibilidad cultural basada en engagement y congruencia', ejemplo: 'Ej: 75% fit cultural basado en reacciones a valores de empresa', icono: '🎯' },
    { id: 'autenticidad_respuestas', label: 'Autenticidad de respuestas', descripcion: 'Detecta incongruencias que sugieren respuestas ensayadas', ejemplo: 'Ej: Microexpresiones contradictorias al describir logros', icono: '🎭' },
    { id: 'nivel_motivacion', label: 'Nivel de motivación', descripcion: 'Mide entusiasmo genuino por el puesto y la empresa', ejemplo: 'Ej: Picos de engagement al hablar de responsabilidades del rol', icono: '🔥' },
  ],
  rrhh_one_to_one: [
    { id: 'congruencia_verbal_no_verbal', label: 'Congruencia verbal/no verbal', descripcion: 'Detecta si el colaborador expresa lo que realmente siente', ejemplo: 'Ej: Dice estar bien pero muestra señales de estrés', icono: '🔍' },
    { id: 'nivel_comodidad', label: 'Nivel de comodidad', descripcion: 'Mide qué tan cómodo se siente el colaborador durante la conversación', ejemplo: 'Ej: Comodidad alta al inicio, baja al hablar de carga laboral', icono: '🛋️' },
    { id: 'engagement_por_tema', label: 'Engagement por tema', descripcion: 'Nivel de interés según el tema que se está tratando', ejemplo: 'Ej: Alto engagement en desarrollo profesional, bajo en procesos', icono: '📊' },
    { id: 'momentos_preocupacion', label: 'Momentos de preocupación', descripcion: 'Detecta señales de ansiedad o preocupación del colaborador', ejemplo: 'Ej: Preocupación al mencionar cambios organizacionales', icono: '😟' },
    { id: 'señales_satisfaccion', label: 'Señales de satisfacción', descripcion: 'Identifica momentos de satisfacción genuina', ejemplo: 'Ej: Sonrisa genuina al hablar del equipo de trabajo', icono: '😊' },
    { id: 'apertura_comunicacion', label: 'Apertura de comunicación', descripcion: 'Evalúa qué tan abierto está el colaborador a compartir', ejemplo: 'Ej: Postura abierta y gestos activos = alta apertura', icono: '💬' },
    { id: 'riesgo_burnout', label: 'Riesgo de burnout', descripcion: 'Detecta señales de agotamiento emocional y desconexión', ejemplo: 'Ej: Bajo engagement sostenido + postura cerrada = alerta', icono: '🔋' },
    { id: 'nivel_confianza_lider', label: 'Confianza en el líder', descripcion: 'Mide la confianza del colaborador hacia su manager', ejemplo: 'Ej: Contacto visual sostenido y postura relajada = alta confianza', icono: '🤝' },
  ],
  deals: [
    { id: 'momentos_interes', label: 'Momentos de interés', descripcion: 'Detecta picos de atención del cliente ante propuestas', ejemplo: 'Ej: Alto interés al presentar ROI y casos de éxito', icono: '👀' },
    { id: 'señales_objecion', label: 'Señales de objeción', descripcion: 'Identifica reacciones negativas ante precio, timing o features', ejemplo: 'Ej: Microexpresión de disgusto al mencionar el precio', icono: '🚫' },
    { id: 'engagement_por_tema', label: 'Engagement por tema', descripcion: 'Nivel de interés del cliente según lo que se presenta', ejemplo: 'Ej: Alto en demo del producto, bajo en términos legales', icono: '📊' },
    { id: 'señales_cierre', label: 'Señales de cierre', descripcion: 'Detecta inclinación hacia adelante y señales de decisión', ejemplo: 'Ej: Cliente se inclina y asiente = señal positiva de cierre', icono: '✅' },
    { id: 'prediccion_probabilidad_cierre', label: 'Probabilidad de cierre', descripcion: 'Estima la probabilidad de cerrar el deal basado en señales', ejemplo: 'Ej: 72% probabilidad basado en engagement + señales positivas', icono: '🎯' },
    { id: 'puntos_dolor_detectados', label: 'Puntos de dolor detectados', descripcion: 'Identifica problemas del cliente por reacciones emocionales', ejemplo: 'Ej: Reacción emocional fuerte al mencionar su proceso actual', icono: '💢' },
    { id: 'nivel_urgencia', label: 'Nivel de urgencia', descripcion: 'Detecta qué tan urgente es la necesidad del cliente', ejemplo: 'Ej: Engagement alto + preguntas de implementación = urgente', icono: '⏰' },
    { id: 'competencia_mencionada', label: 'Reacción a competencia', descripcion: 'Analiza reacciones cuando se menciona la competencia', ejemplo: 'Ej: Incomodidad al comparar con competidor X = ya lo evaluó', icono: '⚔️' },
  ],
  equipo: [
    { id: 'participacion_por_persona', label: 'Participación por persona', descripcion: 'Mide tiempo de habla e intervenciones de cada miembro', ejemplo: 'Ej: Ana 35%, Carlos 25%, Luis 20%, otros 20%', icono: '👥' },
    { id: 'engagement_grupal', label: 'Engagement grupal', descripcion: 'Nivel de atención y participación del grupo en conjunto', ejemplo: 'Ej: Timeline mostrando picos y valles de atención grupal', icono: '📈' },
    { id: 'reacciones_a_ideas', label: 'Reacciones a ideas', descripcion: 'Cómo reacciona el grupo ante propuestas de cada miembro', ejemplo: 'Ej: Idea de Ana recibió 80% reacciones positivas', icono: '💡' },
    { id: 'momentos_desconexion', label: 'Momentos de desconexión', descripcion: 'Detecta cuándo el grupo pierde interés o se distrae', ejemplo: 'Ej: Desconexión grupal a los 45min = reunión muy larga', icono: '😴' },
    { id: 'dinamica_grupal', label: 'Dinámica grupal', descripcion: 'Evalúa cohesión, líderes naturales y participantes pasivos', ejemplo: 'Ej: Cohesión 0.7, líder natural: Ana, pasivo: Luis', icono: '🔄' },
    { id: 'prediccion_adopcion_ideas', label: 'Predicción adopción de ideas', descripcion: 'Estima si las decisiones tomadas serán adoptadas por el equipo', ejemplo: 'Ej: 85% probabilidad de adopción basado en engagement grupal', icono: '🎯' },
    { id: 'equilibrio_participacion', label: 'Equilibrio de participación', descripcion: 'Detecta si la reunión está dominada por pocas personas', ejemplo: 'Ej: Alerta si 1 persona habla >50% del tiempo', icono: '⚖️' },
    { id: 'energia_reunion', label: 'Energía de la reunión', descripcion: 'Mide el nivel de energía general a lo largo del tiempo', ejemplo: 'Ej: Energía alta al inicio, decae después de 30min', icono: '⚡' },
  ],
};

const TIPO_ANALISIS_CONFIG: Record<TipoAnalisis, { label: string; icono: string; color: string; descripcion: string }> = {
  rrhh_entrevista: { label: 'Entrevista Candidatos', icono: '🎯', color: 'from-blue-600 to-indigo-600', descripcion: 'Métricas para evaluar candidatos en entrevistas de selección' },
  rrhh_one_to_one: { label: 'One-to-One', icono: '💬', color: 'from-cyan-600 to-blue-600', descripcion: 'Métricas para reuniones individuales con colaboradores' },
  deals: { label: 'Reunión Comercial', icono: '🤝', color: 'from-green-600 to-emerald-600', descripcion: 'Métricas para negociaciones y cierre de deals' },
  equipo: { label: 'Reunión de Equipo', icono: '👥', color: 'from-purple-600 to-violet-600', descripcion: 'Métricas para reuniones de trabajo y brainstorming' },
};

// ==================== COMPONENTE ====================

interface MeetingsSettings {
  autoMuteOnJoin: boolean;
  autoCameraOffOnJoin: boolean;
  enableRecordingForMembers?: boolean;
  showTranscription?: boolean;
  aiSummaryEnabled?: boolean;
  maxParticipants?: number;
  waitingRoomEnabled?: boolean;
  allowScreenShare?: boolean;
  analisisMetricas?: {
    rrhh_entrevista: string[];
    rrhh_one_to_one: string[];
    deals: string[];
    equipo: string[];
  };
}

interface SettingsMeetingsProps {
  settings: MeetingsSettings;
  onSettingsChange: (settings: MeetingsSettings) => void;
  isAdmin: boolean;
  workspaceId?: string;
}

export const SettingsMeetings: React.FC<SettingsMeetingsProps> = ({
  settings,
  onSettingsChange,
  isAdmin,
  workspaceId,
}) => {
  const { currentUser, session } = useStore();
  const [currentLang, setCurrentLang] = useState<Language>(getCurrentLanguage());
  const [expandedTipo, setExpandedTipo] = useState<TipoAnalisis | null>(null);
  const [metricasEspacio, setMetricasEspacio] = useState<Record<TipoAnalisis, string[]> | null>(null);
  const [saving, setSaving] = useState<TipoAnalisis | null>(null);
  const [cargoUsuario, setCargoUsuario] = useState<CargoLaboral>('colaborador');

  useEffect(() => {
    const unsubscribe = subscribeToLanguageChange(() => {
      setCurrentLang(getCurrentLanguage());
    });
    return unsubscribe;
  }, []);

  // Cargar cargo del usuario desde miembros_espacio
  useEffect(() => {
    const cargarCargo = async () => {
      const userId = currentUser?.id || session?.user?.id;
      if (!userId || !workspaceId) return;

      const { data } = await supabase
        .from('miembros_espacio')
        .select('cargo_id, cargo_ref:cargos!cargo_id(clave)')
        .eq('usuario_id', userId)
        .eq('espacio_id', workspaceId)
        .single();

      const clave = (data?.cargo_ref as any)?.clave;
      if (clave) {
        setCargoUsuario(clave as CargoLaboral);
      }
    };
    cargarCargo();
  }, [currentUser?.id, session?.user?.id, workspaceId]);

  // Permisos por cargo: qué tipos puede editar este usuario
  const permisos = PERMISOS_ANALISIS[cargoUsuario] || PERMISOS_ANALISIS.colaborador;
  const puedeEditarAlgunTipo = permisos.rrhh_entrevista || permisos.rrhh_one_to_one || permisos.deals || permisos.equipo;
  const tiposEditables: TipoAnalisis[] = (
    ['rrhh_entrevista', 'rrhh_one_to_one', 'deals', 'equipo'] as TipoAnalisis[]
  ).filter(tipo => permisos[tipo]);

  // Cargar métricas del espacio desde cache de Supabase
  useEffect(() => {
    if (workspaceId) {
      const cached = getTodasMetricasCached(workspaceId);
      setMetricasEspacio(cached);
    }
  }, [workspaceId]);

  const updateSetting = <K extends keyof MeetingsSettings>(key: K, value: MeetingsSettings[K]) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  // Obtener métricas activas para un tipo (desde Supabase cache)
  const getMetricasActivas = (tipo: TipoAnalisis): string[] => {
    return metricasEspacio?.[tipo] || METRICAS_DEFAULT[tipo as TipoAnalisisService];
  };

  // Toggle una métrica para un tipo — guarda en Supabase
  const toggleMetrica = useCallback(async (tipo: TipoAnalisis, metricaId: string) => {
    const actuales = getMetricasActivas(tipo);
    const nuevas = actuales.includes(metricaId)
      ? actuales.filter(m => m !== metricaId)
      : [...actuales, metricaId];

    // Actualizar UI inmediatamente (optimistic)
    setMetricasEspacio(prev => ({
      ...(prev || METRICAS_DEFAULT),
      [tipo]: nuevas,
    }));

    // Guardar en Supabase
    if (workspaceId && currentUser?.id) {
      setSaving(tipo);
      await guardarMetricasEspacio(workspaceId, tipo as TipoAnalisisService, nuevas, currentUser.id);
      setSaving(null);
    }
  }, [metricasEspacio, workspaceId, currentUser?.id]);

  return (
    <div>
      <div className="mb-8 lg:mb-6">
        <h2 className="text-2xl lg:text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-violet-200 to-white mb-2 lg:mb-1">
          {currentLang === 'en' ? 'Meetings' : currentLang === 'pt' ? 'Reuniões' : 'Reuniones'}
        </h2>
        <p className="text-sm lg:text-xs text-zinc-400">
          {currentLang === 'en' ? 'Configure your meeting preferences and analysis metrics' : currentLang === 'pt' ? 'Configure suas preferências de reunião e métricas de análise' : 'Configura tus preferencias de reuniones y métricas de análisis'}
        </p>
      </div>

      <SettingSection title={currentLang === 'en' ? 'When joining a meeting' : currentLang === 'pt' ? 'Ao entrar em uma reunião' : 'Al unirse a reunión'}>
        <SettingToggle
          label={currentLang === 'en' ? 'Mic muted on entry' : currentLang === 'pt' ? 'Microfone silenciado ao entrar' : 'Micrófono apagado al entrar'}
          description={currentLang === 'en' ? 'Your microphone will be muted when you join a meeting or someone approaches you' : currentLang === 'pt' ? 'Seu microfone estará silenciado quando entrar em uma reunião ou alguém se aproximar' : 'Tu micrófono estará silenciado cuando te unas a una reunión o alguien se acerque'}
          checked={settings.autoMuteOnJoin}
          onChange={(v) => updateSetting('autoMuteOnJoin', v)}
        />
        <SettingToggle
          label={currentLang === 'en' ? 'Camera off on entry' : currentLang === 'pt' ? 'Câmera desligada ao entrar' : 'Cámara apagada al entrar'}
          description={currentLang === 'en' ? 'Your camera will be disabled when you join a meeting or someone approaches you' : currentLang === 'pt' ? 'Sua câmera estará desativada quando entrar em uma reunião ou alguém se aproximar' : 'Tu cámara estará desactivada cuando te unas a una reunión o alguien se acerque'}
          checked={settings.autoCameraOffOnJoin}
          onChange={(v) => updateSetting('autoCameraOffOnJoin', v)}
        />
      </SettingSection>

      {/* Funciones automáticas */}
      <div className="mt-6 p-4 rounded-xl bg-violet-500/5 border border-violet-500/10">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0 mt-0.5">
            <svg className="w-4 h-4 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-xs font-semibold text-violet-300 mb-1">
              {currentLang === 'en' ? 'Automatic features' : currentLang === 'pt' ? 'Recursos automáticos' : 'Funciones automáticas'}
            </p>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              {currentLang === 'en' 
                ? 'Recording, transcription, AI summary, and behavioral analysis activate automatically. Screen sharing and limits are managed by the host.'
                : currentLang === 'pt'
                ? 'Gravação, transcrição, resumo IA e análise comportamental ativam automaticamente. Compartilhamento e limites são gerenciados pelo anfitrião.'
                : 'La grabación, transcripción, resumen IA y análisis conductual se activan automáticamente. Compartir pantalla y límites son gestionados por el anfitrión.'}
            </p>
          </div>
        </div>
      </div>

      {/* Métricas de análisis customizables — visible para cargos con permisos de análisis */}
      {puedeEditarAlgunTipo && (
        <div className="mt-8">
          <h3 className="text-lg font-bold text-white mb-1">
            {currentLang === 'en' ? 'Behavioral Analysis Metrics' : currentLang === 'pt' ? 'Métricas de Análise Comportamental' : 'Métricas de Análisis Conductual'}
          </h3>
          <p className="text-xs text-zinc-400 mb-4">
            {currentLang === 'en' 
              ? 'Customize which metrics are analyzed for each meeting type. These will be evaluated during recording.'
              : currentLang === 'pt'
              ? 'Personalize quais métricas são analisadas para cada tipo de reunião. Serão avaliadas durante a gravação.'
              : 'Personaliza qué métricas se analizan para cada tipo de reunión. Se evaluarán durante la grabación.'}
          </p>

          {/* Badge del cargo actual */}
          <div className="mb-4 flex items-center gap-2">
            <span className="text-sm">{INFO_CARGOS[cargoUsuario]?.icono || '👤'}</span>
            <span className="text-xs text-zinc-400">
              {currentLang === 'en' ? 'Your role' : currentLang === 'pt' ? 'Seu cargo' : 'Tu cargo'}:{' '}
              <span className="text-white font-medium">{INFO_CARGOS[cargoUsuario]?.nombre || cargoUsuario}</span>
            </span>
            {tiposEditables.length < 4 && (
              <span className="text-[10px] text-zinc-500 ml-auto">
                {tiposEditables.length} {currentLang === 'en' ? 'types available' : currentLang === 'pt' ? 'tipos disponíveis' : 'tipos disponibles'}
              </span>
            )}
          </div>

          <div className="space-y-3">
            {tiposEditables.map(tipo => {
              const config = TIPO_ANALISIS_CONFIG[tipo];
              const metricas = CATALOGO_METRICAS[tipo];
              const activas = getMetricasActivas(tipo);
              const isExpanded = expandedTipo === tipo;

              return (
                <div key={tipo} className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
                  {/* Header del tipo */}
                  <button
                    onClick={() => setExpandedTipo(isExpanded ? null : tipo)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.03] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${config.color} flex items-center justify-center text-sm`}>
                        {config.icono}
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-semibold text-white">{config.label}</p>
                        <p className="text-[10px] text-zinc-500">
                          {activas.length} de {metricas.length} métricas activas
                          {saving === tipo && <span className="ml-1 text-violet-400 animate-pulse">guardando...</span>}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex -space-x-1">
                        {activas.slice(0, 4).map(id => {
                          const m = metricas.find(x => x.id === id);
                          return m ? (
                            <span key={id} className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[8px]" title={m.label}>
                              {m.icono}
                            </span>
                          ) : null;
                        })}
                        {activas.length > 4 && (
                          <span className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[8px] text-white/50">
                            +{activas.length - 4}
                          </span>
                        )}
                      </div>
                      <svg className={`w-4 h-4 text-white/30 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  {/* Lista de métricas expandida */}
                  {isExpanded && (
                    <div className="border-t border-white/[0.05] px-4 py-3 space-y-1">
                      <p className="text-[10px] text-zinc-500 mb-2">{config.descripcion}</p>
                      {metricas.map(metrica => {
                        const isActive = activas.includes(metrica.id);
                        return (
                          <button
                            key={metrica.id}
                            onClick={() => toggleMetrica(tipo, metrica.id)}
                            className={`w-full flex items-start gap-3 p-2.5 rounded-lg transition-all text-left ${
                              isActive 
                                ? 'bg-violet-500/10 border border-violet-500/20' 
                                : 'bg-white/[0.02] border border-transparent hover:bg-white/[0.04]'
                            }`}
                          >
                            {/* Toggle visual */}
                            <div className={`mt-0.5 w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors ${
                              isActive ? 'bg-violet-600' : 'bg-white/10'
                            }`}>
                              {isActive && (
                                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs">{metrica.icono}</span>
                                <span className={`text-xs font-medium ${isActive ? 'text-white' : 'text-white/60'}`}>
                                  {metrica.label}
                                </span>
                              </div>
                              <p className="text-[10px] text-zinc-500 mt-0.5 leading-relaxed">{metrica.descripcion}</p>
                              <p className="text-[9px] text-violet-400/60 mt-0.5 italic">{metrica.ejemplo}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsMeetings;
