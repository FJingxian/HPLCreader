# HPLCreader

HPLC standard matching utility based on the logic in `src/HPLCreader/hplc.py`, with a static browser UI for generating and visualizing stddf.

## Features

- Parse multiple HPLC TSV exports
- Match standards by retention time with adaptive threshold expansion
- Select the max-signal row per standard per file
- Export stddf as CSV/TSV and visualize in the browser

## Project Layout

- `src/HPLCreader/hplc.py`: core matching logic (script)
- `web/`: static frontend UI
- `example/`: sample TSV and standard JSON

## Python Usage

Install dependencies:

```bash
python -m pip install -e .
```

Edit input paths in `src/HPLCreader/hplc.py`:

```python
files = ["example/standard.tsv", "example/standard.tsv"]
with open("example/standard.280.json", "r") as f:
    stddict = json.loads(f.read())
```

Run the script:

```bash
python src/HPLCreader/hplc.py
```

## Web UI

Serve the static UI:

```bash
python -m http.server -d web
```

Open `http://localhost:8000`, upload multiple TSV files and a standard JSON file, then click **Generate stddf** to download and visualize.

## File Format Expectations

- TSV files must include a header row.
- The retention time is read from the third column (index 2).
- The signal/area is read from the last column.
- Standard JSON must be a dictionary: `{"standard_name": retention_time}`.
- All TSV files must share identical column headers.
