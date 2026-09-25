import { Policy } from '../types/models';

/**
 * Valida limites de temperatura
 */
export function validateThresholds(policy: Policy): boolean {
  return (
    policy.minTemp < policy.targetTemp &&
    policy.targetTemp < policy.maxTemp &&
    policy.minTemp < policy.maxTemp &&
    (policy.hysteresis ?? 0) >= 0 &&
    (policy.minimumDuration ?? 0) >= 0
  );
}
