(() => {
  function svgDataUri(svg) {
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  function makeDesk({ alert = false } = {}) {
    const top = alert ? '#c86b65' : '#c7955c';
    const edge = alert ? '#7f3a35' : '#5b351f';
    const shadow = alert ? '#7d2d32' : '#8c5a34';
    return svgDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 140" shape-rendering="crispEdges" aria-hidden="true">
        <rect width="240" height="140" fill="none"/>
        <ellipse cx="122" cy="118" rx="92" ry="10" fill="rgba(0,0,0,.22)"/>
        <rect x="30" y="28" width="180" height="82" rx="8" fill="${top}" stroke="${edge}" stroke-width="6"/>
        <rect x="36" y="34" width="168" height="54" rx="5" fill="#b77f49" opacity=".36"/>
        <rect x="38" y="41" width="164" height="4" fill="#f2d49a" opacity=".4"/>
        <rect x="38" y="54" width="164" height="4" fill="#8d5a34" opacity=".38"/>
        <rect x="38" y="67" width="164" height="4" fill="#f2d49a" opacity=".22"/>
        <rect x="53" y="102" width="14" height="28" fill="${shadow}" stroke="${edge}" stroke-width="5"/>
        <rect x="173" y="102" width="14" height="28" fill="${shadow}" stroke="${edge}" stroke-width="5"/>
        <rect x="112" y="90" width="16" height="22" fill="${shadow}" stroke="${edge}" stroke-width="5"/>
      </svg>`);
  }

  function makeChair({ lounge = false } = {}) {
    const seat = lounge ? '#c79457' : '#8e6ce0';
    const back = lounge ? '#a66d3e' : '#6b50aa';
    const frame = '#5b351f';
    return svgDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" shape-rendering="crispEdges" aria-hidden="true">
        <ellipse cx="62" cy="102" rx="38" ry="8" fill="rgba(0,0,0,.2)"/>
        <rect x="22" y="42" width="58" height="24" rx="8" fill="${seat}" stroke="${frame}" stroke-width="5"/>
        <rect x="26" y="12" width="50" height="44" rx="8" fill="${back}" stroke="${frame}" stroke-width="5"/>
        <rect x="31" y="69" width="12" height="28" fill="${frame}"/>
        <rect x="54" y="69" width="12" height="28" fill="${frame}"/>
        <rect x="77" y="69" width="12" height="28" fill="${frame}"/>
        <rect x="26" y="30" width="50" height="18" fill="#ffffff" opacity=".09"/>
      </svg>`);
  }

  function makeCouch({ reading = false, gaming = false } = {}) {
    const base = reading ? '#8f6dc8' : gaming ? '#5d89b8' : '#926bc8';
    const back = reading ? '#65478f' : gaming ? '#3f628f' : '#6f4e9b';
    const frame = '#523a33';
    return svgDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 110" shape-rendering="crispEdges" aria-hidden="true">
        <ellipse cx="110" cy="95" rx="90" ry="10" fill="rgba(0,0,0,.2)"/>
        <rect x="24" y="34" width="172" height="44" rx="14" fill="${base}" stroke="${frame}" stroke-width="6"/>
        <rect x="16" y="40" width="34" height="34" rx="10" fill="${base}" stroke="${frame}" stroke-width="6"/>
        <rect x="170" y="40" width="34" height="34" rx="10" fill="${base}" stroke="${frame}" stroke-width="6"/>
        <rect x="38" y="42" width="144" height="20" rx="8" fill="${back}" opacity=".55"/>
        <rect x="28" y="70" width="164" height="12" rx="6" fill="#6f5040" stroke="${frame}" stroke-width="5"/>
        <rect x="40" y="48" width="140" height="8" fill="#ffffff" opacity=".08"/>
        <rect x="42" y="76" width="136" height="4" fill="#ffffff" opacity=".08"/>
      </svg>`);
  }

  function makeBed() {
    return svgDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 110" shape-rendering="crispEdges" aria-hidden="true">
        <ellipse cx="110" cy="95" rx="88" ry="10" fill="rgba(0,0,0,.2)"/>
        <rect x="24" y="28" width="172" height="50" rx="10" fill="#d2a774" stroke="#5b351f" stroke-width="6"/>
        <rect x="28" y="32" width="40" height="22" rx="6" fill="#f4f7fb" stroke="#7c5a38" stroke-width="5"/>
        <rect x="64" y="36" width="116" height="30" rx="8" fill="#7257a7" stroke="#3c2d58" stroke-width="5"/>
        <rect x="64" y="48" width="116" height="18" rx="6" fill="#5b4690" opacity=".45"/>
        <rect x="34" y="78" width="16" height="16" fill="#5b351f"/>
        <rect x="170" y="78" width="16" height="16" fill="#5b351f"/>
      </svg>`);
  }

  function makeTable() {
    return svgDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 110" shape-rendering="crispEdges" aria-hidden="true">
        <ellipse cx="110" cy="92" rx="82" ry="9" fill="rgba(0,0,0,.18)"/>
        <rect x="26" y="34" width="168" height="42" rx="8" fill="#bd8a4d" stroke="#5b351f" stroke-width="6"/>
        <rect x="58" y="74" width="14" height="22" fill="#5b351f"/>
        <rect x="148" y="74" width="14" height="22" fill="#5b351f"/>
        <circle cx="110" cy="55" r="10" fill="#e8d9ae" opacity=".85"/>
      </svg>`);
  }

  function makePlant() {
    return svgDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 96" shape-rendering="crispEdges" aria-hidden="true">
        <ellipse cx="40" cy="88" rx="24" ry="6" fill="rgba(0,0,0,.18)"/>
        <rect x="28" y="58" width="24" height="16" fill="#b99058" stroke="#5b351f" stroke-width="4"/>
        <rect x="34" y="44" width="12" height="16" fill="#5c7d3a"/>
        <path d="M38 18 L46 36 L30 36 Z" fill="#6ca44d"/>
        <path d="M28 24 L38 38 L18 38 Z" fill="#4f8c3f"/>
        <path d="M52 24 L62 38 L42 38 Z" fill="#7bb857"/>
      </svg>`);
  }

  window.FurnitureArt = {
    desk: makeDesk,
    chair: makeChair,
    couch: makeCouch,
    bed: makeBed,
    table: makeTable,
    plant: makePlant,
    svgDataUri,
  };
})();
