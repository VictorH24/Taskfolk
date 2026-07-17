const { ipcRenderer, webFrame } = require('electron');

const avatarMode = new URLSearchParams(window.location.search).get('companionView') === 'avatar';
const loadingLabel = avatarMode ? 'Loading avatar' : 'Loading office';

ipcRenderer.on('office:system-resume', () => {
  window.dispatchEvent(new Event('taskfolk:system-resume'));
});

webFrame.insertCSS(`
  html:not(.companion-revealing):not(.companion-revealed) body {
    opacity: 0 !important;
  }
  html:not(.companion-revealed)::before,
  html:not(.companion-revealed)::after {
    content: "";
    position: fixed;
    z-index: 2147483647;
    pointer-events: none;
  }
  html:not(.companion-revealed)::before {
    left: 50%;
    top: 50%;
    width: 54px;
    height: 54px;
    margin: -38px 0 0 -27px;
    border: 4px solid rgba(101, 228, 180, .16);
    border-top-color: #65e4b4;
    border-right-color: rgba(101, 228, 180, .68);
    border-radius: 50%;
    background: rgba(8, 13, 20, .82);
    box-shadow: 0 10px 34px rgba(0, 0, 0, .28), inset 0 0 0 8px rgba(8, 13, 20, .56);
    animation: clawCompanionSpin .8s linear infinite;
  }
  html:not(.companion-revealed)::after {
    content: "${loadingLabel}";
    left: 50%;
    top: calc(50% + 30px);
    transform: translateX(-50%);
    padding: 5px 9px;
    border-radius: 999px;
    background: rgba(8, 13, 20, .78);
    color: #dce4ec;
    font: 700 10px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    letter-spacing: .04em;
    white-space: nowrap;
    animation: clawCompanionPulse 1.1s ease-in-out infinite;
  }
  html.companion-revealing body {
    animation: clawCompanionPageIn .24s ease-out both;
  }
  html.companion-revealing::before,
  html.companion-revealing::after {
    animation: clawCompanionLoaderOut .2s ease-in both;
  }
  @keyframes clawCompanionSpin {
    to { transform: rotate(360deg); }
  }
  @keyframes clawCompanionPulse {
    0%, 100% { opacity: .55; }
    50% { opacity: 1; }
  }
  @keyframes clawCompanionPageIn {
    from { opacity: 0; transform: scale(.985); }
    to { opacity: 1; transform: scale(1); }
  }
  @keyframes clawCompanionLoaderOut {
    to { opacity: 0; }
  }
`);

let dragging = false;
let framePending = false;
let captureTarget = null;
let revealStarted = false;
let lastMouseIgnore = false;
const alphaCanvas = document.createElement('canvas');
alphaCanvas.width = 1;
alphaCanvas.height = 1;
const alphaContext = alphaCanvas.getContext('2d', { willReadFrequently: true });

ipcRenderer.send('office-window-mouse:ignore', false);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForImages(container) {
  const images = Array.from(container.querySelectorAll('img'));
  if (!images.length) return;
  await Promise.race([
    Promise.all(images.map(async (image) => {
      if (!image.complete) {
        await new Promise((resolve) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        });
      }
      try { await image.decode(); } catch {}
    })),
    delay(1400)
  ]);
}

async function revealWhenReady() {
  if (revealStarted) return;
  const selector = avatarMode
    ? '.companionAvatar, .companionAvatarEmpty, .emptyOffice'
    : '.pixelOfficeScene, .emptyOffice';
  const content = document.querySelector(selector);
  if (!content) return;
  revealStarted = true;
  await waitForImages(content);
  await delay(avatarMode ? 40 : 180);
  document.documentElement.classList.add('companion-revealing');
  await delay(240);
  document.documentElement.classList.remove('companion-revealing');
  document.documentElement.classList.add('companion-revealed');
}

window.addEventListener('DOMContentLoaded', () => {
  revealWhenReady();
  const observer = new MutationObserver(() => {
    revealWhenReady();
    if (revealStarted) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  if (avatarMode) {
    const unavailableStateObserver = new MutationObserver(() => {
      if (document.querySelector('.companionAvatarEmpty.agentLoadFailure')) setMouseIgnore(false);
    });
    unavailableStateObserver.observe(document.body, { childList: true, subtree: true });
  }
});

function setMouseIgnore(ignore) {
  const next = Boolean(ignore);
  if (next === lastMouseIgnore) return;
  lastMouseIgnore = next;
  ipcRenderer.send('office-window-mouse:ignore', next);
}

function loaderContainsPoint(x, y) {
  return Math.abs(x - window.innerWidth / 2) <= 82
    && Math.abs(y - window.innerHeight / 2) <= 68;
}

function avatarContainsOpaquePixel(x, y) {
  if (!document.documentElement.classList.contains('companion-revealed')) {
    return loaderContainsPoint(x, y);
  }
  // Keep the whole companion window available while its agent cannot be
  // displayed so users can always reach the native menu with a right-click.
  if (document.querySelector('.companionAvatarEmpty.agentLoadFailure')) return true;
  const target = document.elementFromPoint(x, y);
  if (target instanceof Element && target.closest('[data-companion-interactive]')) return true;
  const image = document.querySelector('.companionAvatar .sceneArt');
  if (!(image instanceof HTMLImageElement) || !image.complete || !image.naturalWidth || !image.naturalHeight) return false;
  const rect = image.getBoundingClientRect();
  const scale = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
  const drawnWidth = image.naturalWidth * scale;
  const drawnHeight = image.naturalHeight * scale;
  const left = rect.left + (rect.width - drawnWidth) / 2;
  const top = rect.top + (rect.height - drawnHeight) / 2;
  if (x < left || x > left + drawnWidth || y < top || y > top + drawnHeight) return false;

  const imageX = Math.floor((x - left) / scale);
  const imageY = Math.floor((y - top) / scale);
  const sourceX = Math.max(0, Math.min(image.naturalWidth - 1, imageX - 2));
  const sourceY = Math.max(0, Math.min(image.naturalHeight - 1, imageY - 2));
  const sourceWidth = Math.min(5, image.naturalWidth - sourceX);
  const sourceHeight = Math.min(5, image.naturalHeight - sourceY);

  try {
    alphaContext.clearRect(0, 0, 1, 1);
    alphaContext.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, 1, 1);
    return alphaContext.getImageData(0, 0, 1, 1).data[3] >= 24;
  } catch {
    return true;
  }
}

window.addEventListener('mousemove', (event) => {
  if (!avatarMode) return setMouseIgnore(false);
  if (dragging) return setMouseIgnore(false);
  setMouseIgnore(!avatarContainsOpaquePixel(event.clientX, event.clientY));
}, true);

window.addEventListener('mouseleave', () => {
  if (avatarMode && !dragging) setMouseIgnore(true);
});

function nearResizeEdge(event) {
  const edge = 6;
  return event.clientX <= edge
    || event.clientY <= edge
    || event.clientX >= window.innerWidth - edge
    || event.clientY >= window.innerHeight - edge;
}

function finishDrag() {
  if (!dragging) return;
  dragging = false;
  framePending = false;
  document.body?.classList.remove('companion-dragging');
  ipcRenderer.send('office-window-drag:end');
  captureTarget = null;
}

window.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || nearResizeEdge(event)) return;
  if (event.target instanceof Element && event.target.closest('[data-companion-interactive]')) return;
  dragging = true;
  captureTarget = event.target instanceof Element ? event.target : document.documentElement;
  try { captureTarget.setPointerCapture(event.pointerId); } catch {}
  document.body?.classList.add('companion-dragging');
  ipcRenderer.send('office-window-drag:start');
  event.preventDefault();
}, true);

window.addEventListener('pointermove', (event) => {
  if (!dragging || framePending) return;
  framePending = true;
  requestAnimationFrame(() => {
    framePending = false;
    if (dragging) ipcRenderer.send('office-window-drag:move');
  });
  event.preventDefault();
}, true);

window.addEventListener('pointerup', finishDrag, true);
window.addEventListener('pointercancel', finishDrag, true);
window.addEventListener('blur', finishDrag);
