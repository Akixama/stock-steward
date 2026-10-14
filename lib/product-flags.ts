// Build-time product visibility flags. Both default to off so unfinished and
// diagnostic surfaces never appear in the normal hosted experience by accident.
export const SHOW_DEVELOPER_TOOLS = process.env.SHOW_DEVELOPER_TOOLS === 'true';
// Future automatic-trading work stays in the repository, but no deployment can
// reveal its product surfaces until this source gate is deliberately changed.
export const AUTOMATIC_TRADING_ENABLED = false;
