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

  // 挂断
  const hangup = useCallback(() => {
    setCallStatus('ended');
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    pcRef.current?.close();
    if (durationRef.current) clearInterval(durationRef.current);
    ws.send(JSON.stringify({ event: 'call-hangup', data: { targetId: friendId } }));
    onHangup();
  }, [ws, friendId, onHangup]);

  // 静音切换
  const toggleMute = () => {
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !isMuted));
    setIsMuted(!isMuted);
  };

  // 摄像头开关
  const toggleCamera = () => {
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = !isCameraOff));
    setIsCameraOff(!isCameraOff);
  };

  // 扬声器（仅图标提示，实际控制依赖系统）
  const toggleSpeaker = () => setIsSpeakerOn(!isSpeakerOn);

  // 切换前后摄像头（移动端）
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
    const init = async () => {
      try {
        // 1. 获取本地流
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: type === 'video' ? { facingMode: 'user' } : false,
        });
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;

        // 2. 创建对等连接，使用混合 TURN（公共+专属）
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

        // 3. 远程流处理（核心修复：先静音播放再取消静音）
        pc.ontrack = (event) => {
          console.log('✅ 收到远程流', event.streams[0]);
          const remoteStream = event.streams[0];

          if (type === 'video' && remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
            remoteVideoRef.current.muted = true;
            remoteVideoRef.current.play().then(() => {
              if (remoteVideoRef.current) remoteVideoRef.current.muted = false;
            }).catch(console.error);
          }

          if (type === 'audio' && remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = remoteStream;
            remoteAudioRef.current.muted = true;
            remoteAudioRef.current.play().then(() => {
              if (remoteAudioRef.current) remoteAudioRef.current.muted = false;
            }).catch(console.error);
          }

          setCallStatus('connected');
          if (!durationRef.current) {
            durationRef.current = setInterval(() => setDuration((prev) => prev + 1), 1000);
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

        // 4. 信令监听
        const handleSignal = (e: MessageEvent) => {
          const msg = JSON.parse(e.data);
          if (msg.event === 'call-answer' && msg.data.from === friendId) {
            pc.setRemoteDescription(new RTCSessionDescription(msg.data.sdp));
          } else if (msg.event === 'ice-candidate' && msg.data.from === friendId) {
            pc.addIceCandidate(new RTCIceCandidate(msg.data.candidate));
          } else if (msg.event === 'call-hangup' && msg.data.from === friendId) {
            hangup();
          }
        };
        ws.addEventListener('message', handleSignal);

        // 5. 建立信令
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

        return () => {
          ws.removeEventListener('message', handleSignal);
        };
      } catch (err) {
        console.error('通话初始化失败', err);
        alert('无法访问摄像头/麦克风，请检查权限');
        onHangup();
      }
    };

    init();

    return () => {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      pcRef.current?.close();
      if (durationRef.current) clearInterval(durationRef.current);
    };
  }, []);

  const formatTime = (sec: number) =>
    `${Math.floor(sec / 60).toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90">
      <div className="relative flex flex-col items-center w-full max-w-sm mx-auto h-full max-h-screen py-4">
        {/* 隐藏的音频播放器（音频通话时使用） */}
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
          {/* 自己的小窗（视频通话时） */}
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

        {/* 控制按钮 */}
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
