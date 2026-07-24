# Drydock

Proof-of-concept scaffold for an engine-aware, channel-isolated game release harness.

The goal is to ship one portable payload to many release channels - Steam, Epic, GOG,
itch, the App Store, and Google Play - without letting store logic leak into game code.
It also keeps fast web iteration separate from reproducible releases.

**Start with [`AGENTS.md`](./AGENTS.md)** - it describes the project and indexes the
docs under [`docs/`](./docs/).
