/** Keep upcoming generated illumination surfaces off the animation thread. */
export async function createBackgroundPrecomputer(settings) {
  // Native exports retain the original Canvas resampler byte for byte. Chromium's
  // worker Canvas path can differ by one rounding level on enlarged paper fields.
  if (document.querySelector('#film')?.width > 1440) return null;
  if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function') return null;
  const worker = new Worker(new URL('./background-worker.js', import.meta.url), {type: 'module'});
  const cache = new Map(), waiting = new Map();
  let active = 0, busy = false, queue = [], failed = false, hits=0, misses=0, workerTotal=0, workerCount=0, workerLast;
  const pump = () => {
    if (busy || failed || !queue.length) return;
    busy = true; worker.postMessage({frame: queue.shift()});
  };
  const requireFrame = frame => {
    if (cache.has(frame)) return Promise.resolve();
    if (waiting.has(frame)) return waiting.get(frame).promise;
    let resolve;
    const promise = new Promise(done => {resolve = done});
    waiting.set(frame, {promise, resolve});queue.push(frame);pump();return promise;
  };
  worker.onmessage = ({data}) => {
    if (data.ready) {busy = false;pump();return;}
    busy = false;
    workerTotal+=data.timing.total;workerCount++;workerLast={...data.timing,delivery:Date.now()-data.finishedAt};
    cache.set(data.frame, data.surfaces);
    waiting.get(data.frame)?.resolve();waiting.delete(data.frame);
    while (cache.size > 22) {
      // A future surface may have been prepared before the recently viewed
      // past surfaces. Pure LRU would evict that unseen upcoming frame first.
      // Retire completed timeline frames before the look-ahead window.
      const frames = [...cache.keys()];
      const candidate = frames.find(frame => frame < active)
        ?? frames.filter(frame => frame !== active).sort((a,b) => Math.abs(b-active)-Math.abs(a-active))[0];
      if (candidate === undefined) break;
      for (const surface of cache.get(candidate)) surface.close();
      cache.delete(candidate);
    }
    pump();
  };
  worker.onerror = () => {
    failed = true;worker.terminate();
    for (const item of waiting.values()) item.resolve();waiting.clear();queue=[];
  };
  busy = true;worker.postMessage({settings});
  const api = {
    get(frame, recoveredReady) {
      const pair = cache.get(frame);
      if (!pair) {misses++;return null;}hits++;
      cache.delete(frame);cache.set(frame,pair);
      return pair[recoveredReady ? 1 : 0];
    },
    prefetch(frame) {
      if (failed) return;
      active = frame;
      const obsolete = queue.filter(item => item < frame || item > frame + 15);
      queue = queue.filter(item => !obsolete.includes(item));
      for (const item of obsolete) {waiting.get(item)?.resolve();waiting.delete(item);}
      for (let offset=0;offset<14;offset++) if(frame+offset<settings.fit.frames.length) requireFrame(frame+offset);
    },
    async prime(frame=0,count=10) {
      if(failed)return;
      frame=Math.max(0,Math.min(settings.fit.frames.length-1,Math.floor(frame)));
      count=Math.max(0,Math.min(count,settings.fit.frames.length-frame));
      active=frame;
      await Promise.all(Array.from({length:count},(_,offset)=>requireFrame(frame+offset)));
    },
    stats() {return {cachedFrames:cache.size,queued:queue.length,busy,failed,hits,misses,workerMean:workerTotal/workerCount,workerLast};},
  };
  await api.prime();return api;
}
