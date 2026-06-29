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
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const durationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);
  const pauseTimeRef = useRef<number | null>(null);
  const isClosedRef = useRef(false);
  const pendingCandidatesRef = useRef<RTCIceCandidate[]>([]);
  const audioUnlockedRef = useRef(false);
  const ignoreOfferRef = useRef(false);
  const politeRef = useRef(false);
  const iceRestartCountRef = useRef(0);
  const waitingForAnswerRef = useRef(false);
  const iceRestartTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const callTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const callStatusRef = useRef(callStatus);
  const isCleanedUp = useRef(false);
  const cameraChangeLock = useRef(false);
  const isSettingRemoteAnswerPendingRef = useRef(false);
  const makingOffer = useRef(false);
  const iceRestartingRef = useRef(false);
  const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const mediaCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastBytesReceivedRef = useRef<{ video: number; audio: number }>({ video: -1, audio: -1 });
  const lastPacketsReceivedRef = useRef<{ video: number; audio: number }>({ video: -1, audio: -1 });
  const lastFramesDecodedRef = useRef<number>(-1);
  const noDataCountRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => { callStatusRef.current = callStatus; }, [callStatus]);

  const removeWsListenersRef = useRef<() => void>(() => {});

  const safeSend = useCallback((data: any) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }, [ws]);

  // ---------- 清理 ----------
  const commonCleanup = useCallback(() => {
    if (isCleanedUp.current) return;
    isCleanedUp.current = true;

    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    remoteStreamRef.current?.getTracks().forEach((t) => t.stop());
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
    if (iceRestartTimeoutRef.current) clearTimeout(iceRestartTimeoutRef.current);
    if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
    if (mediaCheckIntervalRef.current) clearInterval(mediaCheckIntervalRef.current);
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    pendingCandidatesRef.current.length = 0;
    removeWsListenersRef.current();
  }, []);

  const hangup = useCallback(() => {
    if (isClosedRef.current) return;
    isClosedRef.current = true;
    setCallStatus('ended');
    commonCleanup();
    safeSend({ event: 'call-hangup', data: { targetId: friendId } });
    onHangup();
  }, [commonCleanup, safeSend, friendId, onHangup]);

  const hangupPassive = useCallback(() => {
    if (isClosedRef.current) return;
    isClosedRef.current = true;
    setCallStatus('ended');
    commonCleanup();
    onHangup();
  }, [commonCleanup, onHangup]);

  // ICE 重启（增加锁防止竞争）
  const restartIce = useCallback(async () => {
    const pc = pcRef.current;
    if (
      !pc ||
      isClosedRef.current ||
      iceRestartingRef.current ||
      waitingForAnswerRef.current ||
      iceRestartCountRef.current >= 3
    ) {
      if (iceRestartCountRef.current >= 3) hangup();
      return;
    }

    iceRestartingRef.current = true;
    iceRestartCountRef.current++;
    waitingForAnswerRef.current = true;
    pendingCandidatesRef.current.length = 0;

    if (iceRestartTimeoutRef.current) clearTimeout(iceRestartTimeoutRef.current);
    iceRestartTimeoutRef.current = setTimeout(() => {
      waitingForAnswerRef.current = false;
      iceRestartTimeoutRef.current = null;
    }, 15000);

    try {
      if (typeof (pc as any).restartIce === 'function') {
        (pc as any).restartIce();
      }
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      safeSend({ event: 'call-offer', data: { targetId: friendId, sdp: offer, type } });
    } catch (e) {
      console.error('ICE restart failed', e);
      hangup();
    } finally {
      iceRestartingRef.current = false;
    }
  }, [safeSend, friendId, type, hangup]);

  // 绑定远程媒体元素
  const bindRemoteMedia = useCallback((stream: MediaStream) => {
    if (isClosedRef.current) return;
    const tryPlay = (el: HTMLMediaElement) => {
      if (!el) return;
      el.srcObject = stream;
      el.onloadeddata = () => el.play().catch(() => {});
      el.oncanplay = () => el.play().catch(() => {});
      el.play().catch(() => {});
    };

    if (type === 'video' && remoteVideoRef.current) {
      tryPlay(remoteVideoRef.current);
    } else if (type === 'audio' && remoteAudioRef.current) {
      tryPlay(remoteAudioRef.current);
    }
  }, [type]);

  // ontrack：每种类型只保留一个 track，替换时 removeTrack 旧 track（不 stop）
  const handleRemoteTrack = useCallback((event: RTCTrackEvent) => {
    if (isClosedRef.current) return;

    if (!remoteStreamRef.current) {
      remoteStreamRef.current = new MediaStream();
    }
    const stream = remoteStreamRef.current;
    const track = event.track;

    // 移除同类型旧 track
    const oldTracks = stream.getTracks().filter(t => t.kind === track.kind);
    oldTracks.forEach(t => stream.removeTrack(t));

    stream.addTrack(track);

    track.onended = () => {
      stream.removeTrack(track);
      console.log('Remote track ended:', track.kind);
    };
    track.onmute = () => console.log('Remote track muted:', track.kind);
    track.onunmute = () => console.log('Remote track unmuted:', track.kind);

    bindRemoteMedia(stream);

    setCallStatus('connected');
    if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);

    if (!durationTimerRef.current) {
      startTimeRef.current = Date.now();
      durationTimerRef.current = setInterval(() => {
        if (!connectionPausedRef.current) {
          setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
        }
      }, 1000);
    }

    // 媒体接收质量检测（基于 bytes / packets / frames 变化量 + 远端 track 状态）
    if (!mediaCheckIntervalRef.current) {
      mediaCheckIntervalRef.current = setInterval(async () => {
        if (isClosedRef.current || !pcRef.current) return;
        try {
          const stats = await pcRef.current.getStats();
          let currentVideoBytes = -1, currentAudioBytes = -1;
          let currentVideoPackets = -1, currentAudioPackets = -1;
          let currentFramesDecoded = -1;
          for (const [, report] of stats) {
            if (report.type === 'inbound-rtp') {
              if (report.kind === 'video') {
                if (report.bytesReceived !== undefined) currentVideoBytes = report.bytesReceived;
                if (report.packetsReceived !== undefined) currentVideoPackets = report.packetsReceived;
                if (report.framesDecoded !== undefined) currentFramesDecoded = report.framesDecoded;
              }
              if (report.kind === 'audio') {
                if (report.bytesReceived !== undefined) currentAudioBytes = report.bytesReceived;
                if (report.packetsReceived !== undefined) currentAudioPackets = report.packetsReceived;
              }
            }
          }

          const last = lastBytesReceivedRef.current;
          const lastPackets = lastPacketsReceivedRef.current;
          const lastFrames = lastFramesDecodedRef.current;

          let videoStalled = false;
          let audioStalled = false;

          // 视频停滞判断：字节、包、帧全部未变化
          if (currentVideoBytes !== -1 && currentVideoPackets !== -1) {
            videoStalled =
              currentVideoBytes === last.video &&
              currentVideoPackets === lastPackets.video &&
              (currentFramesDecoded === -1 || currentFramesDecoded === lastFrames);
            last.video = currentVideoBytes;
            lastPackets.video = currentVideoPackets;
          }
          if (currentAudioBytes !== -1 && currentAudioPackets !== -1) {
            audioStalled =
              currentAudioBytes === last.audio &&
              currentAudioPackets === lastPackets.audio;
            last.audio = currentAudioBytes;
            lastPackets.audio = currentAudioPackets;
          }
          if (currentFramesDecoded !== -1) {
            lastFramesDecodedRef.current = currentFramesDecoded;
          }

          const remoteVideoTrack = remoteStreamRef.current?.getVideoTracks()[0];
          const videoShouldCheck = type === 'video' && !isCameraOff && remoteVideoTrack && !remoteVideoTrack.muted;
          const audioShouldCheck = type === 'audio' || (type === 'video' && !!remoteVideoTrack);

          const needRestart =
            (videoShouldCheck && videoStalled) ||
            (audioShouldCheck && audioStalled);

          if (needRestart) {
            noDataCountRef.current++;
            if (noDataCountRef.current >= 5) {
              restartIce();
              noDataCountRef.current = 0;
              // 重置基准
              lastBytesReceivedRef.current = { video: -1, audio: -1 };
              lastPacketsReceivedRef.current = { video: -1, audio: -1 };
              lastFramesDecodedRef.current = -1;
            }
          } else {
            noDataCountRef.current = 0;
          }
        } catch (e) {}
      }, 1000);
    }
  }, [bindRemoteMedia, restartIce, type, isCameraOff]);

  const connectionPausedRef = useRef(false);

  // 信令处理
  const handleSignal = useCallback(async (msg: any) => {
    if (isClosedRef.current) return;
    const pc = pcRef.current;
    if (!pc) return;

    try {
      if (msg.event === 'call-hangup') {
        hangupPassive();
        return;
      }

      const description = msg.data?.sdp;
      const candidate = msg.data?.candidate;

      if (description) {
        const isOffer = msg.event === 'call-offer';
        const isAnswer = msg.event === 'call-answer';

        if (isAnswer) {
          // 仅在 have-local-offer 时接受 answer
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(description));
            while (pendingCandidatesRef.current.length) {
              const cand = pendingCandidatesRef.current.shift()!;
              await pc.addIceCandidate(cand);
            }
            waitingForAnswerRef.current = false;
            iceRestartCountRef.current = 0;
            if (iceRestartTimeoutRef.current) {
              clearTimeout(iceRestartTimeoutRef.current);
              iceRestartTimeoutRef.current = null;
            }
            isSettingRemoteAnswerPendingRef.current = false;
          }
        } else if (isOffer) {
          const offerCollision = makingOffer.current || pc.signalingState !== 'stable';
          ignoreOfferRef.current = !politeRef.current && offerCollision;
          if (ignoreOfferRef.current) return;

          if (offerCollision && politeRef.current && pc.signalingState === 'have-local-offer') {
            await pc.setLocalDescription({ type: 'rollback' });
          }

          isSettingRemoteAnswerPendingRef.current = true;
          await pc.setRemoteDescription(new RTCSessionDescription(description));
          while (pendingCandidatesRef.current.length) {
            const cand = pendingCandidatesRef.current.shift()!;
            await pc.addIceCandidate(cand);
          }

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          safeSend({ event: 'call-answer', data: { targetId: friendId, sdp: answer } });
          isSettingRemoteAnswerPendingRef.current = false;
        }
      } else if (candidate) {
        const iceCandidate = new RTCIceCandidate(candidate);
        if (pc.remoteDescription) {
          await pc.addIceCandidate(iceCandidate);
        } else {
          pendingCandidatesRef.current.push(iceCandidate);
        }
      }
    } catch (err) {
      console.error('信令处理错误', err);
    }
  }, [safeSend, friendId, hangupPassive]);

  const unlockAudio = useCallback(() => {
    if (audioUnlockedRef.current) return;
    audioUnlockedRef.current = true;
    setAudioUnlocked(true);

    const tryPlay = () => {
      if (!audioContextRef.current) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) audioContextRef.current = new AudioCtx();
      }
      audioContextRef.current?.resume().catch(() => {});
      remoteVideoRef.current?.play().catch(() => {});
      remoteAudioRef.current?.play().catch(() => {});
    };

    tryPlay();
    const events = ['pointerdown', 'touchstart', 'keydown'];
    const unlockHandler = () => {
      tryPlay();
      events.forEach(e => document.removeEventListener(e, unlockHandler));
    };
    events.forEach(e => document.addEventListener(e, unlockHandler, { once: true }));
  }, []);

  const toggleMute = useCallback(() => {
    unlockAudio();
    setIsMuted(prev => {
      const newMuted = !prev;
      localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !newMuted));
      return newMuted;
    });
  }, [unlockAudio]);

  const toggleCamera = useCallback(() => {
    unlockAudio();
    if (cameraChangeLock.current) return;
    cameraChangeLock.current = true;

    setIsCameraOff(prev => {
      const newOff = !prev;
      const videoTrack = localStreamRef.current?.getVideoTracks()[0];
      const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video');

      if (videoTrack && sender) {
        if (newOff) {
          videoTrack.enabled = false;
          cameraChangeLock.current = false;
        } else {
          navigator.mediaDevices.getUserMedia({ video: true })
            .then(async newStream => {
              if (isClosedRef.current) {
                newStream.getTracks().forEach(t => t.stop());
                return;
              }
              const newTrack = newStream.getVideoTracks()[0];
              if (!newTrack) return;

              newTrack.enabled = true;
              newTrack.onended = () => {
                console.log('本地摄像头被系统停止');
              };

              // replaceTrack 带错误恢复
              try {
                await sender.replaceTrack(newTrack);
              } catch (replaceErr) {
                console.error('replaceTrack failed, restoring old track', replaceErr);
                // 恢复旧 track 状态
                if (videoTrack) {
                  videoTrack.enabled = true;
                  await sender.replaceTrack(videoTrack).catch(() => {});
                }
                cameraChangeLock.current = false;
                return;
              }

              const params = sender.getParameters();
              if (!params.encodings) params.encodings = [{}];
              params.encodings[0].maxBitrate = 1200000;
              params.encodings[0].maxFramerate = 30;
              sender.setParameters(params).catch(() => {});

              if (localVideoRef.current) localVideoRef.current.srcObject = newStream;
              if (localStreamRef.current) {
                const oldVideoTrack = localStreamRef.current.getVideoTracks()[0];
                if (oldVideoTrack) {
                  localStreamRef.current.removeTrack(oldVideoTrack);
                  oldVideoTrack.stop();
                }
                localStreamRef.current.addTrack(newTrack);
              }
            })
            .catch(err => console.error('打开摄像头失败', err))
            .finally(() => { cameraChangeLock.current = false; });
        }
      } else {
        cameraChangeLock.current = false;
      }
      return newOff;
    });
  }, [unlockAudio]);

  const toggleSpeaker = useCallback(() => {
    unlockAudio();
    setIsSpeakerOn(prev => !prev);
  }, [unlockAudio]);

  // 页面生命周期
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (pauseTimeRef.current !== null && !isClosedRef.current) {
          const pausedDuration = Date.now() - pauseTimeRef.current;
          startTimeRef.current += pausedDuration;
          pauseTimeRef.current = null;
        }
        connectionPausedRef.current = false;
      } else {
        if (callStatusRef.current === 'connected') {
          pauseTimeRef.current = Date.now();
        }
        connectionPausedRef.current = true;
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // 主初始化
  useEffect(() => {
    let cancelled = false;
    isClosedRef.current = false;
    isCleanedUp.current = false;
    pendingCandidatesRef.current.length = 0;
    audioUnlockedRef.current = false;
    ignoreOfferRef.current = false;
    iceRestartCountRef.current = 0;
    waitingForAnswerRef.current = false;
    isSettingRemoteAnswerPendingRef.current = false;
    remoteStreamRef.current = null;
    connectionPausedRef.current = false;
    cameraChangeLock.current = false;
    pauseTimeRef.current = null;
    makingOffer.current = false;
    iceRestartingRef.current = false;
    lastBytesReceivedRef.current = { video: -1, audio: -1 };
    lastPacketsReceivedRef.current = { video: -1, audio: -1 };
    lastFramesDecodedRef.current = -1;
    noDataCountRef.current = 0;
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    politeRef.current = !!incoming;

    callTimeoutRef.current = setTimeout(() => {
      if (!cancelled && callStatusRef.current === 'calling') {
        hangup();
      }
    }, 30000);

    const init = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: type === 'video' ? {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 },
          } : false,
        });
        if (cancelled || isClosedRef.current) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          localVideoRef.current.play().catch(() => {});
        }

        const pc = new RTCPeerConnection({
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:global.relay.metered.ca:443', username: '680a360a85d7aad8037a5be4', credential: 'Uz8+sEjedvuGre/9' },
          ],
          iceTransportPolicy: 'all',
          bundlePolicy: 'max-bundle',
          rtcpMuxPolicy: 'require',
          iceCandidatePoolSize: 10,
        });
        pcRef.current = pc;

        stream.getTracks().forEach(track => pc.addTrack(track, stream));

        if (type === 'video') {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender) {
            const params = sender.getParameters();
            if (!params.encodings) params.encodings = [{}];
            params.encodings[0].maxBitrate = 1200000;
            params.encodings[0].maxFramerate = 30;
            sender.setParameters(params).catch(() => {});
          }
        }

        pc.onnegotiationneeded = async () => {
          if (isClosedRef.current || makingOffer.current || pc.signalingState !== 'stable') return;
          try {
            makingOffer.current = true;
            const offer = await pc.createOffer();
            if (pc.signalingState !== 'stable') return;
            await pc.setLocalDescription(offer);
            safeSend({ event: 'call-offer', data: { targetId: friendId, sdp: offer, type } });
          } catch (e) {
            console.error('negotiationneeded error', e);
          } finally {
            makingOffer.current = false;
          }
        };

        pc.ontrack = handleRemoteTrack;

        pc.onicecandidate = (event) => {
          if (isClosedRef.current) return;
          if (event.candidate) {
            console.log('ICE candidate:', event.candidate.type, event.candidate.candidate);
            safeSend({ event: 'ice-candidate', data: { targetId: friendId, candidate: event.candidate } });
          }
        };

        pc.onconnectionstatechange = () => {
          if (isClosedRef.current) return;
          console.log('connectionState:', pc.connectionState);
          if (pc.connectionState === 'failed') {
            restartIce();
          } else if (pc.connectionState === 'closed') {
            hangupPassive();
          }
        };

        pc.oniceconnectionstatechange = () => {
          if (isClosedRef.current) return;
          console.log('iceConnectionState:', pc.iceConnectionState);
          if (pc.iceConnectionState === 'failed') {
            restartIce();
          } else if (pc.iceConnectionState === 'disconnected') {
            setTimeout(() => {
              if (pc.iceConnectionState === 'disconnected') hangup();
            }, 10000);
          }
        };

        const onWsMessage = (e: MessageEvent) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.data?.from !== friendId) return;
            handleSignal(msg);
          } catch {}
        };
        const onWsClose = () => setTimeout(() => { if (!isClosedRef.current) hangup(); }, 5000);

        ws.addEventListener('message', onWsMessage);
        ws.addEventListener('close', onWsClose);
        removeWsListenersRef.current = () => {
          ws.removeEventListener('message', onWsMessage);
          ws.removeEventListener('close', onWsClose);
        };

        if (incoming) {
          if (offerSdp && pc.signalingState === 'stable' && !pc.remoteDescription) {
            await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
            while (pendingCandidatesRef.current.length) {
              const cand = pendingCandidatesRef.current.shift()!;
              await pc.addIceCandidate(cand);
            }
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            safeSend({ event: 'call-answer', data: { targetId: friendId, sdp: answer } });
          }
        } else {
          makingOffer.current = true;
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          safeSend({ event: 'call-offer', data: { targetId: friendId, sdp: offer, type } });
          makingOffer.current = false;
        }
      } catch (err) {
        console.error(err);
        alert('无法访问摄像头/麦克风');
        onHangup();
      }
    };

    init().catch(console.error);

    return () => {
      cancelled = true;
      isClosedRef.current = true;
      commonCleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatTime = (sec: number) =>
    `${Math.floor(sec / 60).toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black" onClick={unlockAudio}>
      <div className="relative flex flex-col items-center w-full h-full max-w-3xl mx-auto">
        {type === 'audio' && (
          <audio
            ref={remoteAudioRef}
            autoPlay
            playsInline
            muted={!isSpeakerOn}
            className="hidden"
          />
        )}
        <div className="relative w-full h-full flex items-center justify-center bg-gray-900">
          {type === 'video' ? (
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              muted={!isSpeakerOn}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-white">
              <div className="text-8xl mb-4">🎤</div>
              <p className="text-2xl font-medium">{friendName}</p>
            </div>
          )}
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
          <div className="absolute top-4 left-4 bg-black/50 text-white text-sm px-3 py-1 rounded-full">
            {callStatus === 'connected' ? formatTime(duration) : incoming ? '等待接听...' : '呼叫中...'}
          </div>
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
              <button onClick={toggleCamera} className={`w-12 h-12 rounded-full flex items-center justify-center text-white ${isCameraOff ? 'bg-red-500' : 'bg-gray-600 hover:bg-gray-500'}`}>
                {isCameraOff ? '📷❌' : '📷'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
