window.renderAwakePrefs = function (s) {
  const onOff = [["off", t("Off")], ["on", t("On")]];
  $("#keepAwakeSegs").replaceChildren(segs([...onOff, ["display", t("Screen on too")]],
    !s.keepAwake ? "off" : s.keepAwakeDisplay ? "display" : "on",
    (v) => savePrefs({ keepAwake: v !== "off", keepAwakeDisplay: v === "display" })));
  $("#keepAwakeScopeSegs").replaceChildren(segs(onOff, s.keepAwakeAlways ? "off" : "on",
    (v) => savePrefs({ keepAwakeAlways: v === "off" })));

  const awakeSub = $("#keepAwakeRow .sub");
  awakeSub.hidden = !!s.keepAwakeAlways;
  awakeSub.dataset.en = s.keepAwake && s.keepAwakeDisplay
    ? "Keeps this computer and its screen awake while magpie runs tasks"
    : "Keeps this computer awake while magpie runs tasks";
  awakeSub.textContent = t(awakeSub.dataset.en);
};
