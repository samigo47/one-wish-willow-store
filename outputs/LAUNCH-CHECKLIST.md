# One Wish Willow Launch Checklist

## Before Publishing

- Change `OWW_ADMIN_PASSWORD` in the server environment.
- Set Gmail SMTP values as environment variables, not public website code.
- Set `OWW_PUBLIC_BASE_URL` to the final hosted URL.
- Create a Supabase project and run `supabase-schema.sql`.
- Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in Render.
- Place one test order from a phone.
- Approve one test order and confirm the customer receives the approval email.
- Reject one test order and confirm the customer receives the rejection reason.
- Mark one approved test order as shipped and confirm the shipped email.
- Confirm the footer `Check Status` page works with pending, approved, rejected, and shipped orders.

## Free Hosting Recommendation

Fastest free test launch: Render Free Web Service. It can run `server.py`, store environment variables, and serve the current website.

Important: Render free services can sleep when idle and do not keep local filesystem changes long term. That means JSON order storage is okay for testing, but not the best final store for real sales.

More durable free Python option: PythonAnywhere. It has a free web app and filesystem quota, but check whether its free outbound network rules allow the email flow you need.

Best real launch path after the first free test: keep the website/backend on a host, but move orders into a database such as Supabase, Neon, or hosted Postgres.

## Environment Variables To Set

- `OWW_SMTP_HOST`
- `OWW_SMTP_PORT`
- `OWW_SMTP_USER`
- `OWW_SMTP_PASS`
- `OWW_FROM_EMAIL`
- `OWW_FROM_NAME`
- `OWW_ADMIN_EMAIL`
- `OWW_PUBLIC_BASE_URL`
- `OWW_ADMIN_PASSWORD`
- `HOST`
- `PORT`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
