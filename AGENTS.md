<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Ask first

Double-check ideas with the user before implementing them. Do not start a new feature, architecture change, or extra slice of work until they confirm. If they decline, stop or revert.

## Testing

Skip screenshots and screen recordings for UI changes — the user verifies on the Vercel web preview. Run `npm run typecheck`, `npm run lint`, and `npm test`, then commit and push.
