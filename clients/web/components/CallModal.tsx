import { useEffect, useRef, useState, useCallback } from 'react';

interface CallModalProps {
  ws: WebSocket;
  friendId: string;
  friendName: string;
  type: 'audio' | 'video';
  incoming?: boolean;
  offerSdp?: any;            // 被叫方预先收到的 offer（备用）
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
  const remoteTrackIdsRef = useRef<Set<string>>(new Set()); // 改用 track id 判断重协商
  const durationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);
  const isClosedRef = useRef(false);
  const pendingCandidatesRef = useRef<RTCIceCandidate[]>([]);
  const audioUnlockedRef = useRef(false);
  const makingOfferRef = useRef(false);
  const ignoreOfferRef = useRef(false);
  // 修正：Caller = impolite，Callee = polite
  const politeRef = useRef(false); // 将在初始化时正确设置
  const iceRestartCountRef = useRef(0);
  const waitingForAnswerRef = useRef(false);
  const iceRestartTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const callTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const callStatusRef = useRef(callStatus); // 解决闭包问题

  // 同步状态到 ref
  useEffect(() => { callStatusRef.current = callStatus; }, [callStatus]);

  // 移除 WebSocket 监听器
  const removeWsListenersRef = useRef<() => void>(() => {});

  // 安全发送
  const safeSend = useCallback((data: any) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }, [ws]);

  // 公共清理（避免重复执行）
  const isCleanedUp = useRef(false);
  const commonCleanup = useCallback(() => {
    if (isCleanedUp.current) return;
    isCleanedUp.current = true;

    // 停止所有媒体轨道
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    remoteStreamRef.current?.getTracks().forEach((t) => t.stop());

    // 关闭 PeerConnection
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    // 清除所有定时器
    if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
    if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
    if (iceRestartTimeoutRef.current) clearTimeout(iceRestartTimeoutRef.current);

    // 移除 WebSocket 监听
    removeWsListenersRef.current();
  }, []);

  // 挂断（主动）
  const hangup = useCallback(() => {
    if (isClosedRef.current) return;
    isClosedRef.current = true;
    setCallStatus('ended');
    commonCleanup();
    safeSend({ event: 'call-hangup', data: { targetId: friendId } });
    onHangup();
  }, [commonCleanup, safeSend, friendId, onHangup]);

  // 挂断（被动，不发送信令）
  const hangupPassive = useCallback(() => {
    if (isClosedRef.current) return;
    isClosedRef.current = true;
    setCallStatus('ended');
    commonCleanup();
    onHangup();
  }, [commonCleanup, onHangup]);

  // ICE 重启（含超时恢复）
  const restartIce = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || isClosedRef.current || waitingForAnswerRef.current || iceRestartCountRef.current >= 2) return;

    iceRestartCountRef.current++;
    waitingForAnswerRef.current = true;

    // 15 秒超时，若未收到 answer 则重置状态，允许下次重启
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

  // 处理远程轨道（支持重协商）
  const handleRemoteTrack = useCallback((event: RTCTrackEvent) => {
    if (isClosedRef.current) return;

    const remoteStream = event.streams[0];
    if (!remoteStream) return;

    // 改用 track.id 判断是否为新轨道
    let hasNewTrack = false;
    event.track && !remoteTrackIdsRef.current.has(event.track.id) && (hasNewTrack = true);

    if (!hasNewTrack) return;

    // 记录新 track
    if (event.track) remoteTrackIdsRef.current.add(event.track.id);

    // 如果还没有绑定过 stream 对象，则绑定
    if (!remoteStreamRef.current) {
      remoteStreamRef.current = remoteStream;
    }

    // 绑定到播放元素
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStreamRef.current;
      remoteAudioRef.current.play().catch(() => {});
    }
    if (type === 'video' && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current;
      remoteVideoRef.current.muted = true; // 初始静音，等用户解锁
      remoteVideoRef.current.play().catch(() => {});
    }

    // 状态更新
    setCallStatus('connected');
    if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);

    // 开始计时（防止重复）
    if (!durationTimerRef.current) {
      startTimeRef.current = Date.now();
      durationTimerRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    }

    // 监听远程轨道事件
    if (event.track) {
      event.track.onended = () => console.log('Remote track ended:', event.track.kind);
      event.track.onmute = () => console.log('Remote track muted:', event.track.kind);
      event.track.onunmute = () => console.log('Remote track unmuted:', event.track.kind);
    }
  }, [type]);

  // 信令处理（完美协商）
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

        // ---------- 完美协商核心 ----------
        if (isAnswer) {
          await pc.setRemoteDescription(new RTCSessionDescription(description));
          // 处理排队的 candidates
          while (pendingCandidatesRef.current.length) {
            const cand = pendingCandidatesRef.current.shift()!;
            await pc.addIceCandidate(cand);
          }
          // ICE restart 成功，重置状态
          waitingForAnswerRef.current = false;
          iceRestartCountRef.current = 0;
          if (iceRestartTimeoutRef.current) {
            clearTimeout(iceRestartTimeoutRef.current);
            iceRestartTimeoutRef.current = null;
          }
        } else if (isOffer) {
          // 检查冲突
          const offerCollision =
            makingOfferRef.current || pc.signalingState !== 'stable';

          ignoreOfferRef.current = !politeRef.current && offerCollision;
          if (ignoreOfferRef.current) {
            return;
          }

          // polite 端在冲突时先回滚
          if (offerCollision && politeRef.current) {
            await pc.setLocalDescription({ type: 'rollback' });
          }

          await pc.setRemoteDescription(new RTCSessionDescription(description));
          // 清空 candidates 缓存（因为已经设置了远程描述）
          while (pendingCandidatesRef.current.length) {
            const cand = pendingCandidatesRef.current.shift()!;
            await pc.addIceCandidate(cand);
          }

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          safeSend({ event: 'call-answer', data: { targetId: friendId, sdp: answer } });
        }
      } else if (candidate) {
        // ICE candidate
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

  // 音频解锁（彻底，包含 AudioContext）
  const unlockAudio = useCallback(() => {
    if (audioUnlockedRef.current) return;
    audioUnlockedRef.current = true;
    setAudioUnlocked(true);

    const tryPlay = () => {
      // 恢复 AudioContext（Android 需要）
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContext) {
        const ctx = new AudioContext();
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
      }

      remoteAudioRef.current?.play().catch(() => {});
      if (type === 'video' && remoteVideoRef.current) {
        remoteVideoRef.current.muted = false;
        remoteVideoRef.current.play().catch(() => {});
      }
    };

    tryPlay();
    // 监听全局事件以确保 iOS/Safari 解锁
    const events = ['pointerdown', 'touchstart', 'keydown'];
    const unlockHandler = () => {
      tryPlay();
      events.forEach(e => document.removeEventListener(e, unlockHandler));
    };
    events.forEach(e => document.addEventListener(e, unlockHandler, { once: true }));
  }, [type]);

  // 按钮操作
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
    setIsCameraOff(prev => {
      const newOff = !prev;
      const videoTrack = localStreamRef.current?.getVideoTracks()[0];
      const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video');

      if (videoTrack && sender) {
        if (newOff) {
          // 关闭摄像头：停止轨道并替换为空轨道（兼容性更好）
          videoTrack.stop();
          // 使用一个空的音频轨道来占位，避免 sender 错误
          const emptyTrack = new MediaStreamTrack();
          sender.replaceTrack(emptyTrack).catch(() => {
            // 若不支持 replaceTrack(null)，则仅 enabled = false
            videoTrack.enabled = false;
          });
        } else {
          // 打开摄像头：重新获取视频轨道并替换
          navigator.mediaDevices.getUserMedia({ video: true })
            .then(newStream => {
              const newVideoTrack = newStream.getVideoTracks()[0];
              if (sender) {
                sender.replaceTrack(newVideoTrack);
              }
              // 更新本地视频预览
              if (localVideoRef.current) {
                localVideoRef.current.srcObject = newStream;
              }
              // 更新 localStreamRef 中的视频轨道（但不替换整个 stream）
              if (localStreamRef.current) {
                const oldVideoTrack = localStreamRef.current.getVideoTracks()[0];
                if (oldVideoTrack) {
                  localStreamRef.current.removeTrack(oldVideoTrack);
                  oldVideoTrack.stop();
                }
                localStreamRef.current.addTrack(newVideoTrack);
              }
            })
            .catch(err => console.error('无法获取摄像头', err));
        }
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

  // 初始化
  useEffect(() => {
    let cancelled = false;
    isClosedRef.current = false;
    isCleanedUp.current = false;
    pendingCandidatesRef.current = [];
    remoteTrackIdsRef.current.clear();
    audioUnlockedRef.current = false;
    makingOfferRef.current = false;
    ignoreOfferRef.current = false;
    iceRestartCountRef.current = 0;
    waitingForAnswerRef.current = false;
    remoteStreamRef.current = null;

    // 修正角色：Caller 为 impolite，Callee 为 polite
    politeRef.current = !incoming; // true = polite (被叫), false = impolite (主叫)

    // 呼叫超时（30秒），使用 ref 避免闭包
    callTimeoutRef.current = setTimeout(() => {
      if (!cancelled && callStatusRef.current === 'calling') {
        hangup();
      }
    }, 30000);

    // Stats 轮询（每5秒，优化性能）
    statsIntervalRef.current = setInterval(async () => {
      const pc = pcRef.current;
      if (!pc || isClosedRef.current) return;
      try {
        const stats = await pc.getStats();
        for (const report of stats.values()) {
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            console.log('Video stats:', {
              packetsLost: report.packetsLost,
              jitter: report.jitter,
              frameRate: report.framesPerSecond,
            });
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
          // iOS 兼容：确保播放
          localVideoRef.current.onloadedmetadata = () => {
            localVideoRef.current?.play().catch(() => {});
          };
          localVideoRef.current.play().catch(() => {});
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

        // 添加本地轨道
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        // 创建 DataChannel（备用）
        try {
          pc.createDataChannel('chat');
        } catch (e) {}

        // 远程轨道事件
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
            // 等待 10 秒，可能自动恢复
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
          // 等待 5 秒看是否重连，否则挂断
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
          // 被叫方：如果有预先传入的 offerSdp 且信令状态允许，则使用
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
          // 否则等待信令中的 offer
        } else {
          // 主叫方：创建 offer
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
              muted={!audioUnlocked} // 解锁前保持静音
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
