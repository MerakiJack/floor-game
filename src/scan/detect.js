// Rough object recognition (couch / chair / table / bed / TV ...) with a small on-device model.
// The model is bundled with the app (public/models/coco), so video never leaves the device.
let loading = null;

export function loadDetector() {
  loading ||= (async () => {
    const [tf, coco] = await Promise.all([import('@tensorflow/tfjs'), import('@tensorflow-models/coco-ssd')]);
    await tf.ready();
    const model = await coco.load({ base: 'lite_mobilenet_v2', modelUrl: '/models/coco/model.json' });
    return (source) => model.detect(source, 12, 0.4);
  })();
  loading.catch(() => { loading = null; });
  return loading;
}
