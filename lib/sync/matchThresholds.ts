// Confidence floors shared by the sync engine and the offline match tools.
// They live in their own module because the same two numbers were re-declared
// in the engine, the dry-run script and the calibration script — so a threshold
// moved by a calibration run could silently apply in one place and not another.
export const AUTO_MATCH_THRESHOLD = Number(process.env.WORKER_AUTO_MATCH_THRESHOLD ?? 0.82);
export const MANUAL_REVIEW_THRESHOLD = Number(process.env.WORKER_MANUAL_REVIEW_THRESHOLD ?? 0.65);
