// The only script that runs in the iframe itself. It receives the Worker source as text, starts it
// from a blob URL and relays its messages to the parent. The CSP allows this script by hash, so
// BOOTSTRAP_HASH must match BOOTSTRAP_SOURCE exactly; tests/runtime/bootstrap.test.ts checks it.

export const BOOTSTRAP_SOURCE =
  "(()=>{const p=parent;let w=null;addEventListener('message',e=>{if(e.source!==p||w!==null)return;const d=e.data;if(typeof d!=='object'||d===null||d.type!=='start'||typeof d.workerSource!=='string'||typeof d.code!=='string')return;try{w=new Worker(URL.createObjectURL(new Blob([d.workerSource],{type:'text/javascript'})));w.onmessage=m=>p.postMessage({type:'worker-message',data:m.data},'*');w.onerror=m=>{m.preventDefault();p.postMessage({type:'worker-error',message:String(m.message)},'*')};w.postMessage({type:'run',code:d.code})}catch(x){p.postMessage({type:'worker-error',message:String(x)},'*')}});p.postMessage({type:'ready'},'*')})();"

export const BOOTSTRAP_HASH = 'CiBv9mUSakhv+8fHFYW3zkip484OvqXF7bx2+vJf+b8='

/** The CSP from the spec, with the bootstrap hash added. */
export const SANDBOX_CSP = `default-src 'none'; script-src 'unsafe-eval' blob: 'sha256-${BOOTSTRAP_HASH}'; worker-src blob:`

export function sandboxDocument(): string {
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}"><script>${BOOTSTRAP_SOURCE}</script>`
}
