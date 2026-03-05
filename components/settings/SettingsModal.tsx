import React, { useState, useEffect } from 'react';
import { 
  Settings, Calendar, Layout, Mic, Video, Users2, Bell, Lock, Zap, 
  Gamepad2, UserPlus, ShieldCheck, X 
} from 'lucide-react';
import { Language, getCurrentLanguage, subscribeToLanguageChange, t } from '../../lib/i18n';
import { SettingsGeneral } from './sections/SettingsGeneral';
import { SettingsCalendar } from './sections/SettingsCalendar';
import { SettingsMiniMode } from './sections/SettingsMiniMode';
import { SettingsAudio } from './sections/SettingsAudio';
import { SettingsVideo } from './sections/SettingsVideo';
import { SettingsMeetings } from './sections/SettingsMeetings';
import { SettingsNotifications } from './sections/SettingsNotifications';
import { SettingsPrivacy } from './sections/SettingsPrivacy';
import { SettingsPerformance } from './sections/SettingsPerformance';
import { SettingsSpace3D } from './sections/SettingsSpace3D';
import { SettingsMembers } from './sections/SettingsMembers';
import { SettingsGuests } from './sections/SettingsGuests';
import { SettingsSecurity } from './sections/SettingsSecurity';
import { SettingsCargos } from './sections/SettingsCargos';
import { SettingsDepartamentos } from './sections/SettingsDepartamentos';
import { SettingsEmpresa } from './sections/SettingsEmpresa';
import { SettingsZona } from './sections/SettingsZona';
import { SettingsTerrenos } from './sections/SettingsTerrenos';

type SettingsTab = 'general' | 'calendar' | 'minimode' | 'audio' | 'video' | 'meetings' | 'notifications' | 'privacy' | 'performance' | 'space3d' | 'members' | 'guests' | 'security' | 'cargos' | 'departamentos' | 'empresa' | 'zonas' | 'terrenos';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  isAdmin: boolean;
  currentTheme: string;
  onThemeChange: (theme: string) => void;
}

const STORAGE_KEY = 'user_settings';

const defaultSettings = {
  general: {
    skipWelcomeScreen: false,
    colorMode: 'dark',
    language: 'es' as Language,
    autoUpdates: true
  },
  calendar: {
    googleConnected: false,
    syncEnabled: true,
    defaultReminder: 15,
    showGoogleEvents: true,
    autoCreateGoogleEvent: true
  },
  minimode: {
    enableMiniMode: true,
    miniModePosition: 'bottom-right',
    showVideoInMini: true,
    showChatInMini: true,
    autoMinimize: false,
    autoMinimizeDelay: 60
  },
  audio: {
    selectedMicrophoneId: '',
    selectedSpeakerId: '',
    noiseReduction: true,
    noiseReductionLevel: 'standard',
    echoCancellation: true,
    autoGainControl: true,
    chatSounds: true,
    sfxVolume: 70
  },
  video: {
    selectedCameraId: '',
    hdQuality: true,
    mirrorVideo: true,
    hideSelfView: false,
    autoIdleMuting: true
  },
  meetings: {
    autoMuteOnJoin: false,
    autoCameraOffOnJoin: false,
  },
  notifications: {
    desktopNotifications: true,
    newMessageSound: true,
    nearbyUserSound: false,
    mentionNotifications: true
  },
  privacy: {
    showOnlineStatus: true,
    showActivityStatus: true,
    allowDirectMessages: true,
    showLocationInSpace: true,
    activityHistoryEnabled: true,
    activityRetentionDays: 30
  },
  performance: {
    graphicsQuality: 'auto',
    showVideos: true,
    showAvatarAnimations: true,
    reducedMotion: false,
    hardwareAcceleration: true,
    maxVideoStreams: 8,
    batterySaver: false
  },
  space3d: {
    cameraMode: 'free',
    movementSpeed: 5,
    cameraSensitivity: 5,
    invertYAxis: false,
    showFloorGrid: true,
    showNamesAboveAvatars: true,
    spatialAudio: true,
    proximityRadius: 150,
    radioInteresChunks: 1
  },
  guests: {
    guestCheckInEnabled: false,
    requireApproval: true,
    guestAccessDuration: 24,
    allowGuestChat: true,
    allowGuestVideo: true
  },
  security: {
    requireLogin: true,
    passwordProtection: false,
    spacePassword: '',
    allowedDomains: [],
    allowStaffAccess: true,
    twoFactorRequired: false,
    sessionTimeout: 480,
    ipRestriction: false
  }
};

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  workspaceId,
  isAdmin,
  currentTheme,
  onThemeChange
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [settings, setSettings] = useState(defaultSettings);
  const [currentLang, setCurrentLang] = useState<Language>(getCurrentLanguage());

  // Suscribirse a cambios de idioma
  useEffect(() => {
    const unsubscribe = subscribeToLanguageChange(() => {
      setCurrentLang(getCurrentLanguage());
    });
    return unsubscribe;
  }, []);

  // Cargar settings de localStorage
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setSettings({ ...defaultSettings, ...parsed });
      } catch (e) {
        console.error('Error loading settings:', e);
      }
    }
  }, []);

  // Guardar settings en localStorage + sincronizar con keys que lee VirtualSpace3D
  const saveSettings = (newSettings: typeof settings) => {
    setSettings(newSettings);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
    
    // Sincronizar Audio settings con cowork_audio_settings (leído por VirtualSpace3D)
    try {
      const audioSync = {
        selectedMicrophoneId: newSettings.audio.selectedMicrophoneId,
        selectedSpeakerId: newSettings.audio.selectedSpeakerId,
        noiseReduction: newSettings.audio.noiseReduction,
        noiseReductionLevel: newSettings.audio.noiseReductionLevel,
        echoCancellation: newSettings.audio.echoCancellation,
        autoGainControl: newSettings.audio.autoGainControl,
      };
      localStorage.setItem('cowork_audio_settings', JSON.stringify(audioSync));
      
      // Sincronizar Video/Camera settings con cowork_camera_settings
      const cameraSync = {
        selectedCameraId: newSettings.video.selectedCameraId,
        hideSelfView: newSettings.video.hideSelfView,
        mirrorVideo: newSettings.video.mirrorVideo,
        backgroundEffect: 'none',
        backgroundImage: null,
      };
      localStorage.setItem('cowork_camera_settings', JSON.stringify(cameraSync));
    } catch (e) {
      console.error('Error syncing settings:', e);
    }
  };

  // Sincronizar tema
  useEffect(() => {
    if (settings.general.colorMode !== currentTheme) {
      setSettings(prev => ({
        ...prev,
        general: { ...prev.general, colorMode: currentTheme }
      }));
    }
  }, [currentTheme]);

  const handleGeneralChange = (general: typeof settings.general) => {
    const newSettings = { ...settings, general };
    saveSettings(newSettings);
    if (general.colorMode !== currentTheme) {
      onThemeChange(general.colorMode);
    }
  };

  if (!isOpen) return null;

  const tabs = [
    { id: 'general', label: t('settings.general.title', currentLang), Icon: Settings, category: t('settings.category.preferences', currentLang) },
    { id: 'calendar', label: t('settings.calendar.title', currentLang), Icon: Calendar, category: t('settings.category.preferences', currentLang) },
    { id: 'minimode', label: 'Mini Mode', Icon: Layout, category: t('settings.category.preferences', currentLang) },
    { id: 'audio', label: t('settings.audio.title', currentLang), Icon: Mic, category: t('settings.category.preferences', currentLang) },
    { id: 'video', label: t('settings.video.title', currentLang), Icon: Video, category: t('settings.category.preferences', currentLang) },
    { id: 'meetings', label: t('settings.meetings.title', currentLang), Icon: Users2, category: t('settings.category.preferences', currentLang) },
    { id: 'notifications', label: t('settings.notifications.title', currentLang), Icon: Bell, category: t('settings.category.preferences', currentLang) },
    { id: 'privacy', label: t('settings.privacy.title', currentLang), Icon: Lock, category: t('settings.category.preferences', currentLang) },
    { id: 'performance', label: t('settings.performance.title', currentLang), Icon: Zap, category: t('settings.category.preferences', currentLang) },
    { id: 'space3d', label: t('settings.space3d.title', currentLang), Icon: Gamepad2, category: t('settings.category.preferences', currentLang) },
    { id: 'members', label: t('settings.members.title', currentLang), Icon: Users2, category: t('settings.category.workspace', currentLang) },
    { id: 'guests', label: t('settings.guests.title', currentLang), Icon: UserPlus, category: t('settings.category.workspace', currentLang), adminOnly: true },
    { id: 'security', label: t('settings.security.title', currentLang), Icon: ShieldCheck, category: t('settings.category.workspace', currentLang), adminOnly: true },
    { id: 'empresa', label: 'Empresa', Icon: Settings, category: t('settings.category.workspace', currentLang), adminOnly: true },
    { id: 'zonas', label: 'Zonas y Accesos', Icon: ShieldCheck, category: t('settings.category.workspace', currentLang), adminOnly: true },
    { id: 'terrenos', label: 'Marketplace', Icon: ShieldCheck, category: t('settings.category.workspace', currentLang), adminOnly: true },
    { id: 'cargos', label: 'Cargos', Icon: ShieldCheck, category: t('settings.category.workspace', currentLang), adminOnly: true },
    { id: 'departamentos', label: 'Departamentos', Icon: Users2, category: t('settings.category.workspace', currentLang), adminOnly: true },
  ];

  const filteredTabs = tabs.filter(t => !t.adminOnly || isAdmin);
  const categories = [...new Set(filteredTabs.map(t => t.category))];

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-4xl lg:max-w-3xl md:max-w-2xl h-[85vh] max-h-[700px] lg:max-h-[600px] backdrop-blur-xl bg-zinc-900/95 border border-white/[0.1] rounded-3xl lg:rounded-2xl shadow-2xl overflow-hidden flex animate-in fade-in zoom-in-95 duration-200">
        
        {/* Sidebar */}
        <div className="w-56 lg:w-48 bg-black/40 border-r border-white/[0.05] flex flex-col">
          {/* Header */}
          <div className="p-5 lg:p-4 border-b border-white/[0.05]">
            <h2 className="text-lg lg:text-base font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-violet-200 to-white">
              {t('settings.title', currentLang)}
            </h2>
          </div>
          
          {/* Navigation */}
          <nav className="flex-1 px-2 lg:px-1.5 py-3 lg:py-2 overflow-y-auto">
            {categories.map(category => (
              <div key={category} className="mb-4">
                <p className="text-[9px] lg:text-[8px] font-black uppercase tracking-widest text-zinc-600 px-2 mb-2">
                  {category}
                </p>
                {filteredTabs
                  .filter(t => t.category === category)
                  .map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id as SettingsTab)}
                      className={`group w-full flex items-center gap-2.5 lg:gap-2 px-2.5 lg:px-2 py-2 lg:py-1.5 rounded-lg text-sm lg:text-xs font-medium transition-all duration-200 ${
                        activeTab === tab.id
                          ? 'bg-violet-600/20 text-white'
                          : 'text-zinc-400 hover:text-white hover:bg-white/[0.05]'
                      }`}
                    >
                      <tab.Icon 
                        className={`w-[18px] h-[18px] lg:w-4 lg:h-4 stroke-[1.5] transition-all duration-200 ${
                          activeTab === tab.id 
                            ? 'text-violet-400' 
                            : 'text-zinc-500 group-hover:text-zinc-300'
                        }`} 
                      />
                      {tab.label}
                    </button>
                  ))}
              </div>
            ))}
          </nav>
        </div>
        
        {/* Content */}
        <div className="flex-1 flex flex-col">
          {/* Close button */}
          <div className="absolute top-4 right-4">
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-zinc-500 hover:text-white hover:bg-white/[0.05] transition-all"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          {/* Content area */}
          <div className="flex-1 overflow-y-auto p-8 lg:p-6 md:p-4">
            {activeTab === 'general' && (
              <SettingsGeneral
                settings={settings.general}
                onSettingsChange={handleGeneralChange}
              />
            )}
            {activeTab === 'calendar' && (
              <SettingsCalendar
                settings={settings.calendar}
                onSettingsChange={(calendar) => saveSettings({ ...settings, calendar })}
              />
            )}
            {activeTab === 'minimode' && (
              <SettingsMiniMode
                settings={settings.minimode}
                onSettingsChange={(minimode) => saveSettings({ ...settings, minimode })}
              />
            )}
            {activeTab === 'audio' && (
              <SettingsAudio
                settings={settings.audio}
                onSettingsChange={(audio) => saveSettings({ ...settings, audio })}
              />
            )}
            {activeTab === 'video' && (
              <SettingsVideo
                settings={settings.video}
                onSettingsChange={(video) => saveSettings({ ...settings, video })}
              />
            )}
            {activeTab === 'meetings' && (
              <SettingsMeetings
                settings={settings.meetings}
                onSettingsChange={(meetings) => saveSettings({ ...settings, meetings })}
                isAdmin={isAdmin}
                workspaceId={workspaceId}
              />
            )}
            {activeTab === 'notifications' && (
              <SettingsNotifications
                settings={settings.notifications}
                onSettingsChange={(notifications) => saveSettings({ ...settings, notifications })}
              />
            )}
            {activeTab === 'privacy' && (
              <SettingsPrivacy
                settings={settings.privacy}
                onSettingsChange={(privacy) => saveSettings({ ...settings, privacy })}
              />
            )}
            {activeTab === 'performance' && (
              <SettingsPerformance
                settings={settings.performance}
                onSettingsChange={(performance) => saveSettings({ ...settings, performance })}
              />
            )}
            {activeTab === 'space3d' && (
              <SettingsSpace3D
                settings={settings.space3d}
                onSettingsChange={(space3d) => saveSettings({ ...settings, space3d })}
              />
            )}
            {activeTab === 'members' && (
              <SettingsMembers
                workspaceId={workspaceId}
                isAdmin={isAdmin}
              />
            )}
            {activeTab === 'guests' && isAdmin && (
              <SettingsGuests
                settings={settings.guests}
                onSettingsChange={(guests) => saveSettings({ ...settings, guests })}
                workspaceId={workspaceId}
              />
            )}
            {activeTab === 'security' && isAdmin && (
              <SettingsSecurity
                settings={settings.security}
                onSettingsChange={(security) => saveSettings({ ...settings, security })}
                workspaceId={workspaceId}
              />
            )}
            {activeTab === 'empresa' && isAdmin && (
              <SettingsEmpresa
                workspaceId={workspaceId}
                isAdmin={isAdmin}
              />
            )}
            {activeTab === 'zonas' && isAdmin && (
              <SettingsZona
                workspaceId={workspaceId}
                isAdmin={isAdmin}
              />
            )}
            {activeTab === 'terrenos' && isAdmin && (
              <SettingsTerrenos
                workspaceId={workspaceId}
                isAdmin={isAdmin}
              />
            )}
            {activeTab === 'cargos' && isAdmin && (
              <SettingsCargos
                workspaceId={workspaceId}
                isAdmin={isAdmin}
              />
            )}
            {activeTab === 'departamentos' && isAdmin && (
              <SettingsDepartamentos
                workspaceId={workspaceId}
                isAdmin={isAdmin}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
