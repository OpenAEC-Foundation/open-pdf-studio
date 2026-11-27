import assert from 'node:assert/strict';
import test from 'node:test';
import { cropBoxFromPixels, cropOriginShift } from './crop-margins-geometrie.js';
// Een bestaande viewport [100,50,500,350], schaal 2. De browsertest gebruikt
// echte PDF.js-viewports voor alle kwartslagen, /UserUnit en gebruikersrotatie.
const viewport = { scale: 2, userUnit: 1,
  convertToPdfPoint: (x,y) => [100+x/2,350-y/2],
  convertToViewportPoint: (x,y) => [(x-100)*2,(350-y)*2] };
const media = { x: 0, y: 0, width: 600, height: 400 };
test('bestaand bijsnijvak en volledige laatste pixel tellen mee', () => {
  const crop = cropBoxFromPixels({minX:100,minY:300,maxX:499,maxY:499},viewport,media,0);
  assert.deepEqual(crop,{x:150,y:100,width:200,height:100});
  assert.deepEqual(cropOriginShift(crop,viewport),{dx:-50,dy:-150});
});
test('inhoud van één pixel houdt een positief bijsnijvak', () => {
  assert.deepEqual(cropBoxFromPixels({minX:0,minY:0,maxX:0,maxY:0},viewport,media,0),
    {x:100,y:349.5,width:.5,height:.5});
});
test('padding wordt per grens geklemd; links afkappen vergroot rechts niet', () => {
  const v={scale:1,userUnit:1,convertToPdfPoint:(x,y)=>[x,400-y]};
  assert.deepEqual(cropBoxFromPixels({minX:2,minY:2,maxX:9,maxY:9},v,media,5),
    {x:0,y:385,width:15,height:15});
});
test('padding in fysieke punten wordt door UserUnit gedeeld', () => {
  assert.deepEqual(cropBoxFromPixels({minX:100,minY:300,maxX:499,maxY:499},
    {...viewport,userUnit:2},media,10),{x:145,y:95,width:210,height:110});
});
