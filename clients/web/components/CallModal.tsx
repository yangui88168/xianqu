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
  const [audioUnlocked, setAudioUnlocked] = useState(false); // 音频是否已解锁

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const durationRef = useRef<NodeJS.Timeout | null>(null);
  const isClosedRef = useRef(false);
  const remoteStreamBoundRef = useRef(false);
  const initDoneRef = useRef(false);

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

  // 解锁音频（需要用户点击触发）
  const unlockAudio = useCallback(() => {
    if (audioUnlocked) return;
    setAudioUnlocked(true);
    // 尝试播放远程音频
    if (remoteStreamRef.current && remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStreamRef.current;
      remoteAudioRef.current.play().catch(console.error);
    }
    // 视频取消静音（如果需要）
    if (type === 'video' && remoteVideoRef.current) {
      remoteVideoRef.current.muted = false;
      remoteVideoRef.current.play().catch(console.error);
    }
  }, [audioUnlocked, type]);

  const toggleMute = () => {
    unlockAudio(); // 点击控制按钮即可解锁
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !isMuted));
    setIsMuted(!isMuted);
  };
  const toggleCamera = () => {
    unlockAudio();
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = !isCameraOff));
    setIsCameraOff(!isCameraOff);
  };
  const toggleSpeaker = () => {
    unlockAudio();
    setIsSpeakerOn(!isSpeakerOn);
  };
  const switchCamera = useCallback(async () => {
    unlockAudio();
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
  }, [facingMode, unlockAudio]);

  // 绑定远程流
  const bindRemoteStream = useCallback((remoteStream: MediaStream) => {
    if (isClosedRef.current || remoteStreamBoundRef.current) return;
    remoteStreamBoundRef.current = true;
    remoteStreamRef.current = remoteStream;

    // 视频：静音自动播放（不调用 play，避免 AbortError）
    if (type === 'video' && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.muted = true;
      remoteVideoRef.current.play().catch(() => {}); // 静音播放不会被阻止
    }
    // 音频：先不自动播放，等用户解锁
    if (remoteAudioRef.current) {
      // 不设置 srcObject，等待解锁
    }

    setCallStatus('connected');
    if (!durationRef.current) {
      durationRef.current = setInterval(() => setDuration((prev) => prev + 1), 1000);
    }
  }, [type]);

  useEffect(() => {
    if (initDoneRef.current) return;
    initDoneRef.current = true;
    isClosedRef.current = false;
    remoteStreamBoundRef.current = false;
    setAudioUnlocked(false);

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
          if (remote && !remoteStreamBoundRef.current) bindRemoteStream(remote);
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
            pc.setRemoteDescription(new RTCSessionDescription(msg.data.sdp)).catch(console.error);
          } else if (msg.event === 'ice-candidate') {
            pc.addIceCandidate(new RTCIceCandidate(msg.data.candidate)).catch(console.error);
          } else if (msg.event === 'call-hangup') {
            hangup();
          } else if (msg.event === 'call-offer' && incoming) {
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
            await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(JSON.stringify({ event: 'call-answer', data: { targetId: friendId, sdp: answer } }));
          }
        } else {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
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
      initDoneRef.current = false;
    };
  }, []);

  const formatTime = (sec: number) =>
    `${Math.floor(sec / 60).toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black" onClick={unlockAudio}>
      <div className="relative flex flex-col items-center w-full h-full max-w-3xl mx-auto">
        {/* 隐藏的音频元素 */}
        <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

        <div className="relative w-full h-full flex items-center justify-center bg-gray-900">
          {type === 'video' ? (
            <video ref={remoteVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
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
          {/* 音频未解锁时提示 */}
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
