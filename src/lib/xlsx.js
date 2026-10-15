import writeXlsxFile from 'write-excel-file/browser'

// sheets: [{ name, headers: [..], rows: [[..]], widths: [..], money: [colIndex...] }]
export async function downloadXlsx(filename, sheets) {
  const B = { fontWeight: 'bold', backgroundColor: '#E8F1EC' }
  const cell = (v, money) => (v == null || v === '' ? null
    : typeof v === 'number' ? { value: v, type: Number, ...(money ? { format: '0.000' } : {}) }
    : { value: String(v), type: String })
  const blob = await writeXlsxFile(sheets.map((s) => ({
    sheet: s.name.slice(0, 30), rightToLeft: true, stickyRowsCount: 1,
    columns: (s.widths || s.headers.map(() => 16)).map((width) => ({ width })),
    data: [s.headers.map((h) => ({ value: h, ...B })), ...s.rows.map((r) => r.map((v, i) => cell(v, (s.money || []).includes(i))))],
  }))).toBlob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename.endsWith('.xlsx') ? filename : filename + '.xlsx'
  a.click()
}
