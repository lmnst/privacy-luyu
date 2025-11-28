import React, { useState, useRef, useEffect } from 'react';
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';

const containerStyle = { maxWidth: '600px', margin: '0 auto', padding: '20px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' };
const buttonStyle = { padding: '12px 24px', margin: '5px', background: '#007bff', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' };

function App() {
  const [fileExt, setFileExt] = useState("webm"); 
  const [detector, setDetector] = useState(null);
  const [videoSrc, setVideoSrc] = useState(null);
  const [maskSrc, setMaskSrc] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState("正在加载 AI 模型...");
  const [downloadUrl, setDownloadUrl] = useState(null);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const maskImgRef = useRef(null);
  const chunksRef = useRef([]);
  const lastFaceRef = useRef(null);
  
  // 🔥 新增：记录人脸移动速度，用于预测
  const velocityRef = useRef({ x: 0, y: 0 });

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
          // 🔥 降低门槛：让模糊的脸也能被识别到
          minDetectionConfidence: 0.3, 
          minSuppressionThreshold: 0.3 
        });
        
        setDetector(faceDetector);
        setStatus("✅ AI 就绪！请导入视频");
      } catch (err) {
        setStatus(`❌ 模型加载失败: ${err.message}`);
        console.error(err);
      }
    };
    initAI();
  }, []);

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
    if (!detector || !videoRef.current || !maskImgRef.current) {
      alert("请确保视频、遮挡图和AI模型都已就绪");
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
    velocityRef.current = { x: 0, y: 0 }; // 重置速度

    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');

    // === 音频处理 ===
    try {
        if (!audioCtxRef.current) {
            audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
        }
        const audioCtx = audioCtxRef.current;
        if (audioCtx.state === 'suspended') await audioCtx.resume();

        if (sourceNodeRef.current) {
            try { sourceNodeRef.current.disconnect(); } catch(e){}
        }
        sourceNodeRef.current = audioCtx.createMediaElementSource(video);
        if (!destNodeRef.current) destNodeRef.current = audioCtx.createMediaStreamDestination();
        sourceNodeRef.current.connect(destNodeRef.current);
    } catch (e) {
        console.warn("音频初始化警告:", e);
    }

    // === 混合流 ===
    const canvasStream = canvas.captureStream(30); 
    if (destNodeRef.current) {
        const audioTrack = destNodeRef.current.stream.getAudioTracks()[0];
        if (audioTrack) canvasStream.addTrack(audioTrack);
    }

    // === 格式选择 ===
    const options = [
        { mimeType: 'video/webm; codecs=vp9', ext: 'webm' },
        { mimeType: 'video/webm', ext: 'webm' },
        { mimeType: 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"', ext: 'mp4' },
        { mimeType: 'video/mp4', ext: 'mp4' }
    ];

    let selectedOption = options.find(opt => MediaRecorder.isTypeSupported(opt.mimeType));
    
    if (!selectedOption) {
        selectedOption = { mimeType: '', ext: 'webm' };
    }

    setFileExt(selectedOption.ext);

    let recorder;
    try {
        recorder = new MediaRecorder(canvasStream, { 
            mimeType: selectedOption.mimeType,
            videoBitsPerSecond: 2500000 
        });
    } catch (e) {
        recorder = new MediaRecorder(canvasStream);
    }
    
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: selectedOption.mimeType || 'video/webm' });
      
      if (blob.size === 0) {
          alert("生成失败：文件大小为0。");
          setIsProcessing(false);
          return;
      }

      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);
      setIsProcessing(false);
      setStatus("✅ 处理完成！");
      
      video.pause();
      video.muted = false;
      canvasStream.getTracks().forEach(track => track.stop());
    };

    recorder.start(100); 
    
    try {
        video.currentTime = 0;
        video.muted = false; 
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
    try {
        if (detector) {
            detections = detector.detectForVideo(video, startTimeMs).detections;
        }
    } catch(e) { console.error(e); }

    let targetFace = null;

    if (detections && detections.length > 0) {
      // 1. 成功检测到人脸
      const face = detections[0].boundingBox;
      
      // 🔥 计算移动速度 (惯性)
      if (lastFaceRef.current) {
         const vx = face.originX - lastFaceRef.current.originX;
         const vy = face.originY - lastFaceRef.current.originY;
         // 更新速度
         velocityRef.current = { x: vx, y: vy };
      }
      
      targetFace = face;
      lastFaceRef.current = face;

    } else if (lastFaceRef.current) {
      // 2. 跟丢了！启动“惯性预测”模式
      // 不再只是停留在原地，而是根据最后的速度继续“飞”
      const vx = velocityRef.current.x;
      const vy = velocityRef.current.y;
      
      const predictedFace = {
          ...lastFaceRef.current,
          originX: lastFaceRef.current.originX + vx,
          originY: lastFaceRef.current.originY + vy,
          width: lastFaceRef.current.width,
          height: lastFaceRef.current.height
      };
      
      // 慢慢减速（摩擦力），防止预测过头飞出屏幕
      velocityRef.current = { x: vx * 0.9, y: vy * 0.9 };
      
      targetFace = predictedFace;
      // 更新位置，这样下一帧如果还丢了，就会基于这个预测位置继续飞
      lastFaceRef.current = predictedFace; 
    }

    if (targetFace && maskImgRef.current) {
      const { originX, originY, width, height } = targetFace;
      
      // 🔥 扩大遮挡范围：从 1.3 倍增加到 1.5 倍，宁可多遮不能漏
      const scale = 1.5; 
      const w = width * scale;
      const h = height * scale;
      const x = originX - (w - width) / 2;
      const y = originY - (h - height) / 2;
      
      ctx.drawImage(maskImgRef.current, x, y, w, h);
    }

    requestAnimationFrame(() => processFrame(video, ctx, recorder));
  };

  return (
    <div style={containerStyle}>
      <h2 style={{textAlign: 'center'}}>保护豆私(强力追踪版)</h2>
      <p style={{textAlign: 'center', color: isProcessing ? '#d9534f' : '#666', fontWeight: isProcessing ? 'bold' : 'normal'}}>
        {status}
      </p>

      <div style={{background: '#f8f9fa', padding: '15px', borderRadius: '10px', marginBottom: '20px', boxShadow: '0 2px 5px rgba(0,0,0,0.05)'}}>
        <div style={{marginBottom: '15px'}}>
            <label style={{display: 'block', fontWeight: 'bold', marginBottom: '8px'}}>1. 导入视频 📹</label>
            <input type="file" accept="video/*" onChange={handleVideoUpload} style={{width: '100%'}} />
        </div>
        
        <div>
            <label style={{display: 'block', fontWeight: 'bold', marginBottom: '8px'}}>2. 导入遮挡表情 🎃</label>
            <input type="file" accept="image/*" onChange={handleMaskUpload} style={{width: '100%'}} />
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
          {isProcessing ? '⏳ 处理中 (AI正在玩命追踪)...' : '🚀 开始生成'}
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