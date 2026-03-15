# DNS Setup for prices.wetpaws.dev

Add these records in **Cloudflare** (or your DNS provider) for the `wetpaws.dev` zone:

| Type  | Name   | Content           | Proxy  | TTL  |
|-------|--------|-------------------|--------|------|
| A     | prices | `<GCP_SERVER_IP>` | ✅ On  | Auto |

> If using Cloudflare proxy (orange cloud ✅), SSL is handled by Cloudflare → you can use
> a Cloudflare Origin Certificate on nginx instead of Let's Encrypt (no port 80 challenge needed).
>
> If you disable the proxy (grey cloud), use Let's Encrypt via `nginx/setup.sh`.

## If this is AWS CloudFront (not Cloudflare)

1. Create a CloudFront distribution pointing to your GCP server origin (`<GCP_SERVER_IP>:443`)
2. Set Alternate Domain Name (CNAME): `prices.wetpaws.dev`
3. Request an ACM certificate for `prices.wetpaws.dev` in us-east-1
4. In Route 53 (or your DNS), add a CNAME: `prices` → CloudFront distribution domain (e.g. `abc123.cloudfront.net`)

Note: CloudFront in front of GCP is unusual — confirm this is intentional or use Cloudflare instead.
