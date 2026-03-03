/**
 * @module hooks/space3d/useMediaStream
 * Hook para gestión de streams de media (getUserMedia), audio procesado,
 * screen share, y estabilidad de audio/video con Page Visibility API.
 */

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import type { CameraSettings } from '@/components/CameraSettingsMenu';
import { loadCameraSettings } from '@/components/CameraSettingsMenu';
import { loadAudioSettings, type AudioSettings } from '@/components/BottomControlBar';
import { USAR_LIVEKIT, type UseMediaStreamReturn } from './types';

export function useMediaStream(params: {
  currentUser: { isMicOn?: boolean; isCameraOn?: boolean; isScreenSharing?: boolean };
  cameraSettings: CameraSettings;
  toggleScreenShare: (value?: boolean) => void;
  peerConnectionsRef: React.MutableRefObject<Map<string, RTCPeerConnection>>;
  webrtcChannelRef: React.MutableRefObject<any>;
  session: any;
}): UseMediaStreamReturn {
  const { currentUser, cameraSettings, toggleScreenShare, peerConnectionsRef, webrtcChannelRef, session } = params;

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [processedStream, setProcessedStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const activeScreenRef = useRef<MediaStream | null>(null);

  // ========== Audio procesado ==========
  const audioProcesadoRef = useRef<{
    context: AudioContext;
    source: MediaStreamAudioSourceNode;
    destination: MediaStreamAudioDestinationNode;
    nodes: AudioNode[];
    track: MediaStreamTrack;
  } | null>(null);

  const limpiarAudioProcesado = useCallback(() => {
    const actual = audioProcesadoRef.current;
    if (!actual) return;
    actual.track.stop();
    actual.nodes.forEach((node) => {
      try { node.disconnect(); } catch { /* noop */ }
    });
    actual.source.disconnect();
    actual.destination.disconnect();
    actual.context.close().catch(() => undefined);
    audioProcesadoRef.current = null;
  }, []);

  const crearAudioProcesado = useCallback(async (track: MediaStreamTrack, nivel: 'standard' | 'enhanced') => {
    limpiarAudioProcesado();
    const context = new AudioContext();
    const audioStream = new MediaStream([track]);
    const source = context.createMediaStreamSource(audioStream);

    const highpass = context.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = nivel === 'enhanced' ? 120 : 80;

    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = nivel === 'enhanced' ? -35 : -28;
    compressor.knee.value = 30;
    compressor.ratio.value = nivel === 'enhanced' ? 12 : 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    const gain = context.createGain();
    gain.gain.value = nivel === 'enhanced' ? 1.1 : 1.0;

    const destination = context.createMediaStreamDestination();
    source.connect(highpass).connect(compressor).connect(gain).connect(destination);

    const processedTrack = destination.stream.getAudioTracks()[0];
    if (!processedTrack) {
      context.close().catch(() => undefined);
      return null;
    }

    audioProcesadoRef.current = {
      context,
      source,
      destination,
      nodes: [highpass, compressor, gain],
      track: processedTrack,
    };

    return processedTrack;
  }, [limpiarAudioProcesado]);

  // ========== Effective stream ==========
  const effectiveStream = (cameraSettings.backgroundEffect !== 'none' && processedStream) ? processedStream : stream;
  const effectiveStreamRef = useRef<MediaStream | null>(null);
  effectiveStreamRef.current = effectiveStream;

  // ========== getUserMedia management ==========
  const isProcessingStreamRef = useRef(false);
  const pendingUpdateRef = useRef(false);
  const shouldHaveStreamRef = useRef(false);
  shouldHaveStreamRef.current = currentUser.isMicOn || currentUser.isCameraOn || currentUser.isScreenSharing;

  useEffect(() => {
    let mounted = true;

    const manageStream = async () => {
      if (isProcessingStreamRef.current) {
        console.log('ManageStream busy, marking pending update...');
        pendingUpdateRef.current = true;
        return;
      }

      const shouldHaveStream = shouldHaveStreamRef.current;
      console.log('ManageStream starting - shouldHaveStream:', shouldHaveStream);

      try {
        isProcessingStreamRef.current = true;

        if (shouldHaveStream) {
          if (!activeStreamRef.current) {
            const camSettings = loadCameraSettings();
            const videoConstraints: MediaTrackConstraints = { width: 640, height: 480 };
            if (camSettings.selectedCameraId) {
              videoConstraints.deviceId = { exact: camSettings.selectedCameraId };
            }

            const currentAudioSettings = loadAudioSettings();
            const audioConstraints: MediaTrackConstraints = {
              noiseSuppression: currentAudioSettings.noiseReduction,
              echoCancellation: currentAudioSettings.echoCancellation,
              autoGainControl: currentAudioSettings.autoGainControl,
            };
            if (currentAudioSettings.selectedMicrophoneId) {
              audioConstraints.deviceId = { exact: currentAudioSettings.selectedMicrophoneId };
            }

            const wantVideo = currentUser.isCameraOn || currentUser.isScreenSharing;
            const wantAudio = currentUser.isMicOn;
            const mediaConstraints: MediaStreamConstraints = {};
            if (wantVideo) mediaConstraints.video = videoConstraints;
            if (wantAudio) mediaConstraints.audio = audioConstraints;
            if (!wantVideo && !wantAudio) mediaConstraints.audio = audioConstraints;

            console.log('Requesting media access...', { wantVideo, wantAudio });
            const newStream = await navigator.mediaDevices.getUserMedia(mediaConstraints).catch(async (err) => {
              if (camSettings.selectedCameraId || currentAudioSettings.selectedMicrophoneId) {
                console.warn('Selected device not available, using default:', err.message);
                const fallbackConstraints: MediaStreamConstraints = {};
                if (wantVideo) fallbackConstraints.video = { width: 640, height: 480 };
                if (wantAudio || !wantVideo) fallbackConstraints.audio = {
                  noiseSuppression: currentAudioSettings.noiseReduction,
                  echoCancellation: currentAudioSettings.echoCancellation,
                  autoGainControl: currentAudioSettings.autoGainControl,
                };
                return navigator.mediaDevices.getUserMedia(fallbackConstraints);
              }
              if (wantVideo && err.name === 'NotReadableError') {
                console.warn('Camera in use, falling back to audio-only:', err.message);
                return navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
              }
              throw err;
            });

            if (!mounted) {
              newStream.getTracks().forEach(t => t.stop());
              return;
            }

            if (!shouldHaveStreamRef.current) {
              console.log('Stream loaded but no longer needed, stopping...');
              newStream.getTracks().forEach(t => t.stop());
              return;
            }

            let streamToUse = newStream;
            const audioTrack = newStream.getAudioTracks()[0];
            if (audioTrack && currentAudioSettings.noiseReduction) {
              const nivel = currentAudioSettings.noiseReductionLevel === 'enhanced' ? 'enhanced' : 'standard';
              const processedTrack = await crearAudioProcesado(audioTrack, nivel);
              if (processedTrack) {
                const mixed = new MediaStream([processedTrack, ...newStream.getVideoTracks()]);
                streamToUse = mixed;
              }
            } else {
              limpiarAudioProcesado();
            }

            activeStreamRef.current = streamToUse;
            setStream(streamToUse);
            console.log('Camera/mic stream started');

            // Agregar tracks a conexiones peer existentes (path non-LiveKit)
            if (!USAR_LIVEKIT && peerConnectionsRef.current.size > 0) {
              console.log('Adding new stream tracks to', peerConnectionsRef.current.size, 'existing peer connections');
              peerConnectionsRef.current.forEach(async (pc, peerId) => {
                const senders = pc.getSenders();
                const hasAudio = senders.some(s => s.track?.kind === 'audio');
                const hasVideo = senders.some(s => s.track?.kind === 'video');

                newStream.getTracks().forEach(track => {
                  const alreadyHas = (track.kind === 'audio' && hasAudio) || (track.kind === 'video' && hasVideo);
                  if (!alreadyHas) {
                    pc.addTrack(track, newStream);
                  }
                });

                try {
                  const offer = await pc.createOffer();
                  await pc.setLocalDescription(offer);
                  if (webrtcChannelRef.current) {
                    webrtcChannelRef.current.send({
                      type: 'broadcast', event: 'offer',
                      payload: { offer, to: peerId, from: session?.user?.id }
                    });
                  }
                } catch (err) {
                  console.error('Error renegotiating with peer', peerId, err);
                }
              });
            }
          }

          // Actualizar estado de tracks
          if (activeStreamRef.current) {
            activeStreamRef.current.getAudioTracks().forEach(track => track.enabled = !!currentUser.isMicOn);

            const videoTracks = activeStreamRef.current.getVideoTracks();
            if (!currentUser.isCameraOn && videoTracks.length > 0) {
              console.log('Camera OFF - stopping video track to release hardware');
              videoTracks.forEach(track => {
                track.stop();
                activeStreamRef.current?.removeTrack(track);
              });
              if (!USAR_LIVEKIT) {
                peerConnectionsRef.current.forEach((pc) => {
                  pc.getSenders().forEach(sender => {
                    if (sender.track?.kind === 'video') {
                      try { pc.removeTrack(sender); } catch (e) { /* ignore */ }
                    }
                  });
                });
              }
            } else if (currentUser.isCameraOn && videoTracks.length === 0 && activeStreamRef.current) {
              console.log('Camera ON - requesting new video track');
              try {
                const videoStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
                const newVideoTrack = videoStream.getVideoTracks()[0];
                if (newVideoTrack && activeStreamRef.current) {
                  activeStreamRef.current.addTrack(newVideoTrack);
                  if (!USAR_LIVEKIT) {
                    peerConnectionsRef.current.forEach(async (pc, peerId) => {
                      pc.addTrack(newVideoTrack, activeStreamRef.current!);
                      try {
                        const offer = await pc.createOffer();
                        await pc.setLocalDescription(offer);
                        if (webrtcChannelRef.current) {
                          webrtcChannelRef.current.send({
                            type: 'broadcast', event: 'offer',
                            payload: { offer, to: peerId, from: session?.user?.id }
                          });
                        }
                      } catch (err) {
                        console.error('Error renegotiating video ON with peer', peerId, err);
                      }
                    });
                  }
                  setStream(new MediaStream(activeStreamRef.current.getTracks()));
                }
              } catch (e) {
                console.error('Error getting video track:', e);
              }
            }
          }
        } else {
          // Re-check with delay
          await new Promise(r => setTimeout(r, 300));
          if (shouldHaveStreamRef.current) {
            console.log('ManageStream: stop cancelado — shouldHaveStream cambió a true');
            return;
          }
          if (activeStreamRef.current) {
            console.log('Stopping camera/mic - user disabled all media');
            const tracks = activeStreamRef.current.getTracks();
            if (!USAR_LIVEKIT) {
              peerConnectionsRef.current.forEach((pc) => {
                pc.getSenders().forEach(sender => {
                  if (sender.track && tracks.some(t => t.id === sender.track!.id)) {
                    try { pc.removeTrack(sender); } catch (e) { /* ignore */ }
                  }
                });
              });
            }
            tracks.forEach(track => { track.stop(); });
            activeStreamRef.current = null;
            setStream(null);
          }
        }
      } catch (err) {
        console.error("Media error:", err);
      } finally {
        if (mounted) {
          isProcessingStreamRef.current = false;
          if (pendingUpdateRef.current) {
            console.log('Executing pending manageStream update...');
            pendingUpdateRef.current = false;
            manageStream();
          }
        }
      }
    };

    const timer = setTimeout(() => { manageStream(); }, 500);
    return () => { mounted = false; clearTimeout(timer); };
  }, [currentUser.isMicOn, currentUser.isCameraOn, currentUser.isScreenSharing]);

  // ========== Processed stream WebRTC update ==========
  useEffect(() => {
    if (USAR_LIVEKIT || !processedStream || cameraSettings.backgroundEffect === 'none') return;
    const videoTrack = processedStream.getVideoTracks()[0];
    if (!videoTrack) return;

    peerConnectionsRef.current.forEach(async (pc, peerId) => {
      const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
      if (videoSender) {
        try { await videoSender.replaceTrack(videoTrack); } catch (err) {
          console.error('Error replacing video track:', err);
        }
      }
    });
  }, [processedStream, cameraSettings.backgroundEffect]);

  // ========== Cleanup processed stream ==========
  useEffect(() => {
    if (!stream && processedStream) {
      setProcessedStream(null);
      return;
    }
    if (USAR_LIVEKIT) return;
    if (cameraSettings.backgroundEffect === 'none' && processedStream) {
      setProcessedStream(null);
      const originalVideoTrack = stream?.getVideoTracks()[0];
      if (originalVideoTrack) {
        peerConnectionsRef.current.forEach(async (pc) => {
          const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
          if (videoSender) {
            try { await videoSender.replaceTrack(originalVideoTrack); } catch { /* ignore */ }
          }
        });
      }
    }
  }, [cameraSettings.backgroundEffect, stream, processedStream]);

  // ========== Page Visibility API ==========
  useEffect(() => {
    if (USAR_LIVEKIT) return;
    let audioContext: AudioContext | null = null;
    let silentSource: AudioBufferSourceNode | null = null;
    let wasUsingProcessedStream = false;

    const handleVisibilityChange = async () => {
      if (document.hidden) {
        try {
          audioContext = new AudioContext();
          const buffer = audioContext.createBuffer(1, 1, 22050);
          silentSource = audioContext.createBufferSource();
          silentSource.buffer = buffer;
          silentSource.connect(audioContext.destination);
          silentSource.loop = true;
          silentSource.start();
        } catch (e) { /* ignore */ }

        if (processedStream && stream && cameraSettings.backgroundEffect !== 'none') {
          wasUsingProcessedStream = true;
          const originalVideoTrack = stream.getVideoTracks()[0];
          if (originalVideoTrack) {
            peerConnectionsRef.current.forEach(async (pc) => {
              const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
              if (videoSender) {
                try { await videoSender.replaceTrack(originalVideoTrack); } catch { /* ignore */ }
              }
            });
          }
        }
      } else {
        if (silentSource) { try { silentSource.stop(); } catch { /* ignore */ } silentSource = null; }
        if (audioContext) { try { audioContext.close(); } catch { /* ignore */ } audioContext = null; }

        if (wasUsingProcessedStream && processedStream) {
          const processedVideoTrack = processedStream.getVideoTracks()[0];
          if (processedVideoTrack) {
            peerConnectionsRef.current.forEach(async (pc) => {
              const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
              if (videoSender) {
                try { await videoSender.replaceTrack(processedVideoTrack); } catch { /* ignore */ }
              }
            });
          }
          wasUsingProcessedStream = false;
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (silentSource) { try { silentSource.stop(); } catch { /* ignore */ } }
      if (audioContext) { try { audioContext.close(); } catch { /* ignore */ } }
    };
  }, [processedStream, stream, cameraSettings.backgroundEffect]);

  // ========== Screen share toggle ==========
  const handleToggleScreenShare = useCallback(async () => {
    if (!currentUser.isScreenSharing) {
      try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 15 } },
          audio: false,
        });
        displayStream.getVideoTracks()[0].onended = () => {
          toggleScreenShare(false);
          if (activeScreenRef.current) {
            activeScreenRef.current.getTracks().forEach(t => t.stop());
            activeScreenRef.current = null;
            setScreenStream(null);
          }
        };
        activeScreenRef.current = displayStream;
        setScreenStream(displayStream);
        toggleScreenShare(true);
      } catch (err) {
        console.error("Screen Share Error:", err);
        toggleScreenShare(false);
      }
    } else {
      if (activeScreenRef.current) {
        activeScreenRef.current.getTracks().forEach(t => t.stop());
        activeScreenRef.current = null;
        setScreenStream(null);
      }
      toggleScreenShare(false);
    }
  }, [currentUser.isScreenSharing, toggleScreenShare]);

  return {
    stream,
    setStream,
    processedStream,
    setProcessedStream,
    screenStream,
    setScreenStream,
    activeStreamRef,
    activeScreenRef,
    effectiveStream,
    effectiveStreamRef,
    handleToggleScreenShare,
    crearAudioProcesado,
    limpiarAudioProcesado,
  };
}
