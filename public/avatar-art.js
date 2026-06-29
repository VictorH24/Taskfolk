(() => {
  const ROLE_COLORS = {
    main: { shirt: '#4d72c2', shirtDark: '#2b3b64', hair: '#2b201c' },
    coder: { shirt: '#c46658', shirtDark: '#7a352d', hair: '#2a1f1a' },
    reviewer: { shirt: '#8a8fa8', shirtDark: '#545a71', hair: '#2a1f1a' },
    agent: { shirt: '#5a9a68', shirtDark: '#31523a', hair: '#35261f' },
    ops: { shirt: '#d18a52', shirtDark: '#804c27', hair: '#2a1f1a' },
    builder: { shirt: '#845fca', shirtDark: '#533f84', hair: '#2e241d' },
    writer: { shirt: '#4c6ea8', shirtDark: '#2c4164', hair: '#1d1b22' },
    planner: { shirt: '#d26d61', shirtDark: '#843c34', hair: '#2f231d' },
    analyst: { shirt: '#5a9a68', shirtDark: '#31523a', hair: '#35261f' },
    walker: { shirt: '#5a9a68', shirtDark: '#31523a', hair: '#35261f' },
  };

  function esc(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[char]));
  }

  function svgDataUri(svg) {
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  function rolePalette(role) {
    return ROLE_COLORS[role] || ROLE_COLORS.agent;
  }

  function letterFor(label) {
    return esc(label).slice(0, 1).toUpperCase() || 'A';
  }

  function uprightAvatarSvg({ role, pose, label }) {
    const { shirt, shirtDark, hair } = rolePalette(role);
    const letter = letterFor(label);
    const isBlocked = pose === 'blocked';
    const isReading = pose === 'reading';
    const isGaming = pose === 'gaming';
    const isCoffee = pose === 'coffee';
    const isHeadphones = pose === 'headphones';
    const isWindow = pose === 'window';
    const isWalking = pose === 'walking';
    const poseTilt = isReading ? -8 : isGaming ? -2 : isCoffee ? 0 : isWindow ? 0 : isWalking ? 0 : 0;
    const poseBodyX = isReading ? 50 : isGaming ? 48 : isCoffee ? 49 : isWindow ? 49 : 48;
    const poseBodyY = isReading ? 46 : 45;
    const poseLegLeft = isWalking ? 'rotate(18 52 86)' : 'rotate(8 52 86)';
    const poseLegRight = isWalking ? 'rotate(-18 68 86)' : 'rotate(-8 68 86)';
    const poseArmLeft = isReading ? 'rotate(-42 40 60)' : isGaming ? 'rotate(-28 42 60)' : isCoffee ? 'rotate(-20 42 60)' : isWindow ? 'rotate(-6 42 60)' : 'rotate(-18 42 60)';
    const poseArmRight = isReading ? 'rotate(22 80 60)' : isGaming ? 'rotate(30 80 60)' : isCoffee ? 'rotate(18 80 60)' : isWindow ? 'rotate(10 80 60)' : 'rotate(18 80 60)';
    const headphoneBand = isHeadphones
      ? `<path d="M36 31 C36 16 48 10 60 10 C72 10 84 16 84 31" fill="none" stroke="#121722" stroke-width="8" stroke-linecap="round"/>`
      : '';
    const headphoneCups = isHeadphones
      ? `
        <rect x="31" y="31" width="10" height="16" rx="4" fill="#121722"/>
        <rect x="79" y="31" width="10" height="16" rx="4" fill="#121722"/>`
      : '';
    const prop = isReading
      ? `<rect x="64" y="55" width="18" height="22" rx="2" fill="#f5edd0" stroke="#56341f" stroke-width="3" transform="rotate(12 73 66)"/>`
      : isGaming
        ? `<path d="M53 67 h14 l3 -5 h8 l5 6 l-2 9 h-8 l-3 -4 h-8 l-4 4 h-8 l-2 -10 z" fill="#2f8f55" stroke="#1f5a39" stroke-width="3" stroke-linejoin="round"/>`
        : isCoffee
          ? `<path d="M63 58 h10 v10 c0 5 -3 8 -5 8 h-4 c-2 0 -5 -3 -5 -8 z" fill="#efe1b1" stroke="#5b351f" stroke-width="3"/><path d="M72 60 h5 c2 0 4 1 4 3 c0 2 -2 4 -4 4 h-5" fill="none" stroke="#5b351f" stroke-width="3" stroke-linecap="round"/>`
          : isWindow
            ? `<path d="M66 58 l10 -2 l2 16 l-10 2 z" fill="#d9ecff" stroke="#42607d" stroke-width="3"/>`
            : '';

    const shirtBox = isBlocked ? '#ae4545' : shirt;
    const shirtEdge = isBlocked ? '#5d2727' : shirtDark;
    const bodyRotate = poseTilt ? `transform="rotate(${poseTilt} 60 58)"` : '';
    const leftArmPos = pose === 'working' || pose === 'meeting' ? 'rotate(-20 40 60)' : poseArmLeft;
    const rightArmPos = pose === 'working' || pose === 'meeting' ? 'rotate(20 80 60)' : poseArmRight;

    return `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" shape-rendering="crispEdges" aria-hidden="true">
        <defs>
          <linearGradient id="shirtFade-${role}-${pose}" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stop-color="${shirtBox}"/>
            <stop offset="1" stop-color="${shirtEdge}"/>
          </linearGradient>
        </defs>
        <ellipse cx="60" cy="92" rx="24" ry="8" fill="rgba(20, 23, 30, .30)"/>
        <ellipse cx="60" cy="88" rx="17" ry="5" fill="rgba(20, 23, 30, .22)"/>
        <circle cx="60" cy="31" r="13" fill="#f0bc8c" stroke="#593525" stroke-width="3"/>
        <path d="M48 28 C50 18 56 14 60 14 C64 14 70 18 72 28 C70 25 66 24 60 24 C54 24 50 25 48 28 Z" fill="${hair}"/>
        <rect x="${poseBodyX}" y="${poseBodyY}" width="24" height="28" rx="4" fill="url(#shirtFade-${role}-${pose})" stroke="${shirtEdge}" stroke-width="3" ${bodyRotate}/>
        <text x="60" y="${pose === 'headphones' ? 60 : 59}" text-anchor="middle" fill="#f3e8d2" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="12" font-weight="900">${letter}</text>
        <rect x="37" y="47" width="10" height="16" rx="4" fill="#e1a875" stroke="#593525" stroke-width="3" transform="${leftArmPos}"/>
        <rect x="73" y="47" width="10" height="16" rx="4" fill="#e1a875" stroke="#593525" stroke-width="3" transform="${rightArmPos}"/>
        <rect x="49" y="73" width="9" height="18" rx="4" fill="#5d3d2b" stroke="#402718" stroke-width="3" transform="${poseLegLeft}"/>
        <rect x="62" y="73" width="9" height="18" rx="4" fill="#5d3d2b" stroke="#402718" stroke-width="3" transform="${poseLegRight}"/>
        ${headphoneBand}
        ${headphoneCups}
        ${prop}
      </svg>`;
  }

  function sleepingAvatarSvg({ role, label }) {
    const { shirt, shirtDark, hair } = rolePalette(role);
    const letter = letterFor(label);
    return `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 96" shape-rendering="crispEdges" aria-hidden="true">
        <ellipse cx="78" cy="68" rx="46" ry="9" fill="rgba(20, 23, 30, .28)"/>
        <ellipse cx="88" cy="45" rx="20" ry="6" fill="#efe1b1" stroke="#5b351f" stroke-width="3"/>
        <circle cx="53" cy="52" r="12" fill="#f0bc8c" stroke="#593525" stroke-width="3"/>
        <path d="M42 49 C43 41 48 37 53 37 C58 37 64 41 65 49 C62 46 58 44 53 44 C48 44 44 46 42 49 Z" fill="${hair}"/>
        <rect x="58" y="47" width="44" height="16" rx="6" fill="url(#sleepShirt-${role})" stroke="${shirtDark}" stroke-width="3"/>
        <text x="78" y="59" text-anchor="middle" fill="#f3e8d2" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="11" font-weight="900">${letter}</text>
        <rect x="92" y="48" width="20" height="12" rx="4" fill="#f0bc8c" stroke="#593525" stroke-width="3" transform="rotate(20 102 54)"/>
        <rect x="66" y="54" width="28" height="10" rx="4" fill="${shirt}" stroke="${shirtDark}" stroke-width="3" transform="rotate(8 80 59)"/>
        <rect x="63" y="58" width="16" height="10" rx="4" fill="#5d3d2b" stroke="#402718" stroke-width="3" transform="rotate(10 71 63)"/>
        <rect x="88" y="58" width="16" height="10" rx="4" fill="#5d3d2b" stroke="#402718" stroke-width="3" transform="rotate(-10 96 63)"/>
        <defs>
          <linearGradient id="sleepShirt-${role}" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stop-color="${shirt}"/>
            <stop offset="1" stop-color="${shirtDark}"/>
          </linearGradient>
        </defs>
      </svg>`;
  }

  function avatarMarkup({ label, role, pose, className = '' }) {
    const src = svgDataUri(uprightAvatarSvg({ role, pose, label }));
    return `<img class="pixelAvatar ${role} ${pose} ${className} avatarSvg avatarSvg--${pose}" src="${src}" alt="${esc(label)}" aria-hidden="true" draggable="false" />`;
  }

  function sleeperMarkup({ label, role, className = '' }) {
    const src = svgDataUri(sleepingAvatarSvg({ role, label }));
    return `<img class="pixelSleeper ${role} sleeping ${className} avatarSvg avatarSvg--sleeping" src="${src}" alt="${esc(label)}" aria-hidden="true" draggable="false" />`;
  }

  window.AvatarArt = {
    avatarMarkup,
    sleeperMarkup,
    svgDataUri,
    letterFor,
  };
})();
