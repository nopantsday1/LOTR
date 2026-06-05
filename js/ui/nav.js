export function initNavigation() {
  const page = document.querySelector("main .page[data-page]")?.dataset.page;

  document.querySelectorAll(".tabs a[data-page]").forEach(link => {
    if (link.dataset.page === page) {
      link.classList.add("active");
    } else {
      link.classList.remove("active");
    }
  });
}