# One Wish Willow Store

One-page storefront with checkout, payment status, admin review, customer approval and rejection screens, and email notifications.

## Run locally

1. Copy `.env.example` to `.env`.
2. Fill in the private values in `.env`.
3. Start the server:

```bash
python server.py
```

4. Open the site:

```text
http://127.0.0.1:4180
```

## Important pages

- Home: `/`
- Checkout: `/checkout.html`
- Payment: `/payment.html`
- Order status: `/status.html`
- Admin: `/admin.html`

## Files to edit

- Main store pages: `outputs/index.html`, `outputs/checkout.html`, `outputs/payment.html`
- Styling: `outputs/styles.css`
- Store behavior and prices: `outputs/script.js`
- Backend and emails: `server.py`

## Launch

Use Render for the Python web service and Supabase for permanent order storage. The Render service should use:

```bash
python server.py
```

Never upload `.env`, the `work` folder, local backups, or cache folders.
