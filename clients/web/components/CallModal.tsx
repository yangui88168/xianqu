import { useEffect, useRef, useState, useCallback } from 'react';

interface CallModalProps {
  ws: WebSocket;
  userId: string;
  friendId: string;
  friendName: string;
  type: 'audio' | 'video';
  incoming?: boolean;
  offerSdp?: any;
  accepted?: boolean; // 主叫方是否已接听
  onHangup: () => void;
}

export default function CallModal({
  ws, userId, friendId, friendName, type, incoming, offerSdp, accepted, onHangup,
}: CallModalProps) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
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
  const durationRef = useRef<NodeJS.Timeout | null>(null);
  const interactionRef = useRef(false);

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

  // 尝试解锁音频
  const unlockAudio = useCallback(() => {
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = true;
      remoteAudioRef.current.play().then(() => {
        remoteAudioRef.current!.muted = false;
        interactionRef.current = true;
        if (remoteStream && remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remoteStream;
          remoteAudioRef.current.play().catch(() => setAudioBlocked(true));
        }
      }).catch(() => {});
    }
  }, [remoteStream]);

  const toggleMute = () => {
    localStream?.getAudioTracks().forEach((t) => (t.enabled = !isMuted));
    setIsMuted(!isMuted);
    unlockAudio();
  };

  const toggleCamera = () => {
    localStream?.getVideoTracks().forEach((t) => (t.enabled = !isCameraOff));
    setIsCameraOff(!isCameraOff);
    unlockAudio();
  };

  const toggleSpeaker = () => {
    setIsSpeakerOn(!isSpeakerOn);
    unlockAudio();
  };

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
      if (msg.data?.from !== friendId) return;
      if (msg.event === 'call-answer') {
        pcRef.current?.setRemoteDescription(new RTCSessionDescription(msg.data.sdp));
      } else if (msg.event === 'ice-candidate') {
        pcRef.current?.addIceCandidate(new RTCIceCandidate(msg.data.candidate));
      } else if (msg.event === 'call-hangup') {
        hangup();
      } else if (msg.event === 'call-offer' && incoming) {
        // 被叫方收到主叫方的 offer（含 SDP），设置远程描述并创建 answer
        pcRef.current?.setRemoteDescription(new RTCSessionDescription(msg.data.sdp))
          .then(() => pcRef.current!.createAnswer())
          .then(answer => {
            pcRef.current!.setLocalDescription(answer);
            ws.send(JSON.stringify({
              event: 'call-answer',
              data: { targetId: friendId, sdp: answer },
            }));
          })
          .catch(console.error);
      }
    },
    [friendId, hangup, incoming, ws]
  );

  // 初始化媒体流
  useEffect(() => {
    const initStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: type === 'video' ? { facingMode: 'user' } : false,
        });
        setLocalStream(stream);
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        return stream;
      } catch (err) {
        console.error(err);
        alert('无法访问摄像头/麦克风');
        onHangup();
      }
    };

    initStream().then(stream => {
      if (!stream) return;

      // 添加信令监听
      ws.addEventListener('message', handleSignal);

      // 根据角色决定何时创建 PeerConnection
      if (incoming) {
        // 被叫方：等待主叫方的 call-offer（在 handleSignal 中处理）
        // 仅创建空的 PeerConnection 以准备接收 offer
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
        stream.getTracks().forEach(track => pc.addTrack(track, stream));
        pc.ontrack = (event) => {
          const [remote] = event.streams;
          if (remote) {
            setRemoteStream(remote);
            if (remoteAudioRef.current) {
              remoteAudioRef.current.srcObject = remote;
              remoteAudioRef.current.play().catch(() => setAudioBlocked(true));
            }
            if (type === 'video' && remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = remote;
              remoteVideoRef.current.play().catch(console.error);
            }
            setCallStatus('connected');
            if (!durationRef.current) {
              durationRef.current = setInterval(() => setDuration(prev => prev + 1), 1000);
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
        // 被叫方不需要主动创建 offer，等待主叫方 offer
      } else {
        // 主叫方：如果已经收到 accepted 信号，立即创建 PeerConnection 和 offer
        if (accepted) {
          createPCAndOffer(stream);
        } else {
          // 否则保持等待，直到 accepted 变为 true（由外部状态变化触发）
        }
      }

      return () => {
        ws.removeEventListener('message', handleSignal);
        localStream?.getTracks().forEach((t) => t.stop());
        remoteStream?.getTracks().forEach((t) => t.stop());
        pcRef.current?.close();
        if (durationRef.current) clearInterval(durationRef.current);
      };
    });
  }, []);

  // 当 accepted 变为 true 时，主叫方开始创建连接
  useEffect(() => {
    if (!incoming && accepted && localStream && !pcRef.current) {
      createPCAndOffer(localStream);
    }
  }, [accepted, incoming, localStream]);

  const createPCAndOffer = (stream: MediaStream) => {
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
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    pc.ontrack = (event) => {
      const [remote] = event.streams;
      if (remote) {
        setRemoteStream(remote);
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remote;
          remoteAudioRef.current.play().catch(() => setAudioBlocked(true));
        }
        if (type === 'video' && remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remote;
          remoteVideoRef.current.play().catch(console.error);
        }
        setCallStatus('connected');
        if (!durationRef.current) {
          durationRef.current = setInterval(() => setDuration(prev => prev + 1), 1000);
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
    pc.createOffer().then(offer => {
      pc.setLocalDescription(offer);
      ws.send(JSON.stringify({
        event: 'call-offer',
        data: { targetId: friendId, sdp: offer, type },
      }));
    }).catch(console.error);
  };

  // ... 其余 UI 与之前完全相同 ...
}
