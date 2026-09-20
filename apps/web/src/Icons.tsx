export function Icon({
  name,
}: {
  name:
    | "archive"
    | "info"
    | "stop"
    | "logout"
    | "key"
    | "folder"
    | "compose"
    | "plus"
    | "panel"
    | "more"
    | "search"
    | "settings"
    | "copy"
    | "check"
    | "thumb-up"
    | "thumb-down"
    | "harbor"
    | "arrow";
}) {
  const paths = {
    archive: "M4 9h16v12H4ZM3 3h18v6H3ZM9 13h6",
    info: "M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
    stop: "M5 5h14v14H5Z",
    logout: "M9 4H4v16h5M13 8l4 4-4 4M8 12h13",
    key: "M14 9a5 5 0 1 1-10 0 5 5 0 0 1 10 0ZM13 12l8 8M17 16l3-3",

    search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
    settings:
      "M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
    copy: "M9 8V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-3M5 8h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Z",
    check: "m5 12 4 4L19 6",
    "thumb-up":
      "M7 10v11H3V10ZM7 10l5-8c3 0 3 3 1 7h6a2 2 0 0 1 2 2l-2 8a2 2 0 0 1-2 2H7",
    "thumb-down":
      "M7 14V3H3v11ZM7 14l5 8c3 0 3-3 1-7h6a2 2 0 0 0 2-2l-2-8a2 2 0 0 0-2-2H7",
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
      {name === "more" ? (
        [5, 12, 19].map((cx) => (
          <circle
            key={cx}
            cx={cx}
            cy="12"
            r="1.8"
            fill="currentColor"
            stroke="none"
          />
        ))
      ) : (
        <path d={paths[name]} />
      )}
    </svg>
  );
}
