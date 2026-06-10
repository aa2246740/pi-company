# pi-company Website

[English](README.md) | [中文](README.zh-CN.md)

> The public website for pi-company: run Pi agents like a visible local project team.

This site is the docs and product front door for `pi-company`. Its job is to explain the project quickly, show the workflow visually, and teach the core commands without hiding the fact that pi-company is a local Pi extension and helper CLI.

## Local Development

```bash
npm install
npm run dev
```

Open http://localhost:5173/pi-company/ during development.

## Check

```bash
npm run check
```

`check` runs the privacy scan, tests, production build, and a final privacy scan.

## Deploy Target

The built site is published with GitHub Pages:

https://aa2246740.github.io/pi-company/

## Content Standard

The homepage should make a new visitor understand three things before the detailed docs:

1. `pi-company` connects visible Pi sessions into a local project team.
2. Lead keeps the global truth while workers coordinate through local issues, mailboxes, worktrees, and PR gates.
3. The user keeps control because every agent is visible and steerable.

Keep the TUI style as a comprehension aid, not decoration.

## License

Apache-2.0. Unless explicitly stated otherwise, contributions to this project are licensed under the same Apache-2.0 license.
