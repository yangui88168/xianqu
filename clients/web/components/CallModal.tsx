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
  const [isSpeakerOn, setIsSpeakerOn] = useState(true); // 控制远端声音
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null); // 长期维护的远端流
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
  const callStatusRef = useRef(callStatus);
  const isCleanedUp = useRef(false);
  const cameraChangeLock = useRef(false);

  useEffect(() => { callStatusRef.current = callStatus; }, [callStatus]);

  const removeWsListenersRef = useRef<() => void>(() => {});

  const safeSend = useCallback((data: any) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }, [ws]);

  // ---------- 清理 ----------
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
    if (iceRestartTimeoutRef.current) clearTimeout(iceRestartTimeoutRef.current);

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

  // ICE 重启
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

  // 绑定远端媒体元素（避免反复创建绑定）
  const bindRemoteMedia = useCallback((stream: MediaStream) => {
    if (isClosedRef.current) return;
    if (type === 'video' && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = stream;
      remoteVideoRef.current.onloadedmetadata = () => {
        remoteVideoRef.current?.play().catch(() => {});
      };
    } else if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = stream;
      remoteAudioRef.current.onloadedmetadata = () => {
        remoteAudioRef.current?.play().catch(() => {});
      };
    }
  }, [type]);

  // ontrack 处理：维护一个统一的远端 MediaStream
  const handleRemoteTrack = useCallback((event: RTCTrackEvent) => {
    if (isClosedRef.current) return;

    // 创建或获取统一的远端流对象
    if (!remoteStreamRef.current) {
      remoteStreamRef.current = new MediaStream();
    }

    // 将新 track 添加到统一流中
    const stream = remoteStreamRef.current;
    if (!stream.getTracks().some(t => t.id === event.track.id)) {
      stream.addTrack(event.track);
    }

    // 绑定到 UI
    bindRemoteMedia(stream);

    // 状态更新
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

    // 监听轨道事件
    event.track.onended = () => console.log('Remote track ended:', event.track.kind);
    event.track.onmute = () => console.log('Remote track muted:', event.track.kind);
    event.track.onunmute = () => console.log('Remote track unmuted:', event.track.kind);
  }, [bindRemoteMedia]);

  const connectionPausedRef = useRef(false);

  // 信令处理
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
        } else if (isOffer) {
          const offerCollision = makingOfferRef.current || pc.signalingState !== 'stable';
          ignoreOfferRef.current = !politeRef.current && offerCollision;
          if (ignoreOfferRef.current) return;

          if (offerCollision && politeRef.current && pc.signalingState === 'have-local-offer') {
            await pc.setLocalDescription({ type: 'rollback' });
          }

          await pc.setRemoteDescription(new RTCSessionDescription(description));
          while (pendingCandidatesRef.current.length) {
            const cand = pendingCandidatesRef.current.shift()!;
            await pc.addIceCandidate(cand);
          }

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          safeSend({ event: 'call-answer', data: { targetId: friendId, sdp: answer } });
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
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        new AudioCtx().resume().catch(() => {});
      }
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
          videoTrack.enabled = false; // 关闭摄像头
        } else {
          navigator.mediaDevices.getUserMedia({ video: true })
            .then(async newStream => {
              if (isClosedRef.current) {
                newStream.getTracks().forEach(t => t.stop());
                return;
              }
              const newTrack = newStream.getVideoTracks()[0];
              if (!newTrack) return;
              await sender.replaceTrack(newTrack);
              if (localVideoRef.current) localVideoRef.current.srcObject = newStream;
              // 更新本地流
              if (localStreamRef.current) {
                const oldVideoTrack = localStreamRef.current.getVideoTracks()[0];
                if (oldVideoTrack) {
                  localStreamRef.current.removeTrack(oldVideoTrack);
                  oldVideoTrack.stop();
                }
                localStreamRef.current.addTrack(newTrack);
              }
            })
            .catch(err => console.error('打开摄像头失败', err))
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
    setIsSpeakerOn(prev => !prev); // React 状态驱动 muted
  }, [unlockAudio]);

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

  // 主初始化
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
    remoteStreamRef.current = null;
    connectionPausedRef.current = false;
    cameraChangeLock.current = false;
    pauseTimeRef.current = null;

    politeRef.current = !!incoming; // 被叫 polite，主叫 impolite

    callTimeoutRef.current = setTimeout(() => {
      if (!cancelled && callStatusRef.current === 'calling') {
        hangup();
      }
    }, 30000);

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

        // 使用 addTrack 初始化（标准做法）
        stream.getTracks().forEach(track => pc.addTrack(track, stream));

        pc.ontrack = handleRemoteTrack;

        pc.onicecandidate = (event) => {
          if (isClosedRef.current) return;
          if (event.candidate) {
            // 打印 candidate 类型便于调试 TURN
            console.log('ICE candidate:', event.candidate.type, event.candidate.candidate);
            safeSend({ event: 'ice-candidate', data: { targetId: friendId, candidate: event.candidate } });
          }
        };

        // 监听 iceConnectionState
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
          const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: type === 'video',
          });
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
        {/* 音频通话时才渲染隐藏的 audio 元素 */}
        {type === 'audio' && (
          <audio
            ref={remoteAudioRef}
            autoPlay
            playsInline
            muted={!isSpeakerOn} // 由 React 状态控制
            className="hidden"
          />
        )}
        <div className="relative w-full h-full flex items-center justify-center bg-gray-900">
          {type === 'video' ? (
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              muted={!isSpeakerOn} // 由 React 状态控制静音
              className="w-full h-full object-cover"
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
