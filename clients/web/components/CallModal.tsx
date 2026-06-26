import { useEffect, useRef, useState } from 'react';

interface CallModalProps {
  ws: WebSocket;
  userId: string;
  friendId: string;
  friendName: string;
  type: 'audio' | 'video';
  incoming?: boolean;        // 是否为被叫方
  offerSdp?: any;            // 被叫方收到的 offer SDP
  onHangup: () => void;
}

export default function CallModal({ ws, userId, friendId, friendName, type, incoming, offerSdp, onHangup }: CallModalProps) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [callStatus, setCallStatus] = useState<'calling' | 'connected' | 'ended'>('calling');
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  useEffect(() => {
    const initCall = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: type === 'video',
        });
        setLocalStream(stream);
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;

        const pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        });
        pcRef.current = pc;

        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        pc.ontrack = (event) => {
          setRemoteStream(event.streams[0]);
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0];
          setCallStatus('connected');
        };

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            ws.send(JSON.stringify({
              event: 'ice-candidate',
              data: { targetId: friendId, candidate: event.candidate },
            }));
          }
        };

        // 信令监听
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

        if (incoming && offerSdp) {
          // 被叫方：设置远程 offer，创建 answer
          await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          ws.send(JSON.stringify({
            event: 'call-answer',
            data: { targetId: friendId, sdp: answer },
          }));
        } else {
          // 主叫方：创建 offer
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
        console.error('无法获取媒体设备', err);
        alert('无法访问摄像头/麦克风，请检查权限');
        onHangup();
      }
    };

    initCall();
  }, []);

  const hangup = () => {
    setCallStatus('ended');
    localStream?.getTracks().forEach((track) => track.stop());
    pcRef.current?.close();
    ws.send(JSON.stringify({ event: 'call-hangup', data: { targetId: friendId } }));
    onHangup();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
      <div className="bg-gray-900 p-6 rounded-xl w-96 text-center shadow-2xl">
        <h3 className="text-white text-lg font-bold mb-2">
          与 {friendName} {type === 'video' ? '视频通话' : '语音通话'}
        </h3>
        <div className="text-gray-400 text-sm mb-4">
          {callStatus === 'calling' && '呼叫中...'}
          {callStatus === 'connected' && '通话中'}
          {callStatus === 'ended' && '已挂断'}
        </div>

        <div className="flex justify-center gap-4 mb-6">
          {type === 'video' && localStream && (
            <video ref={localVideoRef} autoPlay muted playsInline
              className="w-24 h-24 bg-black rounded-lg object-cover border-2 border-blue-500" />
          )}
          {remoteStream && (
            <video ref={remoteVideoRef} autoPlay playsInline
              className="w-24 h-24 bg-black rounded-lg object-cover border-2 border-green-500" />
          )}
          {!remoteStream && type === 'audio' && (
            <div className="w-24 h-24 bg-gray-800 rounded-full flex items-center justify-center">
              <span className="text-4xl">🎤</span>
            </div>
          )}
        </div>

        <button
          onClick={hangup}
          className="bg-red-600 hover:bg-red-700 text-white px-8 py-3 rounded-full font-bold transition"
        >
          挂断
        </button>
      </div>
    </div>
  );
}
