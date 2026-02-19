import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { UserAvatar } from './UserAvatar';
import { AvatarConfig, PresenceStatus } from '../types';
import { loadCameraSettings, saveCameraSettings, type CameraSettings } from './CameraSettingsMenu';

// ============== AUDIO SETTINGS ==============
export interface AudioSettings {
  selectedMicrophoneId: string;
  selectedSpeakerId: string;
  noiseReduction: boolean;
  noiseReductionLevel: string;
  echoCancellation: boolean;
  autoGainControl: boolean;
}

const AUDIO_STORAGE_KEY = 'cowork_audio_settings';

const defaultAudioSettings: AudioSettings = {
  selectedMicrophoneId: '',
  selectedSpeakerId: '',
  noiseReduction: true,
  noiseReductionLevel: 'standard',
  echoCancellation: true,
  autoGainControl: true,
};

export const loadAudioSettings = (): AudioSettings => {
  try {
    const saved = localStorage.getItem(AUDIO_STORAGE_KEY);
    if (saved) {
      return { ...defaultAudioSettings, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.error('Error loading audio settings:', e);
  }
  return defaultAudioSettings;
};

export const saveAudioSettings = (settings: AudioSettings) => {
  try {
    localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Error saving audio settings:', e);
  }
};

interface BottomControlBarProps {
  onToggleMic: () => void;
  onToggleCam: () => void;
  onToggleShare: () => void;
  onToggleRecording: () => void;
  onToggleEmojis: () => void;
  onToggleChat: () => void;
  isMicOn: boolean;
  isCamOn: boolean;
  isSharing: boolean;
  onAudioSettingsChange?: (settings: AudioSettings) => void;
  isRecording: boolean;
  recordingDuration?: number;
  showEmojis: boolean;
  showChat: boolean;
  showStatusPicker: boolean;
  onToggleStatusPicker: () => void;
  onTriggerReaction: (emoji: string) => void;
  avatarConfig: AvatarConfig;
  showShareButton: boolean;
  showRecordingButton: boolean;
  currentStream?: MediaStream | null;
  onCameraSettingsChange?: (settings: CameraSettings) => void;
  onOpenGameHub?: () => void;
  isGameActive?: boolean;
  isGameHubOpen?: boolean;
}

// Configuración de estados con iconos y colores (estilo 2026)
export const STATUS_CONFIG = {
  [PresenceStatus.AVAILABLE]: { color: '#22c55e', icon: '●', label: 'Disponible' },
  [PresenceStatus.BUSY]: { color: '#ef4444', icon: '◉', label: 'Ocupado' },
  [PresenceStatus.AWAY]: { color: '#f59e0b', icon: '◐', label: 'Ausente' },
  [PresenceStatus.DND]: { color: '#8b5cf6', icon: '⊘', label: 'No molestar' },
};

export const BottomControlBar: React.FC<BottomControlBarProps> = ({
  onToggleMic,
  onToggleCam,
  onToggleShare,
  onToggleRecording,
  onToggleEmojis,
  onToggleChat,
  isMicOn,
  isCamOn,
  isSharing,
  isRecording,
  recordingDuration = 0,
  showEmojis,
  showChat,
  showStatusPicker,
  onToggleStatusPicker,
  onTriggerReaction,
  avatarConfig,
  showShareButton,
  showRecordingButton,
  currentStream,
  onCameraSettingsChange,
  onAudioSettingsChange,
  onOpenGameHub,
  isGameActive = false,
  isGameHubOpen = false,
}) => {
  const { currentUser, updateStatus } = useStore();
  const emojis = ['👍', '🔥', '❤️', '👏', '😂', '😮', '🚀', '✨'];
  
  const currentStatus = currentUser.status || PresenceStatus.AVAILABLE;
  const statusConfig = STATUS_CONFIG[currentStatus];

  // Estado para el menú de configuración de cámara
  const [showCameraMenu, setShowCameraMenu] = useState(false);
  const [cameraSettings, setCameraSettings] = useState<CameraSettings>(loadCameraSettings);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const cameraMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Estado para el menú de configuración de audio
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(loadAudioSettings);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);
  const audioMenuRef = useRef<HTMLDivElement>(null);

  // Cargar lista de dispositivos de audio
  useEffect(() => {
    const loadAudioDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(d => d.kind === 'audioinput');
        const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
        setMicrophones(audioInputs);
        setSpeakers(audioOutputs);
        
        // Auto-seleccionar dispositivo actual si no hay selección
        if (!audioSettings.selectedMicrophoneId && audioInputs.length > 0) {
          const currentTrack = currentStream?.getAudioTracks()[0];
          const currentDeviceId = currentTrack?.getSettings().deviceId;
          if (currentDeviceId) {
            updateAudioSettings({ selectedMicrophoneId: currentDeviceId });
          }
        }
      } catch (err) {
        console.error('Error loading audio devices:', err);
      }
    };
    
    if (showAudioMenu) {
      loadAudioDevices();
    }
  }, [showAudioMenu, currentStream]);

  // Cerrar menú de audio al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (audioMenuRef.current && !audioMenuRef.current.contains(e.target as Node)) {
        setShowAudioMenu(false);
      }
    };
    if (showAudioMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showAudioMenu]);

  // Cargar lista de cámaras
  useEffect(() => {
    const loadCameras = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        setCameras(videoDevices);
        
        if (!cameraSettings.selectedCameraId && videoDevices.length > 0) {
          const currentTrack = currentStream?.getVideoTracks()[0];
          const currentDeviceId = currentTrack?.getSettings().deviceId;
          if (currentDeviceId) {
            updateCameraSettings({ selectedCameraId: currentDeviceId });
          }
        }
      } catch (err) {
        console.error('Error loading cameras:', err);
      }
    };
    
    if (showCameraMenu) {
      loadCameras();
    }
  }, [showCameraMenu, currentStream]);

  // Cerrar menú al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (cameraMenuRef.current && !cameraMenuRef.current.contains(e.target as Node)) {
        setShowCameraMenu(false);
      }
    };
    if (showCameraMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showCameraMenu]);

  const updateCameraSettings = (partial: Partial<CameraSettings>) => {
    const newSettings = { ...cameraSettings, ...partial };
    setCameraSettings(newSettings);
    saveCameraSettings(newSettings);
    onCameraSettingsChange?.(newSettings);
  };

  const updateAudioSettings = (partial: Partial<AudioSettings>) => {
    const newSettings = { ...audioSettings, ...partial };
    setAudioSettings(newSettings);
    saveAudioSettings(newSettings);
    console.log('🎤 Audio settings updated:', newSettings);
    // Notificar al padre para aplicar cambios en el stream
    onAudioSettingsChange?.(newSettings);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        updateCameraSettings({ 
          backgroundEffect: 'image',
          backgroundImage: event.target?.result as string 
        });
      };
      reader.readAsDataURL(file);
    }
  };

  // Ocultar completamente cuando el GameHub está abierto (menú o jugando)
  if (isGameHubOpen) return null;

  return (
    <div className={`absolute z-[200] transition-all duration-500 ease-out ${
      isGameActive 
        ? 'left-3 top-1/2 -translate-y-1/2 flex flex-col items-start gap-2' 
        : 'bottom-6 left-1/2 -translate-x-1/2 flex items-end gap-2'
    }`} onClick={(e) => e.stopPropagation()}>
      {/* Barra Principal Glassmorphism 2026 - Adaptativa: horizontal (normal) / vertical (juego) */}
      <div className={`${isGameActive ? 'flex flex-col' : 'flex'} items-center gap-1.5 p-1.5 rounded-2xl bg-black/20 backdrop-blur-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.3)] transition-all duration-500 hover:bg-black/30 hover:border-white/20 hover:shadow-[0_8px_32px_rgba(0,0,0,0.4)]`}>
        
        {/* Foto de usuario con indicador de estado */}
        <div className="relative">
          <button 
            onClick={onToggleStatusPicker}
            className={`w-9 h-9 rounded-xl overflow-hidden flex items-center justify-center border border-white/5 hover:border-white/20 transition-colors cursor-pointer ${isGameActive ? 'mb-0' : 'mr-1'}`}
          >
            <UserAvatar
              name={currentUser.name}
              profilePhoto={currentUser.profilePhoto}
              size="sm"
            />
          </button>
          {/* Indicador de estado actual */}
          <div 
            className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-black/50"
            style={{ backgroundColor: statusConfig.color }}
          />
          
          {/* Status Picker Popup - Iconos minimalistas 2026 */}
          {showStatusPicker && (
            <div className="absolute bottom-full left-0 mb-2 animate-emoji-popup">
              <div className="p-1.5 bg-black/80 backdrop-blur-xl rounded-xl border border-white/10 flex flex-col gap-1">
                {Object.entries(STATUS_CONFIG).map(([status, config]) => (
                  <button
                    key={status}
                    onClick={() => {
                      updateStatus(status as PresenceStatus);
                      onToggleStatusPicker();
                    }}
                    className={`
                      w-8 h-8 rounded-lg flex items-center justify-center text-lg transition-all duration-150
                      hover:bg-white/20 hover:scale-110 active:scale-90
                      ${currentStatus === status ? 'bg-white/15 ring-1 ring-white/30' : ''}
                    `}
                    title={config.label}
                  >
                    <span style={{ color: config.color }}>{config.icon}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Micrófono con dropdown - Estilo Gather 2026 */}
        <div className="relative" ref={audioMenuRef} data-tour-step="mic-btn">
          {isGameActive ? (
            <button
              onClick={onToggleMic}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-300 ${
                isMicOn ? 'bg-zinc-700 text-white' : 'bg-red-500/90 text-white animate-pulse-slow'
              }`}
              title={isMicOn ? "Silenciar" : "Activar micrófono"}
            >
              <IconMic on={isMicOn} />
            </button>
          ) : (
          <div className="flex items-center">
            <button
              onClick={onToggleMic}
              className={`w-9 h-9 rounded-l-xl flex items-center justify-center transition-all duration-300 ${
                isMicOn ? 'bg-zinc-700 text-white' : 'bg-red-500/90 text-white animate-pulse-slow'
              }`}
              title={isMicOn ? "Silenciar" : "Activar micrófono"}
            >
              <IconMic on={isMicOn} />
            </button>
            <button
              onClick={() => setShowAudioMenu(!showAudioMenu)}
              className={`w-5 h-9 rounded-r-xl flex items-center justify-center transition-all duration-300 border-l border-white/10 ${
                isMicOn ? 'bg-zinc-700 text-white hover:bg-zinc-600' : 'bg-red-500/90 text-white hover:bg-red-600'
              }`}
              title="Configuración de audio"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </button>
          </div>
          )}

          {/* Menú de configuración de audio estilo Gather */}
          {showAudioMenu && (
            <div className="absolute bottom-full left-0 mb-2 w-72 lg:w-64 bg-zinc-900/95 backdrop-blur-xl rounded-xl lg:rounded-lg border border-white/10 shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
              <div className="p-3 space-y-3">
                {/* Selección de micrófono */}
                <div>
                  <div className="text-xs lg:text-[11px] font-medium text-white/50 px-1 mb-2">Seleccionar micrófono</div>
                  {microphones.map((mic) => (
                    <button
                      key={mic.deviceId}
                      onClick={() => updateAudioSettings({ selectedMicrophoneId: mic.deviceId })}
                      className={`w-full flex items-center gap-3 px-3 py-2 lg:py-1.5 rounded-lg text-sm lg:text-xs transition-colors ${
                        audioSettings.selectedMicrophoneId === mic.deviceId 
                          ? 'bg-violet-500/20 text-white' 
                          : 'text-white/70 hover:bg-white/5'
                      }`}
                    >
                      {audioSettings.selectedMicrophoneId === mic.deviceId && (
                        <svg className="w-4 h-4 text-violet-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                      <span className={`truncate ${audioSettings.selectedMicrophoneId !== mic.deviceId ? 'ml-7' : ''}`}>
                        {mic.label || `Micrófono ${mic.deviceId.slice(0, 8)}`}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="border-t border-white/10" />

                {/* Selección de altavoz */}
                <div>
                  <div className="text-xs lg:text-[11px] font-medium text-white/50 px-1 mb-2">Seleccionar altavoz</div>
                  {speakers.length > 0 ? speakers.map((speaker) => (
                    <button
                      key={speaker.deviceId}
                      onClick={() => updateAudioSettings({ selectedSpeakerId: speaker.deviceId })}
                      className={`w-full flex items-center gap-3 px-3 py-2 lg:py-1.5 rounded-lg text-sm lg:text-xs transition-colors ${
                        audioSettings.selectedSpeakerId === speaker.deviceId 
                          ? 'bg-violet-500/20 text-white' 
                          : 'text-white/70 hover:bg-white/5'
                      }`}
                    >
                      {audioSettings.selectedSpeakerId === speaker.deviceId && (
                        <svg className="w-4 h-4 text-violet-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                      <span className={`truncate ${audioSettings.selectedSpeakerId !== speaker.deviceId ? 'ml-7' : ''}`}>
                        {speaker.label || `Altavoz ${speaker.deviceId.slice(0, 8)}`}
                      </span>
                    </button>
                  )) : (
                    <div className="text-xs text-white/40 px-3 py-2">
                      Tu navegador no soporta selección de altavoces
                    </div>
                  )}
                </div>

                <div className="border-t border-white/10" />

                {/* Reducción de ruido */}
                <button
                  onClick={() => updateAudioSettings({ noiseReduction: !audioSettings.noiseReduction })}
                  className="w-full flex items-center justify-between px-3 py-2.5 lg:py-2 rounded-lg text-sm lg:text-xs text-white/80 hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <svg className="w-4 h-4 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                    </svg>
                    <span>Reducción de ruido</span>
                  </div>
                  <div className={`w-9 h-5 rounded-full transition-colors relative ${audioSettings.noiseReduction ? 'bg-violet-500' : 'bg-zinc-600'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${audioSettings.noiseReduction ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </div>
                </button>

                {/* Echo Cancellation */}
                <button
                  onClick={() => updateAudioSettings({ echoCancellation: !audioSettings.echoCancellation })}
                  className="w-full flex items-center justify-between px-3 py-2.5 lg:py-2 rounded-lg text-sm lg:text-xs text-white/80 hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <svg className="w-4 h-4 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                    <span>Cancelación de eco</span>
                  </div>
                  <div className={`w-9 h-5 rounded-full transition-colors relative ${audioSettings.echoCancellation ? 'bg-violet-500' : 'bg-zinc-600'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${audioSettings.echoCancellation ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </div>
                </button>

                {/* Auto Gain Control */}
                <button
                  onClick={() => updateAudioSettings({ autoGainControl: !audioSettings.autoGainControl })}
                  className="w-full flex items-center justify-between px-3 py-2.5 lg:py-2 rounded-lg text-sm lg:text-xs text-white/80 hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <svg className="w-4 h-4 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                    </svg>
                    <span>Control automático de ganancia</span>
                  </div>
                  <div className={`w-9 h-5 rounded-full transition-colors relative ${audioSettings.autoGainControl ? 'bg-violet-500' : 'bg-zinc-600'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${audioSettings.autoGainControl ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </div>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Cámara con dropdown */}
        <div className="relative" ref={cameraMenuRef} data-tour-step="cam-btn">
          {isGameActive ? (
            <button
              onClick={onToggleCam}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-300 ${
                isCamOn ? 'bg-zinc-700 text-white' : 'bg-red-500/90 text-white animate-pulse-slow'
              }`}
              title={isCamOn ? "Apagar cámara" : "Activar cámara"}
            >
              <IconCam on={isCamOn} />
            </button>
          ) : (
          <div className="flex items-center">
            <button
              onClick={onToggleCam}
              className={`w-9 h-9 rounded-l-xl flex items-center justify-center transition-all duration-300 ${
                isCamOn ? 'bg-zinc-700 text-white' : 'bg-red-500/90 text-white animate-pulse-slow'
              }`}
              title={isCamOn ? "Apagar cámara" : "Activar cámara"}
            >
              <IconCam on={isCamOn} />
            </button>
            <button
              onClick={() => setShowCameraMenu(!showCameraMenu)}
              className={`w-5 h-9 rounded-r-xl flex items-center justify-center transition-all duration-300 border-l border-white/10 ${
                isCamOn ? 'bg-zinc-700 text-white hover:bg-zinc-600' : 'bg-red-500/90 text-white hover:bg-red-600'
              }`}
              title="Configuración de cámara"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </button>
          </div>
          )}

          {/* Menú de configuración de cámara estilo Gather */}
          {showCameraMenu && (
            <div className="absolute bottom-full left-0 mb-2 w-64 lg:w-56 bg-zinc-900/95 backdrop-blur-xl rounded-xl lg:rounded-lg border border-white/10 shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
              {/* Selector de cámara */}
              <div className="p-3 border-b border-white/5">
                <div className="text-xs lg:text-[11px] font-medium text-white/50 mb-2">Seleccionar cámara</div>
                {cameras.map((camera) => (
                  <button
                    key={camera.deviceId}
                    onClick={() => updateCameraSettings({ selectedCameraId: camera.deviceId })}
                    className={`w-full text-left px-3 py-2 lg:py-1.5 rounded-lg text-sm lg:text-xs transition-colors flex items-center gap-2 ${
                      cameraSettings.selectedCameraId === camera.deviceId
                        ? 'bg-violet-500/20 text-white'
                        : 'text-white/70 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    {cameraSettings.selectedCameraId === camera.deviceId && (
                      <svg className="w-4 h-4 text-violet-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                    <span className={cameraSettings.selectedCameraId !== camera.deviceId ? 'ml-6' : ''}>
                      {camera.label || `Cámara ${cameras.indexOf(camera) + 1}`}
                    </span>
                  </button>
                ))}
              </div>

              {/* Opciones */}
              <div className="p-2">
                {/* Hide self view */}
                <button
                  onClick={() => updateCameraSettings({ hideSelfView: !cameraSettings.hideSelfView })}
                  className="w-full flex items-center justify-between px-3 py-2.5 lg:py-2 rounded-lg text-sm lg:text-xs text-white/80 hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <svg className="w-4 h-4 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                    <span>Ocultar mi vista</span>
                  </div>
                  <div className={`w-9 h-5 rounded-full transition-colors relative ${cameraSettings.hideSelfView ? 'bg-violet-500' : 'bg-zinc-600'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${cameraSettings.hideSelfView ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </div>
                </button>

                {/* Background effects - Opciones separadas */}
                <div className="space-y-1">
                  <div className="text-xs lg:text-[11px] font-medium text-white/50 px-3 pt-2">Efectos de fondo</div>
                  
                  {/* Ninguno */}
                  <button
                    onClick={() => updateCameraSettings({ backgroundEffect: 'none' })}
                    className={`w-full flex items-center gap-3 px-3 py-2 lg:py-1.5 rounded-lg text-sm lg:text-xs transition-colors ${
                      cameraSettings.backgroundEffect === 'none' ? 'bg-violet-500/20 text-white' : 'text-white/70 hover:bg-white/5'
                    }`}
                  >
                    {cameraSettings.backgroundEffect === 'none' && (
                      <svg className="w-4 h-4 text-violet-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                    <span className={cameraSettings.backgroundEffect !== 'none' ? 'ml-7' : ''}>Ninguno</span>
                  </button>
                  
                  {/* Blur */}
                  <button
                    onClick={() => updateCameraSettings({ backgroundEffect: 'blur' })}
                    className={`w-full flex items-center gap-3 px-3 py-2 lg:py-1.5 rounded-lg text-sm lg:text-xs transition-colors ${
                      cameraSettings.backgroundEffect === 'blur' ? 'bg-violet-500/20 text-white' : 'text-white/70 hover:bg-white/5'
                    }`}
                  >
                    {cameraSettings.backgroundEffect === 'blur' && (
                      <svg className="w-4 h-4 text-violet-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                    <span className={cameraSettings.backgroundEffect !== 'blur' ? 'ml-7' : ''}>Desenfoque</span>
                  </button>
                  
                  {/* Imagen */}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className={`w-full flex items-center gap-3 px-3 py-2 lg:py-1.5 rounded-lg text-sm lg:text-xs transition-colors ${
                      cameraSettings.backgroundEffect === 'image' ? 'bg-violet-500/20 text-white' : 'text-white/70 hover:bg-white/5'
                    }`}
                  >
                    {cameraSettings.backgroundEffect === 'image' && (
                      <svg className="w-4 h-4 text-violet-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                    <span className={cameraSettings.backgroundEffect !== 'image' ? 'ml-7' : ''}>
                      {cameraSettings.backgroundImage ? 'Cambiar imagen...' : 'Subir imagen...'}
                    </span>
                  </button>
                </div>

                {/* Mirror video */}
                <button
                  onClick={() => updateCameraSettings({ mirrorVideo: !cameraSettings.mirrorVideo })}
                  className="w-full flex items-center justify-between px-3 py-2.5 lg:py-2 rounded-lg text-sm lg:text-xs text-white/80 hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <svg className="w-4 h-4 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                    <span>Espejo de video</span>
                  </div>
                  <div className={`w-9 h-5 rounded-full transition-colors relative ${cameraSettings.mirrorVideo ? 'bg-violet-500' : 'bg-zinc-600'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${cameraSettings.mirrorVideo ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </div>
                </button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
            </div>
          )}
        </div>

        {showShareButton && !isGameActive && (
          <>
            <div className={`${isGameActive ? 'h-px w-6' : 'w-px h-6'} bg-white/10 mx-0.5`}></div>

            {/* Compartir Pantalla */}
            <ControlButton 
              onClick={onToggleShare} 
              isActive={isSharing} 
              activeColor="bg-indigo-500 text-white" 
              inactiveColor="bg-transparent text-white/70 hover:bg-white/10 hover:text-white"
              icon={<IconScreen on={isSharing} />}
              tooltip={isSharing ? "Dejar de compartir" : "Compartir pantalla"}
            />
          </>
        )}

        <div className={`${isGameActive ? 'h-px w-6' : 'w-px h-6'} bg-white/10 mx-0.5`}></div>

        {/* Chat */}
        <div data-tour-step="chat-btn">
        <ControlButton 
          onClick={onToggleChat} 
          isActive={showChat} 
          activeColor="bg-blue-500 text-white" 
          inactiveColor="bg-transparent text-white/70 hover:bg-white/10 hover:text-white"
          icon={<IconChat />}
          tooltip="Chat"
        />
        </div>

        {/* Reacciones */}
        <div className="relative">
          <ControlButton 
            onClick={onToggleEmojis} 
            isActive={showEmojis} 
            activeColor="bg-amber-500 text-white" 
            inactiveColor="bg-transparent text-white/70 hover:bg-white/10 hover:text-white"
            icon={<IconReaction />}
            tooltip="Reacciones"
          />
        </div>

        {/* Mini Juegos - Ocultar si ya estamos en un juego */}
        {onOpenGameHub && !isGameActive && (
          <ControlButton 
            onClick={onOpenGameHub} 
            isActive={false} 
            activeColor="bg-violet-500 text-white" 
            inactiveColor="bg-transparent text-white/70 hover:bg-white/10 hover:text-white"
            icon={<IconGamepad />}
            tooltip="Mini Juegos"
          />
        )}

        {showRecordingButton && !isGameActive && (
          <>
            <div className={`${isGameActive ? 'h-px w-6' : 'w-px h-6'} bg-white/10 mx-0.5`}></div>

            {isRecording ? (<div data-tour-step="recording-btn">
              /* Indicador de grabación activa - Minimalista estilo 2026 */
              <div className="flex items-center gap-2 pl-2 pr-1 py-1 rounded-xl bg-red-500/15 border border-red-500/30">
                {/* Punto rojo parpadeante */}
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </span>
                {/* Timer */}
                <span className="text-xs font-mono text-red-400 tabular-nums min-w-[36px]">
                  {String(Math.floor(recordingDuration / 60)).padStart(2, '0')}:{String(recordingDuration % 60).padStart(2, '0')}
                </span>
                {/* Botón Stop */}
                <button
                  onClick={onToggleRecording}
                  className="w-7 h-7 rounded-lg bg-red-500 hover:bg-red-600 flex items-center justify-center transition-colors"
                  title="Detener grabación"
                >
                  <div className="w-2.5 h-2.5 bg-white rounded-sm"></div>
                </button>
              </div>
            </div>) : (
              /* Botón para iniciar grabación */
              <button data-tour-step="recording-btn"
                onClick={onToggleRecording}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white transition-all duration-300"
              >
                <div className="w-3 h-3 rounded-full bg-red-500"></div>
                <span className="text-xs font-medium text-white/90">Grabar</span>
              </button>
            )}
          </>
        )}
      </div>

      {/* Emoji Picker Popup - Minimalista (NO cierra al hacer clic para spam rápido) */}
      {showEmojis && (
        <div className={`absolute animate-emoji-popup ${
          isGameActive 
            ? 'left-full top-1/2 -translate-y-1/2 ml-2' 
            : 'bottom-full left-1/2 -translate-x-1/2 mb-2'
        }`}>
          <div className={`px-2 py-1.5 bg-black/80 backdrop-blur-xl rounded-xl border border-white/10 ${isGameActive ? 'flex flex-col gap-0.5' : 'flex gap-0.5'}`}>
            {emojis.map((emoji) => (
              <button
                key={emoji}
                onClick={() => onTriggerReaction(emoji)}
                className="w-7 h-7 flex items-center justify-center text-lg rounded-lg transition-all duration-150 hover:bg-white/20 hover:scale-110 active:scale-90"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// Subcomponente de botón genérico - Más compacto
const ControlButton = ({ onClick, isActive, activeColor, inactiveColor, icon, tooltip }: any) => (
  <div className="relative group/btn">
    <button
      onClick={onClick}
      className={`
        w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-300
        ${isActive ? activeColor : inactiveColor}
      `}
    >
      {icon}
    </button>
    {/* Tooltip */}
    <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none z-50">
      <div className="bg-black/90 backdrop-blur-md text-white text-[10px] font-medium px-2 py-1 rounded-lg border border-white/10 whitespace-nowrap shadow-xl">
        {tooltip}
      </div>
    </div>
  </div>
);

// --- Iconos (Extraídos para portabilidad) ---

const IconMic = ({ on }: { on: boolean }) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    {on ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-20a3 3 0 00-3 3v8a3 3 0 006 0V5a3 3 0 00-3-3z"/> 
       : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />}
  </svg>
);

const IconCam = ({ on }: { on: boolean }) => (
  <svg className="w-5 h-5" fill={on ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
    {on ? (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="0" d="M15.75 8.25a.75.75 0 01.75.75c0 1.12-.492 2.126-1.27 2.812a.75.75 0 11-1.004-1.124A2.25 2.25 0 0015 9a.75.75 0 01.75-.75zM4.5 7.5a3 3 0 013-3h9a3 3 0 013 3v9a3 3 0 01-3 3h-9a3 3 0 01-3-3v-9z M19.5 8.625c0-1.036.84-1.875 1.875-1.875h.75c1.036 0 1.875.84 1.875 1.875v6.75c0 1.035-.84 1.875-1.875 1.875h-.75a1.875 1.875 0 01-1.875-1.875v-6.75z" />
    ) : (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2zM3 3l18 18" />
    )}
  </svg>
);

const IconScreen = ({ on }: { on: boolean }) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
    {!on && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3l18 18" />}
  </svg>
);

const IconReaction = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const IconChat = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
  </svg>
);

const IconGamepad = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
  </svg>
);

const IconMiniMode = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 14H14V20M4 10H10V4M14 10L21 3M3 21L10 14" />
  </svg>
);
