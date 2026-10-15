// xArm7 with its parallel-jaw gripper, built from the URDF kinematic tree (assets/robot/xarm7.json) and one mesh node per
// link (assets/robot/xarm7.glb, geometry in the link frame). setQ() takes the 7 arm joints, setGrip() the gripper drive
// joint in radians (0 open .. 0.85 closed); the five mimic joints follow it. fk() gives link poses without touching
// the scene graph (used by the in-browser IK).
import * as THREE from 'three';
import { loadGLB, fetchJSON } from './assets.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

const ARM = ['joint1', 'joint2', 'joint3', 'joint4', 'joint5', 'joint6', 'joint7'];

export async function loadXArm({ shadows = true } = {}) {
  const [spec, gltf] = await Promise.all([fetchJSON('assets/robot/xarm7.json'), loadGLB('assets/robot/xarm7.glb')]);
  const links = {}, joints = {};
  const linkOf = name => links[name] || (links[name] = Object.assign(new THREE.Group(), { name }));
  const root = linkOf(spec.root);
  for (const j of spec.joints) {
    const origin = new THREE.Group();
    origin.matrixAutoUpdate = false;
    origin.matrix.fromArray(j.T).transpose();
    linkOf(j.parent).add(origin);
    const child = linkOf(j.child);
    origin.add(child);
    joints[j.name] = { ...j, axisV: new THREE.Vector3(...j.axis).normalize(), child, origin, q: 0 };
  }
  // meshes: copy each link node (with its own dequantization transform) under its link group. The GLB has no normals:
  // creased normals (30 deg) keep the CAD edges sharp and the curved shells smooth; done once on the cached GLB.
  gltf.scene.updateMatrixWorld(true);
  if (!gltf.userData.creased) {
    gltf.userData.creased = true;
    gltf.scene.traverse(m => { if (m.isMesh && !m.geometry.attributes.normal) m.geometry = toCreasedNormals(m.geometry, Math.PI / 6); });
  }
  for (const name of Object.keys(links)) {
    const n = gltf.scene.getObjectByName(name);
    if (!n) continue;
    const c = n.clone(true);
    c.traverse(m => { if (m.isMesh) { m.castShadow = shadows; m.receiveShadow = shadows; } });
    links[name].add(c);
  }
  const mimics = spec.joints.filter(j => j.mimic);
  function setJoint(name, q) {
    const j = joints[name]; if (!j) return;
    j.q = q;
    if (j.type === 'prismatic') j.child.position.copy(j.axisV).multiplyScalar(q);
    else j.child.quaternion.setFromAxisAngle(j.axisV, q);
  }
  const api = {
    root, links, joints, tcp: links[spec.tcp], ARM,
    setQ(q) { for (let i = 0; i < 7; i++) setJoint(ARM[i], q[i]); },
    setGrip(g) {
      setJoint('drive_joint', g);
      for (const m of mimics) setJoint(m.name, m.mimic.multiplier * g + m.mimic.offset);
    },
    q() { return ARM.map(n => joints[n].q); },
  };
  api.setGrip(0);
  return api;
}

// Pure forward kinematics on the arm chain world -> link_tcp (no scene graph), for IK. Returns a THREE.Matrix4 per joint
// frame (after the joint rotation) and the TCP; reuses its buffers between calls.
export function makeFK(spec) {
  const byChild = Object.fromEntries(spec.joints.map(j => [j.child, j]));
  const chain = [];
  for (let l = spec.tcp; byChild[l]; l = byChild[l].parent) chain.unshift(byChild[l]);
  const T = chain.map(j => new THREE.Matrix4().fromArray(j.T).transpose());
  const axes = chain.map(j => new THREE.Vector3(...j.axis).normalize());
  const idx = chain.map(j => ARM.indexOf(j.name));
  const R = new THREE.Matrix4(), frames = chain.map(() => new THREE.Matrix4()), tcp = new THREE.Matrix4();
  return {
    chain, idx, axes,
    run(q) {
      const M = tcp.identity();
      for (let k = 0; k < chain.length; k++) {
        M.multiply(T[k]);
        if (idx[k] >= 0) M.multiply(R.makeRotationAxis(axes[k], q[idx[k]]));
        frames[k].copy(M);
      }
      return { frames, tcp: M };
    },
  };
}
