import React, { useState, useRef, useEffect } from 'react';
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

// --- 样式定义 ---
const styles = {
  container: { maxWidth: '800px', margin: '0 auto', padding: '15px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', color: '#333' },
  header: { textAlign: 'center', marginBottom: '20px' },
  title: { background: 'linear-gradient(45deg, #FF512F, #DD2476)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', margin: 0, fontSize: '1.8rem' },
  card: { background: 'white', padding: '20px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', marginBottom: '20px' },
  section: { marginBottom: '15px' },
  label: { display: 'block', fontWeight: 'bold', marginBottom: '8px', color: '#444', fontSize: '14px' },
  input: { padding: '10px', borderRadius: '8px', border: '1px solid #ddd', width: '100%', boxSizing: 'border-box', background: '#f8f9fa', fontSize: '14px' },
  btnGroup: { display: 'flex', gap: '10px' },
  btnOption: (active) => ({ flex: 1, padding: '10px', border: 'none', borderRadius: '8px', background: active ? '#4f46e5' : '#f1f5f9', color: active ? 'white' : '#64748b', fontWeight: '600', cursor: 'pointer', transition: '0.2s' }),
  emojiBtn: { fontSize: '22px', padding: '5px 10px', border: '1px solid #eee', background: 'white', borderRadius: '8px', cursor: 'pointer' },
  mainBtn: (disabled) => ({ width: '100%', padding: '15px', borderRadius: '12px', border: 'none', background: disabled ? '#cbd5e1' : '#0070f3', color: 'white', fontSize: '16px', fontWeight: 'bold', cursor: disabled ? 'not-allowed' : 'pointer', marginTop: '10px' }),
  status: { fontSize: '12px', textAlign: 'center', color: '#666', marginTop: '10px' }
};

// 预设表情 (同时也支持用户自己打)
const PRESET_EMOJIS = ['🐯', '🦁', '😎', '👽', '🤡', '💩'];

const MODEL_URLS = {
    'Lite': 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    'Full': 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
    'Heavy': 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task'
};

function App() {
  // === 状态 ===
  const [poseLandmarker, setPoseLandmarker] = useState(null);
  const [videoSrc, setVideoSrc] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [downloadExt, setDownloadExt] = useState('mp4');
  const [status, setStatus] = useState("正在初始化 AI...");

  // 用户设置
  const [modelType, setModelType] = useState('Lite'); // 默认 Lite
  const [trackingMode, setTrackingMode] = useState('multi'); // 默认多人
  const [maskMode, setMaskMode] = useState('emoji');
  const [emojiChar, setEmojiChar] = useState('🐯');
  const [customEmojiInput, setCustomEmojiInput] = useState(''); // 用于输入框显示

  // Refs
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const maskImgRef = useRef(null);
  const chunksRef = useRef([]);
  const rafIdRef = useRef(null);
  const trackersRef = useRef([]);
  const nextTrackerId = useRef(1);
  const hiddenFileInputRef = useRef(null);
  const settingsRef = useRef({ maskMode, emojiChar, trackingMode });

  // 检测设备
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  // 1. 初始化 (加载模型)
  useEffect(() => {
    // 智能默认：手机用 Lite，电脑用 Heavy
    const defaultModel = isMobile ? 'Lite' : 'Heavy';
    setModelType(defaultModel);
    loadModel(defaultModel);
  }, []);

  // 监听设置变化，实时更新 Ref 给动画循环用
  useEffect(() => {
    settingsRef.current = { maskMode, emojiChar, trackingMode };
  }, [maskMode, emojiChar, trackingMode]);

  const loadModel = async (type) => {
    setPoseLandmarker(null);
    setStatus(`🔄 正在切换至 ${type} 模型...`);
    try {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
      );
      const landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_URLS[type],
          delegate: "GPU"
        },
        runningMode: "VIDEO",
        numPoses: 5, // 最多检测5人
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5
      });
      setPoseLandmarker(landmarker);
      setStatus(`✅ ${type} 模型就绪!`);
    } catch (err) {
      console.error(err);
      setStatus("❌ 模型加载失败，请刷新重试");
    }
  };

  const handleVideoUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (videoSrc) URL.revokeObjectURL(videoSrc);
      setVideoSrc(URL.createObjectURL(file));
      setDownloadUrl(null);
      setProgress(0);
    }
  };

  const handleMaskImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      img.onload = () => { maskImgRef.current = img; };
      setMaskMode('image');
    }
  };

  // === 核心处理逻辑 ===
  const startProcessing = async () => {
    if (!poseLandmarker || !videoRef.current) return;
    
    const video = videoRef.current;
    setIsProcessing(true);
    setStatus("🚀 正在生成... 请保持屏幕常亮");
    setDownloadUrl(null);
    chunksRef.current = [];
    trackersRef.current = [];
    setProgress(0);

    if (video.readyState < 2) await new Promise(r => video.onloadeddata = r);

    // 💡 关键优化：分辨率降级
    // 手机端限制最大宽 540px，电脑端 800px。
    // 这让 Full/Heavy 模型在手机上也能跑！
    const MAX_WIDTH = isMobile ? 540 : 800;
    const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
    const renderWidth = video.videoWidth * scale;
    const renderHeight = video.videoHeight * scale;

    const canvas = canvasRef.current;
    canvas.width = renderWidth;
    canvas.height = renderHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // 录制设置
    let mimeType = 'video/webm';
    let ext = 'webm';
    if (MediaRecorder.isTypeSupported('video/mp4')) { // iOS
        mimeType = 'video/mp4';
        ext = 'mp4';
    } else if (MediaRecorder.isTypeSupported('video/webm; codecs=vp9')) {
        mimeType = 'video/webm; codecs=vp9';
    }
    setDownloadExt(ext);

    // 码率：手机 2.5M，电脑 5M
    const recorder = new MediaRecorder(canvas.captureStream(30), {
        mimeType,
        videoBitsPerSecond: isMobile ? 2500000 : 5000000 
    });

    recorder.ondataavailable = (e) => { if(e.data.size>0) chunksRef.current.push(e.data); };
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

    const loop = async () => {
        if (video.paused || video.ended) {
            recorder.stop();
            return;
        }

        // 1. 绘制底图
        ctx.drawImage(video, 0, 0, renderWidth, renderHeight);

        // 2. AI 识别
        const startTime = performance.now();
        const result = poseLandmarker.detectForVideo(video, startTime);
        
        // 3. 算法处理
        if (result.landmarks) {
            processTrackers(ctx, result.landmarks, renderWidth, renderHeight);
        }

        if (video.duration) setProgress(Math.round(video.currentTime / video.duration * 100));
        rafIdRef.current = requestAnimationFrame(loop);
    };
    loop();
  };

  const processTrackers = (ctx, allLandmarks, width, height) => {
    const { trackingMode } = settingsRef.current;
    const activeTrackers = trackersRef.current;

    // 1. 提取所有目标
    let targets = allLandmarks.map(landmarks => {
        const nose = landmarks[0];
        const lShoulder = landmarks[11];
        const rShoulder = landmarks[12];
        const shoulderDist = Math.hypot((lShoulder.x - rShoulder.x)*width, (lShoulder.y - rShoulder.y)*height);
        
        let x=0, y=0, size=0, valid=false;
        
        // 优先用鼻子，没鼻子用肩膀
        if (nose.visibility > 0.5) {
            x = nose.x * width;
            y = nose.y * height;
            size = shoulderDist * 1.5;
            valid = true;
        } else if (lShoulder.visibility > 0.5) {
            x = (lShoulder.x + rShoulder.x)/2 * width;
            y = (lShoulder.y + rShoulder.y)/2 * height - shoulderDist*0.5;
            size = shoulderDist * 1.5;
            valid = true;
        }
        
        if (shoulderDist < width*0.05) valid = false; // 太小不可能是人
        return { x, y, size, valid };
    }).filter(t => t.valid);

    // 2. 模式过滤
    if (trackingMode === 'single' && targets.length > 0) {
        // 单人模式：只取画面中最大的那个（C位）
        const biggest = targets.reduce((prev, curr) => (prev.size > curr.size ? prev : curr));
        targets = [biggest];
    }

    // 3. 追踪算法 (ID 匹配)
    activeTrackers.forEach(t => t.updated = false);
    
    targets.forEach(target => {
        let bestDist = Infinity, bestId = -1;
        activeTrackers.forEach((tracker, idx) => {
            if (tracker.updated) return;
            const dist = Math.hypot(tracker.x - target.x, tracker.y - target.y);
            if (dist < bestDist && dist < width * 0.2) { // 距离阈值
                bestDist = dist;
                bestId = idx;
            }
        });

        if (bestId !== -1) {
            // 更新老目标
            const t = activeTrackers[bestId];
            t.x += (target.x - t.x) * 0.6; // 平滑
            t.y += (target.y - t.y) * 0.6;
            t.size += (target.size - t.size) * 0.2;
            t.updated = true;
            t.lost = 0;
        } else {
            // 新目标
            activeTrackers.push({ ...target, id: nextTrackerId.current++, updated: true, lost: 0 });
        }
    });

    // 4. 清理与绘制
    for (let i = activeTrackers.length - 1; i >= 0; i--) {
        const t = activeTrackers[i];
        if (!t.updated) {
            t.lost++;
            if (t.lost > 5) activeTrackers.splice(i, 1);
        } else {
            drawMask(ctx, t.x, t.y, t.size);
        }
    }
  };

  const drawMask = (ctx, x, y, size) => {
    const { maskMode, emojiChar } = settingsRef.current;
    if (size < 5) return;

    ctx.save();
    ctx.translate(x, y);

    if (maskMode === 'image' && maskImgRef.current) {
        const img = maskImgRef.current;
        const aspect = img.width / img.height;
        ctx.drawImage(img, -size/2, -size/aspect/2, size, size/aspect);
    } else {
        // Emoji 绘制
        ctx.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // 微调 Y 轴，因为文字基线问题
        ctx.fillText(emojiChar, 0, size * 0.1); 
    }
    ctx.restore();
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>🔒 豆私！</h1>
        <p style={{fontSize:'12px', color:'#666'}}>Vercel 纯净版 | 本地运行 | 保护隐私</p>
      </header>

      <div style={styles.card}>
        <div style={styles.section}>
            <label style={styles.label}>1. 上传视频</label>
            <input type="file" accept="video/*" onChange={handleVideoUpload} style={styles.input} />
        </div>

        {/* 设置区域 */}
        <div style={{display:'flex', gap:'15px', flexWrap:'wrap', marginBottom:'15px'}}>
            <div style={{flex:1, minWidth:'140px'}}>
                <label style={styles.label}>追踪模式</label>
                <div style={styles.btnGroup}>
                    <button onClick={()=>setTrackingMode('single')} style={styles.btnOption(trackingMode==='single')}>👤 单人C位</button>
                    <button onClick={()=>setTrackingMode('multi')} style={styles.btnOption(trackingMode==='multi')}>👥 多人并行</button>
                </div>
            </div>
            <div style={{flex:1, minWidth:'140px'}}>
                <label style={styles.label}>AI 模型精度</label>
                <select 
                    value={modelType} 
                    onChange={(e) => {
                        setModelType(e.target.value);
                        loadModel(e.target.value);
                    }}
                    style={styles.input}
                >
                    <option value="Lite">Lite (手机极速 - 推荐)</option>
                    <option value="Full">Full (均衡模式)</option>
                    <option value="Heavy">Heavy (电脑专用 - 最准)</option>
                </select>
            </div>
        </div>

        {/* 遮挡物设置 */}
        <div style={styles.section}>
            <label style={styles.label}>2. 选择遮挡物 (Emoji 或 图片)</label>
            <div style={{display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap', background:'#f8f9fa', padding:'10px', borderRadius:'8px'}}>
                {/* 预设表情 */}
                {PRESET_EMOJIS.map(e => (
                    <button key={e} onClick={()=>{setMaskMode('emoji'); setEmojiChar(e)}} style={styles.emojiBtn}>{e}</button>
                ))}
                
                {/* 自定义输入 - 关键新功能 */}
                <div style={{position:'relative', display:'flex', alignItems:'center'}}>
                    <input 
                        type="text" 
                        value={customEmojiInput}
                        placeholder="输入..."
                        maxLength={2}
                        onChange={(e) => {
                            const val = e.target.value;
                            setCustomEmojiInput(val);
                            if(val) { setEmojiChar(val); setMaskMode('emoji'); }
                        }}
                        style={{width:'60px', padding:'5px', borderRadius:'6px', border:'1px solid #ccc', textAlign:'center'}}
                    />
                </div>

                <div style={{width:'1px', height:'20px', background:'#ccc', margin:'0 5px'}}></div>

                {/* 图片上传 */}
                <button onClick={()=>hiddenFileInputRef.current.click()} style={{...styles.emojiBtn, fontSize:'14px', background:'#e2e8f0'}}>📁 图</button>
                <input type="file" accept="image/*" ref={hiddenFileInputRef} onChange={handleMaskImageUpload} style={{display:'none'}} />
            </div>
            <div style={{marginTop:'5px', textAlign:'center'}}>
                当前使用: <span style={{fontSize:'20px'}}>{maskMode==='image' ? '🖼️ 图片' : emojiChar}</span>
            </div>
        </div>

        {/* 画布 */}
        <div style={{position:'relative', width:'100%', background:'#000', borderRadius:'10px', overflow:'hidden', minHeight:'200px', display:'flex', alignItems:'center', justifyContent:'center'}}>
            <canvas ref={canvasRef} style={{maxWidth:'100%', maxHeight:'60vh'}} />
            {isProcessing && (
                <div style={{position:'absolute', top:10, right:10, background:'rgba(255,255,255,0.9)', color:'#0070f3', padding:'5px 10px', borderRadius:'15px', fontSize:'12px', fontWeight:'bold'}}>
                    {progress}%
                </div>
            )}
            {!videoSrc && <div style={{color:'#666'}}>🎬 视频预览区</div>}
        </div>

        {/* 底部按钮 */}
        <div style={{marginTop:'20px'}}>
            <button 
                onClick={startProcessing} 
                disabled={!poseLandmarker || !videoSrc || isProcessing}
                style={styles.mainBtn(!poseLandmarker || !videoSrc || isProcessing)}
            >
                {isProcessing ? '⏳ 正在处理中...' : '✨ 开始生成视频'}
            </button>

            {downloadUrl && (
                <div style={{marginTop:'15px', animation:'fadeIn 0.5s'}}>
                    <a 
                        href={downloadUrl} 
                        download={`PrivacyMask_${Date.now()}.${downloadExt}`}
                        style={{...styles.mainBtn(false), background:'#10b981', display:'block', textDecoration:'none', textAlign:'center'}}
                    >
                        📥 保存到相册 ({downloadExt.toUpperCase()})
                    </a>
                    
                    <div style={{background:'#fef2f2', padding:'10px', borderRadius:'8px', marginTop:'10px', fontSize:'12px', color:'#b91c1c', textAlign:'left'}}>
                        <p style={{margin:'0 0 5px'}}><b>⚠️ 常见问题修复：</b></p>
                        <ul style={{paddingLeft:'20px', margin:0}}>
                            <li><b>发给朋友发不出去？</b> 请在手机相册点“编辑”，随便裁剪一下或加个滤镜，保存后即可正常发送。</li>
                            <li><b>iOS用户</b>：点击下载后，请选底部的“分享” -> “存储到文件”。</li>
                        </ul>
                    </div>
                </div>
            )}
            <div style={styles.status}>{status}</div>
        </div>
      </div>
      
      <video ref={videoRef} src={videoSrc} playsInline style={{display:'none'}} muted crossOrigin="anonymous" />
    </div>
  );
}

export default App;