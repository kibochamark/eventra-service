import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Validates that a date string (ISO 8601) is today or in the future.
 * Comparison is done at the day level in UTC so that "today" anywhere
 * in the world is always accepted.
 */
@ValidatorConstraint({ name: 'isNotPastDate', async: false })
export class IsNotPastDateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (!value || typeof value !== 'string') return false;

    const input = new Date(value);
    if (isNaN(input.getTime())) return false;

    // Strip time — compare calendar days in UTC
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const inputDay = new Date(input);
    inputDay.setUTCHours(0, 0, 0, 0);

    return inputDay >= today;
  }

  defaultMessage(): string {
    return 'Event date must be today or in the future';
  }
}

export function IsNotPastDate(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      constraints: [],
      validator: IsNotPastDateConstraint,
    });
  };
}
