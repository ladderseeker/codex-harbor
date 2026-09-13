import { useEffect, useRef, useState } from "react";
export function SidebarResize({
  changed,
}: {
  changed: (width: number) => void;
}) {
  const preferred = useRef(260);
  const [width, setWidth] = useState(260);
  const [max, setMax] = useState(400);
  const handle = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; width: number } | null>(null);
  const update = () => {
    const maximum = Math.max(220, Math.min(400, window.innerWidth - 440));
    const value = Math.max(220, Math.min(maximum, preferred.current));
    setMax(maximum);
    setWidth(value);
    changed(value);
  };
  const finish = () => {
    const id = drag.current?.id;
    drag.current = null;
    if (id !== undefined && handle.current?.hasPointerCapture(id))
      handle.current.releasePointerCapture(id);
    document.body.classList.remove("resizing-sidebar");
  };
  useEffect(() => {
    update();
    const resize = () => {
      finish();
      update();
    };
    window.addEventListener("resize", resize);
    window.addEventListener("blur", finish);
    return () => {
      finish();
      window.removeEventListener("resize", resize);
      window.removeEventListener("blur", finish);
    };
  }, [changed]);
  return (
    <div
      ref={handle}
      className="sidebar-resize"
      role="separator"
      aria-label="Sidebar width"
      aria-orientation="vertical"
      aria-controls="project-sidebar"
      aria-valuemin={220}
      aria-valuemax={max}
      aria-valuenow={Math.round(width)}
      aria-valuetext={`${Math.round(width)} pixels`}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return;
        event.preventDefault();
        drag.current = { id: event.pointerId, x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus();
        document.body.classList.add("resizing-sidebar");
      }}
      onPointerMove={(event) => {
        if (drag.current?.id !== event.pointerId) return;
        preferred.current = Math.max(
          220,
          Math.min(max, drag.current.width + event.clientX - drag.current.x),
        );
        update();
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onKeyDown={(event) => {
        let value = width;
        if (event.key === "ArrowLeft") value -= 10;
        else if (event.key === "ArrowRight") value += 10;
        else if (event.key === "Home") value = 220;
        else if (event.key === "End") value = max;
        else return;
        event.preventDefault();
        preferred.current = Math.max(220, Math.min(max, value));
        update();
      }}
    />
  );
}
