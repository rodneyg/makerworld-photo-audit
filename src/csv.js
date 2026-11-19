export function realPhotoLabel(row) {
  if (row.realPhotos !== null) return row.realPhotos;
  return row.knownRealPhotos > 0 ? `At least ${row.knownRealPhotos}` : 'Unknown';
}

export function coverLabel(row) {
  if (row.coverMarked === true) return 'Marked';
  if (row.coverMarked === false) return 'Not marked';
  return 'Unknown';
}

function escapeCell(value) {
  let text = String(value ?? '');
  // Treat public model titles as text when a spreadsheet opens the CSV.
  if (/^\s*[=+\-@\t\r\n]/u.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function makeCsv(rows) {
  return [
    ['Model', 'Link', 'Total photos', 'Real-life photos', 'Cover real-life', 'Downloads', 'Points', 'Status', 'Edit-blocked', 'Note'],
    ...rows.map(row => [
      row.title, row.url, row.totalPhotos, realPhotoLabel(row), coverLabel(row),
      row.downloads, row.points, row.status,
      row.editBlocked === null ? 'Unknown' : row.editBlocked ? 'Yes' : 'No',
      row.note
    ])
  ].map(row => row.map(escapeCell).join(',')).join('\r\n') + '\r\n';
}
