import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { classifyDesign, compareRows, Status } from '../src/classification.js';
import { makeCsv } from '../src/csv.js';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/designs.json', import.meta.url)));

test('gives edit-blocked precedence over an explicit cover risk', () => {
  const row = classifyDesign(fixtures.dualRisk);
  assert.equal(row.totalPhotos, 2);
  assert.equal(row.realPhotos, 1);
  assert.equal(row.coverMarked, false);
  assert.equal(row.editBlocked, true);
  assert.equal(row.status, Status.EDIT);
  assert.equal(row.downloads, 1204);
});

test('retains cover risk when the gallery meets the threshold', () => {
  const row = classifyDesign(fixtures.coverRisk);
  assert.equal(row.realPhotos, 3);
  assert.equal(row.editBlocked, false);
  assert.equal(row.status, Status.COVER);
});

test('flags two marked gallery photos independently of the marked cover', () => {
  const row = classifyDesign(fixtures.editBlocked);
  assert.equal(row.coverMarked, true);
  assert.equal(row.editBlocked, true);
  assert.equal(row.status, Status.EDIT);
});

test('supports a top-level gallery and the exact three-photo threshold', () => {
  const row = classifyDesign({ ...fixtures.ok, points: '0' });
  assert.equal(row.totalPhotos, 3);
  assert.equal(row.realPhotos, 3);
  assert.equal(row.points, 0);
  assert.equal(row.status, Status.OK);
});

test('keeps missing gallery metadata unknown even when instance photos exist', () => {
  const row = classifyDesign(fixtures.unknown);
  assert.equal(row.totalPhotos, null);
  assert.equal(row.realPhotos, null);
  assert.equal(row.editBlocked, null);
  assert.equal(row.coverMarked, null);
  assert.equal(row.status, Status.UNKNOWN);
});

test('adds a standalone cover once and preserves positive duplicate gallery flags', () => {
  const design = structuredClone(fixtures.dualRisk);
  const gallery = design.designExtension;
  gallery.real_pictures.push({ url: design.coverUrl, isRealLifePhoto: 1 });
  assert.equal(classifyDesign(design).coverMarked, true);
  assert.equal(classifyDesign(design).totalPhotos, 2);
  assert.equal(classifyDesign(design).realPhotos, 2);
  design.coverUrl = 'https://makerworld.bblmw.com/model/a/standalone.jpg';
  design.isRealLifePhoto = 1;
  const row = classifyDesign(design);
  assert.equal(row.coverMarked, true);
  assert.equal(row.totalPhotos, 3);
  assert.equal(row.editBlocked, true);
  assert.equal(row.realPhotos, 2);
});

test('keeps a separate cover with no marker unknown when gallery photos are marked', () => {
  const row = classifyDesign(fixtures.standaloneCover);
  assert.equal(row.coverMarked, null);
  assert.equal(row.totalPhotos, 4);
  assert.equal(row.realPhotos, 3);
  assert.equal(row.editBlocked, false);
  assert.equal(row.status, Status.UNKNOWN);
  assert.match(makeCsv([row]), /"4","3","Unknown"/);
});

test('keeps a cover in the gallery unknown if it has no marker', () => {
  const design = structuredClone(fixtures.coverRisk);
  delete design.designExtension.design_pictures[0].isRealLifePhoto;
  const row = classifyDesign(design);
  assert.equal(row.totalPhotos, 4);
  assert.equal(row.coverMarked, null);
  assert.equal(row.status, Status.UNKNOWN);
});

test('allows an unknown flag to affect the threshold without assuming the photo is real', () => {
  const design = structuredClone(fixtures.ok);
  delete design.pictures[2].isRealLifePhoto;
  const row = classifyDesign(design);
  assert.equal(row.knownRealPhotos, 2);
  assert.equal(row.realPhotos, null);
  assert.equal(row.editBlocked, null);
  assert.equal(row.status, Status.UNKNOWN);
});

test('sorts edit-blocked first, followed by cover risk, unverified, and OK', () => {
  const rows = Object.values(fixtures).map(classifyDesign).reverse().sort(compareRows);
  assert.deepEqual(rows.map(row => row.id), [1001, 1003, 1002, 1006, 1005, 1004]);
});

test('quotes CSV and neutralizes spreadsheet formulas in public titles', () => {
  const row = classifyDesign({ ...fixtures.dualRisk, title: '=SUM(1,2)\nHello "world"', url: 'unused' });
  const csv = makeCsv([{ ...row, url: 'https://makerworld.com/en/models/1001' }]);
  assert.match(csv, /"'=SUM\(1,2\)\nHello ""world"""/);
  assert.match(csv, /"Edit-blocked","Yes",""\r\n$/);
});
