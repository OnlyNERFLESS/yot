import { useEffect, useState } from 'react';
import { useApp } from '../app/ctx';
import { Bell, BellOff, Check, Play, RefreshCw } from 'lucide-react';
import { getVersion } from '@tauri-apps/api/app';
import { findUpdate } from '../lib/updates';
import { showUpdate } from '../ui/UpdatePrompt';
import { api, RINGTONES, type Mode, type PackInfo, type Ringtone, type SavedPlace } from '../lib/api';
import { playTone, remindersChanged } from '../lib/reminderEngine';
import type { Key } from '../lib/i18n';
import { nf, sep } from '../lib/i18n';

const CHUNK = 4 << 20; // 4 MB per write keeps memory flat on phones

const TONE_NAMES: Record<Ringtone, Key> = {
  emerald: 'toneEmerald', pulse: 'tonePulse', bloom: 'toneBloom', marimba: 'toneMarimba', beacon: 'toneBeacon', silent: 'toneSilent',
};
const TONE_NOTES: Record<Ringtone, Key> = {
  emerald: 'toneEmeraldNote', pulse: 'tonePulseNote', bloom: 'toneBloomNote', marimba: 'toneMarimbaNote', beacon: 'toneBeaconNote', silent: 'toneSilentNote',
};

export function Panel({ active }: { active: boolean }) {
  const { t, lang, settings, update } = useApp();
  const [version, setVersion] = useState('');
  const [upd, setUpd] = useState<'idle' | 'checking' | 'latest' | 'failed'>('idle');
  useEffect(() => {
    void getVersion().then(setVersion);
  }, []);
  const checkUpdate = async () => {
    setUpd('checking');
    try {
      const u = await findUpdate();
      setUpd(u ? 'idle' : 'latest');
      if (u) showUpdate(u);
    } catch {
      setUpd('failed');
    }
  };
  const [packs, setPacks] = useState<PackInfo[]>([]);
  const [dir, setDir] = useState('');
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [url, setUrl] = useState('');
  const [dl, setDl] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    void api.packs().then(setPacks);
    void api.packDir().then(setDir);
    void api.places().then(setPlaces);
  };
  useEffect(() => {
    if (active) load();
  }, [active]);

  const download = async () => {
    const file = decodeURIComponent(url.split('?')[0].split('/').pop() ?? '');
    if (!/^[A-Za-z0-9_-]+\.(pmtiles|graph|places|transit)$/.test(file)) {
      setMsg(t('packUrl'));
      return;
    }
    try {
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get('content-length')) || 0;
      const reader = res.body.getReader();
      let offset = 0;
      let buf = new Uint8Array(0);
      for (;;) {
        const { done, value } = await reader.read();
        if (value) {
          const next = new Uint8Array(buf.length + value.length);
          next.set(buf);
          next.set(value, buf.length);
          buf = next;
        }
        if (buf.length >= CHUNK || done) {
          await api.packWrite(file, offset, buf, done);
          offset += buf.length;
          buf = new Uint8Array(0);
          setDl(total ? `${nf(lang, (offset / total) * 100)}%` : `${nf(lang, offset / 1e6, 1)} MB`);
        }
        if (done) break;
      }
      setUrl('');
      setMsg(null);
    } catch (e) {
      setMsg(`${t('error')}: ${String(e)}`);
    } finally {
      setDl(null);
      load();
    }
  };


  return (
    <div className="page" hidden={!active}>
      <header className="page-head">
        <h1>{t('navPanel')}</h1>
      </header>
      {msg && <p className="toast inline" role="status">{msg}</p>}

      <section className="card">
        <h2>{t('general')}</h2>
        <Field label={t('language')}>
          <Seg value={settings.lang} options={[['en', 'English'], ['fa', 'فارسی']]} onChange={(v) => void update('lang', v)} />
        </Field>
        <Field label={t('theme')}>
          <Seg
            value={settings.theme}
            options={[['system', t('themeSystem')], ['light', t('themeLight')], ['dark', t('themeDark')]]}
            onChange={(v) => void update('theme', v)}
          />
        </Field>
      </section>

      <section className="card">
        <h2>{t('notifSound')}</h2>
        <p className="muted small">{t('notifSoundHelp')}</p>
        <div className="tones" role="radiogroup" aria-label={t('notifSound')}>
          {([...RINGTONES, 'silent'] as Ringtone[]).map((tone) => {
            const on = settings.ringtone === tone;
            const pick = () => {
              void update('ringtone', tone).then(remindersChanged);
              playTone(tone);
            };
            return (
              <div key={tone} className={on ? 'tone on' : 'tone'}>
                <button type="button" role="radio" aria-checked={on} className="tone-pick" onClick={pick}>
                  <span className="tone-icon" aria-hidden>{tone === 'silent' ? <BellOff /> : <Bell />}</span>
                  <span className="tone-text">
                    <b>{t(TONE_NAMES[tone])}</b>
                    <span>{t(TONE_NOTES[tone])}</span>
                  </span>
                  {on && <Check aria-hidden className="tone-check" />}
                </button>
                {tone !== 'silent' ? (
                  <button type="button" className="icon-btn" onClick={() => playTone(tone)} aria-label={`${t('playTone')}: ${t(TONE_NAMES[tone])}`}>
                    <Play aria-hidden />
                  </button>
                ) : <span className="tone-spacer" aria-hidden />}
              </div>
            );
          })}
        </div>
      </section>

      <section className="card">
        <h2>{t('routingSection')}</h2>
        <Field label={t('routingMode')}>
          <Seg value={settings.provider_pref} options={[['auto', t('routingAuto')], ['offline', t('routingOffline')]]} onChange={(v) => void update('provider_pref', v)} />
        </Field>
        <Field label={t('defaultMode')}>
          <Seg<Mode> value={settings.default_mode} options={[['car', t('car')], ['motorcycle', t('motorcycle')], ['walk', t('walk')]]} onChange={(v) => void update('default_mode', v)} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={settings.avoid_traffic_zone} onChange={(e) => void update('avoid_traffic_zone', e.target.checked)} />
          {t('avoidTrafficZone')}
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.avoid_odd_even} onChange={(e) => void update('avoid_odd_even', e.target.checked)} />
          {t('avoidOddEven')}
        </label>
      </section>

      <section className="card">
        <h2>{t('packs')}</h2>
        <p className="muted small">{t('packsHelp')}</p>
        <code className="path">{dir}</code>
        {packs.length === 0 ? (
          <p className="muted">{t('noPacks')}</p>
        ) : (
          <ul className="plain">
            {packs.map((p) => (
              <li key={p.name} className="between">
                <span>
                  <strong>{p.name}</strong>{' '}
                  <span className="muted small">
                    {[p.has_tiles && 'map', p.has_graph && 'routes', p.has_places && 'search'].filter(Boolean).join(sep(lang))}{sep(lang)}{nf(lang, p.size_bytes / 1e6, 1)} MB
                  </span>
                </span>
                <button type="button" className="danger small" onClick={() => void api.packDelete(p.name).then(load)}>{t('delete')}</button>
              </li>
            ))}
          </ul>
        )}
        <form className="row" onSubmit={(e) => { e.preventDefault(); void download(); }}>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('packUrl')} type="url" dir="ltr" />
          <button type="submit" className="btn primary" disabled={!url || dl !== null}>{dl ? `${t('downloading')} ${dl}` : t('download')}</button>
        </form>
      </section>


      <section className="card">
        <h2>{t('savedPlaces')}</h2>
        {places.length === 0 ? (
          <p className="muted">{t('none')}</p>
        ) : (
          <ul className="plain">
            {places.map((p) => (
              <li key={p.id} className="between">
                <span>{p.name} <span className="muted small" dir="ltr">{p.lat.toFixed(5)}, {p.lon.toFixed(5)}</span></span>
                <button type="button" className="danger small" onClick={() => void api.placeDelete(p.id).then(load)}>{t('delete')}</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>{t('about')}</h2>
        <div className="about-row">
          <p className="muted small">{t('version')} <span className="num">{version}</span></p>
          <button type="button" className="btn" disabled={upd === 'checking'} onClick={() => void checkUpdate()}>
            <RefreshCw aria-hidden className={upd === 'checking' ? 'spinning' : ''} /> {t(upd === 'checking' ? 'updChecking' : 'updCheck')}
          </button>
        </div>
        {upd === 'latest' && <p className="muted small">{t('updLatest')}</p>}
        {upd === 'failed' && <p className="error">{t('updFailed')}</p>}
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {children}
    </div>
  );
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map(([v, label]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}
