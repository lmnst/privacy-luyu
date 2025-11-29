import React, { useState, useRef, useEffect } from 'react';
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

// --- 样式定义 ---
const containerStyle = { maxWidth: '900px', margin: '0 auto', padding: '20px', fontFamily: '"Segoe UI", Roboto, Helvetica, Arial, sans-serif', color: '#333' };
const buttonStyle = { padding: '12px 24px', margin: '0 10px 10px 0', background: '#222', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: '600', cursor: 'pointer', transition: 'all 0.2s', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
const inputStyle = { padding: '10px', borderRadius: '8px', border: '1px solid #ddd', width: '100%', boxSizing: 'border-box', fontSize: '15px', background: '#f8f9fa' };
const cardStyle = { background: 'white', padding: '25px', borderRadius: '16px', boxShadow: '0 8px 30px rgba(0,0,0,0.08)', marginBottom: '20px' };
const statusStyle = { fontSize: '14px', padding: '8px 12px', borderRadius: '6px', background: '#e9ecef', color: '#495057', display: 'inline-block', marginBottom: '10px' };
const errorBoxStyle = { background: '#fff5f5', border: '1px solid #fc8181', borderRadius: '8px', padding: '15px', marginTop: '10px', color: '#c53030', fontSize: '14px' };
const manualUploadBoxStyle = { background: '#ebf8ff', border: '1px dashed #4299e1', borderRadius: '8px', padding: '15px', marginBottom: '20px', textAlign: 'center' };

// 预设一些好玩的 Emoji
const PRESET_EMOJIS = ['🐯', '🦁', '😎', '👽', '🤡', '🤖', '💩'];

// 模型下载源配置
const MODEL_SOURCES = {
    'Google': {
        name: 'Google 官方源 (稳定)',
        urls: {
            'Heavy': 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task'
        }
    }
};

function App() {
  // === 状态管理 ===
  const [poseLandmarker, setPoseLandmarker] = useState(null);
  const [videoSrc, setVideoSrc] = useState(null);
  
  // UI 选项
  const [maskMode, setMaskMode] = useState('emoji'); 
  const [maskSrc, setMaskSrc] = useState(null); 
  const [emojiChar, setEmojiChar] = useState('🐯');
  const [modelType, setModelType] = useState('Heavy'); 
  const [trackingMode, setTrackingMode] = useState('multi');
  const [sourceType, setSourceType] = useState('Google'); 

  // 状态显示
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState("等待初始化...");
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [downloadExt, setDownloadExt] = useState('mp4'); // 新增：动态后缀
  const [progress, setProgress] = useState(0);
  const [modelError, setModelError] = useState(false); 

  // === Refs ===
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const maskImgRef = useRef(null);
  const chunksRef = useRef([]);
  const rafIdRef = useRef(null);
  const hiddenFileInputRef = useRef(null); 
  const hiddenModelInputRef = useRef(null); 
  
  const trackersRef = useRef([]);
  const nextTrackerId = useRef(1);

  const settingsRef = useRef({ maskMode, emojiChar, trackingMode });

  // 1. 初始化 AI
  useEffect(() => {
    loadModel('Heavy', sourceType); 
  }, [sourceType]); 

  useEffect(() => {
    settingsRef.current = { maskMode, emojiChar, trackingMode };
  }, [maskMode, emojiChar, trackingMode]);

  const loadModel = async (quality, source, localFileUrl = null) => {
    setPoseLandmarker(null);
    setModelError(false);
    
    if (localFileUrl) {
        setStatus(`📦 正在解析本地模型文件...`);
    } else {
        const sourceName = MODEL_SOURCES[source]?.name || '默认源';
        setStatus(`🌐 正在尝试连接服务器下载模型...`);
    }
    
    try {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
      );
      
      let assetPath;
      if (localFileUrl) {
          assetPath = localFileUrl;
      } else {
          assetPath = MODEL_SOURCES[source].urls[quality];
      }

      const landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: assetPath,
          delegate: "GPU"
        },
        runningMode: "VIDEO",
        numPoses: 5, 
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      setPoseLandmarker(landmarker);
      setModelType(quality);
      setStatus(`✅ 模型加载成功！请导入视频`);
      setModelError(false);
    } catch (err) {
      console.error(err);
      setStatus(`❌ 自动加载失败。请使用上方的“手动导入模型”。`);
      setModelError(true); 
    }
  };

  const handleModelFileUpload = (e) => {
      const file = e.target.files[0];
      if (file) {
          const localUrl = URL.createObjectURL(file);
          loadModel(modelType, sourceType, localUrl);
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

    // --- 智能格式检测逻辑 ---
    let mimeType = '';
    let ext = 'mp4';

    // 优先尝试 H.264 MP4 (兼容性最好，WhatsApp 喜欢)
    if (MediaRecorder.isTypeSupported('video/mp4; codecs="avc1.42E01E, mp4a.40.2"')) {
        mimeType = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
        ext = 'mp4';
    } 
    // 其次尝试通用 MP4
    else if (MediaRecorder.isTypeSupported('video/mp4')) {
        mimeType = 'video/mp4';
        ext = 'mp4';
    } 
    // 再次尝试 WebM (安卓/Chrome 常用)
    else if (MediaRecorder.isTypeSupported('video/webm; codecs=vp9')) {
        mimeType = 'video/webm; codecs=vp9';
        ext = 'webm';
    } 
    // 保底 WebM
    else {
        mimeType = 'video/webm';
        ext = 'webm';
    }

    console.log(`Using MIME type: ${mimeType}, Extension: .${ext}`);
    setDownloadExt(ext); // 保存后缀名以供下载按钮使用

    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8000000 });

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      // 这里的 type 必须和 recorder 的 mimeType 一致
      const blob = new Blob(chunksRef.current, { type: mimeType.split(';')[0] });
      setDownloadUrl(URL.createObjectURL(blob));
      setIsProcessing(false);
      setStatus(`✅ 处理完成！(格式: .${ext})`);
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

      processMultiPersonAlgorithm(ctx, allLandmarks, canvas.width, canvas.height);

      if (totalDuration > 0) {
        setProgress(Math.round((video.currentTime / totalDuration) * 100));
      }

      rafIdRef.current = requestAnimationFrame(processLoop);
    };

    processLoop();
  };

  const processMultiPersonAlgorithm = (ctx, allLandmarks, width, height) => {
    const activeTrackers = trackersRef.current;
    const { trackingMode } = settingsRef.current;

    const detectedTargets = allLandmarks.map(landmarks => {
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
        
        if (shoulderDist < 10) valid = false;

        return { x: tx, y: ty, scale: tscale, valid, matched: false };
    }).filter(t => t.valid);

    let targetsToProcess = detectedTargets;
    if (trackingMode === 'single' && detectedTargets.length > 0) {
        const biggest = detectedTargets.reduce((prev, current) => (prev.scale > current.scale) ? prev : current);
        targetsToProcess = [biggest];
    }
    
    activeTrackers.forEach(t => t.updated = false);

    targetsToProcess.forEach(target => {
        let bestDist = Infinity;
        let bestTracker = null;

        activeTrackers.forEach(tracker => {
            if (tracker.updated) return; 
            const dist = Math.hypot(tracker.x - target.x, tracker.y - target.y);
            const maxJump = width * 0.3; 
            if (dist < bestDist && dist < maxJump) {
                bestDist = dist;
                bestTracker = tracker;
            }
        });

        if (bestTracker) {
            updateTracker(bestTracker, target);
            bestTracker.updated = true;
            target.matched = true;
        } else {
            const newTracker = createTracker(target.x, target.y, target.scale);
            activeTrackers.push(newTracker);
        }
    });

    for (let i = activeTrackers.length - 1; i >= 0; i--) {
        const t = activeTrackers[i];
        if (!t.updated) {
            t.lostFrames++;
            if (t.lostFrames > 10) { 
                activeTrackers.splice(i, 1);
            }
        }
    }

    activeTrackers.forEach(t => {
        if (t.lostFrames < 5) {
            drawMask(ctx, t.x, t.y, t.scale);
        }
    });
  };

  const createTracker = (x, y, scale) => {
    return {
        id: nextTrackerId.current++,
        x, y, scale,
        updated: true,
        lostFrames: 0
    };
  };

  const updateTracker = (t, target) => {
    t.lostFrames = 0;
    const alphaPos = 0.4;
    t.x += (target.x - t.x) * alphaPos;
    t.y += (target.y - t.y) * alphaPos;
    const sizeDiff = Math.abs(target.scale - t.scale) / t.scale;
    let alphaScale = 0.1;
    if (sizeDiff < 0.05) alphaScale = 0.005; 
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
        
        {/* === 新增：醒目的手动导入区域 === */}
        {/* 只要 poseLandmarker 为空，就显示这个区域，不用等报错 */}
        {!poseLandmarker && (
            <div style={manualUploadBoxStyle}>
                <h3 style={{fontSize: '16px', marginBottom: '10px', color: '#2b6cb0'}}>📡 网络初始化中...</h3>
                <p style={{marginBottom: '10px', fontSize: '14px', color: '#4a5568'}}>
                    如果长时间加载不动（如在中国大陆），请使用<b>离线模式</b>：
                </p>
                <button 
                    onClick={() => hiddenModelInputRef.current.click()}
                    style={{
                        padding: '10px 20px', 
                        background: '#3182ce', 
                        color: 'white', 
                        border: 'none', 
                        borderRadius: '6px', 
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                    }}
                >
                    📂 手动导入模型文件 (.task)
                </button>
                <p style={{fontSize: '12px', marginTop: '8px', color: '#718096'}}>
                    (请朋友先传给你 pose_landmarker_heavy.task 文件)
                </p>
                <input 
                    type="file" 
                    // 关键修复：放宽文件类型限制，解决 iOS 文件变灰不可选的问题
                    // accept=".task,.bin" 
                    ref={hiddenModelInputRef}
                    onChange={handleModelFileUpload}
                    style={{display: 'none'}}
                />
            </div>
        )}

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
                        download={`DanceMask_Multi_${Date.now()}.${downloadExt}`}
                        style={{...buttonStyle, background: '#28a745', textDecoration: 'none', padding: '15px 40px', fontSize: '18px'}}
                    >
                        📥 下载最终视频 ({downloadExt.toUpperCase()})
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