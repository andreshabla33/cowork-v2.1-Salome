'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Building2, 
  Users, 
  ArrowRight, 
  Check,
  Sparkles,
  Mail,
  X,
  Plus
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useStore } from '@/store/useStore';
import { CargoSelector } from './CargoSelector';
import type { CargoLaboral, CargoDB } from './CargoSelector';

const INDUSTRIAS = [
  'Tecnología', 'Finanzas', 'Salud', 'Educación', 'Comercio',
  'Manufactura', 'Servicios', 'Consultoría', 'Marketing',
  'Inmobiliaria', 'Legal', 'Energía', 'Transporte', 'Otro',
];

const TAMANOS = [
  { value: 'startup', label: 'Startup (1-10)' },
  { value: 'pequena', label: 'Pequeña (11-50)' },
  { value: 'mediana', label: 'Mediana (51-200)' },
  { value: 'grande', label: 'Grande (201-1000)' },
  { value: 'enterprise', label: 'Enterprise (1000+)' },
];

interface OnboardingCreadorProps {
  userId: string;
  userEmail: string;
  userName: string;
  onComplete: () => void;
}

type Paso = 'bienvenida' | 'empresa' | 'cargo' | 'invitar' | 'completado';

const ESPACIO_GLOBAL = {
  id: '91887e81-1f26-448c-9d6d-9839e7d83b5d',
  nombre: 'kronos'
};

export const OnboardingCreador: React.FC<OnboardingCreadorProps> = ({
  userId,
  userEmail,
  userName,
  onComplete
}) => {
  const { fetchWorkspaces } = useStore();
  const [paso, setPaso] = useState<Paso>('bienvenida');
  const [cargoSeleccionado, setCargoSeleccionado] = useState<CargoLaboral | null>(null);
  const [invitaciones, setInvitaciones] = useState<string[]>(['']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [espacioCreado, setEspacioCreado] = useState<{ id: string; nombre: string } | null>(ESPACIO_GLOBAL);
  const [cargosDB, setCargosDB] = useState<CargoDB[]>([]);
  const [miembroId, setMiembroId] = useState<string | null>(null);
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [empresaData, setEmpresaData] = useState({
    nombre: '',
    industria: '',
    tamano: 'pequena',
    sitio_web: '',
  });

  const handleSelectCargo = async (cargo: CargoLaboral) => {
    setLoading(true);
    setError(null);
    try {
      // Resolver miembroId si no existe (fix: cargo se queda cargando cuando miembroId es null)
      let targetMiembroId = miembroId;
      if (!targetMiembroId && espacioCreado) {
        const { data: miembroData } = await supabase
          .from('miembros_espacio')
          .select('id')
          .eq('espacio_id', espacioCreado.id)
          .eq('usuario_id', userId)
          .maybeSingle();
        if (miembroData?.id) {
          targetMiembroId = miembroData.id;
          setMiembroId(miembroData.id);
        }
      }

      if (!targetMiembroId) {
        throw new Error('No se encontró tu membresía. Intenta recargar la página.');
      }

      const { error: updateError } = await supabase
        .from('miembros_espacio')
        .update({ cargo_id: cargo })
        .eq('id', targetMiembroId);
      if (updateError) throw updateError;
      await fetchWorkspaces();
      setCargoSeleccionado(cargo);
      setPaso('invitar');
    } catch (err: any) {
      console.error('Error guardando cargo:', err);
      setError(err.message || 'Error al guardar cargo');
    } finally {
      setLoading(false);
    }
  };

  const completarOnboarding = async () => {
    if (!espacioCreado) {
      throw new Error('Espacio global no disponible');
    }

    let targetMiembroId = miembroId;

    if (!targetMiembroId) {
      const { data: miembroData, error: miembroError } = await supabase
        .from('miembros_espacio')
        .select('id')
        .eq('espacio_id', espacioCreado.id)
        .eq('usuario_id', userId)
        .maybeSingle();

      if (miembroError) throw miembroError;
      if (miembroData?.id) {
        targetMiembroId = miembroData.id;
        setMiembroId(miembroData.id);
      }
    }

    if (!targetMiembroId) {
      throw new Error('No se encontró la membresía');
    }

    const { error: updateError } = await supabase
      .from('miembros_espacio')
      .update({ onboarding_completado: true })
      .eq('id', targetMiembroId);

    if (updateError) throw updateError;
  };

  const finalizarOnboarding = async () => {
    try {
      await completarOnboarding();
    } catch (err) {
      console.warn('⚠️ Onboarding: Error en completarOnboarding (continuando):', err);
    }
    setPaso('completado');
    // Timeout de seguridad: si onComplete tarda más de 8s, forzar redirección
    const safeTimeout = setTimeout(() => {
      console.warn('⚠️ Onboarding: onComplete tardó demasiado, forzando redirección');
      onComplete();
    }, 8000);
    setTimeout(async () => {
      try {
        await onComplete();
      } catch (err) {
        console.error('❌ Error en onComplete:', err);
        onComplete(); // Forzar redirección aunque falle
      } finally {
        clearTimeout(safeTimeout);
      }
    }, 2000);
  };

  const handleGuardarEmpresa = async () => {
    setLoading(true);
    setError(null);
    try {
      if (!espacioCreado) {
        throw new Error('Espacio global no disponible');
      }
      if (empresaData.nombre.trim()) {
        const payload = {
          nombre: empresaData.nombre.trim(),
          industria: empresaData.industria || null,
          tamano: empresaData.tamano,
          sitio_web: empresaData.sitio_web.trim() || null,
          actualizado_en: new Date().toISOString(),
          espacio_id: espacioCreado.id,
        };

        let empresaActualId = empresaId;

        if (empresaId) {
          const { error: updateError } = await supabase
            .from('empresas')
            .update(payload)
            .eq('id', empresaId);
          if (updateError) throw updateError;
        } else {
          const { data: nuevaEmpresa, error: createError } = await supabase
            .from('empresas')
            .insert({
              ...payload,
              creado_por: userId,
            })
            .select()
            .single();
          if (createError) throw createError;
          empresaActualId = nuevaEmpresa.id;
          setEmpresaId(nuevaEmpresa.id);
        }

        const { data: miembroExistente, error: miembroExistenteError } = await supabase
          .from('miembros_espacio')
          .select('id, empresa_id')
          .eq('espacio_id', espacioCreado.id)
          .eq('usuario_id', userId)
          .maybeSingle();

        if (miembroExistenteError) throw miembroExistenteError;

        if (miembroExistente) {
          setMiembroId(miembroExistente.id);
          if (empresaActualId && miembroExistente.empresa_id !== empresaActualId) {
            const { error: updateMiembroError } = await supabase
              .from('miembros_espacio')
              .update({ empresa_id: empresaActualId })
              .eq('id', miembroExistente.id);
            if (updateMiembroError) throw updateMiembroError;
          }
        } else if (empresaActualId) {
          const { data: miembroData, error: miembroError } = await supabase
            .from('miembros_espacio')
            .insert({
              espacio_id: espacioCreado.id,
              usuario_id: userId,
              rol: 'super_admin',
              aceptado: true,
              onboarding_completado: false,
              empresa_id: empresaActualId,
            })
            .select('id')
            .single();

          if (miembroError) throw miembroError;
          setMiembroId(miembroData.id);
        }

        const { data: cargosData } = await supabase
          .from('cargos')
          .select('id, nombre, descripcion, categoria, icono, orden, activo, tiene_analisis_avanzado, analisis_disponibles, solo_admin')
          .eq('espacio_id', espacioCreado.id)
          .eq('activo', true)
          .order('orden');

        await fetchWorkspaces();
        setCargosDB((cargosData || []) as CargoDB[]);
      }
      setPaso('cargo');
    } catch (err: any) {
      console.error('Error guardando empresa:', err);
      setError(err.message || 'Error al guardar empresa');
    } finally {
      setLoading(false);
    }
  };

  const handleAddEmail = () => {
    setInvitaciones([...invitaciones, '']);
  };

  const handleRemoveEmail = (index: number) => {
    setInvitaciones(invitaciones.filter((_, i) => i !== index));
  };

  const handleEmailChange = (index: number, value: string) => {
    const updated = [...invitaciones];
    updated[index] = value;
    setInvitaciones(updated);
  };

  const handleEnviarInvitaciones = async () => {
    const emailsValidos = invitaciones.filter(e => e.trim() && e.includes('@'));
    
    if (emailsValidos.length === 0) {
      setLoading(true);
      setError(null);
      try {
        await finalizarOnboarding();
      } catch (err: any) {
        console.error('Error completando onboarding:', err);
        setError(err.message || 'Error al completar el onboarding');
      } finally {
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Enviar invitaciones usando la Edge Function
      for (const email of emailsValidos) {
        const { data, error: fnError } = await supabase.functions.invoke('enviar-invitacion', {
          body: {
            email,
            espacio_id: espacioCreado!.id,
            rol: 'miembro',
            invitador_id: userId
          }
        });

        if (fnError) throw new Error(fnError.message || 'Error al enviar la invitación');
        if (data?.error) throw new Error(data.error);
      }

      await finalizarOnboarding();
    } catch (err: any) {
      console.error('Error enviando invitaciones:', err);
      setError('Error al enviar algunas invitaciones');
    } finally {
      setLoading(false);
    }
  };

  const handleSkipInvitaciones = () => {
    setLoading(true);
    setError(null);
    finalizarOnboarding()
      .catch((err: any) => {
        console.error('Error completando onboarding:', err);
        setError(err.message || 'Error al completar el onboarding');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  return (
    <div className="fixed inset-0 bg-[#050508] flex items-center justify-center p-4 lg:p-3 overflow-y-auto min-h-0">
      {/* Fondo con gradientes neon animados - mismo estilo que login */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-30%] left-[-20%] w-[70%] h-[70%] rounded-full bg-violet-600/15 blur-[180px] animate-pulse" />
        <div className="absolute bottom-[-30%] right-[-20%] w-[70%] h-[70%] rounded-full bg-cyan-500/10 blur-[180px] animate-pulse" style={{ animationDelay: '1.5s' }} />
        <div className="absolute top-[40%] left-[50%] w-[40%] h-[40%] rounded-full bg-fuchsia-600/10 blur-[120px] animate-pulse" style={{ animationDelay: '3s' }} />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />
      </div>

      <AnimatePresence mode="wait">
        {/* PASO: Bienvenida - Compacto */}
        {paso === 'bienvenida' && (
          <motion.div
            key="bienvenida"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="w-full max-w-md lg:max-w-sm text-center relative z-10"
          >
            <div className="mb-6 lg:mb-5">
              {/* Logo con glow neon */}
              <div className="relative group mx-auto w-14 h-14 lg:w-12 lg:h-12 mb-4 lg:mb-3">
                <div className="absolute -inset-2 bg-gradient-to-r from-violet-600 to-cyan-500 rounded-xl blur-lg opacity-40 group-hover:opacity-60 transition-opacity duration-500" />
                <div className="relative w-14 h-14 lg:w-12 lg:h-12 bg-gradient-to-br from-violet-600 via-fuchsia-600 to-cyan-500 rounded-xl flex items-center justify-center shadow-2xl">
                  <Sparkles className="w-7 h-7 lg:w-6 lg:h-6 text-white" />
                </div>
              </div>
              <h1 className="text-2xl lg:text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-violet-200 to-white mb-2">
                ¡Bienvenido, {userName.split(' ')[0]}!
              </h1>
              <p className="text-sm lg:text-xs text-zinc-400">
                Vamos a configurar tu empresa en el espacio global kronos
              </p>
            </div>

            <div className="space-y-2 lg:space-y-1.5 mb-6 lg:mb-5">
              <div className="flex items-center gap-3 lg:gap-2 p-3 lg:p-2.5 backdrop-blur-xl bg-white/[0.03] border border-white/[0.08] rounded-xl lg:rounded-lg group hover:border-violet-500/30 transition-all">
                <div className="w-8 h-8 lg:w-7 lg:h-7 bg-gradient-to-br from-violet-600/20 to-fuchsia-600/20 rounded-lg flex items-center justify-center border border-violet-500/20">
                  <span className="text-violet-400 font-black text-sm lg:text-xs">1</span>
                </div>
                <span className="text-zinc-300 font-medium text-sm lg:text-xs">Datos de tu empresa</span>
              </div>
              <div className="flex items-center gap-3 lg:gap-2 p-3 lg:p-2.5 backdrop-blur-xl bg-white/[0.03] border border-white/[0.08] rounded-xl lg:rounded-lg group hover:border-violet-500/30 transition-all">
                <div className="w-8 h-8 lg:w-7 lg:h-7 bg-gradient-to-br from-violet-600/20 to-fuchsia-600/20 rounded-lg flex items-center justify-center border border-violet-500/20">
                  <span className="text-violet-400 font-black text-sm lg:text-xs">2</span>
                </div>
                <span className="text-zinc-300 font-medium text-sm lg:text-xs">Selecciona tu cargo</span>
              </div>
              <div className="flex items-center gap-3 lg:gap-2 p-3 lg:p-2.5 backdrop-blur-xl bg-white/[0.03] border border-white/[0.08] rounded-xl lg:rounded-lg group hover:border-violet-500/30 transition-all">
                <div className="w-8 h-8 lg:w-7 lg:h-7 bg-gradient-to-br from-violet-600/20 to-fuchsia-600/20 rounded-lg flex items-center justify-center border border-violet-500/20">
                  <span className="text-violet-400 font-black text-sm lg:text-xs">3</span>
                </div>
                <span className="text-zinc-300 font-medium text-sm lg:text-xs">Invita a tu equipo</span>
              </div>
            </div>

            <button
              onClick={() => setPaso('empresa')}
              className="relative w-full group overflow-hidden bg-gradient-to-r from-violet-600 via-fuchsia-600 to-cyan-500 text-white py-3 lg:py-2.5 rounded-xl font-black text-xs lg:text-[10px] uppercase tracking-wider transition-all shadow-2xl shadow-violet-600/30 active:scale-[0.98]"
            >
              <span className="absolute inset-0 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <span className="relative flex items-center justify-center gap-2">
                Comenzar
                <ArrowRight className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
              </span>
            </button>
          </motion.div>
        )}

        {/* PASO: Datos de Empresa */}
        {paso === 'empresa' && (
          <motion.div
            key="empresa"
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -100 }}
            className="w-full max-w-md lg:max-w-sm relative z-10"
          >
            <div className="absolute -inset-1 bg-gradient-to-r from-fuchsia-600/20 via-violet-600/20 to-cyan-500/20 rounded-[40px] lg:rounded-[32px] blur-xl opacity-60" />
            <div className="relative backdrop-blur-xl bg-white/[0.03] border border-white/[0.08] rounded-[36px] lg:rounded-[28px] p-6 lg:p-5">
              <div className="text-center mb-6 lg:mb-5">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-gradient-to-r from-violet-600/20 to-fuchsia-600/20 border border-violet-500/30 rounded-full text-violet-400 text-[9px] lg:text-[8px] font-bold uppercase tracking-wider mb-3">
                  Paso 1 de 3
                </div>
                <div className="relative group mx-auto w-12 h-12 lg:w-10 lg:h-10 mb-3">
                  <div className="absolute -inset-2 bg-gradient-to-r from-fuchsia-500 to-violet-500 rounded-xl blur-lg opacity-40" />
                  <div className="relative w-12 h-12 lg:w-10 lg:h-10 bg-gradient-to-br from-fuchsia-500 to-violet-600 rounded-xl flex items-center justify-center">
                    <Building2 className="w-6 h-6 lg:w-5 lg:h-5 text-white" />
                  </div>
                </div>
                <h2 className="text-2xl lg:text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-fuchsia-200 to-white mb-1">Datos de tu empresa</h2>
                <p className="text-zinc-500 text-xs lg:text-[10px]">
                  Vincula tu organización a <span className="text-violet-400 font-medium">{espacioCreado?.nombre}</span>
                </p>
              </div>

              <div className="space-y-3 lg:space-y-2.5 mb-5 lg:mb-4">
                <div>
                  <label className="block text-xs lg:text-[10px] font-medium text-zinc-400 mb-1.5">Nombre de la empresa *</label>
                  <input
                    type="text"
                    value={empresaData.nombre}
                    onChange={(e) => setEmpresaData({ ...empresaData, nombre: e.target.value })}
                    placeholder="Mi Empresa S.A.S."
                    className="w-full px-4 py-3.5 lg:py-3 bg-black/40 border border-white/5 rounded-xl text-sm lg:text-xs text-white placeholder-zinc-700 focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20 outline-none transition-all"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs lg:text-[10px] font-medium text-zinc-400 mb-1.5">Industria</label>
                    <select
                      value={empresaData.industria}
                      onChange={(e) => setEmpresaData({ ...empresaData, industria: e.target.value })}
                      className="w-full px-3 py-3.5 lg:py-3 bg-black/40 border border-white/5 rounded-xl text-sm lg:text-xs text-white focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20 outline-none transition-all"
                    >
                      <option value="">Seleccionar...</option>
                      {INDUSTRIAS.map(i => (
                        <option key={i} value={i}>{i}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs lg:text-[10px] font-medium text-zinc-400 mb-1.5">Tamaño</label>
                    <select
                      value={empresaData.tamano}
                      onChange={(e) => setEmpresaData({ ...empresaData, tamano: e.target.value })}
                      className="w-full px-3 py-3.5 lg:py-3 bg-black/40 border border-white/5 rounded-xl text-sm lg:text-xs text-white focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20 outline-none transition-all"
                    >
                      {TAMANOS.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs lg:text-[10px] font-medium text-zinc-400 mb-1.5">Sitio web (opcional)</label>
                  <input
                    type="url"
                    value={empresaData.sitio_web}
                    onChange={(e) => setEmpresaData({ ...empresaData, sitio_web: e.target.value })}
                    placeholder="https://miempresa.com"
                    className="w-full px-4 py-3.5 lg:py-3 bg-black/40 border border-white/5 rounded-xl text-sm lg:text-xs text-white placeholder-zinc-700 focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20 outline-none transition-all"
                  />
                </div>
              </div>

              {error && (
                <div className="mb-3 p-2.5 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-[10px] font-bold">
                  {error}
                </div>
              )}

              <div className="space-y-2.5">
                <button
                  onClick={handleGuardarEmpresa}
                  disabled={loading || !empresaData.nombre.trim()}
                  className="relative w-full group overflow-hidden bg-gradient-to-r from-fuchsia-500 via-violet-600 to-cyan-500 text-white py-3.5 lg:py-3 rounded-xl font-black text-xs lg:text-[10px] uppercase tracking-[0.15em] transition-all shadow-2xl shadow-violet-600/30 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="absolute inset-0 bg-gradient-to-r from-fuchsia-400 via-violet-500 to-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <span className="relative flex items-center justify-center gap-2">
                    {loading ? (
                      <>
                        <div className="w-4 h-4 lg:w-3.5 lg:h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Guardando...
                      </>
                    ) : (
                      <>
                        Continuar
                        <ArrowRight className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
                      </>
                    )}
                  </span>
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* PASO: Selección de Cargo (después de empresa) */}
        {paso === 'cargo' && (
          <motion.div
            key="cargo"
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -100 }}
            className="w-full max-w-4xl"
          >
            <CargoSelector
              onSelect={handleSelectCargo}
              espacioNombre={espacioCreado?.nombre || 'kronos'}
              isLoading={loading}
              rolUsuario="super_admin"
              cargosDB={cargosDB}
            />
          </motion.div>
        )}

        {/* PASO: Invitar Equipo */}
        {paso === 'invitar' && (
          <motion.div
            key="invitar"
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -100 }}
            className="w-full max-w-md lg:max-w-sm relative z-10"
          >
            <div className="absolute -inset-1 bg-gradient-to-r from-violet-600/20 via-fuchsia-600/20 to-cyan-500/20 rounded-[40px] lg:rounded-[32px] blur-xl opacity-60" />
            <div className="relative backdrop-blur-xl bg-white/[0.03] border border-white/[0.08] rounded-[36px] lg:rounded-[28px] p-6 lg:p-5">
              <div className="text-center mb-6 lg:mb-5">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-gradient-to-r from-violet-600/20 to-fuchsia-600/20 border border-violet-500/30 rounded-full text-violet-400 text-[9px] lg:text-[8px] font-bold uppercase tracking-wider mb-3">
                  Paso 3 de 3
                </div>
                <div className="relative group mx-auto w-12 h-12 lg:w-10 lg:h-10 mb-3">
                  <div className="absolute -inset-2 bg-gradient-to-r from-violet-600 to-fuchsia-600 rounded-xl blur-lg opacity-40" />
                  <div className="relative w-12 h-12 lg:w-10 lg:h-10 bg-gradient-to-br from-violet-600 via-fuchsia-600 to-cyan-500 rounded-xl flex items-center justify-center">
                    <Users className="w-6 h-6 lg:w-5 lg:h-5 text-white" />
                  </div>
                </div>
                <h2 className="text-2xl lg:text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-violet-200 to-white mb-1">Invita a tu equipo</h2>
                <p className="text-zinc-500 text-xs lg:text-[10px]">
                  Añade los emails para invitar a <span className="text-violet-400 font-medium">{espacioCreado?.nombre}</span>
                </p>
              </div>

              <div className="space-y-2.5 mb-4 lg:mb-3">
                {invitaciones.map((email, index) => (
                  <div key={index} className="flex gap-2">
                    <div className="flex-1 relative">
                      <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => handleEmailChange(index, e.target.value)}
                        placeholder="email@ejemplo.com"
                        className="w-full pl-10 pr-3 py-3.5 lg:py-3 bg-black/40 border border-white/5 rounded-xl text-sm lg:text-xs text-white placeholder-zinc-700 focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20 outline-none transition-all"
                      />
                    </div>
                    {invitaciones.length > 1 && (
                      <button
                        onClick={() => handleRemoveEmail(index)}
                        className="p-3.5 lg:p-3 bg-black/40 border border-white/5 rounded-xl text-zinc-500 hover:text-red-400 hover:border-red-500/50 transition-all"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <button
                onClick={handleAddEmail}
                className="w-full py-3 lg:py-2.5 border-2 border-dashed border-white/[0.06] rounded-xl text-zinc-600 hover:text-violet-400 hover:border-violet-500/30 transition-all flex items-center justify-center gap-2 mb-4 lg:mb-3 text-xs"
              >
                <Plus className="w-4 h-4" />
                Añadir otro email
              </button>

              {error && (
                <div className="mb-3 p-2.5 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-[10px] font-bold">
                  {error}
                </div>
              )}

              <div className="space-y-2.5">
                <button
                  onClick={handleEnviarInvitaciones}
                  disabled={loading}
                  className="relative w-full group overflow-hidden bg-gradient-to-r from-violet-600 via-fuchsia-600 to-cyan-500 text-white py-3.5 lg:py-3 rounded-xl font-black text-xs lg:text-[10px] uppercase tracking-[0.15em] transition-all shadow-2xl shadow-violet-600/30 active:scale-[0.98] disabled:opacity-50"
                >
                  <span className="absolute inset-0 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <span className="relative flex items-center justify-center gap-2">
                    {loading ? (
                      <>
                        <div className="w-4 h-4 lg:w-3.5 lg:h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Enviando...
                      </>
                    ) : (
                      <>
                        Enviar invitaciones
                        <ArrowRight className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
                      </>
                    )}
                  </span>
                </button>

                <button
                  onClick={handleSkipInvitaciones}
                  disabled={loading}
                  className="w-full py-2 text-zinc-500 hover:text-violet-400 transition-colors text-[10px] lg:text-[9px] font-bold uppercase tracking-widest"
                >
                  Omitir por ahora
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* PASO: Completado */}
        {paso === 'completado' && (
          <motion.div
            key="completado"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md lg:max-w-sm text-center relative z-10"
          >
            <div className="relative mx-auto w-16 h-16 lg:w-14 lg:h-14 mb-4">
              <div className="absolute -inset-2 bg-gradient-to-r from-emerald-500 to-cyan-500 rounded-full blur-xl opacity-50 animate-pulse" />
              <div className="relative w-16 h-16 lg:w-14 lg:h-14 bg-gradient-to-br from-emerald-500 to-cyan-500 rounded-full flex items-center justify-center shadow-2xl">
                <Check className="w-8 h-8 lg:w-7 lg:h-7 text-white" />
              </div>
            </div>
            <h2 className="text-2xl lg:text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-emerald-200 to-white mb-2">¡Todo listo!</h2>
            <p className="text-zinc-300 text-sm lg:text-xs mb-1">
              Tu espacio <span className="text-emerald-400 font-medium">{espacioCreado?.nombre}</span> está listo
            </p>
            <p className="text-zinc-600 text-[10px]">Redirigiendo...</p>

            <div className="mt-6">
              <div className="w-6 h-6 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default OnboardingCreador;
