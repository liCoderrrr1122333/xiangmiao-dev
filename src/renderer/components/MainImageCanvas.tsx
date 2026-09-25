import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Circle, Eraser, Eye, Hand, LoaderCircle, Maximize, Move, RefreshCcw, ScanFace, Upload, ZoomIn, ZoomOut } from 'lucide-react';
import { useProjectStore } from '../state/projectStore';
import {
  clampCanvasOffset,
  fitImageInCanvas,
  zoomCanvasAtPoint,
  type CanvasPoint
} from '../utils/canvasViewport';
import { detectFaceLandmarkMask } from '../utils/faceLandmarkMask';
import { drawFaceOcclusion, fileToImageAsset, renderRedCircleImage } from '../utils/imageUtils';
import type { MaskCircle } from '../../shared/types';
import { IMAGE_IMPORT_ACCEPT } from '../../shared/imageImportPolicy';

export interface MainCanvasHandle {
  exportRedCircle: () => Promise<string>;
}

type ToolMode = 'pan' | 'draw' | 'circle';
type FaceOcclusionStatus = 'idle' | 'loading' | 'error';
type CanvasDrag =
  | { mode: 'pan'; startX: number; startY: number; originOffset: CanvasPoint }
  | { mode: 'draw' | 'move' | 'resize'; startX: number; startY: number; origin?: MaskCircle };

function isSameCircle(left: MaskCircle | undefined, right: MaskCircle | undefined) {
  return Boolean(
    left &&
      right &&
      left.x === right.x &&
      left.y === right.y &&
      left.width === right.width &&
      left.height === right.height
  );
}

interface Props {
  onReady: (handle: MainCanvasHandle) => void;
  onExportRedCircle: () => void;
}

export function MainImageCanvas({ onReady, onExportRedCircle }: Props) {
  const { project, setMainImage, updateProject } = useProjectStore();
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<CanvasDrag | null>(null);
  const faceOcclusionRequestRef = useRef(0);
  const viewOffsetRef = useRef<CanvasPoint>({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const [tool, setTool] = useState<ToolMode>('pan');
  const [zoom, setZoom] = useState(1);
  const [viewOffset, setViewOffset] = useState<CanvasPoint>({ x: 0, y: 0 });
  const [isFileDragging, setIsFileDragging] = useState(false);
  const [viewOnly, setViewOnly] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 680, height: 430 });
  const [faceOcclusionImage, setFaceOcclusionImage] = useState<HTMLImageElement>();
  const [faceOcclusionStatus, setFaceOcclusionStatus] = useState<{
    state: FaceOcclusionStatus;
    message: string;
  }>({ state: 'idle', message: '' });

  const circleStats = useMemo(() => {
    if (!project.maskCircle || !project.mainImage?.width || !project.mainImage.height) return null;
    const area = (project.maskCircle.width * project.maskCircle.height * Math.PI) / 4;
    const total = project.mainImage.width * project.mainImage.height;
    return Math.max(0.1, (area / total) * 100).toFixed(2);
  }, [project.mainImage, project.maskCircle]);

  async function handleFiles(files: FileList | File[]) {
    const file = files[0];
    if (!file) return;
    try {
      const asset = await fileToImageAsset(file);
      faceOcclusionRequestRef.current += 1;
      setFaceOcclusionStatus({ state: 'idle', message: '' });
      viewOffsetRef.current = { x: 0, y: 0 };
      zoomRef.current = 1;
      setViewOffset({ x: 0, y: 0 });
      setZoom(1);
      setTool('pan');
      setMainImage(asset);
    } catch (error) {
      alert(error instanceof Error ? error.message : '图片导入失败。');
    }
  }

  async function toggleFaceOcclusion() {
    if (!project.mainImage || !project.maskCircle) return;
    if (project.faceOcclusionEnabled) {
      updateProject({ faceOcclusionEnabled: false });
      setFaceOcclusionStatus({ state: 'idle', message: '' });
      return;
    }
    if (project.faceOcclusionMask?.raster && project.faceOcclusionMask.points.length) {
      updateProject({ faceOcclusionEnabled: true });
      setFaceOcclusionStatus({ state: 'idle', message: '' });
      setViewOnly(false);
      return;
    }

    const requestId = faceOcclusionRequestRef.current + 1;
    faceOcclusionRequestRef.current = requestId;
    const sourceImage = project.mainImage;
    const sourceCircle = project.maskCircle;
    setFaceOcclusionStatus({ state: 'loading', message: '正在识别红圈内的实际面部…' });
    setViewOnly(false);
    try {
      const result = await detectFaceLandmarkMask(sourceImage, sourceCircle);
      const currentProject = useProjectStore.getState().project;
      if (
        requestId !== faceOcclusionRequestRef.current ||
        currentProject.mainImage?.id !== sourceImage.id ||
        !isSameCircle(currentProject.maskCircle, sourceCircle)
      ) {
        return;
      }
      updateProject({ faceOcclusionMask: result.mask, faceOcclusionEnabled: true });
      setFaceOcclusionStatus({ state: 'idle', message: '' });
    } catch (error) {
      if (requestId !== faceOcclusionRequestRef.current) return;
      setFaceOcclusionStatus({
        state: 'error',
        message: error instanceof Error ? error.message : '未能识别实际面部，请调整红圈后重试。'
      });
    }
  }

  function imageToCanvas(pointX: number, pointY: number) {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !project.mainImage) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const fit = getFitRect();
    const canvasPoint = {
      x: ((pointX - rect.left) / rect.width) * canvas.width,
      y: ((pointY - rect.top) / rect.height) * canvas.height
    };
    const x = ((canvasPoint.x - fit.x) / fit.width) * project.mainImage.width!;
    const y = ((canvasPoint.y - fit.y) / fit.height) * project.mainImage.height!;
    return {
      x: Math.max(0, Math.min(project.mainImage.width!, x)),
      y: Math.max(0, Math.min(project.mainImage.height!, y))
    };
  }

  const getFitRect = useCallback(() => {
    const image = project.mainImage;
    const canvas = canvasRef.current;
    if (!image || !canvas || !image.width || !image.height) return { x: 0, y: 0, width: 1, height: 1 };
    return fitImageInCanvas(
      { width: canvas.width, height: canvas.height },
      { width: image.width, height: image.height },
      zoom,
      viewOffset
    );
  }, [project.mainImage, viewOffset, zoom]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const image = imageRef.current;
    const fit = getFitRect();
    if (image && project.mainImage) {
      ctx.drawImage(image, fit.x, fit.y, fit.width, fit.height);
    } else {
      ctx.fillStyle = '#7e88a1';
      ctx.font = '16px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('拖入、粘贴或点击上传主垫图', canvas.width / 2, canvas.height / 2);
    }

    if (project.maskCircle && project.mainImage && !viewOnly) {
      const c = project.maskCircle;
      const sx = fit.x + (c.x / project.mainImage.width!) * fit.width;
      const sy = fit.y + (c.y / project.mainImage.height!) * fit.height;
      const sw = (c.width / project.mainImage.width!) * fit.width;
      const sh = (c.height / project.mainImage.height!) * fit.height;
      if (project.faceOcclusionEnabled && project.faceOcclusionMask?.raster && faceOcclusionImage) {
        const raster = project.faceOcclusionMask.raster;
        drawFaceOcclusion(
          ctx,
          { x: sx, y: sy, width: sw, height: sh },
          {
            points: project.faceOcclusionMask.points,
            raster: {
              dataUrl: raster.dataUrl,
              x: fit.x + (raster.x / project.mainImage.width!) * fit.width,
              y: fit.y + (raster.y / project.mainImage.height!) * fit.height,
              width: (raster.width / project.mainImage.width!) * fit.width,
              height: (raster.height / project.mainImage.height!) * fit.height
            }
          },
          faceOcclusionImage
        );
      }
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(sx, sy, sw / 2, sh / 2, 0, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff2d2d';
      ctx.lineWidth = 3;
      ctx.shadowColor = 'rgba(255,45,45,0.85)';
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.restore();
    }
  }, [
    getFitRect,
    project.faceOcclusionEnabled,
    project.faceOcclusionMask,
    project.mainImage,
    project.maskCircle,
    faceOcclusionImage,
    viewOnly
  ]);

  function startPointer(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!project.mainImage) return;
    if (tool === 'pan') {
      const rect = event.currentTarget.getBoundingClientRect();
      dragRef.current = {
        mode: 'pan',
        startX: ((event.clientX - rect.left) / rect.width) * event.currentTarget.width,
        startY: ((event.clientY - rect.top) / rect.height) * event.currentTarget.height,
        originOffset: viewOffsetRef.current
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const p = imageToCanvas(event.clientX, event.clientY);
    faceOcclusionRequestRef.current += 1;
    setFaceOcclusionStatus({ state: 'idle', message: '' });
    if (tool === 'circle' && project.maskCircle) {
      const c = project.maskCircle;
      const nearCorner = Math.abs(p.x - (c.x + c.width / 2)) < c.width * 0.12 && Math.abs(p.y - (c.y + c.height / 2)) < c.height * 0.12;
      dragRef.current = { mode: nearCorner ? 'resize' : 'move', startX: p.x, startY: p.y, origin: c };
    } else {
      dragRef.current = { mode: 'draw', startX: p.x, startY: p.y };
      updateProject({
        maskCircle: { x: p.x, y: p.y, width: 8, height: 8 },
        faceOcclusionEnabled: false,
        faceOcclusionMask: undefined
      });
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePointer(event: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag || !project.mainImage) return;
    if (drag.mode === 'pan') {
      const canvas = event.currentTarget;
      const rect = canvas.getBoundingClientRect();
      const point = {
        x: ((event.clientX - rect.left) / rect.width) * canvas.width,
        y: ((event.clientY - rect.top) / rect.height) * canvas.height
      };
      const nextOffset = clampCanvasOffset(
        {
          x: drag.originOffset.x + point.x - drag.startX,
          y: drag.originOffset.y + point.y - drag.startY
        },
        { width: canvas.width, height: canvas.height },
        { width: project.mainImage.width!, height: project.mainImage.height! },
        zoom
      );
      viewOffsetRef.current = nextOffset;
      setViewOffset(nextOffset);
      return;
    }
    const p = imageToCanvas(event.clientX, event.clientY);
    if (drag.mode === 'draw') {
      updateProject({
        maskCircle: {
          x: (drag.startX + p.x) / 2,
          y: (drag.startY + p.y) / 2,
          width: Math.abs(p.x - drag.startX),
          height: Math.abs(p.y - drag.startY)
        },
        faceOcclusionEnabled: false,
        faceOcclusionMask: undefined
      });
      return;
    }
    if (!drag.origin) return;
    const dx = p.x - drag.startX;
    const dy = p.y - drag.startY;
    if (drag.mode === 'move') {
      const width = Math.min(drag.origin.width, project.mainImage.width!);
      const height = Math.min(drag.origin.height, project.mainImage.height!);
      updateProject({
        maskCircle: {
          ...drag.origin,
          width,
          height,
          x: Math.max(width / 2, Math.min(project.mainImage.width! - width / 2, drag.origin.x + dx)),
          y: Math.max(height / 2, Math.min(project.mainImage.height! - height / 2, drag.origin.y + dy))
        },
        faceOcclusionEnabled: false,
        faceOcclusionMask: undefined
      });
    } else {
      const width = Math.max(Math.min(20, project.mainImage.width!), Math.min(project.mainImage.width!, drag.origin.width + dx * 2));
      const height = Math.max(Math.min(20, project.mainImage.height!), Math.min(project.mainImage.height!, drag.origin.height + dy * 2));
      updateProject({
        maskCircle: {
          ...drag.origin,
          x: Math.max(width / 2, Math.min(project.mainImage.width! - width / 2, drag.origin.x)),
          y: Math.max(height / 2, Math.min(project.mainImage.height! - height / 2, drag.origin.y)),
          width,
          height
        },
        faceOcclusionEnabled: false,
        faceOcclusionMask: undefined
      });
    }
  }

  function endPointer() {
    dragRef.current = null;
  }

  function handleCanvasKeyDown(event: React.KeyboardEvent<HTMLCanvasElement>) {
    if (!project.mainImage && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      document.querySelector<HTMLInputElement>('#main-upload-input')?.click();
      return;
    }
    if (!project.mainImage || !event.key.startsWith('Arrow')) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 2;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    if (tool === 'pan') {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const nextOffset = clampCanvasOffset(
        { x: viewOffsetRef.current.x + dx, y: viewOffsetRef.current.y + dy },
        { width: canvas.width, height: canvas.height },
        { width: project.mainImage.width!, height: project.mainImage.height! },
        zoom
      );
      viewOffsetRef.current = nextOffset;
      setViewOffset(nextOffset);
      return;
    }
    if (!project.maskCircle) return;
    const circle = project.maskCircle;
    updateProject({
      maskCircle: {
        ...circle,
        x: Math.max(circle.width / 2, Math.min(project.mainImage.width! - circle.width / 2, circle.x + dx)),
        y: Math.max(circle.height / 2, Math.min(project.mainImage.height! - circle.height / 2, circle.y + dy))
      },
      faceOcclusionEnabled: false,
      faceOcclusionMask: undefined
    });
  }

  const updateZoom = useCallback((nextZoom: number, anchor?: CanvasPoint) => {
    const canvas = canvasRef.current;
    const image = project.mainImage;
    if (!canvas || !image?.width || !image.height) return;
    const result = zoomCanvasAtPoint(
      anchor || { x: canvas.width / 2, y: canvas.height / 2 },
      { width: canvas.width, height: canvas.height },
      { width: image.width, height: image.height },
      zoomRef.current,
      nextZoom,
      viewOffsetRef.current
    );
    viewOffsetRef.current = result.offset;
    zoomRef.current = result.zoom;
    setViewOffset(result.offset);
    setZoom(result.zoom);
  }, [project.mainImage]);

  useEffect(() => {
    const canvasViewport = canvasWrapRef.current;
    const canvas = canvasRef.current;
    if (!canvasViewport || !canvas) return;

    const handleCanvasWheel = (event: WheelEvent) => {
      if (!project.mainImage) return;
      event.preventDefault();
      event.stopPropagation();

      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const deltaMultiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? Math.max(320, rect.height)
          : 1;
      const normalizedDelta = Math.max(-240, Math.min(240, event.deltaY * deltaMultiplier));
      if (!Number.isFinite(normalizedDelta) || normalizedDelta === 0) return;
      const zoomFactor = Math.exp(-normalizedDelta * 0.0016);

      updateZoom(zoomRef.current * zoomFactor, {
        x: Math.max(0, Math.min(canvas.width, ((event.clientX - rect.left) / rect.width) * canvas.width)),
        y: Math.max(0, Math.min(canvas.height, ((event.clientY - rect.top) / rect.height) * canvas.height))
      });
    };

    canvasViewport.addEventListener('wheel', handleCanvasWheel, { passive: false, capture: true });
    return () => canvasViewport.removeEventListener('wheel', handleCanvasWheel, true);
  }, [project.mainImage, updateZoom]);

  useLayoutEffect(() => {
    const canvasWrap = canvasWrapRef.current;
    if (!canvasWrap) return;
    let animationFrame = 0;

    const measure = () => {
      animationFrame = 0;
      const style = window.getComputedStyle(canvasWrap);
      const horizontalPadding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
      const verticalPadding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
      const width = Math.floor(canvasWrap.clientWidth - horizontalPadding);
      const height = Math.floor(canvasWrap.clientHeight - verticalPadding);
      if (width < 2 || height < 2) return;
      setCanvasSize((current) =>
        current.width === width && current.height === height ? current : { width, height }
      );
    };
    const scheduleMeasure = () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(measure);
    };
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(scheduleMeasure);

    observer?.observe(canvasWrap);
    window.addEventListener('resize', scheduleMeasure);
    scheduleMeasure();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
      if (animationFrame) cancelAnimationFrame(animationFrame);
    };
  }, []);

  useEffect(() => {
    if (!project.mainImage) {
      imageRef.current = null;
      draw();
      return;
    }
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      draw();
    };
    img.src = project.mainImage.dataUrl;
  }, [draw, project.mainImage]);

  useEffect(() => {
    const dataUrl = project.faceOcclusionMask?.raster?.dataUrl;
    if (!dataUrl) {
      setFaceOcclusionImage(undefined);
      return;
    }
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (active) setFaceOcclusionImage(image);
    };
    image.onerror = () => {
      if (active) {
        setFaceOcclusionImage(undefined);
        setFaceOcclusionStatus({ state: 'error', message: '精确面部蒙版加载失败，请重新点击一键蒙脸。' });
      }
    };
    image.src = dataUrl;
    return () => {
      active = false;
    };
  }, [project.faceOcclusionMask?.raster?.dataUrl]);

  useEffect(() => {
    draw();
  }, [canvasSize, draw]);

  useEffect(() => {
    onReady({
      exportRedCircle: async () => {
        if (!project.mainImage || !project.maskCircle) throw new Error('缺少主图或红圈。');
        return renderRedCircleImage(
          project.mainImage,
          project.maskCircle,
          project.faceOcclusionEnabled ? project.faceOcclusionMask : undefined
        );
      }
    });
  }, [onReady, project.faceOcclusionEnabled, project.faceOcclusionMask, project.mainImage, project.maskCircle]);

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const imageFile = [...(event.clipboardData?.files || [])].find((file) => file.type.startsWith('image/'));
      if (imageFile) handleFiles([imageFile]);
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  });

  return (
    <section
      className={`panel main-canvas-panel ${project.mainImage ? 'has-main-image' : 'is-empty'} ${project.maskCircle ? 'has-mask-circle' : ''}`}
    >
      <div className="panel-head minimal-panel-head">
        <h3 className="section-title">
          <span className="section-copy">
            <b>原图画布</b>
          </span>
        </h3>
        <div className="tool-strip">
          <input id="main-upload-input" hidden type="file" accept={IMAGE_IMPORT_ACCEPT} onChange={(e) => e.target.files && handleFiles(e.target.files)} />
          <div className="tool-group" aria-label="导入">
            <button onClick={() => document.querySelector<HTMLInputElement>('#main-upload-input')?.click()} title="上传主图" aria-label="上传主图">
              <Upload />
            </button>
          </div>
          <div className="tool-group" aria-label="蒙脸">
            <button
              className={project.faceOcclusionEnabled ? 'active' : ''}
              disabled={!project.mainImage || !project.maskCircle || faceOcclusionStatus.state === 'loading'}
              onClick={() => void toggleFaceOcclusion()}
              title={
                !project.mainImage || !project.maskCircle
                  ? '请先上传主图并用红圈标记人脸'
                  : project.faceOcclusionEnabled
                    ? '取消蒙脸，恢复红圈内原图'
                    : '一键蒙脸（可选）：红圈用于选脸，仅用纯色遮挡识别出的实际面部'
              }
              aria-label="一键蒙脸"
              aria-pressed={project.faceOcclusionEnabled}
              aria-busy={faceOcclusionStatus.state === 'loading'}
            >
              {faceOcclusionStatus.state === 'loading' ? <LoaderCircle className="spin" /> : <ScanFace />}
            </button>
          </div>
          <div className="tool-group" aria-label="红圈工具">
            <button className={tool === 'pan' ? 'active' : ''} onClick={() => setTool('pan')} title="拖动画布" aria-label="拖动画布">
              <Hand />
            </button>
            <button className={tool === 'draw' ? 'active' : ''} onClick={() => setTool('draw')} title="绘制红圈" aria-label="绘制红圈">
              <Circle />
            </button>
            <button className={tool === 'circle' ? 'active' : ''} onClick={() => setTool('circle')} title="移动/缩放红圈" aria-label="移动或缩放红圈">
              <Move />
            </button>
            <button
              onClick={() => {
                faceOcclusionRequestRef.current += 1;
                setFaceOcclusionStatus({ state: 'idle', message: '' });
                updateProject({
                  maskCircle: undefined,
                  faceOcclusionEnabled: false,
                  faceOcclusionMask: undefined
                });
              }}
              title="清除红圈"
              aria-label="清除红圈"
            >
              <Eraser />
            </button>
          </div>
          <div className="tool-group" aria-label="视图">
            <button onClick={() => updateZoom(zoomRef.current + 0.1)} title="放大" aria-label="放大画布">
              <ZoomIn />
            </button>
            <button onClick={() => updateZoom(zoomRef.current - 0.1)} title="缩小" aria-label="缩小画布">
              <ZoomOut />
            </button>
            <button
              onClick={() => {
                viewOffsetRef.current = { x: 0, y: 0 };
                zoomRef.current = 1;
                setViewOffset({ x: 0, y: 0 });
                setZoom(1);
              }}
              title="重置视图"
              aria-label="重置画布视图"
            >
              <RefreshCcw />
            </button>
            <button onClick={() => setViewOnly((v) => !v)} title="查看原图/红圈图" aria-label="切换原图和标注视图">
              <Eye />
            </button>
          </div>
          <div className="tool-group" aria-label="导出">
            <button onClick={onExportRedCircle} title="导出带红圈预览图" aria-label="导出带红圈预览图">
              <Maximize />
            </button>
          </div>
        </div>
      </div>
      <div
        ref={canvasWrapRef}
        className={`canvas-wrap ${isFileDragging ? 'is-file-dragging' : ''}`}
        onDrop={(e) => {
          e.preventDefault();
          setIsFileDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          setIsFileDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsFileDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsFileDragging(false);
        }}
      >
        <canvas
          ref={canvasRef}
          width={canvasSize.width}
          height={canvasSize.height}
          tabIndex={0}
          role="application"
          aria-label={project.mainImage ? '主图红圈编辑画布，可使用方向键移动红圈，按住 Shift 可加速移动' : '主图上传画布，按回车或空格选择图片'}
          data-tool={tool}
          onPointerDown={startPointer}
          onPointerMove={movePointer}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onClick={() => {
            if (!project.mainImage) document.querySelector<HTMLInputElement>('#main-upload-input')?.click();
          }}
          onKeyDown={handleCanvasKeyDown}
        />
        {faceOcclusionStatus.state !== 'idle' && (
          <div
            className={`canvas-feedback ${faceOcclusionStatus.state}`}
            role="status"
            aria-live={faceOcclusionStatus.state === 'error' ? 'assertive' : 'polite'}
            title={faceOcclusionStatus.message}
          >
            {faceOcclusionStatus.state === 'loading' && <LoaderCircle className="spin" />}
            <span>{faceOcclusionStatus.message}</span>
          </div>
        )}
      </div>
      <div className="circle-data">
        {project.maskCircle ? (
          <>
            <span>中心 x: {Math.round(project.maskCircle.x)}</span>
            <span>中心 y: {Math.round(project.maskCircle.y)}</span>
            <span>宽度: {Math.round(project.maskCircle.width)}</span>
            <span>高度: {Math.round(project.maskCircle.height)}</span>
            <span>覆盖范围: {circleStats}%</span>
            <span className="badge ok">已标记完整面部区域</span>
            {project.faceOcclusionEnabled && <span className="badge ok">仅实际面部蒙脸已开启</span>}
          </>
        ) : (
          <span className="badge danger">请先在主图中用红圈标记唯一允许编辑的人脸区域。</span>
        )}
      </div>
      <div className="canvas-status-strip" role="status" aria-live="polite">
        <span>{project.mainImage ? `${project.mainImage.width || 0} × ${project.mainImage.height || 0}` : '尚未上传主图'}</span>
        <span>缩放 {Math.round(zoom * 100)}%</span>
        <span>{project.maskCircle ? '红圈已锁定' : '需要绘制红圈'}</span>
        <span>{viewOnly ? '原图视图' : '标注视图'}</span>
      </div>
    </section>
  );
}
