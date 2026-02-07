import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TeapotGeometry } from "three/examples/jsm/geometries/TeapotGeometry.js";

function disposeMaterial(material) {
  if (Array.isArray(material)) {
    material.forEach(disposeMaterial);
    return;
  }

  if (material && typeof material.dispose === "function") {
    material.dispose();
  }
}

function disposeObjectTree(root) {
  root.traverse((node) => {
    if (node.geometry && typeof node.geometry.dispose === "function") {
      node.geometry.dispose();
    }

    if (node.material) {
      disposeMaterial(node.material);
    }
  });
}

function addBaseSceneObjects(scene, runtimeTHREE) {
  const ambientLight = new runtimeTHREE.AmbientLight(0xffffff, 0.5);
  ambientLight.name = "worldAmbientLight";
  scene.add(ambientLight);

  const directionalLight = new runtimeTHREE.DirectionalLight(0xffffff, 1.2);
  directionalLight.name = "worldDirectionalLight";
  directionalLight.position.set(6, 8, 4);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  directionalLight.shadow.camera.near = 0.5;
  directionalLight.shadow.camera.far = 50;
  scene.add(directionalLight);

  const grid = new runtimeTHREE.GridHelper(20, 20, 0x334155, 0x1e293b);
  grid.name = "worldGrid";
  scene.add(grid);

  const ground = new runtimeTHREE.Mesh(
    new runtimeTHREE.PlaneGeometry(40, 40),
    new runtimeTHREE.ShadowMaterial({ opacity: 0.2 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.001;
  ground.receiveShadow = true;
  ground.name = "groundPlane";
  scene.add(ground);
}

export function createScene(container) {
  const runtimeTHREE = {
    ...THREE,
    TeapotGeometry
  };

  const scene = new runtimeTHREE.Scene();
  scene.background = new runtimeTHREE.Color(0x020617);

  const camera = new runtimeTHREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(5, 4, 5);

  const renderer = new runtimeTHREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = runtimeTHREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0.5, 0);
  controls.update();

  addBaseSceneObjects(scene, runtimeTHREE);

  const updateSize = () => {
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  updateSize();

  const resizeObserver = new ResizeObserver(updateSize);
  resizeObserver.observe(container);

  const clock = new runtimeTHREE.Clock();
  let animationHandle = 0;
  let disposed = false;

  function captureViewState() {
    const previousDamping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = previousDamping;

    return {
      camera: {
        position: camera.position.toArray(),
        quaternion: camera.quaternion.toArray(),
        up: camera.up.toArray(),
        near: camera.near,
        far: camera.far,
        fov: camera.fov,
        zoom: camera.zoom,
        focus: camera.focus
      },
      controls: {
        target: controls.target.toArray(),
        enabled: controls.enabled
      }
    };
  }

  function restoreViewState(viewState) {
    if (!viewState || !viewState.camera || !viewState.controls) {
      return;
    }

    camera.position.fromArray(viewState.camera.position);
    camera.quaternion.fromArray(viewState.camera.quaternion);
    camera.up.fromArray(viewState.camera.up);
    camera.near = viewState.camera.near;
    camera.far = viewState.camera.far;
    camera.fov = viewState.camera.fov;
    camera.zoom = viewState.camera.zoom;
    camera.focus = viewState.camera.focus;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    controls.target.fromArray(viewState.controls.target);
    controls.enabled = viewState.controls.enabled;

    const previousDamping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = previousDamping;
    controls.update();
    controls.saveState();
  }

  function resetSceneToBase() {
    for (const child of [...scene.children]) {
      scene.remove(child);
      disposeObjectTree(child);
    }

    scene.background = new runtimeTHREE.Color(0x020617);
    scene.environment = null;
    scene.fog = null;
    scene.overrideMaterial = null;
    scene.backgroundBlurriness = 0;
    scene.backgroundIntensity = 1;

    addBaseSceneObjects(scene, runtimeTHREE);
  }

  const frame = () => {
    if (disposed) {
      return;
    }

    const time = clock.getElapsedTime();
    scene.traverse((object) => {
      if (typeof object.userData?.update !== "function") {
        return;
      }

      try {
        object.userData.update(time);
      } catch (error) {
        console.error(`userData.update failed for "${object.name || "unnamed"}":`, error);
        delete object.userData.update;
      }
    });

    controls.update();
    renderer.render(scene, camera);
    animationHandle = requestAnimationFrame(frame);
  };

  animationHandle = requestAnimationFrame(frame);

  return {
    scene,
    camera,
    renderer,
    THREE: runtimeTHREE,
    captureViewState,
    restoreViewState,
    resetSceneToBase,
    dispose() {
      disposed = true;
      cancelAnimationFrame(animationHandle);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
    }
  };
}
