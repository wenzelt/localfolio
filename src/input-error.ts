// A problem with what the person entered, which they can fix. Its message is safe to show them as it is.
// Anything else is an outage or a bug, so callers answer with a generic message instead.
export class InputError extends Error {}
