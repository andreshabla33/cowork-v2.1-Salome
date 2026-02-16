'use client';

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Crown,
  Settings,
  Users,
  UserCheck,
  Search,
  TrendingUp,
  Target,
  Briefcase,
  Rocket,
  Package,
  RefreshCw,
  User,
  HelpCircle,
  Check,
  ChevronRight,
  Sparkles,
  Shield,
} from 'lucide-react';

// Tipo flexible — ahora viene de BD, no es un enum fijo
export type CargoLaboral = string;

// Categorías de cargos para organizar la UI
export type CategoriaCargoInfo = {
  id: string;
  nombre: string;
  descripcion: string;
  color: string;
  icono: React.ComponentType<{ className?: string }>;
};

// Cargo individual (puede venir de BD o hardcoded como fallback)
export type CargoInfo = {
  id: string;
  dbId: string;
  nombre: string;
  descripcion: string;
  categoria: string;
  icono: React.ComponentType<{ className?: string }>;
  tieneAnalisisAvanzado: boolean;
  analisisDisponibles: string[];
  soloAdmin?: boolean;
};

// Cargo desde BD
export interface CargoDB {
  id: string;
  nombre: string;
  clave: string;
  descripcion: string | null;
  categoria: string;
  icono: string;
  orden: number;
  activo: boolean;
  tiene_analisis_avanzado: boolean;
  analisis_disponibles: string[];
  solo_admin: boolean;
}

// Mapeo de nombre de icono (BD) a componente Lucide
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  crown: Crown,
  settings: Settings,
  users: Users,
  'user-check': UserCheck,
  search: Search,
  'trending-up': TrendingUp,
  target: Target,
  briefcase: Briefcase,
  rocket: Rocket,
  package: Package,
  'refresh-cw': RefreshCw,
  user: User,
  'help-circle': HelpCircle,
};

// Colores por categoría
const COLORES_CATEGORIA: Record<string, string> = {
  liderazgo: 'from-amber-500 to-orange-600',
  rrhh: 'from-purple-500 to-pink-600',
  comercial: 'from-emerald-500 to-teal-600',
  producto: 'from-blue-500 to-indigo-600',
  otros: 'from-slate-500 to-gray-600',
  general: 'from-slate-500 to-gray-600',
};

// Nombres de categoría para UI
const NOMBRES_CATEGORIA: Record<string, { nombre: string; descripcion: string }> = {
  liderazgo: { nombre: 'Liderazgo Ejecutivo', descripcion: 'Roles de alta dirección con acceso completo' },
  rrhh: { nombre: 'Recursos Humanos', descripcion: 'Gestión del talento y desarrollo organizacional' },
  comercial: { nombre: 'Área Comercial', descripcion: 'Ventas, negocios y relación con clientes' },
  producto: { nombre: 'Producto y Desarrollo', descripcion: 'Gestión de producto y metodologías ágiles' },
  otros: { nombre: 'Otros Roles', descripcion: 'Colaboradores y roles adicionales' },
  general: { nombre: 'Otros Roles', descripcion: 'Colaboradores y roles adicionales' },
};

// Función para convertir cargos de BD a formato del componente
function cargosDBToCargoInfo(cargosDB: CargoDB[]): CargoInfo[] {
  return cargosDB
    .filter(c => c.activo)
    .sort((a, b) => a.orden - b.orden)
    .map(c => ({
      id: c.clave || c.nombre.toLowerCase().replace(/\s+/g, '_'),
      dbId: c.id,
      nombre: c.nombre,
      descripcion: c.descripcion || '',
      categoria: c.categoria,
      icono: ICON_MAP[c.icono] || User,
      tieneAnalisisAvanzado: c.tiene_analisis_avanzado,
      analisisDisponibles: c.analisis_disponibles || [],
      soloAdmin: c.solo_admin,
    }));
}

// Función para derivar categorías únicas de los cargos
function derivarCategorias(cargos: CargoInfo[]): Record<string, CategoriaCargoInfo> {
  const cats: Record<string, CategoriaCargoInfo> = {};
  const seen = new Set<string>();
  for (const c of cargos) {
    if (seen.has(c.categoria)) continue;
    seen.add(c.categoria);
    const catIcon = ICON_MAP[c.categoria === 'liderazgo' ? 'crown' : c.categoria === 'rrhh' ? 'users' : c.categoria === 'comercial' ? 'trending-up' : c.categoria === 'producto' ? 'package' : 'user'] || User;
    const meta = NOMBRES_CATEGORIA[c.categoria] || { nombre: c.categoria, descripcion: '' };
    cats[c.categoria] = {
      id: c.categoria,
      nombre: meta.nombre,
      descripcion: meta.descripcion,
      color: COLORES_CATEGORIA[c.categoria] || 'from-slate-500 to-gray-600',
      icono: catIcon,
    };
  }
  return cats;
}

interface CargoSelectorProps {
  onSelect: (cargo: string) => void;
  cargoSugerido?: string;
  espacioNombre?: string;
  isLoading?: boolean;
  rolUsuario?: string;
  cargosDB?: CargoDB[];
}

export const CargoSelector: React.FC<CargoSelectorProps> = ({
  onSelect,
  cargoSugerido,
  espacioNombre = 'tu nuevo espacio',
  isLoading = false,
  rolUsuario = 'member',
  cargosDB,
}) => {
  // Convertir cargos de BD a formato interno
  const cargosInfo = cargosDB ? cargosDBToCargoInfo(cargosDB) : [];
  const CATEGORIAS = derivarCategorias(cargosInfo);

  const [cargoSeleccionado, setCargoSeleccionado] = useState<string | null>(
    cargoSugerido || null
  );
  const [categoriaExpandida, setCategoriaExpandida] = useState<string | null>(
    cargoSugerido ? cargosInfo.find(c => c.id === cargoSugerido)?.categoria || null : null
  );
  const [hoveredCargo, setHoveredCargo] = useState<string | null>(null);

  // Filtrar categorías según el rol del usuario (solo admins ven liderazgo)
  const esAdmin = rolUsuario === 'admin' || rolUsuario === 'super_admin';
  const categoriasVisibles = Object.entries(CATEGORIAS).filter(
    ([catId]) => esAdmin || catId !== 'liderazgo'
  );

  // Filtrar cargos restringidos para no admins (solo_admin)
  const cargosPermitidos = esAdmin
    ? cargosInfo
    : cargosInfo.filter(c => !c.soloAdmin);

  const handleSelectCargo = useCallback((cargo: string) => {
    setCargoSeleccionado(cargo);
  }, []);

  const handleConfirm = useCallback(() => {
    if (cargoSeleccionado) {
      const cargoInfo = cargosPermitidos.find(c => c.id === cargoSeleccionado);
      onSelect(cargoInfo?.dbId || cargoSeleccionado);
    }
  }, [cargoSeleccionado, cargosPermitidos, onSelect]);

  // Usar cargosPermitidos (filtrados según rol) en lugar de CARGOS_INFO
  const cargosPorCategoria = cargosPermitidos.reduce((acc, cargo) => {
    if (!acc[cargo.categoria]) {
      acc[cargo.categoria] = [];
    }
    acc[cargo.categoria].push(cargo);
    return acc;
  }, {} as Record<string, CargoInfo[]>);

  const cargoActual = cargoSeleccionado
    ? cargosPermitidos.find(c => c.id === cargoSeleccionado)
    : null;

  return (
    <div className="fixed inset-0 bg-[#050508] flex items-center justify-center p-4 lg:p-3 overflow-y-auto">
      {/* Fondo neon + grid — mismo que LoginScreen */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-30%] left-[-20%] w-[70%] h-[70%] rounded-full bg-violet-600/15 blur-[180px] animate-pulse" />
        <div className="absolute bottom-[-30%] right-[-20%] w-[70%] h-[70%] rounded-full bg-cyan-500/10 blur-[180px] animate-pulse" style={{ animationDelay: '1.5s' }} />
        <div className="absolute top-[40%] left-[50%] w-[40%] h-[40%] rounded-full bg-fuchsia-600/10 blur-[120px] animate-pulse" style={{ animationDelay: '3s' }} />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md lg:max-w-sm relative z-10 my-auto"
      >
        <div className="absolute -inset-1 bg-gradient-to-r from-violet-600/20 via-fuchsia-600/20 to-cyan-500/20 rounded-[40px] lg:rounded-[32px] blur-xl opacity-60" />
        <div className="relative backdrop-blur-xl bg-white/[0.03] border border-white/[0.08] rounded-[36px] lg:rounded-[28px] p-6 lg:p-5">

        {/* Header */}
        <div className="text-center mb-5 lg:mb-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-gradient-to-r from-violet-600/20 to-fuchsia-600/20 border border-violet-500/30 rounded-full text-violet-400 text-[9px] lg:text-[8px] font-bold uppercase tracking-wider mb-3">
            Paso 3 de 4
          </div>
          <div className="relative group mx-auto w-12 h-12 lg:w-10 lg:h-10 mb-3">
            <div className="absolute -inset-2 bg-gradient-to-r from-violet-600 to-fuchsia-600 rounded-xl blur-lg opacity-40" />
            <div className="relative w-12 h-12 lg:w-10 lg:h-10 bg-gradient-to-br from-violet-600 via-fuchsia-600 to-cyan-500 rounded-xl flex items-center justify-center">
              <Sparkles className="w-6 h-6 lg:w-5 lg:h-5 text-white" />
            </div>
          </div>
          <h1 className="text-2xl lg:text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-violet-200 to-white mb-1">
            ¡Bienvenido a {espacioNombre}!
          </h1>
          <p className="text-zinc-500 text-xs lg:text-[10px]">
            Cuéntanos cuál es tu cargo en el equipo
          </p>
        </div>

        {/* Categorías y Cargos */}
        <div className="bg-black/20 backdrop-blur-sm rounded-2xl lg:rounded-xl border border-white/[0.06] p-4 lg:p-3 mb-4 lg:mb-3 max-h-[45vh] overflow-y-auto scrollbar-thin scrollbar-thumb-violet-500/20">
          <div className="space-y-2.5">
            {categoriasVisibles.map(([catId, categoria], index) => {
              const cargos = cargosPorCategoria[catId] || [];
              const isExpanded = categoriaExpandida === catId;
              const hasSelectedCargo = cargos.some(c => c.id === cargoSeleccionado);
              const CatIcon = categoria.icono;

              return (
                <motion.div
                  key={catId}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                >
                  {/* Categoría Header */}
                  <button
                    onClick={() => setCategoriaExpandida(isExpanded ? null : catId)}
                    className={`w-full flex items-center justify-between p-3 lg:p-2.5 rounded-xl transition-all duration-300 ${
                      isExpanded || hasSelectedCargo
                        ? `bg-gradient-to-r ${categoria.color} text-white shadow-lg shadow-violet-500/10`
                        : 'bg-white/[0.03] text-zinc-300 hover:bg-white/[0.06] border border-white/[0.06]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className={`p-1.5 rounded-lg ${isExpanded || hasSelectedCargo ? 'bg-white/20' : 'bg-white/[0.06]'}`}>
                        <CatIcon className="w-4 h-4" />
                      </div>
                      <div className="text-left">
                        <div className="font-bold text-sm lg:text-xs">{categoria.nombre}</div>
                        <div className={`text-[10px] lg:text-[9px] ${isExpanded || hasSelectedCargo ? 'text-white/70' : 'text-zinc-500'}`}>
                          {categoria.descripcion}
                        </div>
                      </div>
                    </div>
                    <ChevronRight
                      className={`w-4 h-4 transition-transform duration-300 ${
                        isExpanded ? 'rotate-90' : ''
                      }`}
                    />
                  </button>

                  {/* Cargos dentro de la categoría */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="overflow-hidden"
                      >
                        <div className="grid grid-cols-1 gap-2 pt-2 pl-3">
                          {cargos.map((cargo) => {
                            const CargoIcon = cargo.icono;
                            const isSelected = cargoSeleccionado === cargo.id;
                            const isHovered = hoveredCargo === cargo.id;

                            return (
                              <motion.button
                                key={cargo.id}
                                onClick={() => handleSelectCargo(cargo.id)}
                                onMouseEnter={() => setHoveredCargo(cargo.id)}
                                onMouseLeave={() => setHoveredCargo(null)}
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                className={`relative p-3 lg:p-2.5 rounded-xl border text-left transition-all duration-300 ${
                                  isSelected
                                    ? 'border-violet-500 bg-violet-500/15 shadow-lg shadow-violet-500/10'
                                    : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]'
                                }`}
                              >
                                <div className="flex items-start gap-2.5">
                                  <div className={`p-1.5 rounded-lg ${
                                    isSelected ? 'bg-violet-500 text-white' : 'bg-white/[0.06] text-zinc-400'
                                  }`}>
                                    <CargoIcon className="w-4 h-4" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className={`font-bold text-xs lg:text-[11px] ${isSelected ? 'text-white' : 'text-zinc-200'}`}>
                                      {cargo.nombre}
                                    </div>
                                    <div className="text-[10px] lg:text-[9px] text-zinc-500 truncate">
                                      {cargo.descripcion}
                                    </div>
                                    {/* Indicador de análisis avanzado */}
                                    {cargo.tieneAnalisisAvanzado && (
                                      <div className="mt-1 flex items-center gap-1">
                                        <Shield className="w-3 h-3 text-emerald-400" />
                                        <span className="text-[9px] text-emerald-400">
                                          Análisis avanzado
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                  {isSelected && (
                                    <motion.div
                                      initial={{ scale: 0 }}
                                      animate={{ scale: 1 }}
                                      className="absolute top-1.5 right-1.5 w-5 h-5 bg-violet-500 rounded-full flex items-center justify-center"
                                    >
                                      <Check className="w-3 h-3 text-white" />
                                    </motion.div>
                                  )}
                                </div>

                                {/* Tooltip con análisis disponibles */}
                                <AnimatePresence>
                                  {isHovered && cargo.analisisDisponibles.length > 0 && (
                                    <motion.div
                                      initial={{ opacity: 0, y: 5 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      exit={{ opacity: 0, y: 5 }}
                                      className="absolute left-0 right-0 -bottom-2 translate-y-full z-10 p-2.5 bg-zinc-900 border border-white/[0.08] rounded-lg shadow-xl"
                                    >
                                      <div className="text-[9px] text-zinc-500 mb-1">Análisis disponibles:</div>
                                      <div className="flex flex-wrap gap-1">
                                        {cargo.analisisDisponibles.map((a, i) => (
                                          <span key={i} className="px-1.5 py-0.5 bg-violet-500/20 text-violet-300 rounded text-[9px]">
                                            {a}
                                          </span>
                                        ))}
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </motion.button>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Footer con info y botón */}
        <div className="flex items-center justify-between gap-3 mt-1">
          <div className="flex-1 min-w-0">
            {cargoActual ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-2 text-zinc-300"
              >
                <div className="p-1.5 bg-violet-500/20 rounded-lg">
                  <cargoActual.icono className="w-3.5 h-3.5 text-violet-400" />
                </div>
                <div className="truncate">
                  <div className="text-[9px] text-zinc-500">Seleccionado:</div>
                  <div className="font-bold text-[11px] text-white truncate">{cargoActual.nombre}</div>
                </div>
              </motion.div>
            ) : (
              <p className="text-[10px] text-zinc-500">
                Selecciona tu cargo
              </p>
            )}
          </div>

          {/* Botón Continuar */}
          <motion.button
            onClick={handleConfirm}
            disabled={!cargoSeleccionado || isLoading}
            whileHover={{ scale: cargoSeleccionado ? 1.02 : 1 }}
            whileTap={{ scale: cargoSeleccionado ? 0.98 : 1 }}
            className={`px-5 py-3 lg:py-2.5 rounded-xl font-black text-xs lg:text-[10px] uppercase tracking-[0.15em] flex items-center gap-2 transition-all duration-300 ${
              cargoSeleccionado
                ? 'bg-gradient-to-r from-violet-600 via-fuchsia-600 to-cyan-500 text-white shadow-2xl shadow-violet-600/30'
                : 'bg-white/[0.03] border border-white/[0.08] text-zinc-500 cursor-not-allowed'
            }`}
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-4 h-4 lg:w-3.5 lg:h-3.5 animate-spin" />
                Guardando...
              </>
            ) : (
              <>
                Continuar
                <ChevronRight className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
              </>
            )}
          </motion.button>
        </div>

        </div>{/* close glassmorphism card */}
      </motion.div>
    </div>
  );
};

export default CargoSelector;
export { ICON_MAP, COLORES_CATEGORIA, NOMBRES_CATEGORIA };
