// Episode replay on the MuJoCo WebAssembly engine, shared by the page (physics.js) and the headless check.
//
// The scene is the one the episode was generated in (robot, table, mug collision parts, coffee machine at the episode's
// pose). The recorded per-frame controls (7 joint position targets, gripper command 0..255) are replayed open loop at
// 10 Hz, 50 physics steps of 2 ms per frame. As in the data generator, once the finger pads have closed on the handle a
// soft weld constraint holds the mug in the hand (pad collisions off), and it is released at the end of the place phase.
// poke(): a spring between a point on the mug and a target point, applied as an external force (xfrc_applied).
//
// The 3.14 WebAssembly bindings cannot read data.eq_active (a bool array), so the weld is compiled active and switched
// by its bodies instead: off = world to world (zero Jacobian, so no generalized force), on = gripper to mug.

const ARM_ACT = ['act1', 'act2', 'act3', 'act4', 'act5', 'act6', 'act7'];
const PADS = ['left_finger_pad_1', 'left_finger_pad_2', 'right_finger_pad_1', 'right_finger_pad_2'];

// quaternions are MuJoCo order [w, x, y, z]
export function qmul(a, b) {
  return [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
          a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
          a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
          a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
}
export function qrot(q, v) {   // rotate v by q
  const [w, x, y, z] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}
const qconj = q => [q[0], -q[1], -q[2], -q[3]];

export class EpisodeSim {
  // files: {name: Uint8Array | string} for robot + scene; ep: episode.json
  constructor(mujoco, files, ep) {
    this.mj = mujoco; this.ep = ep;
    const enc = new TextEncoder();
    this.vfs = new mujoco.MjVFS();
    for (const [name, buf] of Object.entries(files)) {
      let b = buf;
      if (name === 'scene.xml') {
        const txt = typeof b === 'string' ? b : new TextDecoder().decode(b);
        b = txt.replace(/(<weld[^>]*name="grip_weld"[^>]*?)active="false"/, '$1active="true"');
      }
      this.vfs.addBuffer(name, typeof b === 'string' ? enc.encode(b) : b);
    }
    this.model = mujoco.MjModel.from_xml_path('scene.xml', this.vfs);
    this.data = new mujoco.MjData(this.model);
    const T = mujoco.mjtObj, id = (t, n) => mujoco.mj_name2id(this.model, t.value, n);
    this.armAct = ARM_ACT.map(n => id(T.mjOBJ_ACTUATOR, n));
    this.gripAct = id(T.mjOBJ_ACTUATOR, 'gripper');
    this.mugBody = id(T.mjOBJ_BODY, 'mug');
    this.cmBody = id(T.mjOBJ_BODY, 'cm');
    this.gripBody = id(T.mjOBJ_BODY, 'xarm_gripper_base_link');
    this.weld = id(T.mjOBJ_EQUALITY, 'grip_weld');
    this.pads = PADS.map(n => id(T.mjOBJ_GEOM, n));
    const ct = this.model.geom_contype, ca = this.model.geom_conaffinity;
    this.padCt = this.pads.map(g => ct[g]); this.padCa = this.pads.map(g => ca[g]);
    const jq = n => this.model.jnt_qposadr[id(T.mjOBJ_JOINT, n)];
    this.armQ = [1, 2, 3, 4, 5, 6, 7].map(i => jq('joint' + i));
    this.gripQ = jq('left_driver_joint');
    this.mugMass = this.model.body_subtreemass[this.mugBody];
    this.ts = this.model.opt.timestep;
    this.phaseOf = [];
    for (const [p, k] of ep.phases) for (let i = 0; i < k; i++) this.phaseOf.push(p);
    this.reset();
  }

  reset() {
    const d = this.data, m = this.model;
    this.mj.mj_resetData(m, d);
    d.qpos.set(this.ep.qpos0); d.qvel.set(this.ep.qvel0);
    this.setWeld(false);
    this.frame = 0; this.sub = 0; this.weldBroken = false; this.poke = null;
    d.xfrc_applied.fill(0);
    this.applyFrame(0);
    this.mj.mj_forward(m, d);
  }

  setWeld(on) {
    this.model.eq_obj1id[this.weld] = on ? this.gripBody : 0;
    this.model.eq_obj2id[this.weld] = on ? this.mugBody : 0;
    const ct = this.model.geom_contype, ca = this.model.geom_conaffinity;
    this.pads.forEach((g, k) => { ct[g] = on ? 0 : this.padCt[k]; ca[g] = on ? 0 : this.padCa[k]; });
    this.welded = on;
  }

  engageWeld() {   // capture the live relative pose gripper -> mug, as the generator does
    const d = this.data, b = this.gripBody, mb = this.mugBody;
    const gp = d.xpos.subarray(3 * b, 3 * b + 3), gq = Array.from(d.xquat.subarray(4 * b, 4 * b + 4));
    const mp = d.xpos.subarray(3 * mb, 3 * mb + 3), mq = Array.from(d.xquat.subarray(4 * mb, 4 * mb + 4));
    const gqi = qconj(gq);
    const dpl = qrot(gqi, [mp[0] - gp[0], mp[1] - gp[1], mp[2] - gp[2]]);
    const rq = qmul(gqi, mq);
    const e = this.model.eq_data, o = this.weld * this.mj.mjNEQDATA;
    e[o] = e[o + 1] = e[o + 2] = 0;
    e[o + 3] = dpl[0]; e[o + 4] = dpl[1]; e[o + 5] = dpl[2];
    e[o + 6] = rq[0]; e[o + 7] = rq[1]; e[o + 8] = rq[2]; e[o + 9] = rq[3];
    e[o + 10] = 1;
    this.setWeld(true);
    this.mj.mj_forward(this.model, this.data);
  }

  // control logic at the start of episode frame i (weld release / engage, then the recorded controls)
  applyFrame(i) {
    const ep = this.ep, n = ep.n, d = this.data;
    if (i < n) {
      if (this.welded && i === ep.release_frame) this.setWeld(false);
      else if (!this.welded && !this.weldBroken && i === ep.weld_frame) this.engageWeld();
    }
    const c = ep.ctrl[Math.min(i, n - 1)], ctrl = d.ctrl;
    for (let k = 0; k < 7; k++) ctrl[this.armAct[k]] = c[k];
    ctrl[this.gripAct] = i < n ? c[7] : 0;   // after the episode: arm holds its last target, jaws open
  }

  get done() { return this.frame >= this.ep.n; }
  get phase() { return this.frame < this.ep.n ? this.phaseOf[this.frame] : 'DONE'; }
  get time() { return this.frame * this.ep.sub * this.ts + this.sub * this.ts; }

  step() {   // one physics step (2 ms); advances the episode frame every `sub` steps
    if (this.poke) this.applyPoke();
    this.mj.mj_step(this.model, this.data);
    if (++this.sub >= this.ep.sub) {
      this.sub = 0; this.frame++;
      this.applyFrame(this.frame);
    }
  }

  // --- poke: spring from a body-fixed anchor on the mug to a world target -----------------------------------------
  mugPose() {
    const d = this.data, b = this.mugBody;
    return { p: Array.from(d.xpos.subarray(3 * b, 3 * b + 3)), q: Array.from(d.xquat.subarray(4 * b, 4 * b + 4)) };
  }
  startPoke(worldPoint) {
    const { p, q } = this.mugPose();
    this.poke = { local: qrot(qconj(q), [worldPoint[0] - p[0], worldPoint[1] - p[1], worldPoint[2] - p[2]]),
                  target: worldPoint.slice(), prev: worldPoint.slice() };
  }
  movePoke(worldPoint) { if (this.poke) this.poke.target = worldPoint.slice(); }
  endPoke() { this.poke = null; this.data.xfrc_applied.fill(0); }
  anchorWorld() {
    const { p, q } = this.mugPose(), a = qrot(q, this.poke.local);
    return [p[0] + a[0], p[1] + a[1], p[2] + a[2]];
  }
  applyPoke() {
    const d = this.data, b = this.mugBody, P = this.poke, a = this.anchorWorld();
    const v = [(a[0] - P.prev[0]) / this.ts, (a[1] - P.prev[1]) / this.ts, (a[2] - P.prev[2]) / this.ts];
    P.prev = a;
    const kp = 900, kd = 45, m = this.mugMass, f = [0, 0, 0];
    for (let k = 0; k < 3; k++) f[k] = m * (kp * (P.target[k] - a[k]) - kd * v[k]);
    const fn = Math.hypot(f[0], f[1], f[2]), fmax = 60 * m * 9.81;
    if (fn > fmax) for (let k = 0; k < 3; k++) f[k] *= fmax / fn;
    // a hard pull opens the hand: the soft weld lets go when the mug is dragged 4 cm away from where the hand holds it
    const stretch = Math.hypot(P.target[0] - a[0], P.target[1] - a[1], P.target[2] - a[2]);
    if (this.welded && stretch > 0.04) { this.setWeld(false); this.weldBroken = true; }
    const c = d.xipos.subarray(3 * b, 3 * b + 3), r = [a[0] - c[0], a[1] - c[1], a[2] - c[2]];
    const x = d.xfrc_applied, o = 6 * b;
    x[o] = f[0]; x[o + 1] = f[1]; x[o + 2] = f[2];
    x[o + 3] = r[1] * f[2] - r[2] * f[1]; x[o + 4] = r[2] * f[0] - r[0] * f[2]; x[o + 5] = r[0] * f[1] - r[1] * f[0];
  }

  // the generator's acceptance test: mug within 3 cm (xy) of the goal and tilted less than 20 degrees
  outcome() {
    const { p, q } = this.mugPose(), g = this.ep.goal;
    const xy = Math.hypot(p[0] - g[0], p[1] - g[1]);
    const zz = 1 - 2 * (q[1] * q[1] + q[2] * q[2]);   // R[2][2]
    const tilt = Math.acos(Math.max(-1, Math.min(1, zz))) * 180 / Math.PI;
    return { xy, tilt, ok: xy <= this.ep.xy_max && tilt <= this.ep.tilt_max_deg };
  }

  dispose() {
    try { this.data.delete(); } catch (e) {}
    try { this.model.delete(); } catch (e) {}
    try { this.vfs.delete(); } catch (e) {}
  }
}
