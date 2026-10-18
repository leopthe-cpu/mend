-- Decision 89: the public site moves to https://www.mendshops.com (Railway
-- custom domain, verified 18 Oct 2026). Links Mend puts in texts and emails
-- (shop contact page, email unsubscribe page) use this setting. The bare
-- mendshops.com forwards to www at GoDaddy, so links always use www.
update private.app_settings set value = 'https://www.mendshops.com' where key = 'public_base_url';
