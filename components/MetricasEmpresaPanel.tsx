'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useStore } from '../store/useStore';

// ============== TIPOS ==============
interface MetricaDiaria {
  id: string;
  espacio_id: string;
  empresa_id: string;
  fecha: string;
  conexiones: number;
  desconexiones: number;
  usuarios_activos: number;
  reuniones_creadas: number;
  reuniones_asistidas: number;
  minutos_reunion: number;
  mensajes_chat: number;
  emotes_enviados: number;
  saludos_wave: number;
  teleports: number;
  xp_ganado: number;
  nivel_promedio: number;
  racha_promedio: number;
}

interface Empresa {
  id: string;
  nombre: string;
}

interface MetricasAgregadas {
  conexiones: number;
  usuarios_activos: number;
  reuniones_asistidas: number;
  mensajes_chat: number;
  emotes_enviados: number;
  saludos_wave: number;
  teleports: number;
  xp_ganado: number;
  nivel_promedio: number;
  racha_promedio: number;
}

type Periodo = '7d' | '30d' | '90d';

// ============== MINI SPARKLINE (CSS puro) ==============
const Sparkline: React.FC<{ datos: number[]; color: string; height?: number }> = ({ datos, color, height = 32 }) => {
  if (datos.length === 0) return null;
  const max = Math.max(...datos, 1);
  return (
    <div className="flex items-end gap-[2px]" style={{ height }}>
      {datos.map((val, i) => (
        <div
          key={i}
          className="flex-1 rounded-t-sm transition-all duration-300"
          style={{
            height: `${Math.max((val / max) * 100, 4)}%`,
            backgroundColor: color,
            opacity: i === datos.length - 1 ? 1 : 0.5 + (i / datos.length) * 0.5,
          }}
          title={`${val}`}
        />
      ))}
    </div>
  );
};

// ============== STAT CARD ==============
const StatCard: React.FC<{
  label: string;
  valor: number | string;
  icono: string;
  color: string;
  sparkData?: number[];
  tendencia?: number;
  theme: string;
}> = ({ label, valor, icono, color, sparkData, tendencia, theme }) => {
  const isArcade = theme === 'arcade';
  return (
    <div className={`p-3 lg:p-2.5 rounded-xl border transition-all ${
      isArcade ? 'bg-black border-[#00ff41]/20 hover:border-[#00ff41]/50' : 'bg-white/5 border-white/10 hover:border-white/20'
    }`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{icono}</span>
          <span className="text-[10px] font-bold uppercase tracking-wider opacity-50">{label}</span>
        </div>
        {tendencia !== undefined && tendencia !== 0 && (
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
            tendencia > 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
          }`}>
            {tendencia > 0 ? '+' : ''}{tendencia}%
          </span>
        )}
      </div>
      <p className={`text-xl lg:text-lg font-black mb-1 ${isArcade ? 'text-[#00ff41]' : 'text-white'}`}>
        {typeof valor === 'number' ? valor.toLocaleString('es') : valor}
      </p>
      {sparkData && sparkData.length > 1 && (
        <Sparkline datos={sparkData} color={color} />
      )}
    </div>
  );
};

// ============== BARRA HORIZONTAL ==============
const BarraHorizontal: React.FC<{
  items: { nombre: string; valor: number; color: string }[];
  theme: string;
}> = ({ items, theme }) => {
  const max = Math.max(...items.map(i => i.valor), 1);
  const isArcade = theme === 'arcade';
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i}>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-xs font-medium truncate max-w-[60%]">{item.nombre}</span>
            <span className={`text-xs font-bold ${isArcade ? 'text-[#00ff41]' : 'text-white'}`}>
              {item.valor.toLocaleString('es')}
            </span>
          </div>
          <div className={`h-2 rounded-full overflow-hidden ${isArcade ? 'bg-[#00ff41]/10' : 'bg-white/10'}`}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${(item.valor / max) * 100}%`, backgroundColor: item.color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

// ============== COMPONENTE PRINCIPAL ==============
export const MetricasEmpresaPanel: React.FC = () => {
  const { activeWorkspace, theme } = useStore();
  const [metricas, setMetricas] = useState<MetricaDiaria[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodo, setPeriodo] = useState<Periodo>('7d');
  const [empresaSeleccionada, setEmpresaSeleccionada] = useState<string | 'todas'>('todas');

  const diasPeriodo = periodo === '7d' ? 7 : periodo === '30d' ? 30 : 90;

  const cargarDatos = useCallback(async () => {
    if (!activeWorkspace?.id) return;
    setLoading(true);

    const fechaDesde = new Date();
    fechaDesde.setDate(fechaDesde.getDate() - diasPeriodo);

    const [metricasRes, empresasRes] = await Promise.all([
      supabase
        .from('metricas_empresa')
        .select('*')
        .eq('espacio_id', activeWorkspace.id)
        .gte('fecha', fechaDesde.toISOString().split('T')[0])
        .order('fecha', { ascending: true }),
      supabase
        .from('empresas')
        .select('id, nombre')
        .in('id',
          (await supabase
            .from('miembros_espacio')
            .select('empresa_id')
            .eq('espacio_id', activeWorkspace.id)
            .not('empresa_id', 'is', null)
          ).data?.map((m: any) => m.empresa_id).filter(Boolean) || []
        ),
    ]);

    if (metricasRes.data) setMetricas(metricasRes.data);
    if (empresasRes.data) setEmpresas(empresasRes.data);
    setLoading(false);
  }, [activeWorkspace?.id, diasPeriodo]);

  useEffect(() => { cargarDatos(); }, [cargarDatos]);

  // Filtrar por empresa seleccionada
  const metricasFiltradas = useMemo(() => {
    if (empresaSeleccionada === 'todas') return metricas;
    return metricas.filter(m => m.empresa_id === empresaSeleccionada);
  }, [metricas, empresaSeleccionada]);

  // Agregar métricas totales
  const totales = useMemo<MetricasAgregadas>(() => {
    const sum = (fn: (m: MetricaDiaria) => number) => metricasFiltradas.reduce((acc, m) => acc + fn(m), 0);
    const avg = (fn: (m: MetricaDiaria) => number) => {
      const vals = metricasFiltradas.map(fn).filter(v => v > 0);
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    };
    return {
      conexiones: sum(m => m.conexiones),
      usuarios_activos: Math.max(...metricasFiltradas.map(m => m.usuarios_activos), 0),
      reuniones_asistidas: sum(m => m.reuniones_asistidas),
      mensajes_chat: sum(m => m.mensajes_chat),
      emotes_enviados: sum(m => m.emotes_enviados),
      saludos_wave: sum(m => m.saludos_wave),
      teleports: sum(m => m.teleports),
      xp_ganado: sum(m => m.xp_ganado),
      nivel_promedio: Math.round(avg(m => m.nivel_promedio) * 10) / 10,
      racha_promedio: Math.round(avg(m => m.racha_promedio) * 10) / 10,
    };
  }, [metricasFiltradas]);

  // Datos para sparklines (agrupados por fecha)
  const sparkPorFecha = useMemo(() => {
    const fechas = [...new Set(metricasFiltradas.map(m => m.fecha))].sort();
    const agrupar = (fn: (m: MetricaDiaria) => number) =>
      fechas.map(f => metricasFiltradas.filter(m => m.fecha === f).reduce((acc, m) => acc + fn(m), 0));
    return {
      conexiones: agrupar(m => m.conexiones),
      usuarios: agrupar(m => m.usuarios_activos),
      reuniones: agrupar(m => m.reuniones_asistidas),
      chat: agrupar(m => m.mensajes_chat),
      emotes: agrupar(m => m.emotes_enviados),
      xp: agrupar(m => m.xp_ganado),
    };
  }, [metricasFiltradas]);

  // Ranking de empresas por XP
  const rankingEmpresas = useMemo(() => {
    const porEmpresa = new Map<string, number>();
    metricas.forEach(m => {
      porEmpresa.set(m.empresa_id, (porEmpresa.get(m.empresa_id) || 0) + m.xp_ganado);
    });
    const colores = ['#818cf8', '#34d399', '#f59e0b', '#f472b6', '#06b6d4'];
    return [...porEmpresa.entries()]
      .map(([id, xp], i) => ({
        nombre: empresas.find(e => e.id === id)?.nombre || 'Empresa',
        valor: xp,
        color: colores[i % colores.length],
      }))
      .sort((a, b) => b.valor - a.valor);
  }, [metricas, empresas]);

  // Ranking engagement (chat + emotes + waves)
  const rankingEngagement = useMemo(() => {
    const porEmpresa = new Map<string, number>();
    metricas.forEach(m => {
      const engagement = m.mensajes_chat + m.emotes_enviados + m.saludos_wave;
      porEmpresa.set(m.empresa_id, (porEmpresa.get(m.empresa_id) || 0) + engagement);
    });
    const colores = ['#a78bfa', '#2dd4bf', '#fbbf24', '#fb7185', '#22d3ee'];
    return [...porEmpresa.entries()]
      .map(([id, val], i) => ({
        nombre: empresas.find(e => e.id === id)?.nombre || 'Empresa',
        valor: val,
        color: colores[i % colores.length],
      }))
      .sort((a, b) => b.valor - a.valor);
  }, [metricas, empresas]);

  const isArcade = theme === 'arcade';
  const accentColor = isArcade ? '#00ff41' : '#818cf8';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className={`w-10 h-10 border-3 ${isArcade ? 'border-[#00ff41]' : 'border-indigo-500'} border-t-transparent rounded-full animate-spin`} />
      </div>
    );
  }

  return (
    <div className={`p-5 lg:p-4 ${isArcade ? 'bg-black' : 'bg-[#1a1a2e]'}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-5 lg:mb-4">
        <div>
          <h1 className={`text-xl lg:text-lg font-black ${isArcade ? 'text-[#00ff41]' : 'text-white'}`}>
            Métricas por Empresa
          </h1>
          <p className="text-[11px] opacity-50 mt-0.5">Telemetría segmentada de actividad y engagement</p>
        </div>
        <button
          onClick={cargarDatos}
          className={`p-2 rounded-lg transition-all ${isArcade ? 'hover:bg-[#00ff41]/20' : 'hover:bg-white/10'}`}
          title="Actualizar métricas"
        >
          <svg className="w-4 h-4 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 mb-4 lg:mb-3 flex-wrap">
        {/* Periodo */}
        <div className={`flex rounded-lg overflow-hidden border ${isArcade ? 'border-[#00ff41]/30' : 'border-white/10'}`}>
          {(['7d', '30d', '90d'] as Periodo[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriodo(p)}
              className={`px-3 py-1.5 text-[10px] font-bold transition-all ${
                periodo === p
                  ? (isArcade ? 'bg-[#00ff41] text-black' : 'bg-indigo-600 text-white')
                  : 'opacity-50 hover:opacity-100'
              }`}
            >
              {p === '7d' ? '7 días' : p === '30d' ? '30 días' : '90 días'}
            </button>
          ))}
        </div>

        {/* Selector empresa */}
        <select
          value={empresaSeleccionada}
          onChange={e => setEmpresaSeleccionada(e.target.value)}
          className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border focus:outline-none ${
            isArcade ? 'bg-black border-[#00ff41]/30 text-[#00ff41]' : 'bg-white/5 border-white/10'
          }`}
          style={{ colorScheme: 'dark' }}
        >
          <option value="todas" className="bg-zinc-800">Todas las empresas</option>
          {empresas.map(e => (
            <option key={e.id} value={e.id} className="bg-zinc-800">{e.nombre}</option>
          ))}
        </select>
      </div>

      {/* Grid de Stats */}
      {metricas.length === 0 ? (
        <div className="text-center py-12">
          <div className={`w-16 h-16 mx-auto mb-3 rounded-2xl ${isArcade ? 'bg-[#00ff41]/10' : 'bg-indigo-500/10'} flex items-center justify-center`}>
            <span className="text-3xl opacity-40">📊</span>
          </div>
          <p className="text-sm font-bold opacity-60 mb-1">Sin métricas aún</p>
          <p className="text-[10px] opacity-40">Las métricas se generan automáticamente cada hora</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5 lg:gap-2 mb-5 lg:mb-4">
            <StatCard
              label="Conexiones"
              valor={totales.conexiones}
              icono="🔗"
              color={accentColor}
              sparkData={sparkPorFecha.conexiones}
              theme={theme}
            />
            <StatCard
              label="Usuarios activos"
              valor={totales.usuarios_activos}
              icono="👥"
              color="#34d399"
              sparkData={sparkPorFecha.usuarios}
              theme={theme}
            />
            <StatCard
              label="Reuniones"
              valor={totales.reuniones_asistidas}
              icono="🎥"
              color="#f59e0b"
              sparkData={sparkPorFecha.reuniones}
              theme={theme}
            />
            <StatCard
              label="Mensajes chat"
              valor={totales.mensajes_chat}
              icono="💬"
              color="#06b6d4"
              sparkData={sparkPorFecha.chat}
              theme={theme}
            />
            <StatCard
              label="Emotes + Saludos"
              valor={totales.emotes_enviados + totales.saludos_wave}
              icono="🎭"
              color="#f472b6"
              sparkData={sparkPorFecha.emotes}
              theme={theme}
            />
            <StatCard
              label="XP Total"
              valor={totales.xp_ganado}
              icono="⚡"
              color="#a78bfa"
              sparkData={sparkPorFecha.xp}
              theme={theme}
            />
          </div>

          {/* Indicadores secundarios */}
          <div className="grid grid-cols-3 gap-2 mb-5 lg:mb-4">
            <div className={`p-2.5 rounded-xl border text-center ${isArcade ? 'bg-black border-[#00ff41]/20' : 'bg-white/5 border-white/10'}`}>
              <p className="text-[9px] font-bold uppercase opacity-40 mb-0.5">Nivel Prom.</p>
              <p className={`text-lg font-black ${isArcade ? 'text-[#00ff41]' : 'text-white'}`}>{totales.nivel_promedio}</p>
            </div>
            <div className={`p-2.5 rounded-xl border text-center ${isArcade ? 'bg-black border-[#00ff41]/20' : 'bg-white/5 border-white/10'}`}>
              <p className="text-[9px] font-bold uppercase opacity-40 mb-0.5">Racha Prom.</p>
              <p className={`text-lg font-black ${isArcade ? 'text-[#00ff41]' : 'text-white'}`}>{totales.racha_promedio}d</p>
            </div>
            <div className={`p-2.5 rounded-xl border text-center ${isArcade ? 'bg-black border-[#00ff41]/20' : 'bg-white/5 border-white/10'}`}>
              <p className="text-[9px] font-bold uppercase opacity-40 mb-0.5">Teleports</p>
              <p className={`text-lg font-black ${isArcade ? 'text-[#00ff41]' : 'text-white'}`}>{totales.teleports}</p>
            </div>
          </div>

          {/* Rankings lado a lado */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-2">
            {/* Ranking XP */}
            {rankingEmpresas.length > 0 && (
              <div className={`p-3 lg:p-2.5 rounded-xl border ${isArcade ? 'bg-black border-[#00ff41]/20' : 'bg-white/5 border-white/10'}`}>
                <h3 className="text-[10px] font-bold uppercase tracking-wider opacity-50 mb-2.5">⚡ Ranking XP por Empresa</h3>
                <BarraHorizontal items={rankingEmpresas} theme={theme} />
              </div>
            )}

            {/* Ranking Engagement */}
            {rankingEngagement.length > 0 && (
              <div className={`p-3 lg:p-2.5 rounded-xl border ${isArcade ? 'bg-black border-[#00ff41]/20' : 'bg-white/5 border-white/10'}`}>
                <h3 className="text-[10px] font-bold uppercase tracking-wider opacity-50 mb-2.5">🎭 Ranking Engagement</h3>
                <BarraHorizontal items={rankingEngagement} theme={theme} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default MetricasEmpresaPanel;
