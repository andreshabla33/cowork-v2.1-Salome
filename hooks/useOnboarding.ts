import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { CargoLaboral } from '../components/onboarding/CargoSelector';

interface OnboardingState {
  isLoading: boolean;
  error: string | null;
  espacioId: string | null;
  espacioNombre: string | null;
  cargoSugerido: CargoLaboral | null;
  onboardingCompletado: boolean;
  miembroId: string | null;
}

interface UseOnboardingReturn extends OnboardingState {
  completarOnboarding: (cargo: CargoLaboral) => Promise<boolean>;
  verificarOnboarding: () => Promise<void>;
}

export function useOnboarding(): UseOnboardingReturn {
  const [state, setState] = useState<OnboardingState>({
    isLoading: true,
    error: null,
    espacioId: null,
    espacioNombre: null,
    cargoSugerido: null,
    onboardingCompletado: false,
    miembroId: null,
  });

  // Verificar estado de onboarding del usuario
  const verificarOnboarding = useCallback(async () => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));

      // Obtener usuario actual
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      
      if (authError || !user) {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: 'No hay sesión activa',
        }));
        return;
      }

      // Buscar membresía del usuario con espacio
      const { data: miembro, error: miembroError } = await supabase
        .from('miembros_espacio')
        .select(`
          id,
          espacio_id,
          cargo,
          cargo_id,
          onboarding_completado,
          espacios_trabajo:espacio_id (
            id,
            nombre
          )
        `)
        .eq('usuario_id', user.id)
        .eq('aceptado', true)
        .single();

      if (miembroError && miembroError.code !== 'PGRST116') {
        console.error('Error buscando membresía:', miembroError);
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: 'Error al verificar membresía',
        }));
        return;
      }

      if (!miembro) {
        // Usuario sin espacio - redirigir a crear/unirse
        setState(prev => ({
          ...prev,
          isLoading: false,
          onboardingCompletado: false,
        }));
        return;
      }

      // Verificar si hay cargo sugerido en invitación pendiente
      const { data: invitacion } = await supabase
        .from('invitaciones_pendientes')
        .select('cargo_sugerido')
        .eq('email', user.email)
        .eq('usada', true)
        .single();

      const espacioData = miembro.espacios_trabajo as any;
      
      setState({
        isLoading: false,
        error: null,
        espacioId: miembro.espacio_id,
        espacioNombre: espacioData?.nombre || 'tu espacio',
        cargoSugerido: invitacion?.cargo_sugerido as CargoLaboral || null,
        onboardingCompletado: miembro.onboarding_completado || false,
        miembroId: miembro.id,
      });

    } catch (err) {
      console.error('Error en verificarOnboarding:', err);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: 'Error inesperado al verificar onboarding',
      }));
    }
  }, []);

  // Completar onboarding guardando el cargo
  const completarOnboarding = useCallback(async (cargo: CargoLaboral): Promise<boolean> => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));

      if (!state.miembroId) {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: 'No se encontró la membresía',
        }));
        return false;
      }

      // Actualizar cargo y marcar onboarding como completado
      const { error: updateError } = await supabase
        .from('miembros_espacio')
        .update({
          cargo_id: cargo,
          onboarding_completado: true,
        })
        .eq('id', state.miembroId);

      if (updateError) {
        console.error('Error actualizando cargo:', updateError);
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: 'Error al guardar el cargo',
        }));
        return false;
      }

      setState(prev => ({
        ...prev,
        isLoading: false,
        onboardingCompletado: true,
      }));

      return true;

    } catch (err) {
      console.error('Error en completarOnboarding:', err);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: 'Error inesperado al completar onboarding',
      }));
      return false;
    }
  }, [state.miembroId]);

  // Verificar al montar
  useEffect(() => {
    verificarOnboarding();
  }, [verificarOnboarding]);

  return {
    ...state,
    completarOnboarding,
    verificarOnboarding,
  };
}

export default useOnboarding;
