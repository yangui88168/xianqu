import { useEffect, useRef, useState, useCallback } from 'react';

interface CallModalProps {
  ws: WebSocket;
  userId: string;
  friendId: string;
  friendName: string;
  type: 'audio' | 'video';
  incoming?: boolean;
  offerSdp?: any;
  onHangup: () => void;
}

export default function CallModal({
  ws, userId, friendId, friendName, type, incoming, offerSdp, onHangup,
}: CallModalProps) {
  const [callStatus, setCallStatus] = useState<'calling' | 'connected' | 'ended'>('calling');
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const durationRef = useRef<NodeJS.Timeout | null>(null);
  const isClosedRef = useRef(false);                    // 防止重复操作
  const remoteStreamBoundRef = useRef(false);            // 防止重复绑定远程流
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]); // 缓存早到的 ICE 候选

  // 挂断（安全清理）
  const hangup = useCallback(() => {
    if (isClosedRef.current) return;
    isClosedRef.current = true;
    setCallStatus('ended');

    // 停止所有轨道
    localStreamRef.current?.getTracks().forEach((t) => t.stop());

    // 关闭连接
    pcRef.current?.close();
    pcRef.current = null;

    if (durationRef.current) clearInterval(durationRef.current);

    // 发送挂断信令（忽略发送失败）
    try {
      ws.send(JSON.stringify({ event: 'call-hangup', data: { targetId: friendId } }));
    } catch {}

    onHangup();
  }, [ws, friendId, onHangup]);

  // 静音
  const toggleMute = () => {
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !isMuted));
    setIsMuted(!isMuted);
  };

  // 摄像头开关
  const toggleCamera = () => {
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = !isCameraOff));
    setIsCameraOff(!isCameraOff);
  };

  const toggleSpeaker = () => setIsSpeakerOn(!isSpeakerOn);

  // 切换摄像头
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
      } catch (e) {
        console.error('切换摄像头失败', e);
      }
    }
  }, [facingMode]);

  useEffect(() => {
    // 重置标志
    isClosedRef.current = false;
    remoteStreamBoundRef.current = false;
    pendingCandidatesRef.current = [];

    const init = async () => {
      try {
        // 1. 获取本地流
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

        // 2. 创建对等连接
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

        // 3. 添加本地轨道
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        // 4. 远程流处理（安全绑定，仅一次）
        pc.ontrack = (event) => {
          if (isClosedRef.current || remoteStreamBoundRef.current) return;
          const remoteStream = event.streams[0];
          if (!remoteStream) return;
          remoteStreamBoundRef.current = true;

          console.log('✅ 远程流已接收');

          if (type === 'video' && remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
            remoteVideoRef.current.muted = true;
            remoteVideoRef.current.play().then(() => {
              if (remoteVideoRef.current && !isClosedRef.current) {
                remoteVideoRef.current.muted = false;
              }
            }).catch(() => {});
          }

          if (type === 'audio' && remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = remoteStream;
            remoteAudioRef.current.muted = true;
            remoteAudioRef.current.play().then(() => {
              if (remoteAudioRef.current && !isClosedRef.current) {
                remoteAudioRef.current.muted = false;
              }
            }).catch(() => {});
          }

          setCallStatus('connected');
          if (!durationRef.current) {
            durationRef.current = setInterval(() => setDuration((prev) => prev + 1), 1000);
          }
        };

        // 5. ICE 候选发送
        pc.onicecandidate = (event) => {
          if (isClosedRef.current) return;
          if (event.candidate) {
            ws.send(JSON.stringify({
              event: 'ice-candidate',
              data: { targetId: friendId, candidate: event.candidate },
            }));
          }
        };

        // 6. 信令处理（带状态检查）
        const handleSignal = (e: MessageEvent) => {
          if (isClosedRef.current) return;
          const msg = JSON.parse(e.data);

          if (msg.event === 'call-answer' && msg.data.from === friendId) {
            const pc = pcRef.current;
            if (pc && pc.signalingState !== 'closed') {
              pc.setRemoteDescription(new RTCSessionDescription(msg.data.sdp))
                .then(() => {
                  // 设置远程描述后，添加缓存的 ICE 候选
                  if (pendingCandidatesRef.current.length > 0) {
                    pendingCandidatesRef.current.forEach((c) => {
                      if (pc.signalingState !== 'closed') {
                        pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
                      }
                    });
                    pendingCandidatesRef.current = [];
                  }
                })
                .catch(() => {});
            }
          } else if (msg.event === 'ice-candidate' && msg.data.from === friendId) {
            const pc = pcRef.current;
            if (pc && pc.signalingState !== 'closed') {
              // 如果远程描述尚未设置，先缓存 ICE 候选
              if (pc.remoteDescription) {
                pc.addIceCandidate(new RTCIceCandidate(msg.data.candidate)).catch(() => {});
              } else {
                pendingCandidatesRef.current.push(msg.data.candidate);
              }
            }
          } else if (msg.event === 'call-hangup' && msg.data.from === friendId) {
            hangup();
          }
        };

        ws.addEventListener('message', handleSignal);

        // 7. 建立信令
        if (incoming && offerSdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          ws.send(JSON.stringify({
            event: 'call-answer',
            data: { targetId: friendId, sdp: answer },
          }));
        } else {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          ws.send(JSON.stringify({
            event: 'call-offer',
            data: { targetId: friendId, sdp: offer, type },
          }));
        }

        // 返回清理函数（仅移除监听器）
        return () => {
          ws.removeEventListener('message', handleSignal);
        };
      } catch (err) {
        console.error('通话初始化失败', err);
        if (!isClosedRef.current) {
          alert('无法访问摄像头/麦克风，请检查权限');
          hangup();
        }
      }
    };

    const cleanupPromise = init();

    // 最终清理
    return () => {
      isClosedRef.current = true;
      // 等待初始化完成再清理
      cleanupPromise?.then((cleanup) => {
        if (typeof cleanup === 'function') cleanup();
        localStreamRef.current?.getTracks().forEach((t) => t.stop());
        pcRef.current?.close();
        if (durationRef.current) clearInterval(durationRef.current);
      });
    };
  }, []);

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
            <div className="absolute top-4 left-4 bg-black/50 text-white text-sm px-3 py-1 rounded-full">
              {formatTime(duration)}
            </div>
          )}
          {callStatus === 'calling' && (
            <div className="absolute top-4 left-4 bg-black/50 text-white text-sm px-3 py-1 rounded-full">
              {incoming ? '邀请你进行通话...' : '呼叫中...'}
            </div>
          )}
        </div>

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
