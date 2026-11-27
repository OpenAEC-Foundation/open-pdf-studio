const channelName = pid => 'opds-tab-dock-v1-' + pid;

export function previewDock(target) {
  const channel = new BroadcastChannel(channelName(target.pid));
  channel.postMessage({ type: 'preview', x: target.x, y: target.y });
  channel.close();
}

export function requestDock(target, path) {
  const id = crypto.randomUUID();
  const channel = new BroadcastChannel(channelName(target.pid));
  return new Promise(resolve => {
    let timer = setTimeout(() => finish(false), 2500);
    function finish(ok) {
      clearTimeout(timer);
      channel.close();
      resolve(ok);
    }
    channel.onmessage = ({ data }) => {
      if (data?.id !== id) return;
      if (data.type === 'opening') {
        clearTimeout(timer);
        timer = setTimeout(() => finish(false), 120000);
      } else if (data.type === 'complete') finish(data.ok === true);
    };
    channel.postMessage({ type: 'drop', id, path, x: target.x, y: target.y });
  });
}

export function receiveDock(pid, tabBar, openPdf) {
  const channel = new BroadcastChannel(channelName(pid));
  let timer;
  const clear = () => tabBar()?.classList.remove('drag-dock-target');
  channel.onmessage = async ({ data }) => {
    if (data?.type !== 'preview' && data?.type !== 'drop') return;
    const bar = tabBar();
    const rect = bar?.getBoundingClientRect();
    const x = data.x / window.devicePixelRatio;
    const y = data.y / window.devicePixelRatio;
    const inside = rect && x >= rect.left && x < rect.right && y >= rect.top - 8 && y <= rect.bottom + 40;
    clearTimeout(timer);
    clear();
    if (data.type === 'preview') {
      if (inside) {
        bar.classList.add('drag-dock-target');
        timer = setTimeout(clear, 220);
      }
      return;
    }
    const { id, path } = data;
    if (typeof id !== 'string') return;
    let ok = false;
    try {
      if (inside && typeof path === 'string' && /\.pdf$/i.test(path)) {
        channel.postMessage({ type: 'opening', id });
        ok = await openPdf(path);
      }
    } catch (error) {
      console.warn('[tabs] receiving document failed', error);
    } finally {
      channel.postMessage({ type: 'complete', id, ok });
    }
  };
  return () => { clearTimeout(timer); clear(); channel.close(); };
}
