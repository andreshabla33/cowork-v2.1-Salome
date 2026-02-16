import React, { useState, useEffect, useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { supabase, APP_URL } from '../../lib/supabase';
import { ScheduledMeeting } from '../../types';
import { googleCalendar, GoogleCalendarEvent } from '../../lib/googleCalendar';
import { getSettingsSection } from '../../lib/userSettings';
import { MeetingRoom, InviteLinkGenerator } from './videocall';
import { CargoLaboral } from './recording/types/analysis';
import { 
  TipoReunionUnificado, 
  TIPOS_REUNION_CONFIG,
  getTiposReunionPorCargo,
  InvitadoExterno,
  validarInvitadoExterno,
  crearConfiguracionSala,
  MAPEO_TIPO_GRABACION
} from '../../types/meeting-types';

interface CalendarPanelProps {
  onJoinMeeting?: (salaId: string) => void;
}

interface ActiveMeeting {
  salaId: string;
  titulo: string;
}

export const CalendarPanel: React.FC<CalendarPanelProps> = ({ onJoinMeeting }) => {
  const { currentUser, activeWorkspace, theme } = useStore();
  const [meetings, setMeetings] = useState<ScheduledMeeting[]>([]);
  const [googleEvents, setGoogleEvents] = useState<GoogleCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'scheduled' | 'notes'>('scheduled');
  const [searchQuery, setSearchQuery] = useState('');
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [miembrosEspacio, setMiembrosEspacio] = useState<any[]>([]);
  const [googleConnected, setGoogleConnected] = useState(googleCalendar.isConnected());
  const [syncingGoogle, setSyncingGoogle] = useState(false);
  
  // Estados para videollamadas
  const [activeMeeting, setActiveMeeting] = useState<ActiveMeeting | null>(null);
  const [showInviteModal, setShowInviteModal] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [selectedMeeting, setSelectedMeeting] = useState<ScheduledMeeting | null>(null);
  const creatingMeetingRef = React.useRef(false);

  // Función para copiar link de reunión
  const copyMeetingLink = async (meetingLink: string, meetingId: string) => {
    try {
      await navigator.clipboard.writeText(meetingLink);
      setCopiedLink(meetingId);
      setTimeout(() => setCopiedLink(null), 2000);
    } catch (err) {
      console.error('Error copiando link:', err);
      alert('No se pudo copiar el link. Intenta de nuevo.');
    }
  };

  const [newMeeting, setNewMeeting] = useState({
    titulo: '',
    descripcion: '',
    fecha: '',
    hora_inicio: '',
    hora_fin: '',
    participantes: [] as string[],
    recordatorio_minutos: 15,
    tipo_reunion: 'equipo' as TipoReunionUnificado
  });

  // Estado para invitados externos (cliente/candidato)
  const [invitadosExternos, setInvitadosExternos] = useState<InvitadoExterno[]>([]);
  const [nuevoInvitado, setNuevoInvitado] = useState<Partial<InvitadoExterno>>({
    email: '',
    nombre: '',
    empresa: '',
    puesto_aplicado: ''
  });
  const [erroresInvitado, setErroresInvitado] = useState<string[]>([]);

  // Obtener cargo del usuario actual (desde miembros_espacio o default)
  const [cargoUsuario, setCargoUsuario] = useState<CargoLaboral>('colaborador');

  // RBAC: Obtener tipos de reunión disponibles según cargo
  const tiposReunionDisponibles = useMemo(() => 
    getTiposReunionPorCargo(cargoUsuario),
    [cargoUsuario]
  );

  // Configuración del tipo seleccionado
  const configTipoActual = useMemo(() => 
    TIPOS_REUNION_CONFIG[newMeeting.tipo_reunion],
    [newMeeting.tipo_reunion]
  );

  const loadMeetings = async () => {
    if (!activeWorkspace?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);

    const { data, error } = await supabase
      .from('reuniones_programadas')
      .select('*')
      .eq('espacio_id', activeWorkspace.id)
      .order('fecha_inicio', { ascending: true });

    console.log('Reuniones cargadas:', data, 'Error:', error);
    
    if (!error && data) {
      setMeetings(data as any);
    } else if (error) {
      console.error('Error cargando reuniones:', error);
    }
    setLoading(false);
  };

  const loadMiembros = async () => {
    if (!activeWorkspace?.id || !currentUser?.id) return;
    
    const { data } = await supabase
      .from('miembros_espacio')
      .select('usuario_id, rol')
      .eq('espacio_id', activeWorkspace.id)
      .eq('aceptado', true);

    if (data) {
      const ids = data.map((m: any) => m.usuario_id);
      const { data: usuarios } = await supabase
        .from('usuarios')
        .select('id, nombre')
        .in('id', ids);
      
      if (usuarios) setMiembrosEspacio(usuarios);

      const { data: miembroData } = await supabase
        .from('miembros_espacio')
        .select('cargo_id, cargo_ref:cargos!cargo_id(clave)')
        .eq('usuario_id', currentUser.id)
        .eq('espacio_id', activeWorkspace.id)
        .single();
      
      const clave = (miembroData?.cargo_ref as any)?.clave;
      if (clave) {
        console.log('📋 Cargo del usuario (CalendarPanel):', clave);
        setCargoUsuario(clave as CargoLaboral);
      }
    }
  };

  useEffect(() => {
    loadMeetings();
    loadMiembros();

    if (!activeWorkspace?.id) return;
    
    const channel = supabase.channel(`calendar_${activeWorkspace.id}`)
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'reuniones_programadas',
        filter: `espacio_id=eq.${activeWorkspace.id}`
      }, () => loadMeetings())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspace?.id, currentUser?.id]);

  const createMeeting = async () => {
    console.log('🔵 createMeeting llamado', { newMeeting, activeWorkspace: activeWorkspace?.id, currentUser: currentUser?.id });
    
    if (!newMeeting.titulo.trim() || !newMeeting.fecha || !newMeeting.hora_inicio || !activeWorkspace?.id) {
      console.log('❌ Validación falló:', { titulo: newMeeting.titulo, fecha: newMeeting.fecha, hora_inicio: newMeeting.hora_inicio, workspace: activeWorkspace?.id });
      return;
    }

    // Guard anti double-click
    if (creatingMeetingRef.current) {
      console.log('⚠️ Creación en progreso, ignorando doble clic');
      return;
    }
    creatingMeetingRef.current = true;
    
    console.log('✅ Validación OK, creando reunión...');

    try {

    const fechaInicio = new Date(`${newMeeting.fecha}T${newMeeting.hora_inicio}`);
    const fechaFin = newMeeting.hora_fin 
      ? new Date(`${newMeeting.fecha}T${newMeeting.hora_fin}`)
      : new Date(fechaInicio.getTime() + 60 * 60 * 1000);

    console.log('📅 Fechas:', { fechaInicio: fechaInicio.toISOString(), fechaFin: fechaFin.toISOString() });

    // Generar link de meeting único (se actualizará con Google Meet si está conectado)
    const meetingCode = Math.random().toString(36).substring(2, 10);
    let meetingLink = `${APP_URL}/meet/${meetingCode}`;
    let googleEventId: string | null = null;

    // Obtener emails de participantes para invitaciones
    let participantesEmails: string[] = [];
    if (newMeeting.participantes.length > 0) {
      console.log('👥 Obteniendo emails de', newMeeting.participantes.length, 'participantes...');
      const { data: usuariosData, error: emailError } = await supabase
        .from('usuarios')
        .select('id, email')
        .in('id', newMeeting.participantes);
      
      if (emailError) console.error('❌ Error obteniendo emails:', emailError);
      if (usuariosData) {
        participantesEmails = usuariosData
          .map(u => u.email)
          .filter((email): email is string => !!email);
      }
    }

    console.log('📧 Emails participantes:', participantesEmails.length);

    // Crear evento en Google Calendar si está conectado Y el setting lo permite
    const calSettings = getSettingsSection('calendar');
    const shouldCreateGoogle = calSettings.autoCreateGoogleEvent !== false;
    console.log('📆 Google Calendar:', { googleConnected, shouldCreateGoogle });
    if (googleConnected && shouldCreateGoogle) {
      try {
        const googleEvent = await googleCalendar.createEvent({
          summary: newMeeting.titulo.trim(),
          description: newMeeting.descripcion.trim() || 'Reunión creada en Cowork Virtual',
          start: fechaInicio.toISOString(),
          end: fechaFin.toISOString(),
          attendees: participantesEmails,
          sendUpdates: 'all',
          meetingLink: meetingLink
        });
        
        if (googleEvent) {
          googleEventId = googleEvent.id;
        }
      } catch (err) {
        console.error('Error creando evento en Google Calendar:', err);
      }
    }

    // Mapear tipo de reunión unificado a tipo de sala en BD
    const tipoSalaMap: Record<TipoReunionUnificado, 'general' | 'deal' | 'entrevista'> = {
      'equipo': 'general',
      'one_to_one': 'general',
      'cliente': 'deal',
      'candidato': 'entrevista'
    };
    const tipoSala = tipoSalaMap[newMeeting.tipo_reunion] || 'general';

    // Mapear tipo unificado a tipo de BD (constraint: equipo, deal, entrevista)
    const tipoReunionBDMap: Record<TipoReunionUnificado, 'equipo' | 'deal' | 'entrevista'> = {
      'equipo': 'equipo',
      'one_to_one': 'equipo',
      'cliente': 'deal',
      'candidato': 'entrevista'
    };
    const tipoReunionBD = tipoReunionBDMap[newMeeting.tipo_reunion] || 'equipo';

    // Crear configuración de sala con invitados externos
    const configuracionSala = crearConfiguracionSala(
      newMeeting.tipo_reunion,
      invitadosExternos.length > 0 ? invitadosExternos : undefined,
      undefined
    );

    console.log('🏗️ Config sala creada, tipo:', tipoSala);

    // Crear reunión en Supabase
    console.log('📝 Insertando en reuniones_programadas...', { 
      tipo_reunion_ui: newMeeting.tipo_reunion, 
      tipo_reunion_bd: tipoReunionBD,
      invitados: invitadosExternos.length 
    });
    const { data: meeting, error } = await supabase
      .from('reuniones_programadas')
      .insert({
        espacio_id: activeWorkspace.id,
        titulo: newMeeting.titulo.trim(),
        descripcion: newMeeting.descripcion.trim() || null,
        fecha_inicio: fechaInicio.toISOString(),
        fecha_fin: fechaFin.toISOString(),
        creado_por: currentUser.id,
        recordatorio_minutos: newMeeting.recordatorio_minutos,
        meeting_link: meetingLink,
        google_event_id: googleEventId,
        tipo_reunion: tipoReunionBD
      })
      .select()
      .single();

    console.log('📝 Resultado reunión:', { meeting, error });

    if (error) {
      console.error('❌ Error creando reunión:', error);
      alert('Error al crear reunión: ' + error.message);
      return;
    }

    if (meeting) {
      // Crear sala de videollamada asociada con configuración unificada
      console.log('🎥 Creando sala de videollamada...', { tipo: tipoSala, invitados: invitadosExternos.length });
      const { data: sala, error: salaError } = await supabase
        .from('salas_reunion')
        .insert({
          nombre: newMeeting.titulo.trim(),
          espacio_id: activeWorkspace.id,
          creador_id: currentUser.id,
          tipo: tipoSala,
          configuracion: {
            ...configuracionSala,
            reunion_id: meeting.id
          }
        })
        .select()
        .single();

      console.log('🎥 Resultado sala:', { sala, salaError });

      // Actualizar reunión con sala_id y link correcto de videollamada
      if (sala) {
        const videoCallLink = `${APP_URL}/sala/${sala.id}`;
        await supabase
          .from('reuniones_programadas')
          .update({ 
            sala_id: sala.id,
            meeting_link: videoCallLink 
          })
          .eq('id', meeting.id);
        meetingLink = videoCallLink; // Actualizar para emails
        console.log('✅ Reunión actualizada con sala_id y link:', videoCallLink);
      }

      // Insertar participantes
      if (newMeeting.participantes.length > 0) {
        const participantesData = newMeeting.participantes.map(uid => ({
          reunion_id: meeting.id,
          usuario_id: uid,
          estado: 'pendiente'
        }));
        await supabase.from('reunion_participantes').insert(participantesData);

        // Enviar notificación por email a participantes internos
        try {
          const { data: participantesInfo } = await supabase
            .from('usuarios')
            .select('email, nombre')
            .in('id', newMeeting.participantes);

          if (participantesInfo && participantesInfo.length > 0) {
            console.log('📧 Enviando notificación a participantes internos...', participantesInfo);
            const { data: emailResult, error: emailError } = await supabase.functions.invoke('enviar-invitacion-reunion', {
              body: {
                destinatarios: participantesInfo.map(p => ({
                  email: p.email,
                  nombre: p.nombre || p.email
                })),
                reunion: {
                  titulo: newMeeting.titulo.trim(),
                  descripcion: newMeeting.descripcion.trim(),
                  fecha_inicio: fechaInicio.toISOString(),
                  fecha_fin: fechaFin.toISOString(),
                  meeting_link: meetingLink,
                  organizador_nombre: currentUser.name || 'Organizador',
                  tipo_reunion: newMeeting.tipo_reunion
                }
              }
            });
            if (emailError) console.error('❌ Error notificando participantes:', emailError);
            else console.log('✅ Participantes notificados:', emailResult);

            // Marcar como notificados
            await supabase
              .from('reunion_participantes')
              .update({ notificado: true })
              .eq('reunion_id', meeting.id)
              .in('usuario_id', newMeeting.participantes);
          }
        } catch (notifErr) {
          console.error('❌ Error en notificación a participantes:', notifErr);
        }
      }

      // Incluir invitado del formulario si tiene datos válidos pero no fue agregado
      let todosLosInvitados = [...invitadosExternos];
      if (nuevoInvitado.email && nuevoInvitado.nombre) {
        const yaExiste = invitadosExternos.some(inv => inv.email === nuevoInvitado.email);
        if (!yaExiste) {
          todosLosInvitados.push(nuevoInvitado as InvitadoExterno);
          console.log('📌 Incluyendo invitado del formulario:', nuevoInvitado.email);
        }
      }

      // Crear invitaciones con tokens únicos para invitados externos (acceso sin login)
      const invitadosConLinks: { email: string; nombre: string; link: string }[] = [];
      if (sala && todosLosInvitados.length > 0) {
        console.log('🔗 Generando tokens para invitados externos...');
        for (const inv of todosLosInvitados) {
          try {
            // Crear participante en la sala
            const { data: participante } = await supabase
              .from('participantes_sala')
              .insert({
                sala_id: sala.id,
                nombre_invitado: inv.nombre,
                email_invitado: inv.email,
                tipo_participante: inv.empresa ? 'cliente' : 'invitado',
                estado_participante: 'invitado',
              })
              .select()
              .single();

            if (participante) {
              // Crear invitación con token único
              const { data: invitacion } = await supabase
                .from('invitaciones_reunion')
                .insert({
                  sala_id: sala.id,
                  participante_id: participante.id,
                  email: inv.email,
                  nombre: inv.nombre,
                  tipo_invitado: inv.empresa ? 'cliente' : 'invitado',
                  creado_por: currentUser.id,
                  expira_en: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                })
                .select()
                .single();

              if (invitacion?.token_unico) {
                const linkPersonalizado = `${window.location.origin}/join/${invitacion.token_unico}`;
                invitadosConLinks.push({ email: inv.email, nombre: inv.nombre, link: linkPersonalizado });
                console.log(`✅ Token generado para ${inv.email}:`, linkPersonalizado);
              }
            }
          } catch (err) {
            console.error(`❌ Error creando invitación para ${inv.email}:`, err);
            // Fallback: usar link de sala (requiere login)
            invitadosConLinks.push({ email: inv.email, nombre: inv.nombre, link: meetingLink });
          }
        }
      }

      // Enviar emails a invitados externos via Resend (si no usó Google Calendar)
      if (!googleConnected && invitadosConLinks.length > 0) {
        try {
          console.log('📧 Enviando invitaciones via Resend...', invitadosConLinks);
          const { data: emailResult, error: emailError } = await supabase.functions.invoke('enviar-invitacion-reunion', {
            body: {
              destinatarios: invitadosConLinks.map(inv => ({
                email: inv.email,
                nombre: inv.nombre,
                link_personalizado: inv.link // Link único por invitado
              })),
              reunion: {
                titulo: newMeeting.titulo.trim(),
                descripcion: newMeeting.descripcion.trim(),
                fecha_inicio: fechaInicio.toISOString(),
                fecha_fin: fechaFin.toISOString(),
                meeting_link: meetingLink, // Fallback
                organizador_nombre: currentUser.name || 'Organizador',
                tipo_reunion: newMeeting.tipo_reunion
              }
            }
          });
          console.log('📬 Respuesta Resend:', emailResult, emailError);
          if (emailError) {
            console.error('❌ Error Edge Function:', emailError);
          } else if (emailResult?.resultados) {
            emailResult.resultados.forEach((r: any) => {
              console.log(`📧 ${r.email}: ${r.success ? '✅' : '❌'}`, r.resend_response);
            });
          }
        } catch (emailErr) {
          console.error('❌ Error enviando emails:', emailErr);
        }
      }

      setShowScheduleModal(false);
      resetNewMeeting();
      loadMeetings();
      syncGoogleEvents();
    }

    } catch (err) {
      console.error('❌ ERROR FATAL en createMeeting:', err);
      alert('Error inesperado al crear reunión. Revisa la consola.');
    } finally {
      creatingMeetingRef.current = false;
    }
  };

  const resetNewMeeting = () => {
    // Establecer el primer tipo disponible según el cargo del usuario
    const primerTipoDisponible = tiposReunionDisponibles[0] || 'equipo';
    setNewMeeting({
      titulo: '',
      descripcion: '',
      fecha: '',
      hora_inicio: '',
      hora_fin: '',
      participantes: [],
      recordatorio_minutos: getSettingsSection('calendar').defaultReminder || 15,
      tipo_reunion: primerTipoDisponible
    });
    // Limpiar invitados externos
    setInvitadosExternos([]);
    setNuevoInvitado({ email: '', nombre: '', empresa: '', puesto_aplicado: '' });
    setErroresInvitado([]);
  };

  const respondToMeeting = async (meetingId: string, estado: 'aceptado' | 'rechazado' | 'tentativo') => {
    await supabase
      .from('reunion_participantes')
      .update({ estado })
      .eq('reunion_id', meetingId)
      .eq('usuario_id', currentUser.id);
    
    loadMeetings();
  };

  const deleteMeeting = async (meetingId: string, googleEventId?: string) => {
    console.log('🗑️ Iniciando eliminación de reunión:', meetingId);
    
    // Eliminar de Google Calendar PRIMERO si está conectado y tiene ID
    if (googleConnected && googleEventId) {
      try {
        await googleCalendar.deleteEvent(googleEventId, 'all');
        console.log('✅ Evento eliminado de Google Calendar:', googleEventId);
      } catch (err) {
        console.error('❌ Error eliminando de Google Calendar:', err);
      }
    }
    
    // Actualización optimista: eliminar de la UI inmediatamente
    setMeetings(prev => prev.filter(m => m.id !== meetingId));
    
    // Eliminar de Supabase
    console.log('📡 Enviando DELETE a Supabase...');
    const { error, count } = await supabase
      .from('reuniones_programadas')
      .delete({ count: 'exact' })
      .eq('id', meetingId);
    
    console.log('📡 Respuesta DELETE:', { error, count });
    
    if (error) {
      console.error('❌ Error eliminando reunión:', error);
      loadMeetings();
      alert('Error al eliminar la reunión: ' + error.message);
    } else if (count === 0) {
      console.warn('⚠️ count=0, la reunión no se eliminó (RLS?)');
      loadMeetings();
    } else {
      console.log('✅ Reunión eliminada correctamente, count:', count);
    }
    
    syncGoogleEvents();
  };

  const connectGoogleCalendar = () => {
    window.location.href = googleCalendar.getAuthUrl();
  };

  const disconnectGoogleCalendar = () => {
    googleCalendar.removeToken();
    setGoogleConnected(false);
    setGoogleEvents([]);
  };

  const syncGoogleEvents = async () => {
    if (!googleCalendar.isConnected()) return;
    
    setSyncingGoogle(true);
    try {
      const events = await googleCalendar.fetchEvents();
      setGoogleEvents(events);
    } catch (error: any) {
      console.error('Error sincronizando Google Calendar:', error);
      if (error.message === 'Token expirado') {
        setGoogleConnected(false);
      }
    }
    setSyncingGoogle(false);
  };

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('access_token')) {
      const token = googleCalendar.parseHashToken(hash);
      if (token) {
        googleCalendar.saveToken(token);
        setGoogleConnected(true);
        window.history.replaceState(null, '', window.location.pathname);
        syncGoogleEvents();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (googleConnected) {
      syncGoogleEvents();
      
      // Auto-sync periódico si syncEnabled está activado
      const calS = getSettingsSection('calendar');
      if (calS.syncEnabled !== false) {
        const interval = setInterval(syncGoogleEvents, 5 * 60 * 1000); // cada 5 min
        return () => clearInterval(interval);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleConnected]);

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) return 'Hoy';
    if (date.toDateString() === tomorrow.toDateString()) return 'Mañana';
    return date.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
  };

  const formatDateShort = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });
  };

  const isCreator = (meeting: ScheduledMeeting) => meeting.creado_por === currentUser.id;
  
  const getMyParticipation = (meeting: ScheduledMeeting) => 
    meeting.participantes?.find(p => p.usuario_id === currentUser.id);

  const isMeetingNow = (meeting: ScheduledMeeting) => {
    const now = new Date();
    const start = new Date(meeting.fecha_inicio);
    const end = new Date(meeting.fecha_fin);
    return now >= start && now <= end;
  };

  const isMeetingSoon = (meeting: ScheduledMeeting) => {
    const now = new Date();
    const start = new Date(meeting.fecha_inicio);
    const diffMinutes = (start.getTime() - now.getTime()) / (1000 * 60);
    return diffMinutes > 0 && diffMinutes <= 15;
  };

  const toggleParticipant = (userId: string) => {
    setNewMeeting(prev => ({
      ...prev,
      participantes: prev.participantes.includes(userId)
        ? prev.participantes.filter(id => id !== userId)
        : [...prev.participantes, userId]
    }));
  };

  const filteredMeetings = meetings.filter(m => 
    m.titulo.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.descripcion?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Filtrar eventos de Google según setting showGoogleEvents
  const calSettingsForFilter = getSettingsSection('calendar');
  const visibleGoogleEvents = (calSettingsForFilter.showGoogleEvents !== false) ? googleEvents : [];

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const days = [];
    
    for (let i = 0; i < firstDay.getDay(); i++) {
      days.push(null);
    }
    
    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push(new Date(year, month, i));
    }
    
    return days;
  };

  const getMeetingsForDate = (date: Date) => {
    return meetings.filter(m => {
      const meetingDate = new Date(m.fecha_inicio);
      return meetingDate.toDateString() === date.toDateString();
    });
  };

  const themeStyles = {
    dark: {
      bg: 'bg-[#1a1a2e]',
      card: 'bg-white/5 border-white/10 hover:bg-white/10',
      cardActive: 'bg-indigo-500/20 border-indigo-500/50',
      btn: 'bg-indigo-600 hover:bg-indigo-500',
      btnGoogle: 'bg-white text-gray-800 hover:bg-gray-100',
      input: 'bg-white/5 border-white/10 focus:border-indigo-500/50'
    },
    arcade: {
      bg: 'bg-black',
      card: 'bg-black border-[#00ff41]/30 hover:border-[#00ff41]/60',
      cardActive: 'bg-[#00ff41]/10 border-[#00ff41]',
      btn: 'bg-[#00ff41] text-black hover:bg-white',
      btnGoogle: 'bg-[#00ff41] text-black hover:bg-white',
      input: 'bg-black border-[#00ff41]/30 focus:border-[#00ff41]'
    }
  };

  const s = themeStyles[theme as keyof typeof themeStyles] || themeStyles.dark;

  return (
    <div className={`${s.bg}`}>
      {/* Header */}
      <div className="p-5 lg:p-4 border-b border-white/10">
        <div className="flex items-center justify-between mb-4 lg:mb-3">
          <h1 className={`text-xl font-bold ${theme === 'arcade' ? 'text-[#00ff41]' : ''}`}>
            Calendario
          </h1>
          <button
            onClick={() => setShowScheduleModal(true)}
            className={`flex items-center gap-2 px-5 py-2.5 ${s.btn} rounded-xl text-sm font-bold transition-all shadow-lg hover:shadow-xl hover:scale-105`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            Nueva reunión
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-3 lg:mb-2">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Buscar eventos..."
            className={`w-full ${s.input} border rounded-xl px-4 py-3 pl-11 text-sm focus:outline-none transition-all`}
          />
          <svg className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[10px] opacity-40 font-mono">
            <span className="px-1.5 py-0.5 bg-white/10 rounded">Ctrl</span>
            <span className="px-1.5 py-0.5 bg-white/10 rounded">F</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex bg-white/5 rounded-xl p-1">
          <button
            onClick={() => setActiveTab('scheduled')}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-bold transition-all ${
              activeTab === 'scheduled' 
                ? (theme === 'arcade' ? 'bg-[#00ff41] text-black' : 'bg-indigo-600 text-white') 
                : 'opacity-50 hover:opacity-100'
            }`}
          >
            Programadas
          </button>
          <button
            onClick={() => setActiveTab('notes')}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-bold transition-all ${
              activeTab === 'notes' 
                ? (theme === 'arcade' ? 'bg-[#00ff41] text-black' : 'bg-indigo-600 text-white') 
                : 'opacity-50 hover:opacity-100'
            }`}
          >
            Notas de reunión
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className={`w-10 h-10 border-3 ${theme === 'arcade' ? 'border-[#00ff41]' : 'border-indigo-500'} border-t-transparent rounded-full animate-spin`} />
          </div>
        ) : activeTab === 'scheduled' ? (
          <>
            {/* Mini Calendar */}
            <div className={`rounded-xl p-4 mb-4 ${theme === 'arcade' ? 'bg-zinc-900/50 border border-[#00ff41]/20' : 'bg-zinc-800/50 border border-zinc-700/50'}`}>
              <div className="flex items-center justify-between mb-3">
                <button
                  onClick={() => setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1))}
                  className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <h4 className={`font-bold text-sm ${theme === 'arcade' ? 'text-[#00ff41]' : 'text-white'}`}>
                  {selectedDate.toLocaleDateString('es', { month: 'long', year: 'numeric' })}
                </h4>
                <button
                  onClick={() => setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1))}
                  className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>

              <div className="grid grid-cols-7 gap-1 text-center">
                {['D', 'L', 'M', 'X', 'J', 'V', 'S'].map(day => (
                  <div key={day} className="text-[10px] font-bold text-zinc-400 py-1">{day}</div>
                ))}
                {getDaysInMonth(selectedDate).map((date, i) => {
                  if (!date) return <div key={i} className="p-1" />;
                  
                  const dayMeetings = getMeetingsForDate(date);
                  const isToday = date.toDateString() === new Date().toDateString();
                  const isPast = date < new Date(new Date().setHours(0,0,0,0));

                  const handleDayClick = () => {
                    if (!isPast) {
                      const dateStr = date.toISOString().split('T')[0];
                      setNewMeeting(prev => ({ ...prev, fecha: dateStr }));
                      setShowScheduleModal(true);
                    }
                  };

                  return (
                    <div
                      key={i}
                      onClick={handleDayClick}
                      className={`p-1.5 rounded-lg text-[11px] font-medium cursor-pointer transition-all ${
                        isPast ? 'text-zinc-600 cursor-not-allowed' :
                        isToday 
                          ? (theme === 'arcade' ? 'bg-[#00ff41] text-black font-bold' : 'bg-indigo-500 text-white font-bold') 
                          : dayMeetings.length > 0 
                            ? 'bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30' 
                            : 'text-zinc-300 hover:bg-white/10'
                      }`}
                      title={isPast ? 'Fecha pasada' : 'Click para crear reunión'}
                    >
                      {date.getDate()}
                      {dayMeetings.length > 0 && (
                        <div className={`w-1.5 h-1.5 rounded-full mx-auto mt-0.5 ${theme === 'arcade' ? 'bg-[#00ff41]' : 'bg-indigo-400'}`} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Meetings List */}
            {filteredMeetings.length === 0 ? (
              <div className="text-center py-6">
                <div className={`w-16 h-16 mx-auto mb-3 rounded-2xl ${theme === 'arcade' ? 'bg-[#00ff41]/10' : 'bg-indigo-500/10'} flex items-center justify-center`}>
                  <svg className={`w-8 h-8 ${theme === 'arcade' ? 'text-[#00ff41]/40' : 'opacity-30'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-xs opacity-60">Administra tu agenda y mejora la experiencia de tus reuniones</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredMeetings.map(meeting => {
                  const participation = getMyParticipation(meeting);
                  const isNow = isMeetingNow(meeting);
                  const isSoon = isMeetingSoon(meeting);

                  return (
                    <div
                      key={meeting.id}
                      className={`relative p-4 rounded-2xl border transition-all cursor-pointer hover:scale-[1.01] ${
                        isNow ? 'bg-green-500/20 border-green-500/50' : 
                        isSoon ? 'bg-amber-500/10 border-amber-500/30' : 
                        s.card
                      }`}
                      onClick={() => setSelectedMeeting(meeting)}
                    >
                      {isNow && (
                        <div className={`absolute -top-2 -right-2 px-2.5 py-1 ${theme === 'arcade' ? 'bg-[#00ff41] text-black' : 'bg-green-500'} rounded-full text-[9px] font-black uppercase animate-pulse`}>
                          EN VIVO
                        </div>
                      )}
                      {isSoon && !isNow && (
                        <div className="absolute -top-2 -right-2 px-2.5 py-1 bg-amber-500 text-black rounded-full text-[9px] font-black uppercase">
                          EN 15 MIN
                        </div>
                      )}

                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-bold truncate">{meeting.titulo}</h4>
                            {isCreator(meeting) && (
                              <span className={`px-2 py-0.5 ${theme === 'arcade' ? 'bg-[#00ff41]/20 text-[#00ff41]' : 'bg-indigo-500/20 text-indigo-300'} rounded text-[9px] font-bold`}>
                                ORGANIZADOR
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-4 text-sm opacity-60 mb-2">
                            <span className="flex items-center gap-1.5">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                              {formatDateShort(meeting.fecha_inicio)}
                            </span>
                            <span className="flex items-center gap-1.5">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              {formatTime(meeting.fecha_inicio)} - {formatTime(meeting.fecha_fin)}
                            </span>
                          </div>

                          {meeting.descripcion && (
                            <p className="text-sm opacity-50 mb-3 line-clamp-2">{meeting.descripcion}</p>
                          )}

                          {meeting.participantes && meeting.participantes.length > 0 && (
                            <div className="flex items-center gap-2">
                              <div className="flex -space-x-2">
                                {meeting.participantes.slice(0, 5).map(p => (
                                  <div
                                    key={p.id}
                                    className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold border-2 ${s.bg} ${
                                      p.estado === 'aceptado' ? 'bg-green-500/30 text-green-300' :
                                      p.estado === 'rechazado' ? 'bg-red-500/30 text-red-300' :
                                      p.estado === 'tentativo' ? 'bg-amber-500/30 text-amber-300' :
                                      'bg-white/10'
                                    }`}
                                    title={`${p.usuario?.nombre} (${p.estado})`}
                                  >
                                    {p.usuario?.nombre?.charAt(0) || '?'}
                                  </div>
                                ))}
                              </div>
                              <span className="text-xs opacity-50">
                                {meeting.participantes.filter(p => p.estado === 'aceptado').length} confirmados
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-col gap-2" onClick={e => e.stopPropagation()}>
                          {/* Botón Iniciar/Unirse Videollamada */}
                          {meeting.sala_id && (
                            <button
                              onClick={() => setActiveMeeting({ salaId: meeting.sala_id!, titulo: meeting.titulo })}
                              className={`px-4 py-2 ${theme === 'arcade' ? 'bg-[#00ff41] text-black' : 'bg-gradient-to-r from-indigo-500 to-purple-600'} hover:opacity-80 rounded-xl text-xs font-bold transition-all flex items-center gap-2 justify-center`}
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                              {isNow ? 'Unirse' : 'Iniciar'}
                            </button>
                          )}

                          {/* Botones de compartir para el creador */}
                          {isCreator(meeting) && meeting.sala_id && (
                            <div className="flex gap-1.5">
                              {/* Copiar link directo (para equipo interno ya logueado) */}
                              {meeting.meeting_link && (
                                <button
                                  onClick={() => copyMeetingLink(meeting.meeting_link, meeting.id)}
                                  className={`flex-1 px-3 py-1.5 ${copiedLink === meeting.id ? 'bg-green-500/30 text-green-300' : 'bg-white/10 hover:bg-white/20'} rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 justify-center`}
                                  title="Copiar link para equipo interno"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    {copiedLink === meeting.id 
                                      ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                                      : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                                    }
                                  </svg>
                                  {copiedLink === meeting.id ? 'Copiado' : 'Link'}
                                </button>
                              )}
                              {/* Invitar externos (genera /join/TOKEN) */}
                              <button
                                onClick={() => setShowInviteModal(meeting.sala_id!)}
                                className="flex-1 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 justify-center"
                                title="Invitar personas externas"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                                </svg>
                                Invitar
                              </button>
                            </div>
                          )}

                          {participation && !isCreator(meeting) && participation.estado === 'pendiente' && (
                            <div className="flex gap-1">
                              <button
                                onClick={() => respondToMeeting(meeting.id, 'aceptado')}
                                className="p-2 bg-green-500/20 hover:bg-green-500/40 text-green-400 rounded-lg transition-all"
                                title="Aceptar"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                                </svg>
                              </button>
                              <button
                                onClick={() => respondToMeeting(meeting.id, 'tentativo')}
                                className="p-2 bg-amber-500/20 hover:bg-amber-500/40 text-amber-400 rounded-lg transition-all"
                                title="Quizás"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => respondToMeeting(meeting.id, 'rechazado')}
                                className="p-2 bg-red-500/20 hover:bg-red-500/40 text-red-400 rounded-lg transition-all"
                                title="Rechazar"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          )}

                          {isCreator(meeting) && (
                            <button
                              onClick={() => deleteMeeting(meeting.id, meeting.google_event_id)}
                              className="p-2 bg-red-500/10 hover:bg-red-500/30 text-red-400 rounded-lg transition-all"
                              title="Cancelar reunión"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          /* Meeting Notes Tab */
          <div className="text-center py-16">
            <div className={`w-24 h-24 mx-auto mb-4 rounded-3xl ${theme === 'arcade' ? 'bg-[#00ff41]/10' : 'bg-indigo-500/10'} flex items-center justify-center`}>
              <svg className={`w-12 h-12 ${theme === 'arcade' ? 'text-[#00ff41]/40' : 'opacity-30'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h4 className="font-bold mb-2">Notas de Reunión</h4>
            <p className="text-sm opacity-50 mb-1">Las notas de reuniones con AI</p>
            <p className="text-sm opacity-50">estarán disponibles próximamente</p>
            <span className={`inline-block mt-4 px-3 py-1 ${theme === 'arcade' ? 'bg-[#00ff41]/20 text-[#00ff41]' : 'bg-indigo-500/20 text-indigo-300'} rounded-full text-xs font-bold`}>
              Fase 2
            </span>
          </div>
        )}
      </div>

      {/* Google Calendar Button */}
      <div className="px-6 pb-6">
        {googleConnected ? (
          <div className="flex items-center justify-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/20 text-green-400 rounded-lg text-xs font-medium">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              Google Calendar conectado
              {syncingGoogle && <span className="opacity-60">(sincronizando...)</span>}
            </div>
            <button
              onClick={disconnectGoogleCalendar}
              className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-xs font-medium transition-all"
            >
              Desconectar
            </button>
          </div>
        ) : (
          <button
            onClick={connectGoogleCalendar}
            className={`flex items-center justify-center gap-2 px-4 py-2 mx-auto ${s.btnGoogle} rounded-xl text-sm font-medium transition-all hover:opacity-90`}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path fill="currentColor" d="M12.545,10.239v3.821h5.445c-0.712,2.315-2.647,3.972-5.445,3.972c-3.332,0-6.033-2.701-6.033-6.032s2.701-6.032,6.033-6.032c1.498,0,2.866,0.549,3.921,1.453l2.814-2.814C17.503,2.988,15.139,2,12.545,2C7.021,2,2.543,6.477,2.543,12s4.478,10,10.002,10c8.396,0,10.249-7.85,9.426-11.748L12.545,10.239z"/>
            </svg>
            Conectar Google Calendar
          </button>
        )}
      </div>

      {/* Modal Nueva Reunión - Compacto 2026 */}
      {showScheduleModal && (
        <div 
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 lg:p-3"
          onClick={() => setShowScheduleModal(false)}
        >
          <div 
            className={`w-full max-w-md lg:max-w-sm rounded-2xl lg:rounded-xl ${s.bg} border border-white/10 shadow-2xl overflow-hidden`}
            onClick={e => e.stopPropagation()}
          >
            <div className={`p-4 lg:p-3 border-b border-white/10 ${theme === 'arcade' ? 'bg-[#00ff41]/5' : 'bg-gradient-to-r from-indigo-500/10 to-purple-500/10'}`}>
              <div className="flex items-center gap-3 lg:gap-2">
                <div className={`w-10 h-10 lg:w-8 lg:h-8 rounded-xl lg:rounded-lg ${theme === 'arcade' ? 'bg-[#00ff41]' : 'bg-gradient-to-br from-indigo-500 to-purple-600'} flex items-center justify-center`}>
                  <svg className={`w-5 h-5 lg:w-4 lg:h-4 ${theme === 'arcade' ? 'text-black' : 'text-white'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg lg:text-base font-bold">Nueva Reunión</h3>
                  <p className="text-xs lg:text-[10px] opacity-50">Programa y envía invitaciones</p>
                </div>
              </div>
            </div>

            <div className="p-4 lg:p-3 space-y-3 lg:space-y-2 max-h-[55vh] lg:max-h-[50vh] overflow-y-auto">
              <div>
                <label className="block text-[9px] font-bold uppercase tracking-wider opacity-60 mb-1.5 lg:mb-1">Título *</label>
                <input
                  type="text"
                  value={newMeeting.titulo}
                  onChange={e => setNewMeeting({ ...newMeeting, titulo: e.target.value })}
                  placeholder="Ej: Daily Standup..."
                  className={`w-full ${s.input} border rounded-lg px-3 py-2 lg:py-1.5 text-sm lg:text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all`}
                />
              </div>

              {/* Selector de Tipo de Reunión - RBAC por cargo */}
              <div>
                <label className="block text-[9px] font-bold uppercase tracking-wider opacity-60 mb-1.5 lg:mb-1">
                  Tipo de Reunión {tiposReunionDisponibles.length > 1 ? '' : '(según tu rol)'}
                </label>
                <div className={`grid gap-2 ${
                  tiposReunionDisponibles.length === 1 ? 'grid-cols-1' :
                  tiposReunionDisponibles.length === 2 ? 'grid-cols-2' :
                  tiposReunionDisponibles.length === 3 ? 'grid-cols-3' :
                  'grid-cols-2 lg:grid-cols-4'
                }`}>
                  {tiposReunionDisponibles.map((tipo) => {
                    const config = TIPOS_REUNION_CONFIG[tipo];
                    const isSelected = newMeeting.tipo_reunion === tipo;
                    return (
                      <button
                        key={tipo}
                        type="button"
                        onClick={() => {
                          setNewMeeting({ ...newMeeting, tipo_reunion: tipo });
                          // Limpiar invitados si cambia a tipo que no requiere externos
                          if (!TIPOS_REUNION_CONFIG[tipo].requiereInvitadoExterno) {
                            setInvitadosExternos([]);
                          }
                        }}
                        className={`relative flex flex-col items-center gap-1 p-2.5 lg:p-2 rounded-xl border transition-all duration-200 ${
                          isSelected
                            ? `bg-gradient-to-br ${config.color} border-transparent shadow-lg`
                            : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                        }`}
                      >
                        <span className="text-xl lg:text-lg">{config.icon}</span>
                        <span className={`text-[10px] lg:text-[9px] font-bold ${isSelected ? 'text-white' : 'opacity-70'}`}>
                          {config.label}
                        </span>
                        {isSelected && (
                          <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-white flex items-center justify-center">
                            <svg className="w-2.5 h-2.5 text-green-600" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                            </svg>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[9px] opacity-40 mt-1 text-center">
                  {configTipoActual.descripcion}
                </p>
              </div>

              {/* Formulario de Invitado Externo (solo para cliente/candidato) */}
              {configTipoActual.requiereInvitadoExterno && (
                <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                  <label className="block text-[9px] font-bold uppercase tracking-wider opacity-60 mb-2">
                    {newMeeting.tipo_reunion === 'cliente' ? '🤝 Invitar Cliente' : '🎯 Invitar Candidato'}
                  </label>
                  
                  {/* Lista de invitados agregados */}
                  {invitadosExternos.length > 0 && (
                    <div className="mb-3 space-y-2">
                      {invitadosExternos.map((inv, idx) => (
                        <div key={idx} className="flex items-center gap-2 bg-white/5 rounded-lg p-2">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold">
                            {inv.nombre.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold truncate">{inv.nombre}</p>
                            <p className="text-[10px] opacity-50 truncate">{inv.email}</p>
                            {inv.empresa && <p className="text-[10px] text-emerald-400 truncate">🏢 {inv.empresa}</p>}
                            {inv.puesto_aplicado && <p className="text-[10px] text-blue-400 truncate">💼 {inv.puesto_aplicado}</p>}
                          </div>
                          <button
                            type="button"
                            onClick={() => setInvitadosExternos(prev => prev.filter((_, i) => i !== idx))}
                            className="w-6 h-6 rounded-full bg-red-500/20 hover:bg-red-500/40 flex items-center justify-center text-red-400"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Formulario para agregar nuevo invitado */}
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="email"
                        placeholder="📧 Email *"
                        value={nuevoInvitado.email || ''}
                        onChange={e => setNuevoInvitado({ ...nuevoInvitado, email: e.target.value })}
                        className={`w-full ${s.input} border rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20`}
                      />
                      <input
                        type="text"
                        placeholder="👤 Nombre *"
                        value={nuevoInvitado.nombre || ''}
                        onChange={e => setNuevoInvitado({ ...nuevoInvitado, nombre: e.target.value })}
                        className={`w-full ${s.input} border rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20`}
                      />
                    </div>
                    
                    {newMeeting.tipo_reunion === 'cliente' && (
                      <input
                        type="text"
                        placeholder="🏢 Nombre de la empresa *"
                        value={nuevoInvitado.empresa || ''}
                        onChange={e => setNuevoInvitado({ ...nuevoInvitado, empresa: e.target.value })}
                        className={`w-full ${s.input} border rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20`}
                      />
                    )}
                    
                    {newMeeting.tipo_reunion === 'candidato' && (
                      <input
                        type="text"
                        placeholder="💼 Puesto al que aplica *"
                        value={nuevoInvitado.puesto_aplicado || ''}
                        onChange={e => setNuevoInvitado({ ...nuevoInvitado, puesto_aplicado: e.target.value })}
                        className={`w-full ${s.input} border rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20`}
                      />
                    )}

                    {erroresInvitado.length > 0 && (
                      <div className="text-red-400 text-[10px]">
                        {erroresInvitado.map((err, i) => <p key={i}>• {err}</p>)}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        const validacion = validarInvitadoExterno(nuevoInvitado, newMeeting.tipo_reunion);
                        if (validacion.valido) {
                          setInvitadosExternos([...invitadosExternos, nuevoInvitado as InvitadoExterno]);
                          setNuevoInvitado({ email: '', nombre: '', empresa: '', puesto_aplicado: '' });
                          setErroresInvitado([]);
                        } else {
                          setErroresInvitado(validacion.errores);
                        }
                      }}
                      className="w-full py-2 bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/50 rounded-lg text-xs font-bold transition-all"
                    >
                      + Agregar {newMeeting.tipo_reunion === 'cliente' ? 'Cliente' : 'Candidato'}
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[9px] font-bold uppercase tracking-wider opacity-60 mb-1.5 lg:mb-1">Fecha *</label>
                  <input
                    type="date"
                    value={newMeeting.fecha}
                    onChange={e => setNewMeeting({ ...newMeeting, fecha: e.target.value })}
                    min={new Date().toISOString().split('T')[0]}
                    className={`w-full ${s.input} border rounded-lg px-2 py-2 lg:py-1.5 text-xs focus:outline-none transition-all`}
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-bold uppercase tracking-wider opacity-60 mb-1.5 lg:mb-1">Inicio *</label>
                  <input
                    type="time"
                    value={newMeeting.hora_inicio}
                    onChange={e => setNewMeeting({ ...newMeeting, hora_inicio: e.target.value })}
                    className={`w-full ${s.input} border rounded-lg px-2 py-2 lg:py-1.5 text-xs focus:outline-none transition-all`}
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-bold uppercase tracking-wider opacity-60 mb-1.5 lg:mb-1">Fin</label>
                  <input
                    type="time"
                    value={newMeeting.hora_fin}
                    onChange={e => setNewMeeting({ ...newMeeting, hora_fin: e.target.value })}
                    className={`w-full ${s.input} border rounded-lg px-2 py-2 lg:py-1.5 text-xs focus:outline-none transition-all`}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[9px] font-bold uppercase tracking-wider opacity-60 mb-1.5 lg:mb-1">Descripción</label>
                <textarea
                  value={newMeeting.descripcion}
                  onChange={e => setNewMeeting({ ...newMeeting, descripcion: e.target.value })}
                  placeholder="Agenda o detalles..."
                  rows={2}
                  className={`w-full ${s.input} border rounded-lg px-3 py-2 lg:py-1.5 text-sm lg:text-xs focus:outline-none transition-all resize-none`}
                />
              </div>

              <div>
                <label className="block text-[9px] font-bold uppercase tracking-wider opacity-60 mb-1.5 lg:mb-1">Recordatorio</label>
                <select
                  value={newMeeting.recordatorio_minutos}
                  onChange={e => setNewMeeting({ ...newMeeting, recordatorio_minutos: parseInt(e.target.value) })}
                  className={`w-full ${s.input} border rounded-lg px-3 py-2 lg:py-1.5 text-sm lg:text-xs focus:outline-none transition-all`}
                  style={{ colorScheme: 'dark' }}
                >
                  <option value={5} className="bg-zinc-800 text-white">5 min antes</option>
                  <option value={10} className="bg-zinc-800 text-white">10 min antes</option>
                  <option value={15} className="bg-zinc-800 text-white">15 min antes</option>
                  <option value={30} className="bg-zinc-800 text-white">30 min antes</option>
                  <option value={60} className="bg-zinc-800 text-white">1 hora antes</option>
                </select>
              </div>

              <div>
                <label className="block text-[9px] font-bold uppercase tracking-wider opacity-60 mb-1.5 lg:mb-1">Participantes</label>
                <div className={`${s.input} border rounded-lg p-2 max-h-28 lg:max-h-24 overflow-y-auto`}>
                  {miembrosEspacio.filter(m => m.id !== currentUser.id).length === 0 ? (
                    <p className="text-xs opacity-40 text-center py-1">No hay otros miembros</p>
                  ) : (
                    <div className="space-y-0.5">
                      {miembrosEspacio.filter(m => m.id !== currentUser.id).map(member => (
                        <button
                          key={member.id}
                          onClick={() => toggleParticipant(member.id)}
                          className={`w-full flex items-center gap-2 p-1.5 rounded-lg transition-all ${
                            newMeeting.participantes.includes(member.id)
                              ? (theme === 'arcade' ? 'bg-[#00ff41]/20 border border-[#00ff41]/50' : 'bg-indigo-500/20 border border-indigo-500/50')
                              : 'hover:bg-white/5'
                          }`}
                        >
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            newMeeting.participantes.includes(member.id) 
                              ? (theme === 'arcade' ? 'bg-[#00ff41] text-black' : 'bg-indigo-500') 
                              : 'bg-white/10'
                          }`}>
                            {member.nombre?.charAt(0) || '?'}
                          </div>
                          <span className="text-xs font-medium flex-1 text-left truncate">{member.nombre}</span>
                          {newMeeting.participantes.includes(member.id) && (
                            <svg className={`w-3.5 h-3.5 ${theme === 'arcade' ? 'text-[#00ff41]' : 'text-indigo-400'}`} fill="currentColor" viewBox="0 0 24 24">
                              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                            </svg>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="p-4 lg:p-3 border-t border-white/10 flex gap-2">
              <button
                onClick={() => { setShowScheduleModal(false); resetNewMeeting(); }}
                className="flex-1 px-3 py-2.5 lg:py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm lg:text-xs font-bold transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={createMeeting}
                disabled={!newMeeting.titulo.trim() || !newMeeting.fecha || !newMeeting.hora_inicio}
                className={`flex-1 px-3 py-2.5 lg:py-2 ${s.btn} disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-sm lg:text-xs font-bold transition-all shadow-lg`}
              >
                Programar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Videollamada */}
      {activeMeeting && (
        <div className="fixed inset-0 z-[100]">
          <MeetingRoom
            salaId={activeMeeting.salaId}
            onLeave={() => setActiveMeeting(null)}
          />
        </div>
      )}

      {/* Modal de Invitación */}
      {showInviteModal && (
        <InviteLinkGenerator
          salaId={showInviteModal}
          onClose={() => setShowInviteModal(null)}
        />
      )}

      {/* Modal Detalles de Reunión - Compacto 2026 */}
      {selectedMeeting && (
        <div 
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 lg:p-3"
          onClick={() => setSelectedMeeting(null)}
        >
          <div 
            className={`w-full max-w-md lg:max-w-sm rounded-2xl lg:rounded-xl ${s.bg} border border-white/10 shadow-2xl overflow-hidden`}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className={`p-4 lg:p-3 border-b border-white/10 ${theme === 'arcade' ? 'bg-[#00ff41]/5' : 'bg-gradient-to-r from-indigo-500/10 to-purple-500/10'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3 className="text-base lg:text-sm font-bold truncate">{selectedMeeting.titulo}</h3>
                    {isCreator(selectedMeeting) && (
                      <span className={`px-1.5 py-0.5 ${theme === 'arcade' ? 'bg-[#00ff41]/20 text-[#00ff41]' : 'bg-indigo-500/20 text-indigo-300'} rounded text-[8px] font-bold shrink-0`}>
                        ORGANIZADOR
                      </span>
                    )}
                  </div>
                  <p className="text-xs lg:text-[11px] opacity-60 truncate">{selectedMeeting.descripcion || 'Sin descripción'}</p>
                </div>
                <button 
                  onClick={() => setSelectedMeeting(null)}
                  className="p-1.5 hover:bg-white/10 rounded-lg transition-all shrink-0"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-4 lg:p-3 space-y-3 lg:space-y-2 max-h-[50vh] lg:max-h-[45vh] overflow-y-auto">
              {/* Fecha y Hora */}
              <div className="grid grid-cols-2 gap-2">
                <div className={`p-2 lg:p-1.5 rounded-lg ${theme === 'arcade' ? 'bg-[#00ff41]/10' : 'bg-indigo-500/10'}`}>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <svg className="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-[9px] font-bold opacity-60">FECHA</span>
                  </div>
                  <p className="text-xs lg:text-[11px] font-medium">{formatDateShort(selectedMeeting.fecha_inicio)}</p>
                </div>
                <div className={`p-2 lg:p-1.5 rounded-lg ${theme === 'arcade' ? 'bg-[#00ff41]/10' : 'bg-purple-500/10'}`}>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <svg className="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-[9px] font-bold opacity-60">HORA</span>
                  </div>
                  <p className="text-xs lg:text-[11px] font-medium">{formatTime(selectedMeeting.fecha_inicio)} - {formatTime(selectedMeeting.fecha_fin)}</p>
                </div>
              </div>

              {/* Tipo de Reunión */}
              {selectedMeeting.tipo_reunion && (
                <div>
                  <h4 className="text-[9px] font-bold opacity-60 uppercase mb-1.5 lg:mb-1">Tipo de Reunión</h4>
                  <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs ${theme === 'arcade' ? 'bg-[#00ff41]/10' : 'bg-white/10'}`}>
                    <span>{TIPOS_REUNION_CONFIG[selectedMeeting.tipo_reunion as TipoReunionUnificado]?.icon || '📅'}</span>
                    <span className="font-medium text-xs">{TIPOS_REUNION_CONFIG[selectedMeeting.tipo_reunion as TipoReunionUnificado]?.label || selectedMeeting.tipo_reunion}</span>
                  </div>
                </div>
              )}

              {/* Link de Reunión */}
              {selectedMeeting.meeting_link && (
                <div>
                  <h4 className="text-[9px] font-bold opacity-60 uppercase mb-1.5 lg:mb-1">Link de Videollamada</h4>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      readOnly
                      value={selectedMeeting.meeting_link}
                      className={`flex-1 ${s.input} border rounded-lg px-2 py-1.5 text-xs opacity-70`}
                    />
                    <button
                      onClick={() => copyMeetingLink(selectedMeeting.meeting_link, selectedMeeting.id)}
                      className={`px-3 py-1.5 text-xs ${copiedLink === selectedMeeting.id ? 'bg-green-500/30 text-green-300' : theme === 'arcade' ? 'bg-[#00ff41]/20 text-[#00ff41]' : 'bg-indigo-500/20 text-indigo-300'} rounded-lg font-medium transition-all`}
                    >
                      {copiedLink === selectedMeeting.id ? '✓' : 'Copiar'}
                    </button>
                  </div>
                </div>
              )}

              {/* Participantes */}
              <div>
                <h4 className="text-[9px] font-bold opacity-60 uppercase mb-1.5 lg:mb-1">Participantes ({selectedMeeting.participantes?.length || 0})</h4>
                {selectedMeeting.participantes && selectedMeeting.participantes.length > 0 ? (
                  <div className="space-y-1.5 max-h-28 overflow-y-auto">
                    {selectedMeeting.participantes.map(p => (
                      <div key={p.id} className="flex items-center justify-between p-1.5 rounded-lg bg-white/5">
                        <div className="flex items-center gap-2">
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            p.estado === 'aceptado' ? 'bg-green-500/30 text-green-300' :
                            p.estado === 'rechazado' ? 'bg-red-500/30 text-red-300' :
                            p.estado === 'tentativo' ? 'bg-amber-500/30 text-amber-300' :
                            'bg-white/10'
                          }`}>
                            {p.usuario?.nombre?.charAt(0) || '?'}
                          </div>
                          <p className="font-medium text-xs">{p.usuario?.nombre || 'Participante'}</p>
                        </div>
                        <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${
                          p.estado === 'aceptado' ? 'bg-green-500/20 text-green-400' :
                          p.estado === 'rechazado' ? 'bg-red-500/20 text-red-400' :
                          p.estado === 'tentativo' ? 'bg-amber-500/20 text-amber-400' :
                          'bg-white/10 opacity-60'
                        }`}>
                          {p.estado}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs opacity-50 text-center py-3">No hay participantes agregados</p>
                )}
              </div>
            </div>

            {/* Footer Actions */}
            <div className="p-3 lg:p-2 border-t border-white/10 flex gap-2">
              {/* Botón Cerrar - siempre visible */}
              <button
                onClick={() => setSelectedMeeting(null)}
                className="px-3 py-2 lg:py-1.5 bg-white/10 hover:bg-white/20 rounded-lg lg:rounded-md text-xs font-bold transition-all"
              >
                Cerrar
              </button>

              {selectedMeeting.sala_id && (
                <button
                  onClick={() => {
                    setSelectedMeeting(null);
                    setActiveMeeting({ salaId: selectedMeeting.sala_id!, titulo: selectedMeeting.titulo });
                  }}
                  className={`flex-1 px-3 py-2 lg:py-1.5 ${theme === 'arcade' ? 'bg-[#00ff41] text-black' : 'bg-gradient-to-r from-indigo-500 to-purple-600'} rounded-lg lg:rounded-md text-xs font-bold transition-all flex items-center justify-center gap-1.5`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  {isMeetingNow(selectedMeeting) ? 'Unirse' : 'Iniciar'}
                </button>
              )}
              {isCreator(selectedMeeting) && (
                <button
                  onClick={() => {
                    if (window.confirm('¿Estás seguro de que deseas cancelar esta reunión? Se eliminará permanentemente.')) {
                      deleteMeeting(selectedMeeting.id, selectedMeeting.google_event_id);
                      setSelectedMeeting(null);
                    }
                  }}
                  className="px-3 py-2 lg:py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg lg:rounded-md text-xs font-bold transition-all"
                >
                  Eliminar
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CalendarPanel;
