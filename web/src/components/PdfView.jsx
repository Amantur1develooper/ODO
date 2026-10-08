import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

let pdfjsPromise = null;

/** PDF.js грузится только при первом открытии PDF на телефоне (~1 МБ). */
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist/build/pdf.min.mjs'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

/**
 * Постраничный просмотр PDF для телефонов: в Android Chrome встроенного просмотрщика нет,
 * а iOS в iframe показывает только первую страницу. Рендерятся только видимые страницы,
 * файл подгружается частями (Range-запросы), поэтому большие PDF открываются быстро.
 */
export function PdfView({ url }) {
  const containerRef = useRef(null);
  const [pages, setPages] = useState([]);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState(1);

  useEffect(() => {
    let cancelled = false;
    let doc = null;
    let observer = null;
    setPages([]);
    setError('');
    setCurrent(1);

    (async () => {
      const pdfjs = await loadPdfjs();
      doc = await pdfjs.getDocument({ url, disableAutoFetch: true }).promise;
      if (cancelled) return;
      const first = await doc.getPage(1);
      const base = first.getViewport({ scale: 1 });
      setPages(Array.from({ length: doc.numPages }, (_, i) => ({ n: i + 1, ratio: base.height / base.width })));

      const rendered = new Set();
      const render = async (el) => {
        const n = Number(el.dataset.page);
        if (rendered.has(n) || cancelled) return;
        rendered.add(n);
        const page = await doc.getPage(n);
        const width = el.clientWidth;
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        const viewport = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * dpr });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        if (cancelled) return;
        el.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
        el.replaceChildren(canvas);
      };

      requestAnimationFrame(() => {
        if (cancelled || !containerRef.current) return;
        observer = new IntersectionObserver((entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            render(e.target).catch(() => {});
          }
        }, { root: containerRef.current, rootMargin: '600px 0px' });
        containerRef.current.querySelectorAll('.pdf-page').forEach((el) => observer.observe(el));
      });
    })().catch((e) => !cancelled && setError(e?.message || 'Не удалось открыть PDF'));

    return () => {
      cancelled = true;
      observer?.disconnect();
      doc?.destroy();
    };
  }, [url]);

  if (error) {
    return (
      <div className="stage-message">
        <strong>Не удалось показать документ</strong>
        <span>{error}</span>
        <a className="btn btn-primary" href={url} target="_blank" rel="noreferrer">Открыть отдельно</a>
      </div>
    );
  }

  // Номер страницы, которая сейчас занимает экран.
  const onScroll = (e) => {
    const box = e.currentTarget;
    const mark = box.scrollTop + box.clientHeight / 3;
    let n = 1;
    for (const el of box.querySelectorAll('.pdf-page')) {
      if (el.offsetTop <= mark) n = Number(el.dataset.page);
      else break;
    }
    setCurrent(n);
  };

  return (
    <div className="pdf-view" ref={containerRef} onScroll={onScroll}>
      {!pages.length && <div className="stage-message"><Loader2 size={30} className="spin" /></div>}
      {pages.map((p) => (
        <div key={p.n} className="pdf-page" data-page={p.n} style={{ aspectRatio: `1 / ${p.ratio}` }} />
      ))}
      {pages.length > 1 && <div className="pdf-counter">{current} / {pages.length}</div>}
    </div>
  );
}
