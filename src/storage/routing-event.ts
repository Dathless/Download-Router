import { isRecord } from '../core/config-validator';
import { isValidDestination, isValidSegment } from '../core/path-validator';
import type { RoutingEvent } from '../models/routing-event';

export const ROUTING_EVENT_KEY = 'lastRoutingEvent';

export function parseRoutingEvent(value: unknown): RoutingEvent {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) =>
        !['timestamp', 'ruleId', 'basename', 'destination'].includes(key),
    ) ||
    !Number.isSafeInteger(value.timestamp) ||
    (value.timestamp as number) < 0 ||
    typeof value.ruleId !== 'string' ||
    !value.ruleId.trim() ||
    typeof value.basename !== 'string' ||
    !isValidSegment(value.basename) ||
    typeof value.destination !== 'string' ||
    !isValidDestination(value.destination)
  )
    throw new Error('Invalid routing event.');
  return {
    timestamp: value.timestamp as number,
    ruleId: value.ruleId,
    basename: value.basename,
    destination: value.destination.replaceAll('\\', '/'),
  };
}

export async function readRoutingEvent(): Promise<RoutingEvent | null> {
  const stored = await chrome.storage.local.get(ROUTING_EVENT_KEY);
  return stored[ROUTING_EVENT_KEY] === undefined
    ? null
    : parseRoutingEvent(stored[ROUTING_EVENT_KEY]);
}

let writes: Promise<void> = Promise.resolve();
export function saveRoutingEvent(event: RoutingEvent): Promise<void> {
  const snapshot = parseRoutingEvent(event);
  // Serialize status writes so an older pending write cannot replace the latest event.
  const result = writes.then(() =>
    chrome.storage.local.set({ [ROUTING_EVENT_KEY]: snapshot }),
  );
  writes = result.catch(() => {});
  return result;
}
