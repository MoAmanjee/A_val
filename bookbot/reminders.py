"""Send WhatsApp reminders for bookings starting within the next REMIND_HOURS.

Run every 15 minutes from cron:
    */15 * * * * cd /path/to/bookbot && python3 reminders.py

Without WHATSAPP_TOKEN / WHATSAPP_PHONE_ID set it only prints what it would send,
so it is safe to run before the WhatsApp Business account is approved.
"""
import os
import sqlite3
from datetime import datetime, timedelta

import requests

DATE_FMT = "%Y-%m-%d %H:%M"
REMIND_HOURS = int(os.environ.get("REMIND_HOURS", "24"))
GRAPH_URL = "https://graph.facebook.com/v20.0/{phone_id}/messages"


def build_message(business_name, customer_name, service_name, start):
    return (f"Hi {customer_name}, this is a reminder of your {service_name} appointment at "
            f"{business_name} on {start:%A %d %B} at {start:%H:%M}. "
            f"Reply to this message or call us if you need to reschedule.")


def send_whatsapp(to, text):
    token = os.environ.get("WHATSAPP_TOKEN")
    phone_id = os.environ.get("WHATSAPP_PHONE_ID")
    if not token or not phone_id:
        print(f"[dry-run] to={to}: {text}")
        return True
    resp = requests.post(
        GRAPH_URL.format(phone_id=phone_id),
        headers={"Authorization": f"Bearer {token}"},
        json={"messaging_product": "whatsapp", "to": to, "type": "text", "text": {"body": text}},
        timeout=15,
    )
    if not resp.ok:
        print(f"[error] {to}: {resp.status_code} {resp.text}")
    return resp.ok


def run(database, now=None, sender=send_whatsapp):
    now = now or datetime.now()
    conn = sqlite3.connect(database)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT b.id, b.customer_name, b.customer_phone, b.start, s.name AS service_name, biz.name AS biz_name"
        " FROM bookings b JOIN services s ON s.id = b.service_id JOIN businesses biz ON biz.id = b.business_id"
        " WHERE b.status = 'confirmed' AND b.reminded = 0 AND b.start > ? AND b.start <= ?",
        (now.strftime(DATE_FMT), (now + timedelta(hours=REMIND_HOURS)).strftime(DATE_FMT)),
    ).fetchall()
    sent = 0
    for row in rows:
        start = datetime.strptime(row["start"], DATE_FMT)
        text = build_message(row["biz_name"], row["customer_name"], row["service_name"], start)
        if sender(row["customer_phone"], text):
            conn.execute("UPDATE bookings SET reminded = 1 WHERE id = ?", (row["id"],))
            conn.commit()
            sent += 1
    conn.close()
    return sent


if __name__ == "__main__":
    db_path = os.environ.get("DATABASE", os.path.join(os.path.dirname(__file__), "bookbot.db"))
    print(f"Sent {run(db_path)} reminder(s)")
