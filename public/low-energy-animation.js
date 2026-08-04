(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('lowEnergy') !== '1') return;

  const FRAME_INTERVAL_MS = 200;
  const controllers = new WeakMap();
  let powerSuspended = false;

  function stop(image) {
    const controller = controllers.get(image);
    if (!controller) return;
    controller.stopped = true;
    clearTimeout(controller.timer);
    try { controller.decoder?.close(); } catch {}
    controller.canvas?.remove();
    image.classList.remove('lowEnergyAnimationSource');
    controllers.delete(image);
  }

  function mimeType(response, source) {
    const header = String(response.headers.get('content-type') || '').split(';')[0].trim();
    if (header.startsWith('image/')) return header;
    if (/\.gif(?:$|[?#])/i.test(source)) return 'image/gif';
    if (/\.png(?:$|[?#])/i.test(source)) return 'image/png';
    return 'image/webp';
  }

  async function control(image) {
    stop(image);
    if (!image.isConnected || image.hidden || !image.getAttribute('src') || typeof ImageDecoder !== 'function') return;

    const source = new URL(image.getAttribute('src'), document.baseURI).toString();
    const policy = image.dataset.lowEnergyAnimation || 'static';
    const controller = { stopped: false, timer: null, decoder: null, canvas: null };
    controllers.set(image, controller);

    try {
      const response = await fetch(source, { cache: 'force-cache' });
      if (!response.ok || controller.stopped) return stop(image);
      const type = mimeType(response, source);
      if (typeof ImageDecoder.isTypeSupported === 'function' && !(await ImageDecoder.isTypeSupported(type))) return stop(image);
      const data = await response.arrayBuffer();
      if (controller.stopped) return;
      const decoder = new ImageDecoder({ data, type, preferAnimation: true });
      controller.decoder = decoder;
      await decoder.tracks.ready;
      if (controller.stopped) return;
      const track = decoder.tracks.selectedTrack;
      const frameCount = Math.max(1, Number(track?.frameCount) || 1);
      if (frameCount <= 1) return stop(image);

      const canvas = document.createElement('canvas');
      canvas.className = `${image.className} lowEnergyAnimationCanvas`;
      canvas.setAttribute('aria-hidden', 'true');
      controller.canvas = canvas;
      image.after(canvas);
      image.classList.add('lowEnergyAnimationSource');
      const context = canvas.getContext('2d', { alpha: true });
      let frameIndex = 0;

      const render = async () => {
        if (controller.stopped || !image.isConnected || !canvas.isConnected) return stop(image);
        if (document.hidden || powerSuspended) {
          controller.timer = setTimeout(render, FRAME_INTERVAL_MS);
          return;
        }
        try {
          const result = await decoder.decode({ frameIndex, completeFramesOnly: true });
          const frame = result.image;
          const width = frame.displayWidth || frame.codedWidth;
          const height = frame.displayHeight || frame.codedHeight;
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
          }
          context.clearRect(0, 0, width, height);
          context.drawImage(frame, 0, 0, width, height);
          frame.close();
          if (policy === 'static') return;
          frameIndex = (frameIndex + 1) % frameCount;
          controller.timer = setTimeout(render, FRAME_INTERVAL_MS);
        } catch {
          stop(image);
        }
      };
      await render();
    } catch {
      stop(image);
    }
  }

  function scan(root = document) {
    if (root instanceof HTMLImageElement && root.matches('[data-low-energy-animation]')) void control(root);
    for (const image of root.querySelectorAll?.('img[data-low-energy-animation]') || []) void control(image);
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') void control(mutation.target);
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) scan(node);
      }
    }
  });

  window.addEventListener('DOMContentLoaded', () => {
    scan();
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['src', 'hidden']
    });
  }, { once: true });
  window.addEventListener('taskfolk:power-suspended', (event) => {
    powerSuspended = Boolean(event.detail);
  });
})();
