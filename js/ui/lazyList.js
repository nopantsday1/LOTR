// Chunked list rendering.
//
// The History page used to build all ~966 match cards on every render: roughly
// 60,000 DOM nodes, a 3MB HTML string, and ~4.2s of layout. Rendering a screenful
// at a time and appending as the reader scrolls removes almost all of that,
// because layout cost scales with the nodes actually in the document.
//
// Usage:
//   const list = createLazyList(container, { renderItem, pageSize: 20 });
//   list.setItems(matches);        // resets to the first chunk
//   list.destroy();                // on teardown
//
// Falls back to rendering everything when IntersectionObserver is unavailable,
// so behaviour degrades to the old path rather than showing a truncated list.

const DEFAULT_PAGE_SIZE = 20;

// Start loading before the sentinel is actually on screen, so the next chunk is
// usually already there by the time the reader reaches it.
const PREFETCH_PX = 600;
const PREFETCH_MARGIN = `${PREFETCH_PX}px`;

export function createLazyList(container, options = {}) {
  const {
    renderItem,
    pageSize = DEFAULT_PAGE_SIZE,
    emptyHtml = '<p class="muted">Nothing to show.</p>',
    onRendered
  } = options;

  if (!container) return nullList();
  if (typeof renderItem !== "function") {
    throw new Error("createLazyList requires a renderItem function");
  }

  let items = [];
  let rendered = 0;
  let observer = null;
  let sentinel = null;
  let footer = null;
  let viewportListenersBound = false;

  const supportsObserver = typeof IntersectionObserver === "function";

  function teardownObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  function renderChunk() {
    if (rendered >= items.length) return false;

    const next = items.slice(rendered, rendered + pageSize);
    const html = next.map((item, index) => renderItem(item, rendered + index)).join("");

    // insertAdjacentHTML appends without re-parsing what is already there, which
    // matters once the list is long.
    if (sentinel) sentinel.insertAdjacentHTML("beforebegin", html);
    else container.insertAdjacentHTML("beforeend", html);

    rendered += next.length;
    updateFooter();
    onRendered?.(rendered, items.length);
    return true;
  }

  // Append chunks while the sentinel is near the viewport, a few at a time.
  //
  // Deliberately synchronous, and deliberately without an "in progress" flag.
  // An earlier version drove this with requestAnimationFrame behind a `filling`
  // guard, which deadlocked: rAF does not run in a hidden or background tab, so
  // the guard stayed set and every later call returned immediately, leaving the
  // list frozen at its first chunk. setTimeout still fires in that state.
  const CHUNKS_PER_PASS = 3;

  function sentinelIsNear() {
    const rect = sentinel?.getBoundingClientRect();
    if (!rect) return false;
    // An all-zero rect means layout is unavailable (hidden or background tab),
    // not that the sentinel is parked at the top of the viewport. Treating it as
    // visible would render the whole list -- the cost this module exists to
    // avoid -- so stop and wait for the page to become visible.
    const hasLayout = rect.top !== 0 || rect.height !== 0 || rect.width !== 0;
    return hasLayout && rect.top < window.innerHeight + PREFETCH_PX;
  }

  function fill() {
    let appended = 0;

    while (rendered < items.length && appended < CHUNKS_PER_PASS) {
      if (!sentinelIsNear()) break;
      renderChunk();
      appended += 1;
    }

    if (rendered >= items.length) {
      teardownObserver();
      updateFooter();
      return;
    }

    // Hit the cap with more still wanted: yield, then continue. Without this the
    // observer would never re-fire, because a sentinel that stays on screen
    // produces no intersection *change*.
    if (appended >= CHUNKS_PER_PASS) window.setTimeout(fill, 0);
  }

  // Safety net: never depend solely on observer transitions. A scroll or resize
  // that leaves the sentinel already-intersecting produces no observer callback.
  function onViewportChange() {
    if (!sentinel || rendered >= items.length) return;
    fill();
  }

  function updateFooter() {
    if (!footer) return;
    const remaining = items.length - rendered;

    if (remaining <= 0) {
      footer.hidden = true;
      footer.innerHTML = "";
      return;
    }

    footer.hidden = false;
    // A real button, so the list is usable without scrolling and by keyboard.
    footer.innerHTML = `
      <button class="btn lazy-list-more" type="button">
        Show ${Math.min(pageSize, remaining)} more
      </button>
      <span class="muted small">Showing ${rendered} of ${items.length}</span>
    `;
  }

  function onFooterClick(event) {
    if (!event.target.closest(".lazy-list-more")) return;
    renderChunk();
    fill();
  }

  function setItems(nextItems) {
    items = Array.isArray(nextItems) ? nextItems : [];
    rendered = 0;
    teardownObserver();
    container.innerHTML = "";

    if (!items.length) {
      container.innerHTML = emptyHtml;
      return;
    }

    if (!supportsObserver) {
      container.insertAdjacentHTML(
        "beforeend",
        items.map((item, index) => renderItem(item, index)).join("")
      );
      rendered = items.length;
      onRendered?.(rendered, items.length);
      return;
    }

    sentinel = document.createElement("div");
    sentinel.className = "lazy-list-sentinel";
    sentinel.setAttribute("aria-hidden", "true");
    container.appendChild(sentinel);

    footer = document.createElement("div");
    footer.className = "lazy-list-footer";
    container.appendChild(footer);
    footer.addEventListener("click", onFooterClick);

    renderChunk();

    observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) fill();
    }, { rootMargin: PREFETCH_MARGIN });
    observer.observe(sentinel);

    // setItems runs on every search keystroke and data refresh, so these are
    // attached once for the lifetime of the list rather than per call.
    if (!viewportListenersBound) {
      window.addEventListener("scroll", onViewportChange, { passive: true });
      window.addEventListener("resize", onViewportChange, { passive: true });
      viewportListenersBound = true;
    }

    fill();
  }

  function destroy() {
    teardownObserver();
    window.removeEventListener("scroll", onViewportChange);
    window.removeEventListener("resize", onViewportChange);
    viewportListenersBound = false;
    footer?.removeEventListener("click", onFooterClick);
    items = [];
    rendered = 0;
    sentinel = null;
    footer = null;
  }

  return {
    setItems,
    destroy,
    get renderedCount() { return rendered; },
    get totalCount() { return items.length; }
  };
}

function nullList() {
  return {
    setItems() {},
    destroy() {},
    get renderedCount() { return 0; },
    get totalCount() { return 0; }
  };
}
