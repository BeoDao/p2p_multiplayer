/**
 * 백그라운드 탭에서도 멈추지 않는 타이머.
 * 브라우저는 숨겨진 탭의 requestAnimationFrame 을 멈추고 setInterval 을 1초 단위로 제한하지만,
 * Web Worker 안의 타이머는 제한이 훨씬 약하다. 워커가 주기적으로 메시지를 보내고 메인 스레드가 세션을 갱신한다.
 * → 다른 플레이어가 탭을 전환해도 락스텝이 멈추지 않는다 (렌더링만 멈춤).
 */
export function startBackgroundTicker(intervalMs: number, cb: () => void): () => void {
  let stopped = false;
  try {
    const src = `let t=null;onmessage=(e)=>{if(e.data==='start'){if(!t)t=setInterval(()=>postMessage(0),${intervalMs});}else{clearInterval(t);t=null;}};`;
    const blob = new Blob([src], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    worker.onmessage = () => { if (!stopped) cb(); };
    worker.postMessage('start');
    return () => { stopped = true; worker.postMessage('stop'); worker.terminate(); URL.revokeObjectURL(url); };
  } catch {
    const id = setInterval(() => { if (!stopped) cb(); }, intervalMs);
    return () => { stopped = true; clearInterval(id); };
  }
}
