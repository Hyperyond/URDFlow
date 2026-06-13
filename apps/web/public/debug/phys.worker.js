/** Minimal MuJoCo boot harness — no bundler, no app code. Drives /mujoco.mjs
 *  exactly like the studio worker and reports each step. Used by phys.html. */
self.onmessage = async (e) => {
  const { xml, assets = [], ctrl = null } = e.data;
  const log = (step) => postMessage({ step });
  try {
    log("import mujoco.mjs");
    const factory = (await import("/mujoco.mjs")).default;
    log("instantiate");
    const m = await factory({ locateFile: (f) => (f.endsWith(".wasm") ? "/mujoco.wasm" : f) });
    await new Promise((r) => setTimeout(r, 50));
    log("write FS");
    m.FS.mkdir("/scene");
    m.FS.mkdir("/scene/assets");
    m.FS.writeFile("/scene/scene.xml", xml);
    for (const a of assets) m.FS.writeFile(`/scene/assets/${a.file}`, new Uint8Array(a.buf));
    log("mj_loadXML");
    const model = m.MjModel.mj_loadXML("/scene/scene.xml");
    if (!model) throw new Error("mj_loadXML returned null");
    log("MjData");
    const data = new m.MjData(model);
    const vGet = (v, i) => (ArrayBuffer.isView(v) ? v[i] : v.get(i));
    const vSet = (v, i, x) => (ArrayBuffer.isView(v) ? (v[i] = x) : v.set(i, x));
    const vLen = (v) => (ArrayBuffer.isView(v) ? v.length : v.size());
    if (ctrl) {
      log("apply ctrl + settle 2s");
      for (let i = 0; i < ctrl.length && i < vLen(data.ctrl); i++) vSet(data.ctrl, i, ctrl[i]);
    }
    log("step ×1000");
    for (let i = 0; i < 1000; i++) m.mj_step(model, data);
    const n = vLen(data.qpos);
    postMessage({
      done: true,
      nq: n,
      ncon: typeof data.ncon === "number" ? data.ncon : -1,
      qpos: Array.from({ length: Math.min(n, 16) }, (_, i) => vGet(data.qpos, i)),
    });
  } catch (err) {
    postMessage({ error: String(err && err.message ? err.message : err) });
  }
};
