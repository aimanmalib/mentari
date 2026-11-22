// Scales the 1920 x 1080 stage to the window and moves between slides with the arrow keys, space or a swipe.
// window.presentation.goToSlide(n) lets an export script show one slide at a time.
(() => {
  const stage = document.querySelector(".deck-stage");
  const slides = [...document.querySelectorAll(".slide")];
  const nav = document.createElement("div");
  nav.className = "deck-controls";
  nav.setAttribute("aria-hidden", "true");
  slides.forEach(() => nav.appendChild(document.createElement("i")));
  document.body.appendChild(nav);
  let current = 0;

  function fit() {
    const s = Math.min(innerWidth / 1920, innerHeight / 1080);
    stage.style.transform = `translate(${(innerWidth - 1920 * s) / 2}px, ${(innerHeight - 1080 * s) / 2}px) scale(${s})`;
  }
  function go(n) {
    current = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach((el, k) => el.classList.toggle("active", k === current));
    [...nav.children].forEach((d, k) => d.classList.toggle("on", k === current));
  }

  window.presentation = { goToSlide: go };
  addEventListener("resize", fit);
  addEventListener("keydown", (e) => {
    if (["ArrowRight", "PageDown", " "].includes(e.key)) go(current + 1);
    if (["ArrowLeft", "PageUp"].includes(e.key)) go(current - 1);
    if (e.key === "Home") go(0);
    if (e.key === "End") go(slides.length - 1);
  });
  let x0 = null;
  addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  addEventListener("touchend", (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 40) go(current + (dx < 0 ? 1 : -1));
    x0 = null;
  });
  fit();
  go(0);
})();
