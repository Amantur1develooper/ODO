import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export function Modal({ title, onClose, children, footer, width = 460, className = '' }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${className}`} style={{ width }} role="dialog" aria-modal="true" aria-label={title}>
        {title && (
          <div className="modal-head">
            <h2>{title}</h2>
            <button className="icon-btn" onClick={() => onClose?.()} aria-label="Закрыть">
              <X size={18} />
            </button>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ title, text, ok = 'OK', danger = false, onClose }) {
  const okRef = useRef(null);
  useEffect(() => {
    okRef.current?.focus();
  }, []);
  return (
    <Modal
      title={title}
      onClose={() => onClose(false)}
      width={400}
      footer={
        <>
          <button className="btn" onClick={() => onClose(false)}>Отмена</button>
          <button ref={okRef} className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => onClose(true)}>{ok}</button>
        </>
      }
    >
      {text && <p className="muted">{text}</p>}
    </Modal>
  );
}

/** Форма в модальном окне: submit с индикатором и выводом ошибки. */
export function FormModal({ title, submitLabel = 'Сохранить', onSubmit, onClose, children, width, danger }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={() => onClose(null)} width={width}>
      <form onSubmit={submit} className="form">
        {children}
        {error && <div className="form-error">{error}</div>}
        <div className="modal-foot inline">
          <button type="button" className="btn" onClick={() => onClose(null)}>Отмена</button>
          <button type="submit" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy}>
            {busy ? 'Сохраняю…' : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
