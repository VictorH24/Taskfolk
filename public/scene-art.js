(() => {
  const POSE_TO_IMAGE = {
    working: 'working.gif',
    success: 'success.gif',
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

  const workingImagesByVariant = new Map();
  const workingAnimationByAgent = new Map();
  const workingLayoutsByVariant = new Map();
  const gamingAnimationByAgent = new Map();
  const gamingLayoutsByVariant = new Map();
  let sharedWorkingImages = [];
  let sharedGamingImages = [];
  let workingCanvas = { width: 384, height: 512 };

  function variantKey(variant) {
    const key = String(variant ?? 'v0').trim();
    return key || 'v0';
  }

  function gifVariantPaths(variant, image) {
    const variantId = variantKey(variant);
    const encodedVariant = encodeURIComponent(variantId);
    const revision = variantId === 'v23' && image.replace(/\.png$/i, '.gif') === 'gaming.gif'
      ? '?rev=horizontal-3'
      : '';
    return [
      `./avatar-scenes/variants/${encodedVariant}/${image.replace(/\.png$/i, '.gif')}${revision}`,
      `./avatar-scenes/variants/${encodedVariant}/${image.replace(/\.gif$/i, '.png')}`
    ];
  }

  function imagePaths(image, variant) {
    return gifVariantPaths(variantKey(variant), image);
  }

  function animatedVariantId(variant) {
    return variantKey(variant);
  }

  function workingPool(variantId) {
    const avatarAnimations = (workingImagesByVariant.get(variantId) || ['working.gif'])
      .map((image) => ({ kind: 'avatar', image }));
    if (!workingLayoutsByVariant.has(variantId)) return avatarAnimations;
    return [
      ...avatarAnimations,
      ...sharedWorkingImages.map((image) => ({ kind: 'shared', image }))
    ];
  }

  function animationForPose(pose, variant, animationKey) {
    const defaultImage = POSE_TO_IMAGE[pose] || POSE_TO_IMAGE.working;
    const key = String(animationKey ?? '');
    const variantId = animatedVariantId(variant);
    const usesWorkingAnimation = pose === 'working' || pose === 'meeting';
    const usesGamingAnimation = pose === 'gaming';
    if ((!usesWorkingAnimation && !usesGamingAnimation) || !variantId) {
      if (key) workingAnimationByAgent.delete(key);
      if (key) gamingAnimationByAgent.delete(key);
      return { kind: 'avatar', image: defaultImage };
    }
    if (usesGamingAnimation) {
      if (key) workingAnimationByAgent.delete(key);
      if (!key || !gamingLayoutsByVariant.has(variantId) || !sharedGamingImages.length) {
        return { kind: 'avatar', image: defaultImage };
      }
      const current = gamingAnimationByAgent.get(key);
      if (!current || current.variantId !== variantId) {
        const index = Math.floor(Math.random() * sharedGamingImages.length);
        gamingAnimationByAgent.set(key, { variantId, kind: 'shared', image: sharedGamingImages[index] });
      }
      return gamingAnimationByAgent.get(key);
    }
    if (key) gamingAnimationByAgent.delete(key);
    if (!key) return { kind: 'avatar', image: defaultImage };

    const current = workingAnimationByAgent.get(key);
    if (!current || current.variantId !== variantId) {
      const pool = workingPool(variantId);
      const index = Math.floor(Math.random() * pool.length);
      workingAnimationByAgent.set(key, { variantId, ...pool[index] });
    }
    return workingAnimationByAgent.get(key);
  }

  function pathsForAvatarImage(image, variant) {
    if (image === 'working.gif') return imagePaths(image, variant);
    if (/^gaming\.(?:gif|png)$/i.test(image)) return imagePaths(image, variant);
    return [imagePaths(image, variant)[0], ...imagePaths('working.gif', variant)];
  }

  function layeredPaths(variantId) {
    return [
      `./avatar-scenes/variants/${encodeURIComponent(variantKey(variantId))}/working_alpha.png`,
      ...gifVariantPaths(variantId, 'working.gif')
    ];
  }

  function gamingLayeredPaths(variantId) {
    return [
      `./avatar-scenes/variants/${encodeURIComponent(variantKey(variantId))}/gaming_alpha.png`,
      ...gifVariantPaths(variantId, 'gaming.gif')
    ];
  }

  function fallbackSources(paths) {
    return paths.slice(1).join('|');
  }

  function layoutStyle(variantId, kind = 'working') {
    const layout = kind === 'gaming' ? gamingLayoutsByVariant.get(variantId) : workingLayoutsByVariant.get(variantId);
    if (!layout) return '';
    const width = Number(workingCanvas.width) || 384;
    const height = Number(workingCanvas.height) || 512;
    return [
      `--${kind}-screen-left:${(layout.left / width * 100).toFixed(5)}%`,
      `--${kind}-screen-top:${(layout.top / height * 100).toFixed(5)}%`,
      `--${kind}-screen-width:${(layout.width / width * 100).toFixed(5)}%`,
      `--${kind}-screen-height:${(layout.height / height * 100).toFixed(5)}%`
    ].join(';');
  }

  function applyGamingAnimation(stack, animation, variant) {
    const variantId = animatedVariantId(variant);
    const art = stack.querySelector('.sceneArt--gaming');
    const screen = stack.querySelector('.sceneGamingScreen');
    if (!art || !screen) return;
    const isLayered = animation.kind === 'shared' && gamingLayoutsByVariant.has(variantId);
    const artPaths = isLayered ? gamingLayeredPaths(variantId) : pathsForAvatarImage('gaming.gif', variant);
    stack.classList.toggle('is-layered', isLayered);
    stack.dataset.gamingKind = isLayered ? 'shared' : 'avatar';
    stack.style.cssText = isLayered ? layoutStyle(variantId, 'gaming') : '';
    art.dataset.animation = isLayered ? animation.image.replace(/\.gif$/i, '') : 'gaming';
    art.dataset.fallbackIndex = '0';
    art.dataset.fallbackSrcs = fallbackSources(artPaths);
    art.dataset.canonicalSrc = gifVariantPaths(variantId, 'gaming.gif')[0];
    art.src = artPaths[0];
    if (isLayered) {
      screen.hidden = false;
      screen.src = `./avatar-scenes/gaming-screens/${animation.image}`;
    } else {
      screen.hidden = true;
      screen.removeAttribute('src');
    }
  }

  function applyWorkingAnimation(stack, animation, variant) {
    const variantId = animatedVariantId(variant);
    const art = stack.querySelector('.sceneArt--working, .sceneArt--meeting');
    const screen = stack.querySelector('.sceneWorkingScreen');
    if (!art || !screen) return;
    const isLayered = animation.kind === 'shared' && workingLayoutsByVariant.has(variantId);
    const artPaths = isLayered ? layeredPaths(variantId) : pathsForAvatarImage(animation.image, variant);
    stack.classList.toggle('is-layered', isLayered);
    stack.dataset.workingKind = isLayered ? 'shared' : 'avatar';
    stack.style.cssText = isLayered ? layoutStyle(variantId) : '';
    art.dataset.animation = animation.image.replace(/\.gif$/i, '');
    art.dataset.fallbackIndex = '0';
    art.dataset.fallbackSrcs = fallbackSources(artPaths);
    art.dataset.canonicalSrc = gifVariantPaths(variantId, 'working.gif')[0];
    art.src = artPaths[0];
    if (isLayered) {
      screen.hidden = false;
      screen.src = `./avatar-scenes/working-screens/${animation.image}`;
    } else {
      screen.hidden = true;
      screen.removeAttribute('src');
    }
  }

  function refreshVisibleWorkingImages(changedVariants) {
    if (typeof document === 'undefined') return;
    for (const stack of document.querySelectorAll('.sceneWorkingStack[data-animation-key]')) {
      const animationKey = stack.dataset.animationKey || '';
      const variant = stack.dataset.avatarVariant || 'v0';
      const variantId = animatedVariantId(variant);
      if (!animationKey || !variantId || !changedVariants.has(variantId)) continue;
      workingAnimationByAgent.delete(animationKey);
      applyWorkingAnimation(stack, animationForPose('working', variant, animationKey), variant);
    }
  }

  function refreshVisibleGamingImages(changedVariants) {
    if (typeof document === 'undefined') return;
    for (const stack of document.querySelectorAll('.sceneGamingStack[data-animation-key]')) {
      const animationKey = stack.dataset.animationKey || '';
      const variant = stack.dataset.avatarVariant || 'v0';
      const variantId = animatedVariantId(variant);
      if (!animationKey || !variantId || !changedVariants.has(variantId)) continue;
      gamingAnimationByAgent.delete(animationKey);
      applyGamingAnimation(stack, animationForPose('gaming', variant, animationKey), variant);
    }
  }

  function validLayout(layout) {
    if (!layout || typeof layout !== 'object') return null;
    const safe = {};
    for (const key of ['left', 'top', 'width', 'height']) {
      safe[key] = Number(layout[key]);
      if (!Number.isFinite(safe[key]) || safe[key] < 0) return null;
    }
    if (!safe.width || !safe.height) return null;
    return safe;
  }

  async function loadWorkingImages() {
    if (typeof window.fetch !== 'function') return;
    try {
      const response = await window.fetch('./api/avatar-working-animations', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json();
      const changedVariants = new Set();
      for (const [variantId, images] of Object.entries(payload?.variants || {})) {
        const safeImages = Array.isArray(images)
          ? images.filter((image) => /^working(?:\d+)?\.gif$/i.test(image))
          : [];
        if (!safeImages.length) continue;
        const current = workingImagesByVariant.get(variantId) || [];
        if (safeImages.length !== current.length || safeImages.some((image, index) => image !== current[index])) {
          workingImagesByVariant.set(variantId, safeImages);
          changedVariants.add(variantId);
        }
      }

      const nextShared = Array.isArray(payload?.sharedScreens)
        ? payload.sharedScreens.filter((image) => /^working\d+\.gif$/i.test(image))
        : [];
      const sharedChanged = nextShared.length !== sharedWorkingImages.length
        || nextShared.some((image, index) => image !== sharedWorkingImages[index]);
      sharedWorkingImages = nextShared;
      const nextGaming = Array.isArray(payload?.gamingScreens)
        ? payload.gamingScreens.filter((image) => /^gaming\d+\.gif$/i.test(image))
        : [];
      const gamingChanged = nextGaming.length !== sharedGamingImages.length
        || nextGaming.some((image, index) => image !== sharedGamingImages[index]);
      sharedGamingImages = nextGaming;
      workingCanvas = {
        width: Number(payload?.canvas?.width) || 384,
        height: Number(payload?.canvas?.height) || 512
      };
      let layoutChanged = false;
      for (const [variantId, candidate] of Object.entries(payload?.layouts || {})) {
        const layout = validLayout(candidate);
        if (!layout) continue;
        const current = workingLayoutsByVariant.get(variantId);
        if (!current || ['left', 'top', 'width', 'height'].some((key) => current[key] !== layout[key])) {
          workingLayoutsByVariant.set(variantId, layout);
          layoutChanged = true;
          changedVariants.add(variantId);
        }
      }
      let gamingLayoutChanged = false;
      for (const [variantId, candidate] of Object.entries(payload?.gamingLayouts || {})) {
        const layout = validLayout(candidate);
        if (!layout) continue;
        const current = gamingLayoutsByVariant.get(variantId);
        if (!current || ['left', 'top', 'width', 'height'].some((key) => current[key] !== layout[key])) {
          gamingLayoutsByVariant.set(variantId, layout);
          gamingLayoutChanged = true;
          changedVariants.add(variantId);
        }
      }
      if (sharedChanged || layoutChanged) {
        for (const variantId of workingImagesByVariant.keys()) changedVariants.add(variantId);
      }
      if (changedVariants.size) refreshVisibleWorkingImages(changedVariants);
      if (gamingChanged || gamingLayoutChanged) {
        const gamingVariants = new Set(gamingLayoutsByVariant.keys());
        refreshVisibleGamingImages(gamingVariants);
      }
    } catch (_error) {
      // The canonical working.gif remains available when discovery is offline.
    }
  }

  function handleImageError(event) {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    if (image.classList.contains('sceneWorkingScreen')) {
      const stack = image.closest('.sceneWorkingStack');
      const art = stack?.querySelector('.sceneArt--working, .sceneArt--meeting');
      if (!stack || !art) return;
      stack.classList.remove('is-layered');
      stack.dataset.workingKind = 'avatar';
      image.hidden = true;
      image.removeAttribute('src');
      art.src = art.dataset.canonicalSrc || art.src;
      return;
    }
    if (image.classList.contains('sceneGamingScreen')) {
      const stack = image.closest('.sceneGamingStack');
      const art = stack?.querySelector('.sceneArt--gaming');
      if (!stack || !art) return;
      stack.classList.remove('is-layered');
      stack.dataset.gamingKind = 'avatar';
      image.hidden = true;
      image.removeAttribute('src');
      art.src = art.dataset.canonicalSrc || art.src;
      return;
    }
    if (!image.classList.contains('sceneArt')) return;
    const sources = (image.dataset.fallbackSrcs || '').split('|').filter(Boolean);
    const index = Number(image.dataset.fallbackIndex || 0);
    const nextSource = sources[index];
    if (!nextSource) return;
    image.dataset.fallbackIndex = String(index + 1);
    image.src = nextSource;
  }

  function esc(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[char]));
  }

  function artMarkup({ poseClass, roleClass, paths, animation, animationKey, variant, title }) {
    return `<img
          class="sceneArt sceneArt--${poseClass} role-${roleClass}"
          src="${paths[0]}"
          data-fallback-srcs="${esc(fallbackSources(paths))}"
          data-fallback-index="0"
          data-animation="${esc(animation.image.replace(/\.gif$/i, ''))}"
          data-animation-key="${esc(animationKey)}"
          data-avatar-variant="${esc(variantKey(variant))}"
          alt="${title}"
          draggable="false"
        />`;
  }

  function sceneMarkup({ pose, role, label, variant = 'v0', animationKey = '', showLabel = true }) {
    const animation = animationForPose(pose, variant, animationKey);
    const variantId = animatedVariantId(variant);
    const usesWorkingAnimation = pose === 'working' || pose === 'meeting';
    const usesGamingAnimation = pose === 'gaming';
    const isLayered = usesWorkingAnimation && animation.kind === 'shared' && workingLayoutsByVariant.has(variantId);
    const isGamingLayered = usesGamingAnimation && animation.kind === 'shared' && gamingLayoutsByVariant.has(variantId);
    const paths = isLayered
      ? layeredPaths(variantId)
      : isGamingLayered
        ? gamingLayeredPaths(variantId)
        : pathsForAvatarImage(animation.image, variant);
    const roleClass = esc(role || 'agent');
    const poseClass = esc(pose || 'working');
    const variantClass = `variant-${variantKey(variant).replace(/[^a-z0-9_-]/gi, '-')}`;
    const title = esc(label || '');
    const caption = showLabel && title ? `<span class="sceneCaption">${title}</span>` : '';
    const art = artMarkup({ poseClass, roleClass, paths, animation, animationKey, variant, title });
    const visual = usesWorkingAnimation && variantId
      ? `<span
          class="sceneWorkingStack${isLayered ? ' is-layered' : ''}"
          data-working-kind="${isLayered ? 'shared' : 'avatar'}"
          data-animation-key="${esc(animationKey)}"
          data-avatar-variant="${esc(variantKey(variant))}"
          style="${isLayered ? layoutStyle(variantId) : ''}"
        >
          <img class="sceneWorkingScreen"${isLayered ? ` src="./avatar-scenes/working-screens/${esc(animation.image)}"` : ' hidden'} alt="" draggable="false" />
          ${art.replace('draggable="false"', `data-canonical-src="${esc(gifVariantPaths(variantId, 'working.gif')[0])}" draggable="false"`)}
        </span>`
      : usesGamingAnimation && variantId
        ? `<span
          class="sceneGamingStack${isGamingLayered ? ' is-layered' : ''}"
          data-gaming-kind="${isGamingLayered ? 'shared' : 'avatar'}"
          data-animation-key="${esc(animationKey)}"
          data-avatar-variant="${esc(variantKey(variant))}"
          style="${isGamingLayered ? layoutStyle(variantId, 'gaming') : ''}"
        >
          <img class="sceneGamingScreen"${isGamingLayered ? ` src="./avatar-scenes/gaming-screens/${esc(animation.image)}"` : ' hidden'} alt="" draggable="false" />
          ${art.replace('draggable="false"', `data-canonical-src="${esc(gifVariantPaths(variantId, 'gaming.gif')[0])}" draggable="false"`)}
        </span>`
        : art;
    return `
      <div class="sceneFigure sceneFigure--${poseClass} role-${roleClass} ${variantClass}">
        ${visual}
        ${caption}
      </div>`;
  }

  window.addEventListener('error', handleImageError, true);
  const workingImagesReady = loadWorkingImages();
  let workingImagesTimer = null;
  function scheduleWorkingImageRefresh() {
    if (typeof window.setTimeout !== 'function') return;
    window.clearTimeout(workingImagesTimer);
    workingImagesTimer = null;
    if (typeof document === 'object' && document.hidden) return;
    workingImagesTimer = window.setTimeout(async () => {
      await loadWorkingImages();
      scheduleWorkingImageRefresh();
    }, 30_000);
  }
  if (typeof document === 'object') document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      window.clearTimeout(workingImagesTimer);
      workingImagesTimer = null;
    } else {
      void loadWorkingImages();
      scheduleWorkingImageRefresh();
    }
  });
  scheduleWorkingImageRefresh();
  window.SceneArt = { sceneMarkup, workingImagesReady };
})();
