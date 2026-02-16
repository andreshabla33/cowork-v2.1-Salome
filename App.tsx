
import React, { useEffect, useState, Suspense } from 'react';
import { useStore } from './store/useStore';
import { supabase } from './lib/supabase';
import './lib/i18n-config'; // Inicializar i18next
import { LoginScreen } from './components/LoginScreen';
import { Dashboard } from './components/Dashboard';
import { WorkspaceLayout } from './components/WorkspaceLayout';
import { CargoSelector } from './components/onboarding/CargoSelector';
import { OnboardingCreador } from './components/onboarding/OnboardingCreador';
import { MeetingLobby, MeetingRoom } from './components/meetings/videocall';
import type { CargoLaboral, CargoDB } from './components/onboarding/CargoSelector';

const ESPACIO_GLOBAL_ID = '91887e81-1f26-448c-9d6d-9839e7d83b5d';

const App: React.FC = () => {
  const { session, setSession, view, setView, initialize, initialized, setAuthFeedback, fetchWorkspaces, setActiveWorkspace } = useStore();

  useEffect(() => {
    // Verificar confirmación de email via token_hash en URL
    const urlParams = new URLSearchParams(window.location.search);
    const tokenHash = urlParams.get('token_hash');
    const type = urlParams.get('type');

    const verifyAndInit = async () => {
      if (tokenHash && (type === 'signup' || type === 'email')) {
        try {
          const { data, error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: type === 'signup' ? 'signup' : 'email',
          });
          if (error) {
            console.error('Error verificando email:', error.message);
            setAuthFeedback({ type: 'error', message: 'Error al confirmar email. Intenta registrarte de nuevo.' });
          } else if (data.session) {
            setSession(data.session);
            setAuthFeedback({ type: 'success', message: '¡Email confirmado! Bienvenido a Cowork.' });
          }
          // Limpiar URL params después de verificar
          window.history.replaceState({}, '', window.location.pathname);
        } catch (err) {
          console.error('Error en verifyOtp:', err);
        }
      }
      await initialize();
    };

    verifyAndInit();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log("Auth Event:", event);
      setSession(session);
      
      if (event === 'SIGNED_IN') {
        await initialize();
      } else if (event === 'SIGNED_OUT') {
        setView('dashboard');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Detectar si es una invitación de videollamada (URL: /join/TOKEN) o acceso directo (URL: /sala/ID)
  const [meetingToken, setMeetingToken] = useState<string | null>(null);
  const [directSalaId, setDirectSalaId] = useState<string | null>(
    sessionStorage.getItem('pending_sala_id')
  );
  const [inMeeting, setInMeeting] = useState(false);
  const [meetingNombre, setMeetingNombre] = useState('');
  const [showThankYou, setShowThankYou] = useState(false);

  useEffect(() => {
    const path = window.location.pathname;
    if (path.startsWith('/join/')) {
      const token = path.replace('/join/', '');
      if (token) {
        setMeetingToken(token);
      }
    } else if (path.startsWith('/sala/')) {
      const salaId = path.replace('/sala/', '');
      if (salaId) {
        setDirectSalaId(salaId);
        sessionStorage.setItem('pending_sala_id', salaId);
      }
    }
  }, []);

  // Si hay token de videollamada, mostrar lobby o sala (no requiere sesión)
  if (meetingToken && !inMeeting) {
    return (
      <MeetingLobby
        tokenInvitacion={meetingToken}
        onJoin={(token, nombre) => {
          setMeetingNombre(nombre);
          setInMeeting(true);
        }}
        onError={(error) => console.error('Error en lobby:', error)}
      />
    );
  }

  // Pantalla de agradecimiento para invitados externos
  if (showThankYou) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex items-center justify-center p-4">
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-10 max-w-lg text-center">
          <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center">
            <svg className="w-12 h-12 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white mb-3">¡Gracias por participar!</h2>
          <p className="text-white/60 mb-2">La reunión ha finalizado.</p>
          <p className="text-white/50 text-sm mb-8">
            Esperamos que haya sido una gran experiencia. Si el organizador configuró un resumen, lo recibirás por email.
          </p>
          <div className="flex flex-col gap-3">
            <button
              onClick={() => {
                setShowThankYou(false);
                setMeetingToken(null);
                window.history.pushState({}, '', '/');
              }}
              className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-white font-bold transition-all"
            >
              Cerrar
            </button>
          </div>
          <p className="text-white/30 text-xs mt-8">Powered by Cowork</p>
        </div>
      </div>
    );
  }

  if (meetingToken && inMeeting) {
    return (
      <MeetingRoom
        salaId=""
        tokenInvitacion={meetingToken}
        nombreInvitado={meetingNombre}
        onLeave={() => {
          setInMeeting(false);
          setShowThankYou(true);
        }}
      />
    );
  }

  // Acceso directo a sala de videollamada (URL: /sala/ID)
  if (directSalaId) {
    // Si hay sesión, abrir la sala directamente
    if (session) {
      return (
        <MeetingRoom
          salaId={directSalaId}
          onLeave={() => {
            setDirectSalaId(null);
            sessionStorage.removeItem('pending_sala_id');
            window.history.pushState({}, '', '/');
          }}
        />
      );
    }
    // Si no hay sesión pero está inicializando, mostrar loading
    if (!initialized) {
      return (
        <div className="fixed inset-0 z-[1000] bg-black flex flex-col items-center justify-center gap-6">
          <div className="w-16 h-16 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin"></div>
          <p className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-500">Cargando videollamada...</p>
        </div>
      );
    }
    // Si no hay sesión y ya inicializó, mostrar login
    return <LoginScreen />;
  }

  // Si no hay sesión, siempre mostrar login (el token de invitación se preserva en la URL)
  if (!session) {
    return <LoginScreen />;
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 font-inter selection:bg-indigo-500/30">
      {(!initialized || view === 'loading') && (
        <div className="fixed inset-0 z-[1000] bg-black flex flex-col items-center justify-center gap-6">
           <div className="w-16 h-16 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin"></div>
           <div className="text-center">
             <p className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-500 animate-pulse">Sincronizando Workspace</p>
             <p className="text-[8px] font-bold text-zinc-700 uppercase mt-2">Cargando datos de sesión y mapas...</p>
           </div>
        </div>
      )}
      
      {initialized && view === 'dashboard' && <Dashboard />}
      {initialized && view === 'workspace' && <WorkspaceLayout />}
      {view === 'invitation' && <InvitationProcessor />}
      {view === 'onboarding' && <OnboardingCargoView />}
      {view === 'onboarding_creador' && session && (
        <OnboardingCreador
          userId={session.user.id}
          userEmail={session.user.email || ''}
          userName={session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'Usuario'}
          onComplete={async () => {
            await initialize();
            const workspaces = await fetchWorkspaces();
            const espacioGlobal = workspaces.find(ws => ws.id === ESPACIO_GLOBAL_ID) || workspaces[0];
            if (espacioGlobal) {
              setActiveWorkspace(espacioGlobal, (espacioGlobal as any).userRole);
              setView('workspace');
              return;
            }
            setView('dashboard');
          }}
        />
      )}
    </div>
  );
};

type InvitationState = 'cargando' | 'valido' | 'expirado' | 'usado' | 'error' | 'aceptado';

interface InvitacionInfo {
  email: string;
  rol: string;
  empresa_id: string;
  espacio: { nombre: string; slug: string; id: string };
  invitador: { nombre: string };
}

// Utilidad SHA-256 para hashear tokens en el cliente (Web Crypto API)
const hashToken = async (rawToken: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(rawToken);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
};

const InvitationProcessor: React.FC = () => {
  const [estado, setEstado] = useState<InvitationState>('cargando');
  const [invitacion, setInvitacion] = useState<InvitacionInfo | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [errorLocal, setErrorLocal] = useState('');
  const [tokenHashLocal, setTokenHashLocal] = useState<string>('');
  const { session, setAuthFeedback, setView, theme, fetchWorkspaces } = useStore();

  const token = new URLSearchParams(window.location.search).get('token');

  useEffect(() => {
    if (token) {
      verificarInvitacion();
    } else {
      setEstado('error');
    }
  }, [token]);

  const verificarInvitacion = async () => {
    try {
      // Hashear token en el cliente para buscar por hash (no se envía el plaintext a la BD)
      const tHash = await hashToken(token!);
      setTokenHashLocal(tHash);

      const { data, error } = await supabase
        .from('invitaciones_pendientes')
        .select(`
          email,
          rol,
          empresa_id,
          usada,
          expira_en,
          espacio:espacios_trabajo (id, nombre, slug),
          invitador:usuarios!creada_por (nombre)
        `)
        .eq('token_hash', tHash)
        .single();

      if (error || !data) {
        setEstado('error');
        return;
      }

      if (data.usada) {
        setEstado('usado');
        return;
      }

      if (new Date(data.expira_en) < new Date()) {
        setEstado('expirado');
        return;
      }

      // Validar que el JOIN con espacios_trabajo retornó datos (RLS puede bloquearlo)
      const espacioData = data.espacio as any;
      if (!espacioData || !espacioData.nombre) {
        console.error('InvitationProcessor: espacio data is null (posible RLS)');
        setEstado('error');
        return;
      }

      setInvitacion({
        email: data.email,
        rol: data.rol,
        empresa_id: data.empresa_id,
        espacio: espacioData,
        invitador: { nombre: (data.invitador as any)?.nombre || 'Un colega' }
      });
      setEstado('valido');
    } catch (err) {
      setEstado('error');
    }
  };

  const aceptarInvitacion = async () => {
    if (!token || !invitacion) return;
    setProcesando(true);
    setErrorLocal('');

    try {
      if (session.user.email?.toLowerCase() !== invitacion.email.toLowerCase()) {
        setErrorLocal(`Debes iniciar sesión con ${invitacion.email}`);
        setProcesando(false);
        return;
      }

      const insertPayload = {
          espacio_id: invitacion.espacio.id,
          usuario_id: session.user.id,
          rol: invitacion.rol,
          aceptado: true,
          aceptado_en: new Date().toISOString(),
          empresa_id: invitacion.empresa_id
        };
      console.log('[INVITATION] Insert payload:', JSON.stringify(insertPayload));
      const { error: insertError } = await supabase
        .from('miembros_espacio')
        .insert(insertPayload);

      if (insertError) {
        if (insertError.code !== '23505') throw insertError;
      }

      await supabase
        .from('invitaciones_pendientes')
        .update({ usada: true })
        .eq('token_hash', tokenHashLocal);

      setEstado('aceptado');
      
      // Limpiar token de la URL por seguridad
      window.history.replaceState({}, '', window.location.pathname);

      // Actualizar lista de workspaces para evitar redirect a "Crear Espacio"
      await fetchWorkspaces();

      setTimeout(() => {
        setAuthFeedback({ type: 'success', message: `¡Bienvenido a ${invitacion.espacio.nombre}!` });
        setView('onboarding');
      }, 2000);
    } catch (err: any) {
      setErrorLocal(err.message || 'Error al aceptar invitación');
    } finally {
      setProcesando(false);
    }
  };

  const isArcade = theme === 'arcade';

  return (
    <div className="fixed inset-0 flex items-center justify-center p-6 bg-[#050508]">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(139,92,246,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(139,92,246,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gradient-to-br from-violet-600/10 via-fuchsia-600/5 to-transparent blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-gradient-to-tr from-cyan-600/10 via-violet-600/5 to-transparent blur-[100px] rounded-full pointer-events-none" />

      <div className="w-full max-w-md lg:max-w-sm relative z-10">
        <div className="absolute -inset-1 bg-gradient-to-r from-violet-600/20 via-fuchsia-600/20 to-cyan-500/20 rounded-[40px] lg:rounded-[32px] blur-xl opacity-60" />
        <div className="relative backdrop-blur-xl bg-white/[0.03] border border-white/[0.08] rounded-[36px] lg:rounded-[28px] p-7 lg:p-5 text-center">
        
        {estado === 'cargando' && (
          <div className="space-y-4">
            <div className="w-12 h-12 border-3 border-violet-500/30 border-t-violet-500 rounded-full animate-spin mx-auto"></div>
            <h1 className="text-lg lg:text-base font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-violet-200 to-white uppercase tracking-widest">Verificando...</h1>
          </div>
        )}

        {estado === 'error' && (
          <div className="space-y-4">
            <div className="text-4xl">❌</div>
            <h1 className="text-lg lg:text-base font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-violet-200 to-white">Invitación no válida</h1>
            <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">El enlace es inválido o ha sido eliminado.</p>
            <button onClick={() => setView('dashboard')} className="w-full py-3 lg:py-2.5 bg-white/[0.03] border border-white/[0.08] rounded-xl font-black uppercase tracking-widest text-[10px] text-zinc-400 hover:border-violet-500/30 transition-all">Ir al Inicio</button>
          </div>
        )}

        {estado === 'expirado' && (
          <div className="space-y-4">
            <div className="text-4xl">⏰</div>
            <h1 className="text-lg lg:text-base font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-violet-200 to-white">Invitación expirada</h1>
            <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">Esta invitación ha caducado. Solicita una nueva.</p>
            <button onClick={() => setView('dashboard')} className="w-full py-3 lg:py-2.5 bg-white/[0.03] border border-white/[0.08] rounded-xl font-black uppercase tracking-widest text-[10px] text-zinc-400 hover:border-violet-500/30 transition-all">Cerrar</button>
          </div>
        )}

        {estado === 'usado' && (
          <div className="space-y-4">
            <div className="text-4xl">✅</div>
            <h1 className="text-lg lg:text-base font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-violet-200 to-white">Invitación ya utilizada</h1>
            <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">Ya eres parte de este equipo o el token ya fue canjeado.</p>
            <button onClick={() => setView('dashboard')} className="relative w-full group overflow-hidden bg-gradient-to-r from-violet-600 via-fuchsia-600 to-cyan-500 text-white py-3 lg:py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all shadow-2xl shadow-violet-600/30 active:scale-[0.98]">
              <span className="absolute inset-0 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <span className="relative">Ir a mi Workspace</span>
            </button>
          </div>
        )}

        {estado === 'valido' && invitacion && (
          <div className="space-y-5">
            <div className="text-4xl animate-bounce">🎉</div>
            <div className="space-y-1">
              <h1 className="text-xl lg:text-lg font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-violet-200 to-white">¡Te han invitado!</h1>
              <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">
                <span className="text-violet-400">{invitacion.invitador.nombre}</span> te invita a unirte a:
              </p>
            </div>
            
            <div className="p-5 lg:p-4 rounded-xl bg-black/40 border border-white/5">
              <h2 className="text-lg lg:text-base font-black text-white">{invitacion.espacio.nombre}</h2>
              <p className="text-[9px] font-black uppercase tracking-widest text-violet-400 mt-1">Rol: {invitacion.rol}</p>
            </div>

            {errorLocal && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-black uppercase tracking-widest">
                {errorLocal}
              </div>
            )}

            <button
              onClick={aceptarInvitacion}
              disabled={procesando}
              className="relative w-full group overflow-hidden bg-gradient-to-r from-violet-600 via-fuchsia-600 to-cyan-500 text-white py-3.5 lg:py-3 rounded-xl font-black text-xs lg:text-[10px] uppercase tracking-[0.15em] transition-all shadow-2xl shadow-violet-600/30 active:scale-[0.98] disabled:opacity-50"
            >
              <span className="absolute inset-0 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <span className="relative">
                {procesando ? 'Procesando...' : 'Aceptar invitación'}
              </span>
            </button>
          </div>
        )}

        {estado === 'aceptado' && (
          <div className="space-y-4">
            <div className="relative mx-auto w-14 h-14 lg:w-12 lg:h-12">
              <div className="absolute -inset-2 bg-gradient-to-r from-emerald-500 to-cyan-500 rounded-full blur-xl opacity-50 animate-pulse" />
              <div className="relative w-14 h-14 lg:w-12 lg:h-12 bg-gradient-to-br from-emerald-500 to-cyan-500 rounded-full flex items-center justify-center">
                <span className="text-2xl">🎊</span>
              </div>
            </div>
            <h1 className="text-xl lg:text-lg font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400">¡Bienvenido al equipo!</h1>
            <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">Redirigiendo a configurar tu perfil...</p>
            <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        )}
        </div>
      </div>
    </div>
  );
};

// Tipo para departamento
interface Departamento {
  id: string;
  nombre: string;
  color: string;
  icono: string;
}

// Componente de Onboarding para selección de cargo y departamento
interface OnboardingCargoState {
  isLoading: boolean;
  error: string | null;
  espacioNombre: string;
  espacioId: string | null;
  cargoSugerido: CargoLaboral | null;
  miembroId: string | null;
  departamentos: Departamento[];
  cargosDB: CargoDB[];
  paso: 'bienvenida' | 'cargo' | 'departamento';
  cargoSeleccionado: CargoLaboral | null;
  rolSistema: string;
  invitadorNombre: string;
}

const OnboardingCargoView: React.FC = () => {
  const { session, setView, setAuthFeedback, fetchWorkspaces } = useStore();
  const [state, setState] = useState<OnboardingCargoState>({
    isLoading: true,
    error: null,
    espacioNombre: 'tu espacio',
    espacioId: null,
    cargoSugerido: null,
    miembroId: null,
    departamentos: [],
    cargosDB: [],
    paso: 'bienvenida',
    cargoSeleccionado: null,
    rolSistema: 'member',
    invitadorNombre: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    verificarMiembro();
  }, [session]);

  const verificarMiembro = async () => {
    if (!session?.user?.id) {
      setState(prev => ({ ...prev, isLoading: false, error: 'No hay sesión activa' }));
      return;
    }

    try {
      // Buscar membresía del usuario (incluye ROL del sistema)
      const { data: miembro, error } = await supabase
        .from('miembros_espacio')
        .select(`
          id,
          cargo,
          rol,
          espacio_id,
          onboarding_completado,
          espacios_trabajo:espacio_id (nombre)
        `)
        .eq('usuario_id', session.user.id)
        .eq('aceptado', true)
        .eq('onboarding_completado', false)
        .order('aceptado_en', { ascending: false, nullsFirst: false })
        .limit(1)
        .single();

      if (error || !miembro) {
        setState(prev => ({ ...prev, isLoading: false, error: 'No se encontró membresía' }));
        return;
      }

      // Si ya completó onboarding, ir al dashboard
      if (miembro.onboarding_completado) {
        setView('dashboard');
        return;
      }

      // Buscar departamentos del espacio
      const { data: departamentosData } = await supabase
        .from('departamentos')
        .select('id, nombre, color, icono')
        .eq('espacio_id', miembro.espacio_id)
        .order('nombre');

      // Buscar cargos del espacio desde BD
      const { data: cargosData } = await supabase
        .from('cargos')
        .select('id, nombre, descripcion, categoria, icono, orden, activo, tiene_analisis_avanzado, analisis_disponibles, solo_admin')
        .eq('espacio_id', miembro.espacio_id)
        .eq('activo', true)
        .order('orden');

      // Buscar cargo sugerido e invitador
      const { data: invitacion } = await supabase
        .from('invitaciones_pendientes')
        .select('cargo_sugerido, creada_por, invitador:usuarios!creada_por(nombre)')
        .eq('email', session.user.email)
        .eq('usada', true)
        .order('expira_en', { ascending: false })
        .limit(1)
        .maybeSingle();

      const espacioData = miembro.espacios_trabajo as any;
      const invitadorData = invitacion?.invitador as any;
      setState({
        isLoading: false,
        error: null,
        espacioNombre: espacioData?.nombre || 'tu espacio',
        espacioId: miembro.espacio_id,
        cargoSugerido: invitacion?.cargo_sugerido || null,
        miembroId: miembro.id,
        departamentos: departamentosData || [],
        cargosDB: (cargosData || []) as CargoDB[],
        paso: 'bienvenida',
        cargoSeleccionado: null,
        rolSistema: (miembro as any).rol || 'member',
        invitadorNombre: invitadorData?.nombre || '',
      });
    } catch (err) {
      console.error('Error verificando miembro:', err);
      setState(prev => ({ ...prev, isLoading: false, error: 'Error al cargar datos' }));
    }
  };

  const handleSelectCargo = async (cargo: CargoLaboral) => {
    // Si no hay departamentos, guardar cargo directamente y completar onboarding
    if (state.departamentos.length === 0) {
      if (!state.miembroId) return;
      setSaving(true);
      try {
        const { error } = await supabase
          .from('miembros_espacio')
          .update({
            cargo: cargo,
            onboarding_completado: true,
          })
          .eq('id', state.miembroId);
        if (error) throw error;
        await fetchWorkspaces();
        setAuthFeedback({ type: 'success', message: '¡Perfil configurado!' });
        setView('dashboard');
      } catch (err) {
        console.error('Error guardando cargo:', err);
        setState(prev => ({ ...prev, error: 'Error al guardar' }));
      } finally {
        setSaving(false);
      }
      return;
    }
    // Si hay departamentos, pasar al paso de selección
    setState(prev => ({ ...prev, cargoSeleccionado: cargo, paso: 'departamento' }));
  };

  const handleSelectDepartamento = async (departamentoId: string) => {
    if (!state.miembroId || !state.cargoSeleccionado) return;
    setSaving(true);

    try {
      const { error } = await supabase
        .from('miembros_espacio')
        .update({
          cargo_id: state.cargoSeleccionado,
          departamento_id: departamentoId,
          onboarding_completado: true,
        })
        .eq('id', state.miembroId);

      if (error) throw error;

      const deptNombre = state.departamentos.find(d => d.id === departamentoId)?.nombre || '';
      await fetchWorkspaces();
      setAuthFeedback({ type: 'success', message: `¡Perfil configurado! ${deptNombre}` });
      setView('dashboard');
    } catch (err) {
      console.error('Error guardando:', err);
      setState(prev => ({ ...prev, error: 'Error al guardar' }));
    } finally {
      setSaving(false);
    }
  };

  const handleBack = () => {
    setState(prev => ({ ...prev, paso: 'cargo', cargoSeleccionado: null }));
  };

  if (state.isLoading) {
    return (
      <div className="fixed inset-0 bg-[#050508] flex items-center justify-center">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(139,92,246,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(139,92,246,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />
        <div className="text-center relative z-10">
          <div className="w-10 h-10 border-3 border-violet-500/30 border-t-violet-500 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest">Cargando...</p>
        </div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="fixed inset-0 bg-[#050508] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(139,92,246,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(139,92,246,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />
        <div className="relative z-10 bg-red-500/10 border border-red-500/30 rounded-xl p-5 max-w-sm text-center">
          <p className="text-red-400 text-sm mb-4">{state.error}</p>
          <button
            onClick={() => setView('dashboard')}
            className="px-5 py-2.5 bg-red-500 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-red-600 transition-colors"
          >
            Ir al inicio
          </button>
        </div>
      </div>
    );
  }

  const esAdmin = state.rolSistema === 'admin' || state.rolSistema === 'super_admin';

  // Paso 0: Bienvenida diferenciada por rol
  if (state.paso === 'bienvenida') {
    return (
      <div className="fixed inset-0 bg-[#050508] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(139,92,246,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(139,92,246,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gradient-to-br from-violet-600/10 via-fuchsia-600/5 to-transparent blur-[120px] rounded-full pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-gradient-to-tr from-cyan-600/10 via-violet-600/5 to-transparent blur-[100px] rounded-full pointer-events-none" />

        <div className="w-full max-w-md lg:max-w-sm text-center relative z-10">
          <div className="absolute -inset-1 bg-gradient-to-r from-violet-600/20 via-fuchsia-600/20 to-cyan-500/20 rounded-[40px] lg:rounded-[32px] blur-xl opacity-60" />
          <div className="relative backdrop-blur-xl bg-white/[0.03] border border-white/[0.08] rounded-[36px] lg:rounded-[28px] p-6 lg:p-5">

            <div className="relative group mx-auto w-14 h-14 lg:w-12 lg:h-12 mb-4">
              <div className={`absolute -inset-2 rounded-xl blur-lg opacity-40 ${
                esAdmin ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600' : 'bg-gradient-to-r from-cyan-500 to-violet-600'
              }`} />
              <div className={`relative w-14 h-14 lg:w-12 lg:h-12 rounded-xl flex items-center justify-center ${
                esAdmin ? 'bg-gradient-to-br from-violet-600 via-fuchsia-600 to-cyan-500' : 'bg-gradient-to-br from-cyan-500 via-violet-600 to-fuchsia-600'
              }`}>
                <span className="text-2xl lg:text-xl">{esAdmin ? '\u{1F451}' : '\u{1F44B}'}</span>
              </div>
            </div>

            <h1 className="text-2xl lg:text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-violet-200 to-white mb-2">
              {esAdmin
                ? `¡Bienvenido como ${state.rolSistema === 'super_admin' ? 'Super Admin' : 'Admin'}!`
                : '¡Bienvenido al equipo!'
              }
            </h1>

            <p className="text-zinc-500 text-xs lg:text-[10px] mb-4">
              Te uniste a <span className="text-violet-400 font-medium">{state.espacioNombre}</span>
              {state.invitadorNombre && (
                <span> por invitación de <span className="text-fuchsia-400 font-medium">{state.invitadorNombre}</span></span>
              )}
            </p>

            {esAdmin ? (
              <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-4 lg:p-3 text-left mb-4">
                <h3 className="text-violet-400 font-black text-[10px] uppercase tracking-widest mb-2">Como administrador podrás:</h3>
                <ul className="space-y-1.5 text-[11px] lg:text-[10px] text-zinc-400">
                  <li className="flex items-center gap-2"><span className="text-violet-400">✓</span> Invitar y gestionar miembros del equipo</li>
                  <li className="flex items-center gap-2"><span className="text-violet-400">✓</span> Configurar métricas de análisis conductual</li>
                  <li className="flex items-center gap-2"><span className="text-violet-400">✓</span> Administrar departamentos y roles</li>
                  <li className="flex items-center gap-2"><span className="text-violet-400">✓</span> Acceder a configuraciones avanzadas del espacio</li>
                </ul>
              </div>
            ) : (
              <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-4 lg:p-3 text-left mb-4">
                <h3 className="text-cyan-400 font-black text-[10px] uppercase tracking-widest mb-2">En tu espacio podrás:</h3>
                <ul className="space-y-1.5 text-[11px] lg:text-[10px] text-zinc-400">
                  <li className="flex items-center gap-2"><span className="text-cyan-400">✓</span> Colaborar en el espacio virtual 3D</li>
                  <li className="flex items-center gap-2"><span className="text-cyan-400">✓</span> Participar en reuniones con análisis inteligente</li>
                  <li className="flex items-center gap-2"><span className="text-cyan-400">✓</span> Gestionar tareas y comunicarte con tu equipo</li>
                  <li className="flex items-center gap-2"><span className="text-cyan-400">✓</span> Personalizar tu avatar y experiencia</li>
                </ul>
              </div>
            )}

            <p className="text-zinc-600 text-[10px] lg:text-[9px] mb-4">
              Primero, cuéntanos cuál es tu cargo para personalizar tu experiencia.
            </p>

            <button
              onClick={() => setState(prev => ({ ...prev, paso: 'cargo' }))}
              className="relative w-full group overflow-hidden bg-gradient-to-r from-violet-600 via-fuchsia-600 to-cyan-500 text-white py-3 lg:py-2.5 rounded-xl font-black text-xs lg:text-[10px] uppercase tracking-[0.15em] transition-all shadow-2xl shadow-violet-600/30 active:scale-[0.98]"
            >
              <span className="absolute inset-0 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <span className="relative flex items-center justify-center gap-2">
                Continuar
                <svg className="w-4 h-4 lg:w-3.5 lg:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
              </span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Paso 1: Selección de cargo (filtrado por rol del sistema)
  if (state.paso === 'cargo') {
    return (
      <CargoSelector
        onSelect={handleSelectCargo}
        cargoSugerido={state.cargoSugerido || undefined}
        espacioNombre={state.espacioNombre}
        isLoading={saving}
        rolUsuario={state.rolSistema}
        cargosDB={state.cargosDB}
      />
    );
  }

  // Paso 2: Selección de departamento
  return (
    <div className="fixed inset-0 bg-[#050508] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(139,92,246,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(139,92,246,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gradient-to-br from-violet-600/10 via-fuchsia-600/5 to-transparent blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-gradient-to-tr from-cyan-600/10 via-violet-600/5 to-transparent blur-[100px] rounded-full pointer-events-none" />

      <div className="w-full max-w-xl lg:max-w-lg relative z-10">
        {/* Header */}
        <div className="text-center mb-6 lg:mb-5">
          <button
            onClick={handleBack}
            className="mb-3 text-zinc-500 hover:text-violet-400 flex items-center gap-1.5 mx-auto text-[10px] font-bold uppercase tracking-widest transition-colors"
          >
            ← Volver a selección de cargo
          </button>
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-gradient-to-r from-violet-600/20 to-fuchsia-600/20 border border-violet-500/30 rounded-full text-violet-400 text-[9px] font-bold uppercase tracking-wider mb-3">
            Paso 2 de 2
          </div>
          <h1 className="text-2xl lg:text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-violet-200 to-white mb-1">¿A qué departamento perteneces?</h1>
          <p className="text-zinc-500 text-xs lg:text-[10px]">
            Selecciona tu departamento en <span className="text-violet-400 font-medium">{state.espacioNombre}</span>
          </p>
        </div>

        {/* Grid de departamentos */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 lg:gap-2.5">
          {state.departamentos.map((dept) => (
            <button
              key={dept.id}
              onClick={() => handleSelectDepartamento(dept.id)}
              disabled={saving}
              className="group p-4 lg:p-3 rounded-xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-xl hover:border-violet-500/40 transition-all duration-200 text-left disabled:opacity-50"
            >
              <div 
                className="w-10 h-10 lg:w-9 lg:h-9 rounded-lg flex items-center justify-center mb-3 lg:mb-2 text-xl lg:text-lg"
                style={{ backgroundColor: dept.color + '20' }}
              >
                {dept.icono === 'users' && '👥'}
                {dept.icono === 'code' && '💻'}
                {dept.icono === 'palette' && '🎨'}
                {dept.icono === 'megaphone' && '📣'}
                {dept.icono === 'headphones' && '🎧'}
                {dept.icono === 'trending-up' && '📈'}
              </div>
              <h3 className="text-sm lg:text-xs font-bold text-white group-hover:text-violet-400 transition-colors">
                {dept.nombre}
              </h3>
              <div 
                className="w-6 h-0.5 rounded-full mt-1.5"
                style={{ backgroundColor: dept.color }}
              />
            </button>
          ))}
        </div>

        {saving && (
          <div className="mt-4 text-center">
            <div className="w-5 h-5 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin mx-auto" />
            <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest mt-2">Guardando...</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
