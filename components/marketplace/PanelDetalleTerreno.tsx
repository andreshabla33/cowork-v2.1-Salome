'use client';

import React from 'react';
import { X, MapPin, Users, DoorOpen, Palette, Headphones, Star, ShoppingCart, Clock } from 'lucide-react';
import type { TerrenoMarketplace } from '@/types';
import { TIER_CONFIG } from '@/lib/terrenosMarketplace';

interface PanelDetalleTerrenoProps {
  terreno: TerrenoMarketplace | null;
  onCerrar: () => void;
  onReservar?: (terreno: TerrenoMarketplace) => void;
}

export const PanelDetalleTerreno: React.FC<PanelDetalleTerrenoProps> = ({
  terreno,
  onCerrar,
  onReservar,
}) => {
  if (!terreno) return null;

  const tier = TIER_CONFIG[terreno.tier] || TIER_CONFIG.starter;
  const esDisponible = terreno.estado === 'disponible';
  const esReservado = terreno.estado === 'reservado';
  const features = terreno.features || {} as any;

  const formatPrecio = (valor: number) => {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: terreno.moneda || 'USD', minimumFractionDigits: 0 }).format(valor);
  };

  return (
    <div className="fixed right-0 top-0 bottom-0 w-[420px] max-w-[90vw] bg-zinc-900/95 backdrop-blur-xl border-l border-white/10 z-50 flex flex-col shadow-2xl shadow-black/50 animate-in slide-in-from-right duration-300">
      {/* Header */}
      <div className={`p-6 bg-gradient-to-br ${tier.bgGradient} border-b border-white/10`}>
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            {terreno.destacado && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-500/20 border border-amber-500/30 rounded-full text-[10px] font-bold text-amber-300 uppercase tracking-wider mb-2">
                <Star className="w-3 h-3" /> Destacado
              </span>
            )}
            <h2 className="text-xl font-bold text-white">{terreno.nombre}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${tier.textColor} bg-white/5 border ${tier.borderColor}`}>
                {tier.label}
              </span>
              <span className="text-xs text-zinc-400">{tier.subtitulo}</span>
            </div>
          </div>
          <button
            onClick={onCerrar}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Precio */}
        <div className="flex items-end gap-3">
          <div>
            <p className="text-3xl font-black text-white">
              {formatPrecio(terreno.precio_mensual)}
              <span className="text-sm font-normal text-zinc-400">/mes</span>
            </p>
          </div>
          {terreno.precio_anual > 0 && (
            <div className="pb-1">
              <p className="text-sm text-zinc-400">
                o {formatPrecio(terreno.precio_anual)}/año
              </p>
              <p className="text-[10px] text-green-400 font-bold">
                Ahorra {Math.round((1 - terreno.precio_anual / (terreno.precio_mensual * 12)) * 100)}%
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Contenido scrollable */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Descripción */}
        {terreno.descripcion && (
          <div>
            <p className="text-sm text-zinc-300 leading-relaxed">{terreno.descripcion}</p>
          </div>
        )}

        {/* Dimensiones */}
        <div className="bg-white/5 rounded-xl p-4 border border-white/5">
          <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3">Dimensiones</h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-zinc-500" />
              <div>
                <p className="text-xs text-zinc-500">Ubicación</p>
                <p className="text-sm font-medium text-white">({terreno.posicion_x}, {terreno.posicion_y})</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded border border-zinc-500 flex items-center justify-center">
                <div className="w-2 h-2 bg-zinc-500 rounded-sm" />
              </div>
              <div>
                <p className="text-xs text-zinc-500">Tamaño</p>
                <p className="text-sm font-medium text-white">{terreno.ancho} × {terreno.alto} u²</p>
              </div>
            </div>
          </div>
        </div>

        {/* Features incluidos */}
        <div className="bg-white/5 rounded-xl p-4 border border-white/5">
          <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3">Incluido en el terreno</h4>
          <div className="space-y-2.5">
            <FeatureRow
              icon={<Users className="w-4 h-4" />}
              label="Miembros"
              valor={features.max_miembros === -1 ? 'Ilimitados' : `Hasta ${features.max_miembros}`}
            />
            <FeatureRow
              icon={<DoorOpen className="w-4 h-4" />}
              label="Salas de reunión"
              valor={features.salas_reunion === -1 ? 'Ilimitadas' : `${features.salas_reunion}`}
            />
            <FeatureRow
              icon={<Palette className="w-4 h-4" />}
              label="Personalización"
              valor={features.personalizacion === 'total' ? 'Total (3D custom)' : features.personalizacion === 'avanzada' ? 'Avanzada (color, logo, objetos)' : 'Básica (color, logo)'}
            />
            <FeatureRow
              icon={<ShoppingCart className="w-4 h-4" />}
              label="Showroom"
              valor={features.showroom ? 'Incluido' : 'No incluido'}
              activo={features.showroom}
            />
            <FeatureRow
              icon={<Headphones className="w-4 h-4" />}
              label="Soporte"
              valor={features.soporte === 'dedicado' ? 'Dedicado 24/7' : features.soporte === 'prioritario' ? 'Prioritario' : 'Comunidad'}
            />
          </div>
        </div>

        {/* Estado */}
        {esReservado && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-red-400" />
              <p className="text-sm font-medium text-red-300">Este terreno está reservado temporalmente</p>
            </div>
            <p className="text-xs text-red-400/70 mt-1">Puede quedar disponible nuevamente si la reserva expira.</p>
          </div>
        )}
      </div>

      {/* Footer con CTA */}
      <div className="p-6 border-t border-white/10 bg-zinc-950/50">
        {esDisponible ? (
          <button
            onClick={() => onReservar?.(terreno)}
            className="w-full py-3.5 px-6 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-400 hover:to-emerald-400 text-white font-bold rounded-xl text-sm transition-all shadow-lg shadow-green-500/20 flex items-center justify-center gap-2"
          >
            <ShoppingCart className="w-4 h-4" />
            Reservar este terreno — {formatPrecio(terreno.precio_mensual)}/mes
          </button>
        ) : (
          <button
            disabled
            className="w-full py-3.5 px-6 bg-zinc-700 text-zinc-400 font-bold rounded-xl text-sm cursor-not-allowed"
          >
            {esReservado ? 'Terreno reservado' : 'No disponible'}
          </button>
        )}
        <p className="text-[10px] text-zinc-500 text-center mt-2">
          La reserva dura 48h. Puedes cancelar en cualquier momento.
        </p>
      </div>
    </div>
  );
};

const FeatureRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  valor: string;
  activo?: boolean;
}> = ({ icon, label, valor, activo }) => (
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-2 text-zinc-400">
      {icon}
      <span className="text-xs">{label}</span>
    </div>
    <span className={`text-xs font-medium ${activo === false ? 'text-zinc-600' : 'text-white'}`}>
      {valor}
    </span>
  </div>
);
