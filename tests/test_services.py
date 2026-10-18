import io
import pytest
from services import KeywordExtractor, ReviewRepository, ReviewService, SentimentAnalyzer


@pytest.fixture
def service(tmp_path):
    return ReviewService(ReviewRepository(str(tmp_path / "test.db")))


def test_sentiment_labels():
    analyzer = SentimentAnalyzer()
    assert analyzer.analyze("I love this, it is excellent!")[0] == "positive"
    assert analyzer.analyze("Terrible quality, I hate it.")[0] == "negative"


def test_keywords_ignore_stopwords():
    words = dict(KeywordExtractor().top(["slow delivery", "very slow service"]))
    assert words["slow"] == 2 and "very" not in words


def test_add_rejects_empty_review(service):
    with pytest.raises(ValueError):
        service.add("   ")


def test_import_detects_amazon_style_columns(service):
    data = b"Id,ProfileName,Score,Time,Text\n1,Sam,5,1303862400,Great value\n2,Ana,1,1306000000,Awful and slow\n"
    assert service.import_csv(io.BytesIO(data)) == 2
    review = service.repo.list()[-1]
    assert (review["author"], review["rating"], review["reviewed_at"]) == ("Sam", 5.0, "2011-04-27")
    assert [p["month"] for p in service.trend(0)] == ["2011-04", "2011-05"]


def test_import_without_review_column(service):
    with pytest.raises(ValueError):
        service.import_csv(io.BytesIO(b"id,price\n1,20\n"))


def test_summary_has_dashboard_data(service):
    service.add("Fast delivery, love it")
    summary = service.summary()
    assert summary["total"] == 1 and summary["counts"]["positive"] == 1 and "all" in summary["cloud"]


AMAZON_CSV = (b"Id,ProductId,ProfileName,Score,Time,Text\n"
              b"1,B001,Sam,5,1303862400,Great value\n2,B002,Ana,1,1306000000,Awful and slow\n")


def test_import_detects_product_column(service):
    service.import_csv(io.BytesIO(AMAZON_CSV))
    review = service.repo.list()[-1]
    assert (review["product"], review["author"]) == ("B001", "Sam")


def test_filters_by_product_and_year(service):
    service.import_csv(io.BytesIO(AMAZON_CSV))
    assert service.summary(product="B002")["counts"]["negative"] == 1
    assert service.summary(year="2011")["total"] == 2 and service.summary(year="2020")["total"] == 0
    options = service.repo.filter_options()
    assert options["years"] == ["2011"] and sorted(options["products"]) == ["B001", "B002"]


def test_analytics_has_all_five_parts(service):
    service.import_csv(io.BytesIO(AMAZON_CSV))
    data = service.analytics()
    assert data["stats"]["avg_rating"] == 3.0 and data["stats"]["rated_share"] == 100
    assert {p["product"] for p in data["products"]} == {"B001", "B002"}
    assert set(data["rating_by_sentiment"]) == {"positive", "negative"}
    assert [v["month"] for v in data["volume"]] == ["2011-04", "2011-05"]
    assert data["words"]["positive"] and data["words"]["negative"]


def test_old_database_is_upgraded(tmp_path):
    import sqlite3
    path = str(tmp_path / "old.db")
    with sqlite3.connect(path) as conn:
        conn.execute("CREATE TABLE reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, "
                     "sentiment TEXT NOT NULL, score REAL NOT NULL, rating REAL, reviewed_at TEXT, author TEXT)")
    ReviewService(ReviewRepository(path)).add("Works well")
    assert ReviewRepository(path).list()[0]["product"] is None


def test_web_flow(tmp_path):
    from app import create_app
    client = create_app(str(tmp_path / "web.db"), seed_demo=False).test_client()
    assert client.get("/api/analytics").get_json()["stats"]["avg_rating"] is None
    sample = open("sample_reviews.csv", "rb").read()
    result = client.post("/api/import", data={"file": (io.BytesIO(sample), "s.csv")}, content_type="multipart/form-data")
    assert result.get_json()["imported"] == 12
    assert client.get("/api/summary?product=Charger").get_json()["total"] == 4
    assert client.get("/api/filters").get_json()["products"]
    assert client.get("/").status_code == 200 and client.post("/api/import").status_code == 400


def test_import_clothing_style_columns(service):
    data = (b"Unnamed: 0,Clothing ID,Age,Title,Review Text,Rating,Recommended IND,Positive Feedback Count,"
            b"Division Name,Department Name,Class Name\n"
            b"0,767,33,,Absolutely wonderful and comfortable,4,1,0,Initmates,Intimate,Intimates\n"
            b"1,1080,34,,Runs small and the fabric feels cheap,2,0,4,General,Dresses,Dresses\n")
    assert service.import_csv(io.BytesIO(data)) == 2
    review = service.repo.list()[-1]
    assert (review["product"], review["rating"], review["author"], review["reviewed_at"]) == ("Intimate", 4.0, "Customer", None)


def test_import_tab_separated_file_with_feedback_flag(service):
    data = ("rating\tdate\tvariation\tverified_reviews\tfeedback\n"
            "5\t31-Jul-18\tCharcoal Fabric\tLove my Echo, it plays music well\t1\n"
            "1\t30-Jul-18\tWhite Dot\tStopped working after two weeks\t0\n").encode()
    assert service.import_csv(io.BytesIO(data)) == 2
    review = service.repo.list()[0]
    assert review["text"].startswith("Love my Echo") and review["product"] == "Charcoal Fabric"
    assert (review["reviewed_at"], review["rating"]) == ("2018-07-31", 5.0)
