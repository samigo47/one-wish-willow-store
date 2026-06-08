from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse
from urllib.request import Request, urlopen
from email.message import EmailMessage
from email.utils import formataddr
import datetime
import hashlib
import json
import os
import shutil
import smtplib
import sys
import time


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "outputs"
DATA_DIR = ROOT / "work" / "backend-data"
ORDERS_FILE = DATA_DIR / "orders.json"
OUTBOX_DIR = DATA_DIR / "outbox"
BACKUP_DIR = DATA_DIR / "backups"


def clean_env(key, default=""):
    value = os.getenv(key, default)
    if value is None:
        return default
    return value.replace("•", "").strip() or default


SHOP_EMAIL = clean_env("OWW_FROM_EMAIL", "shoponewishwillow@gmail.com")


def load_env_file():
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"'))


def ensure_store():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    OUTBOX_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    if not ORDERS_FILE.exists():
        ORDERS_FILE.write_text("[]", encoding="utf-8")


def read_orders():
    remote_orders = read_orders_from_supabase()
    if remote_orders is not None:
        return remote_orders
    ensure_store()
    try:
        payload = json.loads(ORDERS_FILE.read_text(encoding="utf-8-sig"))
        if isinstance(payload, dict) and isinstance(payload.get("value"), list):
            return payload["value"]
        if isinstance(payload, list):
            return payload
        return []
    except json.JSONDecodeError:
        return []


def write_orders(orders):
    ensure_store()
    if ORDERS_FILE.exists() and ORDERS_FILE.stat().st_size > 0:
        stamp = time.strftime("%Y%m%d-%H%M%S")
        backup_file = BACKUP_DIR / f"orders-{stamp}.json"
        shutil.copy2(ORDERS_FILE, backup_file)
        backups = sorted(BACKUP_DIR.glob("orders-*.json"), key=lambda item: item.stat().st_mtime)
        for old_backup in backups[:-50]:
            old_backup.unlink(missing_ok=True)
    ORDERS_FILE.write_text(json.dumps(orders, indent=2), encoding="utf-8")
    write_orders_to_supabase(orders)


def supabase_configured():
    return bool(clean_env("SUPABASE_URL") and clean_env("SUPABASE_SERVICE_ROLE_KEY"))


def supabase_headers(prefer="return=representation"):
    key = clean_env("SUPABASE_SERVICE_ROLE_KEY", "")
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json"
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


def supabase_rest_url(path):
    return f"{clean_env('SUPABASE_URL', '').rstrip('/')}/rest/v1/{path.lstrip('/')}"


def supabase_request(method, path, payload=None, prefer="return=representation"):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(
        supabase_rest_url(path),
        data=data,
        headers=supabase_headers(prefer),
        method=method
    )
    with urlopen(request, timeout=20) as response:
        raw = response.read().decode("utf-8")
        return json.loads(raw) if raw else None


def read_orders_from_supabase():
    if not supabase_configured():
        return None
    try:
        rows = supabase_request("GET", "orders?select=data&order=received_at.desc", prefer="")
        return [row.get("data", {}) for row in rows or []]
    except Exception as exc:
        save_outbox("local-log", "SUPABASE READ FAILED", "", str(exc))
        return None


def write_orders_to_supabase(orders):
    if not supabase_configured():
        return False
    rows = []
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    for order in orders:
        order_number = order.get("orderNumber")
        if not order_number:
            continue
        rows.append({
            "order_number": order_number,
            "status": order.get("status", "pending"),
            "received_at": order.get("receivedAt") or order.get("submittedAt") or now,
            "updated_at": now,
            "data": order
        })
    if not rows:
        return True
    try:
        supabase_request(
            "POST",
            "orders?on_conflict=order_number",
            rows,
            prefer="resolution=merge-duplicates,return=minimal"
        )
        return True
    except Exception as exc:
        save_outbox("local-log", "SUPABASE WRITE FAILED", json.dumps(rows, indent=2), str(exc))
        return False


def admin_password():
    return clean_env("OWW_ADMIN_PASSWORD", "change-this-before-launch")


def admin_session_value():
    secret = f"{admin_password()}|{ROOT}|one-wish-willow-admin"
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def parse_cookies(header):
    cookies = {}
    for chunk in (header or "").split(";"):
        if "=" in chunk:
            key, value = chunk.strip().split("=", 1)
            cookies[key] = value
    return cookies


def send_email(to_email, subject, body):
    host = clean_env("OWW_SMTP_HOST", "smtp.gmail.com")
    port = int(clean_env("OWW_SMTP_PORT", "587"))
    user = clean_env("OWW_SMTP_USER", "")
    password = clean_env("OWW_SMTP_PASS", "")
    from_email = clean_env("OWW_FROM_EMAIL", SHOP_EMAIL)
    from_name = clean_env("OWW_FROM_NAME", "ONE WISH WILLOW")
    if not user or not password:
        save_outbox(to_email, subject, body, "SMTP credentials are not configured.")
        return False

    message = EmailMessage()
    message["From"] = formataddr((from_name, from_email))
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(body)

    with smtplib.SMTP(host, port, timeout=20) as smtp:
        smtp.starttls()
        smtp.login(user, password)
        smtp.send_message(message)
    return True


def send_email_html(to_email, subject, text_body, html_body):
    host = clean_env("OWW_SMTP_HOST", "smtp.gmail.com")
    port = int(clean_env("OWW_SMTP_PORT", "587"))
    user = clean_env("OWW_SMTP_USER", "")
    password = clean_env("OWW_SMTP_PASS", "")
    from_email = clean_env("OWW_FROM_EMAIL", SHOP_EMAIL)
    from_name = clean_env("OWW_FROM_NAME", "ONE WISH WILLOW")
    if not user or not password:
        save_outbox(to_email, subject, text_body, "SMTP credentials are not configured.")
        return False

    message = EmailMessage()
    message["From"] = formataddr((from_name, from_email))
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(text_body)
    message.add_alternative(html_body, subtype="html")

    with smtplib.SMTP(host, port, timeout=20) as smtp:
        smtp.starttls()
        smtp.login(user, password)
        smtp.send_message(message)
    return True


def save_outbox(to_email, subject, body, reason):
    ensure_store()
    safe_subject = "".join(char if char.isalnum() else "-" for char in subject)[:80].strip("-")
    filename = f"{time.strftime('%Y%m%d-%H%M%S')}-{safe_subject or 'email'}.txt"
    content = "\n".join([
        f"To: {to_email}",
        f"From: {clean_env('OWW_FROM_EMAIL', SHOP_EMAIL)}",
        f"Subject: {subject}",
        f"Not sent reason: {reason}",
        "",
        body
    ])
    (OUTBOX_DIR / filename).write_text(content, encoding="utf-8")


def public_base_url():
    return (clean_env("OWW_PUBLIC_BASE_URL") or clean_env("RENDER_EXTERNAL_URL") or "http://127.0.0.1:4180").rstrip("/")


def order_body(order):
    base = public_base_url()
    order_number = order.get("orderNumber")
    return "\n".join([
        "A customer clicked I PAID on the One Wish Willow checkout.",
        "",
        f"Order number: {order.get('orderNumber')}",
        f"Product: {order.get('product')}",
        f"Quantity: {order.get('quantity')}",
        f"Subtotal: {order.get('subtotal')}",
        f"Shipping: {order.get('shippingCost')}",
        f"Total: {order.get('total')}",
        f"Payment method: {order.get('paymentMethod')}",
        "",
        "Customer details:",
        f"Name: {order.get('customerName')}",
        f"Email: {order.get('customerEmail')}",
        f"Phone: {order.get('phone')}",
        f"Address: {order.get('address')}",
        f"City: {order.get('city')}",
        f"State: {order.get('state')}",
        f"ZIP: {order.get('zip')}",
        "",
        f"Submitted: {order.get('submittedAt')}",
        "",
        f"Approve: {base}/review/{order_number}/approve",
        f"Reject: {base}/review/{order_number}/reject",
        f"Admin dashboard: {base}/admin.html"
    ])


def order_html(order):
    base = public_base_url()
    order_number = order.get("orderNumber")
    approve = f"{base}/review/{order_number}/approve"
    reject = f"{base}/review/{order_number}/reject"
    admin = f"{base}/admin.html"
    rows = [
        ("Order number", order_number),
        ("Product", order.get("product")),
        ("Quantity", order.get("quantity")),
        ("Subtotal", order.get("subtotal")),
        ("Shipping", order.get("shippingCost")),
        ("Total", order.get("total")),
        ("Payment method", order.get("paymentMethod")),
        ("Name", order.get("customerName")),
        ("Email", order.get("customerEmail")),
        ("Phone", order.get("phone")),
        ("Address", f"{order.get('address')}, {order.get('city')}, {order.get('state')} {order.get('zip')}"),
        ("Submitted", order.get("submittedAt")),
    ]
    row_html = "".join(f"<tr><td><b>{label}</b></td><td>{value}</td></tr>" for label, value in rows)
    return f"""<!doctype html>
<html>
  <body style="font-family:Arial,sans-serif;background:#f7e8cf;color:#111;padding:24px;">
    <div style="max-width:720px;margin:auto;background:#fff2dc;border:5px solid #ef161d;border-radius:18px;padding:20px;">
      <h1 style="color:#ef161d;margin-top:0;">Paid Order Review</h1>
      <p>A customer clicked <b>I PAID!</b>. Review Cash App, then choose one action.</p>
      <p>
        <a href="{approve}" style="display:inline-block;background:#ef161d;color:#f7e8cf;padding:14px 22px;border-radius:8px;text-decoration:none;font-weight:bold;margin-right:8px;">APPROVE</a>
        <a href="{reject}" style="display:inline-block;background:#111;color:#f7e8cf;padding:14px 22px;border-radius:8px;text-decoration:none;font-weight:bold;">REJECT</a>
      </p>
      <table style="width:100%;border-collapse:collapse;">{row_html}</table>
      <p><a href="{admin}">Open admin dashboard</a></p>
    </div>
  </body>
</html>"""


def customer_decision_body(order, approved):
    review_reason = order.get("reviewReason") or "The order could not be verified during review."
    if approved:
        return "\n".join([
            f"Hi {order.get('customerName', 'there')},",
            "",
            f"This is your confirmation email: One Wish Willow order {order.get('orderNumber')} has been approved.",
            "Your wish is officially on the way to your doorstep.",
            "",
            "Delivery is expected within 3 to 14 business days.",
            "Future updates will be sent to this email address.",
            "",
            f"Total received: {order.get('total')}",
            f"Shipping address: {order.get('address')}, {order.get('city')}, {order.get('state')} {order.get('zip')}",
            "",
            "Thank you for bringing One Wish Willow home. Make your wish feel welcome.",
            "",
            "Thank you,",
            "One Wish Willow"
        ])
    return "\n".join([
        f"Hi {order.get('customerName', 'there')},",
        "",
        f"We are sorry, but your One Wish Willow order {order.get('orderNumber')} was rejected.",
        f"Reason: {review_reason}",
        "",
        "If you believe this was a mistake, please reply with the correct information and a screenshot of your Cash App payment.",
        "You may also place a new order after correcting the issue.",
        "",
        "One Wish Willow"
    ])


def customer_shipped_body(order):
    return "\n".join([
        f"Hi {order.get('customerName', 'there')},",
        "",
        f"Your One Wish Willow order {order.get('orderNumber')} has been marked shipped.",
        "Your wish has left the counter and is making its way toward your doorstep.",
        "",
        "Delivery timing may vary by carrier and address, but most approved orders are expected within 3 to 14 business days.",
        "",
        f"Shipping address: {order.get('address')}, {order.get('city')}, {order.get('state')} {order.get('zip')}",
        "",
        "Thank you,",
        "One Wish Willow"
    ])


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def is_admin_authenticated(self):
        cookies = parse_cookies(self.headers.get("Cookie", ""))
        return cookies.get("oww_admin") == admin_session_value()

    def redirect(self, location, status=302):
        self.send_response(status)
        self.send_header("Location", location)
        self.end_headers()

    def require_admin(self):
        if self.is_admin_authenticated():
            return True
        next_path = self.path if self.path.startswith("/") else "/admin.html"
        self.redirect(f"/login.html?next={next_path}")
        return False

    def require_admin_json(self):
        if self.is_admin_authenticated():
            return True
        self.send_json({"error": "Admin login required"}, 401)
        return False

    def send_json(self, payload, status=200):
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8") or "{}")

    def read_form(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8")
        return {key: values[0] for key, values in parse_qs(raw).items()}

    def do_GET(self):
        parsed = urlparse(self.path)
        parts = [unquote(part) for part in parsed.path.strip("/").split("/") if part]
        if parsed.path == "/admin.html" and not self.require_admin():
            return
        if len(parts) == 3 and parts[0] == "review" and parts[2] in {"approve", "reject"}:
            if not self.require_admin():
                return
            self.review_order_link(parts[1], parts[2])
            return
        if parsed.path == "/api/admin/logout":
            self.send_response(302)
            self.send_header("Set-Cookie", "oww_admin=; Path=/; Max-Age=0; SameSite=Lax")
            self.send_header("Location", "/login.html")
            self.end_headers()
            return
        if parsed.path == "/api/orders":
            if not self.require_admin_json():
                return
            orders = sorted(read_orders(), key=lambda item: item.get("receivedAt", ""), reverse=True)
            self.send_json({"orders": orders})
            return
        if len(parts) == 3 and parts[:2] == ["api", "orders"]:
            order_number = parts[2]
            order = next((item for item in read_orders() if item.get("orderNumber") == order_number), None)
            if not order:
                self.send_json({"error": "Order not found"}, 404)
                return
            self.send_json({"order": order})
            return
        super().do_GET()

    def review_order_link(self, order_number, action):
        orders = read_orders()
        for order in orders:
            if order.get("orderNumber") == order_number:
                self.apply_review_action(orders, order, action)
                action_label = "Approved" if action == "approve" else "Rejected"
                body = f"""<!doctype html>
<html><head><title>Order {action_label}</title></head>
<body style="font-family:Arial,sans-serif;background:#f7e8cf;color:#111;padding:40px;">
<div style="max-width:680px;margin:auto;background:#fff2dc;border:5px solid #ef161d;border-radius:18px;padding:24px;text-align:center;">
<h1 style="color:#ef161d;">Order {action_label}</h1>
<p>{order_number} is now {order.get('status')}.</p>
<p><a href="/admin.html">Back to admin</a></p>
</div></body></html>""".encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
        self.send_json({"error": "Order not found"}, 404)

    def apply_review_action(self, orders, order, action, reason=""):
        if action == "ship":
            order["status"] = "shipped"
        else:
            order["status"] = "approved" if action == "approve" else "rejected"
        order["reviewedAt"] = time.strftime("%Y-%m-%d %H:%M:%S")
        if action == "reject":
            order["reviewReason"] = reason or "The order could not be verified during review."
        elif action == "approve":
            order.pop("reviewReason", None)
        subject = f"{order['status'].upper()} - One Wish Willow order {order.get('orderNumber')}"
        try:
            if order.get("customerEmail") and "@" in order.get("customerEmail", ""):
                body = customer_shipped_body(order) if action == "ship" else customer_decision_body(order, action == "approve")
                send_email(order["customerEmail"], subject, body)
        except Exception as exc:
            body = customer_shipped_body(order) if action == "ship" else customer_decision_body(order, action == "approve")
            save_outbox(order.get("customerEmail", ""), subject, body, str(exc))
            order["customerEmailError"] = str(exc)
        write_orders(orders)

    def do_POST(self):
        parsed = urlparse(self.path)
        parts = [unquote(part) for part in parsed.path.strip("/").split("/") if part]
        if parsed.path == "/api/admin/login":
            form = self.read_form()
            next_path = form.get("next") or "/admin.html"
            if form.get("password") == admin_password():
                self.send_response(302)
                self.send_header("Set-Cookie", f"oww_admin={admin_session_value()}; Path=/; HttpOnly; SameSite=Lax")
                self.send_header("Location", next_path)
                self.end_headers()
                return
            self.redirect(f"/login.html?error=1&next={next_path}")
            return
        if parsed.path == "/api/orders":
            order = self.read_json()
            order_number = order.get("orderNumber") or f"OWW-{int(time.time())}"
            order["orderNumber"] = order_number
            order["status"] = "pending"
            order["receivedAt"] = time.strftime("%Y-%m-%d %H:%M:%S")
            orders = [item for item in read_orders() if item.get("orderNumber") != order_number]
            orders.append(order)
            write_orders(orders)
            try:
                admin_email = clean_env("OWW_ADMIN_EMAIL", "onewillowish@gmail.com")
                send_email_html(admin_email, f"PAID ORDER {order_number} - {order.get('total')}", order_body(order), order_html(order))
            except Exception as exc:
                save_outbox(admin_email, f"PAID ORDER {order_number} - {order.get('total')}", order_body(order), str(exc))
                order["adminEmailError"] = str(exc)
                write_orders([item if item.get("orderNumber") != order_number else order for item in orders])
            self.send_json({"ok": True, "order": order})
            return

        if len(parts) == 4 and parts[:2] == ["api", "orders"] and parts[3] in {"approve", "reject", "ship"}:
            if not self.require_admin_json():
                return
            order_number = parts[2]
            action = parts[3]
            payload = self.read_json()
            reason = payload.get("reason", "")
            orders = read_orders()
            for order in orders:
                if order.get("orderNumber") == order_number:
                    self.apply_review_action(orders, order, action, reason)
                    self.send_json({"ok": True, "order": order})
                    return
            self.send_json({"error": "Order not found"}, 404)
            return

        self.send_json({"error": "Not found"}, 404)


def main():
    load_env_file()
    ensure_store()
    raw_port = clean_env("PORT", "4180")
    port = int(raw_port) if raw_port.isdigit() else 10000 if clean_env("RENDER") else 4180
    host = "0.0.0.0" if clean_env("RENDER") else clean_env("HOST", "0.0.0.0")
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"One Wish Willow backend running at http://127.0.0.1:{port}/")
    print(f"Admin page: http://127.0.0.1:{port}/admin.html")
    print("Email sending is enabled only if OWW_SMTP_USER and OWW_SMTP_PASS are set.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        sys.exit(0)


if __name__ == "__main__":
    main()
