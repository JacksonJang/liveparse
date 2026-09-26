const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root element');
const root: HTMLElement = rootElement;

let started = false;

function showLoadError(): void {
  root.innerHTML = `
    <section class="parser-fallback" aria-label="Discord timestamp generator failed to load">
      <p><strong>The Discord timestamp generator could not load.</strong></p>
      <p>Check your connection and reload the page. The timestamp reference below remains available.</p>
    </section>
  `;
}

async function loadGenerator(): Promise<void> {
  try {
    await import('./discord-timestamp-app');
  } catch (error) {
    console.error('Unable to load the Discord timestamp generator', error);
    showLoadError();
  }
}

function startWhenReady(): void {
  if (started) return;
  started = true;

  // Let the static page finish its first paint before hydrating the tool.
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  };
  const schedule = () => {
    if (typeof idleWindow.requestIdleCallback === 'function') {
      idleWindow.requestIdleCallback(loadGenerator, { timeout: 500 });
    } else {
      window.setTimeout(loadGenerator, 0);
    }
  };

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries, observer) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        schedule();
      }
    }, { rootMargin: '200px 0px' });
    observer.observe(root);
  } else {
    schedule();
  }
}

startWhenReady();
