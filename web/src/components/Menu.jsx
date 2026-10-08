import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isMobile } from '../utils';

/** Контекстное меню в духе macOS. items: [{label, icon, onClick, danger, hidden} | 'divider'] */
export function ContextMenu({ x, y, items, title, onClose }) {
  const ref = useRef(null);
  const [sheet] = useState(isMobile);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || sheet) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    });
  }, [x, y]);

  useEffect(() => {
    const close = (e) => {
      if (e.type === 'keydown' && e.key !== 'Escape') return;
      if (e.type === 'mousedown' && ref.current?.contains(e.target)) return;
      onClose();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    if (!sheet) document.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
      document.removeEventListener('scroll', onClose, true);
    };
  }, [onClose, sheet]);

  const visible = items.filter((i) => i && !i.hidden);
  // Убираем разделители в начале, в конце и повторяющиеся.
  const clean = visible.filter((it, idx, arr) => it !== 'divider' || (idx > 0 && idx < arr.length - 1 && arr[idx - 1] !== 'divider'));

  const button = (it, i) => (
    <button
      key={i}
      role="menuitem"
      className={`menu-item ${it.danger ? 'danger' : ''}`}
      onClick={() => {
        onClose();
        it.onClick?.();
      }}
    >
      {it.icon && <it.icon size={sheet ? 19 : 15} />}
      <span>{it.label}</span>
    </button>
  );

  if (sheet) {
    // На телефоне — «шторка» снизу, как Action Sheet в iOS.
    return createPortal(
      <div className="sheet-backdrop">
        <div ref={ref} className="action-sheet" role="menu">
          <div className="sheet-group">
            {title && <div className="sheet-title">{title}</div>}
            {clean.map((it, i) => (it === 'divider' ? <div key={i} className="menu-divider" /> : button(it, i)))}
          </div>
          <button className="sheet-cancel" onClick={onClose}>Отмена</button>
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div ref={ref} className="menu" style={pos} role="menu">
      {clean.map((it, i) =>
        it === 'divider' ? (
          <div key={i} className="menu-divider" />
        ) : (
          button(it, i)
        ),
      )}
    </div>,
    document.body,
  );
}
