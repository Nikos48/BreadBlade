import './style.css';
import * as THREE from "three";
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import Bender from 'bender';

const pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const onUpPosition = new THREE.Vector2();
const onDownPosition = new THREE.Vector2();
const curvePointCount = 6;

const params = new Proxy(new URLSearchParams(window.location.search), {
  get: (searchParams, prop) => searchParams.get(prop),
});

let blade_depth = params.blade_depth == null ? 10/3 : params.blade_depth * (10/3)
let height = params.height == null ? 500 : params.height * 10
let width = params.width == null ? 300 : params.width * 10
document.getElementById("blade_depth").value = params.blade_depth == null ? 1 : params.blade_depth;
document.getElementById("height").value = height/10;
document.getElementById("width").value = width/10;
let radiusY = width / 2
let radiusX = height / 2
let cylinder_radius = (radiusX / Math.PI) - blade_depth

// function update_values(){
//   blade_depth = document.getElementById("blade_depth").value;
//   height = document.getElementById("height").value;
//   width = document.getElementById("width").value;
//   radiusY = width / 2;
//   radiusX = height / 2;
//   cylinder_radius = (radiusX / Math.PI) - blade_depth;
//   scene3d.remove(scene3d.children[0]);
//   scene3d.remove(scene3d.children[0]);
//   let [geometry, mesh] = compute_3d()
//   compute_scheme(geometry, mesh)
// }

// materials vvv
const material_cylinder = new THREE.MeshBasicMaterial( { color : 0xff0000, side: THREE.DoubleSide, wireframe: false, opacity: 0.3, transparent: true } );
const material_blade = new THREE.MeshBasicMaterial( { color : 0xffffff, wireframe: true } );
const material_unbended = new THREE.MeshBasicMaterial( { color : 0xffffff, wireframe: true } );


// 2d input stuff vvv
const scene_input = new THREE.Scene();
const camera_input = new THREE.OrthographicCamera(innerWidth/-0.3, innerWidth/0.3, innerHeight/0.3, innerHeight/-0.3, 1, 1000);
const renderer_input = new THREE.WebGLRenderer({
  canvas: document.querySelector('#canvas_input'),
});
renderer_input.setPixelRatio(window.devicePixelRatio);
camera_input.aspect = (innerWidth) / (innerHeight);
camera_input.updateProjectionMatrix();
camera_input.position.setZ(300);
camera_input.lookAt(0, 0, 0);
renderer_input.setSize(innerWidth/2, innerHeight/2);
let initialCurve = new THREE.SplineCurve([
  new THREE.Vector2(-radiusX, 0),
  new THREE.Vector2(-0.95*radiusX, 0.4*radiusY),
  new THREE.Vector2(-0.7*radiusX, 0.7*radiusY),
  new THREE.Vector2(-0.4*radiusX, 0.95*radiusY),
  new THREE.Vector2(0, 1*radiusY),
]).getPoints(curvePointCount+1);
var last_lines = [];
function renderCurve() {
  let curvePointsRender = [new THREE.Vector2(-radiusX*10, 0)];
  curvePoints.forEach(point => curvePointsRender.push(new THREE.Vector2(point.position.x, point.position.y)));
  curvePointsRender.push(new THREE.Vector2(0, radiusY*10));
  let ovalPointsRender = curvePointsRender;
  ovalPointsRender = ovalPointsRender.concat(curvePointsRender.map(p => p.clone().multiply(new THREE.Vector2(-1, 1))).reverse())
  ovalPointsRender = ovalPointsRender.concat(curvePointsRender.map(p => p.clone().multiply(new THREE.Vector2(-1, -1))))
  ovalPointsRender = ovalPointsRender.concat(curvePointsRender.map(p => p.clone().multiply(new THREE.Vector2(1, -1))).reverse())
  // ovalPointsRender.map(p => p.clamp(new THREE.Vector2(-radiusX*10, -radiusY*10), new THREE.Vector2(radiusX*10, radiusY*10)));
  // console.log(ovalPointsRender);
  let oval = new THREE.SplineCurve(ovalPointsRender).getPoints(200);
  oval.map(p => p.clamp(new THREE.Vector2(-radiusX*10, -radiusY*10), new THREE.Vector2(radiusX*10, radiusY*10)));
  // scene_input.remove(scene_input.children[curvePoints.length]);
  last_lines.forEach( line =>
    scene_input.remove(line)
  )
  last_lines = [];
  for (let i = 0; i < 4; i++) {
    let line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(oval), new THREE.LineBasicMaterial({color: 0xffffff}))
    last_lines.push(line);
    scene_input.add(line);
  }
  compute_3d(oval);
}
let curvePoints = [];
for (let i = 0; i < curvePointCount; i++) {
  let p = new THREE.Mesh(new THREE.SphereGeometry(100, 320, 320), new THREE.MeshBasicMaterial({color: 0xff0000}));
  p.position.setZ(-300);
  curvePoints.push(p);
} // scene_input.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(50)), new THREE.LineBasicMaterial({color: 0xffffff})));

const transform_controls = new TransformControls(camera_input, renderer_input.domElement);
transform_controls.addEventListener('dragging-changed', function (event) {
  controls.enabled = !event.value;
});


curvePoints.forEach((point, index) => {scene_input.add(point); point.position.z = parseFloat(1); point.position.setX(initialCurve[index+1].x*10); point.position.setY(initialCurve[index+1].y*10);});

const start_point = new THREE.Mesh(new THREE.SphereGeometry(100, 320, 320), new THREE.MeshBasicMaterial({color: 0xa2a2a2}));
start_point.position.setX(-radiusX*10);
start_point.position.setY(0);
const end_point = new THREE.Mesh(new THREE.SphereGeometry(100, 320, 320), new THREE.MeshBasicMaterial({color: 0xa2a2a2}));
end_point.position.setX(0);
end_point.position.setY(radiusY*10);
scene_input.add(start_point);
scene_input.add(end_point);
// transform_controls.attach(curvePoints[0]);
transform_controls.setSize(0.7);
const gizmo = transform_controls._gizmo.gizmo;

["X", "Y", "Z", "XY","YZ", "XZ"].forEach(axis => {
    let children = gizmo.translate.children.filter(child => child.name === axis);
    children.forEach(obj => {
      obj.visible = false;
      obj.layers.disable(0);
    })
});
  
scene_input.add(transform_controls.getHelper());

function onPointerDown( event ) {

  onDownPosition.x = event.clientX;
  onDownPosition.y = event.clientY;

}

function onPointerUp( event ) {

  onUpPosition.x = event.clientX;
  onUpPosition.y = event.clientY;
  renderCurve();
}
// transform_controls.addEventListener('mouseUp') = function (event) {
  // onPointerUp(event);
//   console.log('up')
//   renderCurve();
// }
function onPointerMove( event ) {

  pointer.x = ( event.clientX / (window.innerWidth/4) - 1);
  pointer.y = - ( event.clientY / (window.innerHeight/4) ) + 3;
  raycaster.setFromCamera( pointer, camera_input );

  const intersects = raycaster.intersectObjects( curvePoints, false );

  if ( intersects.length > 0 ) {

    const object = intersects[ 0 ].object;

    if ( object !== transform_controls.object ) {
      transform_controls.detach();
      transform_controls.attach( object );
      animate();

    }
  }
}

document.addEventListener( 'pointerdown', onPointerDown );
transform_controls.addEventListener( 'mouseUp', onPointerUp );
document.addEventListener( 'pointermove', onPointerMove );
// 3d stuff vvv
const bender = new Bender();

const scene3d = new THREE.Scene();

const camera3d = new THREE.PerspectiveCamera(75, (window.innerWidth) / window.innerHeight, 0.1, 1000);
camera3d.position.setZ(30);

const renderer3d = new THREE.WebGLRenderer({
  canvas: document.querySelector('#canvas3d'),
});
renderer3d.setPixelRatio(window.devicePixelRatio);
camera3d.aspect = (innerWidth) / (innerHeight);
camera3d.updateProjectionMatrix();
renderer3d.setSize(innerWidth/2, innerHeight/2);
const controls = new OrbitControls( camera3d, renderer3d.domElement );

// resize
window.addEventListener("resize", () => {
  camera3d.aspect = (innerWidth) / (innerHeight);
  camera_input.aspect = (innerWidth) / (innerHeight);
  
  camera3d.updateProjectionMatrix();
  camera_input.updateProjectionMatrix();

  renderer3d.setSize(innerWidth/2, innerHeight/2);
  renderer_input.setSize(innerWidth/2, innerHeight/2);
  
})


function compute_3d(points) {
  points = points.map(p => p.clone().multiply(new THREE.Vector2(0.1, 0.1)));
  let cylinder = new THREE.Mesh(new THREE.CylinderGeometry(cylinder_radius, cylinder_radius, 2*radiusY, 128, 1 , false), material_cylinder);
  console.log(scene3d.children);
  for (let i = scene3d.children.length-1; i >= 0  ; i--) {
    console.log("hi");
    console.log(scene3d.children[i]);
    console.log(i);
    scene3d.remove(scene3d.children[i]);
  }
  scene3d.add(cylinder);
  // let oval = new THREE.SplineCurve([
  //   new THREE.Vector2(radiusX, 0),
  //   // new THREE.Vector2(1*radiusX, 1*radiusY),
  //   new THREE.Vector2(0.95*radiusX, 0.4*radiusY),
  //   new THREE.Vector2(0.7*radiusX, 0.7*radiusY),
  //   // new THREE.Vector2(0.8*radiusX, 0.8*radiusY),
  //   new THREE.Vector2(0.4*radiusX, 0.95*radiusY),
  //   new THREE.Vector2(0, 1*radiusY),
  // ])
  
  // const points1 = oval.getPoints(50)
  // const points2 = points1.map(p => p.clone().multiply(new THREE.Vector2(-1, 1))).reverse()
  // const points3 = points1.map(p => p.clone().multiply(new THREE.Vector2(-1, -1)))
  // const points4 = points1.map(p => p.clone().multiply(new THREE.Vector2(1, -1))).reverse()
  // const points = points1.concat(points2).concat(points3).concat(points4).map(p => p.clone().clamp(new THREE.Vector2(-radiusX, -radiusY), new THREE.Vector2(radiusX, radiusY)));
  
  const blade_shape = new THREE.Shape(points);
  blade_shape.holes = [new THREE.Path(points)];
  const extrude_settings = { 
    depth: blade_depth,
    curveSegments: 1,
    bevelEnabled: false, 
    // bevelSegments: 1, 
    // steps: 1, 
    // bevelSize: 1, 
    // bevelThickness: 1,
    
  };
  let geometry = new THREE.ExtrudeGeometry(blade_shape, extrude_settings);
  bender.bend(geometry, "y", Math.PI/radiusX)
  let mesh = new THREE.Mesh(geometry, material_blade);
  mesh.position.z = -cylinder_radius-blade_depth;
  scene3d.add(mesh);
  camera3d.position.z = width;
  return [geometry, mesh];
}

function compute_scheme(geometry, mesh){
  const unbended_geometry = geometry.clone();

  const v = unbended_geometry.attributes.position.array;
  // v.splice(v.length/2, v.length/2);
  
  let true_x = mesh.position.x;
  let start_y = mesh.position.y;
  let total_elevation_right = start_y;
  let total_elevation_left = start_y;
  let prev_x_left = 0;
  let prev_y_left = 0;
  let prev_x_right = 0;
  let prev_y_right = 0;
  
  for (let i = -9; i < v.length/8-36; i += 18) {
  
    let x_left = v[i+9];
    let y_left = v[i+10];
    let z_left = v[i+11];
  
    let x_right = v[i+15];
    let y_right = v[i+16];
    let z_right = v[i+17];
  
    let elevation_left =  Math.sqrt((x_left - prev_x_left)**2 + (y_left - prev_y_left)**2);
    let elevation_right = Math.sqrt((x_right - prev_x_right)**2 + (y_right - prev_y_right)**2);
    
    if (x_left >= prev_x_left) {
      total_elevation_left += elevation_left;
    } else {
      total_elevation_left -= elevation_left - (y_left - prev_y_left);
    }
    if (x_right >= prev_x_right) {
      total_elevation_right += elevation_right;
    } else {
      total_elevation_right -= elevation_right - (y_right - prev_y_right);
    }
  
    prev_x_left = x_left;
    prev_y_left = y_left;
    prev_x_right = x_right;
    prev_y_right = y_right;
  
    y_left = total_elevation_left;
    y_right = total_elevation_right;
  
    // left x
    v[i-6] = true_x;
    v[i] = true_x;
    v[i+9] = true_x;
  
    // left y
    v[i-5] = y_left;
    v[i+1] = y_left;
    v[i+10] = y_left;
  
    // right x
    v[i+3] = true_x;
    v[i+15] = true_x;
    v[i+24] = true_x;
  
    // right y
    v[i+4] = y_right;
    v[i+16] = y_right;
    v[i+25] = y_right;
  
    // break;
    
  }
  unbended_geometry.attributes.position.needsUpdate = true;
  let unbended_mesh = new THREE.Mesh(unbended_geometry, material_unbended);
  unbended_mesh.position.z = -2*cylinder_radius-blade_depth;
  // scene3d.add(unbended_mesh)
}



// unbended_mesh.position.z = 50

// camera.position.y = -10;
// camera.position.x = 50


controls.update();
function animate(time) {
  requestAnimationFrame(animate)
  controls.update();
  // camera.position.x = 30 * Math.sin(time / 1000);
  // camera.position.z = 30 * Math.cos(time / 1000);
  // camera.position.y = 30 * Math.cos(time / 1000);
  camera3d.lookAt(0, 0, 0);
  renderer3d.render(scene3d, camera3d);
  renderer_input.render(scene_input, camera_input);
}

// let [geometry, mesh] = compute_3d()
// compute_scheme(geometry, mesh)
animate()
renderCurve()