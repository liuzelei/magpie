window.renderAwakePrefs = function (s) {
  const mode = s.keepAwake
    ? (s.keepAwakeAlways ? "app" : "gateway") + (s.keepAwakeDisplay ? "-display" : "-awake")
    : "off";
  const choices = [
    { v: "off", name: "Off" },
    { v: "gateway-awake", name: "Stay awake during gateway tasks" },
    { v: "gateway-display", name: "Screen on during gateway tasks" },
    { v: "app-display", name: "Screen on while Magpie runs", note: "Works with the gateway paused" },
  ];
  // Keep an existing system-only continuous preference understandable, too.
  if (mode === "app-awake") choices.push({ v: mode, name: "Stay awake while Magpie runs" });
  const pick = $("#keepAwakePick");
  const name = t(choices.find((o) => o.v === mode).name);
  pick.title = name;
  pick.replaceChildren(el("span", "", name), svg(CHEV, 11, 1.6));
  pick.onclick = (e) => {
    e.stopPropagation();
    if (pick.classList.contains("open")) return closeProtoMenu();
    openProtoMenu(pick, choices, mode, (v) => {
      if (v === mode) return;
      savePrefs({
        keepAwake: v !== "off",
        keepAwakeDisplay: v.endsWith("-display"),
        keepAwakeAlways: v.startsWith("app-"),
      });
    }, "Prevent sleep", "sess-menu", "right");
  };
};
