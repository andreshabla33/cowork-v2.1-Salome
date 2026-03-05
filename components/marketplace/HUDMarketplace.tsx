'use client';

import React from 'react';
import { Building2, MapPin, Eye, ShoppingCart, Sparkles, ArrowLeft } from 'lucide-react';
import type { TerrenoMarketplace, ZonaEmpresa } from '@/types';

interface HUDMarketplaceProps {
  terrenos: TerrenoMarketplace[];
  zonas: ZonaEmpresa[];
  filtroTier: string | null;
  setFiltroTier: (tier: string | null) => void;
  onVolverHome: () => void;
}

export const HUDMarketplace: React.FC<HUDMarketplaceProps> = ({
  terrenos,
  zonas,
  filtroTier,
  setFiltroTier,
  onVolverHome,
}) => {
  const disponibles = terrenos.filter((t) => t.estado === 'disponible').length;
  const reservados = terrenos.filter((t) => t.estado === 'reservado').length;
  const empresasActivas = zonas.filter((z) => !z.es_comun && z.empresa_id).length;

  return (
    <>
      {/* Logo + volver */}
      <div className="fixed top-5 left-5 z-40 flex items-center gap-3">
        <button
          onClick={onVolverHome}
          className="flex items-center gap-2 px-4 py-2.5 bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl text-white hover:bg-white/10 transition-all group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          <span className="text-sm font-medium">Volver</span>
        </button>
        <div className="px-4 py-2.5 bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl">
          <h1 className="text-sm font-black text-white tracking-tight">
            <span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">Cowork</span>
            <span className="text-zinc-400 font-normal ml-1.5">Marketplace</span>
          </h1>
        </div>
      </div>

      {/* Stats bar */}
      <div className="fixed top-5 right-5 z-40 flex items-center gap-2">
        <div className="flex items-center gap-4 px-5 py-2.5 bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl">
          <StatItem icon={<Building2 className="w-3.5 h-3.5 text-violet-400" />} label="Empresas" valor={empresasActivas} />
          <div className="w-px h-5 bg-white/10" />
          <StatItem icon={<MapPin className="w-3.5 h-3.5 text-green-400" />} label="Disponibles" valor={disponibles} />
          <div className="w-px h-5 bg-white/10" />
          <StatItem icon={<Eye className="w-3.5 h-3.5 text-amber-400" />} label="Reservados" valor={reservados} />
        </div>
      </div>

      {/* Filtros por tier */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40">
        <div className="flex items-center gap-2 px-4 py-2.5 bg-black/70 backdrop-blur-xl border border-white/10 rounded-2xl">
          <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider mr-2">Filtrar:</span>
          <FilterChip
            label="Todos"
            activo={filtroTier === null}
            onClick={() => setFiltroTier(null)}
            color="white"
          />
          <FilterChip
            label="Starter"
            activo={filtroTier === 'starter'}
            onClick={() => setFiltroTier('starter')}
            color="#22c55e"
          />
          <FilterChip
            label="Professional"
            activo={filtroTier === 'professional'}
            onClick={() => setFiltroTier('professional')}
            color="#3b82f6"
          />
          <FilterChip
            label="Enterprise"
            activo={filtroTier === 'enterprise'}
            onClick={() => setFiltroTier('enterprise')}
            color="#a855f7"
          />
        </div>
      </div>

      {/* Instrucciones */}
      <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
        <p className="text-[10px] text-zinc-500 text-center font-medium tracking-wider uppercase">
          Arrastra para rotar · Scroll para zoom · Click en terreno para detalles
        </p>
      </div>
    </>
  );
};

const StatItem: React.FC<{ icon: React.ReactNode; label: string; valor: number }> = ({ icon, label, valor }) => (
  <div className="flex items-center gap-1.5">
    {icon}
    <div>
      <p className="text-white font-bold text-sm leading-none">{valor}</p>
      <p className="text-[9px] text-zinc-500 uppercase tracking-wider">{label}</p>
    </div>
  </div>
);

const FilterChip: React.FC<{
  label: string;
  activo: boolean;
  onClick: () => void;
  color: string;
}> = ({ label, activo, onClick, color }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
      activo
        ? 'bg-white/15 text-white border border-white/20'
        : 'bg-white/5 text-zinc-400 border border-transparent hover:bg-white/10 hover:text-white'
    }`}
    style={activo ? { borderColor: color + '60' } : undefined}
  >
    <span
      className="inline-block w-2 h-2 rounded-full mr-1.5"
      style={{ backgroundColor: color === 'white' ? '#888' : color }}
    />
    {label}
  </button>
);
