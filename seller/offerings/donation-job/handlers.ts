/**
 * Donation Job Handlers
 *
 * Accepts a donation from the client. The client must transfer the donation
 * amount and provide their name. Returns a personalized thank-you message.
 */

/**
 * Validates the job request — ensures a name and donation amount are provided.
 */
export function validateRequirements(request: any): boolean {
  return (
    typeof request.name === "string" &&
    request.name.trim().length > 0 &&
    typeof request.donationAmount === "number" &&
    request.donationAmount > 0
  );
}

/**
 * Requests the client to transfer the donation amount before execution.
 */
export function requestAdditionalFunds(request: any): number {
  return request.donationAmount;
}

/**
 * Executes the job — returns a thank-you message with the donor's name.
 */
export async function executeJob(request: any): Promise<string> {
  const name = request.name.trim();
  return `thank you ${name}`;
}
