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
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
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
  const durationRef = useRef<NodeJS.Timeout | null>(null);

  // 挂断
  const hangup = useCallback(() => {
    setCallStatus('ended');
    localStream?.getTracks().forEach((t) => t.stop());
    remoteStream?.getTracks().forEach((t) => t.stop());
    pcRef.current?.close();
    if (durationRef.current) clearInterval(durationRef.current);
    ws.send(JSON.stringify({ event: 'call-hangup', data: { targetId: friendId } }));
    onHangup();
  }, [ws, friendId, localStream, remoteStream, onHangup]);

  const toggleMute = () => {
    localStream?.getAudioTracks().forEach((t) => (t.enabled = !isMuted));
    setIsMuted(!isMuted);
  };

  const toggleCamera = () => {
    localStream?.getVideoTracks().forEach((t) => (t.enabled = !isCameraOff));
    setIsCameraOff(!isCameraOff);
  };

  const toggleSpeaker = () => setIsSpeakerOn(!isSpeakerOn);

  const switchCamera = useCallback(async () => {
    const newMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(newMode);
    if (localStream) {
      localStream.getVideoTracks().forEach((t) => t.stop());
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: newMode },
          audio: true,
        });
        const videoTrack = newStream.getVideoTracks()[0];
        const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(videoTrack);
        if (localVideoRef.current) localVideoRef.current.srcObject = newStream;
        setLocalStream((prev) => {
          prev?.getTracks().forEach((t) => t.stop());
          return newStream;
        });
      } catch (e) { console.error(e); }
    }
  }, [facingMode, localStream]);

  // 信令处理
  const handleSignal = useCallback(
    (e: MessageEvent) => {
      const msg = JSON.parse(e.data);
      if (msg.event === 'call-answer' && msg.data.from === friendId) {
        pcRef.current?.setRemoteDescription(new RTCSessionDescription(msg.data.sdp));
      } else if (msg.event === 'ice-candidate' && msg.data.from === friendId) {
        pcRef.current?.addIceCandidate(new RTCIceCandidate(msg.data.candidate));
      } else if (msg.event === 'call-hangup' && msg.data.from === friendId) {
        hangup();
      }
    },
    [friendId, hangup]
  );

  useEffect(() => {
    const init = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: type === 'video' ? { facingMode: 'user' } : false,
        });
        setLocalStream(stream);
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;

        const pc = new RTCPeerConnection({
          iceServers: [
            // Google 免费 STUN（帮助尝试 P2P 直连）
            { urls: 'stun:stun.l.google.com:19302' },
            // Metered 公共免费 TURN（50 GB/月）
            {
              urls: 'turn:openrelay.metered.ca:443',
              username: 'openrelayproject',
              credential: 'openrelayproject',
            },
            // 你专属的 Metered TURN（500 MB/月，更稳定）
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
          if (remote) {
            setRemoteStream(remote);
            // 视频模式下绑定到 video 元素
            if (type === 'video' && remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = remote;
              remoteVideoRef.current.play().catch(console.error);
            }
            // 音频模式：绑定到隐藏的 audio 元素
            if (type === 'audio' && remoteAudioRef.current) {
              remoteAudioRef.current.srcObject = remote;
              remoteAudioRef.current.play().catch(console.error);
            }
            setCallStatus('connected');
            if (!durationRef.current) {
              durationRef.current = setInterval(() => setDuration((prev) => prev + 1), 1000);
            }
          }
        };

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            ws.send(JSON.stringify({
              event: 'ice-candidate',
              data: { targetId: friendId, candidate: event.candidate },
            }));
          }
        };

        ws.addEventListener('message', handleSignal);

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
      } catch (err) {
        console.error(err);
        alert('无法访问摄像头/麦克风');
        onHangup();
      }
    };

    init();

    return () => {
      ws.removeEventListener('message', handleSignal);
      localStream?.getTracks().forEach((t) => t.stop());
      remoteStream?.getTracks().forEach((t) => t.stop());
      pcRef.current?.close();
      if (durationRef.current) clearInterval(durationRef.current);
    };
  }, []);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90">
      <div className="relative flex flex-col items-center w-full max-w-sm mx-auto h-full max-h-screen py-4">
        {/* 隐藏的音频播放器（用于音频通话） */}
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
          {type === 'video' && localStream && (
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
          <button onClick={toggleMute} className={`w-10 h-10 rounded-full flex items-center justify-center text-white ${isMuted ? 'bg-red-500' : 'bg-gray-600'}`}>
            {isMuted ? '🔇' : '🎙️'}
          </button>
          <button onClick={hangup} className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center text-white text-2xl">
            📞
          </button>
          <button onClick={toggleSpeaker} className={`w-10 h-10 rounded-full flex items-center justify-center text-white ${isSpeakerOn ? 'bg-gray-600' : 'bg-blue-500'}`}>
            {isSpeakerOn ? '🔊' : '🔈'}
          </button>
          {type === 'video' && (
            <>
              <button onClick={toggleCamera} className={`w-10 h-10 rounded-full flex items-center justify-center text-white ${isCameraOff ? 'bg-red-500' : 'bg-gray-600'}`}>
                {isCameraOff ? '📷❌' : '📷'}
              </button>
              <button onClick={switchCamera} className="w-10 h-10 rounded-full flex items-center justify-center text-white bg-gray-600">
                🔄
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
