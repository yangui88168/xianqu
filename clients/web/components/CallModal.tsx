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
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  // 不再使用隐藏的 audio 元素，改用 AudioContext
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const durationRef = useRef<NodeJS.Timeout | null>(null);
  const isClosedRef = useRef(false);

  // 挂断
  const hangup = useCallback(() => {
    if (isClosedRef.current) return;
    isClosedRef.current = true;
    setCallStatus('ended');
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    pcRef.current?.close();
    pcRef.current = null;
    if (durationRef.current) clearInterval(durationRef.current);
    try { ws.send(JSON.stringify({ event: 'call-hangup', data: { targetId: friendId } })); } catch {}
    onHangup();
  }, [ws, friendId, onHangup]);

  const toggleMute = () => {
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !isMuted));
    setIsMuted(!isMuted);
  };
  const toggleCamera = () => {
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = !isCameraOff));
    setIsCameraOff(!isCameraOff);
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

  // 使用 AudioContext 播放远程音频流
  const playRemoteAudio = useCallback((stream: MediaStream) => {
    if (typeof window === 'undefined') return;
    try {
      // 确保 AudioContext 已创建
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      // 如果 AudioContext 处于挂起状态（浏览器自动播放策略），尝试恢复
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      // 创建媒体流源并连接到扬声器
      const source = ctx.createMediaStreamSource(stream);
      source.connect(ctx.destination);
      console.log('🔊 远程音频已通过 AudioContext 播放');
    } catch (e) {
      console.error('音频播放失败', e);
    }
  }, []);

  // 绑定远程流（视频直接绑定，音频用 AudioContext）
  const bindRemoteStream = useCallback((remoteStream: MediaStream) => {
    if (isClosedRef.current) return;
    remoteStreamRef.current = remoteStream;

    // 视频绑定
    if (type === 'video' && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play().catch(console.error);
    }
    // 音频统一用 AudioContext 播放（通话双方都需要听到对方声音）
    playRemoteAudio(remoteStream);

    setCallStatus('connected');
    if (!durationRef.current) {
      durationRef.current = setInterval(() => setDuration((prev) => prev + 1), 1000);
    }
  }, [type, playRemoteAudio]);

  useEffect(() => {
    isClosedRef.current = false;

    const init = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: type === 'video' ? { facingMode: 'user' } : false,
        });
        if (isClosedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;

        const pc = new RTCPeerConnection({
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:global.relay.metered.ca:443', username: '680a360a85d7aad8037a5be4', credential: 'Uz8+sEjedvuGre/9' },
          ],
        });
        pcRef.current = pc;
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        pc.ontrack = (event) => {
          const [remote] = event.streams;
          if (remote) bindRemoteStream(remote);
        };

        pc.onicecandidate = (event) => {
          if (isClosedRef.current) return;
          if (event.candidate) {
            ws.send(JSON.stringify({ event: 'ice-candidate', data: { targetId: friendId, candidate: event.candidate } }));
          }
        };

        const handleSignal = (e: MessageEvent) => {
          if (isClosedRef.current) return;
          const msg = JSON.parse(e.data);
          if (msg.data?.from !== friendId) return;

          if (msg.event === 'call-answer') {
            console.log('📩 收到 answer');
            pc.setRemoteDescription(new RTCSessionDescription(msg.data.sdp)).catch(console.error);
          } else if (msg.event === 'ice-candidate') {
            pc.addIceCandidate(new RTCIceCandidate(msg.data.candidate)).catch(console.error);
          } else if (msg.event === 'call-hangup') {
            hangup();
          } else if (msg.event === 'call-offer' && incoming) {
            console.log('📩 被叫方收到 offer');
            pc.setRemoteDescription(new RTCSessionDescription(msg.data.sdp))
              .then(() => pc.createAnswer())
              .then((answer) => {
                pc.setLocalDescription(answer);
                ws.send(JSON.stringify({ event: 'call-answer', data: { targetId: friendId, sdp: answer } }));
              })
              .catch(console.error);
          }
        };
        ws.addEventListener('message', handleSignal);

        if (incoming) {
          if (offerSdp) {
            console.log('🔑 使用初始 offerSdp 建立连接');
            await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(JSON.stringify({ event: 'call-answer', data: { targetId: friendId, sdp: answer } }));
          }
        } else {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          console.log('📤 主叫发送 offer');
          ws.send(JSON.stringify({ event: 'call-offer', data: { targetId: friendId, sdp: offer, type } }));
        }

        return () => { ws.removeEventListener('message', handleSignal); };
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

  const formatTime = (sec: number) =>
    `${Math.floor(sec / 60).toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
      <div className="relative flex flex-col items-center w-full h-full max-w-3xl mx-auto">
        {/* 大尺寸视频画面 */}
        <div className="relative w-full h-full flex items-center justify-center bg-gray-900">
          {type === 'video' ? (
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-white">
              <div className="text-8xl mb-4">🎤</div>
              <p className="text-2xl font-medium">{friendName}</p>
            </div>
          )}

          {/* 自己的小窗（视频通话时） */}
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

          {/* 通话时长或状态 */}
          <div className="absolute top-4 left-4 bg-black/50 text-white text-sm px-3 py-1 rounded-full">
            {callStatus === 'connected' ? formatTime(duration) : incoming ? '等待连接...' : '呼叫中...'}
          </div>
        </div>

        {/* 底部控制栏（绝对定位在底部） */}
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
              <>
                <button onClick={toggleCamera} className={`w-12 h-12 rounded-full flex items-center justify-center text-white ${isCameraOff ? 'bg-red-500' : 'bg-gray-600 hover:bg-gray-500'}`}>
                  {isCameraOff ? '📷❌' : '📷'}
                </button>
                <button onClick={switchCamera} className="w-12 h-12 rounded-full flex items-center justify-center text-white bg-gray-600 hover:bg-gray-500">
                  🔄
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
