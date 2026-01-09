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

function computeChartSize(standards, yLabel) {
  const maxLabelLength = standards.reduce((maxLen, label) => {
    return Math.max(maxLen, String(label).length);
  }, 0);
  const labelRows = Math.max(1, Math.ceil(maxLabelLength / 12));
  const extraBottom = Math.min(120, (labelRows - 1) * 20);
  const extraForYAxis = Math.min(80, Math.max(0, String(yLabel).length - 8) * 3);
  const height = Math.min(720, 320 + extraBottom + extraForYAxis);
  const bottomMargin = 70 + extraBottom;
  return { height, bottomMargin };
}

function parseSampleMeta(fileName) {
  const base = String(fileName).replace(/\.[^.]+$/, '');
  const parts = base.split('-');
  if (parts.length < 2) {
    return { sampleId: base, replicate: null };
  }
  const replicateRaw = parts[parts.length - 1];
  const replicate = Number(replicateRaw);
  const sampleId = parts.slice(0, -1).join('-');
  return { sampleId, replicate: Number.isFinite(replicate) ? replicate : null };
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

function decodeWithEncoding(buffer, encoding, fatal = false) {
  try {
    const decoder = new TextDecoder(encoding, fatal ? { fatal: true } : undefined);
    return decoder.decode(buffer);
  } catch (error) {
    return null;
  }
}

function decodeArrayBuffer(buffer) {
  const utf8 = decodeWithEncoding(buffer, 'utf-8', true);
  if (utf8 !== null) {
    return { text: utf8, encoding: 'utf-8' };
  }
  const gbk = decodeWithEncoding(buffer, 'gbk', true);
  if (gbk !== null) {
    return { text: gbk, encoding: 'gbk' };
  }
  const fallback = decodeWithEncoding(buffer, 'utf-8');
  return { text: fallback ?? new TextDecoder().decode(buffer), encoding: 'utf-8' };
}

async function readFileAsText(file) {
  const buffer = await readFileAsArrayBuffer(file);
  const decoded = decodeArrayBuffer(buffer);
  if (decoded.encoding !== 'utf-8') {
    console.info(`Decoded ${file.name} as ${decoded.encoding}.`);
  }
  return decoded.text;
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

function countDelimiter(line, delimiter) {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (char === delimiter && !inQuotes) {
      count += 1;
    }
  }
  return count;
}

function detectDelimiter(line) {
  const candidates = ['\t', ',', ';', '|'];
  let best = candidates[0];
  let bestCount = -1;
  for (const delimiter of candidates) {
    const count = countDelimiter(line, delimiter);
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  if (bestCount <= 0) {
    throw new Error('Unable to detect delimiter (tab, comma, semicolon, or pipe).');
  }
  return best;
}

function splitLine(line, delimiter) {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (char === delimiter && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

function parseTsv(name, text) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n').filter((line) => line.trim() !== '');
  if (lines.length < 2) {
    throw new Error(`Input file "${name}" has no data rows.`);
  }
  const delimiter = detectDelimiter(lines[0]);
  const header = splitLine(lines[0], delimiter).map((cell, index) => {
    const cleaned = cleanCell(cell);
    if (index === 0 && typeof cleaned === 'string') {
      return cleaned.replace(/^\uFEFF/, '');
    }
    return cleaned;
  });
  const rows = lines.slice(1).map((line) => {
    const cells = splitLine(line, delimiter);
    return header.map((_, idx) => cleanCell(cells[idx] ?? ''));
  });
  if (header.length < 3) {
    throw new Error(`Input file "${name}" needs at least 3 columns.`);
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
  const columns = ['Standard', 'Sample', 'Replicate', 'File', ...baseColumns];
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
      const { sampleId, replicate } = parseSampleMeta(fileData.name);
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
      rows.push([stdName, sampleId, replicate, fileData.name, ...bestRow]);
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
    if (col === 'Standard' || col === 'Sample' || col === 'Replicate' || col === 'File') {
      return;
    }
    const label = String(col);
    if (label.includes('%') || label.includes('％')) {
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

function summarizeValues(values) {
  if (!values.length) {
    return { mean: null, std: 0, n: 0 };
  }
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  if (values.length === 1) {
    return { mean, std: 0, n: 1 };
  }
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return { mean, std: Math.sqrt(variance), n: values.length };
}

function renderChart(stddf, yColumn) {
  const standardIdx = stddf.columns.indexOf('Standard');
  const sampleIdx = stddf.columns.indexOf('Sample');
  const yIdx = stddf.columns.indexOf(yColumn);
  if (yIdx === -1) {
    return;
  }

  const standards = [];
  const samples = [];
  const groupMap = new Map();
  stddf.rows.forEach((row) => {
    const standard = row[standardIdx];
    const sample = row[sampleIdx];
    if (!standards.includes(standard)) {
      standards.push(standard);
    }
    if (!samples.includes(sample)) {
      samples.push(sample);
    }
    const value = getNumeric(row[yIdx]);
    if (!Number.isFinite(value)) {
      return;
    }
    const key = `${standard}||${sample}`;
    if (!groupMap.has(key)) {
      groupMap.set(key, []);
    }
    groupMap.get(key).push(value);
  });
  if (typeof Plotly === 'undefined') {
    chartCanvas.textContent = 'Plotly failed to load. Check the script tag.';
    return;
  }

  const { height, bottomMargin } = computeChartSize(standards, yColumn);
  chartCanvas.style.height = `${height}px`;
  const traces = samples.map((sample, idx) => {
    const yValues = [];
    const errorValues = [];
    const customData = [];
    standards.forEach((standard) => {
      const values = groupMap.get(`${standard}||${sample}`) || [];
      const summary = summarizeValues(values);
      yValues.push(summary.mean);
      errorValues.push(summary.std);
      customData.push([summary.std, summary.n]);
    });
    return {
      type: 'bar',
      name: sample,
      x: standards,
      y: yValues,
      error_y: { type: 'data', array: errorValues, visible: true },
      marker: { color: palette[idx % palette.length] },
      customdata: customData,
      hovertemplate:
        `Sample: ${sample}<br>` +
        'Standard: %{x}<br>' +
        `${yColumn} mean: %{y:.2f}<br>` +
        'SD: %{customdata[0]:.2f}<br>' +
        'n: %{customdata[1]}<extra></extra>'
    };
  });

  const layout = {
    barmode: 'group',
    showlegend: false,
    margin: { t: 24, r: 16, b: bottomMargin, l: 56 },
    height,
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    xaxis: { title: 'Standard', automargin: true, tickangle: -20 },
    yaxis: { title: yColumn, rangemode: 'tozero' }
  };

  const config = { displayModeBar: false, responsive: true };
  Promise.resolve(Plotly.react(chartCanvas, traces, layout, config)).then(() => {
    Plotly.Plots.resize(chartCanvas);
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
