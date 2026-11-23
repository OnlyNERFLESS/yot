import { useEffect, useState, type FormEvent } from 'react';
import { useApp } from '../app/ctx';
import { api, type Priority, type Task } from '../lib/api';
import { today } from './Home';
import { fmtDay } from '../lib/i18n';
import { DateField } from '../ui/DateField';
import { QuickAdd } from '../ui/QuickAdd';
import { Zap } from 'lucide-react';

export function Tasks({ active }: { active: boolean }) {
  const { t, lang } = useApp();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState<Priority>(1);
  const [editing, setEditing] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [quick, setQuick] = useState(false);

  const load = () => void api.tasks().then(setTasks);
  useEffect(() => {
    if (active) load();
  }, [active]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      await api.taskSave({ title, notes: '', due: due || null, done: false, priority });
      setTitle('');
      setDue('');
      setPriority(1);
      setErr(null);
      load();
    } catch (x) {
      setErr(String(x));
    }
  };

  const save = async (task: Task) => {
    await api.taskSave(task);
    load();
  };

  const d = today();
  const open = tasks.filter((x) => !x.done);
  const groups: [string, Task[]][] = [
    [t('overdue'), open.filter((x) => x.due !== null && x.due < d)],
    [t('today'), open.filter((x) => x.due === d)],
    [t('upcoming'), open.filter((x) => x.due !== null && x.due > d)],
    [t('noDate'), open.filter((x) => x.due === null)],
    [t('done'), tasks.filter((x) => x.done)],
  ];

  return (
    <div className="page" hidden={!active}>
      <header className="page-head">
        <h1>{t('navTasks')}</h1>
        <button type="button" className="btn primary" onClick={() => setQuick(true)}><Zap aria-hidden /> {t('quickAdd')}</button>
      </header>
      <QuickAdd open={quick} kind="task" onClose={() => setQuick(false)} onSaved={() => load()} />

      <form className="card add-task" onSubmit={add}>
        <label className="sr-only" htmlFor="task-title">{t('taskTitle')}</label>
        <input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('taskTitle')} maxLength={200} />
        <div className="row">
          <DateField label={t('due')} value={due} onChange={setDue} />
          <label>
            <span>{t('priority')}</span>
            <select value={priority} onChange={(e) => setPriority(Number(e.target.value) as Priority)}>
              <option value={0}>{t('low')}</option>
              <option value={1}>{t('normal')}</option>
              <option value={2}>{t('high')}</option>
            </select>
          </label>
          <button type="submit" className="btn" disabled={!title.trim()}>{t('addTask')}</button>
        </div>
        {err && <p className="error">{err}</p>}
      </form>

      {tasks.length === 0 && <p className="muted center">{t('emptyTasks')}</p>}

      {groups.map(([label, list]) =>
        list.length === 0 ? null : (
          <section key={label} className="card">
            <h2>{label}</h2>
            <ul className="tasks">
              {list.map((x) => (
                <li key={x.id} className={`task p${x.priority}${x.done ? ' done' : ''}`}>
                  <input type="checkbox" checked={x.done} onChange={() => void save({ ...x, done: !x.done })} aria-label={x.title} />
                  <div className="task-body">
                    <button type="button" className="task-title" onClick={() => setEditing(editing === x.id ? null : x.id)}>
                      {x.title}
                    </button>
                    {x.due && <span className={`muted small${x.due < d && !x.done ? ' late' : ''}`}>{fmtDay(lang, x.due)}</span>}
                    {editing === x.id && (
                      <TaskEditor task={x} onSave={(n) => { void save(n); setEditing(null); }} onDelete={() => void api.taskDelete(x.id).then(load)} />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}

function TaskEditor({ task, onSave, onDelete }: { task: Task; onSave: (t: Task) => void; onDelete: () => void }) {
  const { t } = useApp();
  const [notes, setNotes] = useState(task.notes);
  const [due, setDue] = useState(task.due ?? '');
  return (
    <div className="editor">
      <label>
        <span>{t('notes')}</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={5000} />
      </label>
      <DateField label={t('due')} value={due} onChange={setDue} />
      <div className="row">
        <button type="button" className="btn primary" onClick={() => onSave({ ...task, notes, due: due || null })}>{t('save')}</button>
        <button type="button" className="btn danger" onClick={onDelete}>{t('delete')}</button>
      </div>
    </div>
  );
}
