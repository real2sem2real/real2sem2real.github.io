// Keep most of a viewer's horizontal field of view when its box gets narrower than it was framed for (phones show the
// steps in a taller box): widen the vertical FOV instead of cropping the sides.
export function keepWidth(box, camera, fov0 = camera.fov, design = 1.4) {
  const fit = () => {
    const w = box.clientWidth, h = box.clientHeight; if (!w || !h) return;
    const a = w / h, t = Math.tan(fov0 * Math.PI / 360);
    camera.fov = a < design ? Math.min(70, 360 / Math.PI * Math.atan(t * design / a)) : fov0;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(fit).observe(box); fit();
}
