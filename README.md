# Kanban Project Manager

## Run the app

```
cd frontend
npm ci
npm run dev
```

Open http://localhost:3000. Cards support an assignee, due date, priority, and creation date; overdue open cards return to Backlog. Drag cards to reorder them within a column. Board edits remain in this browser on this device and are mirrored to private local server state.

Use **Save snapshot** to append a dated board to `frontend/data/kanban-board-history.xlsx`. The server also appends an automatic snapshot at 11:59 PM in the Mac's timezone each day while the Mac and app server are running. **Turn off** saves a final snapshot before stopping the server.

The app binds to this Mac only. Board data is stored in browser storage and the local Excel workbook; the snapshot button sends it only to the local app endpoint. Next.js telemetry is disabled in the npm scripts. The build may fetch the configured Geist font from Google, but that request does not include board data.

To turn the site back on, run this one-line command from Terminal:

```sh
cd /Users/zeeshankhan/CODE/kanban/frontend && npm run dev
```

Automatic snapshots require the Mac and app server to remain on. If the Mac is off at the end of the day, no automatic snapshot can run during that downtime.

## Instructions

This is a skeleton project to be the basis for your Kanban project for Week 1 of the Complete AI Coder Course. See the course resources for more.

You should clone this repo within your projects directory with:

`git clone https://github.com/ed-donner/kanban.git`

And then refine the AGENTS.md before using in your Coding Agent of choice.

If you don't have git installed, you can [install it here](https://git-scm.com/install/) and you might need to reboot afterwards.

## Contributing your AGENTS.md

If you have suggested AGENTS.md changes that have worked well for you, please contribute them to benefit other students! Follow the instructions linked [here](https://edwarddonner.com/pr) to raise a PR to put it in community_contributions. Name your file something like ED_DONNER_AGENTS.md but with your name..

I can't wait to see your changes.

## Posting your app

When you've successfully built a Kanban app, if you'd like to post about it on LinkedIn and tag me, then I'll weigh in to amplify your success and draw more attention to your achievements.

If you see other students doing this, please weigh in yourself to add your support and encouragement. It's so helpful for the community if we support each other.