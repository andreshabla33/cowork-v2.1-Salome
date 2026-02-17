import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { SettingToggle } from '../components/SettingToggle';
import { SettingDropdown } from '../components/SettingDropdown';
import { SettingSection } from '../components/SettingSection';
import { Language, getCurrentLanguage, subscribeToLanguageChange } from '../../../lib/i18n';

interface Guest {
  id: string;
  email: string;
  nombre?: string;
  acceso_hasta: string;
  creado_en: string;
}

interface GuestsSettings {
  guestCheckInEnabled: boolean;
  requireApproval: boolean;
  guestAccessDuration: number;
  allowGuestChat: boolean;
  allowGuestVideo: boolean;
}

interface SettingsGuestsProps {
  settings: GuestsSettings;
  onSettingsChange: (settings: GuestsSettings) => void;
  workspaceId: string;
}

export const SettingsGuests: React.FC<SettingsGuestsProps> = ({
  settings,
  onSettingsChange,
  workspaceId
}) => {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentLang, setCurrentLang] = useState<Language>(getCurrentLanguage());

  // Escuchar cambios de idioma
  useEffect(() => {
    const unsubscribe = subscribeToLanguageChange(() => {
      setCurrentLang(getCurrentLanguage());
    });
    return unsubscribe;
  }, []);

  // Cargar settings del espacio desde BD al montar
  useEffect(() => {
    const loadFromDB = async () => {
      if (!workspaceId) return;
      const { data } = await supabase
        .from('espacios_trabajo')
        .select('configuracion')
        .eq('id', workspaceId)
        .single();
      if (data?.configuracion?.guests) {
        const g = data.configuracion.guests;
        onSettingsChange({
          guestCheckInEnabled: g.checkInEnabled ?? settings.guestCheckInEnabled,
          requireApproval: g.requireApproval ?? settings.requireApproval,
          guestAccessDuration: g.accessDuration ?? settings.guestAccessDuration,
          allowGuestChat: g.allowChat ?? settings.allowGuestChat,
          allowGuestVideo: g.allowVideo ?? settings.allowGuestVideo,
        });
      }
    };
    loadFromDB();
    loadGuests();
  }, [workspaceId]);

  const loadGuests = async () => {
    if (!workspaceId) return;
    
    const { data, error } = await supabase
      .from('invitaciones_pendientes')
      .select('id, email, creada_en, expira_en')
      .eq('espacio_id', workspaceId)
      .eq('usada', false)
      .order('creada_en', { ascending: false });

    if (!error && data) {
      setGuests(data.map((g: any) => ({
        id: g.id,
        email: g.email,
        acceso_hasta: g.expira_en,
        creado_en: g.creado_en
      })));
    }
    setLoading(false);
  };

  const revokeGuest = async (guestId: string) => {
    await supabase
      .from('invitaciones_pendientes')
      .delete()
      .eq('id', guestId);
    
    loadGuests();
  };

  const updateSetting = <K extends keyof GuestsSettings>(key: K, value: GuestsSettings[K]) => {
    const newSettings = { ...settings, [key]: value };
    onSettingsChange(newSettings);
    // Persistir en BD (fire-and-forget)
    if (workspaceId) {
      supabase
        .from('espacios_trabajo')
        .update({
          configuracion: {
            guests: {
              checkInEnabled: newSettings.guestCheckInEnabled,
              requireApproval: newSettings.requireApproval,
              accessDuration: newSettings.guestAccessDuration,
              allowChat: newSettings.allowGuestChat,
              allowVideo: newSettings.allowGuestVideo,
            }
          }
        })
        .eq('id', workspaceId)
        .then();
    }
  };

  const durationOptions = [
    { value: '1', label: currentLang === 'en' ? '1 hour' : currentLang === 'pt' ? '1 hora' : '1 hora' },
    { value: '8', label: currentLang === 'en' ? '8 hours' : currentLang === 'pt' ? '8 horas' : '8 horas' },
    { value: '24', label: currentLang === 'en' ? '24 hours' : currentLang === 'pt' ? '24 horas' : '24 horas' },
    { value: '168', label: currentLang === 'en' ? '1 week' : currentLang === 'pt' ? '1 semana' : '1 semana' },
    { value: '720', label: currentLang === 'en' ? '30 days' : currentLang === 'pt' ? '30 dias' : '30 días' }
  ];

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('es', { 
      day: 'numeric', 
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const isExpired = (dateStr: string) => new Date(dateStr) < new Date();

  return (
    <div>
      <div className="mb-8 lg:mb-6">
        <h2 className="text-2xl lg:text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-violet-200 to-white mb-2 lg:mb-1">
          {currentLang === 'en' ? 'Guest Management' : currentLang === 'pt' ? 'Gestão de Convidados' : 'Gestión de Invitados'}
        </h2>
        <p className="text-sm text-zinc-400">
          {currentLang === 'en' ? 'Control external guest access to the space' : currentLang === 'pt' ? 'Controle o acesso de convidados externos ao espaço' : 'Controla el acceso de invitados externos al espacio'}
        </p>
      </div>

      <SettingSection title={currentLang === 'en' ? 'Guest Access' : currentLang === 'pt' ? 'Acesso de Convidados' : 'Acceso de Invitados'}>
        <SettingToggle
          label={currentLang === 'en' ? 'Guest check-in' : currentLang === 'pt' ? 'Check-in de convidados' : 'Check-in de invitados'}
          description={currentLang === 'en' ? 'Guests must request access from an online member' : currentLang === 'pt' ? 'Convidados devem solicitar acesso a um membro online' : 'Los invitados deben solicitar acceso a un miembro en línea'}
          checked={settings.guestCheckInEnabled}
          onChange={(v) => updateSetting('guestCheckInEnabled', v)}
        />
        <SettingToggle
          label={currentLang === 'en' ? 'Requires approval' : currentLang === 'pt' ? 'Requer aprovação' : 'Requiere aprobación'}
          description={currentLang === 'en' ? 'An admin must approve each guest before they can enter' : currentLang === 'pt' ? 'Um admin deve aprovar cada convidado antes de poder entrar' : 'Un admin debe aprobar cada invitado antes de que pueda entrar'}
          checked={settings.requireApproval}
          onChange={(v) => updateSetting('requireApproval', v)}
        />
        <SettingDropdown
          label={currentLang === 'en' ? 'Access duration' : currentLang === 'pt' ? 'Duração do acesso' : 'Duración del acceso'}
          description={currentLang === 'en' ? 'Time a guest can stay in the space' : currentLang === 'pt' ? 'Tempo que um convidado pode permanecer no espaço' : 'Tiempo que un invitado puede permanecer en el espacio'}
          value={settings.guestAccessDuration.toString()}
          options={durationOptions}
          onChange={(v) => updateSetting('guestAccessDuration', parseInt(v))}
        />
      </SettingSection>

      <SettingSection title={currentLang === 'en' ? 'Guest Permissions' : currentLang === 'pt' ? 'Permissões de Convidados' : 'Permisos de Invitados'}>
        <SettingToggle
          label={currentLang === 'en' ? 'Allow chat' : currentLang === 'pt' ? 'Permitir chat' : 'Permitir chat'}
          description={currentLang === 'en' ? 'Guests can send messages' : currentLang === 'pt' ? 'Convidados podem enviar mensagens' : 'Los invitados pueden enviar mensajes'}
          checked={settings.allowGuestChat}
          onChange={(v) => updateSetting('allowGuestChat', v)}
        />
        <SettingToggle
          label={currentLang === 'en' ? 'Allow video' : currentLang === 'pt' ? 'Permitir vídeo' : 'Permitir video'}
          description={currentLang === 'en' ? 'Guests can enable their camera' : currentLang === 'pt' ? 'Convidados podem ativar sua câmera' : 'Los invitados pueden activar su cámara'}
          checked={settings.allowGuestVideo}
          onChange={(v) => updateSetting('allowGuestVideo', v)}
        />
      </SettingSection>

      <SettingSection title={`${currentLang === 'en' ? 'Pending Invitations' : currentLang === 'pt' ? 'Convites Pendentes' : 'Invitaciones Pendientes'} (${guests.length})`}>
        {loading ? (
          <div className="py-8 text-center">
            <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : guests.length === 0 ? (
          <div className="py-6 text-center text-zinc-500 text-sm">
            {currentLang === 'en' ? 'No pending invitations' : currentLang === 'pt' ? 'Nenhum convite pendente' : 'No hay invitaciones pendientes'}
          </div>
        ) : (
          <div className="divide-y divide-white/[0.05]">
            {guests.map((guest) => (
              <div key={guest.id} className="flex items-center justify-between py-4">
                <div>
                  <p className="text-sm font-medium text-white">{guest.email}</p>
                  <p className="text-xs text-zinc-500">
                    {currentLang === 'en' ? 'Expires: ' : currentLang === 'pt' ? 'Expira: ' : 'Expira: '} {formatDate(guest.acceso_hasta)}
                    {isExpired(guest.acceso_hasta) && (
                      <span className="ml-2 text-red-400">({currentLang === 'en' ? 'Expired' : currentLang === 'pt' ? 'Expirado' : 'Expirado'})</span>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => revokeGuest(guest.id)}
                  className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-xs font-medium transition-all"
                >
                  {currentLang === 'en' ? 'Revoke' : currentLang === 'pt' ? 'Revogar' : 'Revocar'}
                </button>
              </div>
            ))}
          </div>
        )}
      </SettingSection>
    </div>
  );
};

export default SettingsGuests;
