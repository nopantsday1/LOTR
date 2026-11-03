export function initNavigation() {
  const section = document.querySelector("main .page[data-page]");
  // A sub-page can light up its parent tab with data-nav, e.g. the tournament
  // management page highlights "Tournaments".
  const page = section?.dataset.nav || section?.dataset.page;

  document.querySelectorAll(".tabs a[data-page]").forEach(link => {
    if (link.dataset.page === page) {
      link.classList.add("active");
    } else {
      link.classList.remove("active");
    }
  });
}
