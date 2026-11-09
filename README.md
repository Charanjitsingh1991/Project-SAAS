# Nexora — Marketing Website

Landing page for an all-in-one business SaaS (HRM, CRM, Finance, Inventory, Projects, Payroll, Helpdesk, Analytics).

Pure HTML/CSS/JS, with no build step and no dependencies.

## Run locally

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

Or just open `index.html` in a browser.

## Deploy

Upload the folder to any static host: GitHub Pages, Netlify, Vercel, Cloudflare Pages, or S3.

## Customize

- **Brand name**: "Nexora" is a placeholder. Find and replace it in `index.html`.
- **Colors**: edit the CSS variables at the top of `styles.css` (`--primary`, `--accent`, `--bg`).
- **Pricing**: edit `data-monthly` / `data-yearly` on each `.price__val` in `index.html`.
- **Demo form**: `script.js` only shows a thank-you message. Point it at your backend, CRM, or a form service (Formspree, HubSpot, etc.).
- **Content**: testimonials, stats and customer logos are sample content. Replace them with real ones before launch.

## Sections

Hero with animated dashboard preview · customer logos · 8 product modules · tabbed platform tour · stats · "Why us" bento grid · testimonials · pricing with monthly/yearly toggle · FAQ · demo-request CTA · footer. Fully responsive and respects `prefers-reduced-motion`.
