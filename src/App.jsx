import React, { useState, useRef, useEffect } from 'react';
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

// --- 样式定义 ---
const containerStyle = { maxWidth: '900px', margin: '0 auto', padding: '20px', fontFamily: '"Segoe UI", Roboto, Helvetica, Arial, sans-serif', color: '#333' };
const buttonStyle = { padding: '12px 24px', margin: '0 10px 10px 0', background: '#222', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: '600', cursor: 'pointer', transition: 'all 0.2s', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
const inputStyle = { padding: '10px', borderRadius: '8px', border: '1px solid #ddd', width: '100%', boxSizing: 'border-box', fontSize: '15px', background: '#f8f9fa' };
const cardStyle = { background: 'white', padding: '25px', borderRadius: '16px', boxShadow: '0 8px 30px rgba(0,0,0,0.08)', marginBottom: '20px' };
const statusStyle = { fontSize: '14px', padding: '8px 12px', borderRadius: '6px', background: '#e9ecef', color: '#495057', display: 'inline-block', marginBottom: '10px' };

// 预设一些好玩的 Emoji
const PRESET_EMOJIS = ['🐯', '🦁', '😎', '👽', '🤡', '🤖', '💩'];

function App() {
  // === 状态管理 ===
  const [poseLandmarker, setPoseLandmarker] = useState(null);
  const [videoSrc, setVideoSrc] = useState(null);
  
  // UI 选项
  const [maskMode, setMaskMode] = useState('emoji'); 
  const [maskSrc, setMaskSrc] = useState(null); 
  const [emojiChar, setEmojiChar] = useState('🐯');
  const [modelType, setModelType] = useState('Heavy'); 
  const [trackingMode, setTrackingMode] = useState('multi'); // 'single' 或 'multi'

  // 状态显示
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState("等待初始化...");
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [progress, setProgress] = useState(0);

  // === Refs ===
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const maskImgRef = useRef(null);
  const chunksRef = useRef([]);
  const rafIdRef = useRef(null);
  const hiddenFileInputRef = useRef(null); // 用于隐藏的上传按钮
  
  // === 🔥 核心：多人追踪状态池 ===
  // 我们不再只存一个 tracker，而是存一堆
  // 结构: [ { id: 1, x: 0, y: 0, scale: 0, lostFrames: 0, color: '...' }, ... ]
  const trackersRef = useRef([]);
  // 用于生成唯一 ID
  const nextTrackerId = useRef(1);

  const settingsRef = useRef({ maskMode, emojiChar, trackingMode });

  // 1. 初始化 AI
  useEffect(() => {
    // 默认加载 Heavy 模型，且开启多人检测 (numPoses: 5)
    // 即使是单人模式，我们也可以检测多人然后只画最大的那个，这样切换模式不需要重载模型
    loadModel('Heavy'); 
  }, []);

  // 同步设置
  useEffect(() => {
    settingsRef.current = { maskMode, emojiChar, trackingMode };
  }, [maskMode, emojiChar, trackingMode]);

  const loadModel = async (quality) => {
    setPoseLandmarker(null);
    setStatus(`正在下载 ${quality} 模型 (多人版)...`);
    
    try {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
      );
      
      const modelPaths = {
        'Lite': 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
        'Full': 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
        'Heavy': 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task'
      };

      const landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: modelPaths[quality],
          delegate: "GPU"
        },
        runningMode: "VIDEO",
        // 关键点：开启多人检测，最多检测 5 人
        numPoses: 5, 
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      setPoseLandmarker(landmarker);
      setModelType(quality);
      setStatus(`✅ ${quality} 模型就绪！请导入视频`);
    } catch (err) {
      setStatus(`❌ 模型加载失败: ${err.message}`);
      console.error(err);
    }
  };

  const handleVideoUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (videoSrc) URL.revokeObjectURL(videoSrc);
      const url = URL.createObjectURL(file);
      setVideoSrc(url);
      setDownloadUrl(null);
      setProgress(0);
      setStatus("视频已加载");
    }
  };

  const handleMaskUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      img.onload = () => { maskImgRef.current = img; };
      setMaskSrc(img.src);
      // 上传后自动切换到图片模式
      setMaskMode('image');
    }
  };

  const startProcessing = async () => {
    if (!poseLandmarker || !videoRef.current) return;
    
    const video = videoRef.current;
    setIsProcessing(true);
    setStatus("🚀 多人追踪运算中...");
    setDownloadUrl(null);
    chunksRef.current = [];
    setProgress(0);

    // 重置所有追踪器
    trackersRef.current = [];
    nextTrackerId.current = 1;

    if (video.readyState < 2) await new Promise(r => video.onloadeddata = r);

    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');

    const stream = canvas.captureStream(30);
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const source = audioCtx.createMediaElementSource(video);
        const dest = audioCtx.createMediaStreamDestination();
        source.connect(dest);
        const audioTrack = dest.stream.getAudioTracks()[0];
        if (audioTrack) stream.addTrack(audioTrack);
    } catch(e) { console.warn("音频轨道合并失败:", e) }

    let mimeType = 'video/webm';
    if (MediaRecorder.isTypeSupported('video/mp4; codecs="avc1.42E01E, mp4a.40.2"')) {
        mimeType = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
    } else if (MediaRecorder.isTypeSupported('video/mp4')) {
        mimeType = 'video/mp4';
    }

    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8000000 });

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      setDownloadUrl(URL.createObjectURL(blob));
      setIsProcessing(false);
      setStatus("✅ 处理完成！");
      video.muted = false;
    };

    recorder.start();

    video.currentTime = 0;
    video.muted = true;
    await video.play();

    const totalDuration = video.duration;
    
    const processLoop = () => {
      if (video.paused || video.ended) {
        recorder.stop();
        return;
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const startTimeMs = performance.now();
      let allLandmarks = [];
      try {
        const result = poseLandmarker.detectForVideo(video, startTimeMs);
        if (result.landmarks) {
            allLandmarks = result.landmarks;
        }
      } catch(e) { console.error(e); }

      // 调用多人处理逻辑
      processMultiPersonAlgorithm(ctx, allLandmarks, canvas.width, canvas.height);

      if (totalDuration > 0) {
        setProgress(Math.round((video.currentTime / totalDuration) * 100));
      }

      rafIdRef.current = requestAnimationFrame(processLoop);
    };

    processLoop();
  };

  // === 🔥 核心算法：多人逻辑 ===
  const processMultiPersonAlgorithm = (ctx, allLandmarks, width, height) => {
    const activeTrackers = trackersRef.current;
    const { trackingMode } = settingsRef.current;

    // 1. 预处理：将所有检测到的骨架转换为“目标数据” (Target Data)
    // 也就是算出每一具骨架此时此刻的头在哪里
    const detectedTargets = allLandmarks.map(landmarks => {
        // ... (这里复用之前的 Heavy 逻辑算出单人的 x, y, scale)
        const nose = landmarks[0];
        const leftEar = landmarks[7];
        const rightEar = landmarks[8];
        const leftShoulder = landmarks[11];
        const rightShoulder = landmarks[12];

        const faceConf = Math.max(nose.visibility, leftEar.visibility, rightEar.visibility);
        const shoulderConf = Math.min(leftShoulder.visibility, rightShoulder.visibility);
        const shoulderDist = Math.hypot((leftShoulder.x - rightShoulder.x) * width, (leftShoulder.y - rightShoulder.y) * height);

        let tx = 0, ty = 0, tscale = 0, valid = false;
        const SCALE_FACTOR = 1.1;

        if (faceConf > 0.6) {
            if (nose.visibility > 0.6) { tx = nose.x * width; ty = nose.y * height; }
            else { tx = (leftEar.x + rightEar.x) / 2 * width; ty = (leftEar.y + rightEar.y) / 2 * height; }
            tscale = shoulderDist * SCALE_FACTOR;
            valid = true;
        } else if (shoulderConf > 0.5) {
            const sx = (leftShoulder.x + rightShoulder.x) / 2 * width;
            const sy = (leftShoulder.y + rightShoulder.y) / 2 * height;
            tx = sx; ty = sy - (shoulderDist * 0.5);
            tscale = shoulderDist * SCALE_FACTOR;
            valid = true;
        }
        
        // 如果这具骨架太小或无效，标记为 invalid
        if (shoulderDist < 10) valid = false;

        return { x: tx, y: ty, scale: tscale, valid, matched: false };
    }).filter(t => t.valid);

    // 如果是单人模式，只保留最大的一个目标
    let targetsToProcess = detectedTargets;
    if (trackingMode === 'single' && detectedTargets.length > 0) {
        // 找最大的 (scale 最大)
        const biggest = detectedTargets.reduce((prev, current) => (prev.scale > current.scale) ? prev : current);
        targetsToProcess = [biggest];
    }

    // 2. 匹配逻辑 (Matching)：把“检测到的新位置”分配给“老 ID”
    // 使用简单的距离匹配 (Greedy Match by Distance)
    
    // 先把所有 Tracker 标记为未更新
    activeTrackers.forEach(t => t.updated = false);

    targetsToProcess.forEach(target => {
        // 找离这个目标最近的、还没匹配过的 Tracker
        let bestDist = Infinity;
        let bestTracker = null;

        activeTrackers.forEach(tracker => {
            if (tracker.updated) return; // 已经匹配过了
            
            // 计算距离
            const dist = Math.hypot(tracker.x - target.x, tracker.y - target.y);
            
            // 阈值：如果距离太远（比如超过画面宽度的 1/3），可能不是同一个人
            const maxJump = width * 0.3; 
            
            if (dist < bestDist && dist < maxJump) {
                bestDist = dist;
                bestTracker = tracker;
            }
        });

        if (bestTracker) {
            // [匹配成功] 更新这个 Tracker
            updateTracker(bestTracker, target);
            bestTracker.updated = true;
            target.matched = true;
        } else {
            // [未匹配] 这是一个新人，创建新 Tracker
            const newTracker = createTracker(target.x, target.y, target.scale);
            activeTrackers.push(newTracker);
        }
    });

    // 3. 清理逻辑：没匹配到的 Tracker 怎么办？
    // 增加 lostFrames，如果丢太久就删掉
    for (let i = activeTrackers.length - 1; i >= 0; i--) {
        const t = activeTrackers[i];
        if (!t.updated) {
            t.lostFrames++;
            if (t.lostFrames > 10) { // 连续 10 帧没检测到，判定为消失
                activeTrackers.splice(i, 1);
            }
        }
    }

    // 4. 绘制所有存活的 Tracker
    activeTrackers.forEach(t => {
        // 如果刚创建不久或还在追踪中，就画出来
        if (t.lostFrames < 5) {
            drawMask(ctx, t.x, t.y, t.scale);
        }
    });
  };

  // 辅助：创建新追踪器
  const createTracker = (x, y, scale) => {
    return {
        id: nextTrackerId.current++,
        x, y, scale,
        updated: true,
        lostFrames: 0
    };
  };

  // 辅助：更新追踪器 (包含平滑逻辑)
  const updateTracker = (t, target) => {
    t.lostFrames = 0;
    
    // 位置平滑
    const alphaPos = 0.4;
    t.x += (target.x - t.x) * alphaPos;
    t.y += (target.y - t.y) * alphaPos;

    // 尺寸防抖 (Deadzone)
    const sizeDiff = Math.abs(target.scale - t.scale) / t.scale;
    let alphaScale = 0.1;
    if (sizeDiff < 0.05) alphaScale = 0.005; // 抖动锁定
    else alphaScale = 0.1;

    t.scale += (target.scale - t.scale) * alphaScale;
  };

  const drawMask = (ctx, x, y, size) => {
    const { maskMode, emojiChar } = settingsRef.current;
    
    ctx.save();
    ctx.translate(x, y);

    if (maskMode === 'image' && maskImgRef.current) {
        const img = maskImgRef.current;
        const aspect = img.width / img.height;
        let w = size * 1.1;
        let h = w / aspect;
        ctx.drawImage(img, -w/2, -h/2, w, h);
    } else {
        ctx.font = `${size}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(emojiChar, 0, size * 0.1); 
    }
    
    ctx.restore();
  };

  return (
    <div style={containerStyle}>
      <header style={{textAlign: 'center', marginBottom: '30px'}}>
        <h1 style={{fontSize: '2.5rem', marginBottom: '10px', background: 'linear-gradient(45deg, #FF512F, #DD2476)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'}}>
            我说了坚决保护豆私！
        </h1>
        <p style={{color: '#666'}}>多人追踪模式上线 | 智能 ID 分配 | 互不干扰</p>
      </header>

      <div style={cardStyle}>
        
        {/* 顶部控制栏 */}
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '15px'}}>
            <div style={{flex: 1, minWidth: '280px'}}>
                <label style={{display: 'block', fontWeight: 'bold', marginBottom: '8px', color: '#444'}}>1. 导入视频</label>
                <input 
                    key="video-upload-input"
                    type="file" 
                    accept="video/*" 
                    onChange={handleVideoUpload} 
                    style={inputStyle} 
                />
            </div>

            <div style={{flex: 1, minWidth: '280px'}}>
                <label style={{display: 'block', fontWeight: 'bold', marginBottom: '8px', color: '#444'}}>2. 追踪模式</label>
                <div style={{display: 'flex', gap: '10px'}}>
                    <button 
                        onClick={() => setTrackingMode('single')}
                        style={{...buttonStyle, margin: 0, flex: 1, background: trackingMode === 'single' ? '#007bff' : '#eee', color: trackingMode === 'single' ? '#fff' : '#333'}}
                    >
                        👤 单人C位
                    </button>
                    <button 
                        onClick={() => setTrackingMode('multi')}
                        style={{...buttonStyle, margin: 0, flex: 1, background: trackingMode === 'multi' ? '#6f42c1' : '#eee', color: trackingMode === 'multi' ? '#fff' : '#333'}}
                    >
                        👥 多人并行
                    </button>
                </div>
            </div>
        </div>

        {/* 遮挡设置 */}
        <div style={{marginBottom: '20px', padding: '15px', background: '#f8f9fa', borderRadius: '12px'}}>
             <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '10px'}}>
                <label style={{fontWeight: 'bold', color: '#444'}}>3. 选择遮挡物</label>
                <select value={maskMode} onChange={(e) => setMaskMode(e.target.value)} style={{padding: '5px', borderRadius: '4px'}}>
                    <option value="emoji">Emoji 表情</option>
                    <option value="image">自定义图片</option>
                </select>
             </div>
             
             {maskMode === 'emoji' ? (
                <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center'}}>
                    <input 
                        key="emoji-input"
                        type="text" 
                        value={emojiChar || ''} 
                        onChange={(e) => setEmojiChar(e.target.value)} 
                        placeholder="输入表情"
                        style={{...inputStyle, width: '120px', textAlign: 'center', fontSize: '24px', padding: '5px'}}
                    />
                    {PRESET_EMOJIS.map(e => (
                        <button key={e} onClick={() => setEmojiChar(e)} style={{border: '1px solid #ddd', background: 'white', borderRadius: '6px', cursor: 'pointer', fontSize: '20px', padding: '5px 10px'}}>
                            {e}
                        </button>
                    ))}
                    {/* 直接上传按钮 */}
                    <button 
                        onClick={() => hiddenFileInputRef.current.click()} 
                        style={{border: '1px dashed #999', background: '#fff', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', padding: '5px 10px', display: 'flex', alignItems: 'center', gap: '5px'}}
                        title="上传图片"
                    >
                        📁 上传
                    </button>
                </div>
             ) : (
                <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
                    <input 
                        key="mask-upload-input"
                        type="file" 
                        accept="image/*" 
                        onChange={handleMaskUpload} 
                        style={inputStyle} 
                    />
                    {maskSrc && (
                        <div style={{width: '50px', height: '50px', border: '1px solid #ddd', borderRadius: '4px', overflow: 'hidden', background: '#fff'}}>
                            <img src={maskSrc} alt="预览" style={{width: '100%', height: '100%', objectFit: 'contain'}} />
                        </div>
                    )}
                </div>
             )}

             {/* 隐藏的文件输入框，用于快捷上传 */}
             <input 
                type="file" 
                accept="image/*" 
                ref={hiddenFileInputRef} 
                onChange={handleMaskUpload} 
                style={{display: 'none'}} 
             />
        </div>

        {/* 状态反馈 */}
        <div style={{marginBottom: '10px'}}>
            <span style={statusStyle}>{status}</span>
            {isProcessing && (
                <span style={{...statusStyle, background: '#e3f2fd', color: '#0d47a1', marginLeft: '10px'}}>
                   进度: {progress}%
                </span>
            )}
        </div>

        {/* 核心画布 */}
        <div style={{position: 'relative', width: '100%', background: '#000', borderRadius: '12px', overflow: 'hidden', display: 'flex', justifyContent: 'center', minHeight: '400px'}}>
            <canvas ref={canvasRef} style={{maxWidth: '100%', maxHeight: '600px', display: 'block'}} />
            {!videoSrc && (
                <div style={{position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: '#888', textAlign: 'center'}}>
                    <div style={{fontSize: '40px', marginBottom: '10px'}}>🎬</div>
                    请先上传视频<br/>支持单人/多人视频
                </div>
            )}
        </div>

        {/* 操作栏 */}
        <div style={{marginTop: '25px', textAlign: 'center'}}>
            <button 
                style={{...buttonStyle, padding: '15px 40px', fontSize: '18px', background: (!poseLandmarker || !videoSrc || isProcessing) ? '#ccc' : '#007bff'}} 
                onClick={startProcessing}
                disabled={!poseLandmarker || !videoSrc || isProcessing}
            >
                {isProcessing ? '⏳ 正在运算...' : '✨ 开始生成视频'}
            </button>

            {downloadUrl && (
                <div style={{marginTop: '15px', animation: 'fadeIn 0.5s'}}>
                    <a 
                        href={downloadUrl} 
                        download={`DanceMask_Multi_${Date.now()}.mp4`}
                        style={{...buttonStyle, background: '#28a745', textDecoration: 'none', padding: '15px 40px', fontSize: '18px'}}
                    >
                        📥 下载最终视频
                    </a>
                </div>
            )}
        </div>
      </div>

      <video ref={videoRef} src={videoSrc} playsInline crossOrigin="anonymous" style={{display: 'none'}} />
    </div>
  );
}

export default App;