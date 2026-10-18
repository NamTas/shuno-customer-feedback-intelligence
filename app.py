"""Shuno review analytics web app. Run with: python app.py"""
import os
from pathlib import Path
from flask import Flask, jsonify, render_template, request
from services import ReviewRepository, ReviewService

BASE_DIR = Path(__file__).resolve().parent


def create_app(db_path=None, seed_demo=True):
    path = Path(db_path or os.environ.get("SHUNO_DB", str(BASE_DIR / "shuno.db")))
    path.parent.mkdir(parents=True, exist_ok=True)
    first_run = not path.exists()

    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024  # 25 MB upload limit
    service = ReviewService(ReviewRepository(str(path)))

    # A brand-new database is filled with a small demo dataset so the dashboard is not empty.
    # It is never re-seeded while the database file exists.
    sample_path = BASE_DIR / "sample_reviews.csv"
    if first_run and seed_demo and sample_path.exists():
        with sample_path.open("rb") as sample_file:
            service.import_csv(sample_file)

    def filters():
        return {"year": request.args.get("year") or None, "product": request.args.get("product") or None}

    @app.errorhandler(ValueError)
    def handle_bad_input(error):
        return jsonify(error=str(error)), 400

    @app.errorhandler(413)
    def handle_large_upload(_error):
        return jsonify(error="The CSV is too large (25 MB maximum). Make a smaller sample with make_sample.py."), 413

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/api/summary")
    def summary():
        return jsonify(service.summary(**filters()))

    @app.get("/api/trend")
    def trend():
        months = request.args.get("months", 6, type=int)
        if months < 0:
            months = 6
        return jsonify(service.trend(months, **filters()))

    @app.get("/api/analytics")
    def analytics():
        return jsonify(service.analytics(**filters()))

    @app.get("/api/filters")
    def filter_options():
        return jsonify(service.repo.filter_options())

    @app.get("/api/reviews")
    def list_reviews():
        args = request.args
        return jsonify(service.repo.list(args.get("sentiment"), args.get("q"), 200, **filters()))

    @app.post("/api/reviews")
    def add_review():
        service.add((request.get_json(silent=True) or {}).get("text"))
        return jsonify(ok=True), 201

    @app.post("/api/import")
    def import_reviews():
        file = request.files.get("file")
        if not file or not file.filename:
            raise ValueError("Choose a CSV file to import.")
        return jsonify(imported=service.import_csv(file.stream))

    @app.delete("/api/reviews")
    def clear_reviews():
        service.repo.clear()
        return jsonify(ok=True)

    return app


if __name__ == "__main__":
    create_app().run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")), debug=True)
