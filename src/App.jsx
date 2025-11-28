import React, { useState, useRef, useEffect } from 'react';
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';

const containerStyle = { maxWidth: '600px', margin: '0 auto', padding: '20px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' };
const buttonStyle = { padding: '12px 24px', margin: '5px', background: '#007bff', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' };
const inputStyle = { padding: '10px', borderRadius: '8px', border: '1px solid #ccc', width: '100%', boxSizing: 'border-box', fontSize: '16px' };

function App() {
  const [fileExt, setFileExt] = useState("webm"); 
  const [detector, setDetector] = useState(null);
  const [videoSrc, setVideoSrc] = useState(null);
  
  // 🔥 新增：遮挡模式状态 ('image' 或 'emoji')
  const [maskMode, setMaskMode] = useState('emoji'); 
  const [maskSrc, setMaskSrc] = useState(null); // 图片源
  const [emojiChar, setEmojiChar] = useState('😎'); // Emoji 字符

  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState("正在加载 AI 模型...");
  const [downloadUrl, setDownloadUrl] = useState(null);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const maskImgRef = useRef(null);
  const chunksRef = useRef([]);
  const lastFaceRef = useRef(null);
  const velocityRef = useRef({ x: 0, y: 0 });

  // 🔥 新增：使用 Ref 来在循环中读取最新的 Emoji 和模式，防止闭包问题
  const emojiRef = useRef('😎');
  const maskModeRef = useRef('emoji');

  const audioCtxRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const destNodeRef = useRef(null);
  const initLockRef = useRef(false);

  useEffect(() => {
    if (initLockRef.current === true) return;
    initLockRef.current = true;

    const initAI = async () => {
      console.log("🚀 开始初始化 AI 模型...");
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

  // 更新 Ref 当状态改变时
  useEffect(() => {
    emojiRef.current = emojiChar;
    maskModeRef.current = maskMode;
  }, [emojiChar, maskMode]);

  const handleVideoUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setVideoSrc(URL.createObjectURL(file));
      setDownloadUrl(null);
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
    // 检查逻辑：如果是图片模式，必须有图片；如果是 Emoji 模式，不需要图片
    if (!detector || !videoRef.current) {
      alert("请确保视频和AI模型已就绪");
      return;
    }
    if (maskMode === 'image' && !maskImgRef.current) {
        alert("请先上传遮挡图片");
        return;
    }

    const video = videoRef.current;
    if (video.readyState < 2) {
        setStatus("正在缓冲视频...");
        await new Promise(resolve => {
            video.onloadeddata = resolve;
            setTimeout(resolve, 1500); 
        });
    }

    setIsProcessing(true);
    setStatus("正在初始化...");
    setDownloadUrl(null);
    chunksRef.current = [];
    lastFaceRef.current = null;
    velocityRef.current = { x: 0, y: 0 };

    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');

    // === 音频处理 ===
    try {
        if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
        const audioCtx = audioCtxRef.current;
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        if (sourceNodeRef.current) try { sourceNodeRef.current.disconnect(); } catch(e){}
        sourceNodeRef.current = audioCtx.createMediaElementSource(video);
        if (!destNodeRef.current) destNodeRef.current = audioCtx.createMediaStreamDestination();
        sourceNodeRef.current.connect(destNodeRef.current);
    } catch (e) { console.warn("音频警告:", e); }

    const canvasStream = canvas.captureStream(30); 
    if (destNodeRef.current) {
        const audioTrack = destNodeRef.current.stream.getAudioTracks()[0];
        if (audioTrack) canvasStream.addTrack(audioTrack);
    }

    // 格式选择
    const options = [
        { mimeType: 'video/webm; codecs=vp9', ext: 'webm' },
        { mimeType: 'video/webm', ext: 'webm' },
        { mimeType: 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"', ext: 'mp4' },
        { mimeType: 'video/mp4', ext: 'mp4' }
    ];
    let selectedOption = options.find(opt => MediaRecorder.isTypeSupported(opt.mimeType)) || { mimeType: '', ext: 'webm' };
    setFileExt(selectedOption.ext);

    let recorder;
    try {
        recorder = new MediaRecorder(canvasStream, { mimeType: selectedOption.mimeType, videoBitsPerSecond: 2500000 });
    } catch (e) { recorder = new MediaRecorder(canvasStream); }
    
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: selectedOption.mimeType || 'video/webm' });
      if (blob.size === 0) { alert("生成失败：文件大小为0"); setIsProcessing(false); return; }
      setDownloadUrl(URL.createObjectURL(blob));
      setIsProcessing(false);
      setStatus("✅ 处理完成！");
      video.pause(); video.muted = false;
      canvasStream.getTracks().forEach(track => track.stop());
    };

    recorder.start(100); 
    
    try {
        video.currentTime = 0; video.muted = false; 
        await video.play();
        processFrame(video, ctx, recorder);
    } catch (e) {
        console.error("播放失败:", e);
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
    let detections = null;
    try { if (detector) detections = detector.detectForVideo(video, startTimeMs).detections; } catch(e) {}

    let targetFace = null;

    if (detections && detections.length > 0) {
      const face = detections[0].boundingBox;
      if (lastFaceRef.current) {
         velocityRef.current = { x: face.originX - lastFaceRef.current.originX, y: face.originY - lastFaceRef.current.originY };
      }
      targetFace = face;
      lastFaceRef.current = face;
    } else if (lastFaceRef.current) {
      const vx = velocityRef.current.x * 0.9;
      const vy = velocityRef.current.y * 0.9;
      const predictedFace = { ...lastFaceRef.current, originX: lastFaceRef.current.originX + vx, originY: lastFaceRef.current.originY + vy };
      velocityRef.current = { x: vx, y: vy };
      targetFace = predictedFace;
      lastFaceRef.current = predictedFace; 
    }

    // 🔥 核心修改：根据模式绘制
    if (targetFace) {
      const { originX, originY, width, height } = targetFace;
      const currentMode = maskModeRef.current;
      const scale = 1.5; 

      if (currentMode === 'image' && maskImgRef.current) {
          // 图片绘制逻辑 (保持不变)
          const w = width * scale;
          const h = height * scale;
          const x = originX - (w - width) / 2;
          const y = originY - (h - height) / 2;
          ctx.drawImage(maskImgRef.current, x, y, w, h);
      } else if (currentMode === 'emoji') {
          // 🔥 Emoji 绘制逻辑
          const currentEmoji = emojiRef.current;
          
          // 1. 设置字体：大小跟随人脸高度变化
          // 为了让 Emoji 覆盖住脸，字体大小设为人脸最大边长的 1.5 倍
          const fontSize = Math.max(width, height) * scale;
          
          // 2. 关键：指定 "Apple Color Emoji" 确保 iOS 上显示为彩色原生 Emoji
          ctx.font = `${fontSize}px "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", sans-serif`;
          
          // 3. 对齐方式：居中
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          
          // 4. 计算中心点
          const centerX = originX + width / 2;
          const centerY = originY + height / 2;
          
          // 5. 绘制文字 (Emoji 稍微往下一点点通常视觉上更居中，所以 + height*0.1)
          ctx.fillText(currentEmoji, centerX, centerY + (height * 0.1));
      }
    }

    requestAnimationFrame(() => processFrame(video, ctx, recorder));
  };

  return (
    <div style={containerStyle}>
      <h2 style={{textAlign: 'center'}}>保护豆私 (Emoji 版)</h2>
      <p style={{textAlign: 'center', color: isProcessing ? '#d9534f' : '#666', fontWeight: isProcessing ? 'bold' : 'normal'}}>
        {status}
      </p>

      <div style={{background: '#f8f9fa', padding: '15px', borderRadius: '10px', marginBottom: '20px', boxShadow: '0 2px 5px rgba(0,0,0,0.05)'}}>
        <div style={{marginBottom: '15px'}}>
            <label style={{display: 'block', fontWeight: 'bold', marginBottom: '8px'}}>1. 导入视频 📹</label>
            <input type="file" accept="video/*" onChange={handleVideoUpload} style={inputStyle} />
        </div>
        
        <div style={{marginBottom: '10px'}}>
            <label style={{display: 'block', fontWeight: 'bold', marginBottom: '8px'}}>2. 选择遮挡方式 🎭</label>
            <div style={{display: 'flex', gap: '20px', marginBottom: '10px'}}>
                <label style={{cursor: 'pointer', display: 'flex', alignItems: 'center'}}>
                    <input 
                        type="radio" 
                        name="maskMode" 
                        value="emoji" 
                        checked={maskMode === 'emoji'} 
                        onChange={(e) => setMaskMode(e.target.value)}
                        style={{marginRight: '5px'}}
                    />
                    使用 Emoji (推荐 ✨)
                </label>
                <label style={{cursor: 'pointer', display: 'flex', alignItems: 'center'}}>
                    <input 
                        type="radio" 
                        name="maskMode" 
                        value="image" 
                        checked={maskMode === 'image'} 
                        onChange={(e) => setMaskMode(e.target.value)}
                        style={{marginRight: '5px'}}
                    />
                    上传图片
                </label>
            </div>

            {/* 根据选择显示不同的输入框 */}
            {maskMode === 'emoji' ? (
                <div>
                    <input 
                        type="text" 
                        value={emojiChar}
                        placeholder="在此输入 Emoji，例如 🎃" 
                        onChange={(e) => setEmojiChar(e.target.value)}
                        maxLength={5} // 防止输入太长
                        style={{
                            ...inputStyle, 
                            fontSize: '32px', 
                            textAlign: 'center', 
                            letterSpacing: '5px'
                        }}
                    />
                    <p style={{fontSize: '12px', color: '#666', marginTop: '5px'}}>
                        提示：在手机上点击输入框，使用键盘自带的表情输入法即可。
                    </p>
                </div>
            ) : (
                <input type="file" accept="image/*" onChange={handleMaskUpload} style={inputStyle} />
            )}
        </div>
      </div>

      <video 
        ref={videoRef} 
        src={videoSrc} 
        style={{ position: 'fixed', top: 0, left: 0, opacity: 0, pointerEvents: 'none', zIndex: -1, width: '1px', height: '1px' }} 
        playsInline 
        webkit-playsinline="true"
        crossOrigin="anonymous"
      />

      <div style={{ 
          border: '2px solid #333', 
          borderRadius: '8px',
          background: '#000', 
          minHeight: '200px', 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center',
          overflow: 'hidden',
          marginBottom: '20px'
      }}>
        <canvas ref={canvasRef} style={{ maxWidth: '100%', maxHeight: '60vh', display: 'block' }} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: '15px', flexWrap: 'wrap' }}>
        <button 
          style={{...buttonStyle, opacity: (isProcessing || !videoSrc) ? 0.6 : 1, width: '100%'}} 
          onClick={startProcessing} 
          disabled={isProcessing || !videoSrc}
        >
          {isProcessing ? '⏳ 处理中...' : '🚀 开始生成'}
        </button>

        {downloadUrl && (
          <a 
            href={downloadUrl} 
            download={`masked_video_${Date.now()}.${fileExt}`}
            style={{...buttonStyle, background: '#28a745', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%'}}
          >
            💾 保存到相册 ({fileExt.toUpperCase()})
          </a>
        )}
      </div>
    </div>
  );
}

export default App;