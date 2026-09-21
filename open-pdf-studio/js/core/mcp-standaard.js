// Standaardwaarden van de AI-koppeling (MCP). Los van constants.ts zodat de
// unit-test ze zonder bundelaar kan lezen; DEFAULT_PREFERENCES neemt ze over.
export const MCP_STANDAARD = Object.freeze({
  mcpEnabled: true,
  mcpPort: 9223,
});
