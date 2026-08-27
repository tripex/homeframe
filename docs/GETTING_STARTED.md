# Getting started

This guide is for contributors who want to understand or run Homeframe without connecting a real Home Assistant installation.

## 1. Install dependencies

From the repository root:

```bash
npm install
```

Homeframe uses npm workspaces, so one install covers the dashboard and the internal packages.

## 2. Start in demo mode

```bash
npm run dev
```

Open `http://localhost:4173`.

The dashboard deliberately works without Home Assistant. Demo data gives us a predictable home for visual development and tests.

## 3. Understand the data flow

A real installation flows through four steps:

```text
Home Assistant API
      ↓
RegistrySnapshot
      ↓
discoverHome()
      ↓
SemanticHome
      ↓
Dashboard / cards
```

`RegistrySnapshot` contains Home Assistant-shaped data. `SemanticHome` contains Homeframe concepts.

That boundary is important. Components should not need to understand Home Assistant registry internals.

## 4. Where should a change go?

### A Home Assistant entity is classified incorrectly

Change `packages/core/src/discovery.ts` and add/update a discovery test.

### A card needs a new visual behavior

Change the relevant component in `apps/dashboard/src/components/cards`.

### A new kind of reusable card is needed

Add a card component and a manifest in `catalog/cards`.

### An installation needs different entities

Change bindings/configuration. Do not hardcode those entity IDs into the card.

### An AI agent needs to understand a new feature

Update the corresponding manifest/schema and the agent docs. Do not rely only on prose prompts.

## 5. Connect a real Home Assistant later

Homeframe can already open a WebSocket connection and retrieve areas, devices, entities and states. The production connection/onboarding model is intentionally not finalized yet.

For now, real Home Assistant access is for local development only.
