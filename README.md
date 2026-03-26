# FeedbackHive CLI

The official command-line interface for [FeedbackHive](https://feedbackhive.app).

## Install

```bash
npm install -g feedbackhive-cli
```

Or for local development:

```bash
npm install
npm run build
npm link
```

After that you can run either command:

```bash
fbh --help
feedbackhive --help
```

## What It Talks To

The web login flow opens your browser, asks you to authorize the CLI, creates a PAT in FeedbackHive, and stores it locally for later commands.

## Authentication

Interactive login:

```bash
fbh auth login
```

Explicit token login:

```bash
fbh auth login --method token --token fhp_xxx
```

Explicit web login:

```bash
fbh auth login --method web
```

## Commands

Projects:

```bash
fbh projects list
fbh projects get <projectId>
fbh projects create --title "Roadmap"
```

Tasks:

```bash
fbh tasks list <projectId>
fbh tasks get <projectId> <taskId>
fbh tasks create <projectId> --title "Ship CLI"
```

Task detail includes only `commentCount`, not full comment bodies.

Comments:

```bash
fbh comments list <projectId> <taskId>
fbh comments create <projectId> <taskId> --content "<p>Looks good</p>"
```

Notes:

```bash
fbh notes list <projectId>
fbh notes get <projectId> <noteId>
fbh notes create <projectId> --title "Kickoff"
```

## Config

By default the CLI stores config at:

```bash
~/.feedbackhive/config.json
```

Resolution order:

1. CLI flags
2. Environment variables
3. Saved config

Environment variables:

```bash
FBH_TOKEN
FBH_CONFIG
```
