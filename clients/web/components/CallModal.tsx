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
  const pauseTimeRef = useRef<number | null>(null);     // 暂停开始时的时间戳
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
  const isSettingRemoteAnswerPendingRef = useRef(false); // 完美协商增强

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

    // 媒体轨道
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    remoteStreamRef.current?.getTracks().forEach((t) => t.stop());

    // PeerConnection
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    // 定时器
    if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
    if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
    if (iceRestartTimeoutRef.current) clearTimeout(iceRestartTimeoutRef.current);

    // AudioContext
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    // 清空候选
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

  // ---------- ICE 重启（含状态检查） ----------
  const restartIce = useCallback(async () => {
    const pc = pcRef.current;
    if (
      !pc ||
      isClosedRef.current ||
      waitingForAnswerRef.current ||
      iceRestartCountRef.current >= 2 ||
      pc.connectionState === 'closed' ||
      pc.connectionState === 'failed' ||
      pc.signalingState !== 'stable'   // 只有 stable 时才能重启
    ) return;

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

  // ---------- 远程轨道处理 ----------
  const handleRemoteTrack = useCallback((event: RTCTrackEvent) => {
    if (isClosedRef.current) return;

    const remoteStream = event.streams[0];
    if (!remoteStream) return;

    // 更新远程流引用（重协商可能产生新流）
    remoteStreamRef.current = remoteStream;

    let hasNewTrack = false;
    for (const track of remoteStream.getTracks()) {
      if (!remoteTrackIdsRef.current.has(track.id)) {
        remoteTrackIdsRef.current.add(track.id);
        hasNewTrack = true;

        // 轨道结束或静音/恢复
        track.onended = () => {
          remoteTrackIdsRef.current.delete(track.id);
          console.log('Remote track ended:', track.kind);
        };
        track.onmute = () => console.log('Remote track muted:', track.kind);
        track.onunmute = () => console.log('Remote track unmuted:', track.kind);
      }
    }

    if (!hasNewTrack) return;

    // 绑定到播放元素
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play().catch(() => {});
    }
    if (type === 'video' && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.muted = true;
      remoteVideoRef.current.play().catch(() => {});
    }

    setCallStatus('connected');
    if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);

    // 启动精确计时（支持暂停）
    if (!durationTimerRef.current) {
      startTimeRef.current = Date.now();
      durationTimerRef.current = setInterval(() => {
        if (!connectionPausedRef.current) {
          setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
        }
      }, 1000);
    }
  }, [type]);

  // ---------- 信令处理（完美协商 + 防交叉） ----------
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
          // 收到 answer
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
          // 完美协商冲突检测
          const offerCollision =
            makingOfferRef.current || pc.signalingState !== 'stable';

          ignoreOfferRef.current = !politeRef.current && offerCollision;
          if (ignoreOfferRef.current) {
            return;
          }

          // 避免 answer/offer 交叉（官方 isSettingRemoteAnswerPending）
          if (isSettingRemoteAnswerPendingRef.current) {
            // 等待 answer 设置完成，暂时忽略 offer
            return;
          }

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

  // ---------- 音频解锁 ----------
  const unlockAudio = useCallback(() => {
    if (audioUnlockedRef.current) return;
    audioUnlockedRef.current = true;
    setAudioUnlocked(true);

    const tryPlay = () => {
      if (!audioContextRef.current) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          audioContextRef.current = new AudioCtx();
        }
      }
      audioContextRef.current?.resume().catch(() => {});

      remoteAudioRef.current?.play().catch(() => {});
      if (type === 'video' && remoteVideoRef.current) {
        remoteVideoRef.current.muted = false;
        remoteVideoRef.current.play().catch(() => {});
      }
    };

    tryPlay();
    const events = ['pointerdown', 'touchstart', 'keydown'];
    const unlockHandler = () => {
      tryPlay();
      events.forEach(e => document.removeEventListener(e, unlockHandler));
    };
    events.forEach(e => document.addEventListener(e, unlockHandler, { once: true }));
  }, [type]);

  // ---------- 按钮控制 ----------
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
    if (cameraSwitchingRef.current) return;
    cameraSwitchingRef.current = true;

    setIsCameraOff(prev => {
      const newOff = !prev;
      const videoTrack = localStreamRef.current?.getVideoTracks()[0];
      const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video');

      if (videoTrack && sender) {
        if (newOff) {
          // 关闭摄像头
          videoTrack.enabled = false;
          sender.replaceTrack(null).catch(() => {}); // 尝试释放编码器
          // 完成切换
          cameraSwitchingRef.current = false;
        } else {
          // 打开摄像头
          navigator.mediaDevices.getUserMedia({ video: true })
            .then(newStream => {
              if (isClosedRef.current) {
                newStream.getTracks().forEach(t => t.stop());
                return;
              }
              const newTrack = newStream.getVideoTracks()[0];
              if (!newTrack) return;

              sender.replaceTrack(newTrack).catch(() => {});
              if (localVideoRef.current) {
                localVideoRef.current.srcObject = newStream;
              }
              // 更新 localStreamRef 中的视频轨道（不破坏音频）
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
            .finally(() => {
              cameraSwitchingRef.current = false;
            });
        }
      } else {
        cameraSwitchingRef.current = false;
      }
      return newOff;
    });
  }, [unlockAudio]);

  const toggleSpeaker = useCallback(() => {
    unlockAudio();
    setIsSpeakerOn(prev => {
      const newOn = !prev;
      if (remoteAudioRef.current) {
        remoteAudioRef.current.muted = !newOn;
      }
      return newOn;
    });
  }, [unlockAudio]);

  // ---------- 页面生命周期（全面监听） ----------
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        // 从暂停中恢复
        if (pauseTimeRef.current !== null && !isClosedRef.current) {
          const pausedDuration = Date.now() - pauseTimeRef.current;
          startTimeRef.current += pausedDuration;
          pauseTimeRef.current = null;
        }
        connectionPausedRef.current = false;
      } else {
        // 进入后台，记录暂停时间
        if (callStatusRef.current === 'connected') {
          pauseTimeRef.current = Date.now();
        }
        connectionPausedRef.current = true;
      }
    };

    const handlePageHide = () => {
      // 页面被冻结或卸载前暂停计时
      if (callStatusRef.current === 'connected') {
        pauseTimeRef.current = Date.now();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('freeze', handlePageHide);
    window.addEventListener('resume', () => {
      // Safari 恢复
      if (pauseTimeRef.current !== null && !isClosedRef.current) {
        const pausedDuration = Date.now() - pauseTimeRef.current;
        startTimeRef.current += pausedDuration;
        pauseTimeRef.current = null;
      }
      connectionPausedRef.current = false;
    });

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('freeze', handlePageHide);
    };
  }, []);

  // ---------- 主初始化 ----------
  useEffect(() => {
    let cancelled = false;
    isClosedRef.current = false;
    isCleanedUp.current = false;
    pendingCandidatesRef.current.length = 0;
    remoteTrackIdsRef.current.clear();
    audioUnlockedRef.current = false;
    makingOfferRef.current = false;
    ignoreOfferRef.current = false;
    iceRestartCountRef.current = 0;
    waitingForAnswerRef.current = false;
    isSettingRemoteAnswerPendingRef.current = false;
    remoteStreamRef.current = null;
    connectionPausedRef.current = false;
    cameraSwitchingRef.current = false;
    pauseTimeRef.current = null;

    // 角色：被叫方 polite，主叫方 impolite
    politeRef.current = !!incoming;

    // 呼叫超时（30秒）
    callTimeoutRef.current = setTimeout(() => {
      if (!cancelled && callStatusRef.current === 'calling') {
        hangup();
      }
    }, 30000);

    // Stats 轮询（仅视频 receiver）
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
          localVideoRef.current.onloadedmetadata = () => localVideoRef.current?.play().catch(() => {});
        }

        const pc = new RTCPeerConnection({
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            {
              urls: 'turn:openrelay.metered.ca:443',
              username: 'openrelayproject',
              credential: 'openrelayproject',
            },
            {
              urls: 'turn:global.relay.metered.ca:443',
              username: '680a360a85d7aad8037a5be4',
              credential: 'Uz8+sEjedvuGre/9',
            },
          ],
          iceTransportPolicy: 'all',
          bundlePolicy: 'max-bundle',
          rtcpMuxPolicy: 'require',
        });
        pcRef.current = pc;

        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        pc.ontrack = handleRemoteTrack;

        pc.onicecandidate = (event) => {
          if (isClosedRef.current) return;
          if (event.candidate) {
            safeSend({
              event: 'ice-candidate',
              data: { targetId: friendId, candidate: event.candidate },
            });
          }
        };

        pc.onconnectionstatechange = () => {
          if (isClosedRef.current) return;
          console.log('connectionState:', pc.connectionState);
          if (pc.connectionState === 'failed') {
            restartIce();
          } else if (pc.connectionState === 'disconnected') {
            // 等待10秒看是否恢复
            setTimeout(() => {
              if (pc.connectionState === 'disconnected') hangup();
            }, 10000);
          } else if (pc.connectionState === 'closed') {
            hangupPassive();
          }
        };

        pc.oniceconnectionstatechange = () => {
          if (isClosedRef.current) return;
          console.log('iceConnectionState:', pc.iceConnectionState);
        };

        // 信令监听
        const onWsMessage = (e: MessageEvent) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.data?.from !== friendId) return;
            handleSignal(msg);
          } catch {}
        };
        const onWsClose = () => {
          // 等待5秒，可能重连
          setTimeout(() => {
            if (!isClosedRef.current) hangup();
          }, 5000);
        };

        ws.addEventListener('message', onWsMessage);
        ws.addEventListener('close', onWsClose);
        removeWsListenersRef.current = () => {
          ws.removeEventListener('message', onWsMessage);
          ws.removeEventListener('close', onWsClose);
        };

        // 呼叫建立
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
        <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
        <div className="relative w-full h-full flex items-center justify-center bg-gray-900">
          {type === 'video' ? (
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              muted={!audioUnlocked}
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
