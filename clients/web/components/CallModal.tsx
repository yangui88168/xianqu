import { useEffect, useRef, useState, useCallback } from 'react';

interface CallModalProps {
  ws: WebSocket;
  friendId: string;
  friendName: string;
  type: 'audio' | 'video';
  incoming?: boolean;
  accepted?: boolean;         // 主叫方使用：对方已接受
  offerSdp?: any;            // 被叫方使用：主叫方的 SDP
  onHangup: () => void;
}

export default function CallModal({
  ws, friendId, friendName, type, incoming, accepted, offerSdp, onHangup,
}: CallModalProps) {
  const [callStatus, setCallStatus] = useState<'calling' | 'connected' | 'ended'>('calling');
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [audioBlocked, setAudioBlocked] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const durationRef = useRef<NodeJS.Timeout | null>(null);
  const isClosedRef = useRef(false);
  const remoteStreamBoundRef = useRef(false);   // 防止重复绑定
  const pendingOfferRef = useRef<any>(null);    // 缓存早到的 offer

  // 挂断
  const hangup = useCallback(() => {
    if (isClosedRef.current) return;
    isClosedRef.current = true;
    setCallStatus('ended');
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    pcRef.current?.close();
    pcRef.current = null;
    if (durationRef.current) clearInterval(durationRef.current);
    try {
      ws.send(JSON.stringify({ event: 'call-hangup', data: { targetId: friendId } }));
    } catch {}
    onHangup();
  }, [ws, friendId, onHangup]);

  // 解锁音频
  const unlockAudio = useCallback(() => {
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = true;
      remoteAudioRef.current.play().then(() => {
        if (remoteAudioRef.current) remoteAudioRef.current.muted = false;
      }).catch(() => {});
    }
  }, []);

  const toggleMute = () => {
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !isMuted));
    setIsMuted(!isMuted);
    unlockAudio();
  };
  const toggleCamera = () => {
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = !isCameraOff));
    setIsCameraOff(!isCameraOff);
    unlockAudio();
  };
  const toggleSpeaker = () => setIsSpeakerOn(!isSpeakerOn);

  const switchCamera = useCallback(async () => {
    const newMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(newMode);
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach((t) => t.stop());
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: newMode },
          audio: true,
        });
        const videoTrack = newStream.getVideoTracks()[0];
        const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(videoTrack);
        if (localVideoRef.current) localVideoRef.current.srcObject = newStream;
        localStreamRef.current = newStream;
      } catch (e) { console.error(e); }
    }
  }, [facingMode]);

  // 绑定远程流（安全调用，防止重复）
  const bindRemoteStream = useCallback((remoteStream: MediaStream) => {
    if (isClosedRef.current || remoteStreamBoundRef.current) return;
    remoteStreamBoundRef.current = true;

    const playElement = (el: HTMLVideoElement | HTMLAudioElement) => {
      el.srcObject = remoteStream;
      el.muted = true;
      el.play().then(() => {
        if (!isClosedRef.current && el) el.muted = false;
      }).catch(() => {});
    };

    if (type === 'video' && remoteVideoRef.current) playElement(remoteVideoRef.current);
    if (type === 'audio' && remoteAudioRef.current) playElement(remoteAudioRef.current);

    setCallStatus('connected');
    if (!durationRef.current) {
      durationRef.current = setInterval(() => setDuration((prev) => prev + 1), 1000);
    }
  }, [type]);

  // 创建 PeerConnection 并添加本地流
  const createPeerConnection = useCallback((stream: MediaStream) => {
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
      if (remote) bindRemoteStream(remote);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        ws.send(JSON.stringify({
          event: 'ice-candidate',
          data: { targetId: friendId, candidate: event.candidate },
        }));
      }
    };
  }, [ws, friendId, bindRemoteStream]);

  // 初始化：获取本地流，然后根据角色建立连接
  useEffect(() => {
    isClosedRef.current = false;
    remoteStreamBoundRef.current = false;

    const init = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: type === 'video' ? { facingMode: 'user' } : false,
        });
        if (isClosedRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;

        // 信令监听
        const handleSignal = (e: MessageEvent) => {
          if (isClosedRef.current) return;
          const msg = JSON.parse(e.data);
          if (msg.data?.from !== friendId) return;

          if (msg.event === 'call-answer') {
            pcRef.current?.setRemoteDescription(new RTCSessionDescription(msg.data.sdp)).catch(console.error);
          } else if (msg.event === 'ice-candidate') {
            pcRef.current?.addIceCandidate(new RTCIceCandidate(msg.data.candidate)).catch(console.error);
          } else if (msg.event === 'call-hangup') {
            hangup();
          } else if (msg.event === 'call-offer' && incoming) {
            // 被叫方收到主叫方的 SDP
            const pc = pcRef.current;
            if (pc) {
              pendingOfferRef.current = msg.data.sdp;
              pc.setRemoteDescription(new RTCSessionDescription(msg.data.sdp))
                .then(() => pc.createAnswer())
                .then((answer) => {
                  pc.setLocalDescription(answer);
                  ws.send(JSON.stringify({
                    event: 'call-answer',
                    data: { targetId: friendId, sdp: answer },
                  }));
                })
                .catch(console.error);
            }
          }
        };
        ws.addEventListener('message', handleSignal);

        if (incoming) {
          // 被叫方：先创建空的 PC，等待主叫方 offer
          createPeerConnection(stream);
          // 如果 offerSdp 已经存在（可能早于 PC 创建），立即处理
          if (offerSdp) {
            const pc = pcRef.current;
            if (pc) {
              pc.setRemoteDescription(new RTCSessionDescription(offerSdp))
                .then(() => pc.createAnswer())
                .then((answer) => {
                  pc.setLocalDescription(answer);
                  ws.send(JSON.stringify({
                    event: 'call-answer',
                    data: { targetId: friendId, sdp: answer },
                  }));
                })
                .catch(console.error);
            }
          }
        } else {
          // 主叫方：等待 accepted 变为 true
          // 在外部通过 accepted 属性控制
          if (accepted) {
            // 如果已经是已接受状态，立即创建并发送 offer
            createPeerConnection(stream);
            const pc = pcRef.current;
            if (pc) {
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              ws.send(JSON.stringify({
                event: 'call-offer',
                data: { targetId: friendId, sdp: offer, type },
              }));
            }
          } else {
            // 否则，等待 accepted 变为 true（通过另一个 useEffect 处理）
          }
        }

        return () => {
          ws.removeEventListener('message', handleSignal);
        };
      } catch (err) {
        console.error(err);
        alert('无法访问摄像头/麦克风');
        onHangup();
      }
    };

    init();

    return () => {
      isClosedRef.current = true;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      pcRef.current?.close();
      if (durationRef.current) clearInterval(durationRef.current);
    };
  }, []);

  // 监听 accepted 变化（主叫方）
  useEffect(() => {
    if (!incoming && accepted && localStreamRef.current && !pcRef.current) {
      // 对方已接受，创建连接并发送 offer
      createPeerConnection(localStreamRef.current);
      const pc = pcRef.current;
      if (pc) {
        pc.createOffer().then((offer) => {
          pc.setLocalDescription(offer);
          ws.send(JSON.stringify({
            event: 'call-offer',
            data: { targetId: friendId, sdp: offer, type },
          }));
        }).catch(console.error);
      }
    }
  }, [accepted, incoming, createPeerConnection, ws, friendId, type]);

  const formatTime = (sec: number) =>
    `${Math.floor(sec / 60).toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90">
      <div className="relative flex flex-col items-center w-full max-w-sm mx-auto h-full max-h-screen py-4">
        <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

        <div className="relative w-full aspect-video bg-gray-900 rounded-2xl overflow-hidden mb-4 flex items-center justify-center">
          {type === 'video' ? (
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-white">
              <div className="text-6xl mb-2">🎤</div>
              <p className="text-lg font-medium">{friendName}</p>
            </div>
          )}
          {type === 'video' && (
            <div className="absolute bottom-4 right-4 w-24 h-36 bg-gray-700 rounded-xl overflow-hidden border-2 border-white shadow-lg">
              <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
            </div>
          )}
          {callStatus === 'connected' && (
            <div className="absolute top-4 left-4 bg-black/50 text-white text-sm px-3 py-1 rounded-full">{formatTime(duration)}</div>
          )}
          {callStatus === 'calling' && (
            <div className="absolute top-4 left-4 bg-black/50 text-white text-sm px-3 py-1 rounded-full">
              {incoming ? '等待连接...' : '等待对方接听...'}
            </div>
          )}
        </div>

        {audioBlocked && (
          <button onClick={unlockAudio} className="mb-4 bg-blue-500 text-white px-4 py-2 rounded-full text-sm">
            点击播放声音
          </button>
        )}

        <div className="flex items-center gap-3 bg-gray-800/80 px-5 py-3 rounded-full mt-auto mb-6">
          <button onClick={toggleMute} className={`w-10 h-10 rounded-full flex items-center justify-center text-white ${isMuted ? 'bg-red-500' : 'bg-gray-600 hover:bg-gray-500'}`}>
            {isMuted ? '🔇' : '🎙️'}
          </button>
          <button onClick={hangup} className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center text-white text-2xl shadow-lg">
            📞
          </button>
          <button onClick={toggleSpeaker} className={`w-10 h-10 rounded-full flex items-center justify-center text-white ${isSpeakerOn ? 'bg-gray-600 hover:bg-gray-500' : 'bg-blue-500'}`}>
            {isSpeakerOn ? '🔊' : '🔈'}
          </button>
          {type === 'video' && (
            <>
              <button onClick={toggleCamera} className={`w-10 h-10 rounded-full flex items-center justify-center text-white ${isCameraOff ? 'bg-red-500' : 'bg-gray-600 hover:bg-gray-500'}`}>
                {isCameraOff ? '📷❌' : '📷'}
              </button>
              <button onClick={switchCamera} className="w-10 h-10 rounded-full flex items-center justify-center text-white bg-gray-600 hover:bg-gray-500">
                🔄
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
