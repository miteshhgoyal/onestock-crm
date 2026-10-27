import { useRef } from "react";

const interactiveSelector = "a, button, input, select, textarea, [role='button']";

export default function HorizontalScrollArea({ children, className = "", ...props }) {
  const drag = useRef(null);
  const suppressClick = useRef(false);

  const onPointerDown = (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0 || event.target.closest(interactiveSelector)) return;
    drag.current = { startX: event.clientX, startScrollLeft: event.currentTarget.scrollLeft, moved: false };
    event.currentTarget.classList.add("is-dragging");
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event) => {
    if (!drag.current) return;
    const distance = event.clientX - drag.current.startX;
    if (Math.abs(distance) > 4) {
      drag.current.moved = true;
      event.preventDefault();
      event.currentTarget.scrollLeft = drag.current.startScrollLeft - distance;
    }
  };

  const onPointerUp = (event) => {
    event.currentTarget.classList.remove("is-dragging");
    if (drag.current?.moved) {
      suppressClick.current = true;
      window.requestAnimationFrame(() => { suppressClick.current = false; });
    }
    drag.current = null;
  };

  const onClickCapture = (event) => {
    if (!suppressClick.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClick.current = false;
  };

  return (
    <div
      {...props}
      className={`swipe-scroll-x ${className}`}
      role="region"
      aria-label={props["aria-label"] || "Scrollable report table"}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClickCapture={onClickCapture}
    >
      {children}
    </div>
  );
}