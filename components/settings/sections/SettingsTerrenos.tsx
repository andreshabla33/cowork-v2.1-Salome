'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MapPin, Plus, RefreshCw, XCircle, Star, Trash2, Eye,
  ShoppingCart, DollarSign, BarChart3, ExternalLink, Edit3,
} from 'lucide-react';
import type { TerrenoMarketplace } from '@/types';
import {
  cargarTodosTerrenos,
  guardarTerreno,
  eliminarTerreno,
  TIER_CONFIG,
} from '@/lib/terrenosMarketplace';

interface SettingsTerrenosProps {
  workspaceId: string;
  isAdmin: boolean;
}

export const SettingsTerrenos: React.FC<SettingsTerrenosProps> = ({ workspaceId, isAdmin }) => {
  const [terrenos, setTerrenos] = useState<TerrenoMarketplace[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [mensajeError, setMensajeError] = useState<string | null>(null);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    nombre: '',
    descripcion: '',
    posicion_x: '0',
    posicion_y: '0',
    ancho: '200',
    alto: '200',
    tier: 'starter' as TerrenoMarketplace['tier'],
    precio_mensual: '49',
    precio_anual: '470',
    estado: 'disponible' as TerrenoMarketplace['estado'],
    color_preview: '#22c55e',
    destacado: false,
    max_miembros: '10',
    salas_reunion: '1',
    personalizacion: 'basica',
    showroom: false,
    soporte: 'comunidad',
  });

  const mostrarMensaje = (tipo: 'error' | 'exito', texto: string) => {
    if (tipo === 'error') setMensajeError(texto);
    else setMensajeExito(texto);
    setTimeout(() => { setMensajeError(null); setMensajeExito(null); }, 3500);
  };

  const cargarDatos = useCallback(async () => {
    setCargando(true);
    const data = await cargarTodosTerrenos(workspaceId);
    setTerrenos(data);
    setCargando(false);
  }, [workspaceId]);

  useEffect(() => { cargarDatos(); }, [cargarDatos]);

  const stats = useMemo(() => ({
    total: terrenos.length,
    disponibles: terrenos.filter((t) => t.estado === 'disponible').length,
    reservados: terrenos.filter((t) => t.estado === 'reservado').length,
    vendidos: terrenos.filter((t) => t.estado === 'vendido').length,
    ingresoMensual: terrenos
      .filter((t) => t.estado === 'vendido')
      .reduce((sum, t) => sum + (t.precio_mensual || 0), 0),
  }), [terrenos]);

  const resetFormulario = () => {
    setFormData({
      nombre: '', descripcion: '', posicion_x: '0', posicion_y: '0',
      ancho: '200', alto: '200', tier: 'starter', precio_mensual: '49',
      precio_anual: '470', estado: 'disponible', color_preview: '#22c55e',
      destacado: false, max_miembros: '10', salas_reunion: '1',
      personalizacion: 'basica', showroom: false, soporte: 'comunidad',
    });
    setEditandoId(null);
    setMostrarFormulario(false);
  };

  const handleEditar = (t: TerrenoMarketplace) => {
    setFormData({
      nombre: t.nombre,
      descripcion: t.descripcion || '',
      posicion_x: String(t.posicion_x),
      posicion_y: String(t.posicion_y),
      ancho: String(t.ancho),
      alto: String(t.alto),
      tier: t.tier,
      precio_mensual: String(t.precio_mensual),
      precio_anual: String(t.precio_anual),
      estado: t.estado,
      color_preview: t.color_preview,
      destacado: t.destacado,
      max_miembros: String(t.features?.max_miembros ?? 10),
      salas_reunion: String(t.features?.salas_reunion ?? 1),
      personalizacion: t.features?.personalizacion ?? 'basica',
      showroom: t.features?.showroom ?? false,
      soporte: t.features?.soporte ?? 'comunidad',
    });
    setEditandoId(t.id);
    setMostrarFormulario(true);
  };

  const handleGuardar = async () => {
    setGuardando(true);
    const payload: any = {
      espacio_id: workspaceId,
      nombre: formData.nombre || 'Terreno sin nombre',
      descripcion: formData.descripcion || null,
      posicion_x: Number(formData.posicion_x),
      posicion_y: Number(formData.posicion_y),
      ancho: Number(formData.ancho),
      alto: Number(formData.alto),
      tier: formData.tier,
      precio_mensual: Number(formData.precio_mensual),
      precio_anual: Number(formData.precio_anual),
      estado: formData.estado,
      color_preview: formData.color_preview,
      destacado: formData.destacado,
      features: {
        max_miembros: Number(formData.max_miembros),
        salas_reunion: Number(formData.salas_reunion),
        personalizacion: formData.personalizacion,
        showroom: formData.showroom,
        soporte: formData.soporte,
      },
    };
    if (editandoId) payload.id = editandoId;

    const resultado = await guardarTerreno(payload);
    if (resultado) {
      mostrarMensaje('exito', editandoId ? 'Terreno actualizado' : 'Terreno creado');
      await cargarDatos();
      resetFormulario();
    } else {
      mostrarMensaje('error', 'Error guardando terreno');
    }
    setGuardando(false);
  };

  const handleEliminar = async (id: string) => {
    if (!confirm('¿Eliminar este terreno del marketplace?')) return;
    const ok = await eliminarTerreno(id);
    if (ok) {
      mostrarMensaje('exito', 'Terreno eliminado');
      await cargarDatos();
    } else {
      mostrarMensaje('error', 'Error eliminando terreno');
    }
  };

  if (!isAdmin) {
    return <div className="text-center py-12 text-zinc-500">Solo los administradores pueden gestionar terrenos.</div>;
  }

  if (cargando) {
    return <div className="flex items-center justify-center py-12"><RefreshCw className="w-5 h-5 text-violet-400 animate-spin" /></div>;
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-xl font-bold text-white">Marketplace de Terrenos</h3>
          <p className="text-sm text-zinc-400 mt-1">Gestiona los terrenos virtuales disponibles para venta.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a
            href="/explorar"
            target="_blank"
            className="flex items-center gap-2 px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-xl text-sm font-medium transition"
          >
            <Eye className="w-4 h-4" /> Ver público
          </a>
          {!mostrarFormulario && (
            <button
              onClick={() => { resetFormulario(); setMostrarFormulario(true); }}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-xl text-sm font-medium transition-all"
            >
              <Plus className="w-4 h-4" /> Nuevo terreno
            </button>
          )}
        </div>
      </div>

      {/* Mensajes */}
      {mensajeError && <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">{mensajeError}</div>}
      {mensajeExito && <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-sm">{mensajeExito}</div>}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard icon={<MapPin className="w-4 h-4 text-green-400" />} label="Disponibles" valor={stats.disponibles} />
        <StatCard icon={<ShoppingCart className="w-4 h-4 text-amber-400" />} label="Reservados" valor={stats.reservados} />
        <StatCard icon={<Star className="w-4 h-4 text-violet-400" />} label="Vendidos" valor={stats.vendidos} />
        <StatCard icon={<DollarSign className="w-4 h-4 text-emerald-400" />} label="Revenue/mes" valor={`$${stats.ingresoMensual}`} />
      </div>

      {/* Formulario */}
      {mostrarFormulario && (
        <div className="p-5 bg-zinc-800/50 border border-zinc-700/50 rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-bold text-white">{editandoId ? 'Editar terreno' : 'Nuevo terreno'}</h4>
            <button onClick={resetFormulario} className="text-zinc-400 hover:text-white transition"><XCircle className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <InputField label="Nombre" value={formData.nombre} onChange={(v) => setFormData({ ...formData, nombre: v })} colSpan={2} placeholder="Ej: Lote Alpha" />
            <InputField label="Descripción" value={formData.descripcion} onChange={(v) => setFormData({ ...formData, descripcion: v })} colSpan={2} placeholder="Descripción del terreno..." />

            <SelectField label="Tier" value={formData.tier} onChange={(v) => {
              const t = v as TerrenoMarketplace['tier'];
              const auto = t === 'starter' ? { color: '#22c55e', precio: '49', precioA: '470' }
                : t === 'professional' ? { color: '#3b82f6', precio: '149', precioA: '1430' }
                : { color: '#a855f7', precio: '399', precioA: '3830' };
              setFormData({ ...formData, tier: t, color_preview: auto.color, precio_mensual: auto.precio, precio_anual: auto.precioA });
            }} options={[{ value: 'starter', label: 'Starter' }, { value: 'professional', label: 'Professional' }, { value: 'enterprise', label: 'Enterprise' }]} />
            <SelectField label="Estado" value={formData.estado} onChange={(v) => setFormData({ ...formData, estado: v as any })} options={[{ value: 'disponible', label: 'Disponible' }, { value: 'reservado', label: 'Reservado' }, { value: 'vendido', label: 'Vendido' }, { value: 'bloqueado', label: 'Bloqueado' }]} />

            <InputField label="Precio/mes (USD)" value={formData.precio_mensual} onChange={(v) => setFormData({ ...formData, precio_mensual: v })} type="number" />
            <InputField label="Precio/año (USD)" value={formData.precio_anual} onChange={(v) => setFormData({ ...formData, precio_anual: v })} type="number" />

            <InputField label="Posición X" value={formData.posicion_x} onChange={(v) => setFormData({ ...formData, posicion_x: v })} type="number" />
            <InputField label="Posición Y" value={formData.posicion_y} onChange={(v) => setFormData({ ...formData, posicion_y: v })} type="number" />
            <InputField label="Ancho" value={formData.ancho} onChange={(v) => setFormData({ ...formData, ancho: v })} type="number" />
            <InputField label="Alto" value={formData.alto} onChange={(v) => setFormData({ ...formData, alto: v })} type="number" />

            <div className="col-span-2 flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-zinc-300">
                <input type="checkbox" checked={formData.destacado} onChange={(e) => setFormData({ ...formData, destacado: e.target.checked })} className="rounded border-zinc-600 text-amber-500" />
                Destacado
              </label>
              <label className="flex items-center gap-2 text-xs text-zinc-300">
                <input type="checkbox" checked={formData.showroom} onChange={(e) => setFormData({ ...formData, showroom: e.target.checked })} className="rounded border-zinc-600 text-violet-500" />
                Showroom incluido
              </label>
              <InputField label="Color" value={formData.color_preview} onChange={(v) => setFormData({ ...formData, color_preview: v })} type="color" inline />
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <button onClick={resetFormulario} className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition">Cancelar</button>
            <button onClick={handleGuardar} disabled={guardando} className="px-5 py-2 bg-green-600 hover:bg-green-500 text-white rounded-xl text-sm font-medium transition disabled:opacity-50">
              {guardando ? <><RefreshCw className="w-4 h-4 animate-spin inline mr-1" /> Guardando...</> : editandoId ? 'Actualizar' : 'Crear terreno'}
            </button>
          </div>
        </div>
      )}

      {/* Lista de terrenos */}
      <div className="space-y-2">
        {terrenos.length === 0 ? (
          <div className="text-center py-8 text-zinc-500 text-sm">No hay terrenos creados aún.</div>
        ) : (
          terrenos.map((t) => {
            const tier = TIER_CONFIG[t.tier] || TIER_CONFIG.starter;
            return (
              <div key={t.id} className="flex items-center gap-4 p-4 bg-zinc-800/40 border border-zinc-700/30 rounded-xl hover:border-zinc-600/50 transition group">
                <div className="w-3 h-10 rounded-full" style={{ backgroundColor: t.color_preview }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white truncate">{t.nombre}</span>
                    {t.destacado && <Star className="w-3 h-3 text-amber-400 shrink-0" />}
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${tier.textColor} bg-white/5`}>{tier.label}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      t.estado === 'disponible' ? 'text-green-400 bg-green-500/10' :
                      t.estado === 'reservado' ? 'text-amber-400 bg-amber-500/10' :
                      t.estado === 'vendido' ? 'text-violet-400 bg-violet-500/10' :
                      'text-zinc-400 bg-zinc-500/10'
                    }`}>{t.estado}</span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-0.5">{t.ancho}×{t.alto} · ({t.posicion_x}, {t.posicion_y}) · ${t.precio_mensual}/mes</p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                  <button onClick={() => handleEditar(t)} className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition">
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleEliminar(t.id)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-zinc-400 hover:text-red-400 transition">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

// === Componentes auxiliares ===

const StatCard: React.FC<{ icon: React.ReactNode; label: string; valor: number | string }> = ({ icon, label, valor }) => (
  <div className="bg-zinc-800/40 border border-zinc-700/30 rounded-xl p-3 text-center">
    <div className="flex items-center justify-center gap-1.5 mb-1">{icon}</div>
    <p className="text-lg font-bold text-white">{valor}</p>
    <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{label}</p>
  </div>
);

const InputField: React.FC<{
  label: string; value: string; onChange: (v: string) => void;
  colSpan?: number; placeholder?: string; type?: string; inline?: boolean;
}> = ({ label, value, onChange, colSpan, placeholder, type = 'text', inline }) => (
  <div className={inline ? 'flex items-center gap-2' : colSpan === 2 ? 'col-span-2' : ''}>
    <label className="block text-[10px] text-zinc-500 mb-1">{label}</label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`${type === 'color' ? 'w-8 h-6 p-0 border-0 rounded cursor-pointer' : 'w-full px-3 py-2 bg-zinc-900/60 border border-zinc-700/60 rounded-lg text-sm text-white placeholder:text-zinc-600 focus:border-green-500/50 focus:ring-1 focus:ring-green-500/20 transition'}`}
    />
  </div>
);

const SelectField: React.FC<{
  label: string; value: string; onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}> = ({ label, value, onChange, options }) => (
  <div>
    <label className="block text-[10px] text-zinc-500 mb-1">{label}</label>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 bg-zinc-900/60 border border-zinc-700/60 rounded-lg text-sm text-white focus:border-green-500/50 transition"
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
);
