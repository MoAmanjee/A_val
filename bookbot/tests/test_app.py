import os
import re
import sys
from datetime import datetime, timedelta

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ["BOOKBOT_AUTOCREATE"] = "0"

import reminders  # noqa: E402
from app import DATE_FMT, create_app, normalize_phone  # noqa: E402


@pytest.fixture
def app(tmp_path):
    return create_app({"DATABASE": str(tmp_path / "t.db"), "TESTING": True, "ADMIN_KEY": "k3y"})


@pytest.fixture
def client(app):
    return app.test_client()


def token(client, path="/signup"):
    html = client.get(path).get_data(as_text=True)
    return re.search(r'name="csrf" value="([^"]+)"', html).group(1)


def signup(client, name="Cool Cuts", email="a@b.co"):
    return client.post("/signup", data={
        "csrf": token(client), "name": name, "email": email,
        "password": "password123", "whatsapp": "082 123 4567"})


def add_service(client, name="Haircut", duration=30, price=100):
    return client.post("/dashboard/services", data={
        "csrf": token(client, "/dashboard"), "name": name, "duration_min": duration, "price_zar": price})


def tomorrow():
    return (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")


def test_normalize_phone():
    assert normalize_phone("082 123 4567") == "27821234567"
    assert normalize_phone("+27 82 123 4567") == "27821234567"
    assert normalize_phone("abc") is None


def test_signup_and_dashboard(client):
    r = signup(client)
    assert r.status_code == 302
    page = client.get("/dashboard").get_data(as_text=True)
    assert "Cool Cuts" in page and "/b/cool-cuts" in page


def test_signup_rejects_duplicates_and_bad_input(client):
    signup(client)
    client.post("/logout", data={"csrf": token(client, "/dashboard")})
    assert signup(client).status_code == 400
    assert client.post("/signup", data={"csrf": token(client), "name": "x", "email": "bad",
                                        "password": "short", "whatsapp": "1"}).status_code == 400


def test_csrf_required(client):
    assert client.post("/login", data={"email": "a", "password": "b"}).status_code == 400


def test_dashboard_requires_login(client):
    assert client.get("/dashboard").status_code == 302


def test_booking_flow_and_double_booking_blocked(client):
    signup(client)
    add_service(client)
    slug_page = client.get("/b/cool-cuts")
    assert slug_page.status_code == 200
    slots = client.get(f"/b/cool-cuts/slots?service_id=1&date={tomorrow()}").get_json()["slots"]
    assert "09:00" in slots
    data = {"csrf": token(client, "/b/cool-cuts"), "service_id": 1, "date": tomorrow(),
            "time": "09:00", "name": "Sipho", "phone": "0711112222"}
    assert client.post("/b/cool-cuts/book", data=data).status_code == 200
    slots = client.get(f"/b/cool-cuts/slots?service_id=1&date={tomorrow()}").get_json()["slots"]
    assert "09:00" not in slots and "09:30" in slots
    again = client.post("/b/cool-cuts/book", data=data)
    assert again.status_code == 302


def test_overlapping_longer_service_blocked(client):
    signup(client)
    add_service(client, "Haircut", 30)
    add_service(client, "Colour", 90, 500)
    client.post("/b/cool-cuts/book", data={
        "csrf": token(client, "/b/cool-cuts"), "service_id": 1, "date": tomorrow(),
        "time": "10:00", "name": "A", "phone": "0711112222"})
    slots = client.get(f"/b/cool-cuts/slots?service_id=2&date={tomorrow()}").get_json()["slots"]
    assert "09:00" not in slots  # 09:00-10:30 overlaps the 10:00 booking
    assert "08:30" in slots and "10:30" in slots


def test_expired_trial_disables_public_page(client, app):
    signup(client)
    old = (datetime.now() - timedelta(days=30)).strftime(DATE_FMT)
    import sqlite3
    conn = sqlite3.connect(app.config["DATABASE"])
    conn.execute("UPDATE businesses SET created_at = ?", (old,))
    conn.commit()
    assert client.get("/b/cool-cuts").status_code == 403
    r = client.post("/admin/activate", data={"key": "k3y", "slug": "cool-cuts"})
    assert r.status_code == 200
    assert client.get("/b/cool-cuts").status_code == 200


def test_admin_requires_key(client):
    assert client.post("/admin/activate", data={"key": "wrong", "slug": "x"}).status_code == 403


def test_tenant_isolation(client, app):
    signup(client, "Shop One", "one@x.co")
    add_service(client)
    other = app.test_client()
    signup(other, "Shop Two", "two@x.co")
    other.post("/dashboard/services/1/delete", data={"csrf": token(other, "/dashboard")})
    import sqlite3
    conn = sqlite3.connect(app.config["DATABASE"])
    assert conn.execute("SELECT active FROM services WHERE id = 1").fetchone()[0] == 1


def test_reminders_sent_once(client, app):
    signup(client)
    add_service(client)
    start = datetime.now() + timedelta(hours=5)
    import sqlite3
    conn = sqlite3.connect(app.config["DATABASE"])
    conn.execute(
        "INSERT INTO bookings (business_id, service_id, customer_name, customer_phone, start, end, created_at)"
        " VALUES (1, 1, 'Thandi', '27711112222', ?, ?, ?)",
        (start.strftime(DATE_FMT), (start + timedelta(minutes=30)).strftime(DATE_FMT), datetime.now().strftime(DATE_FMT)))
    conn.commit()
    sent = []
    assert reminders.run(app.config["DATABASE"], sender=lambda to, text: sent.append((to, text)) or True) == 1
    assert reminders.run(app.config["DATABASE"], sender=lambda to, text: sent.append((to, text)) or True) == 0
    assert sent[0][0] == "27711112222" and "Thandi" in sent[0][1]


def test_approval_flow(client):
    assert client.post("/admin/approvals", data={"key": "bad", "kind": "ad_spend",
                                                 "description": "x", "amount_zar": 500}).status_code == 403
    r = client.post("/admin/approvals", data={"key": "k3y", "kind": "ad_spend",
                                              "description": "Facebook ads, week 1", "amount_zar": 500})
    assert r.status_code == 201
    aid = r.get_json()["id"]
    assert client.get("/admin/approvals?key=k3y").get_json()["approvals"] == []

    assert client.get("/owner", follow_redirects=False).status_code == 302
    assert client.post("/owner/login", data={"csrf": token(client, "/owner/login"), "key": "wrong"}).status_code == 401
    client.post("/owner/login", data={"csrf": token(client, "/owner/login"), "key": "k3y"})
    assert "Facebook ads, week 1" in client.get("/owner").get_data(as_text=True)

    client.post(f"/owner/approvals/{aid}/approve", data={"csrf": token(client, "/owner")})
    approved = client.get("/admin/approvals?key=k3y").get_json()["approvals"]
    assert [a["id"] for a in approved] == [aid]

    assert client.post(f"/admin/approvals/{aid}/done", data={"key": "k3y"}).status_code == 200
    assert client.post(f"/admin/approvals/{aid}/done", data={"key": "k3y"}).status_code == 409


def test_rejected_approval_never_executable(client):
    aid = client.post("/admin/approvals", data={"key": "k3y", "kind": "refund",
                                                "description": "r", "amount_zar": 100}).get_json()["id"]
    client.post("/owner/login", data={"csrf": token(client, "/owner/login"), "key": "k3y"})
    client.post(f"/owner/approvals/{aid}/reject", data={"csrf": token(client, "/owner")})
    assert client.get("/admin/approvals?key=k3y").get_json()["approvals"] == []
    assert client.post(f"/admin/approvals/{aid}/done", data={"key": "k3y"}).status_code == 409


def test_barbers_landing_page(client):
    r = client.get("/barbers")
    assert r.status_code == 200 and "no-show" in r.get_data(as_text=True)
