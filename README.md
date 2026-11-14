# Scientific ESSENCE Editorial Portal

A responsive static HTML, CSS and JavaScript portal for embedding in Google Sites. It connects to the existing Supabase project `ikgcnoekehknvchyjblp`.

## Included in this first release

- Email and password registration and sign in
- Email confirmation compatible registration flow
- Password recovery
- Profile role display
- Author manuscript metadata submission
- Editorial manuscript status updates
- Reviewer assignment by Supabase Auth user UUID
- Reviewer recommendation and comments
- Supabase Row Level Security as the actual authorization boundary

## Files

- `index.html`: application markup
- `styles.css`: responsive visual design
- `app.js`: Supabase browser client and application behavior
- `database-schema.sql`: schema and RLS policy reference

## Important deployment steps

1. Host this folder on a static HTTPS host, such as GitHub Pages, Cloudflare Pages or Netlify.
2. In Supabase Authentication URL Configuration, set the hosted application URL as the Site URL and add the exact hosted URL as an allowed redirect URL.
3. In Google Sites, use Insert → Embed → By URL and paste the hosted application URL. Publish the Google Site.
4. Test sign up, email confirmation, sign in, password recovery and sign out in a normal browser window and inside the Google Sites embed.

## Bootstrap the first administrator

1. Register your own account through the portal.
2. Confirm your email and sign in once.
3. In Supabase Dashboard → Authentication → Users, copy your user UUID.
4. Open SQL Editor and run the following, replacing the UUID with your own:

```sql
update public.profiles
set role = 'admin'
where id = 'YOUR_AUTH_USER_UUID';
```

5. Sign out and sign in again. The portal should show the ADMIN role.

Do not expose a Supabase secret key or service role key in this static application. The publishable key in `app.js` is intended for browser use. Database access is constrained by RLS policies.

## Create editorial accounts

Users can register themselves. New accounts are assigned the `author` role by the database trigger. The administrator must assign staff roles from the SQL Editor, for example:

```sql
update public.profiles set role = 'editor' where id = 'USER_UUID';
update public.profiles set role = 'reviewer' where id = 'USER_UUID';
```

Never let users choose their own privileged role during public registration.

## Current limitations

This is an initial working portal foundation, not a complete journal production system. Manuscript file upload, blinded reviewer file delivery, email notifications, revision versioning, DOI metadata, publication issue management, audit logs and advanced editorial decision workflows are not included yet. Do not use it for confidential manuscript files until secure private Storage buckets and document access policies have been implemented and tested.

## Embed note

The Google Sites page is a presentation surface only. Authentication and database permissions are provided by Supabase. Some browser privacy settings can affect third party cookies or embedded sign in sessions. If the embedded session is not retained, open the hosted portal in a new tab or configure the host and authentication flow accordingly.
