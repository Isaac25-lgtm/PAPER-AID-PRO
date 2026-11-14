// Applies the saved appearance before the first paint (no flash of the wrong theme). Kept tiny and external:
// the Content-Security-Policy allows no inline scripts. Logic mirrors src/lib/theme.tsx.
(function () {
  var choice = "system";
  try {
    choice = window.localStorage.getItem("paperaid.theme") || "system";
  } catch (e) {
    /* storage unavailable: follow the device */
  }
  var dark = choice === "dark" || (choice === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
})();
