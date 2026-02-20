
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useStore } from '../store/useStore';
import VirtualSpace3D from './VirtualSpace3D';
import { TaskBoard } from './TaskBoard';
import { MiembrosView } from './MiembrosView';
import AvatarCustomizer3D from './AvatarCustomizer3D';
import { ChatPanel } from './ChatPanel';
import { CalendarPanel } from './meetings/CalendarPanel';
import { GrabacionesHistorial } from './meetings/recording/GrabacionesHistorial';
import { MetricasEmpresaPanel } from './MetricasEmpresaPanel';
import { VibenAssistant } from './VibenAssistant';
import { AvatarPreview } from './Navbar';
import { UserAvatar } from './UserAvatar';
import { StatusSelector } from './StatusSelector';
import { GameHub, GameInvitationNotification } from './games';
import { SettingsModal } from './settings/SettingsModal';
import { Role, PresenceStatus, ThemeType, User } from '../types';
import { supabase } from '../lib/supabase';
import { Language, getCurrentLanguage, subscribeToLanguageChange, t } from '../lib/i18n';
import { getSettingsSection } from '../lib/userSettings';
import { cargarMetricasEspacio } from '../lib/metricasAnalisis';
import { obtenerChunk, obtenerChunksVecinos } from '../lib/chunkSystem';
import { MiniModeOverlay } from './MiniModeOverlay';
import { ProductTour } from './onboarding/ProductTour';

export const WorkspaceLayout: React.FC = () => {
  const { activeWorkspace, activeSubTab, setActiveSubTab, setActiveWorkspace, currentUser, theme, setTheme, setView, session, setOnlineUsers, addNotification, unreadChatCount, clearUnreadChat, userRoleInActiveWorkspace, setMiniMode, isMiniMode, setEmpresaId, setDepartamentoId, setEmpresasAutorizadas, avatar3DConfig } = useStore();
  const [showViben, setShowViben] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showGameHub, setShowGameHub] = useState(false);
  const [isPlayingGame, setIsPlayingGame] = useState(false);
  const [pendingGameInvitation, setPendingGameInvitation] = useState<{ invitacion: any; partidaId: string } | null>(null);
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 768);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const presenceChannelsRef = useRef<Map<string, any>>(new Map());
  const prevOnlineUsersRef = useRef<Set<string>>(new Set());
  const lastNotificationRef = useRef<Map<string, number>>(new Map());
  const currentUserRef = useRef(currentUser);
  const avatar3DConfigRef = useRef(avatar3DConfig);
  avatar3DConfigRef.current = avatar3DConfig;
  const [currentLang, setCurrentLang] = useState<Language>(getCurrentLanguage());

  // Responsive: detectar mobile con resize listener
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) { setMobileDrawerOpen(false); setMobileMenuOpen(false); }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Cerrar drawer al cambiar de tab en mobile
  useEffect(() => {
    if (isMobile) { setMobileDrawerOpen(false); setMobileMenuOpen(false); }
  }, [activeSubTab, isMobile]);

  // Mini Mode: auto-show al salir del espacio virtual, auto-hide al volver
  useEffect(() => {
    const miniSettings = getSettingsSection('minimode');
    if (!miniSettings.enableMiniMode) return;
    if (activeSubTab !== 'space') {
      setMiniMode(true);
    } else {
      setMiniMode(false);
    }
  }, [activeSubTab]);

  // Suscribirse a cambios de idioma
  useEffect(() => {
    const unsubscribe = subscribeToLanguageChange(() => {
      setCurrentLang(getCurrentLanguage());
    });
    return unsubscribe;
  }, []);

  // Handler para cuando se acepta una invitación de juego
  const handleGameInvitationAccepted = (invitacion: any, partidaId: string) => {
    setPendingGameInvitation({ invitacion, partidaId });
    setShowGameHub(true);
  };

  const onVibenToggle = () => setShowViben(prev => !prev);
  const isAdmin = userRoleInActiveWorkspace === 'super_admin' || userRoleInActiveWorkspace === 'admin';

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  const recalcularUsuarios = useCallback(() => {
    const usuariosMap = new Map<string, User>();
    const detalleMap = new Map<string, 'empresa' | 'publico'>();
    presenceChannelsRef.current.forEach((channel) => {
      const state = channel.presenceState();
      Object.keys(state).forEach(key => {
        const presences = state[key] as any[];
        presences.forEach(presence => {
          if (presence.user_id !== session?.user?.id) {
            const nivelDetalle: 'empresa' | 'publico' = presence.nivel_detalle === 'publico' ? 'publico' : 'empresa';
            const nivelPrevio = detalleMap.get(presence.user_id);
            if (nivelPrevio === 'empresa' && nivelDetalle === 'publico') return;

            detalleMap.set(presence.user_id, nivelDetalle);
            usuariosMap.set(presence.user_id, {
              id: presence.user_id,
              name: presence.name || (nivelDetalle === 'publico' ? 'Miembro de otra empresa' : 'Usuario'),
              role: presence.role || Role.MIEMBRO,
              avatar: presence.profilePhoto || '',
              profilePhoto: presence.profilePhoto || '',
              avatarConfig: presence.avatarConfig || { skinColor: '#fcd34d', clothingColor: '#6366f1', hairColor: '#4b2c20', accessory: 'none' },
              avatar3DConfig: presence.avatar3DConfig || null,
              empresa_id: presence.empresa_id || undefined,
              departamento_id: presence.departamento_id || undefined,
              x: presence.x || 500,
              y: presence.y || 500,
              direction: presence.direction || 'front',
              isOnline: true,
              isMicOn: presence.isMicOn || false,
              isCameraOn: presence.isCameraOn || false,
              isScreenSharing: false,
              isPrivate: presence.isPrivate ?? nivelDetalle === 'publico',
              status: presence.status || PresenceStatus.AVAILABLE,
            });
          }
        });
      });
    });

    const nextIds = new Set(usuariosMap.keys());
    const now = Date.now();
    nextIds.forEach((userId) => {
      if (!prevOnlineUsersRef.current.has(userId)) {
        const lastTime = lastNotificationRef.current.get(userId) ?? 0;
        if (now - lastTime > 30000) {
          addNotification(`${usuariosMap.get(userId)?.name || 'Usuario'} se conectó`, 'entry');
          lastNotificationRef.current.set(userId, now);
        }
      }
    });

    prevOnlineUsersRef.current = nextIds;
    setOnlineUsers(Array.from(usuariosMap.values()));
  }, [addNotification, session?.user?.id, setOnlineUsers]);

  const trackPresenceEnCanal = useCallback(async (channel: any, nivelDetalle: 'publico' | 'empresa') => {
    if (!session?.user?.id) return;
    const privacy = getSettingsSection('privacy');
    const usuarioActual = currentUserRef.current;
    const statusPrivado = !privacy.showOnlineStatus
      ? PresenceStatus.AWAY
      : !privacy.showActivityStatus
      ? PresenceStatus.AVAILABLE
      : usuarioActual.status;
    const payloadBase = {
      user_id: session.user.id,
      empresa_id: usuarioActual.empresa_id ?? null,
      departamento_id: usuarioActual.departamento_id ?? null,
      nivel_detalle: nivelDetalle,
      x: privacy.showLocationInSpace ? usuarioActual.x : 0,
      y: privacy.showLocationInSpace ? usuarioActual.y : 0,
      direction: usuarioActual.direction,
      status: statusPrivado,
    };
    const payloadEmpresa = {
      ...payloadBase,
      name: usuarioActual.name,
      role: usuarioActual.role,
      avatarConfig: usuarioActual.avatarConfig,
      profilePhoto: usuarioActual.profilePhoto,
      isMicOn: usuarioActual.isMicOn,
      isCameraOn: usuarioActual.isCameraOn,
      avatar3DConfig: avatar3DConfigRef.current || null,
    };
    const payloadPublico = {
      ...payloadBase,
      name: 'Miembro de otra empresa',
      role: Role.MIEMBRO,
      avatarConfig: undefined,
      profilePhoto: '',
      isMicOn: false,
      isCameraOn: false,
      isPrivate: true,
      status: PresenceStatus.AWAY,
    };
    await channel.track(nivelDetalle === 'empresa' ? payloadEmpresa : payloadPublico);
  }, [session?.user?.id]);

  const sincronizarCanalesPorChunk = useCallback(() => {
    if (!activeWorkspace?.id || !session?.user?.id) return;
    const usuarioActual = currentUserRef.current;
    const chunkActual = obtenerChunk(usuarioActual.x, usuarioActual.y);
    const claves = obtenerChunksVecinos(chunkActual, 2);
    const canalesDeseados = new Map<string, 'publico' | 'empresa'>();
    const empresaId = usuarioActual.empresa_id ?? null;

    claves.forEach((clave) => {
      canalesDeseados.set(`workspace:${activeWorkspace.id}:${clave}:publico`, 'publico');
      if (empresaId) {
        canalesDeseados.set(`workspace:${activeWorkspace.id}:${clave}:empresa:${empresaId}`, 'empresa');
      }
    });

    canalesDeseados.forEach((nivelDetalle, canalNombre) => {
      if (presenceChannelsRef.current.has(canalNombre)) return;
      const channel = supabase.channel(canalNombre, {
        config: { presence: { key: session.user.id } }
      });

      channel
        .on('presence', { event: 'sync' }, () => {
          recalcularUsuarios();
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await trackPresenceEnCanal(channel, nivelDetalle);
          }
        });

      presenceChannelsRef.current.set(canalNombre, channel);
    });

    presenceChannelsRef.current.forEach((channel, canalNombre) => {
      if (!canalesDeseados.has(canalNombre)) {
        supabase.removeChannel(channel);
        presenceChannelsRef.current.delete(canalNombre);
      }
    });
  }, [activeWorkspace?.id, session?.user?.id, recalcularUsuarios, trackPresenceEnCanal]);

  // Aplicar reducedMotion globalmente al body
  useEffect(() => {
    const perf = getSettingsSection('performance');
    if (perf.reducedMotion) {
      document.documentElement.classList.add('reduce-motion');
    } else {
      document.documentElement.classList.remove('reduce-motion');
    }
  }, []);

  useEffect(() => {
    if (!activeWorkspace) setView('dashboard');
  }, [activeWorkspace, setView]);

  // Cargar métricas de análisis conductual del espacio (Supabase → cache en memoria)
  useEffect(() => {
    if (activeWorkspace?.id) {
      cargarMetricasEspacio(activeWorkspace.id);
    }
  }, [activeWorkspace?.id]);

  useEffect(() => {
    if (!activeWorkspace?.id || !session?.user?.id) return;
    let cancelado = false;
    const cargarEmpresa = async () => {
      try {
        const { data } = await supabase
          .from('miembros_espacio')
          .select('empresa_id, departamento_id')
          .eq('espacio_id', activeWorkspace.id)
          .eq('usuario_id', session.user.id)
          .maybeSingle();

        if (!cancelado) {
          setEmpresaId(data?.empresa_id ?? null);
          setDepartamentoId(data?.departamento_id ?? null);
        }
      } catch (error) {
        if (!cancelado) {
          setEmpresaId(null);
          setDepartamentoId(null);
        }
      }
    };

    cargarEmpresa();
    return () => {
      cancelado = true;
    };
  }, [activeWorkspace?.id, session?.user?.id, setEmpresaId, setDepartamentoId]);

  useEffect(() => {
    if (!activeWorkspace?.id || !currentUser.empresa_id) {
      setEmpresasAutorizadas([]);
      return;
    }

    let cancelado = false;
    const cargarAutorizaciones = async () => {
      try {
        const { data } = await supabase
          .from('autorizaciones_empresa')
          .select('empresa_origen_id, empresa_destino_id, estado')
          .eq('espacio_id', activeWorkspace.id)
          .eq('estado', 'aprobada');

        if (cancelado) return;
        const autorizadas = new Set<string>();
        (data || []).forEach((row: any) => {
          if (row.empresa_origen_id === currentUser.empresa_id && row.empresa_destino_id) {
            autorizadas.add(row.empresa_destino_id);
          }
          if (row.empresa_destino_id === currentUser.empresa_id && row.empresa_origen_id) {
            autorizadas.add(row.empresa_origen_id);
          }
        });
        setEmpresasAutorizadas(Array.from(autorizadas));
      } catch (error) {
        if (!cancelado) setEmpresasAutorizadas([]);
      }
    };

    cargarAutorizaciones();
    return () => {
      cancelado = true;
    };
  }, [activeWorkspace?.id, currentUser.empresa_id, setEmpresasAutorizadas]);

  // Realtime Presence por chunk (interest management)
  useEffect(() => {
    if (!activeWorkspace?.id || !session?.user?.id) return;
    sincronizarCanalesPorChunk();
    return () => {
      presenceChannelsRef.current.forEach((channel) => {
        supabase.removeChannel(channel);
      });
      presenceChannelsRef.current.clear();
      prevOnlineUsersRef.current = new Set();
    };
  }, [activeWorkspace?.id, session?.user?.id, currentUser.empresa_id, sincronizarCanalesPorChunk]);

  useEffect(() => {
    if (!activeWorkspace?.id || !session?.user?.id) return;
    sincronizarCanalesPorChunk();
  }, [activeWorkspace?.id, session?.user?.id, currentUser.x, currentUser.y, currentUser.empresa_id, sincronizarCanalesPorChunk]);

  // Registrar conexión al espacio para tracking de tiempo (solo si activityHistory está habilitado)
  useEffect(() => {
    if (!activeWorkspace?.id || !session?.user?.id) return;
    let conexionId: string | null = null;
    const privacyForConn = getSettingsSection('privacy');
    if (privacyForConn.activityHistoryEnabled !== false) {
      const registrarConexion = async () => {
        try {
          const { data } = await supabase
            .from('registro_conexiones')
            .insert({ usuario_id: session.user.id, espacio_id: activeWorkspace.id, empresa_id: currentUserRef.current.empresa_id ?? null })
            .select('id')
            .single();
          if (data) conexionId = data.id;

          await supabase.from('actividades_log').insert({
            usuario_id: session.user.id,
            empresa_id: currentUserRef.current.empresa_id ?? null,
            espacio_id: activeWorkspace.id,
            accion: 'conexion_espacio',
            entidad: 'espacio',
            entidad_id: activeWorkspace.id,
            descripcion: 'Usuario conectado al espacio',
            datos_extra: { origen: 'workspace_layout' }
          });
          
          // Limpiar registros antiguos según retención configurada
          const retDays = privacyForConn.activityRetentionDays;
          if (retDays && retDays > 0) {
            const cutoff = new Date(Date.now() - retDays * 24 * 60 * 60 * 1000).toISOString();
            supabase.from('registro_conexiones')
              .delete()
              .eq('usuario_id', session.user.id)
              .lt('conectado_en', cutoff)
              .then(() => {});
          }
        } catch (e) { console.warn('Error registrando conexión:', e); }
      };
      registrarConexion();
    }

    // Al cerrar pestaña, registrar desconexión via fetch keepalive (soporta headers)
    const handleBeforeUnload = () => {
      if (conexionId) {
        const url = `https://lcryrsdyrzotjqdxcwtp.supabase.co/rest/v1/registro_conexiones?id=eq.${conexionId}`;
        fetch(url, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxjcnlyc2R5cnpvdGpxZHhjd3RwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc2NDg0MTgsImV4cCI6MjA4MzIyNDQxOH0.8fsqkKHHOVCZMi8tAb85HN_It2QCSWP0delcFn56vd4',
            'Authorization': `Bearer ${session.access_token}`,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ desconectado_en: new Date().toISOString() }),
          keepalive: true
        }).catch(() => {});
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // Registrar desconexión al desmontar
      if (conexionId) {
        supabase.from('registro_conexiones')
          .update({ desconectado_en: new Date().toISOString() })
          .eq('id', conexionId)
          .then(() => console.log('Desconexión registrada'));

        supabase.from('actividades_log').insert({
          usuario_id: session.user.id,
          empresa_id: currentUserRef.current.empresa_id ?? null,
          espacio_id: activeWorkspace.id,
          accion: 'desconexion_espacio',
          entidad: 'espacio',
          entidad_id: activeWorkspace.id,
          descripcion: 'Usuario desconectado del espacio',
          datos_extra: { origen: 'workspace_layout' }
        }).then(() => {});
      }
    };
  }, [activeWorkspace?.id, session?.user?.id, session?.access_token]);

  // Actualizar presencia cuando cambia la posición (respetando settings de privacidad)
  useEffect(() => {
    if (!session?.user?.id) return;
    presenceChannelsRef.current.forEach((channel, canalNombre) => {
      if (channel.state === 'joined') {
        const nivelDetalle = canalNombre.includes(':publico') ? 'publico' : 'empresa';
        trackPresenceEnCanal(channel, nivelDetalle);
      }
    });
  }, [currentUser.x, currentUser.y, currentUser.isMicOn, currentUser.isCameraOn, currentUser.status, currentUser.empresa_id, session?.user?.id, trackPresenceEnCanal]);

  if (!activeWorkspace) return null;

  // ============== GLASSMORPHISM 2026 - Sistema de estilos unificado ==============
  // Inspirado en el onboarding para coherencia visual
  const glassBase = 'backdrop-blur-xl';
  const glassPanel = 'bg-white/[0.03] border-white/[0.08]';
  const glassHover = 'hover:bg-white/[0.06] hover:border-violet-500/30';
  const gradientPrimary = 'from-violet-600 via-fuchsia-600 to-cyan-500';
  const gradientText = 'text-transparent bg-clip-text bg-gradient-to-r from-white via-violet-200 to-white';
  const glowViolet = 'shadow-[0_0_20px_rgba(139,92,246,0.3)]';
  const glowCyan = 'shadow-[0_0_20px_rgba(34,211,238,0.3)]';

  const themeStyles = {
    dark: {
      bg: 'bg-[#0a0a0f]',
      text: 'text-zinc-100',
      globalNav: `${glassBase} bg-black/60 border-r border-white/[0.05]`,
      sidebar: `${glassBase} bg-black/40 border-white/[0.05]`,
      border: 'border-white/[0.08]',
      header: `${glassBase} bg-black/40`,
      accent: 'bg-violet-600',
      btn: `bg-gradient-to-r ${gradientPrimary} hover:opacity-90 text-white font-bold ${glowViolet}`,
      btnSecondary: `${glassBase} bg-white/[0.05] border border-white/[0.1] hover:border-violet-500/50 text-white`
    },
    light: {
      bg: 'bg-slate-50',
      text: 'text-zinc-900',
      globalNav: 'bg-white/80 backdrop-blur-xl border-r border-zinc-200',
      sidebar: 'bg-white/60 backdrop-blur-xl border-zinc-200',
      border: 'border-zinc-200',
      header: 'bg-white/80 backdrop-blur-xl',
      accent: 'bg-violet-600',
      btn: `bg-gradient-to-r ${gradientPrimary} hover:opacity-90 text-white font-bold shadow-lg`,
      btnSecondary: 'bg-white border border-zinc-200 hover:border-violet-500/50 text-zinc-700'
    },
    space: {
      bg: 'bg-[#020617]',
      text: 'text-indigo-100',
      globalNav: `${glassBase} bg-indigo-950/60 border-r border-indigo-500/20`,
      sidebar: `${glassBase} bg-indigo-950/40 border-indigo-500/20`,
      border: 'border-indigo-500/20',
      header: `${glassBase} bg-indigo-950/40`,
      accent: 'bg-cyan-500',
      btn: `bg-gradient-to-r from-cyan-500 via-blue-500 to-violet-500 hover:opacity-90 text-white font-bold ${glowCyan}`,
      btnSecondary: `${glassBase} bg-indigo-500/10 border border-indigo-500/30 hover:border-cyan-500/50 text-indigo-100`
    },
    arcade: {
      bg: 'bg-black',
      text: 'text-[#00ff41]',
      globalNav: 'bg-black border-r border-[#00ff41]/40',
      sidebar: 'bg-black/90 border-[#00ff41]/30',
      border: 'border-[#00ff41]/40',
      header: 'bg-black/90',
      accent: 'bg-[#00ff41]',
      btn: 'bg-[#00ff41] hover:bg-[#00ff41]/80 text-black font-black uppercase tracking-tighter shadow-[0_0_20px_#00ff41]',
      btnSecondary: 'bg-black border-2 border-[#00ff41]/60 hover:border-[#00ff41] text-[#00ff41]'
    }
  };

  const s = themeStyles[theme] || themeStyles.dark;

  const themes: {id: ThemeType, label: string, icon: string}[] = [
    { id: 'dark', label: t('theme.dark', currentLang), icon: '🌑' },
    { id: 'light', label: t('theme.light', currentLang), icon: '☀️' },
    { id: 'space', label: t('theme.space', currentLang), icon: '🚀' },
    { id: 'arcade', label: t('theme.arcade', currentLang), icon: '🎮' }
  ];

  return (
    <div className={`flex h-screen w-screen overflow-hidden transition-all duration-500 ${s.bg} ${s.text}`}>
      
      {/* Sidebar Global - 2026 Minimal Style — oculto en mobile */}
      <aside className={`w-[52px] ${s.globalNav} hidden md:flex flex-col items-center py-5 gap-4 shrink-0 z-[100] border-r ${s.border}`}>
        <div 
          onClick={() => setView('dashboard')}
          className={`w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer hover:scale-105 transition-all shadow-lg overflow-hidden ${theme === 'arcade' ? 'bg-[#00ff41] border border-[#00ff41]' : 'bg-white'}`}
        >
          {/* Logo SVG */}
          <svg className={`w-5 h-5 ${theme === 'arcade' ? 'text-black' : 'text-indigo-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
          </svg>
        </div>

        <nav className="flex-1 flex flex-col gap-1 mt-3" data-tour-step="sidebar-nav">
          {[
            { id: 'space', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', label: t('nav.space', currentLang) },
            { id: 'chat', icon: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z', label: t('nav.messages', currentLang) },
            { id: 'tasks', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2', label: t('nav.tasks', currentLang) },
            { id: 'grabaciones', icon: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z', label: t('nav.recordings', currentLang) },
            { id: 'metricas', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z', label: 'Métricas' }
          ].map(item => (
            <button 
              key={item.id}
              onClick={() => {
                setActiveSubTab(item.id as any);
                if (item.id === 'chat') clearUnreadChat();
              }}
              className={`relative p-2.5 rounded-lg transition-all duration-200 group ${activeSubTab === item.id 
                ? (theme === 'arcade' 
                    ? 'bg-[#00ff41]/15 text-[#00ff41]' 
                    : 'bg-white/10 text-white') 
                : 'text-white/40 hover:text-white/80 hover:bg-white/[0.04]'}`}
              title={item.label}
            >
              {/* Indicador lateral activo - Tendencia 2026 */}
              {activeSubTab === item.id && (
                <span className={`absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 rounded-full ${theme === 'arcade' ? 'bg-[#00ff41] shadow-[0_0_8px_#00ff41]' : 'bg-gradient-to-b from-violet-400 to-cyan-400'}`} />
              )}
              <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d={item.icon}/></svg>
              {item.id === 'chat' && unreadChatCount > 0 && activeSubTab !== 'chat' && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full text-[8px] font-bold text-white flex items-center justify-center">
                  {unreadChatCount > 9 ? '9+' : unreadChatCount}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-1 items-center pb-3">
          {/* Botón de Configuración - 2026 Minimal */}
          <button
            data-tour-step="settings-btn"
            onClick={() => setShowSettings(true)}
            className={`p-2.5 rounded-lg transition-all duration-200 ${
              theme === 'arcade' 
                ? 'text-[#00ff41]/60 hover:text-[#00ff41] hover:bg-[#00ff41]/10' 
                : 'text-white/40 hover:text-white/80 hover:bg-white/[0.04]'
            }`}
            title={t('nav.settings', currentLang)}
          >
            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          
          {/* Avatar del usuario - Más compacto */}
          <UserAvatar
            name={currentUser.name}
            profilePhoto={currentUser.profilePhoto}
            size="sm"
            showStatus
            status={currentUser.status}
            onClick={() => setActiveSubTab('avatar')}
          />
        </div>
      </aside>

      {/* Sidebar Workspace — desktop: fija, mobile: drawer overlay */}
      {!isMobile ? (
        <aside className={`w-[260px] ${s.sidebar} flex flex-col shrink-0 border-r ${s.border} z-90 shadow-2xl relative overflow-hidden`} data-tour-step="sidebar-chat">
          {theme === 'arcade' && <div className="absolute top-0 left-0 w-full h-1 bg-[#00ff41] animate-pulse" />}
          <ChatPanel sidebarOnly={true} showNotifications={true} />
        </aside>
      ) : mobileDrawerOpen ? (
        <>
          {/* Backdrop oscuro */}
          <div className="fixed inset-0 bg-black/60 z-[200] backdrop-blur-sm" onClick={() => setMobileDrawerOpen(false)} />
          {/* Drawer sidebar mobile — slide from left */}
          <aside className={`fixed inset-y-0 left-0 w-[85vw] max-w-[320px] ${s.sidebar} flex flex-col z-[201] shadow-2xl border-r ${s.border} animate-in slide-in-from-left duration-300 overflow-hidden`}>
            {/* Header del drawer con botón cerrar */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <span className="text-xs font-black uppercase tracking-wider opacity-60">{activeWorkspace?.name}</span>
              <button onClick={() => setMobileDrawerOpen(false)} className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center">
                <svg className="w-4 h-4 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <ChatPanel sidebarOnly={true} showNotifications={true} onChannelSelect={() => setMobileDrawerOpen(false)} />
            </div>
          </aside>
        </>
      ) : null}

      {/* Main Content */}
      <main className={`flex-1 relative h-full flex flex-col min-w-0 ${s.bg}`}>
        <header className={`h-16 border-b ${s.border} hidden md:flex items-center px-8 justify-between shrink-0 ${s.header} z-50`}>
          <div className="flex items-center gap-4">
             {/* Título con efecto gradient text estilo onboarding */}
             <div className="flex items-center gap-3">
               <div className={`w-2 h-2 rounded-full ${theme === 'arcade' ? 'bg-[#00ff41] animate-pulse' : 'bg-gradient-to-r from-violet-500 to-cyan-500'}`} />
               <h2 className={`text-xs font-black uppercase tracking-[0.2em] ${
                 theme === 'arcade' 
                   ? 'text-[#00ff41] animate-pulse' 
                   : theme === 'light'
                     ? 'text-zinc-700'
                     : 'text-transparent bg-clip-text bg-gradient-to-r from-white via-violet-200 to-white'
               }`}>
                 {activeSubTab === 'space' ? 'Spatial World' : activeSubTab.toUpperCase()}
               </h2>
             </div>
          </div>
          
          <div className="flex items-center gap-4">
            {/* SELECTOR DE ESTADO */}
            <StatusSelector />
            
            {/* SELECTOR DE TEMAS - Glassmorphism */}
            <div data-tour-step="theme-selector" className={`flex items-center gap-1.5 p-1.5 rounded-2xl border backdrop-blur-xl ${
              theme === 'arcade' 
                ? 'border-[#00ff41]/40 bg-black/60' 
                : theme === 'light'
                  ? 'border-zinc-200 bg-white/60'
                  : 'border-white/[0.08] bg-white/[0.03]'
            }`}>
              <span className={`text-[8px] font-black uppercase tracking-widest px-2 hidden lg:block ${
                theme === 'light' ? 'text-zinc-400' : 'opacity-40'
              }`}>{t('theme.style', currentLang)}</span>
              {themes.map(t => (
                <button 
                  key={t.id} 
                  onClick={() => setTheme(t.id)} 
                  className={`w-8 h-8 rounded-xl flex items-center justify-center text-base transition-all transform active:scale-90 ${
                    theme === t.id 
                      ? theme === 'arcade'
                        ? 'bg-[#00ff41] shadow-[0_0_15px_#00ff41] scale-105'
                        : 'bg-gradient-to-br from-violet-500/30 to-fuchsia-500/30 shadow-lg scale-105 border border-violet-500/30'
                      : 'opacity-30 hover:opacity-100 hover:bg-white/[0.05]'
                  }`}
                  title={t.label}
                >
                  {t.icon}
                </button>
              ))}
            </div>

            {/* BOTÓN MINI JUEGOS - Estilo glassmorphism */}
            <button 
              data-tour-step="games-btn"
              onClick={() => setShowGameHub(true)} 
              className={`relative overflow-hidden flex items-center gap-2.5 px-4 py-2.5 rounded-2xl transition-all font-bold text-[10px] tracking-wider group ${
                theme === 'arcade' 
                  ? 'bg-[#00ff41]/20 text-[#00ff41] border border-[#00ff41]/50 hover:bg-[#00ff41]/30' 
                  : 'bg-white/[0.05] border border-white/[0.1] text-white/80 hover:bg-white/[0.1] hover:border-amber-500/50 hover:text-amber-400'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
              </svg>
              <span>{t('button.games', currentLang)}</span>
            </button>

            {/* BOTÓN VIBEN AI - Estilo onboarding con gradiente */}
            <button 
              data-tour-step="viben-btn"
              onClick={onVibenToggle} 
              className={`relative overflow-hidden flex items-center gap-2.5 px-5 py-2.5 rounded-2xl transition-all font-black uppercase text-[10px] tracking-wider group ${
                theme === 'arcade' 
                  ? 'bg-[#00ff41] text-black shadow-[0_0_25px_#00ff41] hover:shadow-[0_0_35px_#00ff41]' 
                  : 'bg-gradient-to-r from-violet-600 via-fuchsia-600 to-cyan-500 text-white shadow-[0_0_20px_rgba(139,92,246,0.4)] hover:shadow-[0_0_30px_rgba(139,92,246,0.5)]'
              }`}
            >
              {/* Hover overlay estilo onboarding */}
              <span className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ${
                theme === 'arcade' ? 'bg-white/20' : 'bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-400'
              }`} />
              <span className="relative flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full animate-pulse ${theme === 'arcade' ? 'bg-black' : 'bg-white'}`} />
                Mónica AI
              </span>
            </button>
          </div>
        </header>

        <div className="flex-1 relative overflow-hidden">
          {/* VirtualSpace3D siempre montado pero oculto cuando no está activo
              Esto mantiene el stream y conexiones WebRTC activas
              IMPORTANTE: Usar visibility:hidden en vez de display:none para que los <audio>
              elements de LiveKit sigan reproduciéndose cuando se navega al chat u otra tab */}
          <div 
            className={activeSubTab === 'space' ? 'h-full w-full' : 'absolute inset-0 pointer-events-none'} 
            style={activeSubTab !== 'space' ? { visibility: 'hidden' } : undefined}
            data-tour-step="space-canvas"
          >
            <VirtualSpace3D theme={theme} isGameHubOpen={showGameHub} isPlayingGame={isPlayingGame} />
          </div>
          {activeSubTab !== 'space' && (
            <div className="h-full w-full flex flex-col overflow-hidden animate-in fade-in duration-500">
              {/* Mobile: header con botón volver al espacio */}
              {isMobile && (
                <div className={`flex items-center gap-3 px-4 py-3 border-b ${s.border} shrink-0 ${s.header} backdrop-blur-xl`}>
                  <button
                    onClick={() => setActiveSubTab('space' as any)}
                    className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                  </button>
                  <span className="text-xs font-black uppercase tracking-wider opacity-70">
                    {activeSubTab === 'chat' ? 'Chat' : activeSubTab === 'tasks' ? 'Tareas' : activeSubTab === 'calendar' ? 'Calendario' : activeSubTab === 'grabaciones' ? 'Grabaciones' : activeSubTab === 'miembros' ? 'Miembros' : activeSubTab === 'avatar' ? 'Avatar' : activeSubTab === 'metricas' ? 'Métricas' : activeSubTab}
                  </span>
                </div>
              )}
              <div className={`flex-1 overflow-y-auto ${isMobile ? 'pb-16' : ''}`}>
                {activeSubTab === 'tasks' && <TaskBoard />}
                {activeSubTab === 'miembros' && <MiembrosView />}
                {activeSubTab === 'avatar' && <AvatarCustomizer3D />}
                {activeSubTab === 'chat' && <ChatPanel chatOnly={true} />}
                {activeSubTab === 'calendar' && <CalendarPanel />}
                {activeSubTab === 'grabaciones' && <GrabacionesHistorial />}
                {activeSubTab === 'metricas' && <MetricasEmpresaPanel />}
              {activeSubTab === 'settings' && (
                <div className="p-6 md:p-16 max-w-4xl mx-auto">
                  <h2 className="text-2xl md:text-5xl font-black uppercase italic tracking-tighter mb-6 md:mb-10">{t('settings.title', currentLang)}</h2>
                  <div className={`p-4 md:p-12 rounded-2xl md:rounded-[50px] border-2 ${s.border} bg-black/10 backdrop-blur-3xl shadow-2xl`}>
                    <div className={`flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 md:pb-10 border-b-2 ${s.border}`}>
                      <div>
                        <p className="text-[11px] font-black uppercase tracking-[0.3em] opacity-30">{t('workspace.inUse', currentLang)}</p>
                        <p className="text-xl md:text-4xl font-bold mt-2">{activeWorkspace?.name}</p>
                      </div>
                      <button className={`px-6 md:px-10 py-3 md:py-4 rounded-2xl md:rounded-3xl text-[11px] font-black uppercase tracking-widest transition-all ${s.btn}`}>{t('button.customize', currentLang)}</button>
                    </div>
                    <div className="pt-6 md:pt-10">
                      <button onClick={() => setActiveWorkspace(null)} className="text-red-500 text-[11px] font-black uppercase tracking-[0.2em] hover:text-red-400 flex items-center gap-3 transition-colors">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                        {t('button.logout', currentLang)}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              </div>
            </div>
          )}
        </div>

        {/* El contenedor ahora es puramente de posicionamiento, no tiene estilos propios */}
        {showViben && (
          <div className="fixed bottom-4 right-4 z-[200] w-[calc(100vw-2rem)] sm:w-[340px] flex flex-col items-end pointer-events-none">
            <div className="w-full pointer-events-auto animate-in slide-in-from-right-4 duration-500">
              <VibenAssistant onClose={() => setShowViben(false)} />
            </div>
          </div>
        )}

        {/* Game Hub Modal */}
        <GameHub 
          isOpen={showGameHub} 
          onClose={() => {
            setShowGameHub(false);
            setIsPlayingGame(false);
            setPendingGameInvitation(null);
          }}
          espacioId={activeWorkspace?.id}
          currentUserId={session?.user?.id}
          currentUserName={currentUser?.name}
          pendingInvitation={pendingGameInvitation}
          onPendingInvitationHandled={() => setPendingGameInvitation(null)}
          onGamePlayingChange={setIsPlayingGame}
        />

        {/* Notificaciones de invitación a juegos */}
        {activeWorkspace?.id && session?.user?.id && (
          <GameInvitationNotification
            userId={session.user.id}
            espacioId={activeWorkspace.id}
            onAccept={handleGameInvitationAccepted}
          />
        )}

        {/* ===== MOBILE FAB + OVERLAY MENU — Patrón gaming 2026 (Wild Rift style) ===== */}
        {isMobile && (
          <>
            {/* FAB: Floating Action Button — esquina superior derecha */}
            <button
              onClick={() => { setMobileMenuOpen(!mobileMenuOpen); if (mobileDrawerOpen) setMobileDrawerOpen(false); }}
              className={`fixed top-3 right-3 z-[210] w-10 h-10 rounded-xl flex items-center justify-center backdrop-blur-xl border transition-all duration-300 ${
                mobileMenuOpen
                  ? 'bg-white/20 border-white/30 rotate-90 scale-110'
                  : theme === 'arcade'
                    ? 'bg-black/70 border-[#00ff41]/40 text-[#00ff41]'
                    : theme === 'light'
                      ? 'bg-white/80 border-zinc-300 text-zinc-600'
                      : 'bg-black/60 border-white/15 text-white/70'
              }`}
              style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
            >
              {mobileMenuOpen ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                  {unreadChatCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[8px] font-bold text-white flex items-center justify-center">{unreadChatCount > 9 ? '9+' : unreadChatCount}</span>
                  )}
                </>
              )}
            </button>

            {/* Overlay menú fullscreen — se abre al tocar el FAB */}
            {mobileMenuOpen && (
              <div className="fixed inset-0 z-[205] flex items-center justify-center animate-in fade-in duration-200" onClick={() => setMobileMenuOpen(false)}>
                {/* Backdrop */}
                <div className={`absolute inset-0 ${theme === 'light' ? 'bg-white/80' : 'bg-black/80'} backdrop-blur-xl`} />
                {/* Grid de opciones */}
                <div className="relative grid grid-cols-3 gap-4 p-8 max-w-xs" onClick={(e) => e.stopPropagation()}>
                  {[
                    { id: 'space', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', label: 'Espacio', color: 'from-indigo-500 to-blue-500' },
                    { id: 'chat', icon: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z', label: 'Chat', color: 'from-blue-500 to-cyan-500', badge: unreadChatCount },
                    { id: '_drawer_sidebar', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10', label: 'Workspace', color: 'from-violet-500 to-purple-500' },
                    { id: '_games', icon: 'M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z', label: 'Juegos', color: 'from-amber-500 to-orange-500' },
                    { id: '_settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z', label: 'Ajustes', color: 'from-zinc-400 to-zinc-600' },
                    { id: 'calendar', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', label: 'Calendario', color: 'from-emerald-500 to-teal-500' },
                  ].map((item, i) => {
                    const handleItemClick = () => {
                      setMobileMenuOpen(false);
                      if (item.id === '_games') { setShowGameHub(true); return; }
                      if (item.id === '_settings') { setShowSettings(true); return; }
                      if (item.id === '_drawer_sidebar') {
                        setMobileDrawerOpen(true);
                        return;
                      }
                      setActiveSubTab(item.id as any);
                      if (item.id === 'chat') clearUnreadChat();
                    };
                    return (
                      <button
                        key={item.id}
                        onClick={handleItemClick}
                        className="flex flex-col items-center gap-2 group"
                        style={{ animationDelay: `${i * 50}ms` }}
                      >
                        <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${item.color} flex items-center justify-center shadow-lg group-active:scale-90 transition-transform relative`}>
                          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
                          </svg>
                          {item.badge && item.badge > 0 && (
                            <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-[9px] font-bold text-white flex items-center justify-center border-2 border-black">{item.badge > 9 ? '9+' : item.badge}</span>
                          )}
                        </div>
                        <span className={`text-[10px] font-bold ${theme === 'light' ? 'text-zinc-700' : 'text-white/80'}`}>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        workspaceId={activeWorkspace?.id || ''}
        isAdmin={isAdmin}
        currentTheme={theme}
        onThemeChange={(newTheme) => setTheme(newTheme as any)}
      />

      {/* Mini Mode Overlay */}
      <MiniModeOverlay />

      {/* Product Tour - Guía interactiva para nuevos miembros */}
      {activeWorkspace?.id && session?.user?.id && activeSubTab === 'space' && (
        <ProductTour
          espacioId={activeWorkspace.id}
          userId={session.user.id}
          rol={userRoleInActiveWorkspace || 'miembro'}
        />
      )}
    </div>
  );
};
