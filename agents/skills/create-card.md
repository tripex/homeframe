# Skill: create a Homeframe card

Input: a user goal such as "show my EV charger" or "add a compact room climate card".

Output:

- a card manifest describing semantic capability requirements,
- a Vue component that contains zero raw Home Assistant entity IDs,
- optional service actions routed through the core adapter,
- demo fixture data,
- documentation of any assumptions.

Ask Home Assistant/MCP for real entities only when binding an installation. Do not leak installation-specific IDs into reusable source code.
