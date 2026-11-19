export const Status = Object.freeze({
  COVER: 'Cover risk',
  EDIT: 'Edit-blocked',
  UNKNOWN: 'Unverified',
  OK: 'OK'
});

const order = [Status.COVER, Status.EDIT, Status.UNKNOWN, Status.OK];

function imageKey(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.hostname + decodeURIComponent(url.pathname.split('@')[0]);
  } catch {
    return null;
  }
}

function flag(value) {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  return null;
}

function getGallery(design) {
  const extension = design.designExtension;
  const galleries = [extension?.design_pictures, design.pictures].filter(Array.isArray);
  const markedGallery = Array.isArray(extension?.real_pictures) ? extension.real_pictures : [];
  const photos = new Map();
  for (const picture of [...galleries.flat(), ...markedGallery]) {
    const key = imageKey(picture?.url ?? picture);
    if (!key) continue;
    const marked = flag(picture?.isRealLifePhoto);
    const previous = photos.get(key);
    // A positive marker survives duplicate renditions in the two gallery fields.
    photos.set(key, previous === true || marked === true ? true : marked ?? previous ?? null);
  }
  return { photos, complete: galleries.length > 0 };
}

function count(value) {
  if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function classifyDesign(design) {
  const { photos, complete } = getGallery(design);
  const coverKey = imageKey(design.coverUrl);
  const coverMarked = coverKey
    ? photos.get(coverKey) ?? flag(design.isRealLifePhoto)
      ?? (complete && !photos.has(coverKey) ? false : null)
    : null;
  const values = [...photos.values()];
  const markedCount = values.filter(value => value === true).length;
  const unmarkedCount = values.filter(value => value === null).length;
  const editBlocked = markedCount >= 3 ? false
    : complete && markedCount + unmarkedCount < 3 ? true : null;

  let status = Status.UNKNOWN;
  if (coverMarked === false) status = Status.COVER;
  else if (editBlocked === true) status = Status.EDIT;
  else if (coverMarked === true && editBlocked === false) status = Status.OK;

  return {
    id: design.id,
    title: design.title?.trim() || '',
    handle: typeof design.designCreator?.handle === 'string' ? design.designCreator.handle : null,
    totalPhotos: complete ? photos.size : null,
    realPhotos: complete && !unmarkedCount ? markedCount : null,
    knownRealPhotos: markedCount,
    coverMarked,
    editBlocked,
    downloads: count(design.downloadCount),
    points: count(design.points ?? design.pointCount),
    status
  };
}

export function compareRows(a, b) {
  return order.indexOf(a.status) - order.indexOf(b.status)
    || Number(b.editBlocked === true) - Number(a.editBlocked === true)
    || (b.downloads ?? -1) - (a.downloads ?? -1)
    || a.title.localeCompare(b.title)
    || String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
}
