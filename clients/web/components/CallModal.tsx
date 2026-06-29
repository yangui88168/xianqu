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
  const [remoteVideoMuted, setRemoteVideoMuted] = useState(true); // 受控状态

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const durationRef = useRef<NodeJS.Timeout | null>(null);
  const isClosedRef = useRef(false);
  const remoteStreamBoundRef = useRef(false);
  const pendingCandidatesRef = useRef<RTCIceCandidate[]>([]);
  const audioUnlockedRef = useRef(false);
  const makingOfferRef = useRef(false);
  const ignoreOfferRef = useRef(false);
  const politeRef = useRef(false);
  const initiatingRef = useRef(false);

  // 保存 WebSocket 监听器移除函数
  const removeWsListenerRef = useRef<() => void>(() => {});

  // 安全的 WebSocket 发送
  const safeSend = useCallback((data: any) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }, [ws]);

  // 挂断逻辑（内部不会重复发送）
  const hangup = useCallback(() => {
    if (isClosedRef.current) return;
    isClosedRef.current = true;
    setCallStatus('ended');

    // 停止媒体轨道
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    remoteStreamRef.current?.getTracks().forEach((t) => t.stop());
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (durationRef.current) {
      clearInterval(durationRef.current);
      durationRef.current = null;
    }
    // 清理信令监听
    removeWsListenerRef.current();

    safeSend({ event: 'call-hangup', data: { targetId: friendId } });
    onHangup();
  }, [safeSend, friendId, onHangup]);

  // 收到挂断时直接退出，不再发送
  const hangupPassive = useCallback(() => {
    if (isClosedRef.current) return;
    isClosedRef.current = true;
    setCallStatus('ended');

    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    remoteStreamRef.current?.getTracks().forEach((t) => t.stop());
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (durationRef.current) clearInterval(durationRef.current);
    removeWsListenerRef.current();
    onHangup();
  }, [onHangup]);

  // 远程流处理
  const handleRemoteStream = useCallback((remoteStream: MediaStream) => {
    if (isClosedRef.current || remoteStreamBoundRef.current) return;
    remoteStreamBoundRef.current = true;
    remoteStreamRef.current = remoteStream;

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play().catch(() => {});
    }
    if (type === 'video' && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
      // 视频初始静音，由用户交互解锁
      remoteVideoRef.current.muted = true;
      remoteVideoRef.current.play().catch(() => {});
    }

    setCallStatus('connected');
    if (!durationRef.current) {
      durationRef.current = setInterval(() => setDuration((prev) => prev + 1), 1000);
    }
  }, [type]);

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
        // 完美协商相关标志
        const isOffer = msg.event === 'call-offer';
        const isAnswer = msg.event === 'call-answer';

        if (isAnswer) {
          // 收到 answer，直接设置
          await pc.setRemoteDescription(new RTCSessionDescription(description));
          // 处理排队的 ICE candidate
          while (pendingCandidatesRef.current.length) {
            const cand = pendingCandidatesRef.current.shift()!;
            await pc.addIceCandidate(cand);
          }
        } else if (isOffer) {
          // 收到 offer
          const readyForOffer =
            !makingOfferRef.current &&
            (pc.signalingState === 'stable' || ignoreOfferRef.current);

          if (!readyForOffer) {
            // 冲突处理：根据 polite/impolite 角色
            if (politeRef.current) {
              // 我是 polite 端，先回滚本地描述，再接受远端 offer
              ignoreOfferRef.current = true;
              await pc.setLocalDescription({ type: 'rollback' });
              await pc.setRemoteDescription(new RTCSessionDescription(description));
              while (pendingCandidatesRef.current.length) {
                const cand = pendingCandidatesRef.current.shift()!;
                await pc.addIceCandidate(cand);
              }
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              safeSend({ event: 'call-answer', data: { targetId: friendId, sdp: answer } });
              ignoreOfferRef.current = false;
            } else {
              // 我是 impolite 端，忽略重复 offer
              console.warn('Ignoring repeated offer');
            }
            return;
          }

          // 正常接受 offer
          ignoreOfferRef.current = true;
          await pc.setRemoteDescription(new RTCSessionDescription(description));
          while (pendingCandidatesRef.current.length) {
            const cand = pendingCandidatesRef.current.shift()!;
            await pc.addIceCandidate(cand);
          }
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          safeSend({ event: 'call-answer', data: { targetId: friendId, sdp: answer } });
          ignoreOfferRef.current = false;
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

  // 解锁音频（用户交互触发）
  const unlockAudio = useCallback(() => {
    if (audioUnlockedRef.current) return;
    audioUnlockedRef.current = true;
    setAudioUnlocked(true);
    if (remoteAudioRef.current) {
      remoteAudioRef.current.play().catch(() => {});
    }
    if (type === 'video' && remoteVideoRef.current) {
      setRemoteVideoMuted(false);
      remoteVideoRef.current.muted = false;
      remoteVideoRef.current.play().catch(() => {});
    }
  }, [type]);

  // 按钮控制
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
      localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = !newOff));
      return newOff;
    });
  }, [unlockAudio]);

  const toggleSpeaker = useCallback(() => {
    unlockAudio();
    // 尝试使用 setSinkId 切换扬声器（Chrome 支持）
    const audioEl = remoteAudioRef.current;
    if (audioEl && 'setSinkId' in audioEl) {
      // 这里简单地切换默认设备（如需设备选择，应使用 enumerateDevices）
      // 此处仅为示例：在扬声器开启时使用默认设备，关闭时可能静音或切换
      if (isSpeakerOn) {
        (audioEl as any).setSinkId('').catch(() => {});
        audioEl.muted = true;
      } else {
        (audioEl as any).setSinkId('').catch(() => {});
        audioEl.muted = false;
      }
    } else {
      // 不支持 setSinkId 时，回退到静音控制
      if (audioEl) {
        audioEl.muted = !isSpeakerOn;
      }
    }
    setIsSpeakerOn(prev => !prev);
  }, [unlockAudio, isSpeakerOn]);

  // 主初始化逻辑
  useEffect(() => {
    let cancelled = false;

    // 重置状态
    isClosedRef.current = false;
    remoteStreamBoundRef.current = false;
    pendingCandidatesRef.current = [];
    audioUnlockedRef.current = false;
    makingOfferRef.current = false;
    ignoreOfferRef.current = false;

    // 设置角色：主叫方为 polite，被叫方为 impolite
    politeRef.current = !incoming;

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
        });
        pcRef.current = pc;

        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        pc.ontrack = (event) => {
          const [remote] = event.streams;
          if (remote && !remoteStreamBoundRef.current) {
            handleRemoteStream(remote);
          }
        };

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
          const state = pc.connectionState;
          console.log('connectionState:', state);
          if (state === 'failed' || state === 'disconnected') {
            hangup();
          }
        };

        pc.oniceconnectionstatechange = () => {
          if (isClosedRef.current) return;
          console.log('iceConnectionState:', pc.iceConnectionState);
          if (pc.iceConnectionState === 'failed') {
            hangup();
          }
        };

        // 信令监听器
        const onWsMessage = (e: MessageEvent) => {
          const msg = JSON.parse(e.data);
          if (msg.data?.from !== friendId) return;
          handleSignal(msg);
        };

        const onWsClose = () => {
          hangup();
        };

        ws.addEventListener('message', onWsMessage);
        ws.addEventListener('close', onWsClose);

        // 保存移除函数，以便 cleanup 调用
        removeWsListenerRef.current = () => {
          ws.removeEventListener('message', onWsMessage);
          ws.removeEventListener('close', onWsClose);
        };

        // 呼叫建立逻辑
        if (incoming) {
          // 被叫方：如果有预先传入的 offerSdp，则直接使用（避免重复 answer）
          if (offerSdp && !pc.remoteDescription) {
            await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
            while (pendingCandidatesRef.current.length) {
              const cand = pendingCandidatesRef.current.shift()!;
              await pc.addIceCandidate(cand);
            }
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            safeSend({ event: 'call-answer', data: { targetId: friendId, sdp: answer } });
          }
          // 否则，等待 handleSignal 中的 call-offer
        } else {
          // 主叫方
          makingOfferRef.current = true;
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          safeSend({ event: 'call-offer', data: { targetId: friendId, sdp: offer, type } });
          makingOfferRef.current = false;
        }
      } catch (err) {
        console.error('初始化通话失败', err);
        alert('无法访问摄像头/麦克风');
        onHangup();
      }
    };

    init().catch(console.error);

    // 清理函数（组件卸载或依赖变化时执行）
    return () => {
      cancelled = true;
      isClosedRef.current = true;

      // 停止媒体
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      remoteStreamRef.current?.getTracks().forEach((t) => t.stop());

      // 关闭 PeerConnection
      pcRef.current?.close();
      pcRef.current = null;

      // 清除计时器
      if (durationRef.current) clearInterval(durationRef.current);

      // 移除信令监听（关键！）
      removeWsListenerRef.current();
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
              muted={remoteVideoMuted}   // 受控状态，避免 React 覆盖
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
              <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
            </div>
          )}
          <div className="absolute top-4 left-4 bg-black/50 text-white text-sm px-3 py-1 rounded-full">
            {callStatus === 'connected' ? formatTime(duration) : incoming ? '等待连接...' : '呼叫中...'}
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
