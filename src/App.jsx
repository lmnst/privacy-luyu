import React, { useState, useRef, useEffect } from 'react';
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';

const containerStyle = { maxWidth: '600px', margin: '0 auto', padding: '20px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' };
const buttonStyle = { padding: '12px 24px', margin: '5px', background: '#007bff', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', width: '100%' };
const inputStyle = { padding: '10px', borderRadius: '8px', border: '1px solid #ccc', width: '100%', boxSizing: 'border-box', fontSize: '16px' };
const controlPanelStyle = { margin: '15px 0', padding: '15px', background: '#e9ecef', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '15px' };

function App() {
  // === 状态管理 ===
  const [detector, setDetector] = useState(null);
  const [videoSrc, setVideoSrc] = useState(null);
  
  // UI 选项
  const [maskMode, setMaskMode] = useState('emoji'); 
  const [maskSrc, setMaskSrc] = useState(null); 
  const [emojiChar, setEmojiChar] = useState('😎');
  const [exportFormat, setExportFormat] = useState('mp4'); // 默认 MP4

  // 追踪设置
  const [trackingMode, setTrackingMode] = useState('single'); // 'single' 或 'multi'
  const [maxFaces, setMaxFaces] = useState(2); // 多人模式下的人数限制

  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState("正在加载 AI 模型...");
  const [downloadUrl, setDownloadUrl] = useState(null);

  // === Refs (不触发渲染的变量) ===
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const maskImgRef = useRef(null);
  const chunksRef = useRef([]);
  const rafIdRef = useRef(null); // 动画循环ID，用于强制停止

  // 追踪数据 Refs
  const singleFaceRef = useRef(null); // 单人模式专用
  const multiFacesRef = useRef([]);   // 多人模式专用
  
  // 状态同步 Refs (用于在循环中获取最新 State)
  const settingsRef = useRef({
    maskMode: 'emoji',
    emojiChar: '😎',
    trackingMode: 'single',
    maxFaces: 2
  });

  const audioCtxRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const destNodeRef = useRef(null);
  const initLockRef = useRef(false);

  // 1. 初始化 AI
  useEffect(() => {
    if (initLockRef.current) return;
    initLockRef.current = true;

    const initAI = async () => {
      console.log("🚀 初始化 AI...");
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
        );
        const faceDetector = await FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`,
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          minDetectionConfidence: 0.3,
          minSuppressionThreshold: 0.3 
        });
        setDetector(faceDetector);
        setStatus("✅ AI 就绪！请导入视频");
      } catch (err) {
        setStatus(`❌ 模型加载失败: ${err.message}`);
      }
    };
    initAI();
  }, []);

  // 同步设置到 Ref
  useEffect(() => {
    settingsRef.current = { maskMode, emojiChar, trackingMode, maxFaces };
  }, [maskMode, emojiChar, trackingMode, maxFaces]);

  // 重置播放器状态 (解决卡死问题)
  const resetPlayerState = () => {
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
    }
    setDownloadUrl(null);
    setIsProcessing(false);
    chunksRef.current = [];
    singleFaceRef.current = null;
    multiFacesRef.current = [];
    setStatus("已重置，准备就绪");
  };

  const handleVideoUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      resetPlayerState(); // 导入新视频时强制重置
      setVideoSrc(URL.createObjectURL(file));
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
    }
  };

  const startProcessing = async () => {
    // 强制重置上一轮状态
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    
    if (!detector || !videoRef.current) {
      alert("请等待资源加载");
      return;
    }
    if (maskMode === 'image' && !maskImgRef.current) {
        alert("请先上传遮挡图片");
        return;
    }

    const video = videoRef.current;
    
    // 确保视频元数据加载
    if (video.readyState < 2) {
        setStatus("正在缓冲视频...");
        await new Promise(resolve => {
            video.onloadeddata = resolve;
            // 简单的超时保险
            setTimeout(resolve, 2000); 
        });
    }

    setIsProcessing(true);
    setStatus("🚀 引擎启动中...");
    setDownloadUrl(null);
    chunksRef.current = [];
    singleFaceRef.current = null;
    multiFacesRef.current = [];

    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');

    // === 音频处理 (带清理逻辑) ===
    try {
        if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
        const audioCtx = audioCtxRef.current;
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        
        // 断开旧连接，防止重叠
        if (sourceNodeRef.current) {
            try { sourceNodeRef.current.disconnect(); } catch(e){}
        }
        
        sourceNodeRef.current = audioCtx.createMediaElementSource(video);
        if (!destNodeRef.current) destNodeRef.current = audioCtx.createMediaStreamDestination();
        sourceNodeRef.current.connect(destNodeRef.current);
    } catch (e) { console.warn("音频警告:", e); }

    const canvasStream = canvas.captureStream(30); 
    if (destNodeRef.current) {
        const audioTrack = destNodeRef.current.stream.getAudioTracks()[0];
        if (audioTrack) canvasStream.addTrack(audioTrack);
    }

    // === 格式选择逻辑 (MP4优先) ===
    let mimeType = '';
    if (exportFormat === 'mp4') {
        // 尝试 MP4
        if (MediaRecorder.isTypeSupported('video/mp4; codecs="avc1.42E01E, mp4a.40.2"')) mimeType = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
        else if (MediaRecorder.isTypeSupported('video/mp4')) mimeType = 'video/mp4';
        else mimeType = 'video/webm; codecs=vp9'; // 回退
    } else {
        // 尝试 WebM
        if (MediaRecorder.isTypeSupported('video/webm; codecs=vp9')) mimeType = 'video/webm; codecs=vp9';
        else mimeType = 'video/webm';
    }
    
    console.log(`使用格式: ${mimeType}`);

    let recorder;
    try {
        recorder = new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond: 3000000 }); // 3Mbps 码率
    } catch (e) { 
        console.error(e);
        recorder = new MediaRecorder(canvasStream); // 最后的保底
    }
    
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType.split(';')[0] });
      if (blob.size === 0) { alert("生成失败：文件大小为0"); setIsProcessing(false); return; }
      setDownloadUrl(URL.createObjectURL(blob));
      setIsProcessing(false);
      setStatus("✅ 处理完成！");
      video.pause(); video.muted = false;
      canvasStream.getTracks().forEach(track => track.stop()); // 停止流
    };

    recorder.start(100); 
    
    try {
        video.currentTime = 0; video.muted = false; 
        await video.play();
        processFrame(video, ctx, recorder);
    } catch (e) {
        setStatus(`播放错误: ${e.message}`);
        setIsProcessing(false);
        recorder.stop();
    }
  };

  const processFrame = (video, ctx, recorder) => {
    if (video.ended || video.paused) {
      if (recorder.state === 'recording') recorder.stop();
      return;
    }

    const canvas = ctx.canvas;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const startTimeMs = performance.now();
    let detections = [];
    try { 
        if (detector) {
            const res = detector.detectForVideo(video, startTimeMs);
            detections = res.detections || [];
        }
    } catch(e) {}

    // 读取最新设置
    const { maskMode: curMaskMode, emojiChar: curEmoji, trackingMode: curTrackingMode, maxFaces: curMaxFaces } = settingsRef.current;

    // === 🔥 核心分支逻辑 ===
    if (curTrackingMode === 'single') {
        // --- 方案 A: 极致单人 (死死扒住) ---
        handleSinglePersonMode(detections);
        drawFaces(ctx, [singleFaceRef.current], curMaskMode, curEmoji);
    } else {
        // --- 方案 B: 智能多人 (Top N) ---
        handleMultiPersonMode(detections, curMaxFaces);
        drawFaces(ctx, multiFacesRef.current, curMaskMode, curEmoji);
    }

    rafIdRef.current = requestAnimationFrame(() => processFrame(video, ctx, recorder));
  };

  // === 逻辑 A: 单人死锁模式 ===
  const handleSinglePersonMode = (detections) => {
      // 1. 找画面里最大的一张脸 (无视其他的)
      let bestFace = null;
      let maxArea = 0;

      detections.forEach(det => {
          const { width, height } = det.boundingBox;
          const area = width * height;
          if (area > maxArea) {
              maxArea = area;
              bestFace = det.boundingBox;
          }
      });

      // 2. 如果找到了，进行平滑更新
      if (bestFace) {
          if (singleFaceRef.current) {
              const old = singleFaceRef.current;
              const alpha = 0.4; // 橡皮筋系数
              
              // 平滑更新
              old.x = old.x * (1-alpha) + bestFace.originX * alpha;
              old.y = old.y * (1-alpha) + bestFace.originY * alpha;
              old.w = old.w * (1-alpha) + bestFace.width * alpha;
              old.h = old.h * (1-alpha) + bestFace.height * alpha;
              
              // 更新惯性速度
              old.vx = old.x - (singleFaceRef.current.x); // 这里近似
              old.vy = old.y - (singleFaceRef.current.y);
              
              old.missedFrames = 0;
          } else {
              // 第一次发现
              singleFaceRef.current = {
                  x: bestFace.originX, y: bestFace.originY,
                  w: bestFace.width, h: bestFace.height,
                  vx: 0, vy: 0, missedFrames: 0
              };
          }
      } else if (singleFaceRef.current) {
          // 3. 没找到，启动惯性预测
          const old = singleFaceRef.current;
          old.missedFrames++;
          if (old.missedFrames < 30) { // 允许预测30帧
              old.vx *= 0.9;
              old.vy *= 0.9;
              old.x += old.vx;
              old.y += old.vy;
          } else {
              singleFaceRef.current = null; // 丢太久，放弃
          }
      }
  };

  // === 逻辑 B: 多人 Top N 模式 ===
  const handleMultiPersonMode = (detections, maxN) => {
      let trackedFaces = multiFacesRef.current;
      trackedFaces.forEach(f => f.updated = false);

      // 贪婪匹配
      detections.forEach(det => {
          const bbox = det.boundingBox;
          const cx = bbox.originX + bbox.width/2;
          const cy = bbox.originY + bbox.height/2;

          let bestMatch = null;
          let minDist = 200; // 匹配阈值

          trackedFaces.forEach(face => {
              const dist = Math.sqrt(Math.pow(cx - (face.x + face.w/2), 2) + Math.pow(cy - (face.y + face.h/2), 2));
              if (dist < minDist) {
                  minDist = dist;
                  bestMatch = face;
              }
          });

          if (bestMatch && !bestMatch.updated) {
              const alpha = 0.4;
              bestMatch.x = bestMatch.x * (1-alpha) + bbox.originX * alpha;
              bestMatch.y = bestMatch.y * (1-alpha) + bbox.originY * alpha;
              bestMatch.w = bestMatch.w * (1-alpha) + bbox.width * alpha;
              bestMatch.h = bestMatch.h * (1-alpha) + bbox.height * alpha;
              bestMatch.updated = true;
              bestMatch.missedFrames = 0;
          } else {
              // 新人
              trackedFaces.push({
                  x: bbox.originX, y: bbox.originY, w: bbox.width, h: bbox.height,
                  vx: 0, vy: 0, missedFrames: 0, updated: true
              });
          }
      });

      // 清理丢失的
      trackedFaces = trackedFaces.filter(f => {
          if (!f.updated) {
              f.missedFrames++;
              return f.missedFrames < 15; // 多人模式容忍度低一点
          }
          return true;
      });

      // 🔥 核心优化：只保留 Top N (按脸的大小排序)
      // 防止背景噪点变成 Emoji
      trackedFaces.sort((a, b) => (b.w * b.h) - (a.w * a.h)); // 面积从大到小
      if (trackedFaces.length > maxN) {
          trackedFaces = trackedFaces.slice(0, maxN);
      }

      multiFacesRef.current = trackedFaces;
  };

  // 统一绘制函数
  const drawFaces = (ctx, faces, mode, emoji) => {
      const scale = 1.5;
      faces.forEach(face => {
          if (!face) return;
          const { x, y, w, h } = face;
          
          if (mode === 'image' && maskImgRef.current) {
              const dw = w * scale;
              const dh = h * scale;
              ctx.drawImage(maskImgRef.current, x - (dw-w)/2, y - (dh-h)/2, dw, dh);
          } else {
              const fontSize = Math.max(w, h) * scale;
              ctx.font = `${fontSize}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(emoji, x + w/2, y + h/2 + h*0.1);
          }
      });
  };

  return (
    <div style={containerStyle}>
      <h2 style={{textAlign: 'center'}}>保护豆私 (终极版)</h2>
      
      {/* 控制面板 */}
      <div style={controlPanelStyle}>
        
        {/* 1. 模式选择 */}
        <div>
            <label style={{display: 'block', fontWeight: 'bold', marginBottom: '8px'}}>🎯 追踪模式</label>
            <div style={{display: 'flex', gap: '10px', marginBottom: '10px'}}>
                <button 
                    onClick={() => setTrackingMode('single')}
                    style={{
                        ...buttonStyle,
                        background: trackingMode === 'single' ? '#007bff' : '#fff',
                        color: trackingMode === 'single' ? '#fff' : '#333',
                        border: '1px solid #ccc'
                    }}
                >
                    👤 单人死锁 (推荐)
                </button>
                <button 
                    onClick={() => setTrackingMode('multi')}
                    style={{
                        ...buttonStyle,
                        background: trackingMode === 'multi' ? '#6610f2' : '#fff',
                        color: trackingMode === 'multi' ? '#fff' : '#333',
                        border: '1px solid #ccc'
                    }}
                >
                    👥 多人 Top-N
                </button>
            </div>
            
            {/* 多人模式下的设置 */}
            {trackingMode === 'multi' && (
                <div style={{display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', background: '#fff', padding: '8px', borderRadius: '6px'}}>
                    <span>只给最大的前</span>
                    <input 
                        type="number" min="1" max="10" 
                        value={maxFaces} 
                        onChange={(e) => setMaxFaces(parseInt(e.target.value))}
                        style={{width: '50px', padding: '5px', textAlign: 'center', border: '1px solid #ccc', borderRadius: '4px'}}
                    />
                    <span>人打码 (防止乱码)</span>
                </div>
            )}
            
            <p style={{fontSize: '12px', color: '#666', marginTop: '5px'}}>
                {trackingMode === 'single' 
                    ? '单人模式：只追踪画面里最大的一张脸，无视背景路人，效果最稳。' 
                    : `多人模式：会追踪画面里最大的 ${maxFaces} 个人，多余的杂乱人脸会被过滤。`}
            </p>
        </div>

        {/* 2. 导出格式 */}
        <div>
            <label style={{display: 'block', fontWeight: 'bold', marginBottom: '8px'}}>💾 导出格式</label>
            <select 
                value={exportFormat} 
                onChange={(e) => setExportFormat(e.target.value)}
                style={{...inputStyle, background: '#fff'}}
            >
                <option value="mp4">MP4 (推荐手机/iOS)</option>
                <option value="webm">WebM (推荐电脑/安卓)</option>
            </select>
        </div>

        {/* 3. 视频和素材 */}
        <div>
            <label style={{display: 'block', fontWeight: 'bold', marginBottom: '8px'}}>📹 导入视频</label>
            <input type="file" accept="video/*" onChange={handleVideoUpload} style={{...inputStyle, background: '#fff'}} />
        </div>

        <div>
            <label style={{display: 'block', fontWeight: 'bold', marginBottom: '8px'}}>🎭 遮挡方式</label>
            <div style={{display: 'flex', gap: '10px', marginBottom: '10px'}}>
                <label style={{cursor: 'pointer', display: 'flex', alignItems: 'center'}}>
                    <input type="radio" name="maskMode" value="emoji" checked={maskMode === 'emoji'} onChange={(e) => setMaskMode(e.target.value)} style={{marginRight: '5px'}} /> Emoji
                </label>
                <label style={{cursor: 'pointer', display: 'flex', alignItems: 'center'}}>
                    <input type="radio" name="maskMode" value="image" checked={maskMode === 'image'} onChange={(e) => setMaskMode(e.target.value)} style={{marginRight: '5px'}} /> 图片
                </label>
            </div>
            {maskMode === 'emoji' ? (
                <input type="text" value={emojiChar} placeholder="输入Emoji" onChange={(e) => setEmojiChar(e.target.value)} maxLength={5} style={{...inputStyle, fontSize: '32px', textAlign: 'center', background: '#fff'}} />
            ) : (
                <input type="file" accept="image/*" onChange={handleMaskUpload} style={{...inputStyle, background: '#fff'}} />
            )}
        </div>

      </div>

      <div style={{border: '2px solid #333', borderRadius: '8px', background: '#000', minHeight: '200px', display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'hidden', marginBottom: '20px'}}>
        <canvas ref={canvasRef} style={{maxWidth: '100%', maxHeight: '60vh', display: 'block'}} />
      </div>

      <div style={{display: 'flex', justifyContent: 'center', gap: '15px'}}>
        <button style={{...buttonStyle, opacity: (isProcessing || !videoSrc) ? 0.6 : 1}} onClick={startProcessing} disabled={isProcessing || !videoSrc}>
          {isProcessing ? '⏳ 处理中...' : '🚀 开始生成'}
        </button>
        {downloadUrl && (
          <a href={downloadUrl} download={`masked_${Date.now()}.${exportFormat}`} style={{...buttonStyle, background: '#28a745', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
            💾 保存 ({exportFormat.toUpperCase()})
          </a>
        )}
      </div>
      
      {/* 隐藏的 Video */}
      <video ref={videoRef} src={videoSrc} style={{position: 'fixed', opacity: 0, pointerEvents: 'none'}} playsInline webkit-playsinline="true" crossOrigin="anonymous" />
    </div>
  );
}

export default App;