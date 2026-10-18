# Shuno — Customer Feedback Intelligence

Shuno is a small, beginner-friendly full-stack project that turns customer reviews into a sentiment dashboard. It is designed to demonstrate Python, Flask, OOP, SQL, HTML/CSS, JavaScript, Bootstrap, data validation, CSV handling and automated tests.

## Features

- Sentiment analysis for positive, neutral and negative reviews using VADER.
- Metric cards and a monthly sentiment trend chart.
- Sentiment distribution doughnut chart.
- Frequency-based word cloud with All / Positive / Negative filters.
- Click a cloud word to filter the reviews that contain it.
- Top words from negative reviews to help surface customer concerns.
- Review feed with search, sentiment filters, ratings and a details view.
- Add a review from the dashboard and analyze it automatically.
- Import CSV files and detect common column names such as `review`, `text`, `feedback`, `rating`, `date`, `time`, and `author`.
- **All dates** and **All products** filters that change every number and chart.
- **Analytics page**: average rating and sentiment score, sentiment by product, rating vs sentiment, review volume per month, and top words per sentiment.
- SQLite persistence (older databases are upgraded automatically), basic input validation, and pytest unit tests.

## Requirements

- Python 3.10 or newer
- Chart.js and Bootstrap are bundled in `static/vendor`, so the dashboard works offline. Only the Google Fonts need internet (system fonts are used if offline).

## Run on Windows

Open PowerShell in this project folder (the folder containing `app.py`) and run:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python app.py
```

Then open http://127.0.0.1:5000 in your browser.

If PowerShell blocks virtual environment activation, you can use the venv interpreter directly:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
```

If the `py` command is also unavailable, install Python from https://www.python.org/downloads/ and enable **Add Python to PATH** in the installer.

## Try the dashboard

A fresh database is automatically filled with the small `sample_reviews.csv` demo dataset on first launch. Use **Import CSV** to add your own review data. When importing other files, include a review text column named `review`, `text`, `comment`, `feedback`, or `content`. A date column enables the trend chart.

Example CSV columns:

```csv
date,author,rating,review
2026-06-10,Alex,5,Excellent quality and quick delivery
2026-06-12,Sam,1,The delivery was late and the package was damaged
```

The built-in demo data is intentionally small and illustrative. It is not real customer data, and sentiment analysis is an estimate rather than a guarantee of a review's true meaning.

## Run tests

```powershell
python -m pip install -r requirements.txt
python -m pytest
```

## Project structure

```text
shuno/
├── app.py                 # Flask routes and app startup
├── services.py            # Sentiment analysis, keyword extraction, SQLite, CSV import
├── sample_reviews.csv     # Safe demonstration data
├── requirements.txt
├── templates/
│   └── index.html          # Dashboard layout and dialogs
├── static/
│   ├── app.js              # Charts, filters, API calls, and interactions
│   └── style.css           # Responsive dashboard styling
└── tests/
    └── test_services.py
```

## Tech stack

- **Backend:** Python, Flask
- **Database:** SQLite / SQL
- **Frontend:** HTML, CSS, vanilla JavaScript, Bootstrap 5
- **Visualization:** Chart.js and a frequency-based CSS word cloud
- **Sentiment:** VADER Sentiment
- **Testing:** pytest

## Use real Kaggle data

1. Download a review dataset from Kaggle (for example "Amazon Fine Food Reviews") and unzip it to get `Reviews.csv`.
2. Make a smaller random sample: `python make_sample.py Reviews.csv reviews_5000.csv 5000`
3. Click **Import CSV** and choose `reviews_5000.csv`.

CSV and tab-separated (TSV) files both work. Columns are found by name: review text (`text`, `review`, `comment`, `feedback`), `rating`/`score`, `date`/`time` (dates or Unix timestamps), `product`/`category` and `author`/`profile`. Only the text column is required. Note the dataset name and link in this README and respect its license.

## Credits

Chart.js and Bootstrap are MIT-licensed and bundled in `static/vendor`. Sentiment uses VADER.
