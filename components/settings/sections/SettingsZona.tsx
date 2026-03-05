'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Check, MapPin, Plus, RefreshCw, Send, Sparkles, XCircle, LayoutGrid, Circle, Hexagon, Eye, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { AutorizacionEmpresa, ZonaEmpresa } from '@/types';
import { useStore } from '@/store/useStore';
import {
  cargarAutorizacionesActivas,
  cargarSolicitudesEnviadas,
  cargarSolicitudesPendientes,
  cargarZonasEmpresa,
  actualizarEstadoZonaEmpresa,
  guardarZonaEmpresa,
  aprobarAutorizacionEmpresa,
  rechazarAutorizacionEmpresa,
  revocarAutorizacionEmpresa,
  solicitarAccesoEmpresa,
  aplicarLayoutMasivo,
} from '@/lib/autorizacionesEmpresa';
import { generarLayoutZonas, detectarOverlaps, type EmpresaParaLayout, type ZonaGenerada, type LayoutConfig } from '@/lib/zonaLayoutEngine';

interface EmpresaBasica {
  id: string;
  nombre: string;
  logo_url?: string | null;
  miembros_count?: number;
}

interface SettingsZonaProps {
  workspaceId: string;
  isAdmin: boolean;
}

export const SettingsZona: React.FC<SettingsZonaProps> = ({ workspaceId, isAdmin }) => {
  const { setActiveChatGroupId, setActiveSubTab } = useStore();
  const [zonas, setZonas] = useState<ZonaEmpresa[]>([]);
  const [empresas, setEmpresas] = useState<EmpresaBasica[]>([]);
  const [empresaUsuarioId, setEmpresaUsuarioId] = useState<string | null>(null);
  const [usuarioId, setUsuarioId] = useState<string | null>(null);
  const [solicitudesRecibidas, setSolicitudesRecibidas] = useState<AutorizacionEmpresa[]>([]);
  const [solicitudesEnviadas, setSolicitudesEnviadas] = useState<AutorizacionEmpresa[]>([]);
  const [autorizacionesActivas, setAutorizacionesActivas] = useState<AutorizacionEmpresa[]>([]);
  const [empresaDestinoId, setEmpresaDestinoId] = useState('');

  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [mensajeError, setMensajeError] = useState<string | null>(null);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);

  // === Generador dinámico de layout ===
  const [mostrarGenerador, setMostrarGenerador] = useState(false);
  const [algoritmoSeleccionado, setAlgoritmoSeleccionado] = useState<'radial' | 'grid' | 'organico'>('radial');
  const [incluirZonaComun, setIncluirZonaComun] = useState(true);
  const [worldSize, setWorldSize] = useState(800);
  const [previewZonas, setPreviewZonas] = useState<ZonaGenerada[]>([]);
  const [previewAlgoritmo, setPreviewAlgoritmo] = useState('');
  const [aplicandoLayout, setAplicandoLayout] = useState(false);

  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    empresa_id: '',
    nombre_zona: '',
    posicion_x: '0',
    posicion_y: '0',
    ancho: '200',
    alto: '200',
    color: '#64748b',
    estado: 'activa',
    es_comun: false,
  });

  const mostrarMensaje = (tipo: 'error' | 'exito', texto: string) => {
    if (tipo === 'error') setMensajeError(texto);
    else setMensajeExito(texto);
    setTimeout(() => {
      setMensajeError(null);
      setMensajeExito(null);
    }, 3500);
  };

  const obtenerNombreEmpresa = useCallback(
    (empresaId?: string | null) => {
      if (!empresaId) return 'Empresa desconocida';
      return empresas.find((e) => e.id === empresaId)?.nombre || 'Empresa desconocida';
    },
    [empresas]
  );

  const cargarDatosBase = useCallback(async () => {
    setCargando(true);
    setMensajeError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const idUsuario = sessionData.session?.user.id ?? null;
      setUsuarioId(idUsuario);

      if (idUsuario) {
        const { data: miembroData } = await supabase
          .from('miembros_espacio')
          .select('empresa_id')
          .eq('espacio_id', workspaceId)
          .eq('usuario_id', idUsuario)
          .maybeSingle();
        setEmpresaUsuarioId(miembroData?.empresa_id ?? null);
      } else {
        setEmpresaUsuarioId(null);
      }

      const { data: empresasData, error: empresasError } = await supabase
        .from('empresas')
        .select('id, nombre, logo_url')
        .eq('espacio_id', workspaceId)
        .order('nombre');

      if (empresasError) {
        throw empresasError;
      }

      // Contar miembros por empresa para el layout proporcional
      const { data: miembrosCount } = await supabase
        .from('miembros_espacio')
        .select('empresa_id')
        .eq('espacio_id', workspaceId)
        .not('empresa_id', 'is', null);

      const conteo: Record<string, number> = {};
      (miembrosCount || []).forEach((m: any) => {
        if (m.empresa_id) conteo[m.empresa_id] = (conteo[m.empresa_id] || 0) + 1;
      });

      setEmpresas(
        (empresasData || []).map((e: any) => ({
          ...e,
          miembros_count: conteo[e.id] || 0,
        }))
      );

      const zonasData = await cargarZonasEmpresa(workspaceId);
      setZonas(zonasData);
    } catch (error: any) {
      console.error('Error cargando datos de zonas:', error);
      mostrarMensaje('error', error?.message || 'No se pudieron cargar las zonas');
    } finally {
      setCargando(false);
    }
  }, [workspaceId]);

  const cargarAutorizaciones = useCallback(async () => {
    if (!empresaUsuarioId) {
      setSolicitudesRecibidas([]);
      setSolicitudesEnviadas([]);
      setAutorizacionesActivas([]);
      return;
    }

    const [recibidas, enviadas, activas] = await Promise.all([
      cargarSolicitudesPendientes(workspaceId, empresaUsuarioId),
      cargarSolicitudesEnviadas(workspaceId, empresaUsuarioId),
      cargarAutorizacionesActivas(workspaceId, empresaUsuarioId),
    ]);

    setSolicitudesRecibidas(recibidas);
    setSolicitudesEnviadas(enviadas);
    setAutorizacionesActivas(activas);
  }, [workspaceId, empresaUsuarioId]);

  useEffect(() => {
    cargarDatosBase();
  }, [cargarDatosBase]);

  useEffect(() => {
    cargarAutorizaciones();
  }, [cargarAutorizaciones]);

  const empresasDisponibles = useMemo(() => {
    return empresas.filter((empresa) => empresa.id !== empresaUsuarioId);
  }, [empresas, empresaUsuarioId]);

  // === Generador dinámico: preview ===
  const generarPreview = useCallback(() => {
    const empresasParaLayout: EmpresaParaLayout[] = empresas.map((e) => ({
      id: e.id,
      nombre: e.nombre,
      miembros_count: e.miembros_count || 1,
      logo_url: e.logo_url,
    }));

    const resultado = generarLayoutZonas(empresasParaLayout, {
      worldSize,
      algoritmo: algoritmoSeleccionado,
      incluirZonaComun,
    });

    setPreviewZonas(resultado.zonas);
    setPreviewAlgoritmo(resultado.algoritmoUsado);
  }, [empresas, worldSize, algoritmoSeleccionado, incluirZonaComun]);

  // Auto-generar preview cuando cambian parámetros
  useEffect(() => {
    if (mostrarGenerador && empresas.length > 0) {
      generarPreview();
    }
  }, [mostrarGenerador, generarPreview, empresas.length]);

  const overlapsDetectados = useMemo(() => {
    return detectarOverlaps(previewZonas);
  }, [previewZonas]);

  // === Generador dinámico: aplicar ===
  const handleAplicarLayout = useCallback(async () => {
    if (previewZonas.length === 0) return;
    setAplicandoLayout(true);

    const ok = await aplicarLayoutMasivo({
      espacioId: workspaceId,
      zonas: previewZonas,
      eliminarExistentes: true,
      usuarioId,
      algoritmo: previewAlgoritmo,
    });

    if (ok) {
      mostrarMensaje('exito', `Layout aplicado: ${previewZonas.length} zonas generadas (${previewAlgoritmo})`);
      const nuevasZonas = await cargarZonasEmpresa(workspaceId);
      setZonas(nuevasZonas);
      setMostrarGenerador(false);
      setPreviewZonas([]);
    } else {
      mostrarMensaje('error', 'Error aplicando el layout');
    }

    setAplicandoLayout(false);
  }, [previewZonas, workspaceId, usuarioId, previewAlgoritmo]);

  const resetFormulario = () => {
    setFormData({
      empresa_id: empresaUsuarioId || '',
      nombre_zona: '',
      posicion_x: '0',
      posicion_y: '0',
      ancho: '200',
      alto: '200',
      color: '#64748b',
      estado: 'activa',
      es_comun: false,
    });
    setEditandoId(null);
    setMostrarFormulario(false);
  };

  const handleEditarZona = (zona: ZonaEmpresa) => {
    setFormData({
      empresa_id: zona.empresa_id || '',
      nombre_zona: zona.nombre_zona || '',
      posicion_x: String(zona.posicion_x ?? 0),
      posicion_y: String(zona.posicion_y ?? 0),
      ancho: String(zona.ancho ?? 200),
      alto: String(zona.alto ?? 200),
      color: zona.color || '#64748b',
      estado: zona.estado || 'activa',
      es_comun: zona.es_comun ?? false,
    });
    setEditandoId(zona.id);
    setMostrarFormulario(true);
  };

  const handleGuardarZona = async () => {
    if (!formData.es_comun && !formData.empresa_id) {
      mostrarMensaje('error', 'Selecciona la empresa para la zona');
      return;
    }

    setGuardando(true);
    const zona = await guardarZonaEmpresa({
      zonaId: editandoId,
      espacioId: workspaceId,
      empresaId: formData.es_comun ? null : formData.empresa_id,
      esComun: formData.es_comun,
      nombreZona: formData.nombre_zona.trim() || null,
      posicionX: Number(formData.posicion_x || 0),
      posicionY: Number(formData.posicion_y || 0),
      ancho: Number(formData.ancho || 0),
      alto: Number(formData.alto || 0),
      color: formData.color,
      estado: formData.estado,
      usuarioId,
    });

    if (!zona) {
      mostrarMensaje('error', 'No se pudo guardar la zona');
      setGuardando(false);
      return;
    }

    mostrarMensaje('exito', editandoId ? 'Zona actualizada' : 'Zona creada');
    resetFormulario();
    const nuevasZonas = await cargarZonasEmpresa(workspaceId);
    setZonas(nuevasZonas);
    setGuardando(false);
  };

  const handleToggleZona = async (zona: ZonaEmpresa) => {
    if (!usuarioId) return;

    const nuevoEstado = zona.estado === 'activa' ? 'inactiva' : 'activa';
    setGuardando(true);
    const ok = await actualizarEstadoZonaEmpresa({
      zonaId: zona.id,
      estado: nuevoEstado,
      usuarioId,
      empresaId: zona.empresa_id,
      espacioId: workspaceId,
    });

    if (!ok) {
      mostrarMensaje('error', 'No se pudo actualizar el estado');
    } else {
      mostrarMensaje('exito', nuevoEstado === 'activa' ? 'Zona reactivada' : 'Zona inactivada');
      const nuevasZonas = await cargarZonasEmpresa(workspaceId);
      setZonas(nuevasZonas);
    }

    setGuardando(false);
  };

  const handleSolicitarAcceso = async () => {
    if (!empresaUsuarioId || !empresaDestinoId || !usuarioId) {
      mostrarMensaje('error', 'Selecciona una empresa para solicitar acceso');
      return;
    }

    setGuardando(true);
    const solicitudId = await solicitarAccesoEmpresa({
      espacioId: workspaceId,
      empresaOrigenId: empresaUsuarioId,
      empresaDestinoId,
      usuarioId,
    });

    if (!solicitudId) {
      mostrarMensaje('error', 'No se pudo enviar la solicitud');
      setGuardando(false);
      return;
    }

    mostrarMensaje('exito', 'Solicitud enviada');
    setEmpresaDestinoId('');
    await cargarAutorizaciones();
    setGuardando(false);
  };

  const handleActualizarAutorizacion = async (
    tipo: 'aprobar' | 'rechazar' | 'revocar',
    autorizacionId: string
  ) => {
    if (!usuarioId || !empresaUsuarioId) return;

    setGuardando(true);
    const payload = {
      autorizacionId,
      usuarioId,
      empresaId: empresaUsuarioId,
      espacioId: workspaceId,
    };

    const resultado =
      tipo === 'aprobar'
        ? await aprobarAutorizacionEmpresa(payload)
        : tipo === 'rechazar'
          ? await rechazarAutorizacionEmpresa(payload)
          : await revocarAutorizacionEmpresa(payload);

    if (!resultado) {
      mostrarMensaje('error', 'No se pudo actualizar la autorización');
    } else {
      mostrarMensaje('exito', 'Autorización actualizada');
      await cargarAutorizaciones();
    }

    setGuardando(false);
  };

  if (!isAdmin) {
    return (
      <div className="text-center py-12 text-zinc-500">
        Solo los administradores pueden gestionar zonas y autorizaciones.
      </div>
    );
  }

  if (cargando) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-5 h-5 text-violet-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold text-white">Zonas de Empresa</h3>
          <p className="text-sm text-zinc-400 mt-1">
            Define los espacios privados y controla quién puede ver a tu equipo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!mostrarFormulario && !mostrarGenerador && (
            <>
              <button
                onClick={() => setMostrarGenerador(true)}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white rounded-xl text-sm font-medium transition-all shadow-lg shadow-orange-500/20"
              >
                <Sparkles className="w-4 h-4" /> Auto-generar layout
              </button>
              <button
                onClick={() => {
                  resetFormulario();
                  setMostrarFormulario(true);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-sm font-medium transition-all"
              >
                <Plus className="w-4 h-4" /> Nueva zona
              </button>
            </>
          )}
        </div>
      </div>

      {mensajeError && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
          {mensajeError}
        </div>
      )}
      {mensajeExito && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-sm">
          {mensajeExito}
        </div>
      )}

      {/* ========== GENERADOR DINÁMICO DE LAYOUT ========== */}
      {mostrarGenerador && (
        <div className="p-5 bg-gradient-to-br from-zinc-800/80 to-zinc-900/80 border border-amber-500/20 rounded-2xl shadow-xl">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Generador Dinámico de Layout</h4>
                <p className="text-xs text-zinc-400">{empresas.length} empresas · Tamaño proporcional a miembros</p>
              </div>
            </div>
            <button onClick={() => { setMostrarGenerador(false); setPreviewZonas([]); }} className="text-zinc-400 hover:text-white transition">
              <XCircle className="w-5 h-5" />
            </button>
          </div>

          {/* Controles */}
          <div className="grid grid-cols-3 gap-4 mb-5">
            {/* Algoritmo */}
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-2">Algoritmo</label>
              <div className="flex flex-col gap-1.5">
                {([
                  { id: 'radial' as const, label: 'Radial', desc: 'Anillo alrededor del centro', icon: <Circle className="w-3.5 h-3.5" /> },
                  { id: 'grid' as const, label: 'Cuadrícula', desc: 'Grid ordenado', icon: <LayoutGrid className="w-3.5 h-3.5" /> },
                  { id: 'organico' as const, label: 'Orgánico', desc: 'Espiral por tamaño', icon: <Hexagon className="w-3.5 h-3.5" /> },
                ]).map((algo) => (
                  <button
                    key={algo.id}
                    onClick={() => setAlgoritmoSeleccionado(algo.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all ${
                      algoritmoSeleccionado === algo.id
                        ? 'bg-amber-500/20 border border-amber-500/40 text-amber-200'
                        : 'bg-zinc-900/60 border border-zinc-700/40 text-zinc-400 hover:border-zinc-600'
                    }`}
                  >
                    {algo.icon}
                    <div className="text-left">
                      <span className="font-medium">{algo.label}</span>
                      <span className="text-[10px] text-zinc-500 ml-1">— {algo.desc}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Opciones */}
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-2">Opciones</label>
              <div className="space-y-3">
                <div className="flex items-center gap-2 bg-zinc-900/60 border border-zinc-700/40 rounded-lg px-3 py-2">
                  <input
                    type="checkbox"
                    checked={incluirZonaComun}
                    onChange={(e) => setIncluirZonaComun(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-zinc-600 text-amber-500"
                  />
                  <span className="text-xs text-zinc-300">Zona común central</span>
                </div>
                <div>
                  <label className="block text-[10px] text-zinc-500 mb-1">Tamaño del mundo (px)</label>
                  <input
                    type="range"
                    min={400}
                    max={1600}
                    step={100}
                    value={worldSize}
                    onChange={(e) => setWorldSize(Number(e.target.value))}
                    className="w-full accent-amber-500"
                  />
                  <span className="text-xs text-zinc-400">{worldSize}px</span>
                </div>
              </div>
            </div>

            {/* Info del preview */}
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-2">Resultado</label>
              <div className="bg-zinc-900/60 border border-zinc-700/40 rounded-lg p-3 space-y-1.5">
                <p className="text-xs text-zinc-300">
                  <span className="text-white font-medium">{previewZonas.length}</span> zonas generadas
                </p>
                <p className="text-xs text-zinc-300">
                  Algoritmo: <span className="text-amber-300 font-medium">{previewAlgoritmo || '—'}</span>
                </p>
                <p className="text-xs text-zinc-300">
                  Empresas: <span className="text-white font-medium">{previewZonas.filter((z) => !z.es_comun).length}</span>
                </p>
                {overlapsDetectados.length > 0 && (
                  <p className="text-xs text-amber-400">
                    ⚠ {overlapsDetectados.length} overlap{overlapsDetectados.length > 1 ? 's' : ''} detectado{overlapsDetectados.length > 1 ? 's' : ''}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Preview 2D Canvas */}
          {previewZonas.length > 0 && (
            <div className="mb-5">
              <label className="block text-xs font-medium text-zinc-400 mb-2 flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5" /> Vista previa del layout
              </label>
              <div className="bg-zinc-950 border border-zinc-700/50 rounded-xl p-3 overflow-hidden">
                <div className="relative mx-auto" style={{ width: '100%', maxWidth: 420, aspectRatio: '1/1' }}>
                  <svg viewBox={`0 0 ${worldSize} ${worldSize}`} className="w-full h-full" style={{ background: '#0f172a' }}>
                    {/* Grid de fondo */}
                    <defs>
                      <pattern id="grid-pattern" width={worldSize / 10} height={worldSize / 10} patternUnits="userSpaceOnUse">
                        <path d={`M ${worldSize / 10} 0 L 0 0 0 ${worldSize / 10}`} fill="none" stroke="#1e293b" strokeWidth="0.5" />
                      </pattern>
                    </defs>
                    <rect width={worldSize} height={worldSize} fill="url(#grid-pattern)" />

                    {/* Zonas */}
                    {previewZonas.map((zona, i) => {
                      const x = zona.posicion_x - zona.ancho / 2;
                      const y = zona.posicion_y - zona.alto / 2;
                      return (
                        <g key={i}>
                          <rect
                            x={x}
                            y={y}
                            width={zona.ancho}
                            height={zona.alto}
                            fill={zona.color}
                            fillOpacity={zona.es_comun ? 0.25 : 0.35}
                            stroke={zona.color}
                            strokeWidth={zona.es_comun ? 2 : 1.5}
                            strokeOpacity={0.7}
                            rx={4}
                          />
                          <text
                            x={zona.posicion_x}
                            y={zona.posicion_y - 4}
                            fill="white"
                            fontSize={Math.max(10, Math.min(16, zona.ancho / 10))}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            opacity={0.9}
                          >
                            {zona.nombre_zona.length > 12 ? zona.nombre_zona.slice(0, 11) + '…' : zona.nombre_zona}
                          </text>
                          <text
                            x={zona.posicion_x}
                            y={zona.posicion_y + 14}
                            fill={zona.color}
                            fontSize={Math.max(8, Math.min(11, zona.ancho / 14))}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            opacity={0.7}
                          >
                            {zona.ancho}×{zona.alto}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </div>
            </div>
          )}

          {/* Acciones */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={generarPreview}
                className="flex items-center gap-2 px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg text-xs font-medium transition"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Regenerar
              </button>
              {zonas.length > 0 && (
                <span className="text-[10px] text-amber-400 flex items-center gap-1">
                  <Trash2 className="w-3 h-3" /> Aplicar reemplazará las {zonas.length} zonas actuales
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setMostrarGenerador(false); setPreviewZonas([]); }}
                className="px-4 py-2 rounded-lg text-sm text-zinc-400 hover:text-white transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleAplicarLayout}
                disabled={aplicandoLayout || previewZonas.length === 0}
                className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white rounded-lg text-sm font-medium transition-all shadow-lg shadow-orange-500/20 disabled:opacity-50"
              >
                {aplicandoLayout ? (
                  <><RefreshCw className="w-4 h-4 animate-spin" /> Aplicando...</>
                ) : (
                  <><Sparkles className="w-4 h-4" /> Aplicar layout ({previewZonas.length} zonas)</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {mostrarFormulario && (
        <div className="p-5 bg-zinc-800/50 border border-zinc-700/50 rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-bold text-white">
              {editandoId ? 'Editar zona' : 'Nueva zona'}
            </h4>
            <button
              onClick={resetFormulario}
              className="text-zinc-400 hover:text-white transition"
            >
              <XCircle className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 flex items-center gap-3 bg-zinc-900/60 border border-zinc-700/60 rounded-xl px-3 py-2">
              <input
                id="zona-comun"
                type="checkbox"
                checked={formData.es_comun}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    es_comun: e.target.checked,
                    empresa_id: e.target.checked ? '' : prev.empresa_id,
                  }))
                }
                className="h-4 w-4 rounded border-zinc-600 text-violet-500"
              />
              <label htmlFor="zona-comun" className="text-xs font-medium text-zinc-300">
                Zona común (sin empresa asignada)
              </label>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Empresa *</label>
              <select
                value={formData.empresa_id}
                onChange={(e) => setFormData((prev) => ({ ...prev, empresa_id: e.target.value }))}
                disabled={formData.es_comun}
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-white text-sm focus:border-violet-500 outline-none"
              >
                <option value="">Selecciona empresa</option>
                {empresas.map((empresa) => (
                  <option key={empresa.id} value={empresa.id}>
                    {empresa.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Nombre zona</label>
              <input
                type="text"
                value={formData.nombre_zona}
                onChange={(e) => setFormData((prev) => ({ ...prev, nombre_zona: e.target.value }))}
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-white text-sm focus:border-violet-500 outline-none"
                placeholder="Ej: Zona Diseño"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Posición X</label>
              <input
                type="number"
                value={formData.posicion_x}
                onChange={(e) => setFormData((prev) => ({ ...prev, posicion_x: e.target.value }))}
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-white text-sm focus:border-violet-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Posición Y</label>
              <input
                type="number"
                value={formData.posicion_y}
                onChange={(e) => setFormData((prev) => ({ ...prev, posicion_y: e.target.value }))}
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-white text-sm focus:border-violet-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Ancho</label>
              <input
                type="number"
                value={formData.ancho}
                onChange={(e) => setFormData((prev) => ({ ...prev, ancho: e.target.value }))}
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-white text-sm focus:border-violet-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Alto</label>
              <input
                type="number"
                value={formData.alto}
                onChange={(e) => setFormData((prev) => ({ ...prev, alto: e.target.value }))}
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-white text-sm focus:border-violet-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Color</label>
              <input
                type="color"
                value={formData.color}
                onChange={(e) => setFormData((prev) => ({ ...prev, color: e.target.value }))}
                className="w-full h-10 bg-zinc-900 border border-zinc-700 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Estado</label>
              <select
                value={formData.estado}
                onChange={(e) => setFormData((prev) => ({ ...prev, estado: e.target.value }))}
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-white text-sm focus:border-violet-500 outline-none"
              >
                <option value="activa">Activa</option>
                <option value="inactiva">Inactiva</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-4">
            <button
              onClick={resetFormulario}
              className="px-4 py-2 rounded-lg text-sm text-zinc-400 hover:text-white transition"
            >
              Cancelar
            </button>
            <button
              onClick={handleGuardarZona}
              disabled={guardando}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition disabled:opacity-60"
            >
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {zonas.map((zona) => (
          <div key={zona.id} className="p-4 bg-zinc-900/60 border border-white/5 rounded-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: zona.color || '#64748b' }}>
                  <MapPin className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{zona.nombre_zona || 'Zona sin nombre'}</p>
                  <p className="text-xs text-zinc-400 flex items-center gap-1">
                    <Building2 className="w-3 h-3" /> {zona.es_comun ? 'Zona común' : (zona.empresa?.nombre || obtenerNombreEmpresa(zona.empresa_id))}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleEditarZona(zona)}
                  className="text-xs text-violet-300 hover:text-white transition"
                >
                  Editar
                </button>
                <button
                  onClick={() => handleToggleZona(zona)}
                  className={`text-xs px-2 py-1 rounded-lg transition ${
                    zona.estado === 'activa'
                      ? 'bg-amber-500/20 text-amber-200 hover:bg-amber-500/30'
                      : 'bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30'
                  }`}
                >
                  {zona.estado === 'activa' ? 'Inactivar' : 'Reactivar'}
                </button>
              </div>
            </div>
            <div className="mt-3 text-xs text-zinc-500 grid grid-cols-2 gap-2">
              <span>Posición: {zona.posicion_x}, {zona.posicion_y}</span>
              <span>Tamaño: {zona.ancho} × {zona.alto}</span>
              <span>Estado: {zona.estado}</span>
              {zona.es_comun && <span>Tipo: común</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-white/5 pt-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="text-lg font-bold text-white">Autorizaciones entre empresas</h4>
            <p className="text-xs text-zinc-400 mt-1">Gestiona permisos para ver equipos y colaborar.</p>
          </div>
        </div>

        {!empresaUsuarioId && (
          <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-sm">
            Tu usuario no está asociado a una empresa. Asigna una empresa para habilitar solicitudes.
          </div>
        )}

        {empresaUsuarioId && (
          <div className="space-y-6">
            <div className="p-4 bg-zinc-900/60 border border-white/5 rounded-2xl">
              <h5 className="text-sm font-semibold text-white mb-3">Nueva solicitud</h5>
              <div className="flex flex-wrap gap-3 items-center">
                <select
                  value={empresaDestinoId}
                  onChange={(e) => setEmpresaDestinoId(e.target.value)}
                  className="px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-white text-sm focus:border-violet-500 outline-none"
                >
                  <option value="">Selecciona empresa</option>
                  {empresasDisponibles.map((empresa) => (
                    <option key={empresa.id} value={empresa.id}>
                      {empresa.nombre}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleSolicitarAcceso}
                  disabled={guardando || !empresaDestinoId}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition disabled:opacity-60"
                >
                  <span className="flex items-center gap-2">
                    <Send className="w-4 h-4" /> Solicitar acceso
                  </span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-zinc-900/60 border border-white/5 rounded-2xl">
                <h5 className="text-sm font-semibold text-white mb-3">Solicitudes recibidas</h5>
                {solicitudesRecibidas.length === 0 ? (
                  <p className="text-xs text-zinc-500">No hay solicitudes pendientes.</p>
                ) : (
                  <div className="space-y-3">
                    {solicitudesRecibidas.map((solicitud) => (
                      <div key={solicitud.id} className="flex items-center justify-between text-xs text-zinc-300">
                        <span>{obtenerNombreEmpresa(solicitud.empresa_origen_id)}</span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleActualizarAutorizacion('aprobar', solicitud.id)}
                            className="px-2 py-1 rounded bg-emerald-600/80 text-white"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => handleActualizarAutorizacion('rechazar', solicitud.id)}
                            className="px-2 py-1 rounded bg-red-500/70 text-white"
                          >
                            <XCircle className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-4 bg-zinc-900/60 border border-white/5 rounded-2xl">
                <h5 className="text-sm font-semibold text-white mb-3">Solicitudes enviadas</h5>
                {solicitudesEnviadas.length === 0 ? (
                  <p className="text-xs text-zinc-500">No has enviado solicitudes.</p>
                ) : (
                  <ul className="space-y-2 text-xs text-zinc-400">
                    {solicitudesEnviadas.map((solicitud) => (
                      <li key={solicitud.id}>
                        {obtenerNombreEmpresa(solicitud.empresa_destino_id)} · pendiente
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="p-4 bg-zinc-900/60 border border-white/5 rounded-2xl">
              <h5 className="text-sm font-semibold text-white mb-3">Autorizaciones activas</h5>
              {autorizacionesActivas.length === 0 ? (
                <p className="text-xs text-zinc-500">No hay autorizaciones activas.</p>
              ) : (
                <div className="space-y-3 text-xs text-zinc-300">
                  {autorizacionesActivas.map((autorizacion) => {
                    const otraEmpresa =
                      autorizacion.empresa_origen_id === empresaUsuarioId
                        ? autorizacion.empresa_destino_id
                        : autorizacion.empresa_origen_id;
                    return (
                      <div key={autorizacion.id} className="flex items-center justify-between">
                        <div>
                          <p>{obtenerNombreEmpresa(otraEmpresa)}</p>
                          {autorizacion.expira_en && (
                            <p className="text-[10px] text-zinc-500">Expira: {new Date(autorizacion.expira_en).toLocaleDateString()}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {autorizacion.canal_compartido_id && (
                            <button
                              onClick={() => {
                                setActiveChatGroupId(autorizacion.canal_compartido_id || null);
                                setActiveSubTab('chat');
                              }}
                              className="px-2 py-1 rounded bg-sky-500/20 text-sky-200"
                            >
                              Abrir canal
                            </button>
                          )}
                          <button
                            onClick={() => handleActualizarAutorizacion('revocar', autorizacion.id)}
                            className="px-2 py-1 rounded bg-amber-500/70 text-white"
                          >
                            Revocar
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsZona;
