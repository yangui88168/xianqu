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
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const durationRef = useRef<NodeJS.Timeout | null>(null);

  // 停止所有轨道
  const stopTracks = useCallback(() => {
    localStream?.getTracks().forEach((t) => t.stop());
    remoteStream?.getTracks().forEach((t) => t.stop());
  }, [localStream, remoteStream]);

  // 挂断
  const hangup = useCallback(() => {
    setCallStatus('ended');
    stopTracks();
    pcRef.current?.close();
    if (durationRef.current) clearInterval(durationRef.current);
    ws.send(JSON.stringify({ event: 'call-hangup', data: { targetId: friendId } }));
    onHangup();
  }, [ws, friendId, onHangup, stopTracks]);

  // 切换摄像头
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
        if (sender) {
          sender.replaceTrack(videoTrack);
        }
        // 更新本地预览
        if (localVideoRef.current) localVideoRef.current.srcObject = newStream;
        // 更新本地流引用
        setLocalStream((prev) => {
          if (prev) prev.getTracks().forEach((t) => t.stop());
          return newStream;
        });
      } catch (e) {
        console.error('切换摄像头失败', e);
      }
    }
  }, [facingMode, localStream]);

  // 切换静音
  const toggleMute = () => {
    localStream?.getAudioTracks().forEach((t) => (t.enabled = isMuted));
    setIsMuted(!isMuted);
  };

  // 切换摄像头开关
  const toggleCamera = () => {
    localStream?.getVideoTracks().forEach((t) => (t.enabled = isCameraOff));
    setIsCameraOff(!isCameraOff);
  };

  // 切换扬声器
  const toggleSpeaker = () => {
    setIsSpeakerOn(!isSpeakerOn);
    // 扬声器切换需在音频元素上设置，或者使用 setSinkId（兼容性有限）
    // 简单实现：切换 audio 元素的 muted 属性？不，我们使用 audio 元素控制
  };

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
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        });
        pcRef.current = pc;

        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        pc.ontrack = (event) => {
          const [remote] = event.streams;
          setRemoteStream(remote);
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remote;
          setCallStatus('connected');
          // 开始计时
          durationRef.current = setInterval(() => setDuration((prev) => prev + 1), 1000);
        };

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            ws.send(
              JSON.stringify({
                event: 'ice-candidate',
                data: { targetId: friendId, candidate: event.candidate },
              })
            );
          }
        };

        ws.addEventListener('message', handleSignal);

        if (incoming && offerSdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          ws.send(
            JSON.stringify({
              event: 'call-answer',
              data: { targetId: friendId, sdp: answer },
            })
          );
        } else {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          ws.send(
            JSON.stringify({
              event: 'call-offer',
              data: { targetId: friendId, sdp: offer, type },
            })
          );
        }
      } catch (err) {
        console.error(err);
        alert('无法访问摄像头/麦克风，请检查权限');
        onHangup();
      }
    };

    init();

    return () => {
      ws.removeEventListener('message', handleSignal);
      stopTracks();
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="relative flex flex-col items-center w-full max-w-sm mx-auto">
        {/* 对方视频/头像 */}
        <div className="w-full aspect-video bg-gray-900 rounded-2xl overflow-hidden mb-4 relative">
          {remoteStream && type === 'video' ? (
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-white text-6xl">
              {type === 'video' ? '📷' : '🎤'}
            </div>
          )}
          {/* 自己的小窗（视频通话时） */}
          {type === 'video' && localStream && (
            <div className="absolute bottom-4 right-4 w-24 h-36 bg-gray-700 rounded-xl overflow-hidden border-2 border-white shadow-lg">
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover"
              />
            </div>
          )}
          {/* 通话时长 */}
          {callStatus === 'connected' && (
            <div className="absolute top-4 left-4 bg-black/50 text-white text-sm px-3 py-1 rounded-full">
              {formatTime(duration)}
            </div>
          )}
          {/* 状态提示 */}
          {callStatus === 'calling' && (
            <div className="absolute top-4 left-4 bg-black/50 text-white text-sm px-3 py-1 rounded-full">
              {incoming ? '邀请你进行通话...' : '呼叫中...'}
            </div>
          )}
        </div>

        {/* 对方昵称 */}
        <h3 className="text-white text-lg font-medium mb-6">{friendName}</h3>

        {/* 控制按钮 */}
        <div className="flex items-center gap-4 bg-gray-800/80 px-6 py-4 rounded-full">
          {/* 静音 */}
          <button
            onClick={toggleMute}
            className={`w-12 h-12 rounded-full flex items-center justify-center text-white text-xl ${
              isMuted ? 'bg-red-500' : 'bg-gray-600 hover:bg-gray-500'
            }`}
          >
            {isMuted ? '🔇' : '🎙️'}
          </button>

          {/* 挂断 */}
          <button
            onClick={hangup}
            className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center text-white text-2xl shadow-lg"
          >
            📞
          </button>

          {/* 扬声器 */}
          <button
            onClick={toggleSpeaker}
            className={`w-12 h-12 rounded-full flex items-center justify-center text-white text-xl ${
              isSpeakerOn ? 'bg-gray-600 hover:bg-gray-500' : 'bg-blue-500'
            }`}
          >
            {isSpeakerOn ? '🔊' : '🔈'}
          </button>

          {/* 视频通话时才显示摄像头开关和翻转 */}
          {type === 'video' && (
            <>
              <button
                onClick={toggleCamera}
                className={`w-12 h-12 rounded-full flex items-center justify-center text-white text-xl ${
                  isCameraOff ? 'bg-red-500' : 'bg-gray-600 hover:bg-gray-500'
                }`}
              >
                {isCameraOff ? '📷❌' : '📷'}
              </button>
              <button
                onClick={switchCamera}
                className="w-12 h-12 rounded-full flex items-center justify-center text-white text-xl bg-gray-600 hover:bg-gray-500"
              >
                🔄
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
