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
    // what each body is, for the contact visualisation: the mug, the table, the coffee machine, or the robot
    this.bodyKind = [];
    for (let b = 0; b < this.model.nbody; b++) {
      const nm = mujoco.mj_id2name(this.model, T.mjOBJ_BODY.value, b) || '';
      this.bodyKind.push(b === 0 ? 'world' : b === this.mugBody ? 'mug' : b === this.cmBody ? 'cm' : /table/.test(nm) ? 'table' : 'robot');
    }
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

  // --- contact forces ----------------------------------------------------------------------------------------------
  // Every active contact with its normal force (N) and the direction of that force on the mug (or, for contacts that
  // do not touch the mug, on the second body). MuJoCo's contact normal points from geom1 to geom2, so the force on
  // geom2's body is +f n. The normal force is decoded from the constraint forces (pyramidal cone: the sum of the edge
  // forces; elliptic: the first row); checked headlessly: the vertical forces on a resting mug add up to its weight.
  // Contacts are copied out before the force array is read, since allocating the copies can grow the wasm memory and
  // detach typed-array views obtained earlier.
  contacts() {
    const d = this.data, m = this.model, n = d.ncon, out = [];
    if (!n) return out;
    const cv = d.contact, raw = [];
    for (let i = 0; i < n; i++) {
      const c = cv.get(i);
      raw.push([m.geom_bodyid[c.geom1], m.geom_bodyid[c.geom2], c.efc_address, c.dim, Array.from(c.pos), Array.from(c.frame).slice(0, 3)]);
      c.delete();
    }
    cv.delete();
    const ef = d.efc_force, elliptic = m.opt.cone === 1;
    for (const [b1, b2, adr, dim, pos, nrm] of raw) {
      if (adr < 0) continue;
      let f = 0;
      if (elliptic || dim === 1) f = ef[adr]; else for (let j = 0; j < 2 * (dim - 1); j++) f += ef[adr + j];
      if (!(f > 0)) continue;
      const k1 = this.bodyKind[b1], k2 = this.bodyKind[b2], onMug2 = k2 === 'mug', s = (k1 === 'mug') ? -1 : 1;
      const other = k1 === 'mug' ? k2 : k2 === 'mug' ? k1 : null;
      out.push({ pos, dir: [s * nrm[0], s * nrm[1], s * nrm[2]], f, kind: other === null ? 'other' : other === 'robot' ? 'grip' : other === 'cm' ? 'machine' : other, mug: onMug2 || k1 === 'mug' });
    }
    return out;
  }
  // Force with which the hand holds the mug while the grasp constraint is on (as in the data generator, the finger pads
  // do not collide then, so there are no finger contacts): the constraint's translational rows give minus the force on
  // the mug (checked headlessly: +2.94 N straight up, the mug's weight, during a steady carry). Returned with the two
  // finger-pad centres, where it is drawn, split between them; null while the hand is not holding the mug.
  holdForce() {
    if (!this.welded) return null;
    const d = this.data, ty = d.efc_type, id = d.efc_id, ef = d.efc_force, f = [];
    for (let r = 0; r < d.nefc && f.length < 3; r++) if (ty[r] === 0 && id[r] === this.weld) f.push(-ef[r]);
    if (f.length < 3) return null;
    const gx = d.geom_xpos, pad = (a, b) => [0, 1, 2].map(k => 0.5 * (gx[3 * a + k] + gx[3 * b + k]));
    return { f, left: pad(this.pads[0], this.pads[1]), right: pad(this.pads[2], this.pads[3]) };
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
