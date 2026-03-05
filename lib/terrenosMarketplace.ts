/**
 * Funciones para interactuar con terrenos_marketplace (Supabase)
 * Lectura pública (sin auth), escritura solo admin
 */
import { supabase } from '@/lib/supabase';
import type { TerrenoMarketplace, ZonaEmpresa } from '@/types';

export const cargarTerrenosPublicos = async (
  espacioId: string
): Promise<TerrenoMarketplace[]> => {
  const { data, error } = await supabase
    .from('terrenos_marketplace')
    .select('*')
    .eq('espacio_id', espacioId)
    .in('estado', ['disponible', 'reservado'])
    .order('destacado', { ascending: false })
    .order('orden_visual');

  if (error) {
    console.warn('Error cargando terrenos:', error.message);
    return [];
  }

  return (data || []) as TerrenoMarketplace[];
};

export const cargarZonasPublicas = async (
  espacioId: string
): Promise<ZonaEmpresa[]> => {
  const { data, error } = await supabase
    .from('zonas_empresa')
    .select('id, empresa_id, espacio_id, nombre_zona, posicion_x, posicion_y, ancho, alto, color, estado, es_comun, spawn_x, spawn_y, modelo_url, empresa:empresas(nombre, logo_url)')
    .eq('espacio_id', espacioId)
    .eq('estado', 'activa');

  if (error) {
    console.warn('Error cargando zonas públicas:', error.message);
    return [];
  }

  return (data || []) as ZonaEmpresa[];
};

export const cargarTodosTerrenos = async (
  espacioId: string
): Promise<TerrenoMarketplace[]> => {
  const { data, error } = await supabase
    .from('terrenos_marketplace')
    .select('*')
    .eq('espacio_id', espacioId)
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('Error cargando todos los terrenos:', error.message);
    return [];
  }

  return (data || []) as TerrenoMarketplace[];
};

export const guardarTerreno = async (
  terreno: Partial<TerrenoMarketplace> & { espacio_id: string }
): Promise<TerrenoMarketplace | null> => {
  const payload = {
    ...terreno,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('terrenos_marketplace')
    .upsert(payload)
    .select('*')
    .single();

  if (error) {
    console.warn('Error guardando terreno:', error.message);
    return null;
  }

  return data as TerrenoMarketplace;
};

export const eliminarTerreno = async (id: string): Promise<boolean> => {
  const { error } = await supabase
    .from('terrenos_marketplace')
    .delete()
    .eq('id', id);

  if (error) {
    console.warn('Error eliminando terreno:', error.message);
    return false;
  }
  return true;
};

export const reservarTerreno = async (
  terrenoId: string,
  usuarioId: string
): Promise<boolean> => {
  const reservaHasta = new Date();
  reservaHasta.setHours(reservaHasta.getHours() + 48);

  const { error } = await supabase
    .from('terrenos_marketplace')
    .update({
      estado: 'reservado',
      reservado_por: usuarioId,
      reservado_hasta: reservaHasta.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', terrenoId)
    .eq('estado', 'disponible');

  if (error) {
    console.warn('Error reservando terreno:', error.message);
    return false;
  }
  return true;
};

export const TIER_CONFIG = {
  starter: {
    label: 'Starter',
    subtitulo: 'Oficina Básica',
    color: '#22c55e',
    bgGradient: 'from-green-500/20 to-emerald-500/20',
    borderColor: 'border-green-500/30',
    textColor: 'text-green-400',
  },
  professional: {
    label: 'Professional',
    subtitulo: 'Piso Corporativo',
    color: '#3b82f6',
    bgGradient: 'from-blue-500/20 to-indigo-500/20',
    borderColor: 'border-blue-500/30',
    textColor: 'text-blue-400',
  },
  enterprise: {
    label: 'Enterprise',
    subtitulo: 'Edificio Propio',
    color: '#a855f7',
    bgGradient: 'from-purple-500/20 to-violet-500/20',
    borderColor: 'border-purple-500/30',
    textColor: 'text-violet-400',
  },
} as const;
