"""Shuno core logic: sentiment analysis, keyword extraction, storage and CSV import."""
import csv
import io
import re
import sqlite3
from collections import Counter, defaultdict
from contextlib import closing
from datetime import datetime, timezone

SENTIMENTS = ("positive", "neutral", "negative")
COLUMN_HINTS = {
    "text": ("text", "comment", "feedback", "content", "review"),
    "rating": ("rating", "star", "score"),
    "date": ("date", "time", "timestamp"),
    "product": ("product", "category", "department", "class", "item", "variation", "variant"),
    "author": ("author", "reviewer", "profile", "user"),
}
STOPWORDS = set("""
a an the and or but if so because as at by for from in into of on onto out over under to up
is am are was were be been being do does did have has had having it its it's this that these those
i me my we our you your he she they them their his her who what which when where why how
with without not no nor very really just about would could should there here all any each both
few more most other some such only too than then also also been being still yet can will may might
must one two first get got make made much many much thing things something anything everything
product products item items order orders purchased bought use used using work worked works
customer customers review reviews say said says thing today yesterday new old
""".split())


class SentimentAnalyzer:
    """Label review text with VADER's compound score (-1 to +1)."""

    def __init__(self):
        from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
        self._vader = SentimentIntensityAnalyzer()

    def analyze(self, text):
        score = self._vader.polarity_scores(text)["compound"]
        if score >= 0.05:
            return "positive", score
        if score <= -0.05:
            return "negative", score
        return "neutral", score


class KeywordExtractor:
    """Find frequent meaningful words, omitting common English stopwords."""

    def top(self, texts, limit=8):
        words = (word for text in texts for word in re.findall(r"[a-z][a-z'-]{2,}", text.lower()))
        counts = Counter(word.strip("'-") for word in words)
        filtered = Counter({word: count for word, count in counts.items()
                            if word not in STOPWORDS and len(word) >= 3})
        return filtered.most_common(limit)


class ReviewRepository:
    """Persists review records using SQLite. Reads can be filtered by year and product."""

    def __init__(self, path="shuno.db"):
        self.path = path
        self._run("""CREATE TABLE IF NOT EXISTS reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT NOT NULL,
            sentiment TEXT NOT NULL,
            score REAL NOT NULL,
            rating REAL,
            reviewed_at TEXT,
            author TEXT,
            product TEXT
        )""")
        columns = [row["name"] for row in self._run("PRAGMA table_info(reviews)")]
        if "product" not in columns:  # database created by an older version of Shuno
            self._run("ALTER TABLE reviews ADD COLUMN product TEXT")

    def _run(self, sql, params=()):
        with closing(sqlite3.connect(self.path)) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(sql, params)
            rows = cursor.fetchall() if cursor.description else []
            conn.commit()
            return [dict(row) for row in rows]

    @staticmethod
    def _where(sentiment=None, query=None, year=None, product=None, extra=()):
        """Build the WHERE part of a query from the active filters."""
        clauses, params = [], []
        if sentiment in SENTIMENTS:
            clauses.append("sentiment = ?")
            params.append(sentiment)
        if query:
            clauses.append("text LIKE ? COLLATE NOCASE")
            params.append(f"%{query}%")
        if year:
            clauses.append("substr(reviewed_at, 1, 4) = ?")
            params.append(str(year))
        if product:
            clauses.append("product = ?")
            params.append(product)
        clauses.extend(extra)
        return (" WHERE " + " AND ".join(clauses)) if clauses else "", params

    def add_many(self, rows):
        if not rows:
            return
        with closing(sqlite3.connect(self.path)) as conn:
            conn.executemany(
                "INSERT INTO reviews (text, sentiment, score, rating, reviewed_at, author, product) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)", rows)
            conn.commit()

    def list(self, sentiment=None, query=None, limit=100, year=None, product=None):
        where, params = self._where(sentiment, query, year, product)
        sql = "SELECT * FROM reviews" + where + " ORDER BY COALESCE(reviewed_at, '') DESC, id DESC"
        if limit:
            sql += " LIMIT ?"
            params.append(limit)
        return self._run(sql, params)

    def monthly(self, year=None, product=None):
        """Return month-by-month review counts, grouped by sentiment."""
        where, params = self._where(year=year, product=product,
                                    extra=("reviewed_at IS NOT NULL", "length(reviewed_at) >= 7"))
        return self._run("""SELECT substr(reviewed_at, 1, 7) AS month,
            COUNT(*) AS n,
            SUM(CASE WHEN sentiment = 'positive' THEN 1 ELSE 0 END) AS positive_count,
            SUM(CASE WHEN sentiment = 'neutral' THEN 1 ELSE 0 END) AS neutral_count,
            SUM(CASE WHEN sentiment = 'negative' THEN 1 ELSE 0 END) AS negative_count
            FROM reviews""" + where + " GROUP BY month ORDER BY month", params)

    def stats(self, year=None, product=None):
        where, params = self._where(year=year, product=product)
        return self._run("SELECT COUNT(*) AS total, COUNT(rating) AS rated, AVG(rating) AS avg_rating, "
                         "AVG(score) AS avg_score FROM reviews" + where, params)[0]

    def by_product(self, year=None, product=None):
        where, params = self._where(year=year, product=product, extra=("product IS NOT NULL",))
        return self._run("SELECT product, sentiment, COUNT(*) AS n FROM reviews" + where
                         + " GROUP BY product, sentiment", params)

    def rating_by_sentiment(self, year=None, product=None):
        where, params = self._where(year=year, product=product, extra=("rating IS NOT NULL",))
        return self._run("SELECT sentiment, AVG(rating) AS avg_rating FROM reviews" + where
                         + " GROUP BY sentiment", params)

    def filter_options(self):
        years = self._run("SELECT DISTINCT substr(reviewed_at, 1, 4) AS y FROM reviews "
                          "WHERE reviewed_at IS NOT NULL ORDER BY y DESC")
        products = self._run("SELECT product, COUNT(*) AS n FROM reviews WHERE product IS NOT NULL "
                             "GROUP BY product ORDER BY n DESC LIMIT 30")
        return {"years": [row["y"] for row in years], "products": [row["product"] for row in products]}

    def clear(self):
        self._run("DELETE FROM reviews")


def find_column(columns, role, taken=()):
    """Return the first CSV column matching a known field-name hint."""
    taken_lower = {item.lower() for item in taken if item}
    for hint in COLUMN_HINTS[role]:
        for column in columns:
            if column.lower() not in taken_lower and hint in column.lower():
                return column
    return None


def parse_date(value):
    """Convert a supported date string or Unix timestamp to YYYY-MM-DD."""
    value = (value or "").strip()
    if not value:
        return None
    if value.isdigit():
        try:
            return datetime.fromtimestamp(int(value), tz=timezone.utc).strftime("%Y-%m-%d")
        except (OverflowError, OSError, ValueError):
            return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%Y-%m-%d %H:%M:%S",
                "%Y-%m-%dT%H:%M:%S", "%b %d, %Y", "%d-%b-%y", "%d-%b-%Y", "%d %b %Y", "%B %d, %Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(value, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def pick_text_column(columns, records):
    """Among columns that look like review text, pick the one with the longest text.

    This avoids choosing a short flag column (for example `feedback` = 0/1) over the real review text.
    """
    candidates = [c for c in columns if any(hint in c.lower() for hint in COLUMN_HINTS["text"])]
    if not candidates:
        return None
    return max(candidates, key=lambda c: sum(len(record.get(c) or "") for record in records[:200]))


def parse_rating(value):
    try:
        rating = float(value)
    except (TypeError, ValueError):
        return None
    return rating if 0 <= rating <= 5 else None


class ReviewService:
    """Coordinate sentiment analysis, keywords, review operations, trends and analytics."""

    def __init__(self, repo, analyzer=None, extractor=None):
        self.repo = repo
        self.analyzer = analyzer or SentimentAnalyzer()
        self.extractor = extractor or KeywordExtractor()

    def _row(self, text, rating=None, date=None, author=None, product=None):
        label, score = self.analyzer.analyze(text)
        return text, label, score, rating, date, (author or "Customer"), (product or None)

    def add(self, text):
        text = (text or "").strip()
        if not text:
            raise ValueError("Write a review before adding it.")
        today = datetime.now().strftime("%Y-%m-%d")
        self.repo.add_many([self._row(text, date=today, author="You")])

    def import_csv(self, stream):
        try:
            raw = stream.read()
            text = raw if isinstance(raw, str) else raw.decode("utf-8-sig")
        except UnicodeDecodeError as error:
            raise ValueError("Could not read this CSV. Save it as UTF-8 and try again.") from error
        first_line = text.split("\n", 1)[0]
        delimiter = "\t" if first_line.count("\t") > first_line.count(",") else ","  # supports CSV and TSV
        reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
        if not reader.fieldnames:
            raise ValueError("The CSV file is empty or has no header row.")
        cols = [column.strip() for column in reader.fieldnames]
        reader.fieldnames = cols
        records = list(reader)
        text_col = pick_text_column(cols, records)
        if not text_col:
            raise ValueError("No review column found. Rename the column to 'review', 'text', or 'feedback'.")
        rating_col = find_column(cols, "rating", (text_col,))
        date_col = find_column(cols, "date", (text_col, rating_col))
        product_col = find_column(cols, "product", (text_col, rating_col, date_col))
        author_col = find_column(cols, "author", (text_col, rating_col, date_col, product_col))
        rows = []
        for row in records:
            review_text = (row.get(text_col) or "").strip()
            if not review_text:
                continue
            rows.append(self._row(
                review_text,
                parse_rating(row.get(rating_col)) if rating_col else None,
                parse_date(row.get(date_col)) if date_col else None,
                (row.get(author_col) or "").strip() if author_col else None,
                (row.get(product_col) or "").strip() if product_col else None,
            ))
        if not rows:
            raise ValueError(f'No reviews found in the "{text_col}" column.')
        self.repo.add_many(rows)
        return len(rows)

    def trend(self, months=12, year=None, product=None):
        points = []
        for row in self.repo.monthly(year, product):
            total = row["n"] or 0
            points.append({
                "month": row["month"],
                "count": total,
                "positive": round((row["positive_count"] or 0) * 100 / total) if total else 0,
                "neutral": round((row["neutral_count"] or 0) * 100 / total) if total else 0,
                "negative": round((row["negative_count"] or 0) * 100 / total) if total else 0,
            })
        return points[-months:] if months and months > 0 else points

    def summary(self, year=None, product=None):
        reviews = self.repo.list(limit=None, year=year, product=product)
        counts = Counter(review["sentiment"] for review in reviews)

        def texts(label=None):
            return [review["text"] for review in reviews
                    if label is None or review["sentiment"] == label]

        return {
            "total": len(reviews),
            "counts": {label: counts.get(label, 0) for label in SENTIMENTS},
            "complaints": self.extractor.top(texts("negative"), 6),
            "praise": self.extractor.top(texts("positive"), 6),
            "cloud": {
                "all": self.extractor.top(texts(), 45),
                "positive": self.extractor.top(texts("positive"), 45),
                "negative": self.extractor.top(texts("negative"), 45),
            },
            "volume": [point["count"] for point in self.trend(12, year, product)],
        }

    def analytics(self, year=None, product=None):
        """Everything the Analytics page needs: key numbers, products, ratings, volume and words."""
        stats = self.repo.stats(year, product)
        by_product = defaultdict(Counter)
        for row in self.repo.by_product(year, product):
            by_product[row["product"]][row["sentiment"]] = row["n"]
        ranked = sorted(by_product.items(), key=lambda item: -sum(item[1].values()))[:8]
        words = lambda label: self.repo.list(label, None, None, year, product)
        total = stats["total"]
        return {
            "stats": {
                "total": total,
                "avg_rating": round(stats["avg_rating"], 2) if stats["avg_rating"] is not None else None,
                "avg_score": round(stats["avg_score"], 2) if stats["avg_score"] is not None else None,
                "rated_share": round(stats["rated"] / total * 100) if total else 0,
            },
            "products": [{"product": name, **{label: counts[label] for label in SENTIMENTS}}
                         for name, counts in ranked],
            "rating_by_sentiment": {row["sentiment"]: round(row["avg_rating"], 2)
                                    for row in self.repo.rating_by_sentiment(year, product)},
            "volume": [{"month": p["month"], "count": p["count"]} for p in self.trend(24, year, product)],
            "words": {label: self.extractor.top([r["text"] for r in words(label)], 8)
                      for label in ("positive", "negative")},
        }
