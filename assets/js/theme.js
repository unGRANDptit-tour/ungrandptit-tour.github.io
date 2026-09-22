(function () {
  "use strict";
  function apply(mode) {
    if (mode === "dark" || mode === "light") {
      document.documentElement.setAttribute("data-theme", mode);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    try {
      if (mode) localStorage.setItem("ugpt-theme", mode);
      else localStorage.removeItem("ugpt-theme");
    } catch (e) {}
  }
  function current() {
    var stamped = document.documentElement.getAttribute("data-theme");
    if (stamped) return stamped;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  var btn = document.getElementById("themeToggleBtn");
  if (btn) {
    btn.addEventListener("click", function () {
      apply(current() === "dark" ? "light" : "dark");
    });
  }
})();
