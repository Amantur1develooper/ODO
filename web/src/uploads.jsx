import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, RotateCw, X, AlertCircle, UploadCloud } from 'lucide-react';
import { api, csrfToken, notifyChanged, notifyFolders } from './api';
import { fmtSize, plural } from './utils';
import { useApp } from './store';
import { FileIcon } from './components/Items';

const UploadContext = createContext(null);
export const useUploads = () => useContext(UploadContext);

const CONCURRENCY = 4;
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000];
const IGNORED = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function putChunk(uploadId, offset, blob, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/uploads/${uploadId}?offset=${offset}`);
    xhr.setRequestHeader('X-CSRFToken', csrfToken());
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* не JSON */
      }
      resolve({ status: xhr.status, data });
    };
    xhr.onerror = () => resolve({ status: 0, data: null });
    const abort = () => {
      xhr.abort();
      reject(new DOMException('Отменено', 'AbortError'));
    };
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    xhr.send(blob);
  });
}

/** Загрузка одного файла кусками по 16 МБ; при обрыве связи продолжает с места остановки. */
async function uploadFile(task, onProgress) {
  const { file, folderId, controller } = task;
  const key = `odo-upload:${folderId}:${file.name}:${file.size}:${file.lastModified}`;
  let up = null;
  const saved = localStorage.getItem(key);
  if (saved) {
    try {
      up = await api.get(`/uploads/${saved}`);
    } catch {
      localStorage.removeItem(key);
    }
  }
  if (!up) {
    up = await api.post('/uploads', { folder_id: folderId, filename: file.name, size: file.size });
    if (up.done) return up.item;
    localStorage.setItem(key, up.id);
  }
  task.uploadId = up.id;
  let offset = up.offset;
  let attempt = 0;
  while (offset < file.size) {
    const end = Math.min(offset + up.chunk_size, file.size);
    const base = offset;
    const res = await putChunk(up.id, offset, file.slice(offset, end), (n) => onProgress(base + n), controller.signal);
    if (res.status === 200) {
      attempt = 0;
      offset = res.data.offset;
      onProgress(offset);
      if (res.data.done) {
        localStorage.removeItem(key);
        return res.data.item;
      }
      continue;
    }
    if (res.status === 409 && res.data?.offset != null) {
      offset = res.data.offset;
      continue;
    }
    if (res.status === 404) localStorage.removeItem(key);
    const retriable = res.status === 0 || res.status >= 500 || res.status === 400;
    if (!retriable || attempt >= RETRY_DELAYS.length) {
      throw new Error(res.data?.error || (res.status ? `Ошибка ${res.status}` : 'Нет связи с сервером'));
    }
    await sleep(RETRY_DELAYS[attempt++]);
    if (controller.signal.aborted) throw new DOMException('Отменено', 'AbortError');
    try {
      offset = (await api.get(`/uploads/${up.id}`)).offset;
    } catch {
      /* попробуем ещё раз на следующей итерации */
    }
  }
  throw new Error('Загрузка не завершилась');
}

/** Читает перетащенные файлы и папки (с вложенностью). Вызывать синхронно в обработчике drop. */
export function readDrop(dataTransfer) {
  const entries = [...(dataTransfer.items || [])]
    .filter((i) => i.kind === 'file')
    .map((i) => i.webkitGetAsEntry?.())
    .filter(Boolean);
  const plainFiles = [...(dataTransfer.files || [])];
  return (async () => {
    if (!entries.length) return plainFiles.map((file) => ({ file, dir: '' }));
    const out = [];
    const walk = async (entry, dir) => {
      if (entry.isFile) {
        const file = await new Promise((res, rej) => entry.file(res, rej));
        out.push({ file, dir });
      } else if (entry.isDirectory) {
        const path = dir ? `${dir}/${entry.name}` : entry.name;
        out.push({ dir: path });
        const reader = entry.createReader();
        for (;;) {
          const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
          if (!batch.length) break;
          for (const e of batch) await walk(e, path);
        }
      }
    };
    for (const e of entries) await walk(e, '');
    return out;
  })();
}

/** Файлы из <input webkitdirectory>. */
export function filesFromInput(fileList) {
  return [...fileList].map((file) => {
    const rel = file.webkitRelativePath || '';
    return { file, dir: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '' };
  });
}

export function UploadProvider({ children }) {
  const { toast, tree } = useApp();
  const tasksRef = useRef([]);
  const [, setVersion] = useState(0);
  const renderTimer = useRef(null);
  const [collapsed, setCollapsed] = useState(false);

  const rerender = useCallback((now = false) => {
    if (now) {
      clearTimeout(renderTimer.current);
      renderTimer.current = null;
      setVersion((v) => v + 1);
      return;
    }
    if (renderTimer.current) return;
    renderTimer.current = setTimeout(() => {
      renderTimer.current = null;
      setVersion((v) => v + 1);
    }, 200);
  }, []);

  const pump = useCallback(() => {
    const tasks = tasksRef.current;
    let running = tasks.filter((t) => t.status === 'uploading').length;
    for (const task of tasks) {
      if (running >= CONCURRENCY) break;
      if (task.status !== 'queued') continue;
      running++;
      task.status = 'uploading';
      task.controller = new AbortController();
      uploadFile(task, (loaded) => {
        task.loaded = loaded;
        rerender();
      })
        .then((item) => {
          task.status = 'done';
          task.loaded = task.size;
          task.item = item;
          notifyChanged(task.folderId);
        })
        .catch((err) => {
          if (err.name === 'AbortError') return;
          task.status = 'error';
          task.error = err.message;
        })
        .finally(() => {
          rerender(true);
          pump();
        });
    }
    rerender(true);
  }, [rerender]);

  /** entries: [{file, dir}] — dir пустой для файлов в корне; [{dir}] — пустые папки. */
  const addEntries = useCallback(
    async (folderId, entries) => {
      const files = entries.filter((e) => e.file && !IGNORED.has(e.file.name));
      const dirs = [...new Set(entries.flatMap((e) => {
        if (!e.dir) return [];
        const parts = e.dir.split('/');
        return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
      }))].sort((a, b) => a.split('/').length - b.split('/').length);

      // Повторяем структуру папок с компьютера в виде разделов.
      const dirIds = { '': folderId };
      if (dirs.length) {
        try {
          for (const d of dirs) {
            const parent = dirIds[d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : ''];
            const created = await api.post('/folders', { name: d.split('/').pop(), parent_id: parent, kind: 'section' });
            dirIds[d] = created.id;
          }
        } catch (e) {
          toast(`Не удалось создать папку: ${e.message}`, 'error');
          return;
        } finally {
          notifyFolders();
        }
      }
      if (!files.length) return;
      for (const { file, dir } of files) {
        const fid = dirIds[dir || ''];
        tasksRef.current.push({
          id: `${Date.now()}-${Math.random()}`, file, name: file.name, size: file.size, loaded: 0,
          folderId: fid, status: 'queued',
        });
      }
      setCollapsed(false);
      toast(`В очереди ${files.length} ${plural(files.length, 'файл', 'файла', 'файлов')}`);
      pump();
    },
    [pump, toast],
  );

  const cancel = useCallback(
    (task) => {
      task.controller?.abort();
      if (task.uploadId) api.del(`/uploads/${task.uploadId}`).catch(() => {});
      task.status = 'canceled';
      tasksRef.current = tasksRef.current.filter((t) => t !== task);
      pump();
    },
    [pump],
  );

  const retry = useCallback(
    (task) => {
      task.status = 'queued';
      task.error = null;
      pump();
    },
    [pump],
  );

  const clearFinished = useCallback(() => {
    tasksRef.current = tasksRef.current.filter((t) => t.status === 'uploading' || t.status === 'queued');
    rerender(true);
  }, [rerender]);

  const cancelAll = useCallback(() => {
    for (const t of [...tasksRef.current]) if (t.status !== 'done') cancel(t);
    clearFinished();
  }, [cancel, clearFinished]);

  const tasks = tasksRef.current;
  const active = tasks.some((t) => t.status === 'uploading' || t.status === 'queued');

  useEffect(() => {
    if (!active) return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);

  return (
    <UploadContext.Provider value={{ addEntries }}>
      {children}
      {tasks.length > 0 && (
        <UploadPanel
          tasks={tasks} tree={tree} collapsed={collapsed} setCollapsed={setCollapsed}
          cancel={cancel} retry={retry} clearFinished={clearFinished} cancelAll={cancelAll}
        />
      )}
    </UploadContext.Provider>
  );
}

function UploadPanel({ tasks, tree, collapsed, setCollapsed, cancel, retry, clearFinished, cancelAll }) {
  const total = tasks.reduce((s, t) => s + t.size, 0);
  const loaded = tasks.reduce((s, t) => s + (t.loaded || 0), 0);
  const done = tasks.filter((t) => t.status === 'done').length;
  const failed = tasks.filter((t) => t.status === 'error').length;
  const active = tasks.some((t) => t.status === 'uploading' || t.status === 'queued');
  const pct = total ? Math.round((loaded / total) * 100) : 100;

  // Порядок: сначала идущие, затем ошибки, очередь, готовые.
  const order = { uploading: 0, error: 1, queued: 2, done: 3 };
  const list = [...tasks].sort((a, b) => order[a.status] - order[b.status]).slice(0, 300);

  return (
    <div className={`upload-panel ${collapsed ? 'collapsed' : ''}`}>
      <div className="upload-head" onClick={() => setCollapsed(!collapsed)}>
        <div className="upload-head-icon">
          {active ? <UploadCloud size={18} /> : failed ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
        </div>
        <div className="upload-head-text">
          <strong>{active ? `Загрузка… ${pct}%` : failed ? `Ошибок: ${failed}` : 'Загрузка завершена'}</strong>
          <span>
            {done} из {tasks.length} · {fmtSize(loaded)} из {fmtSize(total)}
          </span>
        </div>
        <button className="icon-btn" aria-label="Свернуть">{collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
        {!active && (
          <button className="icon-btn" aria-label="Закрыть" onClick={(e) => { e.stopPropagation(); clearFinished(); }}>
            <X size={16} />
          </button>
        )}
      </div>
      <div className="progress"><div style={{ width: `${pct}%` }} /></div>
      {!collapsed && (
        <>
          <div className="upload-list">
            {list.map((t) => {
              const p = t.size ? Math.round(((t.loaded || 0) / t.size) * 100) : 100;
              const ext = t.name.includes('.') ? t.name.split('.').pop().toLowerCase() : '';
              return (
                <div key={t.id} className={`upload-row ${t.status}`}>
                  <FileIcon ext={ext} size={28} />
                  <div className="upload-row-main">
                    <div className="upload-name" title={t.name}>{t.name}</div>
                    <div className="upload-sub">
                      {t.status === 'error' ? <span className="danger-text">{t.error}</span>
                        : t.status === 'done' ? <>Готово · {tree.byId.get(t.folderId)?.name || ''}</>
                        : t.status === 'queued' ? <>В очереди · {fmtSize(t.size)}</>
                        : <>{fmtSize(t.loaded)} из {fmtSize(t.size)} · {p}%</>}
                    </div>
                    {t.status === 'uploading' && <div className="progress thin"><div style={{ width: `${p}%` }} /></div>}
                  </div>
                  {t.status === 'done' && <CheckCircle2 size={18} className="ok-icon" />}
                  {t.status === 'error' && (
                    <button className="icon-btn" onClick={() => retry(t)} aria-label="Повторить"><RotateCw size={15} /></button>
                  )}
                  {t.status !== 'done' && (
                    <button className="icon-btn" onClick={() => cancel(t)} aria-label="Отменить"><X size={15} /></button>
                  )}
                </div>
              );
            })}
          </div>
          {active && (
            <div className="upload-foot">
              <button className="btn btn-small" onClick={cancelAll}>Отменить все</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
