const tsvInput = document.getElementById('tsvFiles');
const jsonInput = document.getElementById('jsonFile');
const rtInput = document.getElementById('rtThr');
const processBtn = document.getElementById('processBtn');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const statFiles = document.getElementById('statFiles');
const statStandards = document.getElementById('statStandards');
const statRows = document.getElementById('statRows');
const statColumns = document.getElementById('statColumns');
const downloadCsvBtn = document.getElementById('downloadCsv');
const downloadTsvBtn = document.getElementById('downloadTsv');
const tableScroll = document.getElementById('tableScroll');
const ySelect = document.getElementById('ySelect');
const chartCanvas = document.getElementById('chartCanvas');
const chartLegend = document.getElementById('chartLegend');

const palette = [
  '#0f7b6c',
  '#e6a13a',
  '#1e4f8a',
  '#b45732',
  '#2a9d8f',
  '#6d8a2b',
  '#cb7b3c'
];

const state = {
  stddf: null,
  filesData: [],
  stdDict: {}
};

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function cleanCell(value) {
  const trimmed = value.replace(/^"+|"+$/g, '').trim();
  if (!trimmed) {
    return '';
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed;
}

function parseTsv(name, text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length < 2) {
    throw new Error(`TSV file "${name}" has no data rows.`);
  }
  const header = lines[0].split('\t').map((cell, index) => {
    const cleaned = cleanCell(cell);
    if (index === 0 && typeof cleaned === 'string') {
      return cleaned.replace(/^\uFEFF/, '');
    }
    return cleaned;
  });
  const rows = lines.slice(1).map((line) => {
    const cells = line.split('\t');
    return header.map((_, idx) => cleanCell(cells[idx] ?? ''));
  });
  if (header.length < 3) {
    throw new Error(`TSV file "${name}" needs at least 3 columns.`);
  }
  return { name, columns: header, rows };
}

function columnsSignature(columns) {
  return columns.map((col) => String(col)).join('||');
}

function getNumeric(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return Number(value);
  }
  return Number.NaN;
}

function computeStdDf(filesData, stdDict, rtThr) {
  const stdNames = Object.keys(stdDict);
  if (stdNames.length === 0) {
    throw new Error('Standard JSON has no keys.');
  }
  const baseColumns = filesData[0].columns;
  const columns = ['Standard', 'File', ...baseColumns];
  const rows = [];
  const rtIdx = 2;
  const lastIdx = baseColumns.length - 1;
  const maxIter = 200;

  for (const stdName of stdNames) {
    const target = getNumeric(stdDict[stdName]);
    if (!Number.isFinite(target)) {
      throw new Error(`Standard "${stdName}" has non-numeric retention time.`);
    }
    for (const fileData of filesData) {
      const sorted = fileData.rows
        .slice()
        .sort((a, b) => getNumeric(a[rtIdx]) - getNumeric(b[rtIdx]));
      let sample = [];
      let iter = 0;
      while (sample.length === 0 && iter < maxIter) {
        const thr = rtThr * (1 + 0.1 * iter);
        sample = sorted.filter((row) => {
          const rtVal = getNumeric(row[rtIdx]);
          return Number.isFinite(rtVal) && rtVal >= target - thr && rtVal <= target + thr;
        });
        iter += 1;
      }
      if (sample.length === 0) {
        throw new Error(
          `No match found for standard "${stdName}" in file "${fileData.name}".`
        );
      }
      let bestRow = sample[0];
      let bestVal = getNumeric(sample[0][lastIdx]);
      for (const row of sample) {
        const signal = getNumeric(row[lastIdx]);
        if (signal > bestVal) {
          bestVal = signal;
          bestRow = row;
        }
      }
      rows.push([stdName, fileData.name, ...bestRow]);
    }
  }

  return { columns, rows };
}

function buildDelimited(stddf, delimiter) {
  const escapeCell = (value) => {
    const raw = value === null || value === undefined ? '' : String(value);
    let cell = raw.replace(/"/g, '""');
    if (cell.includes(delimiter) || cell.includes('\n') || cell.includes('"')) {
      cell = `"${cell}"`;
    }
    return cell;
  };
  const lines = [];
  lines.push(stddf.columns.map(escapeCell).join(delimiter));
  for (const row of stddf.rows) {
    lines.push(row.map(escapeCell).join(delimiter));
  }
  return lines.join('\n');
}

function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function renderTable(stddf) {
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  stddf.columns.forEach((col) => {
    const th = document.createElement('th');
    th.textContent = col;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  const tbody = document.createElement('tbody');
  stddf.rows.forEach((row) => {
    const tr = document.createElement('tr');
    row.forEach((cell) => {
      const td = document.createElement('td');
      td.textContent = cell;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(thead);
  table.appendChild(tbody);
  tableScroll.innerHTML = '';
  tableScroll.appendChild(table);
}

function renderStats(stddf) {
  statFiles.textContent = state.filesData.length;
  statStandards.textContent = Object.keys(state.stdDict).length;
  statRows.textContent = stddf.rows.length;
  statColumns.textContent = stddf.columns.length;
}

function detectNumericColumns(stddf) {
  const numericColumns = [];
  stddf.columns.forEach((col, idx) => {
    if (col === 'Standard' || col === 'File') {
      return;
    }
    const values = stddf.rows.map((row) => row[idx]).filter((val) => val !== '');
    if (values.length === 0) {
      return;
    }
    const isNumeric = values.every((val) => typeof val === 'number' && Number.isFinite(val));
    if (isNumeric) {
      numericColumns.push(col);
    }
  });
  return numericColumns;
}

function renderLegend(files) {
  chartLegend.innerHTML = '';
  files.forEach((file, idx) => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.style.background = palette[idx % palette.length];
    const label = document.createElement('span');
    label.textContent = file;
    item.appendChild(swatch);
    item.appendChild(label);
    chartLegend.appendChild(item);
  });
}

function renderChart(stddf, yColumn) {
  const standardIdx = stddf.columns.indexOf('Standard');
  const fileIdx = stddf.columns.indexOf('File');
  const yIdx = stddf.columns.indexOf(yColumn);
  if (yIdx === -1) {
    return;
  }

  const standards = [...new Set(stddf.rows.map((row) => row[standardIdx]))];
  const files = [...new Set(stddf.rows.map((row) => row[fileIdx]))];
  renderLegend(files);

  const maxVal = Math.max(
    ...stddf.rows.map((row) => {
      const value = getNumeric(row[yIdx]);
      return Number.isFinite(value) ? value : 0;
    }),
    1
  );

  chartCanvas.classList.remove('is-ready');
  chartCanvas.innerHTML = '';

  standards.forEach((standard) => {
    const group = document.createElement('div');
    group.className = 'chart-group';
    const bars = document.createElement('div');
    bars.className = 'chart-bars';

    files.forEach((file, idx) => {
      const match = stddf.rows.find(
        (row) => row[standardIdx] === standard && row[fileIdx] === file
      );
      if (!match) {
        return;
      }
      const value = getNumeric(match[yIdx]);
      const bar = document.createElement('div');
      bar.className = 'chart-bar';
      const barHeight = Number.isFinite(value) ? (value / maxVal) * 100 : 0;
      bar.style.setProperty('--bar-h', `${barHeight}%`);
      bar.style.background = palette[idx % palette.length];
      const label = document.createElement('span');
      label.textContent = Number.isFinite(value) ? value.toFixed(2) : 'n/a';
      bar.appendChild(label);
      bars.appendChild(bar);
    });

    const label = document.createElement('div');
    label.className = 'chart-label';
    label.textContent = standard;

    group.appendChild(bars);
    group.appendChild(label);
    chartCanvas.appendChild(group);
  });

  requestAnimationFrame(() => {
    chartCanvas.classList.add('is-ready');
  });
}

function updateYAxisOptions(stddf) {
  const numericColumns = detectNumericColumns(stddf);
  ySelect.innerHTML = '';
  numericColumns.forEach((col) => {
    const option = document.createElement('option');
    option.value = col;
    option.textContent = col;
    ySelect.appendChild(option);
  });
  if (numericColumns.length > 0) {
    ySelect.value = numericColumns[numericColumns.length - 1];
  }
}

async function handleProcess() {
  try {
    setStatus('Reading files...');
    const tsvFiles = Array.from(tsvInput.files || []);
    const jsonFile = jsonInput.files && jsonInput.files[0];
    if (!tsvFiles.length) {
      setStatus('Please select at least one TSV file.', true);
      return;
    }
    if (!jsonFile) {
      setStatus('Please select a standard JSON file.', true);
      return;
    }
    const rtThr = Number(rtInput.value);
    if (!Number.isFinite(rtThr) || rtThr <= 0) {
      setStatus('rt_thr must be a positive number.', true);
      return;
    }

    const tsvTexts = await Promise.all(tsvFiles.map(readFileAsText));
    const filesData = tsvTexts.map((text, idx) => parseTsv(tsvFiles[idx].name, text));
    const signature = columnsSignature(filesData[0].columns);
    for (const fileData of filesData) {
      if (columnsSignature(fileData.columns) !== signature) {
        throw new Error('All TSV files must share identical column headers.');
      }
    }
    const stdText = await readFileAsText(jsonFile);
    const stdDict = JSON.parse(stdText);
    if (!stdDict || typeof stdDict !== 'object' || Array.isArray(stdDict)) {
      throw new Error('Standard JSON must be a dictionary of name -> retention time.');
    }

    state.filesData = filesData;
    state.stdDict = stdDict;
    state.stddf = computeStdDf(filesData, stdDict, rtThr);

    renderStats(state.stddf);
    renderTable(state.stddf);
    updateYAxisOptions(state.stddf);
    renderChart(state.stddf, ySelect.value);

    resultsEl.hidden = false;
    downloadCsvBtn.disabled = false;
    downloadTsvBtn.disabled = false;
    setStatus('stddf generated.');
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'Processing failed.', true);
  }
}

processBtn.addEventListener('click', handleProcess);

ySelect.addEventListener('change', () => {
  if (state.stddf) {
    renderChart(state.stddf, ySelect.value);
  }
});

downloadCsvBtn.addEventListener('click', () => {
  if (!state.stddf) {
    return;
  }
  const csv = buildDelimited(state.stddf, ',');
  downloadFile(csv, 'stddf.csv', 'text/csv;charset=utf-8');
});

downloadTsvBtn.addEventListener('click', () => {
  if (!state.stddf) {
    return;
  }
  const tsv = buildDelimited(state.stddf, '\t');
  downloadFile(tsv, 'stddf.tsv', 'text/tab-separated-values;charset=utf-8');
});
