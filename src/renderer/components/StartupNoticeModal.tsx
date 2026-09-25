import { useEffect, useRef, useState } from 'react';
import { Globe2, HardDriveDownload, KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react';

interface StartupNoticeModalProps {
  onConfirm: () => Promise<void>;
}

export function StartupNoticeModal({ onConfirm }: StartupNoticeModalProps) {
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    confirmButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        confirmButtonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  async function confirmNotice() {
    if (saving) return;
    setSaving(true);
    setSaveError('');
    try {
      await onConfirm();
    } catch {
      setSaveError('保存失败，请重试');
      setSaving(false);
      window.setTimeout(() => confirmButtonRef.current?.focus(), 0);
    }
  }

  return (
    <div
      className="startup-notice-backdrop"
      data-testid="startup-notice-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget !== event.target) return;
        event.preventDefault();
        confirmButtonRef.current?.focus();
      }}
    >
      <section
        className="startup-notice-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="startup-notice-title"
        aria-describedby="startup-notice-intro startup-notice-note"
        aria-busy={saving}
      >
        <header className="startup-notice-header">
          <span className="startup-notice-header-icon" aria-hidden="true">
            <ShieldCheck />
          </span>
          <div>
            <h1 id="startup-notice-title">使用前必看｜先选择制作路线</h1>
            <p id="startup-notice-intro">第一次使用时，请先确认你准备采用的分析和做图方式：</p>
          </div>
        </header>

        <div className="startup-notice-content">
          <div className="startup-notice-checks">
            <section className="startup-notice-check">
              <span className="startup-notice-index" aria-hidden="true">01</span>
              <span className="startup-notice-check-icon" aria-hidden="true"><KeyRound /></span>
              <div>
                <h2>自由 API 做图</h2>
                <p>使用你自己的服务地址和 Key。安装包不含预设服务商或他人的密钥。</p>
              </div>
            </section>

            <section className="startup-notice-check">
              <span className="startup-notice-index" aria-hidden="true">02</span>
              <span className="startup-notice-check-icon" aria-hidden="true"><HardDriveDownload /></span>
              <div>
                <h2>本地模型分析</h2>
                <p>本地模型用于 AI 分析和网感姿势，不需要网页登录。首次使用请在制作通道中确认模型已安装并显示就绪。</p>
              </div>
            </section>

            <section className="startup-notice-check is-recommended">
              <span className="startup-notice-index" aria-hidden="true">03</span>
              <span className="startup-notice-check-icon" aria-hidden="true"><Globe2 /></span>
              <div>
                <div className="startup-notice-check-title-row">
                  <h2>ChatGPT 网页做图</h2>
                  <span className="startup-notice-recommendation">可选</span>
                </div>
                <p>只有选择 ChatGPT 网页路线时，才需要准备可访问网页的网络并登录耀创工坊专属 Chrome。Gemini 当前暂不建议用于正式流程。</p>
              </div>
            </section>
          </div>

          <p className="startup-notice-note" id="startup-notice-note">
            图片导入支持 JPG、PNG、WebP、HEIC。请先上传原图，再按制作通道中的状态逐步操作；软件不会在启动时替你打开网页服务。
          </p>
        </div>

        <footer className="startup-notice-footer">
          <p className="startup-notice-error" role="alert" aria-live="assertive">{saveError}</p>
          <button
            ref={confirmButtonRef}
            className="startup-notice-confirm"
            type="button"
            disabled={saving}
            onClick={confirmNotice}
          >
            {saving && <LoaderCircle className="startup-notice-spinner" aria-hidden="true" />}
            <span>{saving ? '正在保存...' : '我已确认，进入耀创工坊'}</span>
          </button>
        </footer>
      </section>
    </div>
  );
}
