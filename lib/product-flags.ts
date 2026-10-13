// Build-time product visibility flags. Both default to off so unfinished and
// diagnostic surfaces never appear in the normal hosted experience by accident.
export const SHOW_DEVELOPER_TOOLS = process.env.SHOW_DEVELOPER_TOOLS === 'true';
export const AUTOMATIC_TRADING_ENABLED = process.env.AUTOMATIC_TRADING_ENABLED === 'true';
