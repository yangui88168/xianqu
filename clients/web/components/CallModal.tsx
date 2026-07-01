import { useEffect, useRef, useState, useCallback } from 'react';

interface CallModalProps {
  ws: WebSocket;
  friendId: string;
  friendName: string;
  type: 'audio' | 'video';
  incoming?: boolean;
  offerSdp?: any;
  onHangup: () => void;
}

export default function CallModal({
  ws, friendId, friendName, type, incoming, offerSdp, onHangup,
}: CallModalProps) {
  const [callStatus, setCallStatus] = useState<'calling' | 'connected' | 'ended'>('calling');
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const durationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);
  const pauseTimeRef = useRef<number | null>(null);
  const isClosedRef = useRef(false);
  const pendingCandidatesRef = useRef<Map<number, RTCIceCandidate[]>>(new Map());
  const audioUnlockedRef = useRef(false);
  const makingOffer = useRef(false);
  const ignoreOffer = useRef(false);
  const politeRef = useRef(false);
  const iceRestartCountRef = useRef(0);
  const waitingForAnswerRef = useRef(false);
  const iceRestartTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const callTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const callStatusRef = useRef(callStatus);
  const isCleanedUp = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const connectionPausedRef = useRef(false);
  const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const iceGenerationRef = useRef(0);
  const remoteUfragRef = useRef<string | null>(null);
  const localUfragRef = useRef<string | null>(null);
  const restartingIceRef = useRef(false);
  const makingAnswerRef = useRef(false);
  const connectedSentRef = useRef(false);

  useEffect(() => { callStatusRef.current = callStatus; }, [callStatus]);

  const removeWsListenersRef = useRef<() => void>(() => {});

  const safeSend = useCallback((data: any) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }, [ws]);

  const getUfrag = (sdp?: string) => sdp?.match(/ice-ufrag:(\S+)/)?.[1] ?? null;

  const commonCleanup = useCallback(() => {
    if (isCleanedUp.current) return;
    isCleanedUp.current = true;
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    remoteStreamRef.current?.getTracks().forEach(t => t.stop());
    if (pcRef.current) {
      pcRef.current.getSenders().forEach(s => s.replaceTrack(null).catch(() => {}));
      pcRef.current.close();
      pcRef.current = null;
    }
    if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
    if (iceRestartTimeoutRef.current) clearTimeout(iceRestartTimeoutRef.current);
    if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
    if (audioContextRef.current) { audioContextRef.current.close().catch(() => {}); audioContextRef.current = null; }
    pendingCandidatesRef.current.clear();
    removeWsListenersRef.current();
  }, []);

  const hangup = useCallback(() => {
    if (isClosedRef.current) return;
    isClosedRef.current = true;
    setCallStatus('ended');
    commonCleanup();
    safeSend({ event: 'call-hangup', data: { targetId: friendId } });
    onHangup();
  }, [commonCleanup, safeSend, friendId, onHangup]);

  const hangupPassive = useCallback(() => {
    if (isClosedRef.current) return;
    isClosedRef.current = true;
    setCallStatus('ended');
    commonCleanup();
    onHangup();
  }, [commonCleanup, onHangup]);

  const startStatsMonitor = useCallback(() => {
    if (statsIntervalRef.current) return;
    statsIntervalRef.current = setInterval(async () => {
      const pc = pcRef.current;
      if (!pc || isClosedRef.current) return;
      try {
        const stats = await pc.getStats();
        let videoBytes = -1, audioBytes = -1;
        for (const [, r] of stats) {
          if (r.type === 'inbound-rtp') {
            if (r.kind === 'video') videoBytes = r.bytesReceived;
            if (r.kind === 'audio') audioBytes = r.bytesReceived;
          }
        }
        const lastCheck = lastCheckRef.current;
        const now = Date.now();
        if (lastCheck.time && (now - lastCheck.time > 1000)) {
          if (type === 'video' && videoBytes === lastCheck.videoBytes && videoBytes !== -1) {
            noDataCountRef.current++;
          } else if (type === 'audio' && audioBytes === lastCheck.audioBytes && audioBytes !== -1) {
            noDataCountRef.current++;
          } else {
            noDataCountRef.current = 0;
          }
          if (noDataCountRef.current >= 5) {
            restartIce();
            noDataCountRef.current = 0;
          }
          lastCheck.videoBytes = videoBytes;
          lastCheck.audioBytes = audioBytes;
          lastCheck.time = now;
        }
      } catch (e) {}
    }, 1000);
  }, [type, restartIce]);

  const lastCheckRef = useRef<{ videoBytes: number; audioBytes: number; time: number }>({ videoBytes: -1, audioBytes: -1, time: 0 });
  const noDataCountRef = useRef(0);

  const runNegotiation = useCallback(async (options?: { iceRestart?: boolean }) => {
    const pc = pcRef.current;
    if (!pc || isClosedRef.current || makingOffer.current || pc.signalingState !== 'stable') return;
    makingOffer.current = true;
    try {
      const offer = await pc.createOffer({ iceRestart: options?.iceRestart ?? false });
      await pc.setLocalDescription(offer);
      localUfragRef.current = getUfrag(pc.localDescription?.sdp);
      safeSend({ event: 'call-offer', data: { targetId: friendId, sdp: offer, type } });
    } catch (e) {
      console.error('negotiation error', e);
    } finally {
      makingOffer.current = false;
    }
  }, [safeSend, friendId, type]);

  const restartIce = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || isClosedRef.current || restartingIceRef.current || iceRestartCountRef.current >= 3) {
      if (iceRestartCountRef.current >= 3) hangup();
      return;
    }
    restartingIceRef.current = true;
    iceRestartCountRef.current++;
    iceGenerationRef.current += 1;
    waitingForAnswerRef.current = true;

    if (iceRestartTimeoutRef.current) clearTimeout(iceRestartTimeoutRef.current);
    iceRestartTimeoutRef.current = setTimeout(() => {
      waitingForAnswerRef.current = false;
      if (pc.signalingState === 'have-local-offer') pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
      pendingCandidatesRef.current.delete(iceGenerationRef.current);
    }, 15000);

    try {
      await runNegotiation({ iceRestart: true });
    } catch (e) {
      console.error('ICE restart failed', e);
      hangup();
    } finally {
      restartingIceRef.current = false;
    }
  }, [runNegotiation, hangup]);

  const bindRemoteMedia = useCallback((stream: MediaStream) => {
    if (isClosedRef.current) return;
    const tryPlay = (el: HTMLMediaElement) => {
      if (!el) return;
      el.srcObject = stream;
      el.play().catch(() => {
        el.muted = true;
        el.play().catch(() => {});
        setAudioUnlocked(false);
      });
    };
    if (type === 'video' && remoteVideoRef.current) {
      remoteVideoRef.current.muted = false;
      tryPlay(remoteVideoRef.current);
    } else if (type === 'audio' && remoteAudioRef.current) {
      tryPlay(remoteAudioRef.current);
    }
  }, [type]);

  const markConnected = useCallback(() => {
    if (connectedSentRef.current) return;
    connectedSentRef.current = true;
    setCallStatus('connected');
    if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
    if (!durationTimerRef.current) {
      startTimeRef.current = Date.now();
      durationTimerRef.current = setInterval(() => {
        if (!connectionPausedRef.current) setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    }
  }, []);

  const handleRemoteTrack = useCallback((event: RTCTrackEvent) => {
    if (isClosedRef.current) return;
    if (!remoteStreamRef.current) remoteStreamRef.current = new MediaStream();
    const stream = remoteStreamRef.current;
    const track = event.track;

    const old = stream.getTracks().filter(t => t.kind === track.kind);
    old.forEach(t => stream.removeTrack(t));
    stream.addTrack(track);

    track.onended = () => {
      if (stream.getTracks().includes(track)) {
        stream.removeTrack(track);
        track.stop();
      }
      bindRemoteMedia(stream);
    };
    track.onmute = () => console.log('Remote track muted:', track.kind);
    track.onunmute = () => console.log('Remote track unmuted:', track.kind);

    bindRemoteMedia(stream);
  }, [bindRemoteMedia]);

  const handleSignal = useCallback(async (msg: any) => {
    if (isClosedRef.current) return;
    const pc = pcRef.current;
    if (!pc) return;
    try {
      if (msg.event === 'call-hangup') { hangupPassive(); return; }

      const desc = msg.data?.sdp;
      const cand = msg.data?.candidate;

      if (desc) {
        const sdp = new RTCSessionDescription(desc);
        if (sdp.type === 'answer') {
          if (pc.currentRemoteDescription) return;
          if (pc.signalingState !== 'have-local-offer') {
            console.warn('answer received but signaling state is', pc.signalingState);
          }
          try {
            await pc.setRemoteDescription(sdp);
          } catch (e) {
            console.error('setRemoteDescription for answer failed', e);
          }
          remoteUfragRef.current = getUfrag(pc.remoteDescription?.sdp);
          const gen = iceGenerationRef.current;
          const cands = pendingCandidatesRef.current.get(gen);
          if (cands) {
            for (const c of cands) await pc.addIceCandidate(c);
            pendingCandidatesRef.current.delete(gen);
          }
          waitingForAnswerRef.current = false;
          iceRestartCountRef.current = 0;
          if (iceRestartTimeoutRef.current) { clearTimeout(iceRestartTimeoutRef.current); iceRestartTimeoutRef.current = null; }
        } else if (sdp.type === 'offer') {
          if (!politeRef.current) return;

          const offerCollision = makingOffer.current || pc.signalingState !== 'stable';
          if (offerCollision) {
            if (pc.signalingState === 'have-local-offer') {
              await pc.setLocalDescription({ type: 'rollback' });
              waitingForAnswerRef.current = false;
              iceRestartCountRef.current = 0;
            }
          }

          if (makingAnswerRef.current) return;
          makingAnswerRef.current = true;
          try {
            await pc.setRemoteDescription(sdp);
            remoteUfragRef.current = getUfrag(pc.remoteDescription?.sdp);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            safeSend({ event: 'call-answer', data: { targetId: friendId, sdp: answer } });
          } finally {
            makingAnswerRef.current = false;
          }
        }
      } else if (cand) {
        const candUfrag = msg.data?.ufrag;
        if (remoteUfragRef.current && candUfrag && candUfrag !== remoteUfragRef.current) return;
        const ice = new RTCIceCandidate(cand);
        if (pc.remoteDescription) {
          await pc.addIceCandidate(ice);
        } else {
          const gen = iceGenerationRef.current;
          const arr = pendingCandidatesRef.current.get(gen) || [];
          arr.push(ice);
          pendingCandidatesRef.current.set(gen, arr);
        }
      }
    } catch (err) { console.error('signal error', err); }
  }, [safeSend, friendId, hangupPassive]);

  const unlockAudio = useCallback(() => {
    if (audioUnlockedRef.current) return;
    audioUnlockedRef.current = true;
    setAudioUnlocked(true);
    const tryPlay = () => {
      if (!audioContextRef.current) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) audioContextRef.current = new AudioCtx();
      }
      audioContextRef.current?.resume().catch(() => {});
      if (remoteStreamRef.current) bindRemoteMedia(remoteStreamRef.current);
    };
    tryPlay();
    const events = ['pointerdown', 'touchstart', 'keydown'];
    const handler = () => { tryPlay(); events.forEach(e => document.removeEventListener(e, handler)); };
    events.forEach(e => document.addEventListener(e, handler, { once: true }));
  }, [bindRemoteMedia]);

  const toggleMute = useCallback(() => {
    unlockAudio();
    setIsMuted(prev => {
      const newMuted = !prev;
      localStreamRef.current?.getAudioTracks().forEach(t => t.enabled = !newMuted);
      return newMuted;
    });
  }, [unlockAudio]);

  const toggleCamera = useCallback(() => {
    unlockAudio();
    const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video');
    if (!sender) return;
    setIsCameraOff(prev => {
      const newOff = !prev;
      if (newOff) {
        sender.track && (sender.track.enabled = false);
      } else {
        navigator.mediaDevices.getUserMedia({ video: true })
          .then(async newStream => {
            const newTrack = newStream.getVideoTracks()[0];
            if (newTrack) {
              newTrack.enabled = true;
              const oldTrack = sender.track;
              await sender.replaceTrack(newTrack);
              if (oldTrack) oldTrack.stop();
              const params = sender.getParameters();
              if (!params.encodings) params.encodings = [{}];
              params.encodings[0].maxBitrate = 1200000;
              sender.setParameters(params).catch(() => {});
              if (localVideoRef.current) localVideoRef.current.srcObject = newStream;
              if (localStreamRef.current) {
                const oldVideo = localStreamRef.current.getVideoTracks()[0];
                if (oldVideo) { localStreamRef.current.removeTrack(oldVideo); oldVideo.stop(); }
                localStreamRef.current.addTrack(newTrack);
              }
              newStream.getAudioTracks().forEach(t => t.stop());
            }
          }).catch(console.error);
      }
      return newOff;
    });
  }, [unlockAudio]);

  const toggleSpeaker = useCallback(() => {
    unlockAudio();
    setIsSpeakerOn(prev => !prev);
  }, [unlockAudio]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (pauseTimeRef.current !== null && !isClosedRef.current) {
          startTimeRef.current += Date.now() - pauseTimeRef.current;
          pauseTimeRef.current = null;
        }
        connectionPausedRef.current = false;
      } else {
        if (callStatusRef.current === 'connected') pauseTimeRef.current = Date.now();
        connectionPausedRef.current = true;
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  useEffect(() => {
    let cancelled = false;
    isClosedRef.current = false;
    isCleanedUp.current = false;
    pendingCandidatesRef.current.clear();
    audioUnlockedRef.current = false;
    makingOffer.current = false;
    ignoreOffer.current = false;
    iceRestartCountRef.current = 0;
    iceGenerationRef.current = 0;
    remoteUfragRef.current = null;
    localUfragRef.current = null;
    makingAnswerRef.current = false;
    connectedSentRef.current = false;
    politeRef.current = !!incoming;

    callTimeoutRef.current = setTimeout(() => {
      if (!cancelled && callStatusRef.current === 'calling') hangup();
    }, 30000);

    const init = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: type === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } : false,
        });
        if (cancelled || isClosedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          localVideoRef.current.play().catch(() => {});
        }

        const pc = new RTCPeerConnection({
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:global.relay.metered.ca:443', username: '680a360a85d7aad8037a5be4', credential: 'Uz8+sEjedvuGre/9' },
          ],
        });
        pcRef.current = pc;

        stream.getTracks().forEach(track => pc.addTrack(track, stream));
        if (type === 'video') {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender) {
            const params = sender.getParameters();
            if (!params.encodings) params.encodings = [{}];
            params.encodings[0].maxBitrate = 1200000;
            sender.setParameters(params).catch(() => {});
          }
        }

        startStatsMonitor();

        pc.ontrack = handleRemoteTrack;
        pc.onicecandidate = (e) => {
          if (isClosedRef.current || !e.candidate) return;
          const ufrag = localUfragRef.current;
          safeSend({ event: 'ice-candidate', data: { targetId: friendId, candidate: e.candidate, ufrag } });
        };

        pc.onconnectionstatechange = () => {
          if (isClosedRef.current) return;
          const state = pc.connectionState;
          console.log('connectionState:', state);
          if (state === 'connected' || state === 'completed') markConnected();
          else if (state === 'failed') restartIce();
          else if (state === 'closed') hangupPassive();
          else if (state === 'disconnected') {
            setTimeout(() => { if (pc.connectionState === 'disconnected') restartIce(); }, 5000);
          }
        };
        pc.oniceconnectionstatechange = () => {
          if (isClosedRef.current) return;
          console.log('iceConnectionState:', pc.iceConnectionState);
          if (pc.iceConnectionState === 'failed') restartIce();
        };

        const onWsMessage = (e: MessageEvent) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.data?.from !== friendId) return;
            handleSignal(msg);
          } catch {}
        };
        const onWsClose = () => setTimeout(() => { if (!isClosedRef.current) hangup(); }, 5000);
        ws.addEventListener('message', onWsMessage);
        ws.addEventListener('close', onWsClose);
        removeWsListenersRef.current = () => {
          ws.removeEventListener('message', onWsMessage);
          ws.removeEventListener('close', onWsClose);
        };

        if (!incoming) {
          setTimeout(() => runNegotiation(), 50);
        } else if (offerSdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
          remoteUfragRef.current = getUfrag(pc.remoteDescription?.sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          safeSend({ event: 'call-answer', data: { targetId: friendId, sdp: answer } });
        }
      } catch (err) {
        console.error(err);
        alert('无法访问摄像头/麦克风');
        onHangup();
      }
    };

    init().catch(console.error);

    return () => {
      cancelled = true;
      isClosedRef.current = true;
      commonCleanup();
    };
    // eslint-disable-next-line
  }, []);

  const formatTime = (sec: number) =>
    `${Math.floor(sec / 60).toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black" onClick={unlockAudio}>
      <div className="relative flex flex-col items-center w-full h-full max-w-3xl mx-auto">
        {type === 'audio' && <audio ref={remoteAudioRef} autoPlay playsInline muted={false} className="hidden" />}
        <div className="relative w-full h-full flex items-center justify-center bg-gray-900">
          {type === 'video' ? (
            <video ref={remoteVideoRef} autoPlay playsInline muted={false} className="w-full h-full object-cover" />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-white">
              <div className="text-8xl mb-4">🎤</div>
              <p className="text-2xl font-medium">{friendName}</p>
            </div>
          )}
          {type === 'video' && (
            <div className="absolute top-4 right-4 w-32 h-48 bg-gray-700 rounded-xl overflow-hidden border-2 border-white shadow-lg">
              <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
            </div>
          )}
          <div className="absolute top-4 left-4 bg-black/50 text-white text-sm px-3 py-1 rounded-full">
            {callStatus === 'connected' ? formatTime(duration) : incoming ? '等待接听...' : '呼叫中...'}
          </div>
          {callStatus === 'connected' && !audioUnlocked && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white text-lg cursor-pointer">
              点击任意位置开始通话
            </div>
          )}
        </div>

        <div className="absolute bottom-8 left-0 right-0 flex items-center justify-center gap-4">
          <div className="flex items-center gap-3 bg-gray-800/80 px-6 py-4 rounded-full">
            <button onClick={toggleMute} className={`w-12 h-12 rounded-full flex items-center justify-center text-white ${isMuted ? 'bg-red-500' : 'bg-gray-600 hover:bg-gray-500'}`}>
              {isMuted ? '🔇' : '🎙️'}
            </button>
            <button onClick={hangup} className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center text-white text-3xl shadow-lg">
              📞
            </button>
            <button onClick={toggleSpeaker} className={`w-12 h-12 rounded-full flex items-center justify-center text-white ${isSpeakerOn ? 'bg-gray-600 hover:bg-gray-500' : 'bg-blue-500'}`}>
              {isSpeakerOn ? '🔊' : '🔈'}
            </button>
            {type === 'video' && (
              <button onClick={toggleCamera} className={`w-12 h-12 rounded-full flex items-center justify-center text-white ${isCameraOff ? 'bg-red-500' : 'bg-gray-600 hover:bg-gray-500'}`}>
                {isCameraOff ? '📷❌' : '📷'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
