import { useEffect, useRef, useState } from 'react';
import { Camera, Check, ChevronDown, Download, KeyRound, Layers3, LoaderCircle, PersonStanding, ScanFace, ShieldAlert, Sparkles, SunMedium } from 'lucide-react';
import { useProjectStore } from '../state/projectStore';
import { useSettingsStore } from '../state/settingsStore';
import { createAnalysisImage } from '../utils/imageUtils';
import {
  DOUBAO_ANALYSIS_BASE_URL,
  DOUBAO_ANALYSIS_MODEL,
  DOUBAO_ANALYSIS_MODELS,
  analysisProviderLabel,
  analysisRouteSummary,
  normalizeAnalysisProvider,
  normalizeDoubaoAnalysisModel,
  type AnalysisProvider
} from '../../shared/analysisProviderPolicy';
import type { GenerationProvider } from '../../shared/generationProviderPolicy';
import type { LocalAnalysisModelStatus, RelayApiStatus } from '../../shared/types';

const sliderLabels = [
  ['identitySimilarity', '身份相似度'],
  ['blendNaturalness', '融合自然度'],
  ['originalPreservation', '原图保持度'],
  ['skinRealism', '皮肤真实感'],
  ['makeupRestoration', '妆容还原度'],
  ['outsideProtection', '红圈外保护强度']
] as const;

const lockedOptions = [
  '不改变红圈外背景',
  '不改变衣服',
  '不改变身体姿势',
  '不改变手部',
  '不改变道具',
  '不改变构图',
  '不改变镜头焦距',
  '不改变图片比例',
  '不改变整体画质',
  '不改变原图光影环境',
  '不改变红圈外任何人物或物体'
];

interface DescriptionPanelProps {
  generationProvider: GenerationProvider;
  isGenerating: boolean;
  relayStatus: RelayApiStatus | null;
  includeOriginalUnderstanding: boolean;
  onGenerationProviderChange: (provider: GenerationProvider) => void;
  onOriginalUnderstandingChange: (enabled: boolean) => void;
  onOpenApiConfig: () => void;
}

export function DescriptionPanel({
  generationProvider,
  isGenerating,
  relayStatus,
  includeOriginalUnderstanding,
  onGenerationProviderChange,
  onOriginalUnderstandingChange,
  onOpenApiConfig
}: DescriptionPanelProps) {
  const { project, updateProject, updateProjectForMainImage } = useProjectStore();
  const { settings, setSettings } = useSettingsStore();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState('');
  const [analysisStatusLevel, setAnalysisStatusLevel] = useState<'done' | 'warning' | 'error'>('done');
  const [isPoseAnalyzing, setIsPoseAnalyzing] = useState(false);
  const [poseStatus, setPoseStatus] = useState('');
  const [poseStatusLevel, setPoseStatusLevel] = useState<'done' | 'warning' | 'error'>('done');
  const [posePickerOpen, setPosePickerOpen] = useState(false);
  const [routeOpen, setRouteOpen] = useState(true);
  const [analysisDetailsOpen, setAnalysisDetailsOpen] = useState(generationProvider !== 'relay');
  const [localModelStatus, setLocalModelStatus] = useState<LocalAnalysisModelStatus | null>(null);
  const [isPreparingLocalModel, setIsPreparingLocalModel] = useState(false);
  const routeAutoCollapsed = useRef(false);
  const sceneReady = Boolean(project.sceneDescription.trim());
  const poseReady = Boolean(project.poseDescription.trim());
  const faceReady = Boolean(project.faceDirectionDescription.trim());
  const lightReady = Boolean(project.lightingMakeupDescription.trim());
  const analysisProvider = normalizeAnalysisProvider(settings.apiProvider);
  const doubaoModel = normalizeDoubaoAnalysisModel(settings.doubaoAnalysisModel);
  const activeGenerationLabel = generationProvider === 'relay'
    ? '自由 API'
    : generationProvider === 'gemini' ? 'Gemini' : 'ChatGPT';
  const readyCount = [sceneReady, poseReady, faceReady, lightReady].filter(Boolean).length;

  useEffect(() => {
    return window.xiangmao?.onMainImageAnalysisStatus((status) => {
      const detail = status.detail ? `：${status.detail}` : '';
      setAnalysisStatus(`${status.step}${detail}`);
      if (status.level === 'error') setAnalysisStatusLevel('error');
      else if (status.level === 'warning') setAnalysisStatusLevel('warning');
      else if (status.level === 'success') setAnalysisStatusLevel('done');
    });
  }, []);

  useEffect(() => {
    return window.xiangmao?.onWebPoseAnalysisStatus((status) => {
      const detail = status.detail ? `：${status.detail}` : '';
      setPoseStatus(`${status.step}${detail}`);
      if (status.level === 'error') setPoseStatusLevel('error');
      else if (status.level === 'warning') setPoseStatusLevel('warning');
      else if (status.level === 'success') setPoseStatusLevel('done');
    });
  }, []);

  useEffect(() => {
    return window.xiangmao?.onLocalAnalysisModelProgress((status) => {
      setLocalModelStatus(status);
      setIsPreparingLocalModel(status.state === 'downloading');
    });
  }, []);

  useEffect(() => {
    if (analysisProvider !== 'ollama') return;
    let active = true;
    void window.xiangmao?.getLocalAnalysisModelStatus({
      baseUrl: settings.apiBaseUrl,
      model: settings.apiVisionModel
    }).then((status) => {
      if (active) setLocalModelStatus(status);
    });
    return () => {
      active = false;
    };
  }, [analysisProvider, settings.apiBaseUrl, settings.apiVisionModel]);

  useEffect(() => {
    const analysisReady = analysisProvider !== 'ollama' || localModelStatus?.ready;
    const generationReady = generationProvider !== 'relay' || relayStatus?.configured;
    if (routeAutoCollapsed.current || !analysisReady || !generationReady) return;
    routeAutoCollapsed.current = true;
    const timeout = window.setTimeout(() => setRouteOpen(false), 220);
    return () => window.clearTimeout(timeout);
  }, [analysisProvider, generationProvider, localModelStatus?.ready, relayStatus?.configured]);

  useEffect(() => {
    setPosePickerOpen(false);
    setPoseStatus('');
  }, [project.mainImage?.id]);

  useEffect(() => {
    setAnalysisDetailsOpen(generationProvider !== 'relay');
  }, [generationProvider]);

  function updateSlider(key: keyof typeof project.sliders, value: number) {
    updateProject({ sliders: { ...project.sliders, [key]: value } });
  }

  function toggleLocked(label: string) {
    updateProject({
      lockedElements: project.lockedElements.includes(label)
        ? project.lockedElements.filter((item) => item !== label)
        : [...project.lockedElements, label]
    });
  }

  function updateAnalysisProvider(provider: AnalysisProvider) {
    if (isAnalyzing || isPoseAnalyzing || isGenerating || provider === analysisProvider) return;
    const usesDoubaoLocalFields = settings.apiBaseUrl === DOUBAO_ANALYSIS_BASE_URL || settings.apiVisionModel === DOUBAO_ANALYSIS_MODEL;
    const nextSettings = {
      ...settings,
      apiProvider: provider,
      ...(provider === 'ollama' && usesDoubaoLocalFields
        ? { apiBaseUrl: 'http://127.0.0.1:11434', apiVisionModel: 'auto' }
        : {})
    };
    setSettings(provider === 'ollama' && usesDoubaoLocalFields
      ? { apiProvider: provider, apiBaseUrl: 'http://127.0.0.1:11434', apiVisionModel: 'auto' }
      : { apiProvider: provider });
    void window.xiangmao?.writeSettings(nextSettings);
  }

  async function prepareLocalAnalysisModel() {
    if (isPreparingLocalModel) return;
    if (localModelStatus?.state === 'service-missing') {
      await window.xiangmao?.openExternal(localModelStatus.downloadUrl || 'https://ollama.com/download/windows');
      setLocalModelStatus({
        ...localModelStatus,
        message: '已打开官方下载页。安装完成后回到这里点击“重新检测”。'
      });
      return;
    }
    setIsPreparingLocalModel(true);
    try {
      const status = await window.xiangmao?.prepareLocalAnalysisModel({
        baseUrl: settings.apiBaseUrl,
        model: settings.apiVisionModel
      });
      if (status) setLocalModelStatus(status);
    } finally {
      setIsPreparingLocalModel(false);
    }
  }

  async function refreshLocalAnalysisModel() {
    const status = await window.xiangmao?.getLocalAnalysisModelStatus({
      baseUrl: settings.apiBaseUrl,
      model: settings.apiVisionModel
    });
    if (status) setLocalModelStatus(status);
  }

  async function analyzeMainImage() {
    if (!project.mainImage) {
      setAnalysisStatusLevel('warning');
      setAnalysisStatus('请先上传原图，再开始 AI 分析。');
      return;
    }
    setIsAnalyzing(true);
    setAnalysisStatusLevel('done');
    setAnalysisStatus('正在压缩原图，准备快速分析...');
    const mainImageId = project.mainImage.id;
    try {
      const analysisImageDataUrl = await createAnalysisImage(project.mainImage, project.maskCircle, 768, 0.82);
      const startedAt = performance.now();
      setAnalysisStatus('AI 正在读取场景、动作、面部朝向和光影...');
      const result = await window.xiangmao?.apiAnalyzeMainImage({
        provider: analysisProvider,
        apiKey: settings.apiKeySessionOnly,
        imageDataUrl: analysisImageDataUrl,
        baseUrl: analysisProvider === 'doubao' ? DOUBAO_ANALYSIS_BASE_URL : settings.apiBaseUrl,
        model: analysisProvider === 'doubao'
          ? doubaoModel
          : settings.apiProvider === 'gemini' ? settings.geminiModel : settings.apiVisionModel
      });
      if (!result?.ok || !result.analysis) {
        const error = result?.error || '原图分析没有返回结果。';
        setAnalysisStatusLevel('error');
        setAnalysisStatus(`原图分析未完成：${error} 这不会阻断 ${activeGenerationLabel} 做图，可重试或手动填写原图理解。`);
        return;
      }
      const { analysis } = result;
      const accepted = updateProjectForMainImage(mainImageId, {
        sceneDescription: analysis.sceneDescription,
        poseDescription: analysis.poseDescription,
        faceDirectionDescription: analysis.faceDirectionDescription,
        lightingMakeupDescription: analysis.lightingMakeupDescription
      });
      if (!accepted) {
        setAnalysisStatusLevel('warning');
        setAnalysisStatus('原图已更换，本次旧图分析结果已忽略。');
        return;
      }
      if (
        settings.apiProvider === 'ollama' &&
        result.fallbackUsed &&
        result.model &&
        settings.apiVisionModel.trim().toLowerCase() !== 'auto'
      ) {
        const nextSettings = { ...settings, apiVisionModel: result.model };
        setSettings({ apiVisionModel: result.model });
        void window.xiangmao?.writeSettings(nextSettings);
      }
      const seconds = Math.max(1, Math.round((performance.now() - startedAt) / 1000));
      setAnalysisStatusLevel(result.degraded ? 'warning' : 'done');
      setAnalysisStatus(
        result.degraded
          ? `分析已用兼容模式完成，用时约 ${seconds} 秒。${result.model ? `实际模型：${result.model}。` : ''}描述与安全约束已写入区域三。`
          : `分析完成，用时约 ${seconds} 秒。${result.model ? `实际模型：${result.model}。` : ''}描述已写入区域三。`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '原图分析请求异常。';
      setAnalysisStatusLevel('error');
      setAnalysisStatus(`原图分析未完成：${message} 这不会阻断 ${activeGenerationLabel} 做图，可稍后重试。`);
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function analyzeWebPoses() {
    if (!project.mainImage) {
      setPoseStatusLevel('warning');
      setPoseStatus('请先上传原图，再分析网感姿势。');
      return;
    }
    setIsPoseAnalyzing(true);
    setPosePickerOpen(false);
    setPoseStatusLevel('done');
    setPoseStatus(`正在压缩原图，准备让 ${analysisProviderLabel(analysisProvider)} 分析网感姿势...`);
    const mainImageId = project.mainImage.id;
    try {
      const analysisImageDataUrl = await createAnalysisImage(project.mainImage, undefined, 1024, 0.86);
      const result = await window.xiangmao?.apiAnalyzeWebPoses({
        provider: analysisProvider,
        imageDataUrl: analysisImageDataUrl,
        baseUrl: analysisProvider === 'doubao' ? DOUBAO_ANALYSIS_BASE_URL : settings.apiBaseUrl,
        model: analysisProvider === 'doubao' ? doubaoModel : settings.apiVisionModel
      });
      if (!result?.ok || result.suggestions?.length !== 8) {
        setPoseStatusLevel('error');
        setPoseStatus(`网感姿势分析未完成：${result?.error || '没有返回完整的 8 条姿势。'} 已保留原有选项和当前选择。`);
        return;
      }
      const accepted = updateProjectForMainImage(mainImageId, { webPoseSuggestions: result.suggestions });
      if (!accepted) {
        setPoseStatusLevel('warning');
        setPoseStatus('原图已更换，本次旧图姿势建议已忽略。');
        return;
      }
      setPoseStatusLevel('done');
      setPoseStatus('8 个新姿势已准备好，点击按钮下方的小箭头选择。');
    } catch (error) {
      const message = error instanceof Error ? error.message : '网感姿势分析请求异常。';
      setPoseStatusLevel('error');
      setPoseStatus(`网感姿势分析未完成：${message} 已保留原有选项和当前选择。`);
    } finally {
      setIsPoseAnalyzing(false);
    }
  }

  function selectWebPose(index: number) {
    const selected = project.webPoseSuggestions.find((item) => item.id === index);
    if (!selected) return;
    updateProject({ selectedWebPose: selected });
    setPoseStatusLevel('done');
    setPoseStatus(`已选择 ${selected.id}. ${selected.title}。请重新点击“一键生成提示词”写入当前姿势。`);
    setPosePickerOpen(false);
  }

  return (
    <section className={`panel description-panel ${isAnalyzing || isPoseAnalyzing ? 'is-analyzing' : ''}`} aria-busy={isAnalyzing || isPoseAnalyzing}>
      <div className={`production-route-panel ${routeOpen ? 'is-open' : ''}`}>
        <button
          type="button"
          className="production-route-disclosure"
          onClick={() => setRouteOpen((current) => !current)}
          aria-expanded={routeOpen}
          aria-controls="production-route-options"
        >
          <span>
            <b>制作通道</b>
            <small>{analysisRouteSummary(analysisProvider, generationProvider)}</small>
          </span>
          <ChevronDown aria-hidden="true" />
        </button>
        {routeOpen && <div id="production-route-options" className="production-route-body">
          <span className="production-route-caption">最终做图</span>
          <div className="production-provider-selector" role="group" aria-label="最终做图通道">
          {([
            ['chatgpt', 'ChatGPT'],
            ['gemini', 'Gemini'],
            ['relay', 'API']
          ] as const).map(([provider, label]) => {
            const unavailable = provider === 'gemini';
            return (
              <button
                key={provider}
                type="button"
                className={generationProvider === provider ? 'active' : ''}
                onClick={() => onGenerationProviderChange(provider)}
                disabled={isGenerating || unavailable}
                aria-pressed={generationProvider === provider}
                title={unavailable ? 'Gemini 适配中，暂不可用' : undefined}
              >
                {label}
              </button>
            );
          })}
          </div>
          <div className="analysis-provider-row">
          <span>分析来源</span>
          <div role="group" aria-label="AI 分析来源">
            {([
              ['doubao', '豆包'],
              ['chatgpt', 'ChatGPT'],
              ['ollama', '本地模型'],
              ['gemini', 'Gemini']
            ] as const).map(([provider, label]) => {
              const unavailable = provider === 'gemini';
              return (
                <button
                  key={provider}
                  type="button"
                  className={analysisProvider === provider ? 'active' : ''}
                  onClick={() => updateAnalysisProvider(provider)}
                  disabled={isGenerating || isAnalyzing || isPoseAnalyzing || unavailable}
                  aria-pressed={analysisProvider === provider}
                  title={unavailable ? 'Gemini 适配中，暂不可用' : undefined}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {analysisProvider === 'doubao' && (
            <label className="doubao-analysis-model">
              <span>豆包模型</span>
              <select
                aria-label="豆包分析模型"
                value={doubaoModel}
                disabled={isGenerating || isAnalyzing || isPoseAnalyzing}
                onChange={(event) => {
                  const doubaoAnalysisModel = normalizeDoubaoAnalysisModel(event.target.value);
                  const nextSettings = { ...settings, doubaoAnalysisModel };
                  setSettings({ doubaoAnalysisModel });
                  void window.xiangmao?.writeSettings(nextSettings);
                }}
              >
                {DOUBAO_ANALYSIS_MODELS.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </label>
          )}
          {generationProvider === 'relay' && (
            <button type="button" className="production-route-tool api" onClick={onOpenApiConfig}>
              <KeyRound /> <span>{relayStatus?.configured ? 'API 已配置' : '配置 API'}</span>
            </button>
          )}
          </div>
          {analysisProvider === 'ollama' && (
            <div className={`local-analysis-setup ${localModelStatus?.ready ? 'is-ready' : ''}`} role="status">
              <span>
                {localModelStatus?.ready && <Check aria-hidden="true" />}
                <b>{localModelStatus?.ready ? '本地模型已就绪' : '本地模型准备'}</b>
                <small>{localModelStatus?.message || '正在检测本机分析服务。'}</small>
              </span>
              {!localModelStatus?.ready && (
                <button type="button" onClick={() => void prepareLocalAnalysisModel()} disabled={isPreparingLocalModel}>
                  {isPreparingLocalModel ? <LoaderCircle className="spin" /> : <Download />}
                  {isPreparingLocalModel
                    ? `${localModelStatus?.progress || 0}%`
                    : localModelStatus?.state === 'service-missing' ? '安装本地模型' : '下载本地模型'}
                </button>
              )}
              {localModelStatus?.state === 'service-missing' && (
                <button type="button" className="local-analysis-refresh" onClick={() => void refreshLocalAnalysisModel()}>
                  重新检测
                </button>
              )}
            </div>
          )}
        </div>}
      </div>
      {generationProvider === 'relay' && (
        <div className={`api-analysis-disclosure ${includeOriginalUnderstanding ? 'is-enabled' : ''} ${analysisDetailsOpen ? 'is-open' : ''}`.trim()}>
          <button
            type="button"
            className="api-analysis-disclosure-button"
            onClick={() => setAnalysisDetailsOpen((current) => !current)}
            aria-expanded={analysisDetailsOpen}
            aria-controls="api-original-understanding-details"
          >
            <span>
              <b>原图理解</b>
              <small>{includeOriginalUnderstanding ? '已启用，分析内容会写入提示词' : '未启用，直接依据主垫图生成'}</small>
            </span>
            <ChevronDown aria-hidden="true" />
          </button>
          <label className="api-analysis-toggle">
            <input
              type="checkbox"
              checked={includeOriginalUnderstanding}
              disabled={isGenerating}
              onChange={(event) => onOriginalUnderstandingChange(event.target.checked)}
            />
            <b>使用原图理解</b>
          </label>
        </div>
      )}
      {(generationProvider !== 'relay' || analysisDetailsOpen) && <div id="api-original-understanding-details" className="api-original-understanding-details">
      <div className="panel-head minimal-panel-head">
        <h3 className="section-title">
          <span className="section-copy">
            <b>{generationProvider === 'relay' ? '分析工具' : '原图理解'}</b>
          </span>
        </h3>
        <div className="tool-strip">
          <button className="analysis-button analysis-button-gold" disabled={!project.mainImage || isAnalyzing || isPoseAnalyzing} onClick={analyzeMainImage} title="自动填写场景、动作、面部朝向和光影描述。">
            {isAnalyzing ? <LoaderCircle className="spin" /> : <Sparkles />}
            {isAnalyzing ? '分析中' : 'AI 分析'}
          </button>
          <div className="web-pose-trigger">
            <button
              className="analysis-button analysis-button-gold web-pose-button"
              disabled={!project.mainImage || isAnalyzing || isPoseAnalyzing}
              onClick={analyzeWebPoses}
              title={`使用${analysisProviderLabel(analysisProvider)}重新分析原图并刷新 8 个网感姿势。`}
            >
              {isPoseAnalyzing ? <LoaderCircle className="spin" /> : <PersonStanding />}
              {isPoseAnalyzing ? '分析中' : '网感姿势'}
              {project.selectedWebPose && !isPoseAnalyzing && <span className="web-pose-selected-id">{project.selectedWebPose.id}</span>}
            </button>
            {project.webPoseSuggestions.length === 8 && !isPoseAnalyzing && (
              <button
                className={`web-pose-disclosure ${posePickerOpen ? 'open' : ''}`}
                onClick={() => setPosePickerOpen((value) => !value)}
                title={posePickerOpen ? '收起网感姿势选项' : '展开网感姿势选项'}
                aria-label={posePickerOpen ? '收起网感姿势选项' : '展开网感姿势选项'}
                aria-expanded={posePickerOpen}
                aria-controls="web-pose-picker"
              >
                <ChevronDown />
              </button>
            )}
          </div>
        </div>
      </div>
      {analysisStatus && (
        <div className={`analysis-status ${isAnalyzing ? 'running' : analysisStatusLevel}`} role="status" aria-live="polite">
          {isAnalyzing && <LoaderCircle className="spin" />}
          <span>{analysisStatus}</span>
        </div>
      )}
      {poseStatus && (
        <div className={`analysis-status web-pose-status ${isPoseAnalyzing ? 'running' : poseStatusLevel}`} role="status" aria-live="polite">
          {isPoseAnalyzing && <LoaderCircle className="spin" />}
          <span>{poseStatus}</span>
        </div>
      )}
      {posePickerOpen && project.webPoseSuggestions.length === 8 && (
        <div className="web-pose-picker" id="web-pose-picker" role="radiogroup" aria-label="选择网感姿势">
          <div className="web-pose-picker-head">
            <div>
              <b>选择网感姿势</b>
              <span>选中后重新生成提示词</span>
            </div>
            {project.selectedWebPose && <small>当前 {project.selectedWebPose.id}. {project.selectedWebPose.title}</small>}
          </div>
          <div className="web-pose-options">
            {project.webPoseSuggestions.map((suggestion) => {
              const selected = project.selectedWebPose?.id === suggestion.id &&
                project.selectedWebPose.title === suggestion.title &&
                project.selectedWebPose.description === suggestion.description;
              return (
                <button
                  key={`${suggestion.id}-${suggestion.title}`}
                  className={`web-pose-option ${selected ? 'selected' : ''}`}
                  role="radio"
                  aria-checked={selected}
                  onClick={() => selectWebPose(suggestion.id)}
                >
                  <span className="web-pose-option-index">{suggestion.id}</span>
                  <span className="web-pose-option-copy">
                    <b>{suggestion.title}</b>
                    <span>{suggestion.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="description-intel-strip">
        <div className={sceneReady ? 'ready' : ''}>
          <Camera />
          <span>场景</span>
          <b>{sceneReady ? '已写入' : '待分析'}</b>
        </div>
        <div className={poseReady ? 'ready' : ''}>
          <Layers3 />
          <span>动作</span>
          <b>{poseReady ? '已写入' : '待分析'}</b>
        </div>
        <div className={faceReady ? 'ready' : ''}>
          <ScanFace />
          <span>朝向</span>
          <b>{faceReady ? '已写入' : '待分析'}</b>
        </div>
        <div className={lightReady ? 'ready' : ''}>
          <SunMedium />
          <span>光影</span>
          <b>{lightReady ? '已写入' : '待分析'}</b>
        </div>
      </div>

      <div className="description-progress-line" aria-label="原图理解完成度">
        <span style={{ width: `${(readyCount / 4) * 100}%` }} />
      </div>

      <div className="description-sections">
      <details className="context-card scene-card" data-label="场景" open>
        <summary>场景 <ChevronDown /></summary>
        <div className="form-grid">
          <textarea
            value={project.sceneDescription}
            onChange={(e) => updateProject({ sceneDescription: e.target.value })}
            placeholder="请描述原图的场景地点、背景环境、时间氛围、拍摄设备感、图片画质、是否手机拍摄、是否普通生活照，以及哪些场景内容必须保持原样。"
          />
          <div className="quick-chips">
            {['手机拍摄', '普通生活照', '室内暖光', '室外自然光', '保留原图真实感', '背景完全不变'].map((item) => (
              <button key={item} onClick={() => updateProject({ sceneDescription: `${project.sceneDescription} ${item}`.trim() })}>
                {item}
              </button>
            ))}
          </div>
        </div>
      </details>

      <details className="context-card pose-card" data-label="姿态" open>
        <summary>姿态 <ChevronDown /></summary>
        <textarea
          value={project.poseDescription}
          onChange={(e) => updateProject({ poseDescription: e.target.value })}
          placeholder="请描述原图中人物的身体姿势、手部动作、头部角度、肩颈姿态、与镜头距离、身体朝向，并说明原动作和红圈外身体部分需要完全不变。"
        />
      </details>

      <details className="context-card face-card" data-label="面向" open>
        <summary>面部朝向 <ChevronDown /></summary>
        <textarea
          value={project.faceDirectionDescription}
          onChange={(e) => updateProject({ faceDirectionDescription: e.target.value })}
          placeholder="请描述原图中红圈内原先的面部朝向、头部角度、眼神方向、视线落点、表情情绪、嘴唇状态和眉眼状态；替换后仍要匹配这些原图条件。"
        />
      </details>

      <details className="context-card light-card" data-label="光质" open>
        <summary>光影、妆容与画质 <ChevronDown /></summary>
        <textarea
          value={project.lightingMakeupDescription}
          onChange={(e) => updateProject({ lightingMakeupDescription: e.target.value })}
          placeholder="请具体描述原图红圈内面部光影：光线颜色/色温，来自画面哪一侧，落在额头、鼻梁、脸颊、下巴等位置；阴影在眼窝、鼻翼、下颌或颈部哪里，高光和肤色反射如何；同时写妆容浓淡、皮肤纹理、清晰度、噪点、压缩痕迹和普通手机拍摄画质。"
        />
      </details>

      <details className="context-card lock-card" data-label="边界" open>
        <summary>
          禁止改变内容 <ShieldAlert /> <span className="badge danger">未授权区域保护</span>
        </summary>
        <div className="locked-grid">
          {lockedOptions.map((label) => (
            <label key={label}>
              <input type="checkbox" checked={project.lockedElements.includes(label)} onChange={() => toggleLocked(label)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <input
          className="custom-lock-input"
          placeholder="添加自定义禁止改变项，例如：不要改变手机壳，按 Enter 添加"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              const value = event.currentTarget.value.trim();
              if (value) updateProject({ customLockedElements: [...project.customLockedElements, value] });
              event.currentTarget.value = '';
            }
          }}
        />
        <div className="custom-locks">
          {project.customLockedElements.map((item) => (
            <button key={item} onClick={() => updateProject({ customLockedElements: project.customLockedElements.filter((x) => x !== item) })}>
              {item}
            </button>
          ))}
        </div>
      </details>

      <details className="context-card strength-card" data-label="调校" open>
        <summary>生成强度参数 <ChevronDown /></summary>
        <div className="slider-grid">
          {sliderLabels.map(([key, label]) => (
            <label key={key}>
              <span>
                {label}
                <b>{project.sliders[key]}</b>
              </span>
              <input type="range" min={1} max={10} value={project.sliders[key]} onChange={(e) => updateSlider(key, Number(e.target.value))} />
            </label>
          ))}
        </div>
      </details>
      </div>
      </div>}

    </section>
  );
}
