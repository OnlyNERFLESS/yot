import { useEffect, useState } from 'react';
import { Download, Sparkles, X } from 'lucide-react';
import { useApp } from '../app/ctx';
import { isMobile } from '../lib/location';
import { useBack } from '../lib/back';
import { findUpdate, installUpdate, skippedVersion, skipVersion, type Update } from '../lib/updates';

const EVENT = 'yot:update';

/** Show the update dialog for a release found elsewhere (Settings). */
export const showUpdate = (u: Update) => window.dispatchEvent(new CustomEvent<Update>(EVENT, { detail: u }));

/** Checks GitHub once per launch and offers a newer version as a popup. */
export function UpdatePrompt() {
  const { t, online } = useApp();
  const [u, setU] = useState<Update | null>(null);
  const [stage, setStage] = useState<'ask' | 'working' | 'browser'>('ask');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const on = (e: Event) => {
      setStage('ask');
      setErr(null);
      setU((e as CustomEvent<Update>).detail);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  // Once per launch, after the app has settled; silent when offline or current.
  useEffect(() => {
    if (!online) return;
    const id = window.setTimeout(() => {
      void findUpdate()
        .then((found) => {
          if (found && found.file && skippedVersion() !== found.version) setU(found);
        })
        .catch(() => {});
    }, 2500);
    return () => window.clearTimeout(id);
  }, [online]);

  // Back closes the popup, but never while the download is running.
  useBack(() => (u ? (stage !== 'working' && setU(null), true) : false));

  if (!u) return null;
  const later = () => {
    skipVersion(u.version);
    setU(null);
  };
  const update = async () => {
    setErr(null);
    setStage('working');
    try {
      await installUpdate(u);
      if (isMobile) setStage('browser');
    } catch (x) {
      setErr(String(x));
      setStage('ask');
    }
  };

  return (
    <div className="qa-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && stage !== 'working') setU(null); }}>
      <section className="qa upd" role="dialog" aria-modal="true" aria-labelledby="upd-title">
        <header className="qa-head">
          <h2 id="upd-title"><Sparkles aria-hidden /> {t('updTitle')}</h2>
          {stage !== 'working' && (
            <button type="button" className="icon-btn" onClick={() => setU(null)} aria-label={t('cancel')}><X aria-hidden /></button>
          )}
        </header>
        <p className="upd-ver">
          <span className="num">YOT {u.version}</span>
          <span className="muted">{t('updYouHave').replace('{v}', u.current)}</span>
        </p>
        {u.notes.length > 0 && (
          <>
            <p className="upd-sub">{t('updWhatsNew')}</p>
            <ul className="upd-notes">{u.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          </>
        )}
        <p className="muted small">
          {stage === 'browser' ? t('updAndroidNext') : stage === 'working' ? t(isMobile ? 'updOpening' : 'updDownloading') : t(isMobile ? 'updAndroidHow' : 'updWinHow')}
        </p>
        {err && <p className="error">{err}</p>}
        <footer className="qa-foot">
          {stage === 'browser' ? (
            <button type="button" className="btn primary" onClick={() => setU(null)}>{t('updOk')}</button>
          ) : (
            <>
              <button type="button" className="btn" disabled={stage === 'working'} onClick={later}>{t('updLater')}</button>
              <button type="button" className="btn primary" disabled={stage === 'working'} onClick={() => void update()}>
                {stage === 'working' ? <span className="spin" aria-hidden /> : <Download aria-hidden />} {t('updNow')}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
