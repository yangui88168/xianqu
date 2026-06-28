let MessageSound: any = {
  audioCtx: null as AudioContext | null,
  init() {
    if (typeof window === 'undefined') return;
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  },
  play() {
    if (typeof window === 'undefined') return;
    this.init();
    if (!this.audioCtx) return;
    try {
      const ctx = this.audioCtx;
      const now = ctx.currentTime;
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(600, now);
      oscillator.frequency.exponentialRampToValueAtTime(900, now + 0.08);
      gainNode.gain.setValueAtTime(0.4, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      oscillator.start(now);
      oscillator.stop(now + 0.25);
    } catch (e) {
      console.warn('提示音播放失败', e);
    }
  }
};

// ✅ 将事件监听器包裹在客户端函数中，不在模块顶层执行
if (typeof window !== 'undefined') {
  const activateAudio = () => {
    MessageSound.init();
    ['click', 'keydown', 'touchstart'].forEach(evt => document.removeEventListener(evt, activateAudio));
  };
  ['click', 'keydown', 'touchstart'].forEach(evt => document.addEventListener(evt, activateAudio));
}

export { MessageSound };
