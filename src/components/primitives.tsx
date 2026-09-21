import { useEffect, useRef, useId, type ReactNode } from "react";
import { FileText, X } from "lucide-react";

/** Keeps local form state while a secondary section opens or closes. */
export function Collapsible({
  open,
  id,
  children,
}: {
  open: boolean;
  id?: string;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      className="collapsible"
      data-open={open}
      inert={!open}
      aria-hidden={!open}
    >
      <div className="collapsible-content">{children}</div>
    </div>
  );
}
export function Empty({
  icon = <FileText />,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">{icon}</span>
      <h2>{title}</h2>
      {children}
    </div>
  );
}
export function Dialog({
  open,
  close,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  close: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (open) {
      if (!dialog.open) dialog.showModal();
      dialog.scrollTop = 0;
    } else if (!dialog.open) return;
    if (reduce) {
      if (!open) dialog.close();
      return;
    }
    const animation = dialog.animate(
      open
        ? [
            { opacity: 0, transform: "translateY(12px)" },
            { opacity: 1, transform: "translateY(0)" },
          ]
        : [
            { opacity: 1, transform: "translateY(0)" },
            { opacity: 0, transform: "translateY(8px)" },
          ],
      { duration: open ? 200 : 140, easing: "cubic-bezier(.2,.7,.2,1)" },
    );
    animation.onfinish = () => {
      if (!open) dialog.close();
    };
    return () => animation.cancel();
  }, [open]);
  return (
    <dialog
      className={wide ? "wide-dialog" : undefined}
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target !== ref.current) return;
        const bounds = e.currentTarget.getBoundingClientRect();
        if (
          e.clientX < bounds.left ||
          e.clientX > bounds.right ||
          e.clientY < bounds.top ||
          e.clientY > bounds.bottom
        )
          close();
      }}
    >
      <div className="dialog-head">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" onClick={close} aria-label="Close">
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
