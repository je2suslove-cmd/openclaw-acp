/**
 * Donation Job Handlers
 *
 * Client provides: { name: string, amount: number }
 * - requestAdditionalFunds: requests transfer of the specified donation amount
 * - executeJob: returns a thank-you message with the donor's name
 */

export function requestAdditionalFunds(request: any): number {
  return request.amount;
}

export async function executeJob(request: any): Promise<string> {
  return `Thank you ${request.name}`;
}
