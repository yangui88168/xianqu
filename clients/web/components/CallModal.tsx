import { useEffect, useRef, useState } from 'react';

interface CallModalProps {
  ws: WebSocket;
  userId: string;
  friendId: string;
  friendName: string;
  type: 'audio' | 'video';
  onHangup: () => void;
}

export default function CallModal({ ws, userId, friendId, friendName, type, onHangup }: CallModalProps) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  useEffect(() => {
    const init = async () => {
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

      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      pc.ontrack = (event) => {
        setRemoteStream(event.streams[0]);
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0];
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          ws.send(JSON.stringify({
            event: 'ice-candidate',
            data: { targetId: friendId, candidate: event.candidate },
          }));
        }
      };

      // 创建 offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      ws.send(JSON.stringify({
        event: 'call-offer',
        data: { targetId: friendId, sdp: offer },
      }));
    };

    init();

    // 信令处理
    const handleSignal = (e: MessageEvent) => {
      const msg = JSON.parse(e.data);
      if (msg.event === 'call-answer') {
        pcRef.current?.setRemoteDescription(new RTCSessionDescription(msg.data.sdp));
      } else if (msg.event === 'ice-candidate') {
        pcRef.current?.addIceCandidate(new RTCIceCandidate(msg.data.candidate));
      } else if (msg.event === 'call-hangup') {
        hangup();
      }
    };

    ws.addEventListener('message', handleSignal);
    return () => {
      ws.removeEventListener('message', handleSignal);
      hangup();
    };
  }, []);

  const hangup = () => {
    localStream?.getTracks().forEach(track => track.stop());
    pcRef.current?.close();
    ws.send(JSON.stringify({ event: 'call-hangup', data: { targetId: friendId } }));
    onHangup();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
      <div className="bg-white p-4 rounded-lg w-80 text-center">
        <h3 className="font-bold mb-2">与 {friendName} {type === 'video' ? '视频' : '语音'}通话</h3>
        <div className="flex gap-4 justify-center mb-4">
          {type === 'video' && (
            <video ref={localVideoRef} autoPlay muted className="w-24 h-24 bg-gray-200 rounded" />
          )}
          <video ref={remoteVideoRef} autoPlay className="w-24 h-24 bg-gray-200 rounded" />
        </div>
        <button onClick={hangup} className="bg-red-500 text-white px-6 py-2 rounded-full">挂断</button>
      </div>
    </div>
  );
}
