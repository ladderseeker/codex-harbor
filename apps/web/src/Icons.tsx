export function Icon({
  name,
}: {
  name: "folder" | "compose" | "plus" | "panel" | "more" | "harbor" | "arrow";
}) {
  const paths = {
    folder:
      "M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7ZM3 9h18",
    compose:
      "M11 4H6a3 3 0 0 0-3 3v11a3 3 0 0 0 3 3h11a3 3 0 0 0 3-3v-5M16 3a2.1 2.1 0 0 1 3 3l-8 8-4 1 1-4Z",
    plus: "M12 5v14M5 12h14",
    panel:
      "M6 4h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3ZM9 4v16",
    more: "M5 12h.01M12 12h.01M19 12h.01",
    harbor: "M6 19V8a6 6 0 0 1 12 0v11M2 23h20M10 19V9",
    arrow: "m6 10 6-6 6 6M12 4v16",
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d={paths[name]} />
    </svg>
  );
}
