(() => {
  const POSE_TO_IMAGE = {
    working: 'working.gif',
    blocked: 'blocked.gif',
    sleeping: 'sleeping.gif',
    reading: 'reading.gif',
    gaming: 'gaming.png',
    coffee: 'coffee.gif',
    headphones: 'music.gif',
    music: 'music.gif',
    walking: 'walking.gif',
    meeting: 'working.gif'
  };

  function variantKey(variant) {
    return String(variant ?? 0);
  }

  function gifVariantPaths(version, image) {
    return [
      `./avatar-scenes/variants/v${version}_gif/${image.replace(/\.png$/i, '.gif')}`,
      `./avatar-scenes/variants/v${version}_gif/${image.replace(/\.gif$/i, '.png')}`,
      `./avatar-scenes/variants/v${version}/${image.replace(/\.gif$/i, '.png')}`
    ];
  }

  function imagePaths(image, variant) {
    const key = variantKey(variant);
    if (key === '0') {
      return gifVariantPaths(0, image);
    }
    if (key === 'v0') {
      return [`./avatar-scenes/variants/v0/${image.replace(/\.gif$/i, '.png')}`];
    }
    const gifMatch = key.match(/^v([1-7])_gif$/);
    if (gifMatch) {
      return gifVariantPaths(gifMatch[1], image);
    }
    const nextVariant = Number(key) || 0;
    return [`./avatar-scenes/variants/v${nextVariant}/${image.replace(/\.gif$/i, '.png')}`];
  }

  function fallbackSources(paths) {
    return paths.slice(1).join('|');
  }

  function handleImageError(event) {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.classList.contains('sceneArt')) return;
    const sources = (image.dataset.fallbackSrcs || '').split('|').filter(Boolean);
    const index = Number(image.dataset.fallbackIndex || 0);
    const nextSource = sources[index];
    if (!nextSource) return;
    image.dataset.fallbackIndex = String(index + 1);
    image.src = nextSource;
  }

  function esc(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[char]));
  }

  function sceneMarkup({ pose, role, label, variant = 0, showLabel = true }) {
    const image = POSE_TO_IMAGE[pose] || POSE_TO_IMAGE.working;
    const paths = imagePaths(image, variant);
    const roleClass = esc(role || 'agent');
    const poseClass = esc(pose || 'working');
    const variantClass = `variant-${variantKey(variant).replace(/[^a-z0-9_-]/gi, '-')}`;
    const title = esc(label || '');
    const caption = showLabel && title ? `<span class="sceneCaption">${title}</span>` : '';
    return `
      <div class="sceneFigure sceneFigure--${poseClass} role-${roleClass} ${variantClass}">
        <img
          class="sceneArt sceneArt--${poseClass} role-${roleClass}"
          src="${paths[0]}"
          data-fallback-srcs="${esc(fallbackSources(paths))}"
          alt="${title}"
          draggable="false"
        />
        ${caption}
      </div>`;
  }

  window.addEventListener('error', handleImageError, true);
  window.SceneArt = { sceneMarkup };
})();
