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
  const remoteTrackIdsRef = useRef<Set<string>>(new Set());
  const durationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);
  const pauseTimeRef = useRef<number | null>(null);
  const isClosedRef = useRef(false);
  const pendingCandidatesRef = useRef<RTCIceCandidate[]>([]);
  const audioUnlockedRef = useRef(false);
  const makingOfferRef = useRef(false);
  const ignoreOfferRef = useRef(false);
  const politeRef = useRef(false);
  const iceRestartCountRef = useRef(0);
  const waitingForAnswerRef = useRef(false);
  const iceRestartTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const callTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const callStatusRef = useRef(callStatus);
  const audioContextRef = useRef<AudioContext | null>(null);
  const cameraSwitchingRef = useRef(false);
  const connectionPausedRef = useRef(false);
  const isCleanedUp = useRef(false);
  const isSettingRemoteAnswerPendingRef = useRef(false);
  const cameraChangeLock = useRef(false); // 防止连点

  useEffect(() => { callStatusRef.current = callStatus; }, [callStatus]);

  const removeWsListenersRef = useRef<() => void>(() => {});

  const safeSend = useCallback((data: any) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }, [ws]);

  const commonCleanup = useCallback(() => {
    if (isCleanedUp.current) return;
    isCleanedUp.current = true;

    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    remoteStreamRef.current?.getTracks().forEach((t) => t.stop());

    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
    if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
    if (iceRestartTimeoutRef.current) clearTimeout(iceRestartTimeoutRef.current);

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    pendingCandidatesRef.current.length = 0;
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

  const restartIce = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || isClosedRef.current || waitingForAnswerRef.current || iceRestartCountRef.current >= 2) return;

    iceRestartCountRef.current++;
    waitingForAnswerRef.current = true;

    if (iceRestartTimeoutRef.current) clearTimeout(iceRestartTimeoutRef.current);
    iceRestartTimeoutRef.current = setTimeout(() => {
      waitingForAnswerRef.current = false;
      iceRestartTimeoutRef.current = null;
    }, 15000);

    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      safeSend({ event: 'call-offer', data: { targetId: friendId, sdp: offer, type } });
    } catch (e) {
      console.error('ICE restart failed', e);
      hangup();
    }
  }, [safeSend, friendId, type, hangup]);

  // 绑定远程流到媒体元素，不干扰 React 的 muted 状态
  const bindRemoteStream = useCallback((stream: MediaStream) => {
    remoteStreamRef.current = stream;
    if (type === 'video') {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
        remoteVideoRef.current.play().catch(() => {});
        // 视频通话时不用单独的 audio 标签，视频自带声音
      }
    } else {
      // 音频通话
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = stream;
        remoteAudioRef.current.play().catch(() => {});
      }
    }
  }, [type]);

  const handleRemoteTrack = useCallback((event: RTCTrackEvent) => {
    if (isClosedRef.current) return;

    // Safari / Firefox 兼容：event.streams 可能为空
    const stream = event.streams?.[0] || (() => {
      const s = new MediaStream();
      s.addTrack(event.track);
      return s;
    })();

    // 每次 ontrack 都重新绑定，避免去重导致不更新
    bindRemoteStream(stream);

    setCallStatus('connected');
    if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);

    if (!durationTimerRef.current) {
      startTimeRef.current = Date.now();
      durationTimerRef.current = setInterval(() => {
        if (!connectionPausedRef.current) {
          setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
        }
      }, 1000);
    }

    // 监听轨道结束事件
    event.track.onended = () => console.log('Remote track ended:', event.track.kind);
    event.track.onmute = () => console.log('Remote track muted:', event.track.kind);
    event.track.onunmute = () => console.log('Remote track unmuted:', event.track.kind);
  }, [bindRemoteStream]);

  const handleSignal = useCallback(async (msg: any) => {
    if (isClosedRef.current) return;
    const pc = pcRef.current;
    if (!pc) return;

    try {
      if (msg.event === 'call-hangup') {
        hangupPassive();
        return;
      }

      const description = msg.data?.sdp;
      const candidate = msg.data?.candidate;

      if (description) {
        const isOffer = msg.event === 'call-offer';
        const isAnswer = msg.event === 'call-answer';

        if (isAnswer) {
          await pc.setRemoteDescription(new RTCSessionDescription(description));
          while (pendingCandidatesRef.current.length) {
            const cand = pendingCandidatesRef.current.shift()!;
            await pc.addIceCandidate(cand);
          }
          waitingForAnswerRef.current = false;
          iceRestartCountRef.current = 0;
          if (iceRestartTimeoutRef.current) {
            clearTimeout(iceRestartTimeoutRef.current);
            iceRestartTimeoutRef.current = null;
          }
          isSettingRemoteAnswerPendingRef.current = false;
        } else if (isOffer) {
          const offerCollision = makingOfferRef.current || pc.signalingState !== 'stable';
          ignoreOfferRef.current = !politeRef.current && offerCollision;
          if (ignoreOfferRef.current) return;

          if (offerCollision && politeRef.current && pc.signalingState === 'have-local-offer') {
            await pc.setLocalDescription({ type: 'rollback' });
          }

          isSettingRemoteAnswerPendingRef.current = true;
          await pc.setRemoteDescription(new RTCSessionDescription(description));
          while (pendingCandidatesRef.current.length) {
            const cand = pendingCandidatesRef.current.shift()!;
            await pc.addIceCandidate(cand);
          }

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          safeSend({ event: 'call-answer', data: { targetId: friendId, sdp: answer } });
          isSettingRemoteAnswerPendingRef.current = false;
        }
      } else if (candidate) {
        const iceCandidate = new RTCIceCandidate(candidate);
        if (pc.remoteDescription) {
          await pc.addIceCandidate(iceCandidate);
        } else {
          pendingCandidatesRef.current.push(iceCandidate);
        }
      }
    } catch (err) {
      console.error('信令处理错误', err);
    }
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
      remoteVideoRef.current?.play().catch(() => {});
      remoteAudioRef.current?.play().catch(() => {});
    };

    tryPlay();
    const events = ['pointerdown', 'touchstart', 'keydown'];
    const unlockHandler = () => {
      tryPlay();
      events.forEach(e => document.removeEventListener(e, unlockHandler));
    };
    events.forEach(e => document.addEventListener(e, unlockHandler, { once: true }));
  }, []);

  const toggleMute = useCallback(() => {
    unlockAudio();
    setIsMuted(prev => {
      const newMuted = !prev;
      localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !newMuted));
      return newMuted;
    });
  }, [unlockAudio]);

  const toggleCamera = useCallback(() => {
    unlockAudio();
    if (cameraChangeLock.current) return;
    cameraChangeLock.current = true;

    setIsCameraOff(prev => {
      const newOff = !prev;
      const videoTrack = localStreamRef.current?.getVideoTracks()[0];
      const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video');

      if (videoTrack && sender) {
        if (newOff) {
          // 关闭摄像头：仅禁用轨道，不用 replaceTrack(null)
          videoTrack.enabled = false;
        } else {
          // 打开摄像头：重新获取并替换轨道
          navigator.mediaDevices.getUserMedia({ video: true })
            .then(async newStream => {
              if (isClosedRef.current) {
                newStream.getTracks().forEach(t => t.stop());
                return;
              }
              const newTrack = newStream.getVideoTracks()[0];
              if (!newTrack) return;

              await sender.replaceTrack(newTrack);

              // 更新本地预览
              if (localVideoRef.current) localVideoRef.current.srcObject = newStream;
              // 更新 localStreamRef（保持音频不变，替换视频轨道）
              if (localStreamRef.current) {
                const oldVideoTrack = localStreamRef.current.getVideoTracks()[0];
                if (oldVideoTrack) {
                  localStreamRef.current.removeTrack(oldVideoTrack);
                  oldVideoTrack.stop();
                }
                localStreamRef.current.addTrack(newTrack);
              }
            })
            .catch(err => console.error('无法打开摄像头', err))
            .finally(() => { cameraChangeLock.current = false; });
        }
      } else {
        cameraChangeLock.current = false;
      }
      return newOff;
    });
  }, [unlockAudio]);

  const toggleSpeaker = useCallback(() => {
    unlockAudio();
    setIsSpeakerOn(prev => {
      const newOn = !prev;
      // 对于视频通话，通过 video 元素静音；音频通话通过 audio 元素
      if (type === 'video' && remoteVideoRef.current) {
        remoteVideoRef.current.muted = !newOn;
      } else if (remoteAudioRef.current) {
        remoteAudioRef.current.muted = !newOn;
      }
      return newOn;
    });
  }, [unlockAudio, type]);

  // 页面生命周期
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (pauseTimeRef.current !== null && !isClosedRef.current) {
          const pausedDuration = Date.now() - pauseTimeRef.current;
          startTimeRef.current += pausedDuration;
          pauseTimeRef.current = null;
        }
        connectionPausedRef.current = false;
      } else {
        if (callStatusRef.current === 'connected') {
          pauseTimeRef.current = Date.now();
        }
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
    pendingCandidatesRef.current.length = 0;
    audioUnlockedRef.current = false;
    makingOfferRef.current = false;
    ignoreOfferRef.current = false;
    iceRestartCountRef.current = 0;
    waitingForAnswerRef.current = false;
    isSettingRemoteAnswerPendingRef.current = false;
    remoteStreamRef.current = null;
    connectionPausedRef.current = false;
    cameraChangeLock.current = false;
    pauseTimeRef.current = null;

    politeRef.current = !!incoming;

    callTimeoutRef.current = setTimeout(() => {
      if (!cancelled && callStatusRef.current === 'calling') {
        hangup();
      }
    }, 30000);

    statsIntervalRef.current = setInterval(async () => {
      const pc = pcRef.current;
      if (!pc || isClosedRef.current) return;
      try {
        const receivers = pc.getReceivers();
        for (const receiver of receivers) {
          if (receiver.track.kind === 'video') {
            const stats = await receiver.getStats();
            for (const report of stats.values()) {
              if (report.type === 'inbound-rtp') {
                console.log('Video stats:', {
                  packetsLost: report.packetsLost,
                  jitter: report.jitter,
                  frameRate: report.framesPerSecond,
                });
              }
            }
          }
        }
      } catch (e) {}
    }, 5000);

    const init = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: type === 'video',
        });
        if (cancelled || isClosedRef.current) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
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
          iceTransportPolicy: 'all',
          bundlePolicy: 'max-bundle',
          rtcpMuxPolicy: 'require',
        });
        pcRef.current = pc;

        // 使用 transceiver 方式添加轨道
        const audioTransceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
        stream.getAudioTracks().forEach(track => audioTransceiver.sender.replaceTrack(track));
        if (type === 'video') {
          const videoTransceiver = pc.addTransceiver('video', { direction: 'sendrecv' });
          stream.getVideoTracks().forEach(track => videoTransceiver.sender.replaceTrack(track));
        }

        pc.ontrack = handleRemoteTrack;

        pc.onicecandidate = (event) => {
          if (isClosedRef.current) return;
          if (event.candidate) {
            safeSend({ event: 'ice-candidate', data: { targetId: friendId, candidate: event.candidate } });
          }
        };

        // 关键：监听 iceConnectionState 而非仅 connectionState
        pc.oniceconnectionstatechange = () => {
          if (isClosedRef.current) return;
          console.log('iceConnectionState:', pc.iceConnectionState);
          if (pc.iceConnectionState === 'failed') {
            restartIce();
          } else if (pc.iceConnectionState === 'disconnected') {
            setTimeout(() => {
              if (pc.iceConnectionState === 'disconnected') hangup();
            }, 10000);
          } else if (pc.iceConnectionState === 'closed') {
            hangupPassive();
          }
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

        if (incoming) {
          if (offerSdp && pc.signalingState === 'stable' && !pc.remoteDescription) {
            await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
            while (pendingCandidatesRef.current.length) {
              const cand = pendingCandidatesRef.current.shift()!;
              await pc.addIceCandidate(cand);
            }
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            safeSend({ event: 'call-answer', data: { targetId: friendId, sdp: answer } });
          }
        } else {
          makingOfferRef.current = true;
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          safeSend({ event: 'call-offer', data: { targetId: friendId, sdp: offer, type } });
          makingOfferRef.current = false;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatTime = (sec: number) =>
    `${Math.floor(sec / 60).toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black" onClick={unlockAudio}>
      <div className="relative flex flex-col items-center w-full h-full max-w-3xl mx-auto">
        {/* 音频通话时隐藏的 audio 元素，视频通话时不需要 */}
        {type === 'audio' && <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />}
        <div className="relative w-full h-full flex items-center justify-center bg-gray-900">
          {type === 'video' ? (
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              // muted 由 React 状态和 toggleSpeaker 控制，不再强制静音
              muted={!isSpeakerOn}
              className="w-full h-full object-cover"
              onLoadedMetadata={() => remoteVideoRef.current?.play().catch(() => {})}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-white">
              <div className="text-8xl mb-4">🎤</div>
              <p className="text-2xl font-medium">{friendName}</p>
            </div>
          )}
          {type === 'video' && (
            <div className="absolute top-4 right-4 w-32 h-48 bg-gray-700 rounded-xl overflow-hidden border-2 border-white shadow-lg">
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover"
                onLoadedMetadata={() => localVideoRef.current?.play().catch(() => {})}
              />
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
