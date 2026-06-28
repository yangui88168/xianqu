// ==================== 1. 消息提示音核心模块 ====================
const MessageSound = {
    audioCtx: null,

    // 初始化音频上下文（延迟到用户第一次点击页面时激活，绕过浏览器限制）
    init() {
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        // 如果处于挂起状态（浏览器安全策略限制），尝试激活
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
    },

    // 播放“叮”声函数
    play() {
        try {
            // 每次播放时先尝试初始化/激活上下文
            this.init();
            
            const ctx = this.audioCtx;
            const now = ctx.currentTime;

            // 创建音频节点
            const oscillator = ctx.createOscillator();
            const gainNode = ctx.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(ctx.destination);

            // 音色设置：正弦波
            oscillator.type = 'sine';

            // 音调设计：从 600Hz 快速升到 900Hz，打造标准的清脆社交提示音
            oscillator.frequency.setValueAtTime(600, now);
            oscillator.frequency.exponentialRampToValueAtTime(900, now + 0.08);

            // 音量控制：从 0.4 音量在 0.25 秒内淡出，避免刺耳
            gainNode.gain.setValueAtTime(0.4, now);
            gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

            // 启动并销毁单次振荡器
            oscillator.start(now);
            oscillator.stop(now + 0.25);
        } catch (e) {
            console.warn("提示音播放失败（可能用户尚未与页面发生任何交互）:", e);
        }
    }
};

// ==================== 2. 全局交互激活监听 ====================
// 现代浏览器要求用户必须点击过页面才能发声
// 这里监听用户的首次点击或按键，静默激活音频上下文
const activateAudio = () => {
    MessageSound.init();
    ['click', 'keydown', 'touchstart'].forEach(evt => document.removeEventListener(evt, activateAudio));
};
['click', 'keydown', 'touchstart'].forEach(evt => document.addEventListener(evt, activateAudio));
