import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBlocking, blockingText } from "../shared/blocking.js";
const fixture = JSON.parse(fs.readFileSync(new URL("../examples/example.json", import.meta.url)));
test("moving a camera synchronizes text without accumulating stale coordinates or changing the script", () => {
  const shot = fixture.shots[0];
  const a = syncBlocking(shot, { ...shot.blocking, camera: { ...shot.blocking.camera, x: 62 } });
  const b = syncBlocking(a, { ...a.blocking, camera: { ...a.blocking.camera, x: 74 } });
  assert.match(b.camera, /摄影机\(74,/);
  assert.doesNotMatch(b.camera, /摄影机\(62,/);
  assert.equal(b.camera.split("【机位同步】").length, 2);
  assert.ok(b.camera.startsWith(shot.camera));
  assert.deepEqual(b.dialogue, shot.dialogue);
  assert.equal(b.description, shot.description);
  assert.equal(b.actionSeconds, shot.actionSeconds);
  assert.equal(b.storyboardImage, shot.storyboardImage);
});
test("axis side changes with the camera; a single person does not imply a dialogue axis", () => {
  const b = { ...fixture.shots[0].blocking, actors:[{name:"甲",x:25,y:50},{name:"乙",x:75,y:50}] };
  const one = blockingText({ ...b, camera:{x:50,y:80,targetX:50,targetY:50} });
  const two = blockingText({ ...b, camera:{x:50,y:20,targetX:50,targetY:50} });
  assert.match(one.coverage, /顺时针侧/);
  assert.match(two.coverage, /逆时针侧/);
  assert.match(blockingText({ ...b, actors:b.actors.slice(0,1) }).coverage, /未建立双人轴线/);
});
