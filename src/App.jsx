import React, { useState, useRef, useEffect } from 'react';
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

// --- 样式定义 ---
const containerStyle = { maxWidth: '900px', margin: '0 auto', padding: '15px', fontFamily: '"Segoe UI", Roboto, Helvetica, Arial, sans-serif', color: '#333' };
const buttonStyle = { padding: '10px 20px', margin: '5px', background: '#222', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', transition: 'all 0.2s', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
const inputStyle = { padding: '8px', borderRadius: '6px', border: '1px solid #ddd', width: '100%', boxSizing: 'border-box', background: '#f8f9fa' };
const cardStyle = { background: 'white', padding: '20px', borderRadius: '16px', boxShadow: '0 8px 30px rgba(0,0,0,0.08)', marginBottom: '20px' };
const statusStyle = { fontSize: '13px', padding: '6px 10px', borderRadius: '4px', background: '#e9ecef', color: '#495057', display: 'inline-block', marginBottom: '8px' };
const manualUploadBoxStyle = { background: '#ebf8ff', border: '1px dashed #4299e1', borderRadius: '8px', padding: '12px', marginBottom: '15px', textAlign: 'center', fontSize: '13px' };

const PRESET_EMOJIS = ['🐯', '🦁', '😎', '👽', '🤡', '🤖', '💩'];

// 模型地址配置
const MODEL_URLS = {
    'Lite': 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    'Full': 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
    'Heavy': 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task'
};

function App() {
  // === 状态管理 ===
  const [poseLandmarker, setPoseLandmarker] = useState(null);
  const [videoSrc, setVideoSrc] = useState(null);

  // UI 选项
  const [maskMode, setMaskMode] = useState('emoji'); 
  const [maskSrc, setMaskSrc] = useState(null); 
  const [emojiChar, setEmojiChar] = useState('🐯');
  const [customEmojiInput, setCustomEmojiInput] = useState(''); // 自定义输入
  
  // 模型与模式
  const [modelType, setModelType] = useState('Heavy'); 
  const [trackingMode, setTrackingMode] = useState('multi');

  // 状态显示
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState("等待初始化...");
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [downloadExt, setDownloadExt] = useState('mp4'); 
  const [progress, setProgress] = useState(0);

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

  // 检测是否手机
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  // 1. 初始化 AI
  useEffect(() => {
    // 智能默认：手机用 Lite 防止卡死，电脑用 Heavy
    const defaultModel = isMobile ? 'Lite' : 'Heavy';
    setModelType(defaultModel);
    loadModel(defaultModel); 
  }, []);

  useEffect(() => {
    settingsRef.current = { maskMode, emojiChar, trackingMode };
  }, [maskMode, emojiChar, trackingMode]);

  const loadModel = async (quality, localFileUrl = null) => {
    setPoseLandmarker(null);
    setStatus(localFileUrl ? `📦 解析本地模型文件...` : `🌐 下载 ${quality} 模型...`);

    try {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
      );

      const assetPath = localFileUrl || MODEL_URLS[quality];

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
      if (!localFileUrl) setModelType(quality);
      setStatus(`✅ 模型就绪 (${localFileUrl ? '本地导入' : quality})`);
    } catch (err) {
      setStatus(`❌ 加载失败: ${err.message}`);
      console.error(err);
    }
  };

  const handleModelFileUpload = (e) => {
      const file = e.target.files[0];
      if (file) {
          loadModel('Custom', URL.createObjectURL(file));
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
    setStatus("🚀 初始化录制...");
    setDownloadUrl(null);
    chunksRef.current = [];
    setProgress(0);
    trackersRef.current = [];
    nextTrackerId.current = 1;

    if (video.readyState < 2) await new Promise(r => video.onloadeddata = r);

    // === 智能分辨率锁 ===
    const MAX_WIDTH = isMobile ? 540 : 800; 
    const scaleFactor = Math.min(1, MAX_WIDTH / video.videoWidth);
    
    const renderWidth = video.videoWidth * scaleFactor;
    const renderHeight = video.videoHeight * scaleFactor;

    const canvas = canvasRef.current;
    canvas.width = renderWidth;
    canvas.height = renderHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // === 录制格式与码率 ===
    let mimeType = 'video/webm';
    let ext = 'webm';

    if (MediaRecorder.isTypeSupported('video/mp4')) {
        mimeType = 'video/mp4';
        ext = 'mp4';
    } else if (MediaRecorder.isTypeSupported('video/webm; codecs=vp9')) {
        mimeType = 'video/webm; codecs=vp9';
    }
    setDownloadExt(ext);

    const bits = isMobile ? 2500000 : 5000000;
    const stream = canvas.captureStream(30);
    
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioCtx.createMediaElementSource(video);
        const dest = audioCtx.createMediaStreamDestination();
        source.connect(dest);
        source.connect(audioCtx.destination);
        if (dest.stream.getAudioTracks().length > 0) stream.addTrack(dest.stream.getAudioTracks()[0]);
    } catch(e) {}

    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bits });
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
    try { await video.play(); } catch(e) {}

    const totalDuration = video.duration;

    const processLoop = () => {
      if (video.paused || video.ended) {
        recorder.stop();
        return;
      }

      ctx.drawImage(video, 0, 0, renderWidth, renderHeight);

      const startTimeMs = performance.now();
      let allLandmarks = [];
      try {
        const result = poseLandmarker.detectForVideo(video, startTimeMs);
        if (result.landmarks) allLandmarks = result.landmarks;
      } catch(e) { console.error(e); }

      processMultiPersonAlgorithm(ctx, allLandmarks, renderWidth, renderHeight);

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
    return { id: nextTrackerId.current++, x, y, scale, updated: true, lostFrames: 0 };
  };

  const updateTracker = (t, target) => {
    t.lostFrames = 0;
    const alphaPos = 0.4;
    t.x += (target.x - t.x) * alphaPos;
    t.y += (target.y - t.y) * alphaPos;
    const sizeDiff = Math.abs(target.scale - t.scale) / t.scale;
    let alphaScale = sizeDiff < 0.05 ? 0.005 : 0.1;
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
            保护豆私！
        </h1>
        <p style={{color: '#FF512F', fontSize: '13px'}}>建议使用电脑，效果最佳</p>
        <p style={{color: '#DD2476', fontSize: '13px'}}>旅游去了，回来更新</p>
        <p style={{color: '#666', fontSize: '13px'}}>纯前端隐私保护 | 多人追踪 | 本地运行</p>
      </header>

      <div style={cardStyle}>
        
        {!poseLandmarker && (
            <div style={manualUploadBoxStyle}>
                <p>⏳ 正在加载云端模型...</p>
                <p style={{color:'#666'}}>如果卡住，请点下方按钮手动导入 <b>.task</b> 文件</p>
                <button onClick={() => hiddenModelInputRef.current.click()} style={{...buttonStyle, background:'#fff', color:'#333', border:'1px solid #ccc'}}>
                    📂 手动导入模型
                </button>
                <input type="file" accept=".task,.bin" ref={hiddenModelInputRef} onChange={handleModelFileUpload} style={{display:'none'}} />
            </div>
        )}

        <div style={{marginBottom: '20px'}}>
            <label style={{display: 'block', fontWeight: 'bold', marginBottom: '8px', color: '#444'}}>1. 上传视频</label>
            <input type="file" accept="video/*" onChange={handleVideoUpload} style={inputStyle} />
        </div>

        <div style={{display: 'flex', gap: '15px', flexWrap: 'wrap', marginBottom: '20px'}}>
            <div style={{flex: 1, minWidth: '140px'}}>
                <label style={{display: 'block', fontSize:'13px', fontWeight: 'bold', marginBottom: '5px', color: '#666'}}>追踪模式</label>
                <div style={{display: 'flex', gap: '5px'}}>
                    <button onClick={() => setTrackingMode('single')} style={{...buttonStyle, margin:0, flex:1, padding:'8px', background: trackingMode==='single'?'#007bff':'#eee', color: trackingMode==='single'?'#fff':'#333'}}>
                        👤 单人C位
                    </button>
                    <button onClick={() => setTrackingMode('multi')} style={{...buttonStyle, margin:0, flex:1, padding:'8px', background: trackingMode==='multi'?'#6f42c1':'#eee', color: trackingMode==='multi'?'#fff':'#333'}}>
                        👥 多人并行
                    </button>
                </div>
            </div>
            <div style={{flex: 1, minWidth: '140px'}}>
                <label style={{display: 'block', fontSize:'13px', fontWeight: 'bold', marginBottom: '5px', color: '#666'}}>AI 模型精度</label>
                <select 
                    style={inputStyle} 
                    value={modelType} 
                    onChange={(e) => {
                        setModelType(e.target.value);
                        loadModel(e.target.value);
                    }}
                >
                    <option value="Lite">Lite (手机极速)</option>
                    <option value="Full">Full (均衡推荐)</option>
                    <option value="Heavy">Heavy (电脑高清)</option>
                </select>
            </div>
        </div>

        <div style={{marginBottom: '20px', padding: '15px', background: '#f8f9fa', borderRadius: '12px'}}>
             <label style={{fontWeight: 'bold', color: '#444', display:'block', marginBottom:'10px'}}>2. 选择遮挡物</label>
             
             <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center'}}>
                {PRESET_EMOJIS.map(e => (
                    <button key={e} onClick={() => {setEmojiChar(e); setMaskMode('emoji')}} style={{border: '1px solid #ddd', background: 'white', borderRadius: '6px', cursor: 'pointer', fontSize: '20px', padding: '5px 10px'}}>
                        {e}
                    </button>
                ))}
                
                <div style={{position:'relative', display:'flex', alignItems:'center', border:'1px solid #ddd', background:'white', borderRadius:'6px', padding:'0 5px'}}>
                    <span style={{fontSize:'12px', color:'#999'}}>输入:</span>
                    <input 
                        type="text" 
                        value={customEmojiInput}
                        onChange={(e) => {
                            setCustomEmojiInput(e.target.value);
                            if(e.target.value) { setEmojiChar(e.target.value); setMaskMode('emoji'); }
                        }}
                        style={{border:'none', width:'50px', fontSize:'18px', textAlign:'center', outline:'none'}} 
                        placeholder="..."
                    />
                </div>

                <div style={{width:'1px', height:'20px', background:'#ccc', margin:'0 5px'}}></div>

                <button onClick={() => hiddenFileInputRef.current.click()} style={{...buttonStyle, margin:0, background:'#e2e8f0', color:'#333', padding:'6px 12px'}}>
                    📷 图片
                </button>
                <input type="file" accept="image/*" ref={hiddenFileInputRef} onChange={handleMaskUpload} style={{display: 'none'}} />
             </div>
             
             <div style={{marginTop:'10px', fontSize:'13px', color:'#666'}}>
                当前: <span style={{fontWeight:'bold'}}>{maskMode==='image'?'自定义图片':emojiChar}</span>
             </div>
        </div>

        <div style={{marginBottom: '10px'}}>
            <span style={statusStyle}>{status}</span>
            {isProcessing && <span style={{...statusStyle, background: '#e3f2fd', color: '#0d47a1', marginLeft: '10px'}}>进度: {progress}%</span>}
        </div>

        <div style={{position: 'relative', width: '100%', background: '#000', borderRadius: '12px', overflow: 'hidden', display: 'flex', justifyContent: 'center', minHeight: '300px'}}>
            <canvas ref={canvasRef} style={{maxWidth: '100%', maxHeight: '600px', display: 'block'}} />
            {!videoSrc && (
                <div style={{position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: '#888', textAlign: 'center'}}>
                    <div style={{fontSize: '40px', marginBottom: '10px'}}>🎬</div>
                </div>
            )}
        </div>

        <div style={{marginTop: '25px', textAlign: 'center'}}>
            <button 
                style={{...buttonStyle, padding: '15px 40px', fontSize: '18px', background: (!poseLandmarker || !videoSrc || isProcessing) ? '#ccc' : '#007bff', width:'100%'}} 
                onClick={startProcessing}
                disabled={!poseLandmarker || !videoSrc || isProcessing}
            >
                {isProcessing ? '⏳ 运算中...勿锁屏' : '✨ 开始生成视频'}
            </button>

            {downloadUrl && (
                <div style={{marginTop: '15px', animation: 'fadeIn 0.5s'}}>
                    <a 
                        href={downloadUrl} 
                        download={`PrivacyMask_Fixed_${Date.now()}.${downloadExt}`}
                        style={{...buttonStyle, background: '#28a745', textDecoration: 'none', padding: '15px 40px', fontSize: '18px', width:'100%', boxSizing:'border-box'}}
                    >
                        📥 下载最终视频
                    </a>
                    
                    <div style={{background:'#fff5f5', color:'#c53030', fontSize:'12px', padding:'10px', borderRadius:'8px', marginTop:'10px', textAlign:'left', border:'1px solid #fed7d7'}}>
                        <p style={{margin:0, fontWeight:'bold'}}>⚠️ 下载遇到问题？</p>
                        <ul style={{margin:'5px 0 0 0', paddingLeft:'20px'}}>
                             <li><b>iOS Safari</b>: 下载后若找不到，请点底部的“分享”图标 &rarr; “存储到文件”。</li>
                             <li><b>WhatsApp/微信 发送失败</b>: 请去相册里点“编辑”，随便裁剪一点点长度再保存，系统会自动修复文件头，然后就能发了！</li>
                        </ul>
                    </div>
                </div>
            )}
        </div>
      </div>

      <video ref={videoRef} src={videoSrc} playsInline crossOrigin="anonymous" style={{display: 'none'}} muted />
    </div>
  );
}

export default App;