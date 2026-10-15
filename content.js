(() => {
  const absTop = (v) => v.getBoundingClientRect().top + window.scrollY;
  // 広告ツイート(「広告」「Ad」「Promoted」ラベル付き)は対象外
  const isAd = (a) =>
    [...a.querySelectorAll('span')].some((s) =>
      /^(広告|Ad|Promoted|プロモーション)$/.test(s.textContent.trim())
    );
  const videos = () =>
    [...document.querySelectorAll('video')]
      .filter((v) => {
        const a = v.closest('article');
        return a && !isAd(a);
      })
      .sort((a, b) => absTop(a) - absTop(b));

  let active = false;
  let current = null;
  let lastY = 0;
  let lastInput = 0;
  let scrollTimer = null;
  let token = 0;

  const btn = document.createElement('button');
  btn.textContent = '▶ 連続再生';
  btn.style.cssText =
    'position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:10px 16px;' +
    'border:0;border-radius:999px;background:#1d9bf0;color:#fff;font:700 14px sans-serif;' +
    'cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.4)';
  document.body.appendChild(btn);

  // 表示モード: screen=画面全体の全画面 / window=ブラウザ内いっぱい / inline=全画面にせずタイムライン上で再生
  const MODES = { screen: '画面全体', window: 'ブラウザ内', inline: 'その場' };
  let mode = 'screen';
  try {
    const m = localStorage.getItem('xvp-mode');
    if (m in MODES) mode = m;
  } catch (e) {}
  const modeBtn = document.createElement('button');
  modeBtn.style.cssText = btn.style.cssText;
  modeBtn.style.right = '140px';
  modeBtn.style.background = '#536471';
  const showMode = () => (modeBtn.textContent = '表示: ' + MODES[mode]);
  showMode();
  modeBtn.addEventListener('click', () => {
    if (active) return;
    mode = Object.keys(MODES)[(Object.keys(MODES).indexOf(mode) + 1) % 3];
    try {
      localStorage.setItem('xvp-mode', mode);
    } catch (e) {}
    showMode();
  });
  document.body.appendChild(modeBtn);

  ['pointerdown', 'keydown'].forEach((e) =>
    window.addEventListener(e, () => (lastInput = Date.now()), true)
  );

  // Xが勝手に止めた場合の保険(ユーザー操作直後は除く)
  setInterval(() => {
    if (active && current && current.paused && !current.ended && Date.now() - lastInput > 1000) {
      current.play().catch(() => {});
    }
  }, 500);

  function onEnded() {
    next(1);
  }

  // 動画要素をフルスクリーン化した専用オーバーレイへ移して再生する
  // (全画面は開始クリックで documentElement に対して1回だけ要求する)
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:2147483646;background:#000;display:none;';
  let home = null; // {v, parent, next, css, controls}
  let listening = null;

  function unlisten() {
    if (!listening) return;
    listening.removeEventListener('ended', onEnded);
    listening = null;
  }

  function restore() {
    unlisten();
    if (!home) return;
    const { v, parent, next, css, controls } = home;
    v.style.cssText = css;
    v.controls = controls;
    if (parent.isConnected) parent.insertBefore(v, next && next.parentNode === parent ? next : null);
    else v.remove();
    home = null;
  }

  // Xは画面に入った動画しか読み込まないため、枠へ移す前にその場で読み込ませる
  async function warmUp(v) {
    v.scrollIntoView({ block: 'center' });
    v.play().catch(() => {});
    for (let i = 0; i < 20 && v.readyState < 2; i++) await new Promise((r) => setTimeout(r, 250));
  }

  async function play(v) {
    const my = token;
    await warmUp(v);
    if (!active || my !== token) return;
    lastY = absTop(v);
    restore();
    current = v;
    lastInput = 0;
    v.loop = false;
    v.muted = false;
    if (mode !== 'inline') {
      home = { v, parent: v.parentNode, next: v.nextSibling, css: v.style.cssText, controls: v.controls };
      v.controls = true;
      v.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;';
      overlay.appendChild(v);
      overlay.style.display = 'block';
    } else {
      v.scrollIntoView({ block: 'center' });
    }
    listening = v;
    v.addEventListener('ended', onEnded);
    v.play().catch(() => {});
    prefetchNext();
  }

  const find = (dir) => {
    const list = videos();
    return dir > 0
      ? list.find((v) => absTop(v) > lastY + 5)
      : [...list].reverse().find((v) => absTop(v) < lastY - 5);
  };

  // 次の動画がDOMに無い間、少しずつスクロールして読み込ませる
  // (タイムラインの高さが伸びなくなったら末尾とみなして諦める)
  const scan = async (dir, my, maxTries) => {
    const size = () => document.documentElement.scrollHeight + document.querySelectorAll('article').length;
    let h = size();
    let stale = 0;
    for (let i = 0; i < maxTries && active && my === token; i++) {
      const v = find(dir);
      if (v) return v;
      window.scrollBy(0, window.innerHeight * 0.8);
      await new Promise((r) => setTimeout(r, 700));
      const nh = size();
      stale = nh === h ? stale + 1 : 0;
      h = nh;
      if (stale >= 16) break;
    }
    return find(dir);
  };

  function prefetchNext() {
    const my = token;
    // 「その場」では再生中の動画を画面内に残すため、先読みスクロールはしない
    if (mode !== 'inline' && !find(1)) scan(1, my, 40);
  }

  async function next(dir) {
    const my = ++token;
    const v = dir > 0 ? await scan(1, my, 80) : find(-1);
    if (my !== token || !active) return;
    if (v) play(v);
    else {
      // 次が無ければ、最後に再生した動画の位置へ戻して終了
      window.scrollTo(0, Math.max(0, lastY - window.innerHeight / 2));
      stop();
    }
  }

  async function start() {
    active = true;
    const my = ++token;
    btn.textContent = '■ 停止';
    // 全画面は開始クリックのユーザー操作中に要求する
    if (mode !== 'inline') document.documentElement.appendChild(overlay);
    if (mode === 'screen') {
      document.documentElement.requestFullscreen().catch((e) => console.warn('[xvp] fullscreen', e));
    }
    const vh = window.innerHeight;
    let list = videos();
    let first = list.find((v) => v.getBoundingClientRect().bottom > vh * 0.3);
    if (!first) {
      // 表示範囲に対象動画が無ければ、下へスクロールして探す
      lastY = window.scrollY;
      btn.textContent = '■ 探索中…';
      first = await scan(1, my, 60);
      btn.textContent = '■ 停止';
    }
    if (my !== token || !active) return;
    if (!first) {
      btn.textContent = '動画なし';
      setTimeout(stop, 1500);
      return;
    }
    play(first);
  }

  function stop() {
    active = false;
    token++;
    if (current) current.pause();
    restore();
    current = null;
    overlay.style.display = 'none';
    btn.textContent = '▶ 連続再生';
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  btn.addEventListener('click', () => (active ? stop() : start()));

  document.addEventListener('fullscreenchange', () => {
    // 全画面を抜けたら終了(切替中は fullscreenElement が残る)
    if (active && mode === 'screen' && !document.fullscreenElement) stop();
  });

  window.addEventListener(
    'keydown',
    (e) => {
      if (!active) return;
      if (e.key === 'Escape' && mode !== 'screen') return stop();
      if (e.key === 'ArrowRight' || e.key === 'n') (e.preventDefault(), next(1));
      else if (e.key === 'ArrowLeft' || e.key === 'p') (e.preventDefault(), next(-1));
    },
    true
  );
})();
