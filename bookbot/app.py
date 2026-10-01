import os
import re
import secrets
import sqlite3
from datetime import datetime, timedelta

from flask import (Flask, abort, flash, g, jsonify, redirect, render_template,
                   request, session, url_for)
from werkzeug.security import check_password_hash, generate_password_hash

TRIAL_DAYS = 14
PRICE_ZAR = int(os.environ.get("PRICE_ZAR", "299"))
DATE_FMT = "%Y-%m-%d %H:%M"

SCHEMA = """
CREATE TABLE IF NOT EXISTS businesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    whatsapp TEXT NOT NULL,
    open_hour INTEGER NOT NULL DEFAULT 8,
    close_hour INTEGER NOT NULL DEFAULT 17,
    status TEXT NOT NULL DEFAULT 'trial',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    name TEXT NOT NULL,
    duration_min INTEGER NOT NULL,
    price_zar INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    service_id INTEGER NOT NULL REFERENCES services(id),
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    start TEXT NOT NULL,
    end TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'confirmed',
    reminded INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bookings_biz_start ON bookings(business_id, start);
CREATE TABLE IF NOT EXISTS approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_zar INTEGER NOT NULL DEFAULT 0,
    payload TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    decided_at TEXT
);
"""


def normalize_phone(raw):
    """Convert South African numbers to international digits (27XXXXXXXXX)."""
    digits = re.sub(r"\D", "", raw or "")
    if digits.startswith("0") and len(digits) == 10:
        digits = "27" + digits[1:]
    return digits if 10 <= len(digits) <= 15 else None


def slugify(text):
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "business"


def create_app(config=None):
    app = Flask(__name__)
    app.config.update(
        SECRET_KEY=os.environ.get("SECRET_KEY", "dev-only-change-me"),
        DATABASE=os.environ.get("DATABASE", os.path.join(os.path.dirname(__file__), "bookbot.db")),
        ADMIN_KEY=os.environ.get("ADMIN_KEY", ""),
        PAYMENT_LINK=os.environ.get("PAYMENT_LINK", ""),
        PRICE_ZAR=PRICE_ZAR,
    )
    if config:
        app.config.update(config)

    def db():
        if "db" not in g:
            g.db = sqlite3.connect(app.config["DATABASE"])
            g.db.row_factory = sqlite3.Row
            g.db.execute("PRAGMA foreign_keys = ON")
        return g.db

    @app.teardown_appcontext
    def close_db(_exc):
        conn = g.pop("db", None)
        if conn is not None:
            conn.close()

    with app.app_context():
        db().executescript(SCHEMA)

    def now():
        return datetime.now()

    def is_active(biz):
        if biz["status"] == "active":
            return True
        if biz["status"] == "trial":
            created = datetime.strptime(biz["created_at"], DATE_FMT)
            return now() < created + timedelta(days=TRIAL_DAYS)
        return False

    def trial_days_left(biz):
        created = datetime.strptime(biz["created_at"], DATE_FMT)
        return max(0, (created + timedelta(days=TRIAL_DAYS) - now()).days)

    def current_business():
        biz_id = session.get("biz_id")
        if not biz_id:
            return None
        return db().execute("SELECT * FROM businesses WHERE id = ?", (biz_id,)).fetchone()

    def csrf_token():
        if "csrf" not in session:
            session["csrf"] = secrets.token_hex(16)
        return session["csrf"]

    app.jinja_env.globals["csrf_token"] = csrf_token

    @app.before_request
    def check_csrf():
        if request.method == "POST" and not request.path.startswith("/admin/"):
            sent = request.form.get("csrf")
            if not sent or not session.get("csrf") or not secrets.compare_digest(sent, session["csrf"]):
                abort(400, "Invalid form token, please reload the page.")

    @app.route("/")
    def landing():
        return render_template("landing.html", price=app.config["PRICE_ZAR"], trial=TRIAL_DAYS)

    @app.route("/signup", methods=["GET", "POST"])
    def signup():
        if request.method == "POST":
            name = request.form.get("name", "").strip()
            email = request.form.get("email", "").strip().lower()
            password = request.form.get("password", "")
            phone = normalize_phone(request.form.get("whatsapp"))
            if not name or "@" not in email or len(password) < 8 or not phone:
                flash("Fill in all fields. Password must be at least 8 characters and the WhatsApp number valid.")
                return render_template("signup.html"), 400
            if db().execute("SELECT 1 FROM businesses WHERE email = ?", (email,)).fetchone():
                flash("That email is already registered. Log in instead.")
                return render_template("signup.html"), 400
            base = slugify(name)
            slug, n = base, 1
            while db().execute("SELECT 1 FROM businesses WHERE slug = ?", (slug,)).fetchone():
                n += 1
                slug = f"{base}-{n}"
            cur = db().execute(
                "INSERT INTO businesses (slug, name, email, password_hash, whatsapp, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (slug, name, email, generate_password_hash(password), phone, now().strftime(DATE_FMT)),
            )
            db().commit()
            session.clear()
            session["biz_id"] = cur.lastrowid
            return redirect(url_for("dashboard"))
        return render_template("signup.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            email = request.form.get("email", "").strip().lower()
            biz = db().execute("SELECT * FROM businesses WHERE email = ?", (email,)).fetchone()
            if biz and check_password_hash(biz["password_hash"], request.form.get("password", "")):
                session.clear()
                session["biz_id"] = biz["id"]
                return redirect(url_for("dashboard"))
            flash("Wrong email or password.")
            return render_template("login.html"), 401
        return render_template("login.html")

    @app.route("/logout", methods=["POST"])
    def logout():
        session.clear()
        return redirect(url_for("landing"))

    @app.route("/dashboard")
    def dashboard():
        biz = current_business()
        if not biz:
            return redirect(url_for("login"))
        services = db().execute(
            "SELECT * FROM services WHERE business_id = ? AND active = 1 ORDER BY id", (biz["id"],)
        ).fetchall()
        bookings = db().execute(
            "SELECT b.*, s.name AS service_name FROM bookings b JOIN services s ON s.id = b.service_id"
            " WHERE b.business_id = ? AND b.status = 'confirmed' AND b.start >= ? ORDER BY b.start",
            (biz["id"], now().strftime("%Y-%m-%d 00:00")),
        ).fetchall()
        return render_template(
            "dashboard.html", biz=biz, services=services, bookings=bookings,
            active=is_active(biz), days_left=trial_days_left(biz),
            booking_url=url_for("public_page", slug=biz["slug"], _external=True),
            price=app.config["PRICE_ZAR"], payment_link=app.config["PAYMENT_LINK"],
        )

    @app.route("/dashboard/services", methods=["POST"])
    def add_service():
        biz = current_business()
        if not biz:
            return redirect(url_for("login"))
        name = request.form.get("name", "").strip()
        try:
            duration = int(request.form.get("duration_min", ""))
            price = int(request.form.get("price_zar", "0") or 0)
        except ValueError:
            duration, price = 0, 0
        if not name or not 5 <= duration <= 480 or price < 0:
            flash("Enter a service name, a duration between 5 and 480 minutes, and a valid price.")
        else:
            db().execute(
                "INSERT INTO services (business_id, name, duration_min, price_zar) VALUES (?, ?, ?, ?)",
                (biz["id"], name, duration, price),
            )
            db().commit()
        return redirect(url_for("dashboard"))

    @app.route("/dashboard/services/<int:service_id>/delete", methods=["POST"])
    def delete_service(service_id):
        biz = current_business()
        if not biz:
            return redirect(url_for("login"))
        db().execute("UPDATE services SET active = 0 WHERE id = ? AND business_id = ?", (service_id, biz["id"]))
        db().commit()
        return redirect(url_for("dashboard"))

    @app.route("/dashboard/hours", methods=["POST"])
    def set_hours():
        biz = current_business()
        if not biz:
            return redirect(url_for("login"))
        try:
            open_h = int(request.form["open_hour"])
            close_h = int(request.form["close_hour"])
        except (KeyError, ValueError):
            open_h = close_h = -1
        if 0 <= open_h < close_h <= 24:
            db().execute("UPDATE businesses SET open_hour = ?, close_hour = ? WHERE id = ?",
                         (open_h, close_h, biz["id"]))
            db().commit()
        else:
            flash("Opening hour must be earlier than closing hour.")
        return redirect(url_for("dashboard"))

    @app.route("/dashboard/bookings/<int:booking_id>/cancel", methods=["POST"])
    def cancel_booking(booking_id):
        biz = current_business()
        if not biz:
            return redirect(url_for("login"))
        db().execute("UPDATE bookings SET status = 'cancelled' WHERE id = ? AND business_id = ?",
                     (booking_id, biz["id"]))
        db().commit()
        return redirect(url_for("dashboard"))

    def get_public_business(slug):
        biz = db().execute("SELECT * FROM businesses WHERE slug = ?", (slug,)).fetchone()
        if not biz:
            abort(404)
        return biz

    def free_slots(biz, service, day):
        """Start times on `day` (date) where the service fits and nothing overlaps."""
        step = timedelta(minutes=30)
        duration = timedelta(minutes=service["duration_min"])
        day_start = datetime.combine(day, datetime.min.time())
        opens = day_start + timedelta(hours=biz["open_hour"])
        closes = day_start + timedelta(hours=biz["close_hour"])
        taken = db().execute(
            "SELECT start, end FROM bookings WHERE business_id = ? AND status = 'confirmed'"
            " AND start < ? AND end > ?",
            (biz["id"], closes.strftime(DATE_FMT), opens.strftime(DATE_FMT)),
        ).fetchall()
        taken = [(datetime.strptime(t["start"], DATE_FMT), datetime.strptime(t["end"], DATE_FMT)) for t in taken]
        slots, cursor = [], opens
        while cursor + duration <= closes:
            end = cursor + duration
            if cursor > now() and not any(cursor < t_end and end > t_start for t_start, t_end in taken):
                slots.append(cursor.strftime("%H:%M"))
            cursor += step
        return slots

    @app.route("/b/<slug>")
    def public_page(slug):
        biz = get_public_business(slug)
        if not is_active(biz):
            return render_template("public_inactive.html", biz=biz), 403
        services = db().execute(
            "SELECT * FROM services WHERE business_id = ? AND active = 1 ORDER BY id", (biz["id"],)
        ).fetchall()
        return render_template("public.html", biz=biz, services=services,
                               today=now().strftime("%Y-%m-%d"))

    @app.route("/b/<slug>/slots")
    def slots(slug):
        biz = get_public_business(slug)
        if not is_active(biz):
            abort(403)
        service = db().execute(
            "SELECT * FROM services WHERE id = ? AND business_id = ? AND active = 1",
            (request.args.get("service_id", type=int), biz["id"]),
        ).fetchone()
        try:
            day = datetime.strptime(request.args.get("date", ""), "%Y-%m-%d").date()
        except ValueError:
            day = None
        if not service or not day:
            return jsonify(slots=[])
        return jsonify(slots=free_slots(biz, service, day))

    @app.route("/b/<slug>/book", methods=["POST"])
    def book(slug):
        biz = get_public_business(slug)
        if not is_active(biz):
            abort(403)
        service = db().execute(
            "SELECT * FROM services WHERE id = ? AND business_id = ? AND active = 1",
            (request.form.get("service_id", type=int), biz["id"]),
        ).fetchone()
        name = request.form.get("name", "").strip()
        phone = normalize_phone(request.form.get("phone"))
        try:
            start = datetime.strptime(f"{request.form.get('date')} {request.form.get('time')}", DATE_FMT)
        except ValueError:
            start = None
        if not service or not name or not phone or not start:
            flash("Please complete every field with a valid cell number.")
            return redirect(url_for("public_page", slug=slug))
        if start.strftime("%H:%M") not in free_slots(biz, service, start.date()):
            flash("Sorry, that time was just taken. Please pick another.")
            return redirect(url_for("public_page", slug=slug))
        end = start + timedelta(minutes=service["duration_min"])
        db().execute(
            "INSERT INTO bookings (business_id, service_id, customer_name, customer_phone, start, end, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (biz["id"], service["id"], name, phone, start.strftime(DATE_FMT), end.strftime(DATE_FMT),
             now().strftime(DATE_FMT)),
        )
        db().commit()
        return render_template("confirmed.html", biz=biz, service=service, start=start, name=name)

    @app.route("/admin/activate", methods=["POST"])
    def admin_activate():
        key = app.config["ADMIN_KEY"]
        if not key or not secrets.compare_digest(request.form.get("key", ""), key):
            abort(403)
        status = request.form.get("status", "active")
        if status not in ("active", "trial", "suspended"):
            abort(400)
        cur = db().execute("UPDATE businesses SET status = ? WHERE slug = ?", (status, request.form.get("slug", "")))
        db().commit()
        if not cur.rowcount:
            abort(404)
        return jsonify(ok=True)

    def admin_key_ok(value):
        key = app.config["ADMIN_KEY"]
        return bool(key) and bool(value) and secrets.compare_digest(value, key)

    @app.route("/admin/approvals", methods=["GET", "POST"])
    def approvals_api():
        """Used by the automation to request money-related approvals and read decisions."""
        if not admin_key_ok(request.values.get("key", "")):
            abort(403)
        if request.method == "POST":
            kind = request.form.get("kind", "").strip()
            description = request.form.get("description", "").strip()
            try:
                amount = int(request.form.get("amount_zar", "0"))
            except ValueError:
                abort(400)
            if not kind or not description or amount < 0:
                abort(400)
            cur = db().execute(
                "INSERT INTO approvals (kind, description, amount_zar, payload, created_at) VALUES (?, ?, ?, ?, ?)",
                (kind, description, amount, request.form.get("payload", ""), now().strftime(DATE_FMT)),
            )
            db().commit()
            return jsonify(id=cur.lastrowid, status="pending"), 201
        status = request.args.get("status", "approved")
        rows = db().execute("SELECT * FROM approvals WHERE status = ? ORDER BY id", (status,)).fetchall()
        return jsonify(approvals=[dict(r) for r in rows])

    @app.route("/admin/approvals/<int:approval_id>/done", methods=["POST"])
    def approval_done(approval_id):
        if not admin_key_ok(request.form.get("key", "")):
            abort(403)
        cur = db().execute(
            "UPDATE approvals SET status = 'executed' WHERE id = ? AND status = 'approved'", (approval_id,))
        db().commit()
        if not cur.rowcount:
            abort(409)
        return jsonify(ok=True)

    @app.route("/owner/login", methods=["GET", "POST"])
    def owner_login():
        if request.method == "POST":
            if admin_key_ok(request.form.get("key", "")):
                session["owner"] = True
                return redirect(url_for("owner_approvals"))
            flash("Wrong key.")
            return render_template("owner_login.html"), 401
        return render_template("owner_login.html")

    @app.route("/owner")
    def owner_approvals():
        if not session.get("owner"):
            return redirect(url_for("owner_login"))
        pending = db().execute("SELECT * FROM approvals WHERE status = 'pending' ORDER BY id").fetchall()
        recent = db().execute(
            "SELECT * FROM approvals WHERE status != 'pending' ORDER BY id DESC LIMIT 20").fetchall()
        return render_template("owner.html", pending=pending, recent=recent)

    @app.route("/owner/approvals/<int:approval_id>/<decision>", methods=["POST"])
    def owner_decide(approval_id, decision):
        if not session.get("owner"):
            abort(403)
        if decision not in ("approve", "reject"):
            abort(404)
        new_status = "approved" if decision == "approve" else "rejected"
        cur = db().execute(
            "UPDATE approvals SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'",
            (new_status, now().strftime(DATE_FMT), approval_id),
        )
        db().commit()
        if not cur.rowcount:
            flash("That request was already decided.")
        return redirect(url_for("owner_approvals"))

    return app


app = create_app() if os.environ.get("BOOKBOT_AUTOCREATE", "1") == "1" else None
